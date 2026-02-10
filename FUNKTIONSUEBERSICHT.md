# Zeiterfassung - Funktionsübersicht

**Handy-Insel Zeiterfassungssystem**
Stand: Februar 2026

---

## 1. Anmeldung & Berechtigungen

- Login mit Mitarbeiternummer und Passwort
- Zwei Rollen: **Administrator** und **Mitarbeiter** mit getrennten Bereichen
- Mitarbeiter können ihr eigenes Passwort ändern
- Sichere Passwort-Verschlüsselung (bcrypt)
- Automatische Weiterleitung je nach Rolle (Admin-Bereich / Mitarbeiter-Bereich)

---

## 2. Mitarbeiterverwaltung (Admin)

- Mitarbeiter anlegen, bearbeiten und deaktivieren
- Erfasste Daten: Name, E-Mail, Telefon, Mitarbeiternummer, Wochenstunden, Urlaubstage pro Jahr, Arbeitstage
- **Foto-Upload** (JPEG, PNG, GIF, WebP) - wird auch am Stempelterminal angezeigt
- **QR-Code** pro Mitarbeiter automatisch generiert und regenerierbar
- **RFID-Karten-Zuweisung** mit Live-Registrierung am Terminal (30-Sekunden Scan-Modus via WebSocket)
- **Arbeitskategorie** zuweisbar (z.B. Backoffice ab 08:00, Büro ab 06:30)
- Suchfunktion über alle Mitarbeiter

---

## 3. Zeiterfassung

### Einstempeln / Ausstempeln
- Per **RFID-Karte**, **QR-Code** oder **manuellem Eintrag** durch den Admin
- Automatische Erkennung ob Ein- oder Ausstempeln

### Automatische Pausenberechnung
- Ab 6 Stunden Arbeitszeit werden automatisch 30 Minuten Pause abgezogen
- Pause kann manuell pro Eintrag angepasst werden

### Mehrtägige Einträge
- Wird über Mitternacht hinaus gearbeitet, wird der Eintrag automatisch pro Kalendertag aufgeteilt
- Deutsche Zeitzone (CET/CEST) wird korrekt berücksichtigt

### Arbeitskategorie-Prüfung
- Stempelt ein Mitarbeiter vor der frühesten erlaubten Zeit seiner Kategorie, wird die Einstempelzeit automatisch auf die Frühzeit korrigiert
- Beispiel: Kategorie "Backoffice" (ab 08:00), Mitarbeiter stempelt um 07:45 ein - erfasst wird 08:00

### Manuelle Einträge
- Admin kann Zeiteinträge manuell erstellen, bearbeiten und löschen
- Notizen pro Eintrag möglich
- Alle Änderungen werden im Audit-Log protokolliert

### Echtzeit-Updates
- Alle Änderungen werden sofort per WebSocket an verbundene Clients übertragen
- Dashboard und Mitarbeiterlisten aktualisieren sich automatisch

---

## 4. Reklamationen

### Ablauf
1. Mitarbeiter erstellt eine Reklamation auf einen eigenen Zeiteintrag (mit Nachricht)
2. Originalwerte (Einstempelzeit, Ausstempelzeit, Pause) werden automatisch gespeichert
3. Admin sieht offene Reklamationen im Dashboard und in der Navigation
4. Admin bearbeitet die Reklamation und gibt eine Antwort
5. E-Mail-Benachrichtigung an den Mitarbeiter mit Vorher/Nachher-Vergleich

### Benachrichtigungen
- **Rotes Badge** in der Navigation mit Anzahl offener Reklamationen
- **Dashboard-Widget** mit den neuesten offenen Reklamationen (Foto, Name, Datum, Nachricht)
- Klick auf eine Reklamation öffnet direkt den richtigen Mitarbeiter, Monat und Eintrag
- **E-Mail an Admin** bei neuer Reklamation
- **E-Mail an Mitarbeiter** bei Lösung der Reklamation

---

## 5. Monatsabrechnungen / Reports

### Automatische Berechnung
- **Ist-Stunden**: Summe aller Zeiteinträge abzüglich Pausen
- **Soll-Stunden**: Berücksichtigt Arbeitstage, Feiertage, Urlaub, Krankheit und Berufsschule
- **Überstunden**: Differenz zwischen Ist- und Soll-Stunden
- **Urlaubstage**: Kumulierte Erfassung ab Jahresbeginn

### Workflow
1. **Vorschau** - Berechnung prüfen bevor der Report erstellt wird
2. **Entwurf erstellen** - Report mit allen Daten anlegen
3. **Finalisieren** - PDF wird automatisch generiert
4. **Neuberechnung** jederzeit möglich (z.B. nach Korrektur von Zeiteinträgen)

### PDF-Abrechnung
- Professionelles Layout mit Firmendaten
- Tägliche Aufstellung aller Einträge
- Auflistung von Abwesenheiten und Feiertagen
- Zusammenfassung: Ist-Stunden, Soll-Stunden, Überstunden, Urlaubstage
- Download durch Admin (alle) und Mitarbeiter (eigene)

---

## 6. Abwesenheitsverwaltung

### Konfigurierbare Abwesenheitstypen
- Frei definierbar, z.B. Urlaub, Krank, Berufsschule ganztags, Berufsschule halbtags
- Pro Typ: Name, Kurzname, Pflicht-Stunden, Farbe für Kalenderansicht
- Aktivierbar/Deaktivierbar

### Abwesenheiten erfassen
- Pro Mitarbeiter und Tag eine Abwesenheit
- Kalenderansicht mit farbiger Darstellung nach Typ
- **Drag-Auswahl** für mehrere Tage gleichzeitig
- Optionale Notiz pro Abwesenheit

