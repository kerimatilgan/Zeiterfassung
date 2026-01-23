#!/usr/bin/env python3
"""
Display-Modul für das RFID-Terminal
Aktuell nur Konsolen-Ausgabe, vorbereitet für LCD-Display
"""

import time


class Display:
    """
    Display-Abstraktionsschicht

    Aktuell: Nur Konsolen-Ausgabe
    Später erweiterbar für:
    - I2C LCD (16x2, 20x4)
    - OLED-Displays
    - LED-Matrix
    """

    def __init__(self, enabled=False, lcd_type=None):
        """
        Initialisiert das Display

        Args:
            enabled: True wenn Hardware-Display aktiviert
            lcd_type: Typ des LCD-Displays (für spätere Erweiterung)
        """
        self.enabled = enabled
        self.lcd = None
        self.lcd_type = lcd_type

        if enabled and lcd_type:
            self._init_lcd(lcd_type)

    def _init_lcd(self, lcd_type):
        """
        Initialisiert das LCD-Display (für spätere Erweiterung)

        Unterstützte Typen:
        - 'i2c_16x2': Standard I2C 16x2 LCD
        - 'i2c_20x4': I2C 20x4 LCD
        - 'oled_ssd1306': OLED mit SSD1306 Controller
        """
        try:
            if lcd_type == 'i2c_16x2':
                # Beispiel für spätere Implementierung:
                # from RPLCD.i2c import CharLCD
                # self.lcd = CharLCD('PCF8574', 0x27)
                pass
            elif lcd_type == 'oled_ssd1306':
                # Beispiel für OLED:
                # from luma.oled.device import ssd1306
                # from luma.core.interface.serial import i2c
                # serial = i2c(port=1, address=0x3C)
                # self.lcd = ssd1306(serial)
                pass

            if self.lcd:
                print(f"[DISPLAY] LCD initialisiert: {lcd_type}")
        except Exception as e:
            print(f"[DISPLAY] Fehler bei LCD-Initialisierung: {e}")
            self.lcd = None

    def show(self, line1, line2="", duration=0):
        """
        Zeigt Text auf dem Display an

        Args:
            line1: Erste Zeile (max. 16 Zeichen bei Standard-LCD)
            line2: Zweite Zeile (optional)
            duration: Anzeigedauer in Sekunden (0 = dauerhaft)
        """
        # Konsolen-Ausgabe (immer aktiv)
        timestamp = time.strftime("%H:%M:%S")
        print(f"[{timestamp}] {line1}")
        if line2:
            print(f"           {line2}")

        # LCD-Ausgabe (wenn aktiviert)
        if self.lcd and self.enabled:
            try:
                self._write_to_lcd(line1, line2)
            except Exception as e:
                print(f"[DISPLAY] LCD-Fehler: {e}")

        # Anzeigedauer
        if duration > 0:
            time.sleep(duration)
            if self.lcd and self.enabled:
                self.clear()

    def _write_to_lcd(self, line1, line2):
        """Schreibt Text auf das LCD (interne Methode)"""
        if not self.lcd:
            return

        # Text auf Display-Breite kürzen
        max_width = 16  # Standard für 16x2 LCD
        line1 = line1[:max_width].ljust(max_width)
        line2 = line2[:max_width].ljust(max_width)

        # Beispiel für CharLCD:
        # self.lcd.clear()
        # self.lcd.write_string(line1)
        # self.lcd.cursor_pos = (1, 0)
        # self.lcd.write_string(line2)

    def clear(self):
        """Löscht das Display"""
        if self.lcd and self.enabled:
            try:
                # self.lcd.clear()
                pass
            except:
                pass

    def backlight(self, state):
        """
        Schaltet die Hintergrundbeleuchtung ein/aus

        Args:
            state: True für an, False für aus
        """
        if self.lcd and self.enabled:
            try:
                # self.lcd.backlight_enabled = state
                pass
            except:
                pass

    def show_clock_in(self, name, time_str=None):
        """Zeigt Einstempel-Nachricht"""
        if time_str is None:
            time_str = time.strftime("%H:%M")
        self.show("Eingestempelt", f"{name[:10]} {time_str}", duration=3)

    def show_clock_out(self, name, hours_worked):
        """Zeigt Ausstempel-Nachricht"""
        self.show("Ausgestempelt", f"{name[:8]} {hours_worked}h", duration=3)

    def show_error(self, error_msg):
        """Zeigt Fehlermeldung"""
        self.show("FEHLER", error_msg[:16], duration=3)

    def show_ready(self):
        """Zeigt Bereit-Nachricht"""
        self.show("Bereit", "Karte vorhalten")
