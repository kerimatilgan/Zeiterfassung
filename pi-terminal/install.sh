#!/bin/bash
# ============================================
# Zeiterfassung Pi-Terminal Installer
# Interaktives Setup-Skript für neue Terminals
# ============================================

set -e

# Farben
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

INSTALL_DIR="/opt/zeiterfassung-terminal"

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║  ${BOLD}Zeiterfassung Pi-Terminal Installer${NC}${CYAN}         ║${NC}"
echo -e "${CYAN}║  Handy-Insel Stempelterminal Setup           ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════╝${NC}"
echo ""

# ============================================
# 1. Voraussetzungen prüfen
# ============================================
echo -e "${BLUE}[1/8] Prüfe Voraussetzungen...${NC}"

if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}Fehler: Bitte als root ausführen (sudo ./install.sh)${NC}"
    exit 1
fi

# Python3 prüfen
if ! command -v python3 &> /dev/null; then
    echo -e "${RED}Fehler: Python3 ist nicht installiert${NC}"
    echo "  Bitte installieren: sudo apt install python3 python3-pip"
    exit 1
fi

PYTHON_VERSION=$(python3 --version 2>&1 | cut -d' ' -f2)
echo -e "  ${GREEN}✓${NC} Python ${PYTHON_VERSION}"

# pip prüfen
if ! command -v pip3 &> /dev/null; then
    echo -e "${YELLOW}  pip3 nicht gefunden, installiere...${NC}"
    apt-get update -qq && apt-get install -y -qq python3-pip > /dev/null 2>&1
fi
echo -e "  ${GREEN}✓${NC} pip3 verfügbar"

echo ""

# ============================================
# 2. Abhängigkeiten installieren
# ============================================
echo -e "${BLUE}[2/8] Installiere Abhängigkeiten...${NC}"

apt-get update -qq > /dev/null 2>&1

# System-Pakete
echo "  Installiere System-Pakete..."
apt-get install -y -qq python3-evdev python3-requests pcscd pcsc-tools > /dev/null 2>&1
echo -e "  ${GREEN}✓${NC} System-Pakete installiert"

# Python-Pakete
echo "  Installiere Python-Pakete..."
pip3 install --quiet --break-system-packages requests pyscard 2>/dev/null || pip3 install --quiet requests pyscard 2>/dev/null || true
echo -e "  ${GREEN}✓${NC} Python-Pakete installiert"

# pygame (für HDMI Display)
pip3 install --quiet --break-system-packages pygame 2>/dev/null || pip3 install --quiet pygame 2>/dev/null || true
echo -e "  ${GREEN}✓${NC} Pygame installiert"

echo ""

# ============================================
# 3. Backend-URL abfragen
# ============================================
echo -e "${BLUE}[3/8] Server-Konfiguration${NC}"
echo ""

while true; do
    read -p "  Backend-URL (z.B. http://10.10.0.98:3004): " BACKEND_URL

    if [ -z "$BACKEND_URL" ]; then
        echo -e "  ${RED}Bitte eine URL eingeben${NC}"
        continue
    fi

    # Trailing slash entfernen
    BACKEND_URL="${BACKEND_URL%/}"

    echo -n "  Prüfe Verbindung... "
    if curl -s --connect-timeout 5 "${BACKEND_URL}/api/health" > /dev/null 2>&1; then
        echo -e "${GREEN}OK${NC}"
        break
    else
        echo -e "${RED}Nicht erreichbar${NC}"
        read -p "  Trotzdem fortfahren? (j/n): " CONTINUE
        if [ "$CONTINUE" = "j" ] || [ "$CONTINUE" = "J" ]; then
            break
        fi
    fi
done

echo ""

# ============================================
# 4. API-Key abfragen
# ============================================
echo -e "${BLUE}[4/8] Terminal API-Key${NC}"
echo ""
echo -e "  ${YELLOW}Hinweis: Den API-Key finden Sie in den Admin-Einstellungen${NC}"
echo -e "  ${YELLOW}unter 'Terminals' -> Terminal erstellen${NC}"
echo ""

