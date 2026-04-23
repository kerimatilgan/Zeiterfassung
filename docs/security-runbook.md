# Security-Runbook Zeiterfassung

Kurzreferenz für den Betrieb. Was sitzt wo, was rotieren, was checken.

---

## Laufende Umgebung (Stand 2026-04)

| Komponente | Wo | Als wer |
|---|---|---|
| Backend (Node + tsx + Express) | Prod `10.8.0.5`, PM2 | User `zeiterfassung` |
| SQLite-DB | `/opt/Zeiterfassung/backend/prisma/zeiterfassung.db` | `zeiterfassung:zeiterfassung` 600 |
| Frontend (static) | `/opt/Zeiterfassung/frontend/dist/` — nginx | via nginx |
| nginx | Port 5175 (intern) | root (systemd) |
| Pangolin | externer Server | extern, public-facing |
| Pi-Terminal (RFID) | `/home/pi/zeiterfassung-terminal/` | User `pi` |

**Public URLs:**
- Prod: `https://zeit.handy-insel.de`
- Dev: `https://zeit.kerimatilgan.de`

---

## Secrets

Alle kritischen Secrets in `/opt/Zeiterfassung/backend/.env` (`chmod 600`, Owner `zeiterfassung`).

| Variable | Zweck | Rotation |
|---|---|---|
| `JWT_SECRET` | Signatur aller JWTs | Bei Verdacht auf Leak sofort. Rotation → alle User müssen sich neu anmelden. |
| `FRONTEND_URL` | Password-Reset-Link-Ziel | Nur bei Domain-Wechsel |
| `DOCUMENT_ENCRYPTION_KEY` | AES-256-GCM für Dokumente + Backup-Target-Configs | **Nie** einfach rotieren — würde alle verschlüsselten Dokumente unlesbar machen. |

**Terminal-API-Keys** liegen in `Terminal.apiKey` (DB). Rotation per Admin-UI: *Einstellungen → Terminals → Neuen Key generieren* (Pi muss neu installiert werden).

**Admin-Passwörter** bcrypt-Hash in `Employee.passwordHash` (Kosten 12).

---

## Regelmäßig zu prüfen

- **Audit-Log** (Admin-UI → Audit-Logs): Auf fehlgeschlagene Logins, ungewöhnliche Password-Resets, unerwartete `ADMIN_*`-Einträge achten.
- **Backups** (Admin-UI → Backup): Letzter erfolgreicher Backup nicht älter als ein paar Tage.
- **Terminal-Status** (Admin-UI → Einstellungen → Terminals): `lastSeen` darf nicht zu lang zurück liegen, sonst fehlt ein Pi.
- **Disk-Space** auf Prod: `df -h /opt` — Uploads + Backups wachsen über die Zeit.

---

## Bei Vorfall / Verdacht

**Admin-Account kompromittiert:**
1. `JWT_SECRET` rotieren in `.env`, `pm2 restart zeiterfassung-backend --update-env` — invalidiert alle Sessions
2. Admin-Passwort ändern
3. Audit-Log prüfen: welche Admin-Aktionen vom betroffenen Account?

**Terminal-API-Key geleakt:**
1. Admin-UI → Einstellungen → betroffenes Terminal → *"Neuen API-Key generieren"*
2. Pi neu installieren mit generiertem Install-Script

**Server-Kompromittierung vermutet:**
1. Backend sofort stoppen: `pm2 stop zeiterfassung-backend`
2. Alle Audit-Logs exportieren / DB-Kopie sichern
3. `nginx` stoppen
4. Alle Secrets rotieren (JWT, Terminal-Keys)
5. `DOCUMENT_ENCRYPTION_KEY` **nicht** rotieren (würde Dokumente unlesbar machen) — stattdessen verdächtige Zeiträume per Audit-Log eingrenzen
6. User-Passwort-Reset erzwingen (neue bcrypt-Hashes)

---

## Deployment / Änderungen

**Backend-Code aktualisieren:**
```bash
# Source-Files nach Prod kopieren
scp backend/src/... root@10.8.0.5:/opt/Zeiterfassung/backend/src/...
ssh root@10.8.0.5 'chown zeiterfassung:zeiterfassung /opt/Zeiterfassung/backend/src/...'
ssh root@10.8.0.5 'pm2 restart zeiterfassung-backend'
```

