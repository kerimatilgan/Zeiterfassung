# Zeiterfassung

Webbasiertes Zeiterfassungssystem mit RFID-Stempeluhr für kleine und mittlere Unternehmen. Läuft on-premise oder self-hosted, Daten bleiben in der eigenen SQLite-Datenbank.

## Funktionen

### Admin
- Mitarbeiter anlegen/bearbeiten inkl. Foto und RFID-Karte
- Monatliche Zeit-Übersicht pro Mitarbeiter (Kalenderansicht, Einträge editierbar)
- Monats-Abrechnungen als PDF (mit optionalem Minusstunden-Urlaubsausgleich, Warnung bei negativem Saldo)
- Urlaubs- und Abwesenheitsverwaltung (mit automatischem Jahresübertrag)
- Manuelle Urlaubsanpassungen mit Warnung bei Minus-Saldo
- Feiertage pflegen (pro Bundesland vorbefüllbar)
- Reklamationen / Klärfälle mit Historie
- Dokumente pro Mitarbeiter (AES-256-GCM verschlüsselt at rest)
- Audit-Log aller sicherheitsrelevanten Aktionen
- Mehrere Terminals verwalten, API-Keys rotieren
- Geplante Backups (lokal / SMB / SFTP / WebDAV / S3 / OneDrive / GoogleDrive / Dropbox)

### Mitarbeiter
- Eigene Stunden, Überstunden und Urlaubssaldo live einsehen
- Monats-/Wochen-Übersicht mit offenen, krank und Urlaubstagen
- Eigene Abrechnungen als PDF herunterladen
- Passwort-Reset per E-Mail
- Optionales 2FA: TOTP (Authenticator-App) oder Passkey (WebAuthn)
- PWA-Stempelung per Smartphone mit optionaler Geolokalisierung

### Stempeluhr am Raspberry Pi
- RFID-Reader (HID-Keyboard-Mode) oder NFC (PC/SC) oder Barcode-Scanner
- Pygame-HDMI-Display mit Live-Liste der eingestempelten Mitarbeiter + Uhrzeit
- Offline-Queue: bei ausgefallener Server-Verbindung werden Stempelungen lokal zwischengespeichert und automatisch synchronisiert, sobald das Backend wieder erreichbar ist
- Automatische Tagesaufteilung bei Schichten über Mitternacht (deutsche Zeitzone, DST-aware)

## Tech-Stack

| Teil | Technologie |
|---|---|
| Backend | Node.js 20+, Express, TypeScript (läuft via `tsx`), Prisma ORM |
| Datenbank | SQLite |
| Frontend | React 18, Vite, TailwindCSS, React-Query, Zustand |
| Pi-Stempeluhr | Python 3, Pygame, evdev, pyscard |
| Prozesse | PM2 (als non-root `zeiterfassung`-User) |

## Projektstruktur

```
Zeiterfassung/
├── backend/           Express + Prisma (SQLite)
├── frontend/          React-Admin-UI
├── pi-terminal/       Python-Scripts für Raspberry Pi
└── ecosystem.config.js  PM2-Konfiguration
```

## Lokale Entwicklung

```bash
git clone <repo-url> Zeiterfassung
cd Zeiterfassung
npm install                   # installiert alle Workspaces

# Backend-.env anlegen — siehe unten "Environment Variables"
cp backend/.env.example backend/.env    # falls vorhanden, sonst manuell

# Datenbank initialisieren
cd backend && npx prisma generate && npx prisma db push && cd ..

# Dev-Server starten
npm run dev                   # Backend + Frontend parallel
```

Beim ersten Aufruf des Frontends startet der **Setup-Wizard** — dort werden Firma, Admin-Account, optional SMTP und das erste Stempel-Terminal angelegt. Der Setup-Endpoint verriegelt sich danach automatisch.

## Environment Variables

Alle Variablen in `backend/.env`. Das Backend **weigert sich zu starten**, wenn Pflicht-Variablen fehlen oder zu kurz sind.

