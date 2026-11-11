# Format der Projekt-Sicherung (`*.easy4visu`)

Stand: 05.11.2026 · Format-Version **1** · gilt für easy4Visu ab Version 1 (Verwaltung → „Projekt“).

Mit dieser Beschreibung lässt sich eine Sicherung **von außen** erzeugen, z. B. eine fertige Demo-Visu aus einem
Generator oder einem Chat. Die Datei wird in easy4Visu über **Verwaltung → Projekt → „Projekt einspielen …“**
eingelesen. Vorher sichert easy4Visu den jetzigen Stand automatisch („vor dem Einspielen“, Ordner „Sicherungen“).

Das vollständige Beispiel in Abschnitt 7 wurde so wie abgedruckt gepackt, eingespielt und geprüft
(2 Geräte, 1 Seite mit 3 Elementen, Leisten, Texttabelle mit Deutsch und Englisch).

---

## 1. Die Datei

- **Nur Daten:** JSON (UTF-8), mit **gzip** gepackt. Endung `.easy4visu`.
- Kein ausführbarer Code: easy4Visu führt aus der Datei nichts aus. Texte werden als Text angezeigt (kein HTML),
  Bilder nur als Bild. Unbekannte Felder in Seiten und Leisten werden beim Einlesen verworfen; in Geräten und Variablen
  bleiben sie als Daten liegen, werden aber nicht benutzt.
- Packen geht mit jedem gzip-Programm, z. B. mit Node.js:

```js
const fs = require('fs'), zlib = require('zlib');
const projekt = JSON.parse(fs.readFileSync('demo.json', 'utf8'));
fs.writeFileSync('demo.easy4visu', zlib.gzipSync(Buffer.from(JSON.stringify(projekt), 'utf8')));
```

## 2. Hülle

```json
{
  "easy4visu": "projekt",
  "format": 1,
  "created": "2026-11-05T12:00:00Z",
  "app": "Demo-Generator 1.0",
  "files": { "devices.json": {}, "pages.json": {}, "texte.json": {} },
  "images": {},
  "web": { "startPage": "", "startPageTablet": "" }
}
```

| Feld | Pflicht | Bedeutung |
|---|---|---|
| `easy4visu` | ja | immer `"projekt"` |
| `format` | ja | `1`. Eine größere Zahl lehnt easy4Visu ab („aus einer neueren easy4Visu“). |
| `created` | nein | Zeitpunkt (ISO 8601), erscheint in der Vorschau |
| `app` | nein | wer die Datei erzeugt hat, erscheint in der Vorschau |
| `auto` | nein | nur für automatische Sicherungen (`true`); von außen weglassen |
| `files` | ja | die Projektdateien, je Dateiname ein JSON-Objekt (Abschnitt 3–5) |
| `images` | nein | Bilder: `{ "<Name>": "<Base64>" }` (Abschnitt 6) |
| `web` | nein | Startseite im Browser am Handy / Tablet (Seiten-`id`, leer = wie am PC) |
| `secrets` | nein | Gerätepasswörter, mit Datei-Kennwort verschlüsselt (scrypt + AES-256-GCM) – von außen weglassen; Passwörter dann in easy4Visu eintragen |

**Erlaubte Dateien in `files`** (andere Namen werden ignoriert):

| Datei | Inhalt | fehlt sie … |
|---|---|---|
| `devices.json` | Geräte und Variablen | keine Geräte |
| `pages.json` | Bedienseiten und Leisten | keine Seiten, Leisten-Vorgabe |
| `texte.json` | Sprachen und Übersetzungen | nur Grundsprache Deutsch |
| `meldungen.json` | Meldungen (Störung / Warnung / Meldung) | keine Meldungen |
| `theme.json` | Design (Farben, Schrift, Logo) | Standard-Design |
| `symbole.json` | „Meine Symbole“ | leere Sammlung |
| `benutzer.json` | Benutzer mit Passwort-Prüfwerten | Benutzer bleiben, wie sie sind – **von außen weglassen** |