while true; do
    read -p "  API-Key: " API_KEY

    if [ -z "$API_KEY" ]; then
        echo -e "  ${RED}Bitte einen API-Key eingeben${NC}"
        continue
    fi

    if [ ${#API_KEY} -lt 10 ]; then
        echo -e "  ${RED}API-Key scheint zu kurz zu sein${NC}"
        read -p "  Trotzdem verwenden? (j/n): " CONTINUE
        if [ "$CONTINUE" = "j" ] || [ "$CONTINUE" = "J" ]; then
            break
        fi
        continue
    fi

    break
done

echo ""

# ============================================
# 5. Verbindung testen
# ============================================
echo -e "${BLUE}[5/8] Teste Authentifizierung...${NC}"
echo -n "  "

HEARTBEAT_RESPONSE=$(curl -s --connect-timeout 5 \
    -X POST "${BACKEND_URL}/api/terminal/heartbeat" \
    -H "Content-Type: application/json" \
    -H "x-terminal-api-key: ${API_KEY}" 2>&1)

if echo "$HEARTBEAT_RESPONSE" | grep -q '"success":true'; then
    TERMINAL_NAME=$(echo "$HEARTBEAT_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('terminalName','Unbekannt'))" 2>/dev/null || echo "Unbekannt")
    echo -e "${GREEN}Authentifizierung erfolgreich!${NC}"
    echo -e "  Terminal: ${BOLD}${TERMINAL_NAME}${NC}"
else
    echo -e "${RED}Authentifizierung fehlgeschlagen!${NC}"
    echo "  Antwort: $HEARTBEAT_RESPONSE"
    read -p "  Trotzdem fortfahren? (j/n): " CONTINUE
    if [ "$CONTINUE" != "j" ] && [ "$CONTINUE" != "J" ]; then
        echo "Installation abgebrochen."
        exit 1
    fi
fi

echo ""

# ============================================
# 6. Display-Einstellung
# ============================================
echo -e "${BLUE}[6/8] HDMI Display-Konfiguration${NC}"
echo ""
echo "  Soll das HDMI-Display aktiviert werden?"
echo "  (Stempelterminal-Anzeige auf dem Bildschirm)"
echo ""

read -p "  HDMI-Display aktivieren? (j/n) [j]: " ENABLE_DISPLAY
ENABLE_DISPLAY=${ENABLE_DISPLAY:-j}

if [ "$ENABLE_DISPLAY" = "j" ] || [ "$ENABLE_DISPLAY" = "J" ]; then
    DISPLAY_ENABLED=true
    echo -e "  ${GREEN}✓${NC} HDMI-Display wird aktiviert"
else
    DISPLAY_ENABLED=false
    echo -e "  ${YELLOW}✓${NC} HDMI-Display deaktiviert"
fi

echo ""

# ============================================
# 7. Installation
# ============================================
echo -e "${BLUE}[7/8] Installiere Terminal-Software...${NC}"

# Installationsverzeichnis erstellen
mkdir -p "$INSTALL_DIR"
echo -e "  ${GREEN}✓${NC} Verzeichnis: ${INSTALL_DIR}"

# Dateien kopieren
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "  Kopiere Dateien..."
for file in terminal.py api_client.py hdmi_display.py offline_queue.py display.py; do
    if [ -f "${SCRIPT_DIR}/${file}" ]; then
        cp "${SCRIPT_DIR}/${file}" "${INSTALL_DIR}/"
        echo -e "  ${GREEN}✓${NC} ${file}"
    else
        echo -e "  ${YELLOW}!${NC} ${file} nicht gefunden (übersprungen)"
    fi
done

# NFC Reader Skript kopieren falls vorhanden
if [ -f "${SCRIPT_DIR}/nfc_reader.py" ]; then
    cp "${SCRIPT_DIR}/nfc_reader.py" "${INSTALL_DIR}/"
    echo -e "  ${GREEN}✓${NC} nfc_reader.py"
fi

# config.json generieren
cat > "${INSTALL_DIR}/config.json" << EOF
{
    "backend_url": "${BACKEND_URL}",
    "api_key": "${API_KEY}",
    "display_enabled": ${DISPLAY_ENABLED}
}
EOF
echo -e "  ${GREEN}✓${NC} config.json erstellt"

# Offline-Queue Verzeichnis erstellen
mkdir -p "${INSTALL_DIR}/offline_data"
echo -e "  ${GREEN}✓${NC} Offline-Queue Verzeichnis erstellt"

echo ""

# ============================================
# 8. Systemd Services
# ============================================
echo -e "${BLUE}[8/8] Richte Systemd-Services ein...${NC}"

# Terminal Service
cat > /etc/systemd/system/zeiterfassung-terminal.service << EOF
[Unit]
Description=Zeiterfassung RFID Terminal
After=network.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${INSTALL_DIR}
ExecStart=/usr/bin/python3 ${INSTALL_DIR}/terminal.py
Restart=always
RestartSec=5
User=root
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
EOF
echo -e "  ${GREEN}✓${NC} zeiterfassung-terminal.service erstellt"

# HDMI Display Service
if [ "$DISPLAY_ENABLED" = "true" ]; then
    cat > /etc/systemd/system/zeiterfassung-display.service << EOF
[Unit]
Description=Zeiterfassung HDMI Display
After=network.target zeiterfassung-terminal.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${INSTALL_DIR}
ExecStart=/usr/bin/python3 ${INSTALL_DIR}/hdmi_display.py
Restart=always
RestartSec=5
User=root
Environment=PYTHONUNBUFFERED=1
Environment=DISPLAY=:0
Environment=SDL_VIDEODRIVER=kmsdrm

[Install]
WantedBy=multi-user.target
EOF
    echo -e "  ${GREEN}✓${NC} zeiterfassung-display.service erstellt"
fi

# Services aktivieren und starten
systemctl daemon-reload
systemctl enable zeiterfassung-terminal.service
echo -e "  ${GREEN}✓${NC} Terminal-Service aktiviert"

if [ "$DISPLAY_ENABLED" = "true" ]; then
    systemctl enable zeiterfassung-display.service
    echo -e "  ${GREEN}✓${NC} Display-Service aktiviert"
fi

# Services starten
echo ""
echo "  Starte Services..."
systemctl start zeiterfassung-terminal.service 2>/dev/null || true
echo -e "  ${GREEN}✓${NC} Terminal-Service gestartet"

if [ "$DISPLAY_ENABLED" = "true" ]; then
    systemctl start zeiterfassung-display.service 2>/dev/null || true
    echo -e "  ${GREEN}✓${NC} Display-Service gestartet"
fi

# ============================================
# Zusammenfassung
# ============================================
echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║  ${GREEN}${BOLD}Installation abgeschlossen!${NC}${CYAN}                 ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${BOLD}Konfiguration:${NC}"
echo -e "    Server:     ${BACKEND_URL}"
echo -e "    Display:    $([ "$DISPLAY_ENABLED" = "true" ] && echo "Aktiviert" || echo "Deaktiviert")"
echo -e "    Verzeichnis: ${INSTALL_DIR}"
echo ""
echo -e "  ${BOLD}Nützliche Befehle:${NC}"
echo -e "    ${CYAN}systemctl status zeiterfassung-terminal${NC}   - Terminal-Status"
echo -e "    ${CYAN}journalctl -fu zeiterfassung-terminal${NC}     - Terminal-Logs"
if [ "$DISPLAY_ENABLED" = "true" ]; then
    echo -e "    ${CYAN}systemctl status zeiterfassung-display${NC}    - Display-Status"
    echo -e "    ${CYAN}journalctl -fu zeiterfassung-display${NC}      - Display-Logs"
fi
echo -e "    ${CYAN}systemctl restart zeiterfassung-terminal${NC}  - Terminal neustarten"
echo ""
echo -e "  ${YELLOW}Hinweis: Falls der RFID-Reader nicht erkannt wird,${NC}"
echo -e "  ${YELLOW}starten Sie den Raspberry Pi einmal neu: sudo reboot${NC}"
echo ""
