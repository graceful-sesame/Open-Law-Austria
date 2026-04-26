# Open-Law-Austria — Österreichische Gesetzessammlung

> **⚠️ Inoffizieller Viewer.** Diese Anwendung steht in **keiner Verbindung** mit dem
> Bundeskanzleramt Österreich oder dem Rechtsinformationssystem des Bundes (RIS).
> Rechtsverbindlich ist ausschließlich das Bundesgesetzblatt (BGBl.).

Eine vollständige Web-App zum Durchsuchen, Lesen und Annotieren österreichischer
Bundesgesetze. Datenquelle ist ausschließlich das **Rechtsinformationssystem des Bundes (RIS)**
über die offizielle OGD-API (CC BY 4.0).

---

## Features

- **Startseite** – Kachel-Übersicht über konfigurierbare Rechtsgebiete (Strafrecht, Zivilrecht, Verfassungsrecht, Sicherheitsrecht)
- **Gesetzesansicht** – Sidebar mit allen Paragraphen/Artikeln, Volltextanzeige im juristischen Leseformat
- **Globale Suche** – Freitextsuche über das gesamte RIS-Bundesrecht
- **Favoriten** – Paragraphen mit einem Klick bookmarken, persistent in SQLite
- **Notizen** – Pro Paragraph eigene Notizen hinterlegen, Autosave
- **Textmarker** – Paragraphentext direkt im Browser markieren, server-seitig gespeichert
- **Admin-Bereich** – Sammlungen und Gesetze per UI verwalten, Caches refreshen
- **Dark Mode** – Schalter in der Kopfzeile
- **Caching** – Geladene Paragraphen werden lokal gecacht (SQLite), kein redundanter API-Abruf

---

## Stack

| Schicht | Technologie |
|---|---|
| Frontend | React 18 + Vite + TypeScript |
| Styling | Tailwind CSS v3 + shadcn/ui |
| Backend | Express.js (Node.js) |
| Datenbank | SQLite via `better-sqlite3` + Drizzle ORM |
| Datenquelle | RIS OGD API v2.6 (data.bka.gv.at) |

---

## Lokaler Start

### Voraussetzungen

- Node.js ≥ 18
- npm ≥ 9

### Installation & Start

```bash
cd open-law-austria
npm install
npm run dev
```

Die App läuft auf **http://localhost:5000**.

Die SQLite-Datenbank wird automatisch beim ersten Start als `data.db` im Projektverzeichnis angelegt.

---

## Docker

### Einzelner Container

```bash
docker build -t open-law-austria .
docker run -p 5000:5000 -v $(pwd)/data:/app/data open-law-austria
```

### Docker Compose

```bash
docker compose up --build
```

Die App ist dann auf http://localhost:5000 erreichbar. Die Datenbank wird im Volume `open-law-austria-data` persistiert.

---

## Konfiguration (.env)

Kopiere `.env.example` nach `.env` und passe bei Bedarf an:

```bash
cp .env.example .env
```

Die wichtigsten Variablen:

| Variable | Standard | Beschreibung |
|---|---|---|
| `PORT` | `5000` | Server-Port |
| `NODE_ENV` | `development` | Umgebung |
| `ADMIN_TOKEN` | *(leer)* | Optionaler Token zum Schutz des Admin-Bereichs |

---

## Sicherheitshinweise

### Admin-Bereich

Der Admin-Bereich (`/#/admin`) ermöglicht das Verwalten von Sammlungen und Gesetzen
sowie das Triggern von RIS-Downloads. Er ist **ohne Authentifizierung** zugänglich,
solange `ADMIN_TOKEN` nicht gesetzt ist.

| Deployment | Empfehlung |
|---|---|
| Lokale Nutzung (localhost) | `ADMIN_TOKEN` nicht nötig |
| Heimnetzwerk (LAN) | `ADMIN_TOKEN` empfohlen |
| Öffentlich erreichbar (Internet) | `ADMIN_TOKEN` **unbedingt setzen** + Reverse Proxy mit TLS |

Wenn `ADMIN_TOKEN` gesetzt ist, müssen alle `/api/admin/*`-Requests den Header
`Authorization: Bearer <ADMIN_TOKEN>` mitschicken.

### TLS / SSL

Die RIS-Dokumenten-Abfrage (`ris.bka.gv.at`) erfolgt über `curl` mit Flag `-k`
(Zertifikatsprüfung deaktiviert), da der RIS-WAF Node.js-Requests blockiert und
`ris.bka.gv.at` ein nicht in Nodes CA-Store enthaltenes Zertifikat verwendet.
Betrifft ausschließlich diese eine Verbindung; die RIS-API (`data.bka.gv.at`)
verwendet ein gültiges Zertifikat und wird ohne `-k` abgerufen.

---

## Projektstruktur

