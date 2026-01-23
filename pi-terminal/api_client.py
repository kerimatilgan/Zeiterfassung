#!/usr/bin/env python3
"""
API-Client für die Zeiterfassung
Kommuniziert mit dem Backend-Server
"""

import requests
import json


class ZeiterfassungAPI:
    """HTTP-Client für das Zeiterfassung-Backend"""

    def __init__(self, base_url, api_key):
        self.base_url = base_url.rstrip('/')
        self.api_key = api_key
        self.session = requests.Session()
        self.session.headers.update({
            'Content-Type': 'application/json',
            'x-terminal-api-key': api_key
        })
        self.timeout = 10  # Sekunden

    def clock_in_out(self, rfid_card=None, qr_code=None):
        """
        Ein- oder Ausstempeln via RFID oder QR-Code

        Args:
            rfid_card: RFID-Karten-ID
            qr_code: QR-Code-String

        Returns:
            dict mit success, action, employee, entry, message, error
        """
        try:
            payload = {}
            if rfid_card:
                payload['rfidCard'] = rfid_card
            if qr_code:
                payload['qrCode'] = qr_code

            if not payload:
                return {'success': False, 'error': 'Keine ID übermittelt'}

            response = self.session.post(
                f"{self.base_url}/api/terminal/scan",
                json=payload,
                timeout=self.timeout
            )

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

        except requests.Timeout:
            return {'success': False, 'error': 'Server-Timeout'}
        except requests.ConnectionError:
            return {'success': False, 'error': 'Keine Verbindung zum Server'}
        except requests.RequestException as e:
            return {'success': False, 'error': f'Verbindungsfehler: {str(e)}'}

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
                return response.json()
            return None
        except:
            return None
