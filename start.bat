@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo === StorageMaster: start calego systemu (Mosquitto + panel) ===

rem 1. Docker Desktop
docker info >nul 2>&1
if errorlevel 1 (
  echo Uruchamiam Docker Desktop...
  start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
  :wait
  timeout /t 5 /nobreak >nul
  docker info >nul 2>&1
  if errorlevel 1 goto wait
)

rem 2. Konflikt portow (lokalny Mosquitto / npm start)
for %%P in (1883 3000) do (
  powershell -NoProfile -Command "$c=Get-NetTCPConnection -State Listen -LocalPort %%P -EA 0 | ?{ $_.OwningProcess -ne 0 -and $_.RemoteAddress -in '0.0.0.0','::' -and (Get-Process -Id $_.OwningProcess -EA 0).ProcessName -notmatch '^(com\.docker\.backend|wslrelay|docker)'}; if($c){ $c | %%{ Write-Host ('  port %%P: ' + (Get-Process -Id $_.OwningProcess).ProcessName + ' PID ' + $_.OwningProcess) }; exit 1 }; exit 0"
  if errorlevel 1 (
    echo.
    echo UWAGA: port %%P jest zajety przez inny proces ^(lokalny Mosquitto albo "npm start"^).
    echo Zatrzymaj go ^(Mosquitto: uruchom "net stop mosquitto" jako administrator^) i uruchom ten plik ponownie.
    pause
    exit /b 1
  )
)

rem 3. System; dodaj symulator parametrem: start.bat demo
if /i "%~1"=="demo" (
  docker compose --profile demo up --build -d
) else (
  docker compose up --build -d
)
if errorlevel 1 (
  echo Blad uruchomienia.
  pause
  exit /b 1
)
start "" http://localhost:3000
echo Gotowe: panel http://localhost:3000, broker MQTT na porcie 1883.
timeout /t 5 >nul