```
open-law-austria/
├── client/src/
│   ├── App.tsx                  # Router + Provider
│   ├── index.css                # Farbpalette (Navy + Gold), Source Serif 4
│   ├── components/
│   │   └── AppHeader.tsx        # Globale Kopfzeile
│   └── pages/
│       ├── Library.tsx          # Startseite (Kacheln)
│       ├── Collection.tsx       # Rechtsgebiet-Übersicht
│       ├── Law.tsx              # Gesetzesleser mit Paragraphsidebar
│       ├── Search.tsx           # Suchergebnisse
│       ├── Bookmarks.tsx        # Lesezeichen
│       └── Admin.tsx            # Verwaltung Sammlungen & Gesetze
├── server/
│   ├── db.ts                    # SQLite-Initialisierung (Drizzle)
│   ├── routes.ts                # API-Routen (inkl. Admin-Auth)
│   ├── storage.ts               # Datenbankoperationen
│   ├── seed.ts                  # Builtin-Collections beim Start seeden
│   └── index.ts                 # Express-Einstiegspunkt
├── shared/
│   └── schema.ts                # Drizzle-Schema (DB-Modell)
├── config/
│   └── collections.ts           # Rechtsgebiete & Gesetze konfigurieren
├── lib/
│   └── risClient.ts             # RIS API-Client
├── LICENSE                      # MIT-Lizenz (Applikationscode)
├── NOTICE                       # CC BY 4.0-Attribution (RIS-Daten)
├── CHANGELOG.md                 # Versionshistorie
├── .env.example                 # Konfigurationsvorlage
└── docker-compose.yml
```

---

## RIS-Schnittstelle

Alle Rechtsdaten stammen aus dem [Rechtsinformationssystem des Bundes (RIS)](https://www.ris.bka.gv.at/),
bereitgestellt als Open Government Data unter **CC BY 4.0**.

### Verwendete Endpunkte

**Gesetzes-Index (Paragraphen-Liste):**
```
GET https://data.bka.gv.at/ris/api/v2.6/Bundesrecht
  ?Applikation=BrKons
  &Gesetzesnummer=<nr>
  &Fassung.FassungVom=<YYYY-MM-DD>
  &Seitengroesse=100
```

**Dokument-HTML (Paragraphentext):**
```
GET https://www.ris.bka.gv.at/Dokument.wxe
  ?Abfrage=Bundesnormen
  &Dokumentnummer=<NOR-Nummer>
```

**Suche:**
```
GET https://data.bka.gv.at/ris/api/v2.6/Bundesrecht
  ?Applikation=BrKons
  &Suchworte=<Begriff>
  &Seitengroesse=20
```

### Technische Anmerkungen

- Die RIS API v2.6 liefert eine verschachtelte JSON-Struktur:
  `OgdSearchResult.OgdDocumentResults.OgdDocumentReference[].Data.Metadaten...`
- Dokument-HTML (`ris.bka.gv.at`) wird via `curl -k` abgerufen, da Node.js-Requests
  vom WAF (myracloud) geblockt werden und `ris.bka.gv.at` kein systemvertrauenswürdiges
  Zertifikat einsetzt.
- Die API-Endpunkte (`data.bka.gv.at`) verwenden valide Zertifikate.

---

## Collections erweitern

Neue Rechtsgebiete oder Gesetze können über den **Admin-Bereich** (`/#/admin`)
zur Laufzeit hinzugefügt werden oder statisch in `config/collections.ts`:

```typescript
// Neues Gesetz zu einer bestehenden Collection:
{
  id: "asvg",
  abkuerzung: "ASVG",
  title: "Allgemeines Sozialversicherungsgesetz",
  gesetzesnummer: "10008147",
  shortDescription: "Sozialversicherungsrecht"
}
```

Die `gesetzesnummer` ist die RIS-interne ID (zu finden in der URL auf ris.bka.gv.at).

---

## Datenbankschema

| Tabelle | Zweck |
|---|---|
| `cached_documents` | Gecachte Paragraphen inkl. HTML-Inhalt |
| `law_index` | Geladene Gesetzes-Indizes (Metadaten) |
| `bookmarks` | Nutzerfavoriten pro Paragraphen |
| `notes` | Nutzernotizen pro Paragraphen |
| `highlights` | Textmarkierungen (HTML mit `<mark>`-Tags) |
| `user_collections` | Alle Sammlungen (eingebaut + benutzerdefiniert) |
| `user_laws` | Alle Gesetze (eingebaut + benutzerdefiniert) |
| `app_settings` | App-weite Einstellungen (Key-Value) |

---

## Lizenz & Quellenangabe

### Applikationscode

Dieser Quellcode steht unter der **MIT-Lizenz** – siehe [`LICENSE`](LICENSE).

### Rechtsdaten (RIS OGD)

Die angezeigten Gesetzestexte stammen vom **Rechtsinformationssystem des Bundes (RIS)**,
Bundeskanzleramt Österreich, und stehen unter der
[Creative Commons Namensnennung 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/deed.de).

**Urheber / Lizenzgeber:** Bundeskanzleramt Österreich – Rechtsinformationssystem des Bundes (RIS)
**Quelldaten:** https://data.bka.gv.at/ris/api/v2.6/Bundesrecht
**Lizenz:** https://creativecommons.org/licenses/by/4.0/
**Hinweis auf Änderungen:** Die Originaldaten werden von dieser Anwendung abgerufen,
lokal zwischengespeichert und aufbereitet dargestellt. Am Gesetzestext selbst werden
keine inhaltlichen Änderungen vorgenommen.

Vollständige Attributions- und Drittanbieterhinweise: siehe [`NOTICE`](NOTICE).

---

## Icons

Die App verwendet [Lucide Icons](https://lucide.dev/) (ISC-Lizenz).
