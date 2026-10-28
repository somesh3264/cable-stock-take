@echo off
title Cable Stock Take - Tally connector
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed on this PC.
  echo Install the LTS version from https://nodejs.org and run this file again.
  pause
  exit /b 1
)
if not exist config.json (
  echo config.json is missing. Copy config.example.json to config.json and fill in the sync key.
  pause
  exit /b 1
)
:run
node connector.js
echo.
echo The connector stopped. Restarting in 30 seconds. Close this window to stop it.
timeout /t 30 /nobreak >nul
goto run
