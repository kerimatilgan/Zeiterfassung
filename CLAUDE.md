# Zeiterfassung - Projektdokumentation

## Projektübersicht

Eine Zeiterfassungs-Anwendung mit RFID-Terminal für Raspberry Pi, bestehend aus:
- **Backend**: Node.js/Express mit Prisma ORM (SQLite)
- **Frontend**: React mit Vite, TailwindCSS
- **Pi-Terminal**: Python-basierte RFID-Leser mit HDMI-Display (Pygame)

## Projektstruktur

```
Zeiterfassung/
├── backend/           # Node.js Express Backend
│   ├── src/
│   │   ├── routes/    # API-Endpunkte
│   │   ├── middleware/ # Auth-Middleware
│   │   └── utils/     # Hilfsfunktionen
│   ├── prisma/        # Datenbank-Schema & Migrationen
│   └── uploads/       # Hochgeladene Dateien (Fotos)
├── frontend/          # React Vite Frontend
│   ├── src/
│   │   ├── pages/     # Seitenkomponenten
│   │   ├── components/ # Wiederverwendbare Komponenten
│   │   ├── lib/       # API-Client, Utilities
│   │   └── store/     # Zustand (Zustand)
│   └── vite.config.ts
└── pi-terminal/       # Raspberry Pi Terminal
    ├── terminal.py    # RFID-Leser Hauptprogramm
    ├── hdmi_display.py # Pygame HDMI-Anzeige
    ├── api_client.py  # Backend-Kommunikation
    ├── offline_queue.py # Offline-Warteschlange
    └── config.json    # Konfiguration
```

## Technologie-Stack

### Backend
- **Runtime**: Node.js 20+
- **Framework**: Express.js
- **ORM**: Prisma mit SQLite
- **Auth**: JWT (jsonwebtoken)
- **File Upload**: Multer
- **WebSocket**: Socket.io
- **Port**: 3004

### Frontend
- **Framework**: React 18 mit TypeScript
- **Build-Tool**: Vite
- **Styling**: TailwindCSS
- **State Management**: Zustand
- **HTTP Client**: Axios
- **Port**: 5175 (Dev)

### Pi-Terminal
- **Sprache**: Python 3
- **Display**: Pygame (Fullscreen)
- **RFID**: RC522 via SPI
- **WebSocket**: python-socketio
- **Bildverarbeitung**: PIL/Pillow

## Entwicklung starten

