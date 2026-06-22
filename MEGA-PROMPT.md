# MEGA-PROMPT: seo.solutions — Vollständige Wiederherstellung

## Projekt-Verzeichnis
`C:\Users\Flori\Desktop\seo.solutions`

## Was ist seo.solutions?
seo.solutions ist eine **AI-gesteuerte SEO-Plattform** die Folgendes kann:

### Kernfunktionen (MÜSSEN alle funktionieren):

1. **Firmensuche & Firmendaten**
   - User kann nach Firmen/Unternehmen suchen
   - Firmendaten werden gesammelt und angezeigt (Name, URL, Branche, Kontaktdaten, Keywords)
   - Firmen können als "Kunden" / "Websites" gespeichert werden

2. **Website-Analyse**
   - Eine verbundene Website wird automatisch von der KI analysiert
   - SEO-Score wird berechnet (Keywords, Lesbarkeit, Meta Tags, Struktur)
   - Verbesserungsvorschläge werden von Claude AI generiert
   - Der aktuelle Inhalt der Website wird gescannt und bewertet

3. **AI Content Management (automatisch)**
   - Festgelegte Bereiche auf externen Websites (Text, Überschriften, Bilder-Alt-Texte, Meta Descriptions) können durch KI verändert werden
   - Websites verbinden sich über ein JavaScript-Snippet (`data-seo-zone` Attribute)
   - Die KI generiert automatisch neuen, SEO-optimierten Inhalt — ohne Eingreifen des Users
   - Websites bleiben "dauerhaft aktiv" für Google SEO (frischer, rotierender Content)

4. **AI Labor**
   - Direkte Text-/Headline-/Meta-Generierung mit Claude AI
   - Ton-Auswahl (professionell, freundlich, überzeugend, informativ)
   - Content-Typ-Auswahl (Text, Headline, Meta, Alt-Text, Seitentitel)
   - Keyword-Eingabe
   - Echtzeit SEO-Schnellcheck nach jeder Generierung
   - Generierungshistorie

5. **SEO Checker**
   - Vollständige KI-Analyse mit Score-Ring (0-100)
   - Verbesserungsvorschläge
   - Verbesserter Text wird direkt generiert

6. **AI Jobs & Automation**
   - Jobs erstellen: Zone + Typ (Neuschreiben/Optimieren/Erweitern/Kürzen) + Zeitplan
   - Automatische Ausführung nach Zeitplan (täglich, wöchentlich, etc.)
   - Versionsverlauf mit Wiederherstellen-Funktion

7. **Embed Snippet**
   - JavaScript-Snippet das externe Websites in den `<head>` einbinden
   - Fragt die API ab und ersetzt `data-seo-zone` Elemente mit KI-generiertem Inhalt
   - Pro Website ein eigener API-Key

8. **Analytics Dashboard**
   - Aktivitätsbalken (30 Tage)
   - SEO Score Ring
   - Stats: Texte generiert, erfolgreiche Jobs, Ø SEO Score, aktive Websites

---

## Technischer Stack

### Frontend
- **Reine HTML/CSS/JS** (kein Framework)
- Design-Stil: **Fürst Software** — weißes Premium-Design mit navy/blauer Akzentfarbe
- CSS-Variablen aus Fürst Software:
  - `--ff-navy: #061a3a`, `--ff-blue: #0b5cff`, `--ff-blue-dark: #0a3c91`
  - Weiße Cards mit `border-radius: 28px` und blauen Schatten
  - Gradient-Buttons: `linear-gradient(135deg, var(--ff-blue), var(--ff-blue-dark))`
  - Font: Inter, `font-weight: 950` für Headings
  - Hintergründe: `#f4f8ff`, `#f0f6ff`
  - Pill-Badges, Section-Labels, Score-Rings
- Sidebar: Navy-Gradient mit Navigations-Gruppen (Übersicht, AI Content, Auswertung, Integration)
- Topbar: Weiß mit Suche, "AI starten" Button, User-Chip

### Backend: **Python** (Flask)
- `backend/server.py` — Flask REST API auf Port 3000
- Endpoints:
  - `GET/POST/DELETE /api/websites`
  - `GET/POST/DELETE /api/zones`
  - `GET/POST/DELETE /api/jobs`
  - `POST /api/jobs/:id/run`
  - `POST /api/ai/generate` — Einzelne Generierung
  - `POST /api/ai/batch` — Mehrere Zones
  - `POST /api/ai/analyze` — SEO Analyse
  - `GET /api/activities`
  - `GET /v1/content/:apiKey` — Content-Delivery für externe Websites
  - `GET /v1/content/embed.js` — Embed Script
