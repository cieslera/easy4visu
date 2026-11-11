# Operanden-Schreibweise in easySoft-ST (für den ST-Import)

Am echten Projekt geprüft (NET-Test 24.10.2026, easySoft 8.46, Plausibilitätskontrolle ohne Fehler,
Programme laufen): easySoft speichert die Operanden genau so, wie sie im Text stehen.

## Eigene Operanden

| Art | Beispiele | Bemerkung |
|---|---|---|
| Ein-/Ausgänge | `I01`, `Q01`, `I17`, `Q20` | zweistellig mit führender Null |
| Analog | `IA01`, `IA09`, `QA05` | zweistellig |
| Diagnose | `ID02`, `ID29` | zweistellig |
| Merker | `M1`, `M1000`, `MB3`, `MW500`, `MD200` | ohne führende Null |
| NET-Merker | `N1`, `NB3`, `NW3`, `ND3` | ohne führende Null |
| Bausteine | `T01`, `C01`, `PT01`, `GT01`, `SC01` | Aufruf `T01 ( EN := …, Q1 => … );` |
| Index | `M[5]`, `M[MB20]` | indirekter Zugriff |

## Operanden eines anderen NET-Teilnehmers

Vorangestellte NET-ID (1…8) **direkt vor dem Operanden**, ohne Trennzeichen:

| Schreibweise | Bedeutung |
|---|---|
| `2N1`, `2NW3`, `2ND3` | NET-Merker N1 / NW3 / ND3 **von Teilnehmer 2** (nur lesen) |
| `2SN01` | Sendebit 1 **an** Teilnehmer 2 (dort als `1RN01` lesbar) |
| `2RN01` | Empfangsbit 1 **von** Teilnehmer 2 (dort mit `1SN01` gesendet) |
| `2I01`, `2Q01`, `2IA1`, `2QA1`, `2ID1` | Remote-IO-Operanden (Teilnehmer ohne Programm, ab FW 2.40) – Schreibweise laut Eaton-Doku „2IA1“, noch nicht im Projekt geprüft |

## Gerätetasten P1 … P8

Die Tasten am Display der easyE4 sind eigene Bit-Operanden (in easySoft Typ „Bit-Ein- u. Ausgänge und Merker“,
Operand „P – Gerätetaste“, im ST-Programm/Symboltabelle P01 … P08):

| Operand | Taste |
|---|---|
| P1 | < (links) |
| P2 | ∧ (hoch) |
| P3 | > (rechts) |
| P4 | ∨ (runter) |
| P5 | OK |
| P6 | ESC |
| P7 | DEL |
| P8 | ALT |

Beispiel Ralf (06.11.2026): P1 „Licht Halle“, P2 „Licht Büro“, P3 „Heizung Freigabe“ – die Tasten werden im Programm
als Taster benutzt.

**easy4Visu:** P1 … P8 sind bekannt und werden beim Einlesen (Symboltabelle, Kommentare) **ohne Warnung übergangen**.
Sie werden (noch) nicht als Variable angelegt: ob sie über Modbus, Webserver oder MQTT lesbar sind, ist nicht geprüft.
Wer den Zustand in der Visu braucht, kopiert ihn im Programm auf einen Merker (z. B. P1 → M20).

## Folgen für easy4Visu

- Regel für den ST-Import: `^([1-8])?(I|Q|IA|QA|ID|M|MB|MW|MD|N|NB|NW|ND|SN|RN)(\d+)$`
  (bei SN/RN ist die vorangestellte ID der Partner, bei den anderen der Besitzer des Operanden).
- `2NW3` im Programm von NT1 ist dieselbe Variable wie `NW3` in NT2 → in der Visu dem Gerät NT2 zuordnen und dort
  lesen (über Modbus ab Register 2001). Operanden anderer Teilnehmer sind beim eigenen Gerät über Modbus
  **nicht** erreichbar (siehe `ITF-FORMAT.md`).
- SN/RN sind über Modbus gar nicht erreichbar – nur informativ anzeigen.
