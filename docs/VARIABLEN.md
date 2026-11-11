# Variablen in easy4Visu

Alle Protokolle (Modbus TCP, JSON-API, MQTT) arbeiten mit demselben Variablenformat. Es entsteht beim Import
(.itf-Datei, später ST-Programm) oder wird von Hand angelegt.

| Feld | Beispiel | Bedeutung |
|---|---|---|
| `name` | `MW3`, `2NW3`, `CLOCK.5` | eindeutiger Name je Gerät (Schlüssel der Werte) |
| `label` | `Lebenszeichen` | Anzeigename (aus dem ST-Kommentar oder von Hand) |
| `operand`, `index` | `MW`, `3` | Operand in easySoft-Schreibweise (`docs/ST-OPERANDEN.md`); Uhr: `CLOCK`, 0–5 |
| `net` | `2` | NET-ID des Teilnehmers, dem der Operand gehört; leer = das Gerät selbst |
| `type` | `BIT`, `BYTE`, `WORD`, `INT`, `LINT`, `REAL` | Datentyp wie in der .itf (`LINT` = 32 Bit mit Vorzeichen) |
| `writable` | `true` | darf geschrieben werden (Merker, eigene NET-Merker, Uhr) |
| `modbus` | `{ area, fcRead, register, bit, bits, words }` | nur aus der .itf: genaue Modbus-Adresse |
| `comment` | `0 ... 10 V` | Bemerkung aus Symboltabelle, Kommentar-Tabelle oder Kommentar hinter der Zeile |
| `hint` | `= IA5` | Hinweis aus dem Programm (Kopie eines anderen Operanden) |
| `role` | `display`, `control`, `internal` | Vorschlag: Anzeige, Bedienung (Taster/Sollwert), intern; leer = unbekannt |
| `sources` | `['itf', 'symbols', 'st']` | woher die Variable stammt |
| `notInItf` | `true` | im Programm benutzt, aber nicht in der .itf (in easySoft nicht für Modbus freigegeben) |
| `user…` | `userLabel`, `userUnit` | eigene Änderungen des Anwenders – bleiben beim erneuten Import erhalten |

## Import aus easySoft (`src/import/`)

| Quelle | liefert |
|---|---|
| .itf (Variablenliste für Galileo) | Adressen für Modbus, schreibbar ja/nein |
| Symboltabelle (CSV-Export „Symbolische Namen“, UTF-16) | Namen; das ST-Programm darf mit Namen statt Operanden arbeiten |
| Operanden-Kommentare (.xls-Export, alle Sprachen, vor allem FUP/KOP) | Anzeigenamen; Spalten „NET-ID \| Operand \| Deutsch“ (eine Spalte je Sprache), gelesen mit eigenem .xls-Leser (`src/import/xls.js`) |
| ST-Programm | Namen aus einer Kommentar-Tabelle (`MW3  Lebenszeichen  lesen …` oder `Fern_Ein  M5  schreiben …`; Spalten mit mindestens zwei Leerzeichen getrennt), Kommentare hinter Zuweisungen, ob der Operand gelesen/beschrieben wird, Kopien (`MW9 := IA05`) |

**Ohne ST-Programm (FUP/KOP – bei den meisten Anwendern)** gibt es keine Vorschläge. Die eingelesenen Variablen
werden im Editor benutzt. Optional (Einstellungen → Zusatzfunktionen, ab Werk aus) gibt es eine automatische
Bedienseite und dafür nach dem Einlesen die **Schnell-Zuordnung**: je Merker „Anzeige | Bedienung | nicht zeigen“ und ein Anzeigename, auch für
mehrere markierte auf einmal. Merker, die sich von selbst ändern, tragen den Hinweis „ändert sich“ (meist von der
Steuerung geschrieben → Anzeige). Gespeichert wird als `userRole`/`userLabel`.

Vorschlag Anzeige/Bedienung: steht in der Bemerkung „lesen“, „schreiben“ oder „intern“, gilt das. Sonst aus dem
Programm: Bedienung, wenn das Programm den Merker liest und höchstens zurücksetzt (`M6 := FALSE`) bzw. ein Wort nur
mit einer Konstanten vorbelegt (`MW3 := 3`); Anzeige, wenn das Programm ihn aus einem Ausdruck beschreibt.

Namen: Symbolname, sonst Name aus der Kommentar-Tabelle, sonst automatisch („Merkerwort MW3“). Intern bleibt der
Name wie in easySoft (`Anlage_Anforderung`), angezeigt wird er lesbar („Anlage Anforderung“).
Prüfen ohne Oberfläche: `node tools/import.js --itf … --symbole … --st …`

Statt `operand` + `index` reicht auch der Name allein (`MW3`, `I01`, `2NW3`).

## Wie die Protokolle die Variable finden

- **Modbus TCP:** nimmt `modbus` aus der .itf. Fehlt es, wird die Adresse aus Operand und Firmware-Stufe so
  berechnet, wie easySoft sie exportieren würde (geprüft an allen Exporten in `beispiele/`). Merker-Bits und
  -Bytes liegen als Bits/Bytes in den Merkerwörtern; Bits werden durch Lesen–Ändern–Schreiben des Wortes gesetzt.
- **JSON-API:** nimmt Operand und Index; NET-Merker anderer Teilnehmer (`2NW3`) liest sie direkt als `NW(2;3)`.
- **MQTT:** die easyE4 sendet selbst (nur im RUN, nur was in easySoft unter „Zyklische Daten“ steht); gelesen wird
  der zuletzt empfangene Wert. Bits kommen als 0/1, auch wenn die easyE4 true/false schickt.
- Operanden **anderer NET-Teilnehmer** sind über Modbus beim eigenen Gerät nicht erreichbar: in der Visu dem
  Gerät mit dieser NET-ID zuordnen. Sende-/Empfangsbits (`SN`/`RN`) und Bausteinwerte gehen über Modbus gar nicht.

## Noch offen

- Skalierung und Einheit je Variable (z. B. 0…4095 → 0…10 V, Pt100 in 0,1 °C) – die .itf enthält das nicht.
- Option „Merker, NET-Merker nur lesend“ steht nicht in der .itf; ein Schreibversuch meldet dann einen
  verständlichen Fehler.