- JSON-Datei als Datenbank: `db/data.json`

### AI: **Anthropic Python SDK**
- `ai/content_generator.py`
- Modell: `claude-opus-4-8` (Default)
- `thinking: {"type": "adaptive"}` — KI entscheidet selbst wie viel sie denkt
- Streaming: `client.messages.stream()` mit `stream.get_final_message()`
- Funktionen:
  - `generate_content()` — Einzelne Zone generieren
  - `batch_generate_content()` — Mehrere Zones parallel
  - `analyze_seo()` — Inhalt analysieren, Score + Vorschläge + verbesserter Text
- Spezialisierte System-Prompts je Zone-Typ (Headline, Text, Meta, Alt, Title)

### Embed Snippet
- `snippet/embed.js` — Vanilla JS, 0 Dependencies
- Fragt `/v1/content/:apiKey` ab
- Ersetzt alle `[data-seo-zone]` Elemente

### Datenbank-Schema (für spätere Migration zu PostgreSQL/MySQL)
- `db/schema.sql` mit: users, websites, content_zones, content_versions, ai_jobs, activity_log, api_usage

---

## Dateistruktur
```
C:\Users\Flori\Desktop\seo.solutions\
├── index.html          ← Dashboard (alle Seiten als SPA)
├── style.css           ← Fürst Software Stil
├── app.js              ← Frontend-Logik (State, Navigation, Rendering, API-Calls)
├── package.json        ← Node-Deps (nur für Static Server / optional)
├── requirements.txt    ← Python: anthropic, flask, flask-cors
├── backend/
│   └── server.py       ← Flask REST API + Static File Server
├── ai/
│   ├── __init__.py
│   └── content_generator.py  ← Claude AI Integration
├── snippet/
│   └── embed.js        ← JavaScript Embed für externe Websites
├── db/
│   ├── schema.sql      ← SQL Schema (Referenz)
│   └── data.json       ← JSON Datenbank (wird automatisch erstellt)
└── .claude/
    └── launch.json     ← Preview Server Config
```

---

## Was geändert wurde und repariert werden muss

Die Dateien `app.js` und `backend/server.py` wurden durch einen Linter/User verändert. Die **Hauptfunktionen** die fehlen oder kaputt sein könnten:

1. **Firmensuche** — Muss eingebaut/repariert werden. User soll nach Firmen suchen können, Daten sammeln, und diese als Website verbinden können.

2. **Website-Analyse** — Die automatische Analyse einer Website wenn sie verbunden wird. Crawlt die Seite, extrahiert Meta-Daten, bewertet SEO.

3. **Alle AI-Funktionen** müssen über das Python-Backend (`http://localhost:3000`) laufen.

4. **Der komplette Flow** muss funktionieren:
   - Website hinzufügen → Analyse läuft automatisch → Zones werden vorgeschlagen → AI generiert Inhalte → Snippet liefert Content an externe Website

---

## ANWEISUNG

Lies alle Dateien im Verzeichnis `C:\Users\Flori\Desktop\seo.solutions`, analysiere den aktuellen Stand, und stelle die **komplette Funktionalität** wieder her:

1. Prüfe ob alle Dateien existieren und korrekt sind
2. Stelle den Fürst Software Stil sicher (weißes Premium-Design, navy/blau)
3. Repariere oder baue die **Firmensuche** ein (Suchfeld, Ergebnisse, Firma als Website speichern)
4. Repariere oder baue die **Website-Analyse** ein (automatischer SEO-Scan bei neuer Website)
5. Stelle sicher dass das **AI Labor**, **SEO Checker**, **Content Zones**, **AI Jobs**, **Analytics**, **Snippet** und **Einstellungen** alle korrekt funktionieren
6. Teste ob das Python-Backend startet (`python backend/server.py`)
7. Stelle sicher dass die AI-Generierung über Claude (`claude-opus-4-8` mit `thinking: {"type": "adaptive"}`) funktioniert
8. Das Frontend muss als SPA funktionieren (Navigation, State in localStorage, Modals, Toasts)
9. Baue so viele KI-Funktionen wie möglich ein die schon funktionstüchtig sind

**Wichtig:** 
- Backend = Python (Flask), NICHT Node.js
- KI = Anthropic Python SDK (`anthropic`), Modell `claude-opus-4-8`
- Design = Fürst Software Stil (weiß/blau/navy, premium, `border-radius: 28px`, Inter font)
- Kein Framework — reines HTML/CSS/JS Frontend
