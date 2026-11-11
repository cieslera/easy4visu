# NET-Testprogramme für den ITF-Export

Zwei ST-Programme für **ein** easySoft-Projekt mit zwei easyE4 im NET-Verbund 1. Sie benutzen absichtlich
viele Operandenarten, damit der easySoft-Export (*.itf) zeigt, wie sie für Modbus TCP adressiert werden.

| Datei | Gerät |
|---|---|
| `net-test-nt1.st` | NET-ID 1 – EASY-E4-DC-12TC1 (FW 2.46) mit 8TE1, 6AE1 (Analog ein/aus) und 4PE1 (Pt100/Pt1000) |
| `net-test-nt2.st` | NET-ID 2 – gerne das Gerät mit Firmware 1.44 (zeigt dann auch die ältere Adressierung) |

## So gehst du vor

1. **easySoft 8 → neues Projekt.** Ansicht *Projekt*: erstes Basisgerät einfügen, dann das zweite Gerät
   **in den NET-Verbund ziehen**. Achtung: easySoft legt es zunächst als „Remote IO“ an – das verschwindet,
   sobald es ein Programm bekommt (Schritt 3).
2. **Register Ethernet** je Gerät: IP-Adresse eintragen. **Register NET**: Verbund 1, NET-ID 1 bzw. 2,
   Bus-Delay 60 ms lassen.
3. **Programmierung** je Gerät: Programmiersprache ST, Inhalt der passenden .st-Datei einfügen.
4. **Parametersätze** der Bausteine einstellen (steht oben im Kommentar jeder Datei): T01 blinkend,
   PT01 „Keine Flankenauswertung“, GT01 NET-ID/PT des Partners.
5. **Modbus-TCP-Server** je Gerät aktivieren (Ansicht Projekt → Register Modbus-Server) mit Freigabe
   *Merker*, *NET-Merker* und *E/As und Uhrendaten lesen* – wie beim Modbus-Beispiel.
6. **Plausibilitätskontrolle.** Warnungen zu „EN“ bei PT/GT/SC sind in Ordnung.
   Falls easySoft die Operanden des anderen Teilnehmers (`2N1`, `2NW3`, `2SN01`, `2RN01` bzw. `1N1` …)
   nicht in dieser Schreibweise annimmt: Operand im Katalog beim jeweiligen NET-Teilnehmer suchen und per
   Drag & Drop einsetzen – und mir bitte sagen, wie easySoft ihn schreibt.
7. **Programme übertragen** (mit NT1 online gehen, *PC → Gerät*, beide Teilnehmer anhaken).
8. **Export:** für jedes Gerät die Variablenliste für Galileo (*.itf) exportieren, wie beim Modbus-Beispiel.
   Bitte beide Dateien schicken – und, wenn möglich, den Wert von MW6 / MD7 / MD8 aus easySoft *Online*,
   dann kann ich prüfen, ob der NET-Datenaustausch läuft.

## Was die Exporte klären sollen

- FW 2.46: Wo liegen Merker-**Bits** (M1–M16, M1000) und Ausgänge Q – Holding-Register `R46001.x` oder Coils?
- Hohe Merkernummern (M1000, MW500, MD200) – Adressbereich am oberen Ende.
- NET-Merker N, NB, NW, ND des eigenen Geräts und **des anderen Teilnehmers** (2N…, 2NW…, 2ND…).
- Sende-/Empfangsbits SN/RN, Diagnosebits (ID01/ID02, ID26, ID29), Analogeingänge IA der Erweiterungen,
  Analogausgänge QA, Temperaturen, Erweiterungs-E/As I17–I20 / Q17–Q20.
- Tauchen Funktionsbaustein-Werte (PT/GT/SC) überhaupt im Export auf?
- Bei NT2 mit FW 1.44: Adressen der älteren Firmware.

**Zuordnung der Erweiterungen** (aus easySoft): 8TE1 = I17–I20 / Q17–Q20, 6AE1 = IA05–IA07 und QA05/QA06,
4PE1 = IA08 (Pt100) / IA09 (Pt1000).

Für die Analogwerte zum Testen: an 6AE1 IA1 eine Spannung 0–10 V, an IA3 4–20 mA (offen = Drahtbruch, ID29),
Pt100/Pt1000 an der 4PE1. QA05 folgt MW5 (0–4095), QA06 folgt MW8 (819–4095).

## Nicht enthalten

- **Remote IO** (Operanden wie `2I01`, `2IA1`) – dafür darf NT2 *kein* Programm haben. Das wäre ein
  eigener, dritter Test.

**Getestet am 24.10.2026:** beide Programme in easySoft 8.46 ohne Fehler übernommen (auch die Schreibweise
`2N1`, `2NW3`, `2SN01`, `2RN01`) und auf den Geräten in Betrieb; NET-Austausch und PUT/GET bestätigt
(`ONLINE-WERTE.md`). Bekannt: In NT1 muss T01 auf „Blinkend“ stehen, sonst zählt das Lebenszeichen nicht.
