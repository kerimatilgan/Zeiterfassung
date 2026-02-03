#!/usr/bin/env python3
"""
API-Client für die Zeiterfassung
Kommuniziert mit dem Backend-Server
Mit Offline-Queue-Unterstützung
"""

import requests
import json
from datetime import datetime
from typing import Optional, Callable


class ZeiterfassungAPI:
    """HTTP-Client für das Zeiterfassung-Backend mit Offline-Unterstützung"""

    def __init__(self, base_url, api_key):
        self.base_url = base_url.rstrip('/')
        self.api_key = api_key
        self.session = requests.Session()
        self.session.headers.update({
            'Content-Type': 'application/json',
            'x-terminal-api-key': api_key
        })
        self.timeout = 10  # Sekunden
        self.offline_queue = None
        self.is_online = True
        self._on_status_change: Optional[Callable] = None

    def set_offline_queue(self, queue):
        """Setzt die Offline-Queue für das Caching bei Verbindungsproblemen"""
        self.offline_queue = queue
        # Registriere Sync-Callback
        if queue:
            queue.sync_callback = self._sync_offline_entry

    def set_status_callback(self, callback: Callable):
        """Setzt Callback für Online/Offline-Status-Änderungen"""
        self._on_status_change = callback

    def _update_online_status(self, is_online: bool):
        """Aktualisiert den Online-Status"""
        if self.is_online != is_online:
            self.is_online = is_online
            if self.offline_queue:
                self.offline_queue.set_online_status(is_online)
            if self._on_status_change:
                self._on_status_change(is_online)
            print(f"[API] Status: {'Online' if is_online else 'Offline'}")

    def clock_in_out(self, rfid_card=None, qr_code=None, timestamp=None, allow_offline=True):
        """
        Ein- oder Ausstempeln via RFID oder QR-Code
        Mit Offline-Queue-Unterstützung

        Args:
            rfid_card: RFID-Karten-ID
            qr_code: QR-Code-String
            timestamp: Optionaler Zeitstempel (ISO-Format oder datetime)
            allow_offline: Wenn True, wird bei Verbindungsproblemen offline gespeichert

        Returns:
            dict mit success, action, employee, entry, message, error, offline
        """
        scan_time = datetime.now()

        try:
            payload = {}
            if rfid_card:
                payload['rfidCard'] = rfid_card
            if qr_code:
                payload['qrCode'] = qr_code
            if timestamp:
                # Timestamp für verzögerte Synchronisation
                if isinstance(timestamp, datetime):
                    payload['timestamp'] = timestamp.isoformat()
                else:
                    payload['timestamp'] = timestamp

            if not payload or (not rfid_card and not qr_code):
                return {'success': False, 'error': 'Keine ID übermittelt'}

            response = self.session.post(
                f"{self.base_url}/api/terminal/scan",
                json=payload,
                timeout=self.timeout
            )

            # Server erreichbar - Status aktualisieren
            self._update_online_status(True)

            # Immer JSON zurückgeben, auch bei Fehlern
            try:
                data = response.json()
            except json.JSONDecodeError:
                data = {
                    'success': False,
                    'error': f'Ungültige Server-Antwort (HTTP {response.status_code})'
                }

            # Bei HTTP-Fehlern das error-Feld setzen falls nicht vorhanden
            if not response.ok and 'success' not in data:
                data['success'] = False
                if 'error' not in data:
                    data['error'] = f'HTTP {response.status_code}'

            return data

        except (requests.Timeout, requests.ConnectionError) as e:
            # Server nicht erreichbar
            self._update_online_status(False)

            error_msg = 'Server-Timeout' if isinstance(e, requests.Timeout) else 'Keine Verbindung'

            # Offline-Queue verwenden wenn verfügbar
            if allow_offline and self.offline_queue and rfid_card:
                queue_result = self.offline_queue.add(rfid_card, scan_time)
                return {
                    'success': True,
                    'offline': True,
                    'queued': True,
                    'queue_position': queue_result.get('position', 0),
                    'message': f'Offline gespeichert (Position {queue_result.get("position", "?")})',
                    'error': None,
                    'action': 'queued',
                    'employee': {'name': f'Karte {rfid_card[-4:]}'},  # Zeige letzte 4 Zeichen
                }

            return {'success': False, 'error': error_msg}

        except requests.RequestException as e:
            self._update_online_status(False)
            return {'success': False, 'error': f'Verbindungsfehler: {str(e)}'}

    def _sync_offline_entry(self, rfid_card: str, timestamp: str) -> dict:
        """
        Synchronisiert einen Offline-Eintrag mit dem Server

        Args:
            rfid_card: RFID-Karten-ID
            timestamp: ISO-formatierter Zeitstempel

        Returns:
            dict mit Sync-Status
        """
        try:
            result = self.clock_in_out(
                rfid_card=rfid_card,
                timestamp=timestamp,
                allow_offline=False  # Nicht erneut queuen
            )

            if result.get('success'):
                return {'success': True, 'synced': True}
            else:
                return {'success': False, 'error': result.get('error', 'Sync fehlgeschlagen')}

        except Exception as e:
            return {'success': False, 'error': str(e)}

    def health_check(self):
        """
        Prüft ob das Backend erreichbar ist

        Returns:
            bool: True wenn Backend erreichbar
        """
        try:
            response = self.session.get(
                f"{self.base_url}/api/health",
                timeout=5
            )
            return response.status_code == 200
        except:
            return False

    def get_employee_by_rfid(self, rfid_card):
        """
        Holt Mitarbeiter-Informationen anhand der RFID-Karte
        (Nur für Debug-Zwecke)

        Args:
            rfid_card: RFID-Karten-ID

        Returns:
            dict mit Mitarbeiter-Daten oder None
        """
        try:
            response = self.session.get(
                f"{self.base_url}/api/terminal/status/{rfid_card}",
                timeout=self.timeout
            )
            if response.ok:
                self._update_online_status(True)
                return response.json()
            return None
        except:
            self._update_online_status(False)
            return None

    def get_queue_status(self) -> dict:
        """
        Gibt den Status der Offline-Queue zurück

        Returns:
            dict mit pending_count und is_online
        """
        pending = 0
        if self.offline_queue:
            pending = self.offline_queue.get_pending_count()

        return {
            'is_online': self.is_online,
            'pending_count': pending,
            'pending_entries': self.offline_queue.get_pending() if self.offline_queue else []
        }

    def force_sync(self):
        """Erzwingt eine sofortige Synchronisation der Queue"""
        if self.offline_queue:
            self.offline_queue._trigger_sync()
