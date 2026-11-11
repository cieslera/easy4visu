(* ======================================================================
   easy4Visu - Testprogramm fuer den ITF-Export, NET-Teilnehmer 1 (NT1)

   Zweck: Moeglichst viele Operandenarten benutzen, damit der easySoft-
   Export (*.itf) zeigt, wie easySoft sie fuer Modbus TCP adressiert:
   Merker-Bits, Ausgaenge, hohe Merkernummern, Analogeingaenge,
   Diagnosebits, eigene NET-Merker (N, NB, NW, ND), NET-Merker des
   anderen Teilnehmers (2N.., 2NW.., 2ND..), Sende-/Empfangsbits (SN/RN)
   und die NET-Bausteine PT, GT, SC.

   Projekt: EIN easySoft-Projekt mit zwei Geraeten im NET-Verbund 1
     NT1 = dieses Programm: EASY-E4-DC-12TC1 (FW 2.46) mit Erweiterungen
           1 = EASY-E4-DC-8TE1  (I17-I20, Q17-Q20)
           2 = EASY-E4-DC-6AE1  (Analogeingaenge IA05-IA07, QA05-QA06)
           3 = EASY-E4-DC-4PE1  (Temperatur Pt100 / Pt1000)
     NT2 = net-test-nt2.st

   BITTE PRUEFEN (Abschnitt 3): Welche IA-Nummern easySoft den
   Analog-Erweiterungen zugeordnet hat, steht in der Ansicht Projekt
   beim Modul bzw. in der Zuordnungsliste. Ich habe angenommen:
   6AE1 IA1-IA3 = IA05-IA07, 4PE1 T1/T2 = IA08/IA09. Bei anderen
   Nummern nur die Zeilen in Abschnitt 3 anpassen.
   Bus-Delay: Standard 60 ms lassen (mindestens 14 ms bei 2 Teilnehmern
   mit PUT/GET). "Remote RUN" darf aktiv bleiben (Testaufbau).

   Parametersaetze in easySoft einstellen (in den Bezeichner klicken):
   - T01:  Betriebsart "Blinkend", Zeitbereich "S"
   - PT01: Haken "Keine Flankenauswertung", Daten ins NET stellen nach
           jedem 10. Zyklus
   - GT01: Baustein-Eingang NET-ID = 2, PT = 01  (holt PT01 von NT2)
   - SC01: Standard
   Meldet die Plausibilitaetskontrolle bei PT/GT/SC nur eine WARNUNG zu
   EN, ist das in Ordnung.

   Merkerbelegung ohne Ueberschneidung
   (M1-M16 = MB1-MB2, MB3-MB4, MW3-MW10 = MB5-MB20, MD6-MD10 = MB21-MB40,
    M1000 = MB125, MD200 = MB797-MB800, MW500 = MB999-MB1000)
   NET-Merker: N1-N16 = NB1-NB2, NB3, NW3 = NB5-NB6, ND3 = NB9-NB12

   Operand  Name                  Visu
   I01      Taster_Ein            lesen
   IA01     Analog_1              lesen (I5 am EASY-E4-...-12TC1)
   IA02     Analog_2              lesen (I6)
   Q01      Lampe                 lesen
   Q02      Takt_Anzeige          lesen
   Q03      NT2_offline           lesen
   Q04      Bit_von_NT2           lesen (2RN01)
   M1       Fern_Ein              schreiben
   M2       Uhr_sync_Befehl       schreiben (Impuls, Programm setzt zurueck)
   M3       Takt_1s               lesen
   M4       Takt_vorher           intern
   M5       PT01_Auftrag          lesen (PT01 AC)
   M6       PT01_Fehler           lesen (PT01 E1)
   M7       GT01_neuer_Wert       lesen
   M8       Uhr_sync_fertig       lesen (SC01 Q1)
   M9       NT2_Lebenszeichen_fehlt lesen (ID02)
   M10      NT2_N1                lesen (Merker N1 von NT2)
   M11      Strom_ueber_10mA      lesen (IA06 > 2048)
   M14, M16 Testbits              schreiben/lesen
   M15      Ueberlast_8TE1        lesen (= ID26)
   MB3      Sekunde               lesen (0 ... 59)
   MB4      Testbyte              schreiben/lesen
   MW3      Lebenszeichen         lesen (Sekunden seit Start)
   MW5      Testwort / Sollwert_QA05 schreiben/lesen (0 ... 4095 = 0 ... 10 V)
   MW6      NT2_NW3               lesen (Lebenszeichen von NT2)
   MW7      Analog_1_Kopie        lesen (= IA01)
   MD6      Wert_an_NT2           lesen (= MW3 * 1000, geht per PT01 an NT2)
   MD7      Wert_von_NT2          lesen (per GT01 von NT2)
   MD8      NT2_ND3               lesen (ND3 von NT2)
   MD9      Temperatur_Pt100      lesen (1/10 Grad C, kann negativ sein)
   MD10     Temperatur_Pt1000     lesen (1/10 Grad C, kann negativ sein)
   MW8      Sollwert_QA06         schreiben (819 ... 4095 = 4 ... 20 mA)
   MW9      Analog_0_10V          lesen (= IA05, 0 ... 4095)
   MW10     Analog_4_20mA         lesen (= IA07, 819 ... 4095)
   I17-I20  Taster_Erw            lesen (8TE1)
   Q17-Q20  Ausgang_Erw           lesen (= I17-I20)
   IA05     Erw_0_10V             lesen (6AE1 IA1, 0...10 V)
   IA06     Erw_0_20mA            lesen (6AE1 IA2, 0...20 mA)
   IA07     Erw_4_20mA            lesen (6AE1 IA3, 4...20 mA)
   IA08     Pt100                 lesen (4PE1 T1)
   IA09     Pt1000                lesen (4PE1 T2)
   QA05     Ausgang_0_10V         lesen (= MW5, 0 ... 4095)
   QA06     Ausgang_4_20mA        lesen (= MW8, 819 ... 4095)
   ID26     Erw1_Ueberlast        lesen
   ID29     Erw2_Drahtbruch       lesen
   M12      Temperatur_hoch       lesen (Pt100 > 30,0 Grad C)
   M13      Drahtbruch_4_20mA     lesen (= ID29)
   M1000    Testbit_hoch          schreiben/lesen
   MW500    Testwort_hoch         lesen (= MW5, solange M1000 = 1)
   MD200    Testdoppelwort_hoch   lesen (= MD6, solange M1000 = 1)
   N1       NET_Lampe             (= Q01)
   N2       NET_Takt              (= M3)
   N3-N8    NET_Bits              (= M11-M16, N9-N16 frei)
   NB3      NET_Sekunde           (= MB3)
   NW3      NET_Lebenszeichen     (= MW3)
   ND3      NET_Wert              (= MD6)
   2SN01    Sendebit_an_NT2       (= M3)
   ====================================================================== *)

