@echo off
cd /d "%~dp0"
docker compose --profile demo down
echo System zatrzymany.
timeout /t 3 >nul