Wichtig: Was in der Sicherung **fehlt**, wird beim Einspielen auf den Standard zurückgesetzt (die vorhandene Datei wird
entfernt). Eine Sicherung ersetzt also das ganze Projekt, sie ergänzt nichts. Nicht enthalten und unverändert bleiben:
Trends, Meldungsverlauf, Bedienprotokoll und die Einstellungen dieses PCs (Mit Windows starten, Beim Start verbinden,
Gleich im Bedienmodus, Handy & Tablet ein/aus, Port).

## 3. `devices.json` – Geräte und Variablen

```json
{ "version": 1, "devices": [ Gerät, … ] }
```

**Gerät**

| Feld | Bedeutung |
|---|---|
| `id` | eindeutige Kennung (Text, z. B. `"nt1"`). Seiten und Meldungen verweisen darauf. |
| `name` | Anzeigename, eindeutig (Groß-/Kleinschreibung egal) |
| `protocol` | `"modbus"` · `"json"` (JSON-API) · `"mqtt"` |
| `interval` | Abfrage in ms; Mindestwerte Modbus 100, JSON 500, MQTT 500 |
| `enabled` | `false` = ausgeschaltet (fehlt = an) |
| `settings` | je Protokoll, siehe unten. **Keine Passwörter hier** – die werden getrennt verwahrt. |
| `variables` | Liste der Variablen |

**`settings` je Protokoll** (die wichtigsten Felder)

- Modbus: `host`, `port` (502), `addressing` (`"direct"` Standard, `"minus1"` nur für Sonderfälle)
- JSON-API: `host`, `https` (true/false), `auth` (`"basic"` Standard, `"bearer"` = API-Schlüssel, `"none"`), `user`
- MQTT: `host`, `port` (1883 bzw. 8883), `baseTopic` (z. B. `"easye4/1"`), `tls` (true/false), `user`,
  `caFile` (Pfad zu einem CA-Zertifikat auf **diesem** PC – wird nicht mitgesichert)

**Variable**

| Feld | Bedeutung |
|---|---|
| `name` | eindeutiger Name im Gerät (z. B. `"Fuellstand"`). Seiten verweisen mit `dev` + `name` darauf. |
| `label` | Anzeigename (z. B. `"Füllstand"`) |
| `operand`, `index` | Operand der easyE4 ohne Nummer + Nummer: `M`/1, `MB`/2, `MW`/3, `MD`/4, `I`/1, `Q`/1, `IA`/1, `QA`/1, `ID`/1, `N`/`NB`/`NW`/`ND`, `CLOCK` |
| `net` | nur für Operanden eines anderen NET-Teilnehmers (1–8), sonst weglassen |
| `type` | `"BIT"` (I, Q, M, N, ID) · `"BYTE"` (MB, NB) · `"WORD"` (MW, NW, CLOCK) · `"LINT"` (32 Bit: MD, ND, IA, QA) |
| `writable` | `true` nur für Merker `M`, `MB`, `MW`, `MD`, `N`, `NB`, `NW`, `ND`. Ein- und Ausgänge sind nie schreibbar. |
| `comment` | Kommentar aus dem Programm (optional) |
| `userLabel` | eigener Anzeigename, geht vor `label` |
| `userUnit` | Einheit, z. B. `"%"` |
| `userScale` | Umrechnung Rohwert → Einheit: `{ "raw0": 0, "val0": 0, "raw1": 1000, "val1": 100 }` |
| `userDecimals` | Nachkommastellen 0–6 |
| `userRecord` | `true` = für Trends aufzeichnen |

## 4. `pages.json` – Seiten und Leisten

```json
{ "version": 2, "pages": [ Seite, … ], "bars": Leisten }
```

**Seite**

