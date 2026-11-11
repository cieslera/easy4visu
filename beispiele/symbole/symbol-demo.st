(* Testprogramm für easy4Visu: arbeitet nur mit symbolischen Namen aus
   Symbolische_Namen_easye4_mqtt_demo_Main.csv (keine Operanden im Programmtext).
   Nicht am Gerät geprüft – dient nur dem automatischen Test des ST-Imports. *)

// Anlage ein: Taster am Gerät (Selbsthaltung) oder Fern-Ein aus der Visu
IF Hand_Ein AND NOT I01_vorher THEN
    Hand_Ein_gespeichert := NOT Hand_Ein_gespeichert;
END_IF;
I01_vorher := Hand_Ein;
Stopp_intern := Stopp_Taster OR Fern_SofortAus;
Anlage_Anforderung := (Hand_Ein_gespeichert OR Fern_Ein) AND NOT Stopp_intern;

// Nachlaufzeit aus der Visu prüfen
IF Nachlauf_Soll < 1 THEN
    Nachlauf_geprueft := 1;     // 0 ist ungültig
ELSE
    Nachlauf_geprueft := Nachlauf_Soll;
END_IF;

T02 (
    EN := Anlage_Anforderung,
    I1 := Nachlauf_geprueft,
    Q1 => T02_Ausgang,
    QV => Nachlauf_Ist
);
Anlage := Anlage_Anforderung OR T02_Ausgang;
Stoermeldung := Sollwert_Fehler;

IF Zaehler_Reset THEN
    Anzahl_Einschalt := 0;
END_IF;
