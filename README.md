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

Voraussetzungen: **Node.js ≥ 20** und npm. (Für die Pi-Stempeluhr zusätzlich Python 3 — siehe weiter unten, für reine Web-Entwicklung nicht nötig.)

```bash
git clone <repo-url> Zeiterfassung
cd Zeiterfassung
npm install                   # installiert beide Workspaces (backend + frontend)

# Backend-.env anlegen und Secrets eintragen
cp backend/.env.example backend/.env
#   JWT_SECRET           → openssl rand -hex 32
#   DOCUMENT_ENCRYPTION_KEY → openssl rand -hex 32
#   FRONTEND_URL         → http://localhost:5175  (für lokal)

# Datenbank initialisieren (legt backend/zeiterfassung.db an)
cd backend && npx prisma generate && npx prisma db push && cd ..

# Dev-Server starten (Backend :3004 + Frontend :5175 parallel)
npm run dev
```

Frontend dann unter `http://localhost:5175`. Beim ersten Aufruf startet der **Setup-Wizard** — dort werden Firma, Admin-Account (Passwort min. 10 Zeichen), optional SMTP und das erste Stempel-Terminal angelegt. Der Setup-Endpoint verriegelt sich danach automatisch.

> Hinweis: Im Dev-Modus lauscht das Backend auf **3004** (siehe `vite.config.ts`-Proxy), im Production-Modus auf **3001** (bzw. `PORT`).

## Environment Variables

Alle Variablen stehen in `backend/.env` (Vorlage: `backend/.env.example`). Das Backend **weigert sich zu starten**, wenn eine Pflicht-Variable fehlt oder zu kurz ist — bewusst kein Default-Fallback im Code.

| Variable | Pflicht | Zweck |
|---|---|---|
| `JWT_SECRET` | **ja** | ≥ 32 Zeichen (`openssl rand -hex 32`). Bei Änderung müssen sich alle neu anmelden. |
| `DOCUMENT_ENCRYPTION_KEY` | **ja** | Genau 64 Hex-Zeichen (`openssl rand -hex 32`). Verschlüsselt Dokumente & Backup-Target-Configs. **Niemals ändern** — sonst sind bestehende Dokumente unlesbar. |
| `FRONTEND_URL` | **ja** (Prod) | Öffentliche Frontend-URL. Wird in Password-Reset-Mails verwendet und legt die erlaubte CORS-Origin fest (mehrere kommagetrennt). Leer = CORS permissiv (nur lokal sinnvoll). |
| `PORT` | nein | Backend-Port. Standard `3001`. |
| `DATABASE_URL` | nein | Standard `file:./zeiterfassung.db` (relativ zu `backend/`). |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | nein | Web-Push (Browser-Benachrichtigungen). Einmalig erzeugen: `npx web-push generate-vapid-keys`. Ohne diese 3 Werte ist Web-Push einfach aus. Werden in passphrase-geschützten Backups mitgesichert. |
| `APP_URL` | nein | Basis-URL für Links in automatischen Benachrichtigungen (z. B. Auto-Ausstempeln). |
| `BACKUP_PASSPHRASE` | nein | Wenn gesetzt (≥ 8 Zeichen): geplante Backups werden als `.tar.gz.enc` verschlüsselt und enthalten dann `DOCUMENT_ENCRYPTION_KEY` + VAPID-Keys (self-contained). Leer = unverschlüsselte `.tar.gz`. |
| `TERMINAL_API_KEY` | nein | Legacy-Fallback für Alt-Terminals; neue Terminals bekommen DB-basierte Keys. |

`.env` muss `chmod 600` haben und dem Service-User gehören. Alte Secrets aus früheren Versionen (Default-Keys) bitte rotieren.

## Raspberry Pi Terminal einrichten

Ein Stempel-Terminal wird über den Admin-Bereich (**Einstellungen → Terminals → Neues Terminal**) angelegt. Die Web-UI generiert einen einmaligen Installationsbefehl, der auf dem Pi per SSH ausgeführt wird:

```bash
curl -sL https://<dein-host>/api/setup/terminal-install/<terminal-id> | bash
```

