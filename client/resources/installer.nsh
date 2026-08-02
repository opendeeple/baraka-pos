; BarakaPOS custom NSIS installer script
; Runs the app as a startup application for POS kiosk use

!macro customInstall
  ; Add to Windows startup (optional — remove if not needed)
  ; WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "BarakaPOS" "$INSTDIR\BarakaPOS.exe"

  ; Install VC++ redistributable if needed (electron bundles its own)
  DetailPrint "Installing BarakaPOS..."
!macroend

!macro customUnInstall
  ; Remove from startup
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "BarakaPOS"

  ; Remove user data (ask first)
  MessageBox MB_YESNO "Do you want to remove all BarakaPOS data? This will delete your local sales database." IDNO done
  RMDir /r "$APPDATA\BarakaPOS"
  done:
!macroend
