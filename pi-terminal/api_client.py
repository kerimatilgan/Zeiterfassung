#!/usr/bin/env python3
"""
API-Client für die Zeiterfassung
Kommuniziert mit dem Backend-Server
Mit Offline-Queue-Unterstützung, Employee-Caching und Status-Tracking
"""

import requests
import json
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Optional, Callable


class EmployeeCache:
    """Lokaler Cache für Mitarbeiterdaten + Status (RFID → Name/Status)"""

    def __init__(self, cache_file: str = None):
        if cache_file is None:
            cache_file = Path(__file__).parent / 'employee_cache.json'
        self.cache_file = Path(cache_file)
        self.cache = {}
        self._load()

    def _load(self):
        try:
            if self.cache_file.exists():
                with open(self.cache_file, 'r') as f:
                    self.cache = json.load(f)
                print(f"[CACHE] {len(self.cache)} Mitarbeiter geladen")
        except Exception as e:
            print(f"[CACHE] Fehler beim Laden: {e}")
            self.cache = {}

    def _save(self):
        try:
            with open(self.cache_file, 'w') as f:
                json.dump(self.cache, f, indent=2)
        except Exception as e:
            print(f"[CACHE] Fehler beim Speichern: {e}")

    def update(self, rfid_card: str, employee_data: dict):
        existing = self.cache.get(rfid_card, {})
        self.cache[rfid_card] = {
            'name': employee_data.get('name', existing.get('name', 'Unbekannt')),
            'firstName': employee_data.get('firstName', existing.get('firstName', '')),
            'lastName': employee_data.get('lastName', existing.get('lastName', '')),
            'employeeNumber': employee_data.get('employeeNumber', existing.get('employeeNumber', '')),
            'isClockedIn': employee_data.get('isClockedIn', existing.get('isClockedIn', False)),
            'updated_at': datetime.now().isoformat(),
        }
        self._save()

    def set_status(self, rfid_card: str, is_clocked_in: bool):
        if rfid_card in self.cache:
            self.cache[rfid_card]['isClockedIn'] = is_clocked_in
            self._save()

    def is_known(self, rfid_card: str) -> bool:
        return rfid_card in self.cache

    def is_clocked_in(self, rfid_card: str) -> bool:
        entry = self.cache.get(rfid_card)
        if entry:
            return entry.get('isClockedIn', False)
        return False

    def get(self, rfid_card: str) -> Optional[dict]:
        return self.cache.get(rfid_card)

    def get_name(self, rfid_card: str) -> str:
        entry = self.cache.get(rfid_card)
        if entry:
            return entry.get('name', f'Karte {rfid_card[-4:]}')
        return ''


