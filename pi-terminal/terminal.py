#!/usr/bin/env python3
"""
Zeiterfassung RFID Terminal
USB RFID Reader - liest Karten-IDs als Tastatureingabe
"""

import json
import time
import sys
import os
import subprocess
import threading
from pathlib import Path

import evdev
from evdev import ecodes, InputDevice

from api_client import ZeiterfassungAPI
from display import Display
from offline_queue import init_queue, get_queue

# Scancodes zu Zeichen mapping (US keyboard layout)
SCANCODES = {
    2: '1', 3: '2', 4: '3', 5: '4', 6: '5',
    7: '6', 8: '7', 9: '8', 10: '9', 11: '0',
    # A-Z
    16: 'Q', 17: 'W', 18: 'E', 19: 'R', 20: 'T',
    21: 'Y', 22: 'U', 23: 'I', 24: 'O', 25: 'P',
    30: 'A', 31: 'S', 32: 'D', 33: 'F', 34: 'G',
    35: 'H', 36: 'J', 37: 'K', 38: 'L',
    44: 'Z', 45: 'X', 46: 'C', 47: 'V', 48: 'B',
    49: 'N', 50: 'M',
}

# Minimum Kartenlänge (filtert Müll-Scans)
MIN_CARD_LENGTH = 8

# Anti-Collision Schutz
last_card_id = None
last_card_time = 0
SAME_CARD_COOLDOWN = 2  # Sekunden - gleiche Karte muss 2s warten


def load_config():
    """Lädt Konfiguration aus config.json"""
    config_path = Path(__file__).parent / 'config.json'

    if not config_path.exists():
        print(f"FEHLER: Konfigurationsdatei nicht gefunden: {config_path}")
        sys.exit(1)

    with open(config_path, 'r') as f:
        return json.load(f)


def is_valid_card(card_id):
    """Prüft ob eine Karten-ID gültig ist (keine Müll-Daten)"""
    if not card_id:
        return False
    if len(card_id) < MIN_CARD_LENGTH:
        return False
    # Filtere offensichtliche Müll-Scans
    if card_id == '0' * len(card_id):  # Alle Nullen
        return False
    if len(set(card_id)) == 1:  # Alle gleichen Zeichen
        return False
    return True


def check_cooldown(card_id):
    """Prüft ob die Karte gerade gescannt werden darf (Anti-Spam)"""
    global last_card_id, last_card_time

    now = time.time()

    # Andere Karte - immer erlaubt
    if card_id != last_card_id:
        last_card_id = card_id
        last_card_time = now
        return True

    # Gleiche Karte - prüfe Cooldown
    if now - last_card_time >= SAME_CARD_COOLDOWN:
        last_card_time = now
        return True

    return False


def reset_usb_port():
    """Setzt den USB-Port per usbreset zurück (zuverlässiger als ioctl)"""
    try:
        # Verwende usbreset Tool falls verfügbar
        result = subprocess.run(
            ['sudo', 'usbreset', 'ffff:0035'],
            capture_output=True,
            text=True,
            timeout=5
        )
        if result.returncode == 0:
            print("  USB-Port reset erfolgreich")
            return True
        else:
            print(f"  USB-Reset fehlgeschlagen: {result.stderr}")
            return False
    except FileNotFoundError:
        # usbreset nicht installiert - versuche alternativen Ansatz
        try:
            # Unbind und rebind des USB-Geräts
            subprocess.run(['sudo', 'sh', '-c',
                'echo "3-1" > /sys/bus/usb/drivers/usb/unbind 2>/dev/null; sleep 0.2; echo "3-1" > /sys/bus/usb/drivers/usb/bind 2>/dev/null'],
                timeout=3)
            return True
        except:
            return False
    except Exception as e:
        print(f"  USB-Reset Fehler: {e}")
        return False


def find_rfid_reader(quiet=False):
    """Findet den USB RFID Reader"""
    devices = [evdev.InputDevice(path) for path in evdev.list_devices()]

    if not quiet:
        print("Gefundene Eingabegeräte:")
        for device in devices:
            print(f"  - {device.name} ({device.path})")

    # Suche nach typischen RFID-Reader Namen
    for device in devices:
        name_lower = device.name.lower()
        if any(keyword in name_lower for keyword in ['rfid', 'reader', 'card', 'hid']):
            return device

    # Fallback: Erstes USB-HID-Gerät das kein Keyboard/Mouse ist
    for device in devices:
        # Überspringe Standard-Keyboards und Mäuse
        if 'keyboard' in device.name.lower() and 'usb' not in device.phys.lower():
            continue
        if 'mouse' in device.name.lower():
            continue
        if 'usb' in device.phys.lower():
            return device

    return None