| Feld | Bedeutung |
|---|---|
| `id` | eindeutige Kennung (z. B. `"start"`) |
| `name` | Seitenname – oder `tx: { "name": "T0001" }` (Abschnitt 5) |
| `width`, `height` | Bildschirmgröße in Bildpunkten, z. B. 1920 × 1080 (Tablet 1280 × 800) |
| `start` | `true` = Startseite (höchstens eine) |
| `scroll` | `true` = Seite darf rollen (länger als der Bildschirm) |
| `noBars` | `true` = Leisten der Vorlage auf dieser Seite ausblenden |
| `noWeb` | `true` = nicht im Browser (Handy/Tablet) zeigen |
| `bg` | Hintergrund: `{ "color": "#1b2230" }` oder `{ "img": "<Bildname>", "fit": "cover" \| "contain" \| "tile" }` |
| `items` | Elemente |

**Element – für alle gleich**

| Feld | Bedeutung |
|---|---|
| `id` | eindeutige Kennung |
| `kind` | Art, siehe Liste unten |
| `x`, `y`, `w`, `h` | Platz in Bildpunkten (links oben = 0,0), am besten auf 10 er-Raster |
| `dev`, `name` | Gerät (`id`) und Variable (`name`) |
| `label` | eigene Beschriftung (fehlt = Name der Variablen) – oder `tx: { "label": "T…" }` |
| `unit`, `min`, `max`, `step` | eigene Einheit / Grenzen (fehlt = von der Variablen) |
| `font` | Schriftgröße in Prozent (fehlt = 100) |

**Arten (`kind`) und ihre eigenen Felder**

| `kind` | Element | eigene Felder |
|---|---|---|
| `number` | Zahl | `map` (Farbe nach Wert) |
| `kpi` | KPI-Kachel | `noAddr`, `map` |
| `bar` | Bar Graph | `orient` (`"v"` senkrecht), `bw` (`"m"`/`"l"`), `valpos` (`top`/`bottom`/`side`/`none`), `ticks` (`"off"`), `map` |
| `gauge` | Zeigerinstrument | `ticks` (`"out"`), `map` (farbige Bereiche `from`/`to`/`color`) |
| `lamp` | Statusmeldung | `map` (Zustände: `from`, `to`, `text`, `color`, `icon`, `blink`, eigene `dev`/`name`), `show`, `icon` |
| `status` | Statustext | `map`, `other` (sonst) |
| `clock` | Uhr der easyE4 | – (Variable `CLOCK`) |
| `switch` | Schalter | `style` (`"buttons"`), `onText`, `offText` |
| `button` | Taster | `mode` (`"tip"` tastend, `"toggle"` rastend, fehlt = Impuls), `fb` (`{dev, name}` Rückmeldung), `fbColor` (`warn`/`alarm`/`blue`/`white`, fehlt = Grün), `litText` (`white`/`black`) |
| `setpoint` | Sollwert | `min`, `max`, `step` |
| `slider` | Schieberegler | `min`, `max`, `step` |
| `choice` | Betriebsart | `opts`: `[{ "v": 0, "t": "Aus" }, …]` (2–8) |
| `text` | Text | `text` (mit Platzhaltern `{1}` …), `vars` (`[{ n, dev, name, decimals?, unit? }]`), `size` (`normal`/`title`/`hint`), `align` |
| `trend` | Trend | `series` (1–4: `{ dev, name, color 0–4, min?, max?, label? }`), `range` (`10m`/`1h`/`8h`/`1d`/`1w`/`1M`), `height` (`s`/`l`) |
| `alarms` | Meldungsliste | `height` (`s`/`l`) |
| `device` | Gerätekarte | `dev`; `name` = Lebenszeichen-Zähler (optional) |
| `image` | Bild / Statusbild | `img`, `fit` (`cover`/`none`), `alt`; Statusbild: `states: true`, `dev`, `name`, `map` mit `img` je Zustand |
| `fkey` | Funktionstaste | wie Leisten-Funktionstaste (unten) |
| `lang` | Sprachauswahl | `label` |
| `frame` | Rahmen | `title`, `look` (`fill`/`title`) |

Farben (`color`) sind Bedeutungen, die sich dem Design anpassen: `on`, `off`, `warn`, `alarm`, `accent`, `neutral`.
Symbole (`icon`): `pump` `fan` `motor` `valve` `heater` `light` `door` `bell` `tank` `temp` `drop` `flame` `snow` `power` `gear` `clock` `lock` `warning` `ok` `stop` `conveyor` `up` `down`.
Passt eine Art nicht zur Variablen (z. B. Taster auf einem Ausgang Q), zeigt easy4Visu eine passende Anzeige (dort: Statusmeldung).