class ZeiterfassungAPI:
    """HTTP-Client für das Zeiterfassung-Backend mit Offline-Unterstützung"""

    def __init__(self, base_url, api_key):
        self.base_url = base_url.rstrip('/')
        self.api_key = api_key
        self.timeout = 1.5
        self.offline_queue = None
        self.is_online = True
        self._on_status_change: Optional[Callable] = None
        self.employee_cache = EmployeeCache()
        self._health_check_running = False

        self._create_session()

    def _create_session(self):
        self.session = requests.Session()
        self.session.headers.update({
            'Content-Type': 'application/json',
            'x-terminal-api-key': self.api_key
        })
        adapter = requests.adapters.HTTPAdapter(
            max_retries=1,
            pool_connections=1,
            pool_maxsize=1,
        )
        self.session.mount('http://', adapter)
        self.session.mount('https://', adapter)

    def _reset_session(self):
        try:
            self.session.close()
        except:
            pass
        self._create_session()

    def set_offline_queue(self, queue):
        self.offline_queue = queue
        if queue:
            queue.sync_callback = self._sync_offline_entry

    def set_status_callback(self, callback: Callable):
        self._on_status_change = callback

    def _update_online_status(self, is_online: bool):
        if self.is_online != is_online:
            self.is_online = is_online
            if is_online:
                print(f"[API] ✓ Wieder ONLINE")
                threading.Thread(target=self.preload_cache, daemon=True).start()
            else:
                print(f"[API] ✗ OFFLINE")
                self._reset_session()
            if self.offline_queue:
                self.offline_queue.set_online_status(is_online)
            if self._on_status_change:
                self._on_status_change(is_online)

    def start_health_check_loop(self, interval: int = 15):
        if self._health_check_running:
            return
        self._health_check_running = True

        def loop():
            while self._health_check_running:
                try:
                    online = self.health_check()
                    self._update_online_status(online)
                except:
                    self._update_online_status(False)
                time.sleep(interval)

        t = threading.Thread(target=loop, daemon=True, name="HealthCheck")
        t.start()
        print(f"[API] Health-Check-Loop gestartet (alle {interval}s)")

    def clock_in_out(self, rfid_card=None, qr_code=None, timestamp=None, allow_offline=True):
        scan_time = datetime.now()

        try:
            payload = {}
            if rfid_card:
                payload['rfidCard'] = rfid_card
            if qr_code:
                payload['qrCode'] = qr_code
            if timestamp:
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

            self._update_online_status(True)

            try:
                data = response.json()
            except json.JSONDecodeError:
                data = {'success': False, 'error': f'Ungültige Server-Antwort (HTTP {response.status_code})'}

            if not response.ok and 'success' not in data:
                data['success'] = False
                if 'error' not in data:
                    data['error'] = f'HTTP {response.status_code}'

            if data.get('success') and rfid_card and data.get('employee'):
                action = data.get('action', '')
                is_clocked_in = (action == 'clock_in')
                emp_data = {**data['employee'], 'isClockedIn': is_clocked_in}
                self.employee_cache.update(rfid_card, emp_data)

            return data

        except (requests.Timeout, requests.ConnectionError) as e:
            self._update_online_status(False)

            if allow_offline and self.offline_queue and rfid_card:
                if not self.employee_cache.is_known(rfid_card):
                    return {
                        'success': False,
                        'error': 'Karte nicht erkannt (offline)',
                        'offline': True,
                    }

                cached_name = self.employee_cache.get_name(rfid_card)
                was_clocked_in = self.employee_cache.is_clocked_in(rfid_card)

                new_status = not was_clocked_in
                self.employee_cache.set_status(rfid_card, new_status)
                action = 'clock_in' if new_status else 'clock_out'

                queue_result = self.offline_queue.add(rfid_card, scan_time)
                return {
                    'success': True,
                    'offline': True,
                    'queued': True,
                    'queue_position': queue_result.get('position', 0),
                    'message': f'Offline gespeichert',
                    'error': None,
                    'action': action,
                    'employee': {'name': cached_name},
                }

            return {'success': False, 'error': 'Keine Verbindung'}

        except requests.RequestException as e:
            self._update_online_status(False)
            self._reset_session()
            return {'success': False, 'error': f'Verbindungsfehler: {str(e)}'}

    def _sync_offline_entry(self, rfid_card: str, timestamp: str) -> dict:
        """Synchronisiert still im Hintergrund (kein Display-Feedback)"""
        try:
            payload = {'rfidCard': rfid_card, 'timestamp': timestamp, 'silent': True}
            response = self.session.post(
                f"{self.base_url}/api/terminal/scan",
                json=payload,
                timeout=self.timeout
            )
            data = response.json()
            if data.get('success'):
                action = data.get('action', '')
                if rfid_card and data.get('employee'):
                    emp_data = {**data['employee'], 'isClockedIn': action == 'clock_in'}
                    self.employee_cache.update(rfid_card, emp_data)
                return {'success': True, 'synced': True}
            else:
                return {'success': False, 'error': data.get('error', 'Sync fehlgeschlagen')}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def preload_cache(self):
        """Lädt alle Mitarbeiter-RFID-Daten + Status vom Server in den lokalen Cache"""
        try:
            response = self.session.get(
                f"{self.base_url}/api/terminal/employees",
                timeout=10
            )
            if response.ok:
                employees = response.json()
                for emp in employees:
                    if emp.get('rfidCard'):
                        self.employee_cache.update(emp['rfidCard'], emp)
                print(f"[CACHE] {len(employees)} Mitarbeiter vom Server geladen")

            try:
                status_response = self.session.get(
                    f"{self.base_url}/api/terminal/active-status",
                    timeout=10
                )
                if status_response.ok:
                    active = status_response.json()
                    for rfid in self.employee_cache.cache:
                        self.employee_cache.cache[rfid]['isClockedIn'] = False
                    for entry in active:
                        rfid = entry.get('rfidCard')
                        if rfid and rfid in self.employee_cache.cache:
                            self.employee_cache.cache[rfid]['isClockedIn'] = True
                    self.employee_cache._save()
                    active_count = sum(1 for r in self.employee_cache.cache.values() if r.get('isClockedIn'))
                    print(f"[CACHE] Status geladen: {active_count} aktuell eingestempelt")
            except Exception as e:
                print(f"[CACHE] Status-Laden fehlgeschlagen: {e}")

            return True
        except Exception as e:
            print(f"[CACHE] Vorladen fehlgeschlagen: {e}")
        return False

    def health_check(self):
        try:
            response = self.session.get(
                f"{self.base_url}/api/health",
                timeout=5
            )
            return response.status_code == 200
        except:
            return False

    def get_employee_by_rfid(self, rfid_card):
        try:
            response = self.session.get(
                f"{self.base_url}/api/terminal/status/{rfid_card}",
                timeout=self.timeout
            )
            if response.ok:
                self._update_online_status(True)
                data = response.json()
                if data and data.get('employee'):
                    self.employee_cache.update(rfid_card, data['employee'])
                return data
            return None
        except:
            self._update_online_status(False)
            cached = self.employee_cache.get(rfid_card)
            if cached:
                return {'employee': cached, 'cached': True}
            return None

    def get_queue_status(self) -> dict:
        pending = 0
        if self.offline_queue:
            pending = self.offline_queue.get_pending_count()
        return {
            'is_online': self.is_online,
            'pending_count': pending,
            'pending_entries': self.offline_queue.get_pending() if self.offline_queue else []
        }

    def force_sync(self):
        if self.offline_queue:
            self.offline_queue._trigger_sync()
