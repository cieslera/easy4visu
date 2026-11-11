# easy4Visu an echten Geräten testen (Prüfprogramm)

> **Stand 25.10.2026:** Tests 1–7 am Gerät bestanden (Modbus lesen/schreiben/beobachten mit FW 2.46 und 1.42,
> mit und ohne .itf; JSON-API über HTTPS mit FW 1.42, auch NET-Merker des Partners; MQTT über den Broker auf dem
> Raspberry Pi mit TLS, Passwort und Prüfung über ca.crt; Schreiben über MQTT). Noch nicht am Gerät: RUN/STOP über MQTT.
> **26.10.2026:** Programmfenster mit NT2 (Modbus, FW 1.42): Gerät anlegen, Verbindung testen, Variablen aus
> Netzwerk-net2.itf + net-test-nt2.st einlesen (57 Variablen mit Namen) und Live-Werte bestätigt.

Das Prüfprogramm verbindet sich mit einer easyE4, zeigt „Verbindung testen“ und eine Tabelle mit Werten.
Es ändert nichts am Gerät – außer du gibst ausdrücklich `--write` an.

## Vorbereitung (einmal)

1. **Eingabeaufforderung** öffnen (Windows-Taste, „cmd“ tippen, Enter).
2. In den Projektordner wechseln (dorthin, wo der Quellcode von easy4Visu liegt, z. B. C:\easy4visu):
   ```
   cd /d C:\easy4visu
   ```
3. Zusatzpakete installieren (nur beim ersten Mal, dauert ein paar Sekunden):
   ```
   npm install
   ```
   Erwartet: `found 0 vulnerabilities`.

Hilfe zu allen Möglichkeiten: `node tools/probe.js --help`

## 1. Modbus TCP, FW 2.46 (NT1) mit der .itf-Datei

```
node tools/probe.js modbus 192.168.1.127 --fw 2.46 --itf beispiele\net-test\Netzwerk-net1.itf
```

Erwartet: `Verbindung testen: Verbindung OK – Uhr der easyE4: …` und eine Tabelle mit allen 98 Variablen.
Vergleich mit `beispiele/net-test/ONLINE-WERTE.md`: z. B. MW6 ≈ Lebenszeichen von NT2 (zählt hoch),
MD6 = MW3 · 1000, IA05 ≈ 1937 (bei ca. 4,7 V), QA06 = 819. Zeilen mit „–“ zeigen in der Spalte *Hinweis*, warum.

## 2. Dasselbe ohne .itf-Datei (prüft die eigene Adress-Rechnung)

```
node tools/probe.js modbus 192.168.1.127 --fw 2.46 --read "MW1, MW3, M3, M4, MB3, MD6, NW3, ND3, ID29, I17, Q17, IA05, IA08, QA06, CLOCK"
```

Erwartet: **dieselben Werte** wie in Test 1. Weicht ein Wert ab, bitte die Zeile notieren.

## 3. Ältere Firmware (NT2 auf 192.168.1.140, meldet FW 1.42)

```
node tools/probe.js modbus 192.168.1.140 --fw 1.44 --itf beispiele\net-test\Netzwerk-net2.itf
node tools/probe.js modbus 192.168.1.140 --fw 1.44 --read "MW3, MW6, MD6, NW3, IA01, CLOCK"
```

## 4. Schreiben (Achtung: ändert Werte im Gerät!)

Nur an einem Testaufbau. Beispiel: Sollwert für QA05 (NT1) auf 2000 setzen und danach wieder auf 0:

```
node tools/probe.js modbus 192.168.1.127 --fw 2.46 --read "MW5, QA05" --write MW5=2000
node tools/probe.js modbus 192.168.1.127 --fw 2.46 --read "MW5, QA05" --write MW5=0
```

Erwartet: `Geschrieben: MW5 = 2000`, danach `MW5 2000` und kurz darauf `QA05 2000`.
Ist im Register *Modbus-Server* „Merker, NET-Merker nur lesend“ eingestellt, kommt stattdessen eine Meldung, warum
es nicht geht.

## 5. Werte beobachten

```
node tools/probe.js modbus 192.168.1.127 --fw 2.46 --read "MW3, MW6, IA05" --watch 10
```

Liest zehnmal im Abstand von einer Sekunde (`--interval 2` = alle 2 Sekunden).

## 6. JSON-API (NT2 auf 192.168.1.140, verschlüsselt)

```
node tools/probe.js json 192.168.1.140 --https --user admin --read "MW3, MW6, NW3, 1NW3, IA1, CLOCK"
```

Das Passwort wird abgefragt (es wird nicht gespeichert). Erwartet: `Verbindung OK – „…“, Firmware 1.42 …` (so meldet sich NT2).
`1NW3` liest NW3 von NET-Teilnehmer 1 (NT1) direkt über NT2 – ohne eigene Verbindung zu NT1.
Mit API-Schlüssel statt Passwort: `--apikey <Schlüssel>` statt `--user admin`.

## 7. MQTT (FW 2.46, Broker auf dem Raspberry Pi)

In easySoft stehen die Topics `easye4/1/data`, `easye4/1/set`, `easye4/1/actions/response` und
`easye4/1/actions/request` – das Basis-Topic ist also `easye4/1`. Hat ein Gerät ganz eigene Topics, gibt man sie
einzeln an: `--topic-data …  --topic-set …  --topic-request …  --topic-response …` (statt `--base`).

```
node tools/probe.js mqtt 192.168.1.173 --port 8883 --tls --user <Benutzer am Broker> --base easye4/1
```

Mit deinem CA-Zertifikat prüft easy4Visu zusätzlich, dass es wirklich dein Broker ist (wie Node-RED mit ca.crt):

```
node tools/probe.js mqtt 192.168.1.173 --port 8883 --ca C:\Pfad\zu\ca.crt --user <Benutzer am Broker> --base easye4/1
```

Kommt „Adresse … steht nicht im Zertifikat“: statt der IP den Namen verwenden, für den das Broker-Zertifikat
ausgestellt ist (z. B. den Rechnernamen des Raspberry Pi).

Erwartet: `Verbindung OK – die easyE4 sendet n Werte (…)` und eine Tabelle mit allem, was die easyE4 unter
„Zyklische Daten“ sendet. Kommt „keine Daten der easyE4“: Basis-Topic, RUN und *Zyklische Daten* in easySoft prüfen.

## Was mir hilft

Die Ausgabe der Tests (Text markieren, kopieren) – vor allem, wenn ein Wert nicht zu easySoft *Online* passt
oder eine Meldung unverständlich ist.
