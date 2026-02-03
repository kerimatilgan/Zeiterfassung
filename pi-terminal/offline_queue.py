#!/usr/bin/env python3
"""
Offline-Queue für das RFID-Terminal
Speichert Stempelungen lokal wenn der Server nicht erreichbar ist
und synchronisiert sie bei Wiederverbindung
"""

import json
import os
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Optional, Callable


class OfflineQueue:
    """
    Verwaltet eine Queue von Stempelungen die offline erfasst wurden
    und synchronisiert sie automatisch wenn der Server wieder erreichbar ist
    """

    def __init__(self, queue_file: str = None, sync_callback: Callable = None):
        """
        Initialisiert die Offline-Queue

        Args:
            queue_file: Pfad zur Queue-Datei (default: ~/zeiterfassung_queue.json)
            sync_callback: Funktion zum Synchronisieren eines Eintrags
        """
        if queue_file is None:
            queue_file = Path.home() / 'zeiterfassung_queue.json'

        self.queue_file = Path(queue_file)
        self.sync_callback = sync_callback
        self.queue = []
        self.lock = threading.Lock()
        self.is_online = False
        self.sync_thread = None
        self.running = False

        # Queue aus Datei laden
        self._load_queue()

        print(f"[OFFLINE-QUEUE] Initialisiert: {self.queue_file}")
        print(f"[OFFLINE-QUEUE] {len(self.queue)} ausstehende Einträge")

    def _load_queue(self):
        """Lädt die Queue aus der Datei"""
        try:
            if self.queue_file.exists():
                with open(self.queue_file, 'r') as f:
                    self.queue = json.load(f)
                    # Validiere Einträge
                    self.queue = [
                        entry for entry in self.queue
                        if isinstance(entry, dict) and 'rfid_card' in entry and 'timestamp' in entry
                    ]
        except (json.JSONDecodeError, IOError) as e:
            print(f"[OFFLINE-QUEUE] Fehler beim Laden: {e}")
            self.queue = []

    def _save_queue(self):
        """Speichert die Queue in die Datei"""
        try:
            with open(self.queue_file, 'w') as f:
                json.dump(self.queue, f, indent=2)
        except IOError as e:
            print(f"[OFFLINE-QUEUE] Fehler beim Speichern: {e}")

    def add(self, rfid_card: str, timestamp: datetime = None) -> dict:
        """
        Fügt eine Stempelung zur Offline-Queue hinzu

        Args:
            rfid_card: RFID-Karten-ID
            timestamp: Zeitpunkt der Stempelung (default: jetzt)

        Returns:
            dict mit Status-Informationen
        """
        if timestamp is None:
            timestamp = datetime.now()

        entry = {
            'rfid_card': rfid_card,
            'timestamp': timestamp.isoformat(),
            'queued_at': datetime.now().isoformat(),
            'attempts': 0,
            'last_error': None
        }

        with self.lock:
            self.queue.append(entry)
            self._save_queue()
            queue_position = len(self.queue)

        print(f"[OFFLINE-QUEUE] Stempelung gespeichert: {rfid_card} @ {timestamp.strftime('%H:%M:%S')}")
        print(f"[OFFLINE-QUEUE] Position in Queue: {queue_position}")

        return {
            'queued': True,
            'position': queue_position,
            'timestamp': timestamp.isoformat()
        }

    def get_pending_count(self) -> int:
        """Gibt die Anzahl ausstehender Einträge zurück"""
        with self.lock:
            return len(self.queue)

    def get_pending(self) -> list:
        """Gibt alle ausstehenden Einträge zurück"""
        with self.lock:
            return list(self.queue)

    def remove(self, entry: dict):
        """Entfernt einen Eintrag aus der Queue"""
        with self.lock:
            try:
                self.queue = [
                    e for e in self.queue
                    if not (e['rfid_card'] == entry['rfid_card'] and e['timestamp'] == entry['timestamp'])
                ]
                self._save_queue()
            except ValueError:
                pass

    def update_entry(self, entry: dict, error: str = None):
        """Aktualisiert einen Eintrag (z.B. nach fehlgeschlagenem Sync)"""
        with self.lock:
            for e in self.queue:
                if e['rfid_card'] == entry['rfid_card'] and e['timestamp'] == entry['timestamp']:
                    e['attempts'] = e.get('attempts', 0) + 1
                    e['last_error'] = error
                    e['last_attempt'] = datetime.now().isoformat()
                    break
            self._save_queue()

    def set_online_status(self, is_online: bool):
        """Setzt den Online-Status"""
        was_offline = not self.is_online
        self.is_online = is_online

        # Wenn gerade online gekommen, sofort Sync versuchen
        if is_online and was_offline and len(self.queue) > 0:
            print(f"[OFFLINE-QUEUE] Wieder online - starte Synchronisation...")
            self._trigger_sync()

    def start_sync_thread(self):
        """Startet den Hintergrund-Sync-Thread"""
        if self.sync_thread and self.sync_thread.is_alive():
            return

        self.running = True
        self.sync_thread = threading.Thread(target=self._sync_loop, daemon=True)
        self.sync_thread.start()
        print("[OFFLINE-QUEUE] Sync-Thread gestartet")

    def stop_sync_thread(self):
        """Stoppt den Sync-Thread"""
        self.running = False
        if self.sync_thread:
            self.sync_thread.join(timeout=5)

    def _sync_loop(self):
        """Hintergrund-Thread der periodisch versucht zu synchronisieren"""
        while self.running:
            try:
                if self.is_online and len(self.queue) > 0:
                    self._sync_pending()
            except Exception as e:
                print(f"[OFFLINE-QUEUE] Sync-Fehler: {e}")

            # Alle 30 Sekunden prüfen
            time.sleep(30)

    def _trigger_sync(self):
        """Triggert eine sofortige Synchronisation"""
        threading.Thread(target=self._sync_pending, daemon=True).start()

    def _sync_pending(self):
        """Synchronisiert ausstehende Einträge"""
        if not self.sync_callback:
            return

        with self.lock:
            pending = list(self.queue)

        if not pending:
            return

        print(f"[OFFLINE-QUEUE] Synchronisiere {len(pending)} Einträge...")

        synced_count = 0
        for entry in pending:
            # Maximal 5 Versuche pro Eintrag
            if entry.get('attempts', 0) >= 5:
                print(f"[OFFLINE-QUEUE] Eintrag übersprungen (zu viele Versuche): {entry['rfid_card']}")
                continue

            try:
                result = self.sync_callback(entry['rfid_card'], entry['timestamp'])

                if result.get('success') or result.get('synced'):
                    self.remove(entry)
                    synced_count += 1
                    print(f"[OFFLINE-QUEUE] Synchronisiert: {entry['rfid_card']} @ {entry['timestamp']}")
                else:
                    error = result.get('error', 'Unbekannter Fehler')
                    # Bei "Keine Verbindung" nicht als Versuch zählen
                    if 'Verbindung' not in error and 'Timeout' not in error:
                        self.update_entry(entry, error)
                    print(f"[OFFLINE-QUEUE] Sync fehlgeschlagen: {error}")

            except Exception as e:
                print(f"[OFFLINE-QUEUE] Sync-Exception: {e}")

            # Kurze Pause zwischen Syncs
            time.sleep(0.5)

        remaining = self.get_pending_count()
        if synced_count > 0:
            print(f"[OFFLINE-QUEUE] {synced_count} Einträge synchronisiert, {remaining} verbleibend")


# Singleton-Instanz
_queue_instance: Optional[OfflineQueue] = None


def get_queue() -> Optional[OfflineQueue]:
    """Gibt die globale Queue-Instanz zurück"""
    return _queue_instance


def init_queue(queue_file: str = None, sync_callback: Callable = None) -> OfflineQueue:
    """Initialisiert die globale Queue-Instanz"""
    global _queue_instance
    _queue_instance = OfflineQueue(queue_file, sync_callback)
    return _queue_instance
