# OpenLaw RIS – MCP-Server

MCP-Server für die **RIS-OGD-API v2.6** des österreichischen Rechtsinformationssystems.
Damit kann Claude (Claude Desktop, Claude Code) direkt und vollständig auf Judikatur sowie
Bundes-, Landes- und Gemeinderecht zugreifen, statt sich auf Websuche zu verlassen.

- **Nur lesend**, keine Secrets, keine Datenbank
- **stdio-Transport**: kein offener Port, kein Netzwerk-Listener
- Eigenständig: braucht nichts vom restlichen OpenLaw-Repository und beeinflusst dessen
  Server-Deployment nicht (das Verzeichnis ist per `.dockerignore` vom Docker-Build ausgeschlossen)

> Datenquelle: RIS – Rechtsinformationssystem des Bundes (https://www.ris.bka.gv.at), CC BY 4.0.
> Inoffizielles Werkzeug, keine Verbindung zum Bundeskanzleramt. Rechtsverbindlich sind nur die
> authentischen Kundmachungen.

---

## Abdeckung

| Bereich | Applikationen |
|---|---|
| **Judikatur** | Justiz (OGH, OLG, LG, BG), VfGH, VwGH, BVwG, LVwG (alle Länder), Datenschutzbehörde, Gleichbehandlungskommissionen, Disziplinarbehörden, Personalvertretungsaufsicht, Asylgerichtshof, UVS, Umweltsenat, UBAS, Vergabekontrolle, Bundeskommunikationssenat, Normenliste des VwGH |
| **Bundesrecht** | Bundesrecht konsolidiert (mit Stichtag), BGBl authentisch, BGBl 1945–2003, Staats-/Reichsgesetzblatt, Begutachtungsentwürfe, Regierungsvorlagen, englische Übersetzungen |
| **Landesrecht** | Landesrecht konsolidiert (alle 9 Bundesländer, mit Stichtag), LGBl authentisch, LGBl (alt), LGBl NÖ, Verordnungsblätter |
| **Sonstiges** | Gemeinderecht (konsolidiert und authentisch), Bezirksverwaltungsbehörden, Erlässe, Sozialversicherung, Veterinärnachrichten, Strukturpläne Gesundheit, Kundmachungen der Gerichte, Prüfungsordnungen, Ministerratsprotokolle, Parteien-Transparenz-Senat |

## Tools

| Tool | Zweck |
|---|---|
| `search_judikatur` | Rechtsprechung suchen: Applikation, Suchworte, Gericht, Geschäftszahl, Norm, Rechtssatznummer, Entscheidungsdatum von/bis, Dokumenttyp (Rechtssatz/Entscheidungstext), Bundesland (LVwG), Paginierung. Liefert kompakte Treffer mit GZ, Gericht, Datum, ECLI, RS-Nummer, Normen, Kurzinfo, Dokument-ID, RIS-Link und Gesamttrefferzahl. |
| `get_dokument` | Volltext eines Dokuments (Entscheidung, Rechtssatz, Norm, Kundmachung) als bereinigter Text mit Metadaten-Kopf. Paginierung über `offset`/`max_zeichen`; `abschnitte` (z. B. nur „Rechtliche Beurteilung“) und `stichwort` (nur einschlägige Absätze) sparen Kontext. |
| `search_bundesrecht` | Bundesrecht suchen (Titel/Abkürzung, Suchworte, Gesetzesnummer, Paragraph oder Bereich, Fassung zu einem Stichtag oder alle Fassungen; BGBl usw.). |
| `search_landesrecht` | Landesrecht suchen, optional nach Bundesländern gefiltert. |
| `search_sonstige` | Gemeinderecht, Bezirke, Erlässe und weitere Sammlungen. |
| `get_norm` | Text eines bestimmten Paragraphen/Artikels (z. B. § 288 StGB, § 153 StPO, Art 7 B-VG, § 129 Wiener Bauordnung) in der geltenden oder einer Stichtagsfassung, mit In-/Außerkrafttretensdatum und RIS-Link. `fassungen=true` listet alle historischen Fassungen. |

Die Tool-Beschreibungen weisen das Modell ausdrücklich darauf hin, dass die RIS-Suche
**schlagwortbasiert** ist (UND-Verknüpfung, keine Grundformen, ein `*` pro Wort) und es
mehrere Suchwort-Varianten probieren soll.

---

## Installation unter Windows

### 1. Voraussetzungen

- **Node.js 22 oder neuer** (empfohlen: aktuelle LTS) von https://nodejs.org. Prüfen in PowerShell:
  ```powershell
  node --version   # v22.x oder höher
  ```
- Das Repository (git clone oder ZIP) – benötigt wird nur der Ordner `mcp-server`.

### 2. Bauen

```powershell
cd C:\Pfad\zu\Open-Law-Austria\mcp-server
npm ci
npm run build
npm test          # optional: Unit-Tests (offline)
```

Danach liegt der Server unter `mcp-server\dist\stdio.js`.

Schnelltest (beenden mit Strg+C):

```powershell
node dist\stdio.js
# stderr: [openlaw-ris] RIS-MCP-Server 0.1.0 bereit (stdio).
```

### 3a. Claude Desktop

In Claude Desktop **Einstellungen → Entwickler → Konfiguration bearbeiten** öffnen
(öffnet `claude_desktop_config.json`, üblicherweise `%APPDATA%\Claude\claude_desktop_config.json`)
und ergänzen:

```json
{
  "mcpServers": {
    "openlaw-ris": {
      "command": "node",
      "args": ["C:\\Pfad\\zu\\Open-Law-Austria\\mcp-server\\dist\\stdio.js"]
    }
  }
}
```

- Backslashes im JSON verdoppeln (`\\`) oder normale Schrägstriche verwenden (`C:/Pfad/...`).
  Leerzeichen im Pfad sind in `args` unproblematisch (jedes Array-Element ist ein Argument).
- Findet Claude Desktop `node` nicht, den vollen Pfad angeben, z. B.
  `"command": "C:\\Program Files\\nodejs\\node.exe"`.
- Claude Desktop danach **vollständig beenden** (auch im Infobereich) und neu starten.
- Logs bei Problemen: `%APPDATA%\Claude\logs\mcp-server-openlaw-ris.log`.

Optional mit Umgebungsvariablen:

```json
"openlaw-ris": {
  "command": "node",
  "args": ["C:\\Pfad\\zu\\Open-Law-Austria\\mcp-server\\dist\\stdio.js"],
  "env": { "RIS_CONTACT": "kontakt@example.org" }
}
```

### 3b. Claude Code

```powershell
claude mcp add openlaw-ris --scope user -- node C:\Pfad\zu\Open-Law-Austria\mcp-server\dist\stdio.js
claude mcp list
```

`--scope user` macht den Server in allen Projekten verfügbar; ohne Angabe gilt er nur im aktuellen
Projekt. In einer Claude-Code-Sitzung zeigt `/mcp` den Status. Enthält der Pfad Leerzeichen, ihn in
Anführungszeichen setzen: `-- node "C:\Users\Max Muster\Open-Law-Austria\mcp-server\dist\stdio.js"`.

### Aktualisieren

```powershell
git pull
cd mcp-server
npm ci
npm run build
```

Danach Claude Desktop bzw. die Claude-Code-Sitzung neu starten.

---

## Beispiel-Abfragen

An Claude, sobald der Server verbunden ist:

- *„Suche OGH-Judikatur zu § 288 StGB im Zusammenhang mit Vernehmungen aufgrund einer Europäischen Ermittlungsanordnung.“*
- *„Wie lautete § 288 StGB am 1.1.2020, und was hat sich seither geändert?“*
- *„Zeig mir § 153 StPO in der geltenden Fassung.“*
- *„Welche Rechtssätze des VwGH gibt es seit 2025 zu § 5 StVO (Alkotest-Verweigerung)?“*
- *„Finde VfGH-Erkenntnisse zur Versammlungsfreiheit seit 2024 und fasse die Leitsätze zusammen.“*
- *„Was regelt § 129 der Wiener Bauordnung? Gibt es LVwG-Wien-Judikatur zur Kurzzeitvermietung?“*
- *„Lies im BVwG-Erkenntnis W123 … nur die Stellen zur Dublin-Überstellung nach Kroatien.“* (nutzt `stichwort`)

Direkte Tool-Aufrufe sehen etwa so aus:

```json
{ "tool": "search_judikatur", "arguments": { "applikation": "Justiz", "gericht": "OGH", "norm": "StGB §288", "suchworte": "Ermittlungsanordnung*", "dokumenttyp": "alle" } }
{ "tool": "get_dokument",     "arguments": { "dokument_id": "JJT_20250402_OGH0002_0120OS00026_25B0000_000", "abschnitte": ["Spruch", "Rechtliche Beurteilung"] } }
{ "tool": "get_norm",         "arguments": { "gesetz": "StGB", "paragraph": "288", "stichtag": "2020-01-01" } }
{ "tool": "search_landesrecht", "arguments": { "titel": "Bauordnung", "bundesland": ["Wien"], "paragraph": "129" } }
```

## Suchtipps (RIS-Suchsyntax)

| Eingabe | Wirkung |
|---|---|
| `Falschaussage Meineid` | beide Wörter müssen vorkommen (UND) |
| `Falschaussage ODER Meineid` | eines der Wörter |
| `Falschaussage NICHT Meineid` | Ausschluss |
| `"falsche Beweisaussage"` | Phrase |
| `Vernehm*`, `Ermittl*anordnung` | Platzhalter, **höchstens einer pro Wort** |

Es gibt keine Grundformreduktion: `Ermittlungsanordnung` findet nicht `Ermittlungsanordnungen`.
Für Normbezüge ist der Filter `norm` (Format `"StGB §288"` oder `"§ 288 StGB"`) meist präziser.
Rechtssätze (RS) bündeln die Kernaussage und verweisen auf alle Folgeentscheidungen; bei OGH,
VfGH und VwGH lohnt es sich, zuerst nach Rechtssätzen zu suchen.

---

## Konfiguration (optional)

| Variable | Standard | Bedeutung |
|---|---|---|
| `RIS_CONTACT` | – | Kontaktangabe, die an den User-Agent angehängt wird (empfohlen laut RIS-Netiquette) |
| `RIS_TIMEOUT_MS` | `30000` | Timeout pro Request |
| `RIS_MAX_ATTEMPTS` | `3` | Versuche pro Request (Retry mit Backoff 2 s, 4 s, …) |
| `RIS_MIN_INTERVAL_MS` | `2000` | Mindestabstand zwischen Requests; **kann nicht unter 2000 ms gesenkt werden** |
| `RIS_SEARCH_CACHE_TTL_MS` | `600000` | Cache für Suchergebnisse (10 min) |
| `RIS_DOCUMENT_CACHE_TTL_MS` | `3600000` | Cache für Dokumente (60 min) |
| `RIS_QUIET` | – | `1` unterdrückt Log-Ausgaben auf stderr |
| `NODE_EXTRA_CA_CERTS` | – | Pfad zu einem zusätzlichen Root-Zertifikat (PEM), falls ein Firmenproxy oder Virenscanner TLS aufbricht. TLS-Prüfung wird **nie** abgeschaltet. |

## Umgang mit der RIS-API

Der Server hält die [Netiquette der RIS-OGD-Schnittstelle](https://data.bka.gv.at/ris/api/v2.6/) ein:

- höchstens **0,5 Requests pro Sekunde**: alle Requests laufen seriell über eine Warteschlange mit mindestens 2 s Abstand
- **keine parallelen Verbindungen**
- aussagekräftiger User-Agent (`OpenLaw-RIS-MCP/<version> (+Repo-URL)`)
- **kein Massendownload**: Suchen ohne Kriterium werden abgelehnt, Trefferlisten sind paginiert (max. 100 pro Seite), Volltexte gibt es nur auf ausdrücklichen Abruf
- Cache, damit Paginierung und Wiederholungen keine neuen Requests auslösen
- Retries nur bei Netzwerkfehlern, 429 und 5xx, mit exponentiellem Backoff; `Retry-After` wird
  beachtet, bei langen Wartezeiten (> 60 s) wird nicht erneut versucht
- Zeitbudget von 90 s pro Tool-Aufruf; bricht der Client ab, werden Warteschlange und Retries gestoppt

**Hinweis:** Das Rate-Limit gilt pro Server-Prozess. Claude Desktop und jede Claude-Code-Sitzung
starten je einen eigenen stdio-Prozess. Bei normaler Recherche ist das unkritisch (jeder Prozess
bleibt bei ≤ 0,5 Requests/s und arbeitet seriell), für viele parallele Sitzungen ist aber der
spätere zentrale HTTP-Server die bessere Lösung, weil sich dort alle Clients eine Warteschlange teilen.

Sicherheit: Es werden nur `https://data.bka.gv.at` und `https://ogd.ris.bka.gv.at` kontaktiert
(Host-Allowlist, auch bei Redirects). `get_dokument` akzeptiert nur Dokumentnummern, keine URLs.
Antworten sind größenbegrenzt; Dokument-XML mit DOCTYPE-/ENTITY-Deklaration wird nicht verarbeitet.
Dokumenttexte werden in der Ausgabe mit `<<<RIS-DOKUMENTTEXT …>>>`-Markern als Daten gekennzeichnet
(Schutz vor Prompt-Injection über Dokumentinhalte).

---

## Architektur

```
mcp-server/
├── src/
│   ├── config.ts          Konfiguration, Attribution, Host-Allowlist
│   ├── log.ts             Logging nur nach stderr (stdout gehört dem MCP-Protokoll)
│   ├── ris/               reiner RIS-Client, kein MCP-Bezug
│   │   ├── http.ts        Warteschlange, Rate-Limit, Retry/Backoff, Timeout, Cache, Allowlist
│   │   ├── applications.ts Katalog aller Applikationen + erlaubte Parameter (Whitelist)
│   │   ├── normalize.ts   JSON-Normalisierung (Objekt/Array, item-Listen, Fehler als HTTP 200)
│   │   ├── xmlText.ts     Dokument-XML → strukturierter Klartext
│   │   ├── documentId.ts  Dokumentnummer → Applikation/URL
│   │   └── client.ts      search() / getDocument()
│   ├── tools/             MCP-Tools (Schemas, Formatierung) – transportunabhängig
│   ├── server.ts          createServer(client): McpServer mit allen Tools
│   └── stdio.ts           Einstiegspunkt stdio-Transport
└── test/                  Unit-Tests (node:test, offline mit echten API-Fixtures) + Live-Tests
```

Transport und Tool-Logik sind getrennt: `createServer()` kennt keinen Transport, `stdio.ts`
verbindet ihn nur mit stdin/stdout.

### Ausblick: Betrieb auf dem Homeserver (noch nicht gebaut)

Für den späteren Zugriff vom MacBook über LAN oder Tailscale ist vorgesehen:

1. `src/http.ts` mit dem Streamable-HTTP-Transport des MCP-SDK ergänzen (zustandsloser
   JSON-Modus genügt, da nur Tools angeboten werden): `createServer(client)` **pro Session bzw.
   Request**, aber **ein gemeinsamer** `RisClient` pro Prozess, damit Rate-Limit, Warteschlange und
   Cache für alle Clients gemeinsam gelten.
2. Nur an `127.0.0.1` binden und per `tailscale serve` (TLS, nur im Tailnet) veröffentlichen,
   statt einen Port im LAN zu öffnen; zusätzlich Bearer-Token (Vergleich in konstanter Zeit) sowie
   Host-/Origin-Prüfung (den `*.ts.net`-Hostnamen erlauben).
3. Claude Code auf dem MacBook verbindet sich direkt:
   `claude mcp add --transport http openlaw-ris https://<homeserver>.<tailnet>.ts.net/mcp`.
   Bei Claude Desktop beachten: Über die Connector-Oberfläche hinzugefügte Remote-Server werden aus
   der Anthropic-Cloud angesprochen und erreichen ein reines Tailnet nicht; `claude_desktop_config.json`
   kennt nur stdio. Verlässlich ist dort eine lokale stdio-Brücke wie `mcp-remote` (Token per
   `--header`, unter Windows den Header-Wert über eine Umgebungsvariable übergeben) oder weiterhin
   die lokale stdio-Installation.

Da der Server zustandslos ist und keine Secrets braucht, kann er parallel lokal (stdio) und
später remote (HTTP) laufen.

---

## Entwicklung

```powershell
npm run build       # TypeScript → dist/
npm test            # Unit-Tests (offline)
npm run test:live   # wenige Requests gegen die echte RIS-API
npx @modelcontextprotocol/inspector node dist/stdio.js   # interaktiv testen (MCP Inspector)
```

## Fehlerbehebung

| Problem | Lösung |
|---|---|
| Server erscheint nicht in Claude Desktop | Pfad in `args` prüfen, Claude Desktop ganz beenden und neu starten, Log `mcp-server-openlaw-ris.log` ansehen |
| `Node.js >= 22 erforderlich` | Node aktualisieren oder in `command` den vollen Pfad zur neuen `node.exe` angeben |
| `TLS-Fehler beim Verbinden mit RIS` | Firmenproxy oder Virenscanner mit TLS-Inspektion: `NODE_EXTRA_CA_CERTS` auf dessen Root-Zertifikat (PEM) setzen |
| `RIS derzeit nicht erreichbar` | RIS-Wartung oder Netzwerkproblem; der Server hat bereits mit Backoff wiederholt |
| Keine Treffer | Suchwort-Varianten, `*`, ODER; `dokumenttyp: "alle"`; Datumsfilter lockern |

## Lizenz

Code: MIT (siehe `../LICENSE`). Daten: RIS, CC BY 4.0, Namensnennung
„Datenquelle: RIS – Rechtsinformationssystem des Bundes“.
