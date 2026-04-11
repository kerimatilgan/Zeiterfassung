#!/usr/bin/env python3
"""
WLAN-Konfiguration Touch-UI für das Zeiterfassung Terminal
Pygame-basiertes Menü mit Netzwerkliste + On-Screen-Tastatur
"""

import subprocess
import time
import threading
import json
try:
    import pygame
except ImportError:
    print("pygame nicht verfügbar")

# Farben
BG = (15, 23, 42)
CARD_BG = (30, 41, 59)
CARD_BORDER = (71, 85, 105)
PRIMARY = (59, 130, 246)
SUCCESS = (34, 197, 94)
ERROR = (239, 68, 68)
TEXT_WHITE = (248, 250, 252)
TEXT_GRAY = (148, 163, 184)
TEXT_DIM = (100, 116, 139)
KEY_BG = (51, 65, 85)
KEY_HOVER = (71, 85, 105)
KEY_SPECIAL = (59, 130, 246)


def scan_wifi():
    """Scannt verfügbare WLAN-Netzwerke"""
    try:
        result = subprocess.run(
            ['nmcli', '-t', '-f', 'SSID,SIGNAL,SECURITY', 'dev', 'wifi', 'list', '--rescan', 'yes'],
            capture_output=True, text=True, timeout=15
        )
        networks = []
        seen = set()
        for line in result.stdout.strip().split('\n'):
            if not line.strip():
                continue
            parts = line.split(':')
            if len(parts) >= 3:
                ssid = parts[0].strip()
                if not ssid or ssid in seen:
                    continue
                seen.add(ssid)
                signal = int(parts[1]) if parts[1].isdigit() else 0
                security = parts[2].strip()
                networks.append({
                    'ssid': ssid,
                    'signal': signal,
                    'security': security,
                    'secured': security != '' and security != '--',
                })
        networks.sort(key=lambda x: x['signal'], reverse=True)
        return networks
    except Exception as e:
        print(f"[WIFI] Scan-Fehler: {e}")
        # Fallback: iwlist
        try:
            result = subprocess.run(
                ['sudo', 'iwlist', 'wlan0', 'scan'],
                capture_output=True, text=True, timeout=15
            )
            networks = []
            current = {}
            for line in result.stdout.split('\n'):
                line = line.strip()
                if 'ESSID:' in line:
                    ssid = line.split('ESSID:"')[1].rstrip('"') if 'ESSID:"' in line else ''
                    if ssid:
                        current['ssid'] = ssid
                elif 'Quality=' in line:
                    try:
                        q = line.split('Quality=')[1].split(' ')[0]
                        num, den = q.split('/')
                        current['signal'] = int(int(num) / int(den) * 100)
                    except:
                        current['signal'] = 0
                elif 'Encryption key:' in line:
                    current['secured'] = 'on' in line
                    current['security'] = 'WPA' if current['secured'] else ''
                    if current.get('ssid'):
                        networks.append(dict(current))
                    current = {}
            return networks
        except:
            return []


def connect_wifi(ssid, password=None):
    """Verbindet mit einem WLAN-Netzwerk"""
    try:
        if password:
            result = subprocess.run(
                ['nmcli', 'dev', 'wifi', 'connect', ssid, 'password', password],
                capture_output=True, text=True, timeout=30
            )
        else:
            result = subprocess.run(
                ['nmcli', 'dev', 'wifi', 'connect', ssid],
                capture_output=True, text=True, timeout=30
            )
        if result.returncode == 0:
            return True, "Verbunden!"
        else:
            error = result.stderr.strip() or result.stdout.strip()
            if 'password' in error.lower() or 'secret' in error.lower():
                return False, "Falsches Passwort"
            return False, error[:50]
    except Exception as e:
        return False, str(e)[:50]


def get_current_wifi():
    """Gibt das aktuell verbundene WLAN zurück"""
    try:
        result = subprocess.run(
            ['nmcli', '-t', '-f', 'ACTIVE,SSID', 'dev', 'wifi'],
            capture_output=True, text=True, timeout=5
        )
        for line in result.stdout.strip().split('\n'):
            if line.startswith('yes:'):
                return line.split(':')[1]
    except:
        pass
    return None


