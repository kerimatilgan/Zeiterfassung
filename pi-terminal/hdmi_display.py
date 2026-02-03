#!/usr/bin/env python3
"""
Zeiterfassung HDMI Display
Fullscreen-Anzeige für Raspberry Pi mit HDMI-Monitor
"""

import os
import sys
import json
import math
import threading
import time
import requests
import hashlib
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

        # Performance-Optimierung: Caching
        self._cached_background = None
        self._cached_glow = {}
        self._cached_photos = {}  # Cache für Mitarbeiterfotos
        self._photo_cache_dir = Path(__file__).parent / '.photo_cache'
        self._photo_cache_dir.mkdir(exist_ok=True)
        self._last_second = -1  # Für Uhr-Updates
        self._needs_full_redraw = True
        self._last_data_hash = None

        # Pygame initialisieren
        pygame.init()

        # Display einrichten
        try:
            if FULLSCREEN:
                # Hardware-Beschleunigung aktivieren
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
            # Fallback: Dummy-Display für headless Betrieb
            os.environ['SDL_VIDEODRIVER'] = 'dummy'
            pygame.display.quit()
            pygame.display.init()
            self.width = DISPLAY_WIDTH
            self.height = DISPLAY_HEIGHT
            self.screen = pygame.display.set_mode((self.width, self.height))

        # Fonts laden
        self._load_fonts()

        # Hintergrund vorrendern (einmalig)
        self._render_cached_background()

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
            self.font_clock = pygame.font.Font(bold_path or font_path, 140)
            self.font_date = pygame.font.Font(font_path, 42)
            self.font_title = pygame.font.Font(bold_path or font_path, 36)
            self.font_name = pygame.font.Font(bold_path or font_path, 32)
            self.font_info = pygame.font.Font(font_path, 26)
            self.font_small = pygame.font.Font(font_path, 22)
            self.font_scan = pygame.font.Font(bold_path or font_path, 56)
            self.font_status = pygame.font.Font(bold_path or font_path, 28)
        else:
            # Fallback auf Pygame-Standard
            self.font_clock = pygame.font.Font(None, 140)
            self.font_date = pygame.font.Font(None, 42)
            self.font_title = pygame.font.Font(None, 36)
            self.font_name = pygame.font.Font(None, 32)
            self.font_info = pygame.font.Font(None, 26)
            self.font_small = pygame.font.Font(None, 22)
            self.font_scan = pygame.font.Font(None, 56)
            self.font_status = pygame.font.Font(None, 28)

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

    def _load_photo(self, photo_url, size=(180, 180)):
        """Lädt und cached ein Mitarbeiterfoto mit EXIF-Orientierungskorrektur"""
        if not photo_url:
            return None

        # Cache-Key basierend auf URL und Größe
        cache_key = hashlib.md5(f"{photo_url}_{size}".encode()).hexdigest()

        # Prüfe ob bereits im Memory-Cache
        if cache_key in self._cached_photos:
            return self._cached_photos[cache_key]

        # Prüfe Datei-Cache
        cache_file = self._photo_cache_dir / f"{cache_key}.png"
        if cache_file.exists():
            try:
                photo_surface = pygame.image.load(str(cache_file))
                self._cached_photos[cache_key] = photo_surface
                return photo_surface
            except Exception as e:
                print(f"[PHOTO] Cache-Ladefehler: {e}")

        # Foto vom Server laden
        try:
            full_url = f"{self.backend_url}{photo_url}"
            print(f"[PHOTO] Lade Foto: {full_url}")

            response = requests.get(full_url, timeout=5)
            if response.status_code == 200:
                image_data = BytesIO(response.content)

                # Mit PIL laden für EXIF-Orientierungskorrektur
                if PIL_AVAILABLE:
                    pil_image = Image.open(image_data)

                    # EXIF-Orientierung korrigieren
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
                                    print(f"[PHOTO] EXIF-Orientierung korrigiert: {value}")
                                    break
                    except (AttributeError, KeyError, IndexError) as e:
                        print(f"[PHOTO] Keine EXIF-Daten: {e}")

                    # In RGB konvertieren falls nötig
                    if pil_image.mode != 'RGB':
                        pil_image = pil_image.convert('RGB')

                    # Quadratisch zuschneiden (Mitte)
                    width, height = pil_image.size
                    min_dim = min(width, height)
                    left = (width - min_dim) // 2
                    top = (height - min_dim) // 2
                    pil_image = pil_image.crop((left, top, left + min_dim, top + min_dim))

                    # Auf Zielgröße skalieren
                    pil_image = pil_image.resize(size, Image.LANCZOS)

                    # PIL zu Pygame Surface konvertieren
                    image_str = pil_image.tobytes()
                    photo_surface = pygame.image.fromstring(image_str, size, 'RGB')
                else:
                    # Fallback ohne PIL
                    photo_surface = pygame.image.load(image_data)
                    photo_surface = pygame.transform.smoothscale(photo_surface, size)

                # In Datei-Cache speichern
                pygame.image.save(photo_surface, str(cache_file))

                # In Memory-Cache speichern
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

        # Runde Maske erstellen
        mask = pygame.Surface((radius * 2, radius * 2), pygame.SRCALPHA)
        pygame.draw.circle(mask, (255, 255, 255, 255), (radius, radius), radius)

        # Foto auf Maske anwenden
        photo_scaled = pygame.transform.smoothscale(photo, (radius * 2, radius * 2))
        photo_masked = pygame.Surface((radius * 2, radius * 2), pygame.SRCALPHA)
        photo_masked.blit(photo_scaled, (0, 0))
        photo_masked.blit(mask, (0, 0), special_flags=pygame.BLEND_RGBA_MIN)

        # Rand zeichnen
        pygame.draw.circle(surface, COLORS['text_white'], (center_x, center_y), radius + 3, 3)
        pygame.draw.circle(surface, COLORS['card_bg'], (center_x, center_y), radius + 1, 1)

        # Foto zeichnen
        surface.blit(photo_masked, (center_x - radius, center_y - radius))

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

        # Foto laden falls vorhanden
        photo_url = employee.get('photoUrl')
        photo = None
        if photo_url:
            photo = self._load_photo(photo_url, size=(180, 180))

        entry = {
            'name': employee.get('name', 'Unbekannt'),
            'action': action_type,
            'time': datetime.now(),
            'hours': hours,
            'success': True,
            'photo_url': photo_url,
            'photo': photo,
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

    def show_scan_result(self, success, name, action, hours=None, error=None, photo_url=None):
        """Zeigt das Ergebnis eines Scans an (von terminal.py aufgerufen)"""
        # Foto laden falls vorhanden
        photo = None
        if photo_url:
            photo = self._load_photo(photo_url, size=(180, 180))

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

    def _render_cached_background(self):
        """Rendert den Gradient-Hintergrund einmalig in einen Cache"""
        self._cached_background = pygame.Surface((self.width, self.height))
        for y in range(self.height):
            ratio = y / self.height
            r = int(COLORS['background'][0] + (COLORS['background_light'][0] - COLORS['background'][0]) * ratio * 0.3)
            g = int(COLORS['background'][1] + (COLORS['background_light'][1] - COLORS['background'][1]) * ratio * 0.3)
            b = int(COLORS['background'][2] + (COLORS['background_light'][2] - COLORS['background'][2]) * ratio * 0.3)
            pygame.draw.line(self._cached_background, (r, g, b), (0, y), (self.width, y))
        print("[DISPLAY] Hintergrund gecached")

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
            for i in range(int(radius), 0, -4):  # Gröbere Schritte für Performance
                alpha = int(255 * intensity * (i / radius))
                pygame.draw.circle(glow_surface, (*color[:3], alpha), (int(radius), int(radius)), i)
            self._cached_glow[cache_key] = glow_surface
        return self._cached_glow[cache_key]

    def _draw_glow_effect(self, x, y, radius, color, intensity=0.3):
        """Zeichnet einen gecachten Glow-Effekt"""
        glow = self._get_cached_glow(radius, color, intensity)
        self.screen.blit(glow, (x - int(radius), y - int(radius)))

    def _draw_clock(self):
        """Zeichnet die Uhrzeit und Datum mit modernem Design"""
        now = datetime.now()

        # Subtiler Glow-Effekt unter der Uhr
        self._draw_glow_effect(self.width // 2, 100, 200, COLORS['primary'], 0.1)

        # Uhrzeit mit größerer Schrift
        time_str = now.strftime("%H:%M:%S")
        time_surface = self.font_clock.render(time_str, True, COLORS['text_white'])
        time_rect = time_surface.get_rect(centerx=self.width // 2, top=50)
        self.screen.blit(time_surface, time_rect)

        # Datum mit besserem Styling
        weekdays = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag']
        months = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
                  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']

        date_str = f"{weekdays[now.weekday()]}, {now.day}. {months[now.month-1]} {now.year}"
        date_surface = self.font_date.render(date_str, True, COLORS['text_gray'])
        date_rect = date_surface.get_rect(centerx=self.width // 2, top=time_rect.bottom + 15)
        self.screen.blit(date_surface, date_rect)

        return date_rect.bottom + 20

    def _draw_scan_feedback(self, y_start):
        """Zeichnet das Feedback für den letzten Scan mit Animation und Foto"""
        # Animation für 5 Sekunden nach Scan
        if not self.last_scan or time.time() - self.last_scan_time > 5:
            return y_start

        scan = self.last_scan
        elapsed = time.time() - self.last_scan_time

        # Fade-out und Scale-Effekt
        alpha = max(0, min(255, int(255 * (1 - elapsed / 5))))

        # Pulsierender Effekt für die ersten 2 Sekunden
        pulse = 1.0
        if elapsed < 2:
            pulse = 1.0 + 0.02 * abs(math.sin(elapsed * 4))

        # Farbe und Text basierend auf Aktion bestimmen
        if scan.get('error') or not scan.get('success', True):
            bg_color = COLORS['error']
            icon = "X"
            text = scan.get('error', 'Fehler')
        elif scan.get('action') == 'clock_in':
            bg_color = COLORS['clock_in']
            icon = ">"
            text = f"{scan['name']} eingestempelt"
        else:
            bg_color = COLORS['clock_out']
            icon = "<"
            hours = scan.get('hours', '')
            text = f"{scan['name']} ausgestempelt"
            if hours:
                text += f" ({hours}h)"

        # Foto vorhanden?
        photo = scan.get('photo')
        photo_size = 150 if photo else 0  # Größeres Foto
        photo_padding = 30 if photo else 0

        # Text und Icon zuerst rendern um Breite zu berechnen
        icon_surface = self.font_scan.render(icon, True, COLORS['text_white'])
        text_surface = self.font_scan.render(text, True, COLORS['text_white'])

        # Dynamische Kartenbreite basierend auf Text und Foto
        icon_padding = 50  # Abstand links vom Icon
        icon_text_gap = 30  # Abstand zwischen Icon und Text
        text_padding = 50  # Abstand rechts vom Text
        base_width = icon_padding + photo_size + photo_padding + icon_surface.get_width() + icon_text_gap + text_surface.get_width() + text_padding
        card_width = int(max(400, base_width) * pulse)  # Minimum 400px
        card_height = int(max(140, photo_size + 40) * pulse)  # Mindesthöhe für Foto
        card_x = (self.width - card_width) // 2
        card_y = y_start + 20

        # Vereinfachter Glow-Effekt (nur 2 Ebenen statt 5)
        if elapsed < 3:
            glow_alpha = int(80 * (1 - elapsed / 3))
            for i in [16, 8]:  # Nur 2 Ebenen
                glow_surface = pygame.Surface((card_width + i*2, card_height + i*2), pygame.SRCALPHA)
                pygame.draw.rect(glow_surface, (*bg_color[:3], glow_alpha // (i//8 + 1)),
                               (0, 0, card_width + i*2, card_height + i*2), border_radius=25)
                self.screen.blit(glow_surface, (card_x - i, card_y - i))

        # Zeichne Hauptkarte mit Alpha
        card_surface = pygame.Surface((card_width, card_height), pygame.SRCALPHA)
        pygame.draw.rect(card_surface, (*bg_color[:3], alpha), (0, 0, card_width, card_height), border_radius=20)
        self.screen.blit(card_surface, (card_x, card_y))

        # Inhalt-Berechnung
        total_content_width = photo_size + photo_padding + icon_surface.get_width() + icon_text_gap + text_surface.get_width()
        content_start_x = card_x + (card_width - total_content_width) // 2

        # Foto zeichnen (links)
        if photo:
            photo_x = content_start_x + photo_size // 2
            photo_y = card_y + card_height // 2
            self._draw_circular_photo(self.screen, photo, photo_x, photo_y, photo_size // 2)
            content_start_x += photo_size + photo_padding

        # Icon
        icon_rect = icon_surface.get_rect(centery=card_y + card_height//2, left=content_start_x)
        self.screen.blit(icon_surface, icon_rect)

        # Text
        text_rect = text_surface.get_rect(centery=card_y + card_height//2, left=icon_rect.right + icon_text_gap)
        self.screen.blit(text_surface, text_rect)

        return card_y + card_height + 10

    def _draw_active_employees(self, x, y, width, height):
        """Zeichnet die Liste der eingestempelten Mitarbeiter mit modernem Design"""
        padding = 25

        # Header mit Icon und Zähler
        # Grüner Indikator-Punkt
        pygame.draw.circle(self.screen, COLORS['success'], (x + padding + 8, y + 28), 8)

        # Titel
        title = self.font_title.render("Anwesend", True, COLORS['text_white'])
        self.screen.blit(title, (x + padding + 25, y + 15))

        # Anzahl in einer Badge
        count_text = str(len(self.active_employees))
        count_surface = self.font_status.render(count_text, True, COLORS['text_white'])
        badge_width = max(40, count_surface.get_width() + 20)
        badge_rect = (x + width - badge_width - padding, y + 12, badge_width, 35)
        self._draw_rounded_rect(self.screen, badge_rect, COLORS['success'], radius=17)
        count_rect = count_surface.get_rect(center=(badge_rect[0] + badge_width//2, badge_rect[1] + 17))
        self.screen.blit(count_surface, count_rect)

        # Liste
        list_y = y + 70
        item_height = 60

        for i, emp in enumerate(self.active_employees[:MAX_ACTIVE_EMPLOYEES]):
            if list_y + item_height > y + height - 20:
                break

            # Hover-Effekt für den obersten (neuesten) Eintrag
            if i == 0 and len(self.active_employees) > 0:
                item_bg = pygame.Surface((width - 2*padding, item_height - 5), pygame.SRCALPHA)
                pygame.draw.rect(item_bg, (*COLORS['card_bg_hover'][:3], 100),
                               (0, 0, width - 2*padding, item_height - 5), border_radius=10)
                self.screen.blit(item_bg, (x + padding, list_y))

            # Grüner Punkt für Status
            pygame.draw.circle(self.screen, COLORS['success'], (x + padding + 15, list_y + item_height//2 - 5), 5)

            # Name (größer und prominenter)
            name = emp.get('employeeName', emp.get('employeeNumber', 'Unbekannt'))
            name_surface = self.font_name.render(name, True, COLORS['text_white'])
            self.screen.blit(name_surface, (x + padding + 35, list_y + 8))

            # Zeit seit Einstempeln
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
            self.screen.blit(time_surface, (x + padding + 35, list_y + 35))

            list_y += item_height

        # Placeholder wenn keine Mitarbeiter anwesend
        if not self.active_employees:
            empty_text = "Keine Mitarbeiter anwesend"
            empty_surface = self.font_info.render(empty_text, True, COLORS['text_dim'])
            self.screen.blit(empty_surface, (x + padding, list_y + 20))

        # "Mehr..." anzeigen wenn nötig
        elif len(self.active_employees) > MAX_ACTIVE_EMPLOYEES:
            more = f"+{len(self.active_employees) - MAX_ACTIVE_EMPLOYEES} weitere"
            more_surface = self.font_small.render(more, True, COLORS['primary'])
            self.screen.blit(more_surface, (x + padding, list_y + 5))

    def _draw_activity_log(self, x, y, width, height):
        """Zeichnet die Aktivitäts-Historie mit modernem Design"""
        padding = 25

        # Header
        title = self.font_title.render("Letzte Aktivitäten", True, COLORS['text_white'])
        self.screen.blit(title, (x + padding, y + 15))

        # Liste
        list_y = y + 70
        item_height = 75

        for i, entry in enumerate(self.activity_log):
            if list_y + item_height > y + height - 20:
                break

            # Zeitstempel
            try:
                time_str = entry['time'].strftime("%H:%M")
            except:
                time_str = "--:--"

            # Aktion bestimmen
            if entry.get('error') or not entry.get('success', True):
                action_color = COLORS['error']
                action_text = "Fehler"
                icon = "!"
            elif entry.get('action') == 'clock_in':
                action_color = COLORS['clock_in']
                action_text = "Eingestempelt"
                icon = ">"
            else:
                action_color = COLORS['clock_out']
                action_text = "Ausgestempelt"
                icon = "<"

            # Zeit-Badge links (prominent)
            time_badge_width = 80
            time_badge_rect = (x + padding, list_y + 5, time_badge_width, 35)
            self._draw_rounded_rect(self.screen, time_badge_rect, COLORS['card_bg_hover'], radius=10)
            time_surface = self.font_info.render(time_str, True, COLORS['text_gray'])
            time_rect = time_surface.get_rect(center=(time_badge_rect[0] + time_badge_width//2, time_badge_rect[1] + 17))
            self.screen.blit(time_surface, time_rect)

            # Aktions-Indikator (größerer Kreis mit Icon)
            indicator_x = x + padding + time_badge_width + 20
            indicator_y = list_y + 22
            pygame.draw.circle(self.screen, action_color, (indicator_x, indicator_y), 12)
            icon_surface = self.font_small.render(icon, True, COLORS['text_white'])
            icon_rect = icon_surface.get_rect(center=(indicator_x, indicator_y))
            self.screen.blit(icon_surface, icon_rect)

            # Name (größer)
            name = entry.get('name', 'Unbekannt')
            name_x = indicator_x + 30
            name_surface = self.font_name.render(name, True, COLORS['text_white'])
            self.screen.blit(name_surface, (name_x, list_y + 5))

            # Aktion + Stunden
            action_str = action_text
            if entry.get('hours'):
                action_str += f" - {entry['hours']}h gearbeitet"
            action_surface = self.font_info.render(action_str, True, action_color)
            self.screen.blit(action_surface, (name_x, list_y + 38))

            # Subtile Trennlinie
            line_y = list_y + item_height - 5
            pygame.draw.line(
                self.screen, (*COLORS['card_border'][:3], 100),
                (x + padding, line_y),
                (x + width - padding, line_y)
            )

            list_y += item_height

        # Placeholder wenn leer
        if not self.activity_log:
            # Zentrierter Placeholder
            empty_y = y + height // 2 - 30
            empty_text = "Noch keine Aktivitäten heute"
            empty_surface = self.font_info.render(empty_text, True, COLORS['text_dim'])
            empty_rect = empty_surface.get_rect(centerx=x + width//2, centery=empty_y)
            self.screen.blit(empty_surface, empty_rect)

            hint_text = "Bitte RFID-Karte scannen"
            hint_surface = self.font_small.render(hint_text, True, COLORS['text_dim'])
            hint_rect = hint_surface.get_rect(centerx=x + width//2, centery=empty_y + 30)
            self.screen.blit(hint_surface, hint_rect)

    def _draw_status_bar(self):
        """Zeichnet die Statusleiste unten mit modernem Design"""
        bar_height = 50
        bar_y = self.height - bar_height

        # Hintergrund mit subtiler Trennlinie
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

        # Status-Indikator mit pulsierendem Effekt wenn verbunden
        pulse_radius = 8
        if status_color == COLORS['success']:
            pulse = 1 + 0.2 * abs(math.sin(time.time() * 2))
            pulse_radius = int(8 * pulse)

        pygame.draw.circle(self.screen, status_color, (30, bar_y + bar_height // 2), pulse_radius)

        status_surface = self.font_small.render(status_text, True, status_color)
        self.screen.blit(status_surface, (50, bar_y + 14))

        # Zentraler Hinweis (nur wenn keine aktive Scan-Anzeige)
        if not self.last_scan or time.time() - self.last_scan_time > 5:
            hint = "RFID-Karte vorhalten zum Stempeln"
            hint_surface = self.font_info.render(hint, True, COLORS['text_gray'])
            hint_rect = hint_surface.get_rect(centerx=self.width // 2, centery=bar_y + bar_height // 2)
            self.screen.blit(hint_surface, hint_rect)

        # Version (rechts)
        version = "Zeiterfassung Terminal v1.0"
        version_surface = self.font_small.render(version, True, COLORS['text_dim'])
        self.screen.blit(version_surface, (self.width - version_surface.get_width() - 30, bar_y + 14))

    def draw(self):
        """Zeichnet den gesamten Bildschirm mit modernem Design"""
        # Gradient-Hintergrund
        self._draw_gradient_background()

        # Uhr und Datum
        clock_bottom = self._draw_clock()

        # Scan-Feedback (falls kürzlich gescannt)
        content_top = self._draw_scan_feedback(clock_bottom)
        if content_top == clock_bottom:
            content_top = clock_bottom + 30
        else:
            content_top += 15

        # Layout berechnen
        margin = 40
        gap = 30
        content_height = self.height - content_top - 70  # 70 für Statusbar

        # Linke Spalte: Aktive Mitarbeiter (35%)
        left_width = int((self.width - 2*margin - gap) * 0.35)
        left_x = margin

        # Rechte Spalte: Activity Log (65%)
        right_width = self.width - left_width - 2*margin - gap
        right_x = left_x + left_width + gap

        # Karten mit subtilen Schatten zeichnen
        # Linke Karte (Anwesend)
        self._draw_rounded_rect(
            self.screen,
            (left_x, content_top, left_width, content_height),
            COLORS['card_bg'],
            radius=25,
            border_color=COLORS['card_border'],
            border_width=1
        )
        self._draw_active_employees(left_x, content_top, left_width, content_height)

        # Rechte Karte (Aktivitäten)
        self._draw_rounded_rect(
            self.screen,
            (right_x, content_top, right_width, content_height),
            COLORS['card_bg'],
            radius=25,
            border_color=COLORS['card_border'],
            border_width=1
        )
        self._draw_activity_log(right_x, content_top, right_width, content_height)

        # Statusleiste
        self._draw_status_bar()

        # Display aktualisieren
        pygame.display.flip()

    def _needs_animation(self):
        """Prüft ob gerade eine Animation läuft die höhere FPS braucht"""
        # Scan-Feedback Animation aktiv?
        if self.last_scan and time.time() - self.last_scan_time < 5:
            return True
        return False

    def _get_data_hash(self):
        """Erstellt einen Hash der aktuellen Daten für Change-Detection"""
        return (
            len(self.active_employees),
            len(self.activity_log),
            self.connection_status,
            tuple(e.get('employeeName', '') for e in self.active_employees[:5])
        )

    def run(self):
        """Optimierte Hauptschleife mit dynamischer Frame-Rate"""
        clock = pygame.time.Clock()
        last_full_draw = 0

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

                now = time.time()
                current_second = int(now)

                # Prüfe ob Daten sich geändert haben
                current_hash = self._get_data_hash()
                data_changed = current_hash != self._last_data_hash
                if data_changed:
                    self._last_data_hash = current_hash
                    self._needs_full_redraw = True

                # Bestimme ob wir zeichnen müssen
                needs_draw = False

                if self._needs_animation():
                    # Bei Animationen: 30 FPS
                    needs_draw = True
                    target_fps = 30
                elif current_second != self._last_second:
                    # Uhr-Update: einmal pro Sekunde
                    self._last_second = current_second
                    needs_draw = True
                    target_fps = 2  # Niedrige FPS zwischen Updates
                elif self._needs_full_redraw:
                    # Daten haben sich geändert
                    needs_draw = True
                    self._needs_full_redraw = False
                    target_fps = 10

                if needs_draw:
                    self.draw()
                    last_full_draw = now

                # Dynamische Frame-Rate
                if self._needs_animation():
                    clock.tick(30)
                else:
                    clock.tick(5)  # Nur 5 FPS wenn keine Animation

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
