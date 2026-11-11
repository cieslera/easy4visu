(* ======================================================================
   easyE4 MQTT-Demo  -  ST-Programm fuer Node-RED (node-red-contrib-easye4-mqtt)
   Voraussetzung: easyE4 Firmware >= 2.46, easySoft 8 (>= 8.40)

   Funktion:
   Ein Ausgang Q01 (z. B. Pumpe oder Licht) kann eingeschaltet werden
     - von Hand ueber Taster I01 (Selbsthaltung),
     - aus Node-RED ueber M5 ("Fern-Ein"),
     - automatisch ueber die Wochen-Zeitschaltuhr WT01, wenn M8 = 1.
   Nach dem Ausschalten laeuft Q01 noch die Nachlaufzeit nach.
   Die Nachlaufzeit (Sekunden) kommt aus Node-RED ueber MW3:
     0 = kein Nachlauf, 1 ... 5999 = Nachlauf in Sekunden, groesser = 5999 + Meldung.
   Beim ersten Start (MB7 <> 165) wird MW3 auf den Standardwert 3 s gesetzt.
   Remanenz: Merker-Bytes MB5 bis MB7 remanent einstellen (MW3 = MB5+MB6, MB7 = Kennung).
   Dann bleiben Aenderungen aus dem Dashboard ueber einen Neustart erhalten.
   Taster I02 oder M6 aus Node-RED schalten sofort ab (ohne Nachlauf).
   Der Stopp loescht Hand-Ein, Fern-Ein und die Automatik-Freigabe. Danach bleibt
   Q01 aus, bis wieder bewusst eingeschaltet wird.
   C01 zaehlt die Einschaltvorgaenge, M7 aus Node-RED setzt den Zaehler auf 0.

   Operanden (keine Ueberschneidungen: M1-M16 = MB1-2, MW3 = MB5-6, MB7, MD20-23 = MB77-92)
   Name                 Operand  Richtung MQTT
   Anlage_Anforderung   M1       lesen
   Uhr_Ein              M3       lesen
   Sollwert_Fehler      M4       lesen
   Fern_Ein             M5       schreiben (1 = ein, 0 = aus)
   Fern_SofortAus       M6       schreiben (1 = Impuls, Programm setzt selbst zurueck)
   Zaehler_Reset        M7       schreiben (1 = Impuls, Programm setzt selbst zurueck)
   Automatik_Frei       M8       schreiben (1 = Zeitschaltuhr darf einschalten)
   Stopp_intern         M9       nur intern
   Hand_Ein_gespeichert M10      nur intern (Selbsthaltung Taster I01)
   I01_vorher           M11      nur intern (Flankenerkennung I01)
   T02_Ausgang          M12      nur intern
   Kein_Nachlauf        M13      nur intern (MW3 = 0)
   T02_Start            M14      nur intern
   Nachlauf_Soll        MW3      schreiben (0 ... 5999 Sekunden), remanent
   Init_Kennung         MB7      nur intern (165 = Standardwert gesetzt), remanent
   Nachlauf_geprueft    MD20     lesen (0 = kein Nachlauf)
   T02_Sollwert         MD23     nur intern (1 ... 5999)
   Anzahl_Einschalt     MD21     lesen
   Nachlauf_Ist         MD22     lesen
   Hand_Ein             I01      Taster am Geraet (Schliesser)
   Stopp_Taster         I02      Taster am Geraet (Schliesser)
   Anlage               Q01      Ausgang
   Stoermeldung         Q02      Ausgang
   ====================================================================== *)

// ---- 0. Erster Start: Standardwert fuer die Nachlaufzeit ----
// Ohne Remanenz ist MB7 nach jedem Einschalten 0 -> MW3 startet immer mit 3 s.
// Mit Remanenz (MB5-MB7) passiert das nur nach einer Programmuebertragung.
IF MB7 <> 165 THEN
    MW3 := 3;                   // Standardwert 3 Sekunden
    MB7 := 165;                 // Kennung: Standardwert wurde gesetzt
END_IF;

// ---- 1. Hand-Ein: Taster I01 mit Selbsthaltung (nur steigende Flanke) ----
IF I01 = TRUE AND M11 = FALSE THEN
    M10 := TRUE;                // Taster wurde gerade gedrueckt -> Hand-Ein merken
END_IF;
M11 := I01;                     // Zustand fuer die Flankenerkennung im naechsten Zyklus

// ---- 2. Stopp: Taster I02 oder Befehl aus Node-RED (M6) ----
// Steht bewusst NACH dem Setzen: Stopp hat immer Vorrang.
M9 := I02 OR M6;
IF M9 = TRUE THEN
    M5 := FALSE;                // Fern-Ein loeschen
    M10 := FALSE;               // Hand-Ein loeschen
    M8 := FALSE;                // Automatik-Freigabe loeschen
END_IF;

// ---- 3. Nachlaufzeit aus Node-RED pruefen (MW3 -> MD20) ----
IF MW3 > 5999 THEN
    MD20 := 5999;               // Maximum fuer Zeitbereich M:S (99:59)
    M4 := TRUE;                 // Meldung: Sollwert zu gross
ELSE
    MD20 := MW3;                // 0 ... 5999
    M4 := FALSE;
END_IF;
Q02 := M4;

M13 := (MD20 = 0);              // 0 = kein Nachlauf
IF M13 = TRUE THEN
    MD23 := 1;                  // Zeitrelais nie mit 0 betreiben (nicht dokumentiert)
ELSE
    MD23 := MD20;
END_IF;

// ---- 4. Wochen-Zeitschaltuhr (Schaltzeiten im Parametersatz / per MQTT) ----
WT01 (
    EN := ,
    Q1 => M3
);

// ---- 5. Anforderung bilden ----
M1 := (M5 OR M10 OR (M8 AND M3)) AND NOT M9;

// ---- 6. Ausgang mit Nachlauf (T02 = rueckfallverzoegert, Zeitbereich M:S) ----
// T02 wird immer aufgerufen. Bei "kein Nachlauf" schaltet M1 den Ausgang direkt.
M14 := M1 AND NOT M13;          // T02 nur starten, wenn Nachlauf gewuenscht
T02 (
    EN := M14,
    RE := M9,
    ST := ,
    I1 := MD23,
    I2 := ,
    Q1 => M12,
    QV => MD22
);
IF M13 = TRUE THEN
    Q01 := M1;                  // kein Nachlauf: Ausgang folgt der Anforderung
ELSE
    Q01 := M12;                 // mit Nachlauf: Ausgang vom Zeitrelais
END_IF;

// ---- 7. Einschaltvorgaenge zaehlen ----
C01 (
    EN := ,
    C_ := Q01,
    D_ := ,
    SE := ,
    RE := M7,
    SH := ,
    SL := ,
    SV := ,
    OF => ,
    FB => ,
    CY => ,
    ZE => ,
    QV => MD21
);

// ---- 8. Impuls-Befehle aus Node-RED zuruecksetzen ----
M6 := FALSE;
M7 := FALSE;
