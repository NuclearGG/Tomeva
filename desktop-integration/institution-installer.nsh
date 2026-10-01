; Control Center distributes institution.json beside each desktop installer.
; Application updates have no sidecar and preserve the existing configuration.
!macro customInstall
  IfFileExists "$EXEDIR\institution.json" 0 tomeva_config_done
    CopyFiles /SILENT "$EXEDIR\institution.json" "$INSTDIR\institution.json"
  tomeva_config_done:
!macroend