**Leisten (`bars`)**

```json
{ "top": { "on": true, "items": [ Baustein, … ] }, "bottom": { … }, "left": { … }, "right": { … } }
```

Baustein: `{ "id", "type", … }` mit `type`:
`logo` (`img`) · `title` (Seitenname) · `clock` · `conn` (Verbindung) · `alarms` (Meldungszeile) · `login` (Anmeldung) ·
`lang` · `text` (`text`) · `spacer` (freier Platz) · `pagekeys` (je Seite eine Taste) · `fkey` (Funktionstaste).

Funktionstaste: `action` = `page` (`page`: Seiten-`id`) · `back` · `connect` · `fullscreen` · `theme` · `exit` · `write`
(`dev`, `name`, `value`) · `login` · `quit` · `lang`; dazu `key` (`"F1"` … `"F12"`), `label`, `confirm` (vorher nachfragen).
„Verlassen“ (`exit`) und „Beenden“ (`quit`) sieht nur ein Techniker – deshalb gehört `login` in eine Leiste.

## 5. `texte.json` – Sprachen und Übersetzungen

Es gibt zwei Wege:

**a) Einfach – Texte direkt (ohne Übersetzungen):** In den Seiten `name` und `label` direkt eintragen und in
`texte.json` nur die Sprachen angeben. easy4Visu legt die Texttabelle beim Einspielen selbst an; übersetzt wird
danach in easy4Visu unter „Sprachen“ oder per Excel.

```json
{ "version": 1, "base": "de", "langs": ["de", "en"] }
```

**b) Mit Übersetzungen:** Statt der Texte stehen in den Seiten Nummern (`tx`), die Texte selbst in `texte.json`:

| Feld | Bedeutung |
|---|---|
| `base` | Grundsprache (`"de"`) |
| `langs` | Sprachen des Projekts, Grundsprache zuerst (`"de"`, `"en"`, `"fr"` …) |
| `texts` | `{ "T0001": { "de": "Übersicht", "en": "Overview" } }` – fehlt eine Übersetzung, gilt die Grundsprache |
| `kinds` | Art je Text (Hinweis in der Tabelle): `page`, `label`, `var`, `text`, `card`, `switch`, `choice`, `map`, `fkey`, `bar`, `alarm` |
| `loc` | wo der Text steht: `"<Platz>#<Feld>": "T0001"` |
| `next` | nächste freie Nummer |

Plätze in `loc`: `p:<Seiten-id>#name` · `e:<Element-id>#label` (bzw. `#text`, `#title`, `#onText`, `#offText`) ·
`e:<id>/o<i>#t` (Betriebsart-Knopf) · `e:<id>/m<i>#text` (Werteliste) · `e:<id>/other#text` · `e:<id>/s<i>#label`
(Trend-Kurve) · `b:<Baustein-id>#text` bzw. `#label` (Leiste) · `a:<Meldungs-id>#text` · `v:<Geräte-id>|<Variable>#label`.
Im Element steht dann `"tx": { "label": "T0002" }` statt `"label": "Pumpe"`.

## 6. Weitere Dateien und Bilder

- `meldungen.json`: `{ "alarms": [{ "id", "dev", "name", "text", "level": "fault" | "warn" | "info", "when": 1 | 0 }], "ackVars": { "<Geräte-id>": "<Variable>" } }`
  – `when` = Meldung kommt bei 1 (Standard) oder bei 0; `ackVars` = Variable, die beim Quittieren kurz 1 wird.
- `symbole.json`: `{ "symbols": [{ "img": "<Bildname>", "name": "pumpe-an", "group": "Pumpen" }] }`
- `theme.json`: Design – am einfachsten in easy4Visu gestalten und aus einer echten Sicherung übernehmen.
- `images`: `{ "<Name>": "<Base64>" }`. Name = **16 Kleinbuchstaben/Ziffern 0–9 a–f** + `.png` · `.jpg` · `.gif` ·
  `.webp` · `.svg` (empfohlen: die ersten 16 Zeichen der SHA-256-Prüfsumme der Datei). Höchstens 10 MB je Bild.
  Seiten verweisen mit diesem Namen (`img`).