**Prisma-Schema-Änderung:**
```bash
scp backend/prisma/schema.prisma root@10.8.0.5:/opt/Zeiterfassung/backend/prisma/
ssh root@10.8.0.5 'cd /opt/Zeiterfassung/backend && npx prisma db push --skip-generate && npx prisma generate'
ssh root@10.8.0.5 'pm2 restart zeiterfassung-backend'
```
> Hinweis: `prisma generate` als **root** ausführen, damit die Client-Dateien in `/opt/Zeiterfassung/node_modules/.prisma/client/` aktualisiert werden.

**Frontend deployen:**
```bash
cd frontend && npm run build
scp -r dist/. root@10.8.0.5:/opt/Zeiterfassung/frontend/dist/
```

**nginx-Config-Änderung:**
```bash
scp nginx/*.conf root@10.8.0.5:/etc/nginx/...   # oder via Ansible
ssh root@10.8.0.5 'nginx -t && systemctl reload nginx'
```

---

## Security-Header (Pangolin-Workaround)

Aktuell werden die Response-Header im lokalen nginx gesetzt, nicht in Pangolin (dessen Custom-Headers-Feature v1.16.2 hat diese Header nicht durchgereicht). Die Config liegt unter:
- `nginx/security-headers.conf` (Snippet)
- `nginx/zeiterfassung.conf` (inkludiert das Snippet in jede `location`)

Falls du die nginx-Config auf Prod änderst: **Werte auch in `nginx/`-Verzeichnis im Repo nachziehen**, damit die beiden nicht auseinanderlaufen.

---

## Pflichtwartung

- **Dependencies auf Vulnerabilities prüfen**: `cd backend && npm audit`, `cd frontend && npm audit`. Mindestens quartalsweise.
- **Node/OS-Updates**: `apt update && apt upgrade` auf Prod (im Wartungsfenster, danach `pm2 restart all`).
- **bcrypt-Kosten** sind aktuell 12. Wenn Login spürbar träge wird auf 11, wenn Hardware stark genug für 13 → in `routes/auth.ts`, `setup.ts`, `employees.ts` zentral ändern.

---

## Rate-Limits (Referenz)

| Endpoint | Limit | Quelle |
|---|---|---|
| `POST /api/auth/login` | 10 / 15 min pro IP | `middleware/rateLimits.ts` |
| `POST /api/auth/forgot-password` | 5 / 60 min pro IP | dito |
| `POST /api/auth/reset-password` | 10 / 15 min pro IP | dito |
| `POST /api/2fa/totp/validate` | 5 / 15 min pro IP | dito |
| `POST /api/2fa/passkey/auth-verify` | 5 / 15 min pro IP | dito |

Rate-Limiter nutzt `trust proxy: 2` (Pangolin + nginx) um die echte Client-IP aus `X-Forwarded-For` zu lesen.

---

## Audit-Log Einträge

Wichtige Entity-Types und Actions, auf die man achten sollte:
- `LOGIN_FAILED` (Employee) — kann auf Brute-Force hindeuten
- `PASSWORD_RESET_REQUESTED` + kein Follow-up — möglicher Enumerations-Versuch
- `ADMIN_PASSWORD_RESET` — Admin hat ein Fremd-Passwort gesetzt
- `UPDATE` auf Settings/MailSettings — Check ob gewünscht
- `UPDATE` auf Terminal mit Key-Wechsel — planmäßig?

Alle Einträge sind in `AuditLog`-Tabelle, per Admin-UI durchsuchbar.

---

## Kontakt / Notfall-Checkliste

- Prod-Server SSH: `root@10.8.0.5` (VPN-IP) oder `192.168.1.4` (intern)
- Pi-Terminals: Jeweilige IP aus Admin-UI *Einstellungen → Terminals* ablesbar
- GitHub: `kerimatilgan/Zeiterfassung`
- Pangolin-Adminpanel: intern (Synology)

Bei Unklarheit: SSH zu Prod, `pm2 logs zeiterfassung-backend --lines 100` — das zeigt aktuell was schief läuft.