class OnScreenKeyboard:
    """Touch-freundliche On-Screen-Tastatur"""

    LAYOUTS = {
        'lower': [
            list('1234567890'),
            list('qwertzuiop'),
            list('asdfghjkl@'),
            ['SHIFT'] + list('yxcvbnm') + ['BACK'],
            ['SPACE', '.', '-', '_', 'OK'],
        ],
        'upper': [
            list('1234567890'),
            list('QWERTZUIOP'),
            list('ASDFGHJKL@'),
            ['SHIFT'] + list('YXCVBNM') + ['BACK'],
            ['SPACE', '.', '-', '_', 'OK'],
        ],
        'symbols': [
            list('!@#$%^&*()'),
            list('+-=[]{}|\\:'),
            list('"\'<>,;?/~`'),
            ['ABC'] + list('      ') + ['BACK'],
            ['SPACE', '.', '-', '_', 'OK'],
        ],
    }

    def __init__(self, screen, width, height):
        self.screen = screen
        self.width = width
        self.height = height
        self.text = ""
        self.layout = 'lower'
        self.visible = False
        self.key_height = min(45, height // 12)
        self.key_margin = 3
        self.font = pygame.font.SysFont(None, max(18, self.key_height - 10))

    def show(self, initial_text=""):
        self.text = initial_text
        self.visible = True
        self.layout = 'lower'

    def hide(self):
        self.visible = False

    def get_keyboard_rect(self):
        rows = self.LAYOUTS[self.layout]
        total_h = len(rows) * (self.key_height + self.key_margin) + 40 + self.key_margin
        return pygame.Rect(0, self.height - total_h, self.width, total_h)

    def draw(self):
        if not self.visible:
            return

        kb_rect = self.get_keyboard_rect()
        pygame.draw.rect(self.screen, BG, kb_rect)
        pygame.draw.line(self.screen, CARD_BORDER, (0, kb_rect.top), (self.width, kb_rect.top), 2)

        # Text-Feld
        text_y = kb_rect.top + 8
        text_rect = pygame.Rect(10, text_y, self.width - 20, 28)
        pygame.draw.rect(self.screen, CARD_BG, text_rect, border_radius=5)
        pygame.draw.rect(self.screen, PRIMARY, text_rect, 2, border_radius=5)
        display_text = self.text if len(self.text) < 30 else '...' + self.text[-27:]
        txt = self.font.render(display_text + '|', True, TEXT_WHITE)
        self.screen.blit(txt, (text_rect.x + 8, text_rect.y + 5))

        # Tasten
        rows = self.LAYOUTS[self.layout]
        start_y = text_y + 36

        for row_idx, row in enumerate(rows):
            total_keys = len(row)
            key_w = (self.width - (total_keys + 1) * self.key_margin) // total_keys
            x = self.key_margin

            for key in row:
                y = start_y + row_idx * (self.key_height + self.key_margin)

                # Spezielle Tasten breiter
                w = key_w
                if key == 'SPACE':
                    w = key_w * 3
                elif key in ('SHIFT', 'BACK', 'OK', 'ABC'):
                    w = int(key_w * 1.5)

                rect = pygame.Rect(x, y, w, self.key_height)
                color = KEY_SPECIAL if key in ('OK', 'SHIFT', 'ABC') else KEY_BG
                if key == 'BACK':
                    color = ERROR
                pygame.draw.rect(self.screen, color, rect, border_radius=4)

                # Label
                label = key
                if key == 'SPACE':
                    label = 'Leertaste'
                elif key == 'BACK':
                    label = '<'
                elif key == 'SHIFT':
                    label = 'ABC' if self.layout == 'upper' else 'ABC'

                txt = self.font.render(label, True, TEXT_WHITE)
                txt_rect = txt.get_rect(center=rect.center)
                self.screen.blit(txt, txt_rect)

                x += w + self.key_margin

    def handle_touch(self, pos):
        if not self.visible:
            return None

        kb_rect = self.get_keyboard_rect()
        if not kb_rect.collidepoint(pos):
            return None

        rows = self.LAYOUTS[self.layout]
        start_y = kb_rect.top + 44

        for row_idx, row in enumerate(rows):
            total_keys = len(row)
            key_w = (self.width - (total_keys + 1) * self.key_margin) // total_keys
            x = self.key_margin

            for key in row:
                y = start_y + row_idx * (self.key_height + self.key_margin)
                w = key_w
                if key == 'SPACE':
                    w = key_w * 3
                elif key in ('SHIFT', 'BACK', 'OK', 'ABC'):
                    w = int(key_w * 1.5)

                rect = pygame.Rect(x, y, w, self.key_height)
                if rect.collidepoint(pos):
                    if key == 'BACK':
                        self.text = self.text[:-1]
                    elif key == 'SPACE':
                        self.text += ' '
                    elif key == 'SHIFT':
                        self.layout = 'upper' if self.layout == 'lower' else 'lower'
                    elif key == 'ABC':
                        self.layout = 'lower'
                    elif key == 'OK':
                        return 'OK'
                    else:
                        self.text += key
                        if self.layout == 'upper':
                            self.layout = 'lower'
                    return 'KEY'

                x += w + self.key_margin

        return None


class WifiSetupUI:
    """WLAN-Setup Touch-UI"""

    STATE_NETWORKS = 'networks'
    STATE_PASSWORD = 'password'
    STATE_CONNECTING = 'connecting'
    STATE_RESULT = 'result'
    STATE_QRCODE = 'qrcode'

    def __init__(self, screen, width, height):
        self.screen = screen
        self.width = width
        self.height = height
        self.state = self.STATE_NETWORKS
        self.networks = []
        self.selected_network = None
        self.scroll_offset = 0
        self.connecting = False
        self.result_msg = ""
        self.result_ok = False
        self.visible = False
        self.qr_surface = None  # Von außen gesetzt (hdmi_display.py)

        self.font_title = pygame.font.SysFont(None, max(24, height // 20))
        self.font_normal = pygame.font.SysFont(None, max(18, height // 28))
        self.font_small = pygame.font.SysFont(None, max(14, height // 35))
        self.keyboard = OnScreenKeyboard(screen, width, height)

    def show(self):
        self.visible = True
        self.state = self.STATE_NETWORKS
        self.networks = []
        self.scroll_offset = 0
        # Scan in Hintergrund
        threading.Thread(target=self._scan, daemon=True).start()

    def hide(self):
        self.visible = False
        self.keyboard.hide()

    def _scan(self):
        self.networks = scan_wifi()

    def draw(self):
        if not self.visible:
            return

        # Hintergrund
        pygame.draw.rect(self.screen, BG, (0, 0, self.width, self.height))

        # Header
        pygame.draw.rect(self.screen, CARD_BG, (0, 0, self.width, 40))
        title = self.font_title.render('WLAN-Einstellungen', True, TEXT_WHITE)
        self.screen.blit(title, (10, 10))

        # Zurück-Button
        back_rect = pygame.Rect(self.width - 80, 5, 70, 30)
        pygame.draw.rect(self.screen, ERROR, back_rect, border_radius=5)
        back_txt = self.font_normal.render('Zurück', True, TEXT_WHITE)
        self.screen.blit(back_txt, back_txt.get_rect(center=back_rect.center))

        # Aktuelles WLAN
        current = get_current_wifi()
        if current:
            info = self.font_small.render(f'Verbunden: {current}', True, SUCCESS)
            self.screen.blit(info, (10, 44))

        if self.state == self.STATE_NETWORKS:
            self._draw_networks()
        elif self.state == self.STATE_PASSWORD:
            self._draw_password()
        elif self.state == self.STATE_CONNECTING:
            self._draw_connecting()
        elif self.state == self.STATE_RESULT:
            self._draw_result()

    def _draw_networks(self):
        y = 62

        # QR-Code anzeigen (rechts)
        qr_width = 0
        if self.qr_surface:
            qr_size = min(self.height - 80, 120)
            scaled_qr = pygame.transform.scale(self.qr_surface, (qr_size, qr_size))
            qr_x = self.width - qr_size - 8
            qr_y = y + 4
            self.screen.blit(scaled_qr, (qr_x, qr_y))
            # Label
            lbl = self.font_small.render('Web-UI scannen', True, TEXT_GRAY)
            self.screen.blit(lbl, (qr_x + qr_size // 2 - lbl.get_width() // 2, qr_y + qr_size + 2))
            qr_width = qr_size + 16

        if not self.networks:
            txt = self.font_normal.render('Suche Netzwerke...', True, TEXT_GRAY)
            self.screen.blit(txt, (self.width // 2 - txt.get_width() // 2, self.height // 2))
            # Rescan-Button
            rescan_rect = pygame.Rect(self.width // 2 - 50, self.height // 2 + 30, 100, 30)
            pygame.draw.rect(self.screen, PRIMARY, rescan_rect, border_radius=5)
            rescan_txt = self.font_normal.render('Neu suchen', True, TEXT_WHITE)
            self.screen.blit(rescan_txt, rescan_txt.get_rect(center=rescan_rect.center))
            return

        item_h = max(36, self.height // 10)
        visible_items = (self.height - y - 10) // item_h

        list_width = self.width - 10 - qr_width
        for i, net in enumerate(self.networks[self.scroll_offset:self.scroll_offset + visible_items]):
            rect = pygame.Rect(5, y + i * item_h, list_width, item_h - 4)
            pygame.draw.rect(self.screen, CARD_BG, rect, border_radius=5)

            # Signal-Stärke
            signal = net['signal']
            sig_color = SUCCESS if signal > 60 else PRIMARY if signal > 30 else ERROR
            bars = min(4, signal // 25 + 1)
            for b in range(4):
                bar_h = 6 + b * 4
                bar_color = sig_color if b < bars else TEXT_DIM
                pygame.draw.rect(self.screen, bar_color, (rect.x + 8 + b * 6, rect.y + rect.height - 8 - bar_h, 4, bar_h))

            # SSID
            ssid_txt = self.font_normal.render(net['ssid'][:25], True, TEXT_WHITE)
            self.screen.blit(ssid_txt, (rect.x + 36, rect.y + 4))

            # Security
            if net['secured']:
                lock_txt = self.font_small.render('🔒 ' + net.get('security', 'Gesichert'), True, TEXT_GRAY)
            else:
                lock_txt = self.font_small.render('Offen', True, SUCCESS)
            self.screen.blit(lock_txt, (rect.x + 36, rect.y + item_h - 20))

            # Signal-Prozent
            sig_txt = self.font_small.render(f'{signal}%', True, TEXT_GRAY)
            self.screen.blit(sig_txt, (rect.right - 40, rect.y + rect.height // 2 - 7))

    def _draw_password(self):
        if not self.selected_network:
            return

        y = 62
        ssid_txt = self.font_title.render(self.selected_network['ssid'], True, TEXT_WHITE)
        self.screen.blit(ssid_txt, (self.width // 2 - ssid_txt.get_width() // 2, y))

        hint = self.font_normal.render('Passwort eingeben:', True, TEXT_GRAY)
        self.screen.blit(hint, (self.width // 2 - hint.get_width() // 2, y + 30))

        self.keyboard.draw()

    def _draw_connecting(self):
        txt = self.font_title.render('Verbinde...', True, PRIMARY)
        self.screen.blit(txt, (self.width // 2 - txt.get_width() // 2, self.height // 2 - 20))
        net_txt = self.font_normal.render(self.selected_network['ssid'] if self.selected_network else '', True, TEXT_GRAY)
        self.screen.blit(net_txt, (self.width // 2 - net_txt.get_width() // 2, self.height // 2 + 15))

    def _draw_result(self):
        color = SUCCESS if self.result_ok else ERROR
        icon = 'Verbunden!' if self.result_ok else 'Fehler'
        txt = self.font_title.render(icon, True, color)
        self.screen.blit(txt, (self.width // 2 - txt.get_width() // 2, self.height // 2 - 30))

        msg = self.font_normal.render(self.result_msg[:40], True, TEXT_GRAY)
        self.screen.blit(msg, (self.width // 2 - msg.get_width() // 2, self.height // 2 + 10))

        ok_rect = pygame.Rect(self.width // 2 - 40, self.height // 2 + 45, 80, 30)
        pygame.draw.rect(self.screen, PRIMARY, ok_rect, border_radius=5)
        ok_txt = self.font_normal.render('OK', True, TEXT_WHITE)
        self.screen.blit(ok_txt, ok_txt.get_rect(center=ok_rect.center))

    def handle_touch(self, pos):
        if not self.visible:
            return False

        # Zurück-Button
        back_rect = pygame.Rect(self.width - 80, 5, 70, 30)
        if back_rect.collidepoint(pos):
            if self.state == self.STATE_PASSWORD:
                self.keyboard.hide()
                self.state = self.STATE_NETWORKS
            else:
                self.hide()
                return True  # Signal: zurück zum Hauptbildschirm
            return False

        if self.state == self.STATE_NETWORKS:
            return self._handle_networks_touch(pos)
        elif self.state == self.STATE_PASSWORD:
            return self._handle_password_touch(pos)
        elif self.state == self.STATE_RESULT:
            ok_rect = pygame.Rect(self.width // 2 - 40, self.height // 2 + 45, 80, 30)
            if ok_rect.collidepoint(pos):
                self.state = self.STATE_NETWORKS
                threading.Thread(target=self._scan, daemon=True).start()
            return False

        return False

    def _handle_networks_touch(self, pos):
        y = 62
        item_h = max(36, self.height // 10)
        visible_items = (self.height - y - 10) // item_h

        # Rescan
        if not self.networks:
            rescan_rect = pygame.Rect(self.width // 2 - 50, self.height // 2 + 30, 100, 30)
            if rescan_rect.collidepoint(pos):
                threading.Thread(target=self._scan, daemon=True).start()
            return False

        for i, net in enumerate(self.networks[self.scroll_offset:self.scroll_offset + visible_items]):
            rect = pygame.Rect(5, y + i * item_h, self.width - 10, item_h - 4)
            if rect.collidepoint(pos):
                self.selected_network = net
                if net['secured']:
                    self.state = self.STATE_PASSWORD
                    self.keyboard.show()
                else:
                    self._do_connect(None)
                return False

        return False

    def _handle_password_touch(self, pos):
        result = self.keyboard.handle_touch(pos)
        if result == 'OK':
            password = self.keyboard.text
            self.keyboard.hide()
            self._do_connect(password)
        return False

    def _do_connect(self, password):
        self.state = self.STATE_CONNECTING

        def connect():
            ok, msg = connect_wifi(self.selected_network['ssid'], password)
            self.result_ok = ok
            self.result_msg = msg if not ok else self.selected_network['ssid']
            self.state = self.STATE_RESULT

        threading.Thread(target=connect, daemon=True).start()