def process_card(card_id, api, display, hdmi_display=None):
    """Verarbeitet gescannte Karte"""
    print(f"\n{'='*50}")
    print(f"Karte gescannt: {card_id}")
    display.show("Karte erkannt", card_id[:16])

    result = api.clock_in_out(rfid_card=card_id)

    if result.get('success'):
        # Prüfe ob offline gespeichert
        if result.get('offline') or result.get('queued'):
            employee = result.get('employee', {})
            name = employee.get('name', f'Karte {card_id[-4:]}')
            action = result.get('action', 'queued')
            queue_pos = result.get('queue_position', '?')

            if action == 'clock_in':
                print(f"⏳ OFFLINE EINGESTEMPELT: {name}")
                display.show("Eingestempelt*", name[:16], duration=2)
            elif action == 'clock_out':
                print(f"⏳ OFFLINE AUSGESTEMPELT: {name}")
                display.show("Ausgestempelt*", name[:16], duration=2)
            else:
                print(f"⏳ OFFLINE GESPEICHERT: {name}")
                display.show("Gespeichert*", name[:16], duration=2)
            print(f"  Queue #{queue_pos} - wird synchronisiert sobald Server erreichbar")

            if hdmi_display:
                hdmi_display.show_scan_result(
                    success=True,
                    name=name,
                    action=action,
                    error=None,
                    offline=True,
                )
        else:
            # Normal online verarbeitet
            employee = result.get('employee', {})
            name = employee.get('name', 'Unbekannt')
            photo_url = employee.get('photoUrl')
            action = result['action']

            if action == 'clock_in':
                print(f"✓ EINGESTEMPELT: {name}")
                display.show("Eingestempelt", name, duration=1)
                if hdmi_display:
                    hdmi_display.show_scan_result(
                        success=True,
                        name=name,
                        action='clock_in',
                        photo_url=photo_url
                    )
            else:
                hours_worked = result.get('entry', {}).get('hoursWorked', '?')
                print(f"✓ AUSGESTEMPELT: {name}")
                print(f"  Arbeitszeit heute: {hours_worked} Stunden")
                display.show(f"Ausgestempelt", f"{name} ({hours_worked}h)", duration=1)
                if hdmi_display:
                    hdmi_display.show_scan_result(
                        success=True,
                        name=name,
                        action='clock_out',
                        hours=hours_worked,
                        photo_url=photo_url
                    )
    else:
        error = result.get('error', 'Unbekannter Fehler')
        message = result.get('message', '')
        print(f"✗ FEHLER: {error}")
        if message:
            print(f"  {message}")
        display.show("FEHLER", error[:16], duration=1)
        if hdmi_display:
            hdmi_display.show_scan_result(
                success=False,
                name=None,
                action=None,
                error=error
            )

    # Queue-Status anzeigen
    queue_status = api.get_queue_status()
    if queue_status['pending_count'] > 0:
        print(f"  [Queue: {queue_status['pending_count']} ausstehend]")

    print(f"{'='*50}\n")


def main():
    print("=" * 60)
    print("  Zeiterfassung RFID Terminal")
    print("=" * 60)
    print()

    # Konfiguration laden
    config = load_config()
    print(f"Backend-URL: {config['backend_url']}")

    # Offline-Queue initialisieren
    print("Initialisiere Offline-Queue...")
    offline_queue = init_queue()
    offline_queue.start_sync_thread()

    # API-Client initialisieren
    api = ZeiterfassungAPI(config['backend_url'], config['api_key'])
    api.set_offline_queue(offline_queue)

    # Verbindung prüfen + initialen Cache laden
    print("Prüfe Backend-Verbindung...")
    if api.health_check():
        print("✓ Backend erreichbar")
        offline_queue.set_online_status(True)
        print("Lade Mitarbeiterdaten in Cache...")
        api.preload_cache()
    else:
        print("✗ WARNUNG: Backend nicht erreichbar!")
        print("  Terminal läuft im OFFLINE-MODUS")
        print("  Stempelungen werden lokal gespeichert und später synchronisiert")
        cached_count = len(api.employee_cache.cache)
        if cached_count > 0:
            print(f"  {cached_count} Mitarbeiter aus Cache verfügbar")
        offline_queue.set_online_status(False)

    # Health-Check + Cache-Refresh Thread starten (alle 15s prüfen, Cache alle 5min)
    api.start_health_check_loop(interval=15, cache_interval=300)

    # Display initialisieren
    display = Display(enabled=config.get('display_enabled', False))

    # RFID-Reader finden
    print("\nSuche RFID-Reader...")
    device = find_rfid_reader()

    if not device:
        print("\nFEHLER: Kein RFID Reader gefunden!")
        print("Bitte stellen Sie sicher, dass:")
        print("  1. Der USB RFID Reader angeschlossen ist")
        print("  2. Der Benutzer in der 'input' Gruppe ist")
        print("     (sudo usermod -a -G input $USER && logout)")
        sys.exit(1)

    print(f"\n✓ RFID Reader gefunden: {device.name}")
    print(f"  Pfad: {device.path}")
    print()
    print("-" * 60)
    print("  Bereit! Bitte RFID-Karte vorhalten...")
    print("-" * 60)
    display.show("Bereit", "Karte vorhalten")

    card_id = ""
    grabbed = False

    # Exklusiver Zugriff auf das Gerät
    try:
        device.grab()
        grabbed = True
    except IOError as e:
        print(f"WARNUNG: Konnte Gerät nicht exklusiv öffnen: {e}")

    try:
        for event in device.read_loop():
            if event.type == ecodes.EV_KEY and event.value == 1:  # Key down
                if event.code == ecodes.KEY_ENTER:
                    if card_id:
                        # Validiere Karten-ID
                        if not is_valid_card(card_id):
                            print(f"  Ungültige Karte ignoriert: {card_id}")
                            card_id = ""
                            continue

                        # Prüfe Cooldown (Anti-Spam für gleiche Karte)
                        if not check_cooldown(card_id):
                            print(f"  Karte {card_id} - bitte kurz warten...")
                            display.show("Bitte warten", "Karte entfernen", duration=1)
                            card_id = ""
                            continue

                        # Karte verarbeiten
                        process_card(card_id, api, display)
                        display.show("Bereit", "Karte vorhalten")

                    card_id = ""
                elif event.code in SCANCODES:
                    card_id += SCANCODES[event.code]

    except KeyboardInterrupt:
        print("\n\nTerminal wird beendet...")
    except Exception as e:
        print(f"Fehler: {e}")
        import traceback
        traceback.print_exc()
    finally:
        if grabbed:
            try:
                device.ungrab()
            except:
                pass


if __name__ == '__main__':
    main()
