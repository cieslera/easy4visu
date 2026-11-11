; easy4Visu – Ergänzungen für den Windows-Installer (electron-builder, NSIS)
; - Startmenü-Eintrag „easy4Visu – Notfall-Zugang“: startet mit --notfall und fragt nach Administratorrechten
; - beim Deinstallieren: diesen Eintrag und die Windows-Aufgabe „easy4Visu“ (Mit Windows starten) entfernen
;   (E4_TASK_NAME nur für Tests, damit eine echte Aufgabe unberührt bleibt – wie in app/autostart.js)
; Der Datenordner (%APPDATA%\easy4Visu mit Projekt und Aufzeichnungen) bleibt beim Deinstallieren erhalten.

!macro customInstall
  ; Datenordner des installierenden Benutzers mitgeben: meldet sich beim Notfall-Zugang ein anderer Windows-Administrator
  ; an, öffnet easy4Visu trotzdem das Projekt der Anlage (und nicht den leeren Ordner des Administrators)
  ReadEnvStr $2 APPDATA
  CreateShortCut "$SMPROGRAMS\easy4Visu – Notfall-Zugang.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" '--notfall --daten="$2\easy4Visu"' "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0
  ; „Als Administrator ausführen“ in der Verknüpfung einschalten (Bit SLDF_RUNAS_USER = 0x2000 der LinkFlags)
  FileOpen $0 "$SMPROGRAMS\easy4Visu – Notfall-Zugang.lnk" a
  FileSeek $0 0x15 SET
  FileReadByte $0 $1
  IntOp $1 $1 | 0x20
  FileSeek $0 0x15 SET
  FileWriteByte $0 $1
  FileClose $0
!macroend

!macro customUnInstall
  Delete "$SMPROGRAMS\easy4Visu – Notfall-Zugang.lnk"
  ReadEnvStr $0 E4_TASK_NAME
  StrCmp $0 "" 0 +2
    StrCpy $0 "easy4Visu"
  nsExec::Exec 'schtasks /Delete /TN "$0" /F'
  Pop $1
!macroend
