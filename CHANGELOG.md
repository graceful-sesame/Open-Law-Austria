# Changelog

Alle wesentlichen Änderungen an Open-Law-Austria werden in dieser Datei dokumentiert.
Format orientiert sich an [Keep a Changelog](https://keepachangelog.com/de/1.0.0/).
Versionierung nach [Semantic Versioning](https://semver.org/lang/de/).

---

## [1.0.0] – 2026-04-26

### Behoben (Nachtrag)
- **Datenbankpfad-Mismatch**: `server/db.ts` ignorierte `DB_PATH` und schrieb
  `data.db` immer ins Projektroot. Jetzt wird `DB_PATH` aus `.env` gelesen,
  Standard ist `./data/data.db`. Der Ordner wird automatisch erstellt (`fs.mkdirSync`).
- **Docker-Volume**: Named Volume → Bind Mount (`./data:/app/data`). Alle Daten
  landen nun sichtbar im `data/`-Ordner im Projektverzeichnis.
- `data/`-Ordner in `.gitignore` eingetragen.
- `DB_PATH=./data/data.db` in `.env.example` als aktiver Default gesetzt.
- `DATABASE_URL`-Zeile aus `Dockerfile` entfernt (war ungenutzt).

### Behoben
- **Admin Token-Gate Whitescreen** (React Rules of Hooks): `AdminPage` wurde in
  zwei Komponenten aufgeteilt — `AdminContent` (alle Hooks, kein Early Return) und
  `AdminPage` (Auth-Gate mit Early Returns). Damit wird die React-Hooks-Regel
  eingehalten und der Whitescreen nach Token-Eingabe behoben.
- `React.useState` / `React.useEffect` in Token-Gate durch direkte
  `useState` / `useEffect` Named-Imports ersetzt.

### Geändert
- **`docker-compose.yml`**: Umgestellt auf `env_file` statt Inline-Umgebungsvariablen.
  Secrets (z. B. `ADMIN_TOKEN`) werden nun aus der `.env`-Datei gelesen, die
  **nicht** ins Repository eingecheckt wird. Startet auch ohne `.env` (`required: false`).
- Version: `0.4.0` → `1.0.0` (erste stabile Veröffentlichung)

---

## [1.0.0] – 2026-04-26

### Hinzugefügt
- **Admin Token-Gate UI**: Wenn `ADMIN_TOKEN` auf dem Server gesetzt ist, zeigt
  der Admin-Bereich (`/#/admin`) automatisch ein Token-Eingabeformular. Der Token
  wird im `localStorage` gespeichert und bei allen Admin-API-Requests als
  `Authorization: Bearer`-Header mitgeschickt. Passwort-Anzeige-Toggle inklusive.
- `adminApiRequest()` in `queryClient.ts` — typsicherer Wrapper um `fetch()` mit
  automatischer Token-Injektion für alle `/api/admin/*`-Routen.
- `getAdminToken()` / `setAdminToken()` — localStorage-Helfer für den Admin-Token.

### Geändert
- Version: `0.3.0` → `1.0.0` (erste stabile Veröffentlichung)
- `LICENSE`: Copyright-Inhaber auf GitHub-Username `graceful-sesame` aktualisiert
- `package.json`: `"author": "graceful-sesame"` ergänzt
- Alle Admin-API-Calls in `Admin.tsx` nutzen nun `adminApiRequest` statt `apiRequest`

---

## [0.3.0] – 2026-04-26

### Sicherheit
- **Admin-Routen-Schutz**: Neues optionales `ADMIN_TOKEN`-System. Wenn die
  Umgebungsvariable `ADMIN_TOKEN` gesetzt ist, müssen alle `/api/admin/*`-Requests
  einen `Authorization: Bearer <token>`-Header mitschicken. Ohne gesetzten Token
  bleibt das bisherige Verhalten (lokal/Single-User) unverändert.
- **Tote Dependencies entfernt**: `passport`, `passport-local`, `express-session`,
  `memorystore` und `node-fetch` waren in `package.json` enthalten, wurden aber
  nirgendwo im Code verwendet. Entfernt zur Reduktion der Angriffsfläche.

### Hinzugefügt
- `LICENSE` – MIT-Lizenz für den Applikationscode
- `NOTICE` – CC BY 4.0-Attributionspflicht für RIS-Quelldaten gemäß
  Creative Commons BY 4.0, inkl. Änderungsindikator und Urhebernachweise
- `CHANGELOG.md` – Diese Datei
- `.env.example` – Dokumentation aller verfügbaren Umgebungsvariablen
- `<meta name="version">` in `client/index.html`
- `ADMIN_TOKEN`-Kommentar in `docker-compose.yml`

### Geändert
- Versionsbadge auf Hauptseite: `v0.2` → `v0.3.0`
- `package.json` Version: `0.2.0` → `0.3.0`
- `docker-compose.yml`: Kommentare zur `ADMIN_TOKEN`-Konfiguration ergänzt

### Behoben
- Kommentarfehler in `config/collections.ts`:
  - `StPO` Gesetzesnummer im Kommentar korrigiert: `10002612` → `10002326`
  - `StVG`-Kommentar entfernte falsche Referenz auf StGB-Gesetzesnummer

---

## [0.2.0] – 2026-04-26

### Hinzugefügt
- Admin-Bereich: Sammlungen und Gesetze per UI hinzufügen, bearbeiten, löschen
- Textmarkierungen (Highlights) – server-seitig in SQLite gespeichert
- Abschnitts-Parsing (Teil/Abschnitt) aus RIS-HTML für Sidebar-Gliederung
- Paragraph-Titel-Extraktion aus RIS-HTML (on-the-fly, ohne DB-Persistenz)
- Hintergrund-Download-Jobs mit Fortschrittsanzeige
- Auto-Update-Mechanismus für gecachte Gesetze (konfigurierbarer TTL)
- Gesetz-Reihenfolge per Drag & Drop in Admin

### Geändert
- `NODE_TLS_REJECT_UNAUTHORIZED=0` (global) durch scoped `-k` curl-Flag ersetzt
- Router von BrowserRouter auf HashRouter umgestellt
- Builtin-Collections von statischer Konfiguration auf DB-geseedete Einträge umgestellt

---

## [0.1.0] – 2026-04-20

### Hinzugefügt
- Erste funktionierende Version
- RIS OGD API-Client (v2.6) für Bundesrecht
- Gesetzesleser mit Paragraphen-Sidebar
- Lesezeichen und Notizen (SQLite)
- Dark Mode
- Docker-Support