## 7. Vollständiges Beispiel

2 Geräte (Modbus und MQTT), 1 Startseite mit Taster (rastend, mit Rückmeldung), Sollwert und senkrechtem Bar Graph,
Leisten oben und unten, Texttabelle Deutsch/Englisch (Weg b). Geprüft am 05.11.2026: einspielen, Seite und
Elemente richtig, Füllstand in %, auf Englisch „Overview / Pump / Run-on setpoint / Level“.

```json
{
  "easy4visu": "projekt",
  "format": 1,
  "created": "2026-11-05T12:00:00Z",
  "app": "Demo-Generator 1.0",
  "files": {
    "devices.json": {
      "version": 1,
      "devices": [
        {
          "id": "nt1",
          "name": "Pumpstation",
          "protocol": "modbus",
          "interval": 500,
          "settings": { "host": "192.168.1.10", "port": 502 },
          "variables": [
            { "name": "Nachlauf_Soll", "label": "Nachlauf Soll", "operand": "MW", "index": 3, "type": "WORD", "writable": true },
            { "name": "Pumpe_Ein", "label": "Pumpe ein", "operand": "M", "index": 1, "type": "BIT", "writable": true },
            { "name": "Pumpe_laeuft", "label": "Pumpe läuft", "operand": "Q", "index": 1, "type": "BIT", "writable": false }
          ]
        },
        {
          "id": "nt2",
          "name": "Zulauf",
          "protocol": "mqtt",
          "interval": 500,
          "settings": { "host": "192.168.1.20", "port": 1883, "baseTopic": "easye4/zulauf", "tls": false },
          "variables": [
            { "name": "Fuellstand", "label": "Füllstand", "operand": "MW", "index": 10, "type": "WORD", "writable": true,
              "userUnit": "%", "userScale": { "raw0": 0, "val0": 0, "raw1": 1000, "val1": 100 }, "userDecimals": 1, "userRecord": true }
          ]
        }
      ]
    },
    "pages.json": {
      "version": 2,
      "pages": [
        {
          "id": "start",
          "width": 1920,
          "height": 1080,
          "start": true,
          "tx": { "name": "T0001" },
          "items": [
            { "id": "e1", "kind": "button", "dev": "nt1", "name": "Pumpe_Ein", "mode": "toggle", "fb": { "dev": "nt1", "name": "Pumpe_laeuft" }, "fbColor": "on", "x": 40, "y": 40, "w": 200, "h": 60, "tx": { "label": "T0002" } },
            { "id": "e2", "kind": "setpoint", "dev": "nt1", "name": "Nachlauf_Soll", "unit": "s", "min": 0, "max": 600, "x": 40, "y": 140, "w": 280, "h": 120 },
            { "id": "e3", "kind": "bar", "dev": "nt2", "name": "Fuellstand", "orient": "v", "x": 360, "y": 40, "w": 120, "h": 260 }
          ]
        }
      ],
      "bars": {
        "top": { "on": true, "items": [
          { "id": "t1", "type": "title" }, { "id": "t2", "type": "spacer" }, { "id": "t3", "type": "conn" },
          { "id": "t4", "type": "login" }, { "id": "t5", "type": "clock" } ] },
        "bottom": { "on": true, "items": [
          { "id": "b1", "type": "pagekeys" }, { "id": "b2", "type": "spacer" },
          { "id": "b3", "type": "fkey", "action": "fullscreen", "key": "F11" },
          { "id": "b4", "type": "fkey", "action": "exit", "key": "F12" } ] },
        "left": { "on": false, "items": [] },
        "right": { "on": false, "items": [] }
      }
    },
    "texte.json": {
      "version": 1,
      "base": "de",
      "langs": ["de", "en"],
      "texts": {
        "T0001": { "de": "Übersicht", "en": "Overview" },
        "T0002": { "de": "Pumpe", "en": "Pump" },
        "T0003": { "de": "Pumpe läuft", "en": "Pump running" },
        "T0004": { "de": "Nachlauf Soll", "en": "Run-on setpoint" },
        "T0005": { "de": "Füllstand", "en": "Level" },
        "T0006": { "de": "Pumpe ein", "en": "Pump on" }
      },
      "kinds": { "T0001": "page", "T0002": "label", "T0003": "var", "T0004": "var", "T0005": "var", "T0006": "var" },
      "loc": {
        "p:start#name": "T0001",
        "e:e1#label": "T0002",
        "v:nt1|Pumpe_laeuft#label": "T0003",
        "v:nt1|Pumpe_Ein#label": "T0006",
        "v:nt1|Nachlauf_Soll#label": "T0004",
        "v:nt2|Fuellstand#label": "T0005"
      },
      "next": 7
    }
  },
  "images": {}
}
```

