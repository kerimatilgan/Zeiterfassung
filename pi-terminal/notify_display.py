#!/usr/bin/env python3
"""
Lokale Benachrichtigung an das HDMI-Display
Schreibt JSON in eine Datei die vom HDMI-Display gelesen wird
"""

import json
import time
from pathlib import Path

NOTIFY_FILE = Path(__file__).parent / '.display_notify.json'


def notify_display(data: dict):
    """Schreibt eine Benachrichtigung die vom HDMI-Display gelesen werden kann"""
    try:
        data['timestamp'] = time.time()
        with open(NOTIFY_FILE, 'w') as f:
            json.dump(data, f)
    except Exception as e:
        print(f"[NOTIFY] Fehler: {e}")


def notify_clock_in(name: str, offline: bool = False):
    notify_display({
        'type': 'clock_in',
        'name': name,
        'offline': offline,
        'success': True,
    })


def notify_clock_out(name: str, hours_worked: str = '', offline: bool = False):
    notify_display({
        'type': 'clock_out',
        'name': name,
        'hours_worked': hours_worked,
        'offline': offline,
        'success': True,
    })


def notify_error(error: str, message: str = ''):
    notify_display({
        'type': 'error',
        'error': error,
        'message': message,
        'success': False,
    })


def notify_offline_queued(name: str, queue_position: int):
    notify_display({
        'type': 'offline_queued',
        'name': name,
        'queue_position': queue_position,
        'success': True,
        'offline': True,
    })


def read_notification() -> dict:
    """Liest die letzte Benachrichtigung (für HDMI-Display)"""
    try:
        if NOTIFY_FILE.exists():
            with open(NOTIFY_FILE, 'r') as f:
                data = json.load(f)
            if time.time() - data.get('timestamp', 0) < 10:
                return data
    except:
        pass
    return {}
