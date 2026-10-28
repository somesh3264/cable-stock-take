@echo off
cd /d "%~dp0"
schtasks /Create /TN "CableStockTake Tally" /TR "\"%~dp0start-connector.bat\"" /SC ONLOGON /RL LIMITED /F
if errorlevel 1 (
  echo Could not add the start-up task. Try right-clicking this file and choosing Run as administrator.
) else (
  echo Done. The Tally connector will start each time you sign in to Windows.
  echo To start it now, double-click start-connector.bat.
)
pause
