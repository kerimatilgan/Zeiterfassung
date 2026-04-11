# Cloudflare Workers Deployment - Zeiterfassung

## Voraussetzungen

1. Cloudflare Account
2. `wrangler` CLI installiert: `npm install -g wrangler`
3. Eingeloggt: `wrangler login`

## Schritt 1: D1 Datenbank erstellen

```bash
cd worker

# D1 Datenbank erstellen
wrangler d1 create zeiterfassung-db

# Die ausgegebene database_id in wrangler.toml eintragen!
```

## Schritt 2: R2 Bucket erstellen

```bash
# R2 Bucket für Datei-Uploads
wrangler r2 bucket create zeiterfassung-uploads
```

## Schritt 3: KV Namespace erstellen

```bash
# KV für temporären State (2FA, RFID Sessions)
wrangler kv namespace create KV

# Die ausgegebene ID in wrangler.toml eintragen!
```

## Schritt 4: Secrets setzen

```bash
# JWT Secret
wrangler secret put JWT_SECRET
# → Sicheres Secret eingeben

# Document Encryption Key (64 hex Zeichen)
wrangler secret put DOCUMENT_ENCRYPTION_KEY
# → z.B.: openssl rand -hex 32

# Optional: Terminal API Key
wrangler secret put TERMINAL_API_KEY
```

## Schritt 5: Dependencies installieren

```bash
npm install
npx prisma generate
```

## Schritt 6: Datenbank-Migration ausführen

```bash
# Lokal testen
wrangler d1 migrations apply zeiterfassung-db --local

# Remote (Produktion)
wrangler d1 migrations apply zeiterfassung-db --remote
```

## Schritt 7: Lokal testen

```bash
npm run dev
# → http://localhost:8787
```

## Schritt 8: Deployen

```bash
npm run deploy
```

## Frontend (Cloudflare Pages)

1. In Cloudflare Dashboard → Pages → Create Project
2. Git-Repository verbinden
3. Build settings:
   - Framework: Vite
   - Build command: `cd frontend && npm install && npm run build`
   - Build output: `frontend/dist`
4. Environment variables:
   - `VITE_API_URL`: `https://zeiterfassung-api.<subdomain>.workers.dev`

5. In `frontend/public/_redirects` die Worker-URL eintragen

## Daten vom Prod-Server migrieren

Um die bestehende SQLite-DB nach D1 zu migrieren:

```bash
# 1. SQLite Dump erstellen (auf Prod-Server)
sqlite3 backend/prisma/zeiterfassung.db .dump > dump.sql

# 2. Dump bereinigen (CREATE TABLE entfernen, nur INSERT behalten)
grep "^INSERT" dump.sql > inserts.sql

# 3. In D1 importieren
wrangler d1 execute zeiterfassung-db --remote --file=inserts.sql
```

## Uploads migrieren

```bash
# Alle Uploads nach R2 kopieren
for f in backend/uploads/**/*; do
  key=${f#backend/uploads/}
  wrangler r2 object put zeiterfassung-uploads/$key --file=$f
done
```

## Architektur-Unterschiede

| Feature | Prod (Node.js) | Workers |
|---------|----------------|---------|
| DB | SQLite (Datei) | Cloudflare D1 (SQLite) |
| Files | Lokales Dateisystem | Cloudflare R2 |
| Cron | node-cron | Cron Triggers |
| Email | Nodemailer/SMTP | TODO: API-basiert |
| WebSocket | socket.io | KV-basiert (Polling) |
| Passkeys | @simplewebauthn | TODO: Workers-kompatibel |
| Backup | SMB/NFS/SFTP/S3 | D1 Auto-Backup |