Das Script installiert Abhängigkeiten, lädt die Python-Scripts, erkennt USB-Kartenleser und registriert die systemd-Services `zeiterfassung-terminal.service` (RFID-Reader) und `zeiterfassung-display.service` (HDMI-Display).

## Production-Deployment (bare metal / VM)

Empfohlene Topologie — so läuft dieses Repo produktiv:

```
  Internet
     │
     ▼
  [Reverse Proxy]            TLS-Termination (Pangolin / Cloudflare Tunnel / nginx+certbot)
     │
     ▼
  [nginx @ 5175]             liefert frontend/dist/ aus + proxyt /api, /uploads, /socket.io
     │
     ▼
  [Backend @ 3001]           PM2 → tsx → Express (als System-User "zeiterfassung")
     │
     └──▶ SQLite (backend/zeiterfassung.db), backend/uploads/, backend/reports/, backend/backups/
```

### Schritt für Schritt

```bash
# 0. Voraussetzungen: Node.js ≥ 20, npm, git, PM2 (npm i -g pm2),
#    nginx, openssl, sqlite3 (für konsistente DB-Snapshots beim Backup)
apt-get install -y nginx sqlite3
npm i -g pm2

# 1. Repo nach /opt/Zeiterfassung klonen
git clone <repo-url> /opt/Zeiterfassung
cd /opt/Zeiterfassung
npm install                              # backend + frontend Workspaces

# 2. Secrets erzeugen und .env anlegen
cp backend/.env.example backend/.env
# In backend/.env eintragen:
#   JWT_SECRET=$(openssl rand -hex 32)
#   DOCUMENT_ENCRYPTION_KEY=$(openssl rand -hex 32)
#   FRONTEND_URL=https://zeit.example.de
# optional (Web-Push):
#   npx web-push generate-vapid-keys   → VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY
#   VAPID_SUBJECT=mailto:admin@example.de
# optional (verschlüsselte Auto-Backups):
#   BACKUP_PASSPHRASE=<eigene Passphrase ≥ 8 Zeichen>

# 3. Datenbank initialisieren
cd backend && npx prisma generate && npx prisma db push && cd ..

# 4. Frontend bauen (Output: frontend/dist/)
npm run build --workspace=frontend

# 5. System-User anlegen + Ownership/Permissions setzen
useradd --system --no-create-home --shell /usr/sbin/nologin zeiterfassung
chown -R zeiterfassung:zeiterfassung /opt/Zeiterfassung/backend
chmod 600 /opt/Zeiterfassung/backend/.env
chmod 600 /opt/Zeiterfassung/backend/*.db 2>/dev/null || true

# 6. Backend via PM2 starten (ecosystem.config.js → läuft als "zeiterfassung")
pm2 start ecosystem.config.js
pm2 save
pm2 startup            # gibt einen Befehl aus, der den Boot-Autostart einrichtet

# 7. nginx: frontend/dist/ ausliefern + API proxen
#    Beispiel-Vhost siehe /etc/nginx/sites-available/zeiterfassung (root → frontend/dist,
#    location /api, /uploads, /socket.io → proxy_pass http://127.0.0.1:3001)
ln -s /etc/nginx/sites-available/zeiterfassung /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

Danach `https://zeit.example.de` aufrufen → **Setup-Wizard** (Firma, Admin, optional SMTP + erstes Terminal). Health-Check: `curl http://127.0.0.1:3001/api/health`.

### Updates einspielen

```bash
cd /opt/Zeiterfassung
git pull
npm install                              # falls Dependencies sich geändert haben
cd backend && npx prisma generate && npx prisma db push && cd ..   # falls Schema-Änderung
npm run build --workspace=frontend       # falls Frontend-Änderung
pm2 restart zeiterfassung-backend
chown -R zeiterfassung:zeiterfassung /opt/Zeiterfassung/backend
```

