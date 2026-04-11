import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { prisma } from '../index.js';
import { z } from 'zod';
import { getBundeslandFromPLZ, extractPLZFromAddress, getGermanHolidays, BUNDESLAND_NAMES, Bundesland } from '../utils/germanHolidays.js';

const router = Router();

// Prüfen ob Setup nötig ist (kein Auth erforderlich)
router.get('/status', async (_req: Request, res: Response) => {
  try {
    const employeeCount = await prisma.employee.count();
    res.json({ needsSetup: employeeCount === 0 });
  } catch (error) {
    res.status(500).json({ error: 'Fehler beim Prüfen des Setup-Status' });
  }
});

const setupSchema = z.object({
  // Firma
  companyName: z.string().min(1, 'Firmenname erforderlich'),
  companyAddress: z.string().optional(),
  companyPhone: z.string().optional(),
  companyEmail: z.string().email().optional().or(z.literal('')),
  // E-Mail-Server
  smtpHost: z.string().optional(),
  smtpPort: z.number().optional(),
  smtpUser: z.string().optional(),
  smtpPassword: z.string().optional(),
  smtpFromAddress: z.string().optional(),
  smtpFromName: z.string().optional(),
  smtpSecure: z.boolean().optional(),
  // Admin
  firstName: z.string().min(1, 'Vorname erforderlich'),
  lastName: z.string().min(1, 'Nachname erforderlich'),
  username: z.string().min(3, 'Benutzername muss mindestens 3 Zeichen haben'),
  email: z.string().email('Ungültige E-Mail').optional().or(z.literal('')),
  password: z.string().min(6, 'Passwort muss mindestens 6 Zeichen haben'),
});

// Standard-Abwesenheitstypen
const DEFAULT_ABSENCE_TYPES = [
  { name: 'Urlaub', shortName: 'Urlaub', requiredHours: 0, color: '#3B82F6', sortOrder: 0 },
  { name: 'Krank', shortName: 'Krank', requiredHours: 0, color: '#ff3333', sortOrder: 1 },
  { name: 'Berufschule ganzer Tag', shortName: 'Schule 1', requiredHours: 0, color: '#5ffb37', sortOrder: 2 },
  { name: 'Schule halber Tag', shortName: 'Schule 1/2', requiredHours: 4, color: '#bbb100', sortOrder: 3 },
  { name: 'Ü-frei', shortName: 'Ü-Frei', requiredHours: 8, color: '#39e6f9', sortOrder: 4 },
];

// Ersteinrichtung durchführen
router.post('/complete', async (req: Request, res: Response) => {
  try {
    const employeeCount = await prisma.employee.count();
    if (employeeCount > 0) {
      return res.status(400).json({ error: 'Einrichtung bereits abgeschlossen' });
    }

    const data = setupSchema.parse(req.body);

    // 1. Settings aktualisieren
    const settingsData: any = {
      companyName: data.companyName,
      companyAddress: data.companyAddress || null,
      companyPhone: data.companyPhone || null,
      companyEmail: data.companyEmail || null,
    };
    // SMTP nur wenn Host angegeben
    if (data.smtpHost) {
      settingsData.smtpHost = data.smtpHost;
      settingsData.smtpPort = data.smtpPort || 587;
      settingsData.smtpUser = data.smtpUser || null;
      settingsData.smtpPassword = data.smtpPassword || null;
      settingsData.smtpFromAddress = data.smtpFromAddress || null;
      settingsData.smtpFromName = data.smtpFromName || 'Zeiterfassung';
      settingsData.smtpSecure = data.smtpSecure || false;
    }

    await prisma.settings.upsert({
      where: { id: 'default' },
      update: settingsData,
      create: { id: 'default', ...settingsData },
    });

    // 2. Admin-Account erstellen
    const passwordHash = await bcrypt.hash(data.password, 10);
    const admin = await prisma.employee.create({
      data: {
        employeeNumber: 'ADMIN',
        username: data.username,
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email || null,
        isAdmin: true,
        isActive: true,
        qrCode: crypto.randomUUID(),
        passwordHash,
      },
    });

    // 3. Standard-Abwesenheitstypen erstellen
    const absenceCount = await prisma.absenceType.count();
    if (absenceCount === 0) {
      for (const at of DEFAULT_ABSENCE_TYPES) {
        await prisma.absenceType.create({ data: at });
      }
      console.log('✅ Standard-Abwesenheitstypen erstellt');
    }

    // 4. Feiertage generieren (anhand PLZ aus Adresse)
    if (data.companyAddress) {
      const plz = extractPLZFromAddress(data.companyAddress);
      if (plz) {
        const bundesland = getBundeslandFromPLZ(plz);
        if (bundesland) {
          const year = new Date().getFullYear();
          const holidays = getGermanHolidays(year, bundesland);
          for (const h of holidays) {
            await prisma.holiday.create({
              data: { date: h.date, name: h.name, isRecurring: false },
            });
          }
          console.log(`✅ ${holidays.length} Feiertage für ${BUNDESLAND_NAMES[bundesland]} (${year}) erstellt`);
        }
      }
    }

    // 5. Standard-Terminal erstellen
    const terminalCount = await prisma.terminal.count();
    if (terminalCount === 0) {
      const terminalKey = crypto.randomBytes(32).toString('hex');
      await prisma.terminal.create({
        data: { name: 'Standard-Terminal', apiKey: terminalKey },
      });
      console.log('✅ Standard-Terminal erstellt');
    }

    console.log(`✅ Ersteinrichtung abgeschlossen: Admin "${admin.username}" erstellt`);

    res.json({
      success: true,
      message: 'Einrichtung erfolgreich abgeschlossen',
      admin: { username: admin.username, firstName: admin.firstName, lastName: admin.lastName },
    });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: error.errors[0].message });
    }
    console.error('Setup error:', error);
    res.status(500).json({ error: error.message || 'Fehler bei der Einrichtung' });
  }
});