### Auswirkung auf Abrechnungen
- Urlaub/Krank: 0 Soll-Stunden für den Tag
- Berufsschule: Definierte Pflichtstunden (z.B. 8h ganztags, 4h halbtags)
- Urlaubstage werden kumuliert im Report erfasst

---

## 7. Arbeitskategorien

- Frei konfigurierbare Kategorien (z.B. Backoffice, Büro, Verkauf)
- Pro Kategorie wird eine **früheste Einstempelzeit** definiert (z.B. 08:00, 06:30, 08:45)
- Jeder Mitarbeiter kann einer Kategorie zugewiesen werden
- **Automatische Korrektur am Terminal**: Wird vor der Frühzeit gestempelt, wird die Einstempelzeit automatisch angepasst
- Mitarbeiter ohne Kategorie haben keine Einschränkung
- Kategorien können aktiviert/deaktiviert werden

---

## 8. Feiertagsverwaltung

### Manuelle Verwaltung
- Einzelne Feiertage manuell anlegen und löschen
- Wiederkehrende Feiertage (jährlich) markierbar

### Automatische Generierung
- Alle deutschen Feiertage pro **Bundesland** und Jahr automatisch generieren
- Alle 16 Bundesländer unterstützt
- Bewegliche Feiertage (Ostern, Pfingsten, etc.) werden korrekt berechnet
- Bundesland-spezifische Feiertage berücksichtigt
- Automatische Erkennung des Bundeslandes aus der Firmen-Postleitzahl

---

## 9. Admin-Dashboard

- **4 Statistik-Karten**: Aktive Mitarbeiter, Aktuell eingestempelt, Einträge heute, Offene Abrechnungen
- **Reklamationen-Widget**: Offene Beschwerden mit Foto, Name, Datum und Nachricht - mit Direktlink zum Mitarbeiter
- **Letzte Aktivitäten**: Die 10 neuesten Zeiteinträge mit Status (Aktiv/Abgeschlossen)
- Automatische Aktualisierung alle 30 Sekunden

---

## 10. Mitarbeiter-Bereich

- **Eigenes Dashboard** mit Wochen- und Monatsstunden sowie Resturlaub
- **Zeitübersicht** als Monatskalender mit allen eigenen Einträgen
- **Eigene Abrechnungen** einsehen und als PDF herunterladen
- **Reklamationen** auf eigene Zeiteinträge erstellen
- **Passwort ändern**

---

## 11. RFID-Stempelterminal (Raspberry Pi)

### Hardware
- **Zwei RFID-Reader gleichzeitig**: Sycreader (USB-Tastatur) und ACR122U (NFC)
- HDMI-Bildschirm mit Vollbild-Anzeige

### Funktionen
- Einstempeln und Ausstempeln per Kartenscan
- **Anzeige auf dem Bildschirm**: Mitarbeiterfoto, Name, Uhrzeit, Bestätigungsmeldung, gearbeitete Stunden
- **Live RFID-Registrierung**: Admin startet Registrierung im Web, Mitarbeiter scannt Karte am Terminal, Zuordnung erfolgt in Echtzeit
- Admin-Konten werden am Terminal abgelehnt

### Offline-Modus
- Scans werden bei Verbindungsunterbrechung lokal gespeichert (bis zu 7 Tage)
- Automatische Synchronisierung bei Wiederherstellung der Verbindung
- Zeitstempel bleiben korrekt erhalten

---

## 12. Einstellungen

### Firmendaten
- Firmenname, Adresse, Telefon, E-Mail
- Standard-Pausenzeit und Überstunden-Schwelle konfigurierbar

### E-Mail-Server (SMTP)
- Host, Port, Benutzername, Passwort, TLS-Verschlüsselung
- Absender-Adresse und -Name
- **Testfunktion**: SMTP-Verbindung prüfen und Test-E-Mail senden

### Datenbank-Verwaltung
- **Datenbankinfo**: Dateigröße und Anzahl aller Datensätze
- **Backup herunterladen**: Komplette Datenbank als Datei sichern
- **Backup wiederherstellen**: Datenbank aus Sicherung wiederherstellen (mit automatischer Sicherheitskopie vor der Wiederherstellung)

---

## 13. Audit-Log (Protokollierung)

### Lückenlose Nachvollziehbarkeit
Alle Aktionen werden automatisch protokolliert:
- Login, Logout und fehlgeschlagene Login-Versuche
- Ein- und Ausstempeln
- Erstellen, Bearbeiten und Löschen aller Datensätze
- Passwortänderungen
- Datenbank-Backups und Wiederherstellungen
- Reklamationen (erstellen, bearbeiten, löschen, lösen)

### Erfasste Daten pro Eintrag
- Zeitpunkt, Benutzer, Aktion
- Vorher/Nachher-Werte (bei Änderungen)
- IP-Adresse und Browser-Information

### Auswertung
- Filter nach Aktion, Typ, Benutzer, Zeitraum und Volltextsuche
- Statistiken: Logs heute/diese Woche, Logins, fehlgeschlagene Logins
- Detailansicht für jeden einzelnen Eintrag

---

## Technische Eckdaten

| Eigenschaft | Detail |
|---|---|
| Backend | Node.js / Express / TypeScript |
| Datenbank | SQLite mit Prisma ORM |
| Frontend | React 18 / TypeScript / TailwindCSS |
| Echtzeit | WebSocket (Socket.IO) |
| Terminal | Python / Pygame auf Raspberry Pi |
| Sprache | Komplett auf Deutsch (UI, E-Mails, PDFs) |
| Zeitzone | Deutsche Zeitzone (CET/CEST) durchgängig |
| API-Endpunkte | 60+ |
| Datenbank-Modelle | 9 |
