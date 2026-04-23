# Pangolin – Empfohlene Security-Response-Header für die Zeiterfassung

In Pangolin → Ressource → **Zusätzliche Proxy-Einstellungen** → **Eigene Kopfzeilen** die folgenden Zeilen einfügen. **Format: `Header-Name: Wert`** (Doppelpunkt, ein Header pro Zeile — genau wie der Hinweis unter dem Feld sagt). Anschließend mit **„Proxy-Einstellungen speichern"** bestätigen.

```
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(self), camera=(), microphone=(), payment=(), usb=()
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' wss: https://nominatim.openstreetmap.org; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
```

## Was diese Header bewirken

- **HSTS** (`Strict-Transport-Security`): Der Browser erzwingt HTTPS für ein Jahr. Downgrade-Angriffe beim ersten Visit abgeschwächt. **Wichtig**: Erst setzen, wenn du sicher bist, dass HTTPS dauerhaft erreichbar bleibt — sonst ist die Domain für Clients „gelockt".
- **X-Frame-Options: DENY**: Clickjacking verhindert, deine App kann nicht in einem `<iframe>` auf einer fremden Seite eingebettet werden.
- **X-Content-Type-Options: nosniff**: Browser beachtet den `Content-Type` und interpretiert z. B. einen hochgeladenen `.txt` nicht als JavaScript.
- **Referrer-Policy**: Beim Klicken auf externe Links wird nur der Origin (`https://zeit.example.com`) als Referer mitgesendet, nicht der volle Pfad mit Parametern.
- **Permissions-Policy**: Explizite Whitelist — nur `geolocation` ist erlaubt (für PWA-Auswärts-Stempelung), Kamera/Mikro/USB/Zahlung sind blockiert.
- **CSP**: Defense-in-Depth gegen XSS. Erlaubt Scripts/Styles/Images/Fonts nur von deiner eigenen Origin. `'unsafe-inline'` bei styles ist nötig, weil React inline-Styles nutzt. `wss:` für Socket.io, `https://nominatim.openstreetmap.org` für Reverse-Geocoding.

## Falls etwas bricht

- **Fonts/Icons fehlen**: Du nutzt evtl. Google Fonts / eine externe CDN. Dann entweder lokal hosten **oder** CSP um `font-src https://fonts.gstatic.com` und `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com` erweitern.
- **WebSocket-Fehler** (Socket.io disconnected): CSP `connect-src` um die konkrete WSS-URL ergänzen, z. B. `wss://zeit.handy-insel.de`.
- **Bilder von anderen Domains**: `img-src` erweitern, z. B. `img-src 'self' data: blob: https://tile.openstreetmap.org` falls du OSM-Tiles lädst.

## Stufenweise einführen

Ich empfehle die Header **in zwei Schritten** auszurollen:

1. **Sofort**: `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` — diese sind harmlos und brechen nichts.
2. **Nach einem Tag Test**: `Content-Security-Policy` — öffne die App und prüfe in der Browser-Konsole (F12 → Console), ob CSP-Violation-Warnungen erscheinen. Falls ja, entsprechend anpassen.
3. **Zuletzt**: `Strict-Transport-Security` — wenn alles stabil läuft. Vorher sicherstellen, dass HTTPS über Pangolin zuverlässig erreichbar ist.

## Zusätzliche Pangolin-Empfehlungen

- **Rate-Limiting auf Pangolin-Ebene** aktivieren (falls nicht schon im Backend), z. B. 100 Requests/min pro IP — schützt vor Volumenangriffen vor sie überhaupt das Backend erreichen.
- **Geo-Restriction**: Falls nur aus DE/AT/CH gearbeitet wird, andere Länder direkt auf Pangolin-Ebene blocken. Reduziert Angriffsoberfläche erheblich.
- **Web-Application-Firewall** (falls Pangolin unterstützt): Aktivieren.
- **Access-Log** einschalten und periodisch checken auf unauthorisierte Requests (z. B. `/wp-admin`, `/.env`, `/phpmyadmin` → das sind Scanner).