## 8. Prüfung beim Einspielen – Stand heute

Getestet am 05.11.2026 mit absichtlich fehlerhaften Dateien. **Ergebnis: Die Prüfung ist noch nicht gründlich genug.**
Geprüft wird heute nur die Hülle (gzip, JSON, `easy4visu`, `format`, `files`). Den Inhalt räumen die einzelnen Teile
beim Laden **stillschweigend** auf – ungültige Werte werden ersetzt oder verworfen, ohne Meldung.

| Fehler in der Datei | Was heute passiert | gut? |
|---|---|---|
| keine gzip-/JSON-Datei, falsche Hülle | Meldung „keine easy4Visu-Projektsicherung“ | ja |
| `format` zu neu | Meldung „aus einer neueren easy4Visu“ | ja |
| fremde Dateinamen in `files`, fremde Bildnamen | werden ignoriert | ja |
| unbekannte Felder (z. B. `"onclick"` in einem Element) | in Seiten verworfen, in Geräten nur liegen gelassen; nichts wird ausgeführt | ja |
| `devices` ist keine Liste | technische Meldung „devices.map is not a function“ | **nein** |
| `pages` ist keine Liste | eingespielt, **alle Seiten weg**, ohne Hinweis | **nein** |
| unbekanntes Protokoll | eingespielt, Gerät kann sich nie verbinden | **nein** |
| unbekannter Operand (`"XY"`) | eingespielt, Variable liefert nie Werte | **nein** |
| doppelter Gerätename | eingespielt | **nein** |
| unbekannte Element-Art | wird stillschweigend zur „Zahl“ | **nein** |
| Element auf fehlendes Gerät / fehlende Variable | eingespielt, Element zeigt „fehlt“ | Hinweis fehlt |
| Platz/Größe keine Zahl | stillschweigend auf Standard | Hinweis fehlt |
| kaputte Texttabelle | stillschweigend auf Deutsch zurückgesetzt | Hinweis fehlt |
| SVG-Bild mit eingebettetem Skript | wird nur als Bild gezeigt (Skript läuft nicht) | ok, aber besser ablehnen |

**Vorschlag (noch nicht gebaut):** eine Prüfung **vor** dem Einspielen, deren Ergebnis in der Vorschau steht:

- **Fehler** (Einspielen nicht möglich): Bestandteile vom falschen Typ, fehlende Kennungen, doppelte Kennungen oder
  Gerätenamen, unbekanntes Protokoll, unbekannter Operand, unbekannte Element-Art, ungültige Bilder.
  Meldung in Alltagssprache mit Fundstelle, z. B. „Seite „Übersicht“, Element e3: Gerät „nt9“ gibt es nicht.“
- **Hinweise** (Einspielen möglich, wird angepasst): Werte außerhalb des Bereichs, unbekannte Felder,
  Elemente auf fehlende Variablen, Taster auf nicht schreibbaren Variablen.
- dieselbe Prüfung als Kommandozeilen-Werkzeug (`node tools/check-projekt.js demo.easy4visu`), damit ein
  Generator seine Datei vor der Weitergabe prüfen kann.
