# Zeiterfassung - Handy-Insel

Ein vollständiges Zeiterfassungssystem für kleine bis mittlere Unternehmen mit QR-Code-basierter Stempeluhr.

## Features

### Admin-Dashboard
- Mitarbeiterverwaltung (anlegen, bearbeiten, deaktivieren)
- QR-Code-Generierung für jeden Mitarbeiter
- Zeiteinträge einsehen und bearbeiten
- Monatsabrechnungen erstellen und als PDF exportieren
- Überstunden-Tracking
- Feiertage verwalten

### Mitarbeiter-Dashboard
- Eigene Arbeitsstunden einsehen
- Monatsübersicht mit Kalenderansicht
- Abrechnungen als PDF herunterladen
- Aktueller Status (ein-/ausgestempelt)

### Terminal-App (Stempeluhr)
- QR-Code Scanner für Ein-/Ausstempeln
- PWA - läuft auf jedem Tablet/Smartphone
- Zeigt aktuell eingestempelte Mitarbeiter
- Automatische Pausenberechnung

## Technologie-Stack

- **Backend**: Node.js, Express, TypeScript, Prisma ORM
- **Datenbank**: SQLite (einfach zu deployen, keine extra Services nötig)
- **Frontend**: React, TypeScript, Vite, TailwindCSS
- **Terminal-App**: React PWA mit ZXing für QR-Code Scanning

## Installation

### Voraussetzungen
- Node.js 18+
- npm oder yarn

### Setup

```bash
# Repository klonen
git clone <repository-url>
cd Zeiterfassung

# Dependencies installieren
npm install

# Backend initialisieren
cd backend
npm install
npx prisma generate
npx prisma db push

# Demo-Daten einspielen (optional)
npx tsx src/seed.ts

# Zurück zum Root
cd ..

# Frontend installieren
cd frontend
npm install
cd ..

# Terminal-App installieren
cd terminal-app
npm install
cd ..
```

### Starten

```bash
# Alle Services starten (Backend + Frontend)
npm run dev

# Oder einzeln:
npm run backend    # Backend auf Port 3001
npm run frontend   # Frontend auf Port 5173
npm run terminal   # Terminal-App auf Port 5174
```

## Zugangsdaten (Demo)

Nach dem Ausführen des Seed-Skripts:

| Rolle | Mitarbeiternummer | Passwort |
|-------|-------------------|----------|
| Admin | ADMIN | admin123 |
| Mitarbeiter | 001 | demo123 |
| Mitarbeiter | 002 | demo123 |
| Mitarbeiter | 003 | demo123 |

## Terminal-App einrichten

1. Terminal-App im Browser öffnen: `http://<server-ip>:5174`
2. Auf Android-Tablet: "Zum Startbildschirm hinzufügen" für Vollbild-Modus
3. Kamera-Berechtigung erteilen
4. QR-Code-Badges für Mitarbeiter ausdrucken (Im Admin → Mitarbeiter → QR-Code Icon)

## API-Dokumentation

### Terminal API

Für die Stempeluhr-Integration:

```bash
# Ein-/Ausstempeln per QR-Code
POST /api/terminal/scan
Header: x-terminal-api-key: handy-insel-terminal-key-2024
Body: { "qrCode": "HI-001-abc12345" }

# Aktuell eingestempelte Mitarbeiter
GET /api/terminal/active
Header: x-terminal-api-key: handy-insel-terminal-key-2024
```

## Umgebungsvariablen

```env
# Backend
PORT=3001
JWT_SECRET=your-secret-key
TERMINAL_API_KEY=your-terminal-api-key

# Datenbank (Standard: SQLite in backend/prisma/)
DATABASE_URL="file:./zeiterfassung.db"
```

## Deployment

### Docker (empfohlen)

```bash
docker-compose up -d
```

### Manuell

1. Backend bauen: `cd backend && npm run build`
2. Frontend bauen: `cd frontend && npm run build`
3. Terminal-App bauen: `cd terminal-app && npm run build`
4. Backend starten: `cd backend && npm start`
5. Frontend/Terminal mit nginx oder ähnlichem servieren

## Lizenz

MIT

## Support

Bei Fragen oder Problemen bitte ein Issue erstellen.
