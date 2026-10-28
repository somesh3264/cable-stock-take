@echo off
schtasks /Delete /TN "CableStockTake Tally" /F
if errorlevel 1 (
  echo There was no start-up task to remove.
) else (
  echo Removed. The connector will no longer start with Windows.
)
pause
