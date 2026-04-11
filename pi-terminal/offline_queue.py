#!/usr/bin/env python3
"""
Offline-Queue für das RFID-Terminal
Speichert Stempelungen lokal wenn der Server nicht erreichbar ist
und synchronisiert sie bei Wiederverbindung.
Ungültige Einträge werden nach max. Versuchen automatisch entfernt.
"""

import json
import os
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional, Callable

# Display-Callback für Sync-Benachrichtigungen
_display_callback: Optional[Callable] = None

def set_display_callback(callback: Callable):
    global _display_callback
    _display_callback = callback


class OfflineQueue:
    MAX_ATTEMPTS = 5
    MAX_AGE_HOURS = 48
    SYNC_INTERVAL = 15

    def __init__(self, queue_file: str = None, sync_callback: Callable = None):
        if queue_file is None:
            queue_file = Path(__file__).parent / 'offline_queue.json'

        self.queue_file = Path(queue_file)
        self.sync_callback = sync_callback
        self.queue = []
        self.lock = threading.Lock()
        self.is_online = False
        self.sync_thread = None
        self.running = False

        self._load_queue()
        self._cleanup_old_entries()

        pending = len(self.queue)
        print(f"[QUEUE] Initialisiert: {self.queue_file}")
        if pending > 0:
            print(f"[QUEUE] {pending} ausstehende Einträge")

    def _load_queue(self):
        try:
            if self.queue_file.exists():
                with open(self.queue_file, 'r') as f:
                    self.queue = json.load(f)
                    self.queue = [
                        entry for entry in self.queue
                        if isinstance(entry, dict) and 'rfid_card' in entry and 'timestamp' in entry
                    ]
        except (json.JSONDecodeError, IOError) as e:
            print(f"[QUEUE] Fehler beim Laden: {e}")
            self.queue = []

    def _save_queue(self):
        try:
            with open(self.queue_file, 'w') as f:
                json.dump(self.queue, f, indent=2)
        except IOError as e:
            print(f"[QUEUE] Fehler beim Speichern: {e}")

    def _cleanup_old_entries(self):
        cutoff = datetime.now() - timedelta(hours=self.MAX_AGE_HOURS)
        initial = len(self.queue)

        with self.lock:
            cleaned = []
            for entry in self.queue:
                attempts = entry.get('attempts', 0)
                last_error = entry.get('last_error', '')
                is_permanent_error = any(err in (last_error or '') for err in [
                    'Unbekannte RFID', 'nicht gefunden', 'nicht aktiv'
                ])

                if attempts >= self.MAX_ATTEMPTS and is_permanent_error:
                    print(f"[QUEUE] Verwerfe Eintrag (permanenter Fehler): {entry['rfid_card']} - {last_error}")
                    continue

                try:
                    ts = datetime.fromisoformat(entry['timestamp'])
                    if ts < cutoff:
                        print(f"[QUEUE] Verwerfe Eintrag (zu alt): {entry['rfid_card']} @ {entry['timestamp']}")
                        continue
                except:
                    pass

                cleaned.append(entry)

            self.queue = cleaned
            if len(cleaned) < initial:
                self._save_queue()
                print(f"[QUEUE] {initial - len(cleaned)} alte/fehlerhafte Einträge bereinigt")

    def add(self, rfid_card: str, timestamp: datetime = None) -> dict:
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

        print(f"[QUEUE] Gespeichert: {rfid_card} @ {timestamp.strftime('%H:%M:%S')} (#{queue_position})")

        return {
            'queued': True,
            'position': queue_position,
            'timestamp': timestamp.isoformat()
        }

    def get_pending_count(self) -> int:
        with self.lock:
            return len(self.queue)

    def get_pending(self) -> list:
        with self.lock:
            return list(self.queue)

    def remove(self, entry: dict):
        with self.lock:
            self.queue = [
                e for e in self.queue
                if not (e['rfid_card'] == entry['rfid_card'] and e['timestamp'] == entry['timestamp'])
            ]
            self._save_queue()

    def update_entry(self, entry: dict, error: str = None):
        with self.lock:
            for e in self.queue:
                if e['rfid_card'] == entry['rfid_card'] and e['timestamp'] == entry['timestamp']:
                    e['attempts'] = e.get('attempts', 0) + 1
                    e['last_error'] = error
                    e['last_attempt'] = datetime.now().isoformat()
                    break
            self._save_queue()

    def set_online_status(self, is_online: bool):
        was_offline = not self.is_online
        self.is_online = is_online

        if is_online and was_offline and len(self.queue) > 0:
            print(f"[QUEUE] Wieder online - starte Sync ({len(self.queue)} Einträge)...")
            self._trigger_sync()

    def start_sync_thread(self):
        if self.sync_thread and self.sync_thread.is_alive():
            return

        self.running = True
        self.sync_thread = threading.Thread(target=self._sync_loop, daemon=True)
        self.sync_thread.start()

    def stop_sync_thread(self):
        self.running = False
        if self.sync_thread:
            self.sync_thread.join(timeout=5)

    def _sync_loop(self):
        while self.running:
            try:
                if self.is_online and len(self.queue) > 0:
                    self._sync_pending()
                self._cleanup_old_entries()
            except Exception as e:
                print(f"[QUEUE] Sync-Fehler: {e}")

            time.sleep(self.SYNC_INTERVAL)

    def _trigger_sync(self):
        threading.Thread(target=self._sync_pending, daemon=True).start()

    def _sync_pending(self):
        if not self.sync_callback:
            return

        with self.lock:
            pending = list(self.queue)

        if not pending:
            return

        print(f"[QUEUE] Synchronisiere {len(pending)} Einträge...")

        # Display-Meldung: Sync läuft
        if _display_callback:
            _display_callback("Synchronisiere...", f"{len(pending)} Stempelungen", 0)

        synced_count = 0
        for entry in pending:
            attempts = entry.get('attempts', 0)
            last_error = entry.get('last_error', '')

            is_permanent = any(err in (last_error or '') for err in [
                'Unbekannte RFID', 'nicht gefunden', 'nicht aktiv'
            ])
            if attempts >= self.MAX_ATTEMPTS and is_permanent:
                self.remove(entry)
                print(f"[QUEUE] Entfernt (permanenter Fehler): {entry['rfid_card']}")
                continue

            if attempts >= self.MAX_ATTEMPTS * 2:
                self.remove(entry)
                print(f"[QUEUE] Entfernt (max. Versuche): {entry['rfid_card']}")
                continue

            try:
                result = self.sync_callback(entry['rfid_card'], entry['timestamp'])

                if result.get('success') or result.get('synced'):
                    self.remove(entry)
                    synced_count += 1
                    print(f"[QUEUE] ✓ Synchronisiert: {entry['rfid_card']} @ {entry['timestamp']}")
                else:
                    error = result.get('error', 'Unbekannter Fehler')
                    if 'Verbindung' not in error and 'Timeout' not in error:
                        self.update_entry(entry, error)
                    print(f"[QUEUE] ✗ Sync-Fehler: {error}")

            except Exception as e:
                print(f"[QUEUE] Exception: {e}")

            time.sleep(0.5)

        remaining = self.get_pending_count()
        if synced_count > 0:
            print(f"[QUEUE] {synced_count} synchronisiert, {remaining} verbleibend")
            if _display_callback:
                _display_callback("Sync fertig", f"{synced_count} uebertragen", 2)


_queue_instance: Optional[OfflineQueue] = None


def get_queue() -> Optional[OfflineQueue]:
    return _queue_instance


def init_queue(queue_file: str = None, sync_callback: Callable = None) -> OfflineQueue:
    global _queue_instance
    _queue_instance = OfflineQueue(queue_file, sync_callback)
    return _queue_instance
