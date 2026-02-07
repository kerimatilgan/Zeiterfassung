#!/usr/bin/env python3
"""
Zeiterfassung HDMI Display
Optimiert für 7-10" Monitore am Raspberry Pi
"""

import os
import sys
import json
import math
import threading
import time
import requests
import hashlib
import subprocess
from datetime import datetime
from pathlib import Path
from io import BytesIO

# PIL für EXIF-Orientierung
try:
    from PIL import Image
    from PIL.ExifTags import TAGS
    PIL_AVAILABLE = True
except ImportError:
    PIL_AVAILABLE = False
    print("[PHOTO] PIL nicht verfügbar - EXIF-Orientierung wird ignoriert")

# SDL für Raspberry Pi konfigurieren
os.environ['SDL_VIDEODRIVER'] = 'x11'

import pygame
import socketio

# Farben - Modernes dunkles Design
COLORS = {
    'background': (15, 23, 42),        # Tiefes Dunkelblau
    'background_light': (30, 41, 59),   # Etwas helleres Blau für Gradient
    'card_bg': (30, 41, 59),            # Karten-Hintergrund
    'card_bg_hover': (51, 65, 85),      # Hover-Effekt
    'card_border': (71, 85, 105),       # Subtiler Rand
    'primary': (59, 130, 246),          # Modernes Blau
    'primary_light': (96, 165, 250),    # Helleres Blau
    'success': (34, 197, 94),           # Frisches Grün
    'success_dark': (22, 163, 74),      # Dunkleres Grün
    'error': (239, 68, 68),             # Warmes Rot
    'warning': (250, 204, 21),          # Leuchtendes Gelb
    'text_white': (248, 250, 252),      # Fast-Weiß
    'text_gray': (148, 163, 184),       # Mittleres Grau
    'text_dim': (100, 116, 139),        # Gedämpftes Grau
    'clock_in': (34, 197, 94),          # Eingestempelt = Grün
    'clock_out': (59, 130, 246),        # Ausgestempelt = Blau
    'accent': (139, 92, 246),           # Akzent-Violett
    'overlay_green': (10, 60, 30),      # Dunkler Grün-Overlay
    'overlay_blue': (10, 30, 60),       # Dunkler Blau-Overlay
    'overlay_red': (60, 15, 15),        # Dunkler Rot-Overlay
}

# Konfiguration
DISPLAY_WIDTH = 1024
DISPLAY_HEIGHT = 600
FULLSCREEN = True
SCAN_DISPLAY_SECONDS = 5
MAX_ACTIVE_EMPLOYEES = 8


def get_eth0_ip():
    """Liest die IPv4-Adresse von eth0 aus"""
    try:
        result = subprocess.run(
            ['ip', '-4', 'addr', 'show', 'eth0'],
            capture_output=True, text=True, timeout=3
        )
        for line in result.stdout.split('\n'):
            line = line.strip()
            if line.startswith('inet '):
                # Format: "inet 10.8.0.2/24 ..."
                return line.split()[1].split('/')[0]
    except Exception:
        pass
    return None


