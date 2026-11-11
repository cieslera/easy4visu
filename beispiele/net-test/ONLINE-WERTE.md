# Online-Werte NT1 (easySoft, 24.10.2026, ca. 19:15)

Bildschirmfotos aus easySoft *Online* von NT1 (EASY-E4-DC-12TC1, FW 2.46, mit 8TE1, 6AE1, 4PE1), Programm
`net-test-nt1.st`. Dienen als Vergleich, wenn easy4Visu dieselben Werte über Modbus liest.
(Die Fotos entstanden nacheinander, daher ändern sich die NT2-Werte leicht.)

## Merkerwörter (Modbus FW 2.46: MW n = Register 46000 + n)

| Operand | Wert | Bedeutung / Prüfung |
|---|---|---|
| MW1 | 6156 = 0x180C | Bits: M3, M4, M12, M13 = 1 (M7 blinkt kurz: im MD-Foto 6220 = 0x184C) |
| MW2 | 1 | MB3 = 1 (Sekunde), MB4 = 0 |
| MW3 | 1 | Lebenszeichen – **bleibt bei 1**, T01 blinkt nicht (Parametersatz prüfen) |
| MW5 | 0 | Sollwert QA05 → QA05 = 0 |
| MW6 | 2521 | NW3 von NT2 (Lebenszeichen NT2) – NET läuft |
| MW7 | 2 | = IA01 |
| MW8 | 0 | Sollwert QA06 → QA06 = 819 (Begrenzung auf 4 mA greift) |
| MW9 | 1937 | = IA05 (0–10 V, ca. 4,7 V) |
| MW10 | 0 | = IA07 (4–20 mA, offen) |
| MW11/12 | 1000 / 0 | MD6 = 1000 = MW3 · 1000 |
| MW13/14 | 7563 / 0 | MD7 = per GET von NT2 = 2521 · 3 – **PUT/GET funktioniert** |
| MW15/16 | 7563 / 0 | MD8 = ND3 von NT2 – **NET-Merker des Partners funktionieren** |
| MW17/18 | 2000 / 0 | MD9 = IA08 (Pt100) |
| MW19/20 | 4000 / 0 | MD10 = IA09 (Pt1000) |

## Merker-Doppelwörter – bestätigt die Wortreihenfolge

MD n = MW(2n − 1) + MW(2n) · 65536, also **niederwertiges Wort zuerst**. Beispiel: MD3 = 166 526 976 =
MW5 (0) + MW6 (2541) · 65536.

| MD1 | MD2 | MD3 | MD4 | MD5 | MD6 | MD7 | MD8 | MD9 | MD10 |
|---|---|---|---|---|---|---|---|---|---|
| 71756 | 1 | 166526976 | 2 | 1936 | 1000 | 7626 | 7623 | 2000 | 4000 |

## Analogwerte

| Operand | Wert | Anzeige in easySoft | Bemerkung |
|---|---|---|---|
| IA01–IA04 | 2, 1, 2, 2 | 0…4095, 12 Bit | Grundgerät, nichts angeschlossen |
| IA05 | 1937 | 0…4095, 16 Bit | 6AE1 IA1, 0–10 V |
| IA06 | 284 | 0…4095, 16 Bit | 6AE1 IA2, 0–20 mA (ca. 1,4 mA) |
| IA07 | 0 | 0…4095, 16 Bit | 6AE1 IA3, 4–20 mA offen → **Drahtbruch liefert 0** (nicht 819), ID29 = 1 |
| IA08 | 2000 | −1000…2000, 16 Bit | 4PE1 T1 Pt100 – Obergrenze (200,0 °C) → Fühler offen? |
| IA09 | (4000 laut MD10) | – | 4PE1 T2 Pt1000 – Obergrenze (400,0 °C) → Fühler offen? |
| QA01–QA04 | 0 | 32 Bit | ohne Hardware |
| QA05 | 0 | 0…4095, 16 Bit | 6AE1 QA1 0–10 V |
| QA06 | 819 | 0…4095, 16 Bit | 6AE1 QA2 4–20 mA |

## Für easy4Visu

- Wertebereiche je Kanal (0…4095, −1000…2000 usw.) zeigt easySoft an, die ITF enthält sie nicht → in der Visu
  einstellbar machen (Skalierung, Einheit).
- Fühlerbruch erkennbar an Wert = Obergrenze bzw. 0 und an den Diagnosebits (ID29, ID34/ID35).

## Modbus-Test der Analogausgänge (Node-RED, node-red-contrib-easye4-modbus, 24.10.2026)

| Lesen | Ergebnis |
|---|---|
| FC3, Register 40011, 2 Register | `[819, 0]` = QA06 |
| FC4, Register 40011, 2 Register | `[819, 0]` = QA06 |
| FC3, Register 40009, 2 Register (MW5 = 2000) | `[2000, 0]` = QA05 |

→ QA ist mit **FC3 und FC4** lesbar; 32 Bit, niederwertiges Register zuerst.
