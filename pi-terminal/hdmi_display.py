#!/usr/bin/env python3
"""
Zeiterfassung HDMI Display
Fullscreen-Anzeige für Raspberry Pi mit HDMI-Monitor
"""

import os
import sys
import json
import threading
import time
from datetime import datetime
from pathlib import Path

# SDL für Raspberry Pi konfigurieren
os.environ['SDL_VIDEODRIVER'] = 'x11'

import pygame
import socketio

# Farben
COLORS = {
    'background': (20, 25, 35),
    'card_bg': (35, 42, 55),
    'card_border': (55, 65, 80),
    'primary': (66, 133, 244),
    'success': (52, 168, 83),
    'error': (234, 67, 53),
    'warning': (251, 188, 4),
    'text_white': (255, 255, 255),
    'text_gray': (156, 163, 175),
    'text_dim': (107, 114, 128),
    'clock_in': (52, 168, 83),
    'clock_out': (66, 133, 244),
}

# Konfiguration
DISPLAY_WIDTH = 1920
DISPLAY_HEIGHT = 1080
FULLSCREEN = True
MAX_ACTIVITY_ENTRIES = 8
MAX_ACTIVE_EMPLOYEES = 12


class HDMIDisplay:
    def __init__(self, backend_url):
        self.backend_url = backend_url
        self.running = True

        # Daten
        self.active_employees = []
        self.activity_log = []
        self.last_scan = None
        self.last_scan_time = 0
        self.connection_status = "Verbinde..."

        # Pygame initialisieren
        pygame.init()

        # Display einrichten
        try:
            if FULLSCREEN:
                self.screen = pygame.display.set_mode((0, 0), pygame.FULLSCREEN)
                info = pygame.display.Info()
                self.width = info.current_w
                self.height = info.current_h
            else:
                self.width = DISPLAY_WIDTH
                self.height = DISPLAY_HEIGHT
                self.screen = pygame.display.set_mode((self.width, self.height))

            pygame.display.set_caption("Zeiterfassung Terminal")
            pygame.mouse.set_visible(False)
        except pygame.error as e:
            print(f"Display-Fehler: {e}")
            print("Versuche Fallback-Modus...")
            # Fallback: Dummy-Display für headless Betrieb
            os.environ['SDL_VIDEODRIVER'] = 'dummy'
            pygame.display.quit()
            pygame.display.init()
            self.width = DISPLAY_WIDTH
            self.height = DISPLAY_HEIGHT
            self.screen = pygame.display.set_mode((self.width, self.height))

        # Fonts laden
        self._load_fonts()

        # Socket.IO Client
        self.sio = socketio.Client(reconnection=True, reconnection_attempts=0)
        self._setup_socket_events()

        # Hintergrund-Thread für Socket.IO
        self.socket_thread = threading.Thread(target=self._connect_socket, daemon=True)
        self.socket_thread.start()

        # Initiale Daten laden
        self.data_thread = threading.Thread(target=self._load_initial_data, daemon=True)
        self.data_thread.start()

    def _load_fonts(self):
        """Lädt die Schriftarten"""
        # Versuche moderne Schriftart zu laden
        font_paths = [
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
            "/usr/share/fonts/truetype/freefont/FreeSans.ttf",
        ]

        font_path = None
        for path in font_paths:
            if os.path.exists(path):
                font_path = path
                break

        bold_paths = [
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
            "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf",
        ]

        bold_path = None
        for path in bold_paths:
            if os.path.exists(path):
                bold_path = path
                break

        if font_path:
            self.font_clock = pygame.font.Font(bold_path or font_path, 120)
            self.font_date = pygame.font.Font(font_path, 36)
            self.font_title = pygame.font.Font(bold_path or font_path, 32)
            self.font_name = pygame.font.Font(bold_path or font_path, 28)
            self.font_info = pygame.font.Font(font_path, 22)
            self.font_small = pygame.font.Font(font_path, 18)
            self.font_scan = pygame.font.Font(bold_path or font_path, 48)
        else:
            # Fallback auf Pygame-Standard
            self.font_clock = pygame.font.Font(None, 120)
            self.font_date = pygame.font.Font(None, 36)
            self.font_title = pygame.font.Font(None, 32)
            self.font_name = pygame.font.Font(None, 28)
            self.font_info = pygame.font.Font(None, 22)
            self.font_small = pygame.font.Font(None, 18)
            self.font_scan = pygame.font.Font(None, 48)

    def _setup_socket_events(self):
        """Richtet Socket.IO Event-Handler ein"""
        @self.sio.event
        def connect():
            self.connection_status = "Verbunden"
            print("Socket.IO verbunden")

        @self.sio.event
        def disconnect():
            self.connection_status = "Getrennt"
            print("Socket.IO getrennt")

        @self.sio.event
        def connect_error(data):
            self.connection_status = "Verbindungsfehler"
            print(f"Socket.IO Fehler: {data}")

        @self.sio.on('time-entry-updated')
        def on_time_entry(data):
            """Wird aufgerufen wenn jemand ein-/ausstempelt"""
            print(f"Time entry update: {data}")
            self._handle_time_entry(data)

    def _connect_socket(self):
        """Verbindet mit dem Backend Socket.IO"""
        while self.running:
            try:
                if not self.sio.connected:
                    self.sio.connect(self.backend_url, transports=['websocket', 'polling'])
                time.sleep(1)
            except Exception as e:
                self.connection_status = f"Fehler: {str(e)[:20]}"
                print(f"Socket Verbindungsfehler: {e}")
                time.sleep(5)

    def _load_initial_data(self):
        """Lädt initiale Daten vom Backend"""
        import requests

        time.sleep(2)  # Warte kurz auf Initialisierung

        while self.running:
            try:
                # Lade aktive Mitarbeiter
                response = requests.get(
                    f"{self.backend_url}/api/terminal/active",
                    headers={'X-Terminal-API-Key': self._get_api_key()},
                    timeout=5
                )
                if response.status_code == 200:
                    self.active_employees = response.json()
            except Exception as e:
                print(f"Fehler beim Laden der Daten: {e}")

            time.sleep(30)  # Alle 30 Sekunden aktualisieren

    def _get_api_key(self):
        """Liest den API-Key aus der Config"""
        try:
            config_path = Path(__file__).parent / 'config.json'
            with open(config_path, 'r') as f:
                config = json.load(f)
                return config.get('api_key', '')
        except:
            return ''

    def _handle_time_entry(self, data):
        """Verarbeitet ein Time-Entry Update"""
        # Daten aus Backend-Event extrahieren
        employee = data.get('employee', {})
        entry_data = data.get('entry', {})
        action_type = data.get('type', 'clock_in')  # 'clock_in' oder 'clock_out'

        # Stunden berechnen falls Ausstempeln
        hours = None
        if action_type == 'clock_out' and entry_data.get('clockIn') and entry_data.get('clockOut'):
            try:
                clock_in = datetime.fromisoformat(entry_data['clockIn'].replace('Z', '+00:00'))
                clock_out = datetime.fromisoformat(entry_data['clockOut'].replace('Z', '+00:00'))
                diff = clock_out - clock_in
                hours = f"{diff.seconds // 3600}:{(diff.seconds % 3600) // 60:02d}"
            except:
                pass

        entry = {
            'name': employee.get('name', 'Unbekannt'),
            'action': action_type,
            'time': datetime.now(),
            'hours': hours,
            'success': True,
        }

        # Zur Activity-Log hinzufügen
        self.activity_log.insert(0, entry)
        self.activity_log = self.activity_log[:MAX_ACTIVITY_ENTRIES]

        # Letzten Scan merken für Animation
        self.last_scan = entry
        self.last_scan_time = time.time()

        # Aktive Mitarbeiter aktualisieren
        if action_type == 'clock_in':
            # Hinzufügen falls nicht vorhanden
            if not any(e.get('employeeName') == entry['name'] for e in self.active_employees):
                self.active_employees.insert(0, {
                    'employeeName': entry['name'],
                    'clockIn': datetime.now().isoformat()
                })
        else:
            # Entfernen
            self.active_employees = [
                e for e in self.active_employees
                if e.get('employeeName') != entry['name']
            ]

    def show_scan_result(self, success, name, action, hours=None, error=None):
        """Zeigt das Ergebnis eines Scans an (von terminal.py aufgerufen)"""
        entry = {
            'name': name or 'Unbekannt',
            'action': action,
            'time': datetime.now(),
            'hours': hours,
            'success': success,
            'error': error,
        }

        self.activity_log.insert(0, entry)
        self.activity_log = self.activity_log[:MAX_ACTIVITY_ENTRIES]

        self.last_scan = entry
        self.last_scan_time = time.time()

        # Aktive Mitarbeiter aktualisieren
        if success and name:
            if action == 'clock_in':
                if not any(e.get('employeeName') == name for e in self.active_employees):
                    self.active_employees.insert(0, {
                        'employeeName': name,
                        'clockIn': datetime.now().isoformat()
                    })
            elif action == 'clock_out':
                self.active_employees = [
                    e for e in self.active_employees
                    if e.get('employeeName') != name
                ]

    def _draw_rounded_rect(self, surface, rect, color, radius=15, border_color=None, border_width=0):
        """Zeichnet ein abgerundetes Rechteck"""
        x, y, w, h = rect

        # Hauptfläche
        pygame.draw.rect(surface, color, (x + radius, y, w - 2*radius, h))
        pygame.draw.rect(surface, color, (x, y + radius, w, h - 2*radius))
        pygame.draw.circle(surface, color, (x + radius, y + radius), radius)
        pygame.draw.circle(surface, color, (x + w - radius, y + radius), radius)
        pygame.draw.circle(surface, color, (x + radius, y + h - radius), radius)
        pygame.draw.circle(surface, color, (x + w - radius, y + h - radius), radius)

        # Rand
        if border_color and border_width > 0:
            pygame.draw.rect(surface, border_color, (x + radius, y, w - 2*radius, border_width))
            pygame.draw.rect(surface, border_color, (x + radius, y + h - border_width, w - 2*radius, border_width))
            pygame.draw.rect(surface, border_color, (x, y + radius, border_width, h - 2*radius))
            pygame.draw.rect(surface, border_color, (x + w - border_width, y + radius, border_width, h - 2*radius))

    def _draw_clock(self):
        """Zeichnet die Uhrzeit und Datum"""
        now = datetime.now()

        # Uhrzeit
        time_str = now.strftime("%H:%M:%S")
        time_surface = self.font_clock.render(time_str, True, COLORS['text_white'])
        time_rect = time_surface.get_rect(centerx=self.width // 2, top=40)
        self.screen.blit(time_surface, time_rect)

        # Datum
        weekdays = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag']
        months = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
                  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']

        date_str = f"{weekdays[now.weekday()]}, {now.day}. {months[now.month-1]} {now.year}"
        date_surface = self.font_date.render(date_str, True, COLORS['text_gray'])
        date_rect = date_surface.get_rect(centerx=self.width // 2, top=time_rect.bottom + 10)
        self.screen.blit(date_surface, date_rect)

        return date_rect.bottom

    def _draw_scan_feedback(self, y_start):
        """Zeichnet das Feedback für den letzten Scan"""
        # Animation für 5 Sekunden nach Scan
        if not self.last_scan or time.time() - self.last_scan_time > 5:
            return y_start

        scan = self.last_scan
        elapsed = time.time() - self.last_scan_time

        # Fade-out Effekt
        alpha = max(0, min(255, int(255 * (1 - elapsed / 5))))

        # Hintergrund-Karte
        card_width = 700
        card_height = 120
        card_x = (self.width - card_width) // 2
        card_y = y_start + 30

        # Farbe basierend auf Aktion
        if scan.get('error') or not scan.get('success', True):
            bg_color = (*COLORS['error'][:3], alpha)
            icon = "✗"
            text = scan.get('error', 'Fehler')
        elif scan.get('action') == 'clock_in':
            bg_color = (*COLORS['clock_in'][:3], alpha)
            icon = "→"
            text = f"{scan['name']} eingestempelt"
        else:
            bg_color = (*COLORS['clock_out'][:3], alpha)
            icon = "←"
            hours = scan.get('hours', '')
            text = f"{scan['name']} ausgestempelt"
            if hours:
                text += f" ({hours}h)"

        # Zeichne Karte mit Alpha
        card_surface = pygame.Surface((card_width, card_height), pygame.SRCALPHA)
        pygame.draw.rect(card_surface, bg_color, (0, 0, card_width, card_height), border_radius=20)
        self.screen.blit(card_surface, (card_x, card_y))

        # Icon
        icon_surface = self.font_scan.render(icon, True, (*COLORS['text_white'][:3], alpha))
        self.screen.blit(icon_surface, (card_x + 30, card_y + 35))

        # Text
        text_color = (*COLORS['text_white'][:3],)
        text_surface = self.font_scan.render(text, True, text_color)
        text_rect = text_surface.get_rect(centery=card_y + card_height//2, left=card_x + 100)
        self.screen.blit(text_surface, text_rect)

        return card_y + card_height

    def _draw_active_employees(self, x, y, width, height):
        """Zeichnet die Liste der eingestempelten Mitarbeiter"""
        # Titel
        title = self.font_title.render("Anwesend", True, COLORS['text_white'])
        self.screen.blit(title, (x + 20, y + 15))

        # Anzahl
        count_text = f"{len(self.active_employees)} Mitarbeiter"
        count_surface = self.font_small.render(count_text, True, COLORS['text_gray'])
        self.screen.blit(count_surface, (x + width - count_surface.get_width() - 20, y + 22))

        # Liste
        list_y = y + 60
        item_height = 50

        for i, emp in enumerate(self.active_employees[:MAX_ACTIVE_EMPLOYEES]):
            if list_y + item_height > y + height - 10:
                break

            # Name
            name = emp.get('employeeName', emp.get('employeeNumber', 'Unbekannt'))
            name_surface = self.font_name.render(name, True, COLORS['text_white'])
            self.screen.blit(name_surface, (x + 20, list_y + 8))

            # Zeit
            try:
                clock_in = emp.get('clockIn', '')
                if isinstance(clock_in, str) and clock_in:
                    dt = datetime.fromisoformat(clock_in.replace('Z', '+00:00'))
                    time_str = dt.strftime("%H:%M")
                else:
                    time_str = "--:--"
            except:
                time_str = "--:--"

            time_surface = self.font_info.render(f"seit {time_str}", True, COLORS['text_dim'])
            self.screen.blit(time_surface, (x + 20, list_y + 32))

            # Trennlinie
            pygame.draw.line(
                self.screen, COLORS['card_border'],
                (x + 20, list_y + item_height - 1),
                (x + width - 20, list_y + item_height - 1)
            )

            list_y += item_height

        # "Mehr..." anzeigen wenn nötig
        if len(self.active_employees) > MAX_ACTIVE_EMPLOYEES:
            more = f"+{len(self.active_employees) - MAX_ACTIVE_EMPLOYEES} weitere"
            more_surface = self.font_small.render(more, True, COLORS['text_dim'])
            self.screen.blit(more_surface, (x + 20, list_y + 5))

    def _draw_activity_log(self, x, y, width, height):
        """Zeichnet die Aktivitäts-Historie"""
        # Titel
        title = self.font_title.render("Letzte Aktivitäten", True, COLORS['text_white'])
        self.screen.blit(title, (x + 20, y + 15))

        # Liste
        list_y = y + 60
        item_height = 65

        for entry in self.activity_log:
            if list_y + item_height > y + height - 10:
                break

            # Zeitstempel
            try:
                time_str = entry['time'].strftime("%H:%M")
            except:
                time_str = "--:--"

            # Aktion
            if entry.get('error') or not entry.get('success', True):
                action_color = COLORS['error']
                action_text = "Fehler"
            elif entry.get('action') == 'clock_in':
                action_color = COLORS['clock_in']
                action_text = "Eingestempelt"
            else:
                action_color = COLORS['clock_out']
                action_text = "Ausgestempelt"

            # Zeit-Badge
            time_surface = self.font_info.render(time_str, True, COLORS['text_gray'])
            self.screen.blit(time_surface, (x + 20, list_y + 5))

            # Aktions-Indikator
            pygame.draw.circle(self.screen, action_color, (x + 90, list_y + 15), 6)

            # Name
            name = entry.get('name', 'Unbekannt')
            name_surface = self.font_name.render(name, True, COLORS['text_white'])
            self.screen.blit(name_surface, (x + 110, list_y + 3))

            # Aktion + Stunden
            action_str = action_text
            if entry.get('hours'):
                action_str += f" • {entry['hours']}h gearbeitet"
            action_surface = self.font_info.render(action_str, True, action_color)
            self.screen.blit(action_surface, (x + 110, list_y + 32))

            # Trennlinie
            pygame.draw.line(
                self.screen, COLORS['card_border'],
                (x + 20, list_y + item_height - 1),
                (x + width - 20, list_y + item_height - 1)
            )

            list_y += item_height

        # Placeholder wenn leer
        if not self.activity_log:
            empty_text = "Noch keine Aktivitäten heute"
            empty_surface = self.font_info.render(empty_text, True, COLORS['text_dim'])
            self.screen.blit(empty_surface, (x + 20, list_y + 20))

    def _draw_status_bar(self):
        """Zeichnet die Statusleiste unten"""
        bar_height = 40
        bar_y = self.height - bar_height

        pygame.draw.rect(self.screen, COLORS['card_bg'], (0, bar_y, self.width, bar_height))

        # Verbindungsstatus
        if "Verbunden" in self.connection_status:
            status_color = COLORS['success']
        elif "Fehler" in self.connection_status or "Getrennt" in self.connection_status:
            status_color = COLORS['error']
        else:
            status_color = COLORS['warning']

        pygame.draw.circle(self.screen, status_color, (20, bar_y + bar_height // 2), 6)

        status_surface = self.font_small.render(self.connection_status, True, COLORS['text_gray'])
        self.screen.blit(status_surface, (35, bar_y + 10))

        # Hinweis
        hint = "Bitte RFID-Karte vorhalten"
        hint_surface = self.font_small.render(hint, True, COLORS['text_dim'])
        hint_rect = hint_surface.get_rect(centerx=self.width // 2, centery=bar_y + bar_height // 2)
        self.screen.blit(hint_surface, hint_rect)

        # Version
        version = "Zeiterfassung Terminal v1.0"
        version_surface = self.font_small.render(version, True, COLORS['text_dim'])
        self.screen.blit(version_surface, (self.width - version_surface.get_width() - 20, bar_y + 10))

    def draw(self):
        """Zeichnet den gesamten Bildschirm"""
        # Hintergrund
        self.screen.fill(COLORS['background'])

        # Uhr und Datum
        clock_bottom = self._draw_clock()

        # Scan-Feedback (falls kürzlich gescannt)
        content_top = self._draw_scan_feedback(clock_bottom)
        if content_top == clock_bottom:
            content_top = clock_bottom + 40
        else:
            content_top += 20

        # Layout berechnen
        margin = 30
        gap = 20
        content_height = self.height - content_top - 60  # 60 für Statusbar

        # Linke Spalte: Aktive Mitarbeiter (40%)
        left_width = int((self.width - 2*margin - gap) * 0.4)
        left_x = margin

        # Rechte Spalte: Activity Log (60%)
        right_width = self.width - left_width - 2*margin - gap
        right_x = left_x + left_width + gap

        # Karten zeichnen
        self._draw_rounded_rect(
            self.screen,
            (left_x, content_top, left_width, content_height),
            COLORS['card_bg'],
            radius=20
        )
        self._draw_active_employees(left_x, content_top, left_width, content_height)

        self._draw_rounded_rect(
            self.screen,
            (right_x, content_top, right_width, content_height),
            COLORS['card_bg'],
            radius=20
        )
        self._draw_activity_log(right_x, content_top, right_width, content_height)

        # Statusleiste
        self._draw_status_bar()

        # Display aktualisieren
        pygame.display.flip()

    def run(self):
        """Hauptschleife"""
        clock = pygame.time.Clock()

        try:
            while self.running:
                for event in pygame.event.get():
                    if event.type == pygame.QUIT:
                        self.running = False
                    elif event.type == pygame.KEYDOWN:
                        if event.key == pygame.K_ESCAPE:
                            self.running = False
                        elif event.key == pygame.K_q:
                            self.running = False

                self.draw()
                clock.tick(30)  # 30 FPS

        finally:
            self.running = False
            if self.sio.connected:
                self.sio.disconnect()
            pygame.quit()


def main():
    # Config laden
    config_path = Path(__file__).parent / 'config.json'

    if not config_path.exists():
        print("FEHLER: config.json nicht gefunden!")
        sys.exit(1)

    with open(config_path, 'r') as f:
        config = json.load(f)

    backend_url = config.get('backend_url', 'http://localhost:3004')

    print("=" * 60)
    print("  Zeiterfassung HDMI Display")
    print("=" * 60)
    print(f"Backend: {backend_url}")
    print("Drücke ESC oder Q zum Beenden")
    print()

    display = HDMIDisplay(backend_url)
    display.run()


if __name__ == '__main__':
    main()