// Terminal Install-Script (öffentlich, kein Auth - wird per curl aufgerufen)
router.get('/terminal-install/:id', async (req: Request, res: Response) => {
  try {
    const terminal = await prisma.terminal.findUnique({ where: { id: req.params.id } });
    if (!terminal) return res.status(404).send('# Fehler: Terminal nicht gefunden\nexit 1\n');

    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const backendUrl = `${protocol}://${host}`;
    const apiKey = terminal.apiKey;
    const name = terminal.name;

    const script = `#!/bin/bash
#
# Zeiterfassung Terminal - Schnellinstallation
# Terminal: ${name}
#
set -e

echo ""
echo "========================================"
echo "  Zeiterfassung Terminal Installation"
echo "  Terminal: ${name}"
echo "========================================"
echo ""

BACKEND_URL="${backendUrl}"
API_KEY="${apiKey}"
INSTALL_DIR="\$HOME/zeiterfassung-terminal"

# 0. Zeitzone setzen
echo "[1/8] Zeitzone setzen..."
sudo timedatectl set-timezone Europe/Berlin
echo "  Zeitzone: \$(timedatectl show -p Timezone --value) ✓"

# 1. System-Pakete
echo "[2/8] System-Pakete installieren..."
sudo apt-get update -qq
sudo apt-get install -y python3 python3-pip python3-dev python3-pygame python3-pil libpcsclite-dev pcscd pcsc-tools swig libsdl2-dev libsdl2-2.0-0

# 2. Python-Pakete
echo "[3/8] Python-Pakete installieren..."
# Pygame aus System-Paketen (hat KMS/DRM Support), Rest per pip
sudo pip3 install --break-system-packages requests evdev 'python-socketio[client]' websocket-client pyscard qrcode 2>/dev/null || \
pip3 install --user --break-system-packages requests evdev 'python-socketio[client]' websocket-client pyscard 2>/dev/null || \
pip3 install --user requests evdev 'python-socketio[client]' websocket-client
# Falls System-Pygame nicht vorhanden, per pip mit nativer SDL2 kompilieren
python3 -c "import pygame" 2>/dev/null || sudo pip3 install --break-system-packages --no-binary pygame pygame

# 3. Terminal-Dateien herunterladen
echo "[4/8] Terminal-Software herunterladen..."
mkdir -p "\$INSTALL_DIR"
cd "\$INSTALL_DIR"

BASE="${backendUrl}/api/setup/terminal-files"
for f in terminal.py api_client.py offline_queue.py display.py hdmi_display.py notify_display.py wifi_setup.py wifi_web.py; do
  curl -sf "\$BASE/\$f" -o "\$INSTALL_DIR/\$f" 2>/dev/null && echo "  \$f ✓" || echo "  \$f ✗ (nicht verfügbar)"
done

# 4. Config erstellen
echo "[5/8] Konfiguration erstellen..."
cat > "\$INSTALL_DIR/config.json" << CONF
{
  "backend_url": "\$BACKEND_URL",
  "api_key": "\$API_KEY",
  "display_enabled": false
}
CONF
echo "  config.json ✓"

# 5. Kartenleser erkennen und konfigurieren
echo "[6/8] Kartenleser erkennen..."
sudo usermod -aG video,input,render,plugdev \$USER 2>/dev/null

# Alle USB Input-Geräte und NFC-Reader erkennen
echo ""
echo "Erkannte Geräte:"
echo "──────────────────────────────────────"
DEVNUM=0
declare -a USB_DEVICES
declare -a USB_PATHS
declare -a USB_TYPES

# Alle /dev/input/event* Geräte auflisten (USB + eingebaut)
for devpath in /dev/input/event*; do
  [ -e "\$devpath" ] || continue
  SYSBASE="/sys/class/input/\$(basename \$devpath)/device"
  devname=\$(cat "\$SYSBASE/name" 2>/dev/null || echo "")
  [ -z "\$devname" ] && continue

  # Eingebaute Geräte überspringen (HDMI, Power-Button, GPIO)
  echo "\$devname" | grep -qi "hdmi\\|power\\|pwr_button\\|gpio\\|vc4" && continue

  DEVNUM=\$((DEVNUM + 1))
  USB_DEVICES[\$DEVNUM]="\$devname"
  USB_PATHS[\$DEVNUM]="\$devpath"
  USB_TYPES[\$DEVNUM]="keyboard"

  # Typ bestimmen
  DEVTYPE="USB HID"
  echo "\$devname" | grep -qi "rfid\\|reader\\|sycreader\\|card" && DEVTYPE="RFID Reader"
  echo "\$devname" | grep -qi "barcode\\|scanner" && DEVTYPE="Barcode Scanner"

  echo "  [\$DEVNUM] \$devname (\$DEVTYPE) - \$devpath"
done

# NFC/Smartcard Reader (ACR122U etc.) via pcscd
sudo systemctl start pcscd 2>/dev/null
sudo usermod -aG scard \$USER 2>/dev/null || true
# Polkit-Regel für PC/SC Zugriff ohne Root
sudo mkdir -p /etc/polkit-1/rules.d
echo 'polkit.addRule(function(action, subject) { if (action.id == "org.debian.pcsc-lite.access_pcsc" || action.id == "org.debian.pcsc-lite.access_card") { return polkit.Result.YES; } });' | sudo tee /etc/polkit-1/rules.d/99-pcscd.rules > /dev/null
sudo systemctl restart pcscd 2>/dev/null
sleep 1
PCSC_OUTPUT=\$(timeout 3 python3 -c "
try:
    from smartcard.System import readers
    for r in readers():
        print(str(r))
except: pass
" 2>/dev/null || echo "")

if [ -n "\$PCSC_OUTPUT" ]; then
  while IFS= read -r reader; do
    [ -z "\$reader" ] && continue
    DEVNUM=\$((DEVNUM + 1))
    USB_DEVICES[\$DEVNUM]="\$reader"
    USB_PATHS[\$DEVNUM]="pcsc"
    USB_TYPES[\$DEVNUM]="nfc"
    echo "  [\$DEVNUM] \$reader (NFC/PC/SC)"
  done <<< "\$PCSC_OUTPUT"
fi

echo "──────────────────────────────────────"

SELECTED_READERS=""
if [ \$DEVNUM -gt 0 ]; then
  echo ""
  echo "Welche Geräte sollen als Kartenleser verwendet werden?"
  echo "Mehrere mit Komma trennen (z.B. 1,3) oder 'alle' für alle:"
  printf "> "
  read READER_CHOICE < /dev/tty

  if [ "\$READER_CHOICE" = "alle" ] || [ "\$READER_CHOICE" = "all" ]; then
    for i in \$(seq 1 \$DEVNUM); do
      if [ -n "\$SELECTED_READERS" ]; then SELECTED_READERS="\$SELECTED_READERS,"; fi
      SELECTED_READERS="\$SELECTED_READERS\${USB_TYPES[\$i]}:\${USB_PATHS[\$i]}:\${USB_DEVICES[\$i]}"
    done
  else
    IFS=',' read -ra CHOICES <<< "\$READER_CHOICE"
    for choice in "\${CHOICES[@]}"; do
      choice=\$(echo "\$choice" | tr -d ' ')
      if [ "\$choice" -ge 1 ] 2>/dev/null && [ "\$choice" -le \$DEVNUM ]; then
        if [ -n "\$SELECTED_READERS" ]; then SELECTED_READERS="\$SELECTED_READERS,"; fi
        SELECTED_READERS="\$SELECTED_READERS\${USB_TYPES[\$choice]}:\${USB_PATHS[\$choice]}:\${USB_DEVICES[\$choice]}"
        echo "  ✓ \${USB_DEVICES[\$choice]}"
      fi
    done
  fi
else
  echo "  Keine Kartenleser erkannt."
  echo "  Bitte schließe einen USB-Kartenleser an und starte das Script erneut."
fi

# Kartenleser-Config in config.json speichern
if [ -n "\$SELECTED_READERS" ]; then
  python3 -c "
import json
with open('\$INSTALL_DIR/config.json', 'r') as f:
    cfg = json.load(f)
readers = []
for entry in '\$SELECTED_READERS'.split(','):
    parts = entry.split(':', 2)
    if len(parts) == 3:
        readers.append({'type': parts[0], 'path': parts[1], 'name': parts[2]})
cfg['readers'] = readers
with open('\$INSTALL_DIR/config.json', 'w') as f:
    json.dump(cfg, f, indent=2)
print(f'  {len(readers)} Kartenleser konfiguriert ✓')
"
fi

# 6. Systemd-Services
echo ""
echo "[7/8] Services einrichten..."

sudo tee /etc/systemd/system/zeiterfassung-terminal.service > /dev/null << SVC
[Unit]
Description=Zeiterfassung RFID Terminal
After=network.target

[Service]
Type=simple
User=\$USER
WorkingDirectory=\$INSTALL_DIR
ExecStart=/usr/bin/python3 \$INSTALL_DIR/terminal.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SVC

# Display-Starter-Script (KMS/DRM direkt, kein X-Server nötig)
DISPLAY_SCRIPT="\$INSTALL_DIR/start-display.sh"
cat > "\$DISPLAY_SCRIPT" << 'DEOF'
#!/bin/bash
cd "$(dirname "$0")"
exec python3 hdmi_display.py
DEOF
chmod +x "\$DISPLAY_SCRIPT"

sudo tee /etc/systemd/system/zeiterfassung-display.service > /dev/null << SVC
[Unit]
Description=Zeiterfassung HDMI Display
After=network.target

[Service]
Type=simple
User=\$USER
Group=video
SupplementaryGroups=input render
WorkingDirectory=\$INSTALL_DIR
ExecStartPre=/bin/sleep 5
ExecStart=\$INSTALL_DIR/start-display.sh
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SVC

sudo systemctl daemon-reload
sudo systemctl enable zeiterfassung-terminal zeiterfassung-display

# 7. Verbindung testen
echo ""
echo "[8/8] Verbindung testen..."
HEALTH=\$(curl -s -o /dev/null -w "%{http_code}" "\$BACKEND_URL/api/health" 2>/dev/null || echo "000")
if [ "\$HEALTH" = "200" ]; then
    echo "Backend erreichbar ✓"
else
    echo "⚠ Backend nicht erreichbar (HTTP \$HEALTH)"
fi

echo ""
echo "========================================"
echo "  Installation abgeschlossen!"
echo "========================================"
echo ""
echo "  Starten:  sudo systemctl start zeiterfassung-terminal"
echo "  Display:  sudo systemctl start zeiterfassung-display"
echo "  Logs:     journalctl -u zeiterfassung-terminal -f"
echo ""
`;

    res.setHeader('Content-Type', 'text/plain');
    res.send(script);
  } catch (error) {
    res.status(500).send('# Fehler beim Generieren\nexit 1\n');
  }
});

// Terminal-Dateien ausliefern (für Install-Script Download)
router.get('/terminal-files/:filename', async (req: Request, res: Response) => {
  const { filename } = req.params;
  const allowed = ['terminal.py', 'api_client.py', 'offline_queue.py', 'display.py', 'hdmi_display.py', 'notify_display.py', 'wifi_setup.py', 'wifi_web.py'];
  if (!allowed.includes(filename)) return res.status(404).send('Not found');

  const path = require('path');
  const fs = require('fs');

  // Suche in verschiedenen Pfaden
  const paths = [
    path.join(process.cwd(), '..', 'terminal-app', 'src', filename),
    path.join(process.cwd(), '..', 'pi-terminal', filename),
    path.join('/home/pi/zeiterfassung-terminal', filename),
    path.join('/tmp/pi-update', filename),
  ];

  for (const p of paths) {
    if (fs.existsSync(p)) {
      return res.sendFile(p);
    }
  }

  res.status(404).send('File not found');
});

export default router;