| Variable | Pflicht | Zweck |
|---|---|---|
| `JWT_SECRET` | ja | Mindestens 32 Zeichen, z. B. `openssl rand -hex 32` |
| `FRONTEND_URL` | ja | Öffentliche URL (wird in Password-Reset-Mails verwendet) |
| `DOCUMENT_ENCRYPTION_KEY` | ja | 64-Hex-Zeichen (`openssl rand -hex 32`) für Dokumente & Backup-Target-Configs |
| `PORT` | nein | Standard: `3001` |
| `DATABASE_URL` | nein | Standard: `file:./zeiterfassung.db` |

`.env` sollte `chmod 600` und dem Service-User gehören. **Keine Default-Fallbacks** mehr im Code — alte Secrets (aus früheren Versionen) bitte rotieren.

## Raspberry Pi Terminal einrichten

Ein Stempel-Terminal wird über den Admin-Bereich (**Einstellungen → Terminals → Neues Terminal**) angelegt. Die Web-UI generiert einen einmaligen Installationsbefehl, der auf dem Pi per SSH ausgeführt wird:

```bash
curl -sL https://<dein-host>/api/setup/terminal-install/<terminal-id> | bash
```

Das Script installiert Abhängigkeiten, lädt die Python-Scripts, erkennt USB-Kartenleser und registriert die systemd-Services `zeiterfassung-terminal.service` (RFID-Reader) und `zeiterfassung-display.service` (HDMI-Display).

## Production-Deployment

Die empfohlene Topologie mit dem Setup, unter dem dieses Repo aktiv läuft:

```
  Internet
     │
     ▼
  [Pangolin Reverse Proxy]   externes TLS-Termination + Tunnel
     │
     ▼
  [nginx @ 5175]             Frontend-Static + /api-Proxy
     │
     ▼
  [Backend @ 3001]           PM2 → tsx → Express (als "zeiterfassung"-User)
     │
     └──▶ SQLite, Uploads, Backups
```

PM2-Prozesse werden über die mitgelieferte `ecosystem.config.js` gestartet, die Backend und Terminal-App als dedizierten System-User `zeiterfassung` laufen lässt:

```bash
# einmalig: User anlegen und Ownership setzen
useradd --system --no-create-home --shell /usr/sbin/nologin zeiterfassung
chown -R zeiterfassung:zeiterfassung /opt/Zeiterfassung/backend
chmod 600 /opt/Zeiterfassung/backend/.env
chmod 600 /opt/Zeiterfassung/backend/prisma/*.db

# Prozesse starten + bei Reboot wiederherstellen
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

Für die Static-Auslieferung des Frontends (`frontend/dist/`) gibt es ein nginx-Example im Repo (`nginx/` bzw. `/etc/nginx/sites-available/zeiterfassung`).

## Docker-Deployment

Die Container-Images werden via Gitea Actions gebaut und in der Gitea-Container-Registry unter `git.kerimatilgan.de/kerimatilgan/zeiterfassung-{backend,frontend}:latest` veröffentlicht.

### Quick-Start: einzelne Container

```bash
# Vorab: in der Gitea-Registry einloggen (Personal Access Token mit read:package)
docker login git.kerimatilgan.de
# Username: <dein Gitea-User>
# Password: <dein PAT>

# Backend
docker run -d --name zeit-backend \
  -p 3001:3001 \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  -e DOCUMENT_ENCRYPTION_KEY="$(openssl rand -hex 32)" \
  -e FRONTEND_URL="http://localhost:8080" \
  -v zeit_data:/app/prisma \
  -v zeit_uploads:/app/uploads \
  -v zeit_reports:/app/reports \
  --restart unless-stopped \
  git.kerimatilgan.de/kerimatilgan/zeiterfassung-backend:latest

# Frontend
docker run -d --name zeit-frontend \
  -p 8080:80 \
  --link zeit-backend:backend \
  --restart unless-stopped \
  git.kerimatilgan.de/kerimatilgan/zeiterfassung-frontend:latest
```

Aufrufbar unter `http://localhost:8080` (Frontend) bzw. `http://localhost:3001/api/health` (Backend).

