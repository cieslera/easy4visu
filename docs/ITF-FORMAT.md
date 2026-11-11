# easySoft-Variablenliste für Galileo (*.itf)

easySoft exportiert die im Programm benutzten Operanden als *.itf, damit man sie in der Eaton-Visu Galileo
nicht von Hand anlegen muss. easy4Visu liest diese Datei ebenfalls (`src/import/itf.js`).

## Aufbau

Reiner Text (ASCII), Zeilenende CRLF, Spalten mit Tabulator getrennt, erste Zeile `Name  Type  Address`.

Beispiel `beispiele/easye4mb-beispiel.itf` (passt zum Modbus-Beispielprogramm `easye4mb-beispiel.st`):

| Name | Type | Address | Bedeutung |
|---|---|---|---|
| `M001_M016[1..16]` | BIT | `R1001.0` | M1–M16 = Bits 0–15 von Holding-Register 1001 (= MW1) |
| `MB003_MB004[3..4]` | BYTE | `R1002.0` | MB3 = Low-Byte, MB4 = High-Byte von Register 1002 (= MW2) |
| `MW003` | WORD | `R1003` | MW3 |
| `MD006` | LINT | `R1011` | MD6 = Register 1011 + 1012, niederwertiges Register zuerst |
| `I01` | BIT | `MI1` | Eingang I1 = Discrete Input 1 (FC2) |
| `Q01` | BIT | `M1` | Ausgang Q1 = **Coil** 1 (FC1) – „M“ heißt hier Modbus-Coil, nicht Merker! |
| `RTC_EASY[0..5]` | WORD | `R5000` | Uhr: Sekunde, Minute, Stunde, Tag, Monat, Jahr (5000–5005) |

Beispiel `beispiele/test-netzwerk-nt1-fw246.itf` (Gerät mit **Firmware 2.46**):

| Name | Type | Address | Bedeutung |
|---|---|---|---|
| `MW002` | WORD | `R46002` | MW2 – ab FW 2.40 liegen die Merkerwörter bei 46000 + n |
| `MW010` | WORD | `R46010` | MW10 |
| `I01` | BIT | `MI1` | Eingang I1 – auch bei FW 2.46 auf der alten Adresse 1 |
| `IA02` | LINT | `RI42003` | Analogeingang IA2, 32 Bit, Input Register 42003 + 42004 (FC4) |
| `IA03` | LINT | `RI42005` | IA3 (IA n = 42001 + 2·(n − 1)) |
| `RTC_EASY[0..5]` | WORD | `R5000` | Uhr, unverändert 5000–5005 |

Die Datei passt also immer zur Firmware des Geräts, für das in easySoft exportiert wurde. easy4Visu muss die
Registerbereiche nicht selbst kennen, sondern übernimmt sie aus der Datei.

## Regeln beim Einlesen

- Adresskürzel: `R` = Holding Register (FC3/6/16), `MI` = Discrete Input (FC2), `M` = Coil (FC1/5),
  `RI` = Input Register (FC4, mit dem FW-2.46-Export bestätigt).
- `.n` hinter einem Register = Startbit. Felder `[a..b]` werden in einzelne Variablen aufgeteilt:
  Bits/Bytes laufen innerhalb des Registers weiter (Bit 16 → nächstes Register), Wörter +1, 32 Bit +2.
- Die Register-Nummern sind die direkten Telegramm-Adressen (MW1 = 1001) – deckt sich mit der Messung am
  echten Gerät (Modbus-Paket 1.0.1).
- Ein-/Ausgänge werden als „nur lesen“ markiert, Merker und Uhr als schreibbar.
- Die Liste enthält nur Operanden, die im Programm vorkommen, und **keine Kommentare**. Namen kommen
  deshalb zusätzlich aus dem ST-Import; beide Listen werden zusammengeführt.

## NET-Test 24.10.2026 (`beispiele/net-test/`)

NT1 = EASY-E4-DC-12TC1, FW 2.46, mit 8TE1, 6AE1, 4PE1. NT2 = ältere Firmware im Bereich 1.40–2.3x
(Merker ab 1001, IA 32 Bit ab 6501). Export mit allen Freigaben im Register *Modbus-Server*.

| Operand | NT1 (FW 2.46) | NT2 (FW 1.4x) | Erkenntnis |
|---|---|---|---|
| `M001_M016[1..16]` | `R46001.0` | `R1001.0` | Merker-**Bits** liegen als Bits im Holding-Register (keine Coils) |
| `MD006`… | `R46011`… | `R1011`… | MD n = Basis + 2n − 1 (MD200 = 46399) |
| `M993_M1008[…]` | `R46063.0` | – | Merker-Bits immer als ganzes Wort exportiert (M1000 → MW63) |
| `N001_N016[1..16]` | `R2001.0` | `R2001.0` | **NET-Merker bei beiden FW ab 2001** (N als Bits in NW1) |
| `NB003_NB004[3..4]` | `R2002.0` | `R2002.0` | NB3 = Low-, NB4 = High-Byte von NW2 |
| `NW003` / `ND003` | `R2003` / `R2005` | gleich | ND n = 2000 + 2n − 1, niederwertiges Register zuerst |
| `ID…` | `MI3002`… | `MI3001` | Diagnosebits = Discrete Inputs 3000 + n |
| `I17`–`I20` / `Q17`–`Q20` | `MI17`… / `M17`… | – | Erweiterungs-E/As direkt mit ihrer Nummer |
| `IA01`, `IA05`–`IA09` | `RI42001`…`RI42017` | `RI6501` | IA n = 42001 bzw. 6501 + 2·(n − 1), auch Erweiterungen/Temperaturen |
| `QA05`, `QA06` | `RI40009`, `RI40011` | – | ITF sagt „RI“ (FC4), Eaton-Map FC3 – **am Gerät geprüft: beide gehen** (QA06 = [819, 0], QA05 = [2000, 0] bei MW5 = 2000). easy4Visu nimmt FC4 laut ITF |
| `RTC_EASY[0..5]` | `R5000` | `R5000` | Uhr bei beiden gleich |

**Die ITF enthält nur, was im Register *Modbus-Server* freigegeben ist** (ohne Freigaben fehlten NET-Merker,
E/As und Uhr). Auch mit Freigaben **nicht** enthalten: NET-Operanden des anderen Teilnehmers (2N…, 2NW…, 2ND…),
Sende-/Empfangsbits SN/RN und Bausteinwerte (PT/GT/SC) – die sind über Modbus offenbar nicht erreichbar; eine Visu
liest sie beim jeweiligen Gerät selbst. Hohe Merker (dritter Export): `M993_M1008[993..1008]` → `R46063.0` (easySoft exportiert für M1000 das
ganze Merkerwort MW63), `MW500` → `R46500`, `MD200` → `R46399` – die Formeln gelten bis zum Ende. Größter Freigabebereich: FW 2.46 MW01–MW1022 / NW01–NW32,
FW 1.44 MW01–MW512.

Die Option *Merker, NET-Merker nur lesend* steht **nicht** in der ITF – easy4Visu muss sie deshalb beim ersten
Schreibversuch erkennen (Modbus-Exception) bzw. der Anwender stellt sie ein.

## Offen

- Am Gerät gegenprüfen: IA-Werte mit angeschlossenem Signal (Wortreihenfolge der 32 Bit), negative Temperaturen.