> Das Backend läuft via `tsx` direkt aus `src/` — ein TypeScript-Build-Step entfällt; `git pull` + `pm2 restart` reicht für reine Backend-Änderungen.

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
# optional: Web-Push   → npx web-push generate-vapid-keys
# VAPID_PUBLIC_KEY=...
# VAPID_PRIVATE_KEY=...
# VAPID_SUBJECT=mailto:admin@example.de
# optional: verschlüsselte Auto-Backups
# BACKUP_PASSPHRASE=<eigene Passphrase ≥ 8 Zeichen>
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

Eingebaut unter **Admin → Einstellungen → Backup**.

**Inhalt eines Backups** (ein `.tar.gz`-Archiv):
- `zeiterfassung.db` — die SQLite-DB (konsistenter Snapshot via `VACUUM INTO`, Fallback File-Copy)
- `uploads/` — Mitarbeiter-Fotos, verschlüsselte Dokumente, Logos
- `reports/` — generierte Monats-Abrechnungs-PDFs
- `secrets.json` — **nur bei passphrase-geschützten Backups**: `DOCUMENT_ENCRYPTION_KEY` + `VAPID_*`. Damit ist das Backup self-contained (verschlüsselte Dokumente lassen sich auf einer frischen Instanz wieder öffnen). `JWT_SECRET` ist bewusst **nicht** enthalten — im Zweifel müssen sich Nutzer einmal neu anmelden.

**Verschlüsselung**: AES-256-GCM mit aus der Passphrase via PBKDF2 abgeleitetem Schlüssel → Dateiendung `.tar.gz.enc`.
- Manueller Download in der UI: Passphrase optional pro Download eingeben.
- Geplante Backups: Passphrase über die Env-Variable `BACKUP_PASSPHRASE` setzen (≥ 8 Zeichen) → alle Auto-Backups werden verschlüsselt. Ohne die Variable laufen sie als unverschlüsselte `.tar.gz` (dann den `DOCUMENT_ENCRYPTION_KEY` separat sichern!).

**Scheduled Backups**: Intervall, Aufbewahrungsdauer und Ziel konfigurierbar. Targets: lokales Verzeichnis, SMB (via `smbclient`), SFTP, WebDAV, S3-kompatibel, OneDrive, Google Drive, Dropbox. Alte Backups werden gemäß Aufbewahrung automatisch gelöscht (`.tar.gz` **und** `.tar.gz.enc`).

**Restore** (Admin → Einstellungen → Backup → Wiederherstellen): akzeptiert `.tar.gz`, `.tar.gz.enc` (Passphrase nötig) und — für Alt-Backups — eine einzelne `.db`-Datei.
- Vor dem Überschreiben wird die aktuelle DB nach `zeiterfassung.db.before_restore_<timestamp>` gesichert.
- DB wird ersetzt; `uploads/` und `reports/` werden gemergt (vorhandene Dateien überschrieben, fehlende ergänzt).
- Aus `secrets.json` werden fehlende Keys an die `.env` angehängt (vorhandene Werte bleiben unangetastet).
- Schlägt der anschließende DB-Sanity-Check fehl, wird automatisch die vorherige DB zurückgespielt.

> Nach einem Restore das Backend einmal neu starten (`pm2 restart zeiterfassung-backend`), damit neu in die `.env` geschriebene Keys geladen werden.

### Manuell ohne UI

Ein Backup ist nur ein tar.gz — Restore geht zur Not auch von Hand:

```bash
# unverschlüsseltes Archiv
tar -xzf backup.tar.gz -C /tmp/restore
# verschlüsseltes Archiv vorher entschlüsseln: geht nur über die App-Restore-Funktion
#   (Format: 8-Byte-Magic "ZTBKP1\0\0" | salt 16B | iv 12B | authTag 16B | ciphertext)

systemctl stop ...           # bzw. pm2 stop zeiterfassung-backend
cp /tmp/restore/zeiterfassung.db /opt/Zeiterfassung/backend/zeiterfassung.db
cp -r /tmp/restore/uploads/*  /opt/Zeiterfassung/backend/uploads/
cp -r /tmp/restore/reports/*  /opt/Zeiterfassung/backend/reports/
chown -R zeiterfassung:zeiterfassung /opt/Zeiterfassung/backend
pm2 restart zeiterfassung-backend
```

## Lizenz

Privates Projekt — alle Rechte vorbehalten.