> **Achtung**: Die hier per `openssl rand` generierten Secrets sind nur fürs schnelle Testen. Für echtes Deployment in eine `.env`-Datei oder ein Secret-Management — und vor allem **nicht zwischen Re-Starts neu generieren**, sonst sind alle JWTs und verschlüsselte Dokumente unbrauchbar.

### docker-compose

Die mitgelieferte `docker-compose.prod.yml` kombiniert Backend + Frontend mit benannten Volumes für Persistenz und enthält Traefik-Labels für den Reverse-Proxy.

```bash
# 1. .env neben docker-compose.prod.yml anlegen:
cat > .env <<EOF
JWT_SECRET=$(openssl rand -hex 32)
DOCUMENT_ENCRYPTION_KEY=$(openssl rand -hex 32)
FRONTEND_URL=https://zeit.kerimatilgan.de
TERMINAL_API_KEY=$(openssl rand -hex 24)
EOF
chmod 600 .env

# 2. In Gitea-Registry einloggen + starten
docker login git.kerimatilgan.de
docker compose -f docker-compose.prod.yml up -d

# 3. Logs verfolgen
docker compose -f docker-compose.prod.yml logs -f

# 4. Stoppen / Updaten
docker compose -f docker-compose.prod.yml pull        # neue Images holen
docker compose -f docker-compose.prod.yml up -d       # mit neuem Image neu starten
docker compose -f docker-compose.prod.yml down        # alles stoppen (Volumes bleiben)
```

Die Compose-Datei verwendet als Standard die Traefik-Labels für Routing über `zeit.kerimatilgan.de` / `zeit-api.kerimatilgan.de`. Wenn du **ohne Traefik** testen willst, einfach in `docker-compose.prod.yml` die auskommentierten `ports:`-Blöcke einkommentieren — dann sind die Container direkt erreichbar.

### Persistenz

Die drei benannten Volumes enthalten den State, der zwischen Re-Deployments erhalten bleiben muss:

| Volume | Inhalt |
|---|---|
| `zeit_data` | SQLite-DB (`zeiterfassung.db`) |
| `zeit_uploads` | Mitarbeiter-Fotos, verschlüsselte Dokumente, Logos |
| `zeit_reports` | Generierte Monats-Abrechnungs-PDFs |

Backup: die drei Volumes plus die `.env` reichen für eine vollständige Wiederherstellung. Komfortabler ist die in der App eingebaute Backup-Funktion (Admin → Einstellungen → Backup), die automatisch Snapshots auf konfigurierbare Storage-Targets schreibt.

## Sicherheit

- Alle Auth-Endpoints (Login, Password-Reset, 2FA) sind per-IP rate-limitiert
- JWT-Secrets müssen ≥ 32 Zeichen sein, sonst fail-fast beim Start
- Terminal-API-Keys ausschließlich DB-basiert — keine Legacy-Defaults mehr
- Password-Reset-Links nutzen `FRONTEND_URL` aus der Config, nicht den Request-Host (verhindert Host-Header-Injection)
- Prozesse laufen unter nicht-privilegiertem User, nicht als `root`
- `SMTP`-Passwort wird nur an Admin-Accounts ausgeliefert; `GET /api/settings/` liefert keine Mail-Credentials

Für größere Deployments: **HTTPS ist Pflicht** (Pangolin/Cloudflare Tunnel/Reverse-Proxy mit Let's-Encrypt oder ähnlich vorschalten).

## Backup / Restore

- Scheduled Backups laufen automatisch (konfigurierbar unter Einstellungen → Backup)
- Unterstützte Targets: Lokales Verzeichnis, SMB (via `smbclient`), SFTP, WebDAV, S3-kompatibel, OneDrive, Google Drive, Dropbox
- Restore-Funktion in der Admin-UI; überschreibt DB und Uploads
- Aufbewahrungsdauer konfigurierbar, alte Backups werden automatisch gelöscht

## Lizenz

Privates Projekt — alle Rechte vorbehalten.