// ---- 1. Lampe ----
Q01 := I01 OR M1;

// ---- 2. Sekundentakt und Lebenszeichen (T01 blinkend 0,5 s / 0,5 s) ----
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
MD6 := MW3 * 1000;

// ---- 3. Analogwerte, Temperaturen und Erweiterungen ----
MW7 := IA01;                   // Basisgeraet, Eingang I5 als Analogeingang

// 8TE1: Eingaenge direkt auf die Ausgaenge der Erweiterung
Q17 := I17;
Q18 := I18;
Q19 := I19;
Q20 := I20;

// 6AE1: Analogeingaenge 
MW9 := IA05;                   // 0 ... 10 V   -> 0 ... 4095
MW10 := IA07;                  // 4 ... 20 mA  -> 819 ... 4095
M11 := (IA06 > 2048);          // 0 ... 20 mA: ueber halbem Bereich

// 6AE1: Analogausgaenge, Sollwerte aus der Visu (begrenzt)
IF MW5 > 4095 THEN
    QA05 := 4095;
ELSE
    QA05 := MW5;
END_IF;
IF MW8 < 819 THEN
    QA06 := 819;
ELSIF MW8 > 4095 THEN
    QA06 := 4095;
ELSE
    QA06 := MW8;
END_IF;

// 4PE1: Temperaturen in 1/10 Grad C (koennen negativ sein -> MD)
MD9 := IA08;
MD10 := IA09;
M12 := (MD9 > 300);            // Pt100 ueber 30,0 Grad C

// Diagnose der Erweiterungen
M13 := ID29;                   // Drahtbruch am 4...20-mA-Eingang
M15 := ID26;                   // Ueberlast Ausgaenge 8TE1

// ---- 4. Eigene NET-Merker fuellen (alle Datenbreiten) ----
N1 := Q01;
N2 := M3;
N3 := M11;
N4 := M12;
N5 := M13;
N6 := M14;
N7 := M15;
N8 := M16;
NB3 := MB3;
NW3 := MW3;
ND3 := MD6;

// ---- 5. NET-Merker von NT2 lesen ----
// Falls easySoft diese Schreibweise nicht annimmt: Operand im Katalog
// (NET-Teilnehmer 2) suchen und per Drag & Drop einsetzen.
M10 := 2N1;
MW6 := 2NW3;
MD8 := 2ND3;

// ---- 6. Sende-/Empfangsbits ----
2SN01 := M3;          // Bit an NT2 senden
Q04 := 2RN01;         // Bit von NT2 empfangen (dort 1SN01)

// ---- 7. Diagnose: Lebenszeichen von NT2 fehlt ----
M9 := ID02;
Q03 := M9;

// ---- 8. Wert per PUT ins NET stellen (zyklisch, siehe Parametersatz) ----
PT01 (
    EN := TRUE,
    T_ := ,
    I1 := MD6,
    Q1 => ,
    AC => M5,
    E1 => M6
);

// ---- 9. Wert von NT2 per GET holen (NET-ID 2, PT01) ----
GT01 (
    EN := TRUE,
    Q1 => M7,
    QV => MD7
);

// ---- 10. Uhr an alle NET-Teilnehmer senden (M2 = Befehl aus der Visu) ----
SC01 (
    EN := TRUE,
    T_ := M2,
    Q1 => M8
);

// ---- 11. Hohe Merkernummern (nur damit sie im Export auftauchen) ----
IF M1000 = TRUE THEN
    MW500 := MW5;     // Kopie von Testwort, solange M1000 = 1
    MD200 := MD6;     // Kopie von Wert_an_NT2, solange M1000 = 1
END_IF;

// ---- 12. Impuls-Befehle aus der Visu zuruecksetzen ----
M2 := FALSE;