### Backend
```bash
cd backend
npm install
npx prisma generate
npx prisma db push
npm run dev
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

### Pi-Terminal (lokal testen)
```bash
cd pi-terminal
pip install -r requirements.txt
python hdmi_display.py
```

## PM2 Prozesse

```bash
pm2 list                          # Alle Prozesse anzeigen
pm2 restart zeiterfassung-backend  # Backend neustarten
pm2 restart zeiterfassung-frontend # Frontend neustarten
pm2 logs zeiterfassung-backend     # Backend-Logs
```

## Raspberry Pi Deployment

**Pi IP-Adresse:** `192.168.8.157` (User: `pi`)
**Terminal-Verzeichnis auf Pi:** `~/zeiterfassung-terminal/`

### Dateien auf Pi kopieren
```bash
scp pi-terminal/*.py pi@192.168.8.157:~/zeiterfassung-terminal/
```

### Dienste auf Pi neustarten
```bash
ssh pi@192.168.8.157 "sudo systemctl restart zeiterfassung-display zeiterfassung-terminal"
```

### Logs auf Pi anzeigen
```bash
ssh pi@192.168.8.157 "journalctl -u zeiterfassung-display -f"
ssh pi@192.168.8.157 "journalctl -u zeiterfassung-terminal -f"
```

## API-Endpunkte

### Terminal-API (mit API-Key Auth)
- `POST /api/terminal/scan` - RFID/QR-Code scannen (Ein-/Ausstempeln)
- `GET /api/terminal/active` - Aktuell eingestempelte Mitarbeiter
- `GET /api/terminal/status/:qrCode` - Mitarbeiter-Status

### Mitarbeiter-API (JWT Auth)
- `GET /api/employees` - Alle Mitarbeiter
- `POST /api/employees/:id/photo` - Foto hochladen
- `DELETE /api/employees/:id/photo` - Foto löschen
- `POST /api/employees/:id/register-rfid` - RFID-Karte zuweisen

### RFID-Registrierung (Admin)
- `POST /api/terminal/register-rfid/start` - Registrierungsmodus starten
- `POST /api/terminal/register-rfid/stop` - Registrierungsmodus stoppen

## Datenbank-Schema (Prisma)

### Employee (Mitarbeiter)
```prisma
model Employee {
  id                  String   @id @default(uuid())
  employeeNumber      String   @unique
  firstName           String
  lastName            String
  email               String?  @unique
  phone               String?
  photoUrl            String?  // Pfad zum Foto
  qrCode              String   @unique
  rfidCard            String?  @unique
  pin                 String?
  weeklyHours         Float    @default(40.0)
  vacationDaysPerYear Int      @default(30)
  workDays            String   @default("1,2,3,4,5")
  isActive            Boolean  @default(true)
  isAdmin             Boolean  @default(false)
}
```

### TimeEntry (Zeitbuchung)
```prisma
model TimeEntry {
  id           String    @id @default(uuid())
  employeeId   String
  clockIn      DateTime
  clockOut     DateTime?
  breakMinutes Int       @default(0)
}
```

## Wichtige Konfigurationen

### Backend (.env)
```
DATABASE_URL="file:./dev.db"
JWT_SECRET="your-secret"
TERMINAL_API_KEY="handy-insel-terminal-key-2024"
PORT=3004
```

### Pi-Terminal (config.json)
```json
{
  "backend_url": "http://10.10.0.98:3004",
  "api_key": "handy-insel-terminal-key-2024",
  "display_enabled": true
}
```

### Vite Proxy (vite.config.ts)
```typescript
proxy: {
  '/api': { target: 'http://localhost:3004', changeOrigin: true },
  '/uploads': { target: 'http://localhost:3004', changeOrigin: true }
}
```

## Features

### Implementiert
- [x] Mitarbeiter-Verwaltung (CRUD)
- [x] RFID-Karten-Registrierung (Live-Scan vom Pi)
- [x] Ein-/Ausstempeln via RFID
- [x] Mitarbeiter-Fotos (Upload, Anzeige im Terminal)
- [x] HDMI-Display mit Uhrzeit, aktiven Mitarbeitern
- [x] Offline-Queue bei Netzwerkausfall
- [x] WebSocket-Events für Live-Updates
- [x] Audit-Logging
- [x] Monatsberichte mit PDF-Export
- [x] Feiertage & Abwesenheiten
- [x] Mehrtägige Einträge (automatische Tagesaufteilung)

### Mehrtägige Einträge (Multi-Day Split)
Wenn ein Mitarbeiter über mehrere Tage eingestempelt bleibt:
- Beim Ausstempeln wird der Eintrag automatisch in Tageseinträge aufgeteilt
- Verwendet deutsche Lokalzeit (CET/CEST) für Tagesgrenzen
- Erster Tag: Einstempelzeit bis 23:59:59 Lokalzeit
- Mittlere Tage: 00:00:00 bis 23:59:59 Lokalzeit (volle 24h)
- Letzter Tag: 00:00:00 Lokalzeit bis Ausstempelzeit
- Automatische Pausenberechnung pro Tag (>6h = 30min Pause)
- Automatische Sommer-/Winterzeit-Erkennung
- Implementiert in: `backend/src/routes/terminal.ts` → `splitMultiDayEntry()`, `getGermanTimezoneOffset()`

### Foto-Feature Details
- Upload via Admin-UI (Hover über Avatar)
- Speicherung in `/uploads/photos/`
- EXIF-Orientierung wird korrigiert (PIL)
- Quadratischer Zuschnitt, kreisförmige Anzeige
- Caching auf Pi (Memory + Datei-Cache)
- Anzeige beim Ein-/Ausstempeln (150px Durchmesser)

## Fehlerbehebung

### Backend startet nicht
```bash
# Prüfe ob Port belegt
lsof -i :3004
# Alte Prozesse beenden
kill -9 <PID>
pm2 restart zeiterfassung-backend
```

### Foto wird im Frontend nicht angezeigt
- Prüfe ob `/uploads` Proxy in vite.config.ts konfiguriert ist
- Frontend neu starten nach Proxy-Änderung

### Foto auf Pi falsch orientiert
- PIL/Pillow muss installiert sein: `pip install Pillow`
- Photo-Cache leeren: `rm -rf ~/zeiterfassung-terminal/.photo_cache/*`
- Display-Service neustarten

### Pi verbindet sich nicht
- Backend-URL in config.json prüfen
- API-Key prüfen
- Firewall-Regeln prüfen (Port 3004)
