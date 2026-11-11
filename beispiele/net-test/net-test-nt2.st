(* ======================================================================
   easy4Visu - Testprogramm fuer den ITF-Export, NET-Teilnehmer 2 (NT2)

   Gegenstueck zu net-test-nt1.st (gleiches easySoft-Projekt,
   NET-Verbund 1, dieses Geraet NET-ID 2). NT2 darf auch das Geraet mit
   Firmware 1.44 sein - dann zeigt der Export zusaetzlich die
   Adressierung der aelteren Firmware.

   Parametersaetze in easySoft einstellen (in den Bezeichner klicken):
   - T01:  Betriebsart "Blinkend", Zeitbereich "S"
   - PT01: Haken "Keine Flankenauswertung", Daten ins NET stellen nach
           jedem 10. Zyklus
   - GT01: Baustein-Eingang NET-ID = 1, PT = 01  (holt PT01 von NT1)
   SC01 wird hier NICHT benutzt (nur NT1 sendet die Uhr).

   Merkerbelegung wie bei NT1 (ohne Ueberschneidung):
   M1-M16, MB3-MB4, MW3-MW10, MD6-MD8; NET: N1-N16, NB3, NW3, ND3

   Operand  Name                  Visu
   I01      Taster                lesen
   IA01     Analog_1              lesen
   Q01      Lampe                 lesen
   Q02      Takt_Anzeige          lesen
   Q03      NT1_offline           lesen
   Q04      Bit_von_NT1           lesen (1RN01)
   M1       Fern_Ein              schreiben
   M3       Takt_1s               lesen
   M4       Takt_vorher           intern
   M5       PT01_Auftrag          lesen
   M6       PT01_Fehler           lesen
   M7       GT01_neuer_Wert       lesen
   M9       NT1_Lebenszeichen_fehlt lesen (ID01)
   M10      NT1_N1                lesen (Lampe von NT1)
   M11      NT1_N2                lesen (Takt von NT1)
   MB3      Sekunde               lesen
   MW3      Lebenszeichen         lesen
   MW5      Testwort              schreiben/lesen
   MW6      NT1_NW3               lesen (Lebenszeichen von NT1)
   MW7      Analog_1_Kopie        lesen
   MD6      Wert_an_NT1           lesen (= MW3 * 3, geht per PT01 an NT1)
   MD7      Wert_von_NT1          lesen (per GT01, = Lebenszeichen NT1 * 1000)
   MD8      NT1_ND3               lesen (ND3 von NT1)
   N1       NET_Lampe             (= Q01)
   N2       NET_Takt              (= M3)
   NB3      NET_Sekunde           (= MB3)
   NW3      NET_Lebenszeichen     (= MW3)
   ND3      NET_Wert              (= MD6)
   1SN01    Sendebit_an_NT1       (= I01)
   ====================================================================== *)

// ---- 1. Lampe ----
Q01 := I01 OR M1;

// ---- 2. Sekundentakt und Lebenszeichen ----
T01 (
    EN := TRUE,
    RE := ,
    ST := ,
    I1 := T#500ms,
    I2 := T#500ms,
    Q1 => M3,
    QV =>
);
IF M3 = TRUE AND M4 = FALSE THEN
    IF MW3 >= 65535 THEN
        MW3 := 0;
    ELSE
        MW3 := MW3 + 1;
    END_IF;
END_IF;
M4 := M3;
MB3 := MW3 MOD 60;
Q02 := M3;
MD6 := MW3 * 3;

// ---- 3. Analogwert ----
MW7 := IA01;

// ---- 4. Eigene NET-Merker ----
N1 := Q01;
N2 := M3;
NB3 := MB3;
NW3 := MW3;
ND3 := MD6;

// ---- 5. NET-Merker von NT1 lesen ----
// Falls easySoft diese Schreibweise nicht annimmt: Operand im Katalog
// (NET-Teilnehmer 1) suchen und per Drag & Drop einsetzen.
M10 := 1N1;
M11 := 1N2;
MW6 := 1NW3;
MD8 := 1ND3;

// ---- 6. Sende-/Empfangsbits ----
1SN01 := I01;         // Bit an NT1 senden (dort 2RN01)
Q04 := 1RN01;         // Bit von NT1 empfangen (dort 2SN01 = Takt)

// ---- 7. Diagnose: Lebenszeichen von NT1 fehlt ----
M9 := ID01;
Q03 := M9;

// ---- 8. Wert per PUT ins NET stellen ----
PT01 (
    EN := TRUE,
    T_ := ,
    I1 := MD6,
    Q1 => ,
    AC => M5,
    E1 => M6
);

// ---- 9. Wert von NT1 per GET holen (NET-ID 1, PT01) ----
GT01 (
    EN := TRUE,
    Q1 => M7,
    QV => MD7
);
