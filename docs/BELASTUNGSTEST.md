# Belastungstest: 8 Geräte gleichzeitig (voller NET-Verbund)

Stand: 05.11.2026 · Aufruf: `node tools/loadtest.js [Minuten] [Bericht.json]` (Standard 60 Minuten)

**Aufbau:** easy4Visu-Kern mit 8 simulierten easyE4: 4 × Modbus TCP (Abfrage alle 0,5 s), 2 × Webserver (1 s),
2 × MQTT (zyklische Daten jede Sekunde). Je Gerät 80 Variablen mit laufend wechselnden Werten, 10 davon werden für
Trends aufgezeichnet (80 Kurven insgesamt). Alle 10 s wird je Gerät ein Sollwert geschrieben und die Rückmeldung
gemessen. Die Simulatoren laufen in einem eigenen Prozess; gemessen werden nur Speicher und Rechenzeit von easy4Visu.

**Ergebnis (60 Minuten, Windows-PC):**

| | Ergebnis |
|---|---|
| Fehler, Verbindungsabbrüche | **0** bei allen 8 Geräten |
| Schreiben | **2 872 von 2 872** bestätigt (359 je Gerät) |
| Bestätigung (Median / 95 % / max.) | Modbus 63–78 / 65–94 / 265 ms · Webserver 36 / 41–48 / 230 ms · MQTT 0,5 / 1,0 / 1,03 s (MQTT meldet nur jede Sekunde) |
| Abfragen | 53 300 in der Stunde (Modbus 2/s, Webserver 1/s, MQTT 2,5 Nachrichten/s je Gerät) |
| Rechenzeit | **0,9 %** eines Prozessorkerns im Mittel |
| Speicher | steigt in den ersten 20 Minuten von 86 auf 194 MB (Zwischenspeicher füllen sich), danach **stabil** (188 MB nach 60 Minuten) – kein Speicherleck |
| Trend-Datenbank | 9,8 MB in der Stunde bei 80 Kurven, die sich **jede Sekunde** ändern |

**Hinweis Trend-Datenbank:** Aufgezeichnet wird jede Änderung (spätestens jede Minute ein Wert). Eine Kurve, die sich
ständig ändert (z. B. ein „zappelnder“ Analogwert), braucht damit rund 120 kB je Stunde, also etwa 1 GB im Jahr.
Ruhige Werte brauchen nur einen Bruchteil davon. Vorgemerkt: eine Einstellung „Aufzeichnen nur bei Änderung um mehr
als …“ (Totband) bzw. „höchstens alle … s“ für sehr unruhige Werte.