class HDMIDisplay:
    def __init__(self, backend_url):
        self.backend_url = backend_url
        self.running = True

        # Daten
        self.active_employees = []
        self.last_scan = None
        self.last_scan_time = 0
        self.connection_status = "Verbinde..."
        self.eth0_ip = get_eth0_ip()

        # Performance-Optimierung: Caching
        self._cached_background = None
        self._cached_overlay_green = None
        self._cached_overlay_blue = None
        self._cached_overlay_red = None
        self._cached_glow = {}
        self._cached_photos = {}
        self._photo_cache_dir = Path(__file__).parent / '.photo_cache'
        self._photo_cache_dir.mkdir(exist_ok=True)
        self._last_second = -1
        self._needs_full_redraw = True
        self._last_data_hash = None

        # IP-Refresh alle 60 Sekunden
        self._last_ip_check = 0

        # Pygame initialisieren
        pygame.init()

        # Display einrichten
        try:
            if FULLSCREEN:
                self.screen = pygame.display.set_mode(
                    (0, 0),
                    pygame.FULLSCREEN | pygame.HWSURFACE | pygame.DOUBLEBUF
                )
                info = pygame.display.Info()
                self.width = info.current_w
                self.height = info.current_h
            else:
                self.width = DISPLAY_WIDTH
                self.height = DISPLAY_HEIGHT
                self.screen = pygame.display.set_mode(
                    (self.width, self.height),
                    pygame.HWSURFACE | pygame.DOUBLEBUF
                )

            pygame.display.set_caption("Zeiterfassung Terminal")
            pygame.mouse.set_visible(False)
        except pygame.error as e:
            print(f"Display-Fehler: {e}")
            print("Versuche Fallback-Modus...")
            os.environ['SDL_VIDEODRIVER'] = 'dummy'
            pygame.display.quit()
            pygame.display.init()
            self.width = DISPLAY_WIDTH
            self.height = DISPLAY_HEIGHT
            self.screen = pygame.display.set_mode((self.width, self.height))

        print(f"[DISPLAY] Auflösung: {self.width}x{self.height}")

        # Fonts laden (skaliert für Display-Größe)
        self._load_fonts()

        # Hintergründe vorrendern
        self._render_cached_background()
        self._render_cached_overlays()

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
        """Lädt Schriftarten skaliert für die aktuelle Auflösung"""
        # Skalierungsfaktor basierend auf Höhe (600px Referenz)
        scale = self.height / 600.0

        font_paths = [
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
            "/usr/share/fonts/truetype/freefont/FreeSans.ttf",
        ]
        bold_paths = [
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
            "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf",
        ]

        font_path = next((p for p in font_paths if os.path.exists(p)), None)
        bold_path = next((p for p in bold_paths if os.path.exists(p)), None)

        def sz(base):
            return max(12, int(base * scale))

        if font_path:
            self.font_clock = pygame.font.Font(bold_path or font_path, sz(90))
            self.font_date = pygame.font.Font(font_path, sz(24))
            self.font_title = pygame.font.Font(bold_path or font_path, sz(24))
            self.font_name = pygame.font.Font(bold_path or font_path, sz(22))
            self.font_info = pygame.font.Font(font_path, sz(18))
            self.font_small = pygame.font.Font(font_path, sz(15))
            self.font_status = pygame.font.Font(bold_path or font_path, sz(20))
            # Fullscreen-Overlay Fonts
            self.font_overlay_name = pygame.font.Font(bold_path or font_path, sz(52))
            self.font_overlay_action = pygame.font.Font(bold_path or font_path, sz(42))
            self.font_overlay_detail = pygame.font.Font(font_path, sz(26))
        else:
            self.font_clock = pygame.font.Font(None, sz(90))
            self.font_date = pygame.font.Font(None, sz(24))
            self.font_title = pygame.font.Font(None, sz(24))
            self.font_name = pygame.font.Font(None, sz(22))
            self.font_info = pygame.font.Font(None, sz(18))
            self.font_small = pygame.font.Font(None, sz(15))
            self.font_status = pygame.font.Font(None, sz(20))
            self.font_overlay_name = pygame.font.Font(None, sz(52))
            self.font_overlay_action = pygame.font.Font(None, sz(42))
            self.font_overlay_detail = pygame.font.Font(None, sz(26))

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
        time.sleep(2)

        while self.running:
            try:
                response = requests.get(
                    f"{self.backend_url}/api/terminal/active",
                    headers={'X-Terminal-API-Key': self._get_api_key()},
                    timeout=5
                )
                if response.status_code == 200:
                    self.active_employees = response.json()
            except Exception as e:
                print(f"Fehler beim Laden der Daten: {e}")

            time.sleep(30)

    def _get_api_key(self):
        """Liest den API-Key aus der Config"""
        try:
            config_path = Path(__file__).parent / 'config.json'
            with open(config_path, 'r') as f:
                config = json.load(f)
                return config.get('api_key', '')
        except Exception:
            return ''

    def _load_photo(self, photo_url, size=(200, 200)):
        """Lädt und cached ein Mitarbeiterfoto mit EXIF-Orientierungskorrektur"""
        if not photo_url:
            return None

        cache_key = hashlib.md5(f"{photo_url}_{size}".encode()).hexdigest()

        if cache_key in self._cached_photos:
            return self._cached_photos[cache_key]

        cache_file = self._photo_cache_dir / f"{cache_key}.png"
        if cache_file.exists():
            try:
                photo_surface = pygame.image.load(str(cache_file))
                self._cached_photos[cache_key] = photo_surface
                return photo_surface
            except Exception as e:
                print(f"[PHOTO] Cache-Ladefehler: {e}")

        try:
            full_url = f"{self.backend_url}{photo_url}"
            print(f"[PHOTO] Lade Foto: {full_url}")

            response = requests.get(full_url, timeout=5)
            if response.status_code == 200:
                image_data = BytesIO(response.content)

                if PIL_AVAILABLE:
                    pil_image = Image.open(image_data)

                    try:
                        exif = pil_image._getexif()
                        if exif:
                            for tag_id, value in exif.items():
                                tag = TAGS.get(tag_id, tag_id)
                                if tag == 'Orientation':
                                    if value == 3:
                                        pil_image = pil_image.rotate(180, expand=True)
                                    elif value == 6:
                                        pil_image = pil_image.rotate(270, expand=True)
                                    elif value == 8:
                                        pil_image = pil_image.rotate(90, expand=True)
                                    break
                    except (AttributeError, KeyError, IndexError):
                        pass

                    if pil_image.mode != 'RGB':
                        pil_image = pil_image.convert('RGB')

                    width, height = pil_image.size
                    min_dim = min(width, height)
                    left = (width - min_dim) // 2
                    top = (height - min_dim) // 2
                    pil_image = pil_image.crop((left, top, left + min_dim, top + min_dim))
                    pil_image = pil_image.resize(size, Image.LANCZOS)

                    image_str = pil_image.tobytes()
                    photo_surface = pygame.image.fromstring(image_str, size, 'RGB')
                else:
                    photo_surface = pygame.image.load(image_data)
                    photo_surface = pygame.transform.smoothscale(photo_surface, size)

                pygame.image.save(photo_surface, str(cache_file))
                self._cached_photos[cache_key] = photo_surface
                print(f"[PHOTO] Foto geladen und gecached ({size[0]}x{size[1]})")
                return photo_surface
        except Exception as e:
            print(f"[PHOTO] Ladefehler: {e}")

        return None

    def _draw_circular_photo(self, surface, photo, center_x, center_y, radius):
        """Zeichnet ein rundes Foto mit Rand"""
        if not photo:
            return

        mask = pygame.Surface((radius * 2, radius * 2), pygame.SRCALPHA)
        pygame.draw.circle(mask, (255, 255, 255, 255), (radius, radius), radius)

        photo_scaled = pygame.transform.smoothscale(photo, (radius * 2, radius * 2))
        photo_masked = pygame.Surface((radius * 2, radius * 2), pygame.SRCALPHA)
        photo_masked.blit(photo_scaled, (0, 0))
        photo_masked.blit(mask, (0, 0), special_flags=pygame.BLEND_RGBA_MIN)

        pygame.draw.circle(surface, COLORS['text_white'], (center_x, center_y), radius + 3, 3)
        surface.blit(photo_masked, (center_x - radius, center_y - radius))

    def _handle_time_entry(self, data):
        """Verarbeitet ein Time-Entry Update"""
        employee = data.get('employee', {})
        entry_data = data.get('entry', {})
        action_type = data.get('type', 'clock_in')

        hours = None
        if action_type == 'clock_out' and entry_data.get('clockIn') and entry_data.get('clockOut'):
            try:
                clock_in = datetime.fromisoformat(entry_data['clockIn'].replace('Z', '+00:00'))
                clock_out = datetime.fromisoformat(entry_data['clockOut'].replace('Z', '+00:00'))
                diff = clock_out - clock_in
                total_seconds = int(diff.total_seconds())
                hours = f"{total_seconds // 3600}:{(total_seconds % 3600) // 60:02d}"
            except Exception:
                pass

        photo_url = employee.get('photoUrl')
        photo = None
        if photo_url:
            photo = self._load_photo(photo_url, size=(200, 200))

        entry = {
            'name': employee.get('name', 'Unbekannt'),
            'action': action_type,
            'time': datetime.now(),
            'hours': hours,
            'success': True,
            'photo_url': photo_url,
            'photo': photo,
        }

        self.last_scan = entry
        self.last_scan_time = time.time()

        # Aktive Mitarbeiter aktualisieren
        if action_type == 'clock_in':
            if not any(e.get('employeeName') == entry['name'] for e in self.active_employees):
                self.active_employees.insert(0, {
                    'employeeName': entry['name'],
                    'clockIn': datetime.now().isoformat(),
                    'photoUrl': photo_url
                })
        else:
            self.active_employees = [
                e for e in self.active_employees
                if e.get('employeeName') != entry['name']
            ]

    def show_scan_result(self, success, name, action, hours=None, error=None, photo_url=None):
        """Zeigt das Ergebnis eines Scans an (von terminal.py aufgerufen)"""
        photo = None
        if photo_url:
            photo = self._load_photo(photo_url, size=(200, 200))

        entry = {
            'name': name or 'Unbekannt',
            'action': action,
            'time': datetime.now(),
            'hours': hours,
            'success': success,
            'error': error,
            'photo_url': photo_url,
            'photo': photo,
        }

        self.last_scan = entry
        self.last_scan_time = time.time()

        if success and name:
            if action == 'clock_in':
                if not any(e.get('employeeName') == name for e in self.active_employees):
                    self.active_employees.insert(0, {
                        'employeeName': name,
                        'clockIn': datetime.now().isoformat(),
                        'photoUrl': photo_url
                    })
            elif action == 'clock_out':
                self.active_employees = [
                    e for e in self.active_employees
                    if e.get('employeeName') != name
                ]

    def _draw_rounded_rect(self, surface, rect, color, radius=15, border_color=None, border_width=0):
        """Zeichnet ein abgerundetes Rechteck"""
        x, y, w, h = rect
        pygame.draw.rect(surface, color, (x + radius, y, w - 2*radius, h))
        pygame.draw.rect(surface, color, (x, y + radius, w, h - 2*radius))
        pygame.draw.circle(surface, color, (x + radius, y + radius), radius)
        pygame.draw.circle(surface, color, (x + w - radius, y + radius), radius)
        pygame.draw.circle(surface, color, (x + radius, y + h - radius), radius)
        pygame.draw.circle(surface, color, (x + w - radius, y + h - radius), radius)

        if border_color and border_width > 0:
            pygame.draw.rect(surface, border_color, (x + radius, y, w - 2*radius, border_width))
            pygame.draw.rect(surface, border_color, (x + radius, y + h - border_width, w - 2*radius, border_width))
            pygame.draw.rect(surface, border_color, (x, y + radius, border_width, h - 2*radius))
            pygame.draw.rect(surface, border_color, (x + w - border_width, y + radius, border_width, h - 2*radius))

    def _render_cached_background(self):
        """Rendert den Gradient-Hintergrund einmalig"""
        self._cached_background = pygame.Surface((self.width, self.height))
        for y in range(self.height):
            ratio = y / self.height
            r = int(COLORS['background'][0] + (COLORS['background_light'][0] - COLORS['background'][0]) * ratio * 0.3)
            g = int(COLORS['background'][1] + (COLORS['background_light'][1] - COLORS['background'][1]) * ratio * 0.3)
            b = int(COLORS['background'][2] + (COLORS['background_light'][2] - COLORS['background'][2]) * ratio * 0.3)
            pygame.draw.line(self._cached_background, (r, g, b), (0, y), (self.width, y))
        print("[DISPLAY] Hintergrund gecached")

    def _render_cached_overlays(self):
        """Rendert die farbigen Fullscreen-Overlays einmalig"""
        for name, color in [('green', COLORS['overlay_green']),
                            ('blue', COLORS['overlay_blue']),
                            ('red', COLORS['overlay_red'])]:
            overlay = pygame.Surface((self.width, self.height))
            for y in range(self.height):
                ratio = y / self.height
                r = int(color[0] * (1 + ratio * 0.5))
                g = int(color[1] * (1 + ratio * 0.5))
                b = int(color[2] * (1 + ratio * 0.5))
                r = min(255, r)
                g = min(255, g)
                b = min(255, b)
                pygame.draw.line(overlay, (r, g, b), (0, y), (self.width, y))
            setattr(self, f'_cached_overlay_{name}', overlay)
        print("[DISPLAY] Overlays gecached")

    def _draw_gradient_background(self):
        """Zeichnet den gecachten Gradient-Hintergrund"""
        if self._cached_background:
            self.screen.blit(self._cached_background, (0, 0))
        else:
            self.screen.fill(COLORS['background'])

    def _get_cached_glow(self, radius, color, intensity=0.3):
        """Holt oder erstellt einen gecachten Glow-Effekt"""
        cache_key = (radius, color[:3], intensity)
        if cache_key not in self._cached_glow:
            size = int(radius) * 2
            glow_surface = pygame.Surface((size, size), pygame.SRCALPHA)
            for i in range(int(radius), 0, -4):
                alpha = int(255 * intensity * (i / radius))
                pygame.draw.circle(glow_surface, (*color[:3], alpha), (int(radius), int(radius)), i)
            self._cached_glow[cache_key] = glow_surface
        return self._cached_glow[cache_key]

    def _draw_glow_effect(self, x, y, radius, color, intensity=0.3):
        """Zeichnet einen gecachten Glow-Effekt"""
        glow = self._get_cached_glow(radius, color, intensity)
        self.screen.blit(glow, (x - int(radius), y - int(radius)))

    # ──────────────────────────────────────────────
    # IDLE-ANSICHT: Uhr + Anwesend-Liste
    # ──────────────────────────────────────────────

    def _draw_clock(self):
        """Zeichnet Uhrzeit und Datum - groß und zentriert"""
        now = datetime.now()

        # Glow unter der Uhr
        self._draw_glow_effect(self.width // 2, int(self.height * 0.15), 150, COLORS['primary'], 0.1)

        # Uhrzeit
        time_str = now.strftime("%H:%M:%S")
        time_surface = self.font_clock.render(time_str, True, COLORS['text_white'])
        time_rect = time_surface.get_rect(centerx=self.width // 2, top=int(self.height * 0.04))
        self.screen.blit(time_surface, time_rect)

        # Datum
        weekdays = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag']
        months = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
                  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
        date_str = f"{weekdays[now.weekday()]}, {now.day}. {months[now.month-1]} {now.year}"
        date_surface = self.font_date.render(date_str, True, COLORS['text_gray'])
        date_rect = date_surface.get_rect(centerx=self.width // 2, top=time_rect.bottom + 5)
        self.screen.blit(date_surface, date_rect)

        return date_rect.bottom + 10

    def _draw_active_employees(self, y_start):
        """Zeichnet die Anwesend-Liste als einspaltiges Layout unter der Uhr"""
        margin = int(self.width * 0.04)
        card_width = self.width - 2 * margin
        card_y = y_start
        card_height = self.height - card_y - 45  # 45px für Statusbar

        # Karten-Hintergrund
        self._draw_rounded_rect(
            self.screen,
            (margin, card_y, card_width, card_height),
            COLORS['card_bg'], radius=15,
            border_color=COLORS['card_border'], border_width=1
        )

        padding = 15

        # Header: Grüner Punkt + "Anwesend" + Badge
        dot_y = card_y + padding + 10
        pygame.draw.circle(self.screen, COLORS['success'], (margin + padding + 6, dot_y), 6)

        title = self.font_title.render("Anwesend", True, COLORS['text_white'])
        self.screen.blit(title, (margin + padding + 20, card_y + padding))

        count_text = str(len(self.active_employees))
        count_surface = self.font_status.render(count_text, True, COLORS['text_white'])
        badge_w = max(32, count_surface.get_width() + 16)
        badge_rect = (margin + card_width - badge_w - padding, card_y + padding - 2, badge_w, 28)
        self._draw_rounded_rect(self.screen, badge_rect, COLORS['success'], radius=14)
        count_rect = count_surface.get_rect(center=(badge_rect[0] + badge_w // 2, badge_rect[1] + 14))
        self.screen.blit(count_surface, count_rect)

        # Trennlinie
        sep_y = card_y + padding + 30
        pygame.draw.line(self.screen, COLORS['card_border'],
                         (margin + padding, sep_y), (margin + card_width - padding, sep_y))

        # Mitarbeiter-Liste
        list_y = sep_y + 8
        item_height = 42
        max_visible = int((card_height - (list_y - card_y) - 30) / item_height)
        visible_count = min(len(self.active_employees), max_visible, MAX_ACTIVE_EMPLOYEES)

        for i in range(visible_count):
            emp = self.active_employees[i]
            iy = list_y + i * item_height

            # Grüner Punkt
            pygame.draw.circle(self.screen, COLORS['success'],
                               (margin + padding + 10, iy + item_height // 2), 4)

            # Name
            name = emp.get('employeeName', emp.get('employeeNumber', 'Unbekannt'))
            name_surface = self.font_name.render(name, True, COLORS['text_white'])
            self.screen.blit(name_surface, (margin + padding + 25, iy + 4))

            # Uhrzeit rechts
            try:
                clock_in = emp.get('clockIn', '')
                if isinstance(clock_in, str) and clock_in:
                    dt = datetime.fromisoformat(clock_in.replace('Z', '+00:00'))
                    local_dt = dt.astimezone()
                    time_str = f"seit {local_dt.strftime('%H:%M')}"
                else:
                    time_str = ""
            except Exception:
                time_str = ""

            if time_str:
                time_surface = self.font_small.render(time_str, True, COLORS['text_dim'])
                self.screen.blit(time_surface,
                                 (margin + card_width - padding - time_surface.get_width(), iy + 8))

        # Placeholder wenn leer
        if not self.active_employees:
            empty_surface = self.font_info.render("Keine Mitarbeiter anwesend", True, COLORS['text_dim'])
            empty_rect = empty_surface.get_rect(centerx=self.width // 2, centery=list_y + 40)
            self.screen.blit(empty_surface, empty_rect)

        # "+X weitere" Hinweis
        elif len(self.active_employees) > visible_count:
            more = f"+{len(self.active_employees) - visible_count} weitere"
            more_surface = self.font_small.render(more, True, COLORS['primary'])
            more_rect = more_surface.get_rect(centerx=self.width // 2,
                                              top=list_y + visible_count * item_height + 4)
            self.screen.blit(more_surface, more_rect)

    # ──────────────────────────────────────────────
    # FULLSCREEN SCAN-OVERLAY
    # ──────────────────────────────────────────────

    def _draw_scan_overlay(self):
        """Zeichnet das Fullscreen-Overlay bei Ein-/Ausstempeln"""
        if not self.last_scan or time.time() - self.last_scan_time > SCAN_DISPLAY_SECONDS:
            return False

        scan = self.last_scan
        elapsed = time.time() - self.last_scan_time
        progress = elapsed / SCAN_DISPLAY_SECONDS

        # Overlay-Hintergrund wählen
        is_error = scan.get('error') or not scan.get('success', True)
        is_clock_in = scan.get('action') == 'clock_in'

        if is_error:
            if self._cached_overlay_red:
                self.screen.blit(self._cached_overlay_red, (0, 0))
            else:
                self.screen.fill(COLORS['overlay_red'])
            accent_color = COLORS['error']
        elif is_clock_in:
            if self._cached_overlay_green:
                self.screen.blit(self._cached_overlay_green, (0, 0))
            else:
                self.screen.fill(COLORS['overlay_green'])
            accent_color = COLORS['success']
        else:
            if self._cached_overlay_blue:
                self.screen.blit(self._cached_overlay_blue, (0, 0))
            else:
                self.screen.fill(COLORS['overlay_blue'])
            accent_color = COLORS['clock_out']

        center_x = self.width // 2

        if is_error:
            # ── FEHLER-ANSICHT ──
            # Großes X
            error_y = int(self.height * 0.25)
            self._draw_glow_effect(center_x, error_y, 80, COLORS['error'], 0.2)
            x_surface = self.font_overlay_name.render("X", True, COLORS['error'])
            x_rect = x_surface.get_rect(centerx=center_x, centery=error_y)
            self.screen.blit(x_surface, x_rect)

            # "Fehler"
            error_title = self.font_overlay_action.render("Fehler", True, COLORS['text_white'])
            error_rect = error_title.get_rect(centerx=center_x, top=error_y + 50)
            self.screen.blit(error_title, error_rect)

            # Fehlermeldung
            error_msg = scan.get('error', 'Unbekannter Fehler')
            msg_surface = self.font_overlay_detail.render(error_msg, True, COLORS['text_gray'])
            msg_rect = msg_surface.get_rect(centerx=center_x, top=error_rect.bottom + 20)
            self.screen.blit(msg_surface, msg_rect)

        else:
            # ── KOMMT / GEHT ANSICHT ──
            name = scan.get('name', 'Unbekannt')
            photo = scan.get('photo')

            # Vertikales Layout berechnen
            photo_radius = int(self.height * 0.14)
            content_start_y = int(self.height * 0.08)

            # Foto (zentriert oben)
            if photo:
                photo_center_y = content_start_y + photo_radius
                self._draw_glow_effect(center_x, photo_center_y, photo_radius + 20, accent_color, 0.15)
                self._draw_circular_photo(self.screen, photo, center_x, photo_center_y, photo_radius)
                name_y = photo_center_y + photo_radius + int(self.height * 0.05)
            else:
                # Ohne Foto: Initials-Kreis
                initials_y = content_start_y + photo_radius
                self._draw_glow_effect(center_x, initials_y, photo_radius + 20, accent_color, 0.15)
                pygame.draw.circle(self.screen, accent_color, (center_x, initials_y), photo_radius)
                # Initialen
                parts = name.split()
                initials = (parts[0][0] + parts[-1][0]).upper() if len(parts) > 1 else name[0].upper()
                init_surface = self.font_overlay_name.render(initials, True, COLORS['text_white'])
                init_rect = init_surface.get_rect(centerx=center_x, centery=initials_y)
                self.screen.blit(init_surface, init_rect)
                name_y = initials_y + photo_radius + int(self.height * 0.05)

            # Mitarbeitername
            name_surface = self.font_overlay_name.render(name, True, COLORS['text_white'])
            # Falls Name zu breit: skalieren
            if name_surface.get_width() > self.width - 40:
                scale_factor = (self.width - 40) / name_surface.get_width()
                new_w = int(name_surface.get_width() * scale_factor)
                new_h = int(name_surface.get_height() * scale_factor)
                name_surface = pygame.transform.smoothscale(name_surface, (new_w, new_h))
            name_rect = name_surface.get_rect(centerx=center_x, top=name_y)
            self.screen.blit(name_surface, name_rect)

            # "kommt" / "geht"
            action_text = "kommt" if is_clock_in else "geht"
            # Pulsierender Effekt
            pulse_alpha = int(200 + 55 * math.sin(elapsed * 3))
            action_surface = self.font_overlay_action.render(action_text, True, accent_color)
            action_rect = action_surface.get_rect(centerx=center_x, top=name_rect.bottom + 10)
            self.screen.blit(action_surface, action_rect)

            # Detail-Zeile: Uhrzeit oder Arbeitsstunden
            detail_y = action_rect.bottom + 15
            if is_clock_in:
                detail_text = scan['time'].strftime("%H:%M") + " Uhr"
            else:
                hours = scan.get('hours', '')
                if hours:
                    detail_text = f"{hours}h gearbeitet"
                else:
                    detail_text = scan['time'].strftime("%H:%M") + " Uhr"
            detail_surface = self.font_overlay_detail.render(detail_text, True, COLORS['text_gray'])
            detail_rect = detail_surface.get_rect(centerx=center_x, top=detail_y)
            self.screen.blit(detail_surface, detail_rect)

        # ── COUNTDOWN-BALKEN unten ──
        bar_height = 6
        bar_y = self.height - bar_height
        bar_margin = int(self.width * 0.05)
        bar_total_width = self.width - 2 * bar_margin
        bar_filled_width = int(bar_total_width * (1 - progress))

        # Hintergrund
        pygame.draw.rect(self.screen, (*COLORS['card_border'], 100),
                         (bar_margin, bar_y, bar_total_width, bar_height),
                         border_radius=3)
        # Fortschritt
        if bar_filled_width > 0:
            pygame.draw.rect(self.screen, accent_color,
                             (bar_margin, bar_y, bar_filled_width, bar_height),
                             border_radius=3)

        return True

    # ──────────────────────────────────────────────
    # STATUSLEISTE
    # ──────────────────────────────────────────────

    def _draw_status_bar(self):
        """Zeichnet die Statusleiste unten"""
        bar_height = 35
        bar_y = self.height - bar_height

        pygame.draw.rect(self.screen, COLORS['card_bg'], (0, bar_y, self.width, bar_height))
        pygame.draw.line(self.screen, COLORS['card_border'], (0, bar_y), (self.width, bar_y))

        # Verbindungsstatus (links)
        if "Verbunden" in self.connection_status:
            status_color = COLORS['success']
            status_text = "Verbunden"
        elif "Fehler" in self.connection_status or "Getrennt" in self.connection_status:
            status_color = COLORS['error']
            status_text = "Getrennt"
        else:
            status_color = COLORS['warning']
            status_text = "Verbinde..."

        pulse_radius = 5
        if status_color == COLORS['success']:
            pulse = 1 + 0.2 * abs(math.sin(time.time() * 2))
            pulse_radius = int(5 * pulse)

        pygame.draw.circle(self.screen, status_color, (15, bar_y + bar_height // 2), pulse_radius)
        status_surface = self.font_small.render(status_text, True, status_color)
        self.screen.blit(status_surface, (28, bar_y + (bar_height - status_surface.get_height()) // 2))

        # Mitte: Hinweis
        hint = "RFID-Karte vorhalten"
        hint_surface = self.font_small.render(hint, True, COLORS['text_dim'])
        hint_rect = hint_surface.get_rect(centerx=self.width // 2,
                                          centery=bar_y + bar_height // 2)
        self.screen.blit(hint_surface, hint_rect)

        # Rechts: eth0 IP
        if self.eth0_ip:
            ip_text = self.eth0_ip
        else:
            ip_text = "Kein Netzwerk"
        ip_surface = self.font_small.render(ip_text, True, COLORS['text_dim'])
        self.screen.blit(ip_surface,
                         (self.width - ip_surface.get_width() - 15,
                          bar_y + (bar_height - ip_surface.get_height()) // 2))

    # ──────────────────────────────────────────────
    # HAUPTZEICHNUNG
    # ──────────────────────────────────────────────

    def draw(self):
        """Zeichnet den gesamten Bildschirm"""
        # Prüfe ob Scan-Overlay aktiv
        if self._draw_scan_overlay():
            # Overlay ist aktiv - nur Overlay anzeigen (kein Hintergrund, keine Liste)
            pygame.display.flip()
            return

        # Normaler Idle-Bildschirm
        self._draw_gradient_background()
        clock_bottom = self._draw_clock()
        self._draw_active_employees(clock_bottom)
        self._draw_status_bar()

        pygame.display.flip()

    def _needs_animation(self):
        """Prüft ob gerade eine Animation läuft"""
        if self.last_scan and time.time() - self.last_scan_time < SCAN_DISPLAY_SECONDS:
            return True
        return False

    def _get_data_hash(self):
        """Erstellt einen Hash der aktuellen Daten für Change-Detection"""
        return (
            len(self.active_employees),
            self.connection_status,
            self.eth0_ip,
            tuple(e.get('employeeName', '') for e in self.active_employees[:8])
        )

    def run(self):
        """Optimierte Hauptschleife mit dynamischer Frame-Rate"""
        clock = pygame.time.Clock()

        try:
            while self.running:
                for event in pygame.event.get():
                    if event.type == pygame.QUIT:
                        self.running = False
                    elif event.type == pygame.KEYDOWN:
                        if event.key in (pygame.K_ESCAPE, pygame.K_q):
                            self.running = False

                now = time.time()
                current_second = int(now)

                # IP alle 60 Sekunden aktualisieren
                if now - self._last_ip_check > 60:
                    self._last_ip_check = now
                    self.eth0_ip = get_eth0_ip()

                # Change-Detection
                current_hash = self._get_data_hash()
                data_changed = current_hash != self._last_data_hash
                if data_changed:
                    self._last_data_hash = current_hash
                    self._needs_full_redraw = True

                needs_draw = False

                if self._needs_animation():
                    needs_draw = True
                elif current_second != self._last_second:
                    self._last_second = current_second
                    needs_draw = True
                elif self._needs_full_redraw:
                    needs_draw = True
                    self._needs_full_redraw = False

                if needs_draw:
                    self.draw()

                if self._needs_animation():
                    clock.tick(30)
                else:
                    clock.tick(5)

        finally:
            self.running = False
            if self.sio.connected:
                self.sio.disconnect()
            pygame.quit()


def main():
    config_path = Path(__file__).parent / 'config.json'

    if not config_path.exists():
        print("FEHLER: config.json nicht gefunden!")
        sys.exit(1)

    with open(config_path, 'r') as f:
        config = json.load(f)

    backend_url = config.get('backend_url', 'http://localhost:3004')

    print("=" * 60)
    print("  Zeiterfassung HDMI Display (7-10\" Modus)")
    print("=" * 60)
    print(f"Backend: {backend_url}")
    print("Drücke ESC oder Q zum Beenden")
    print()

    display = HDMIDisplay(backend_url)
    display.run()


if __name__ == '__main__':
    main()
