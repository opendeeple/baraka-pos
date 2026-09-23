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

  ; Remove user data (ask first) — app.setName('baraka-pos') in main.ts makes
  ; this the real userData dir; "$APPDATA\BarakaPOS" (productName casing)
  ; was never the actual path, so this prompt silently deleted nothing.
  MessageBox MB_YESNO "Do you want to remove all BarakaPOS data? This will delete your local sales database." IDNO done
  RMDir /r "$APPDATA\baraka-pos"
  done:
!macroend
