@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy\setup-lan-https.ps1" -TrustCurrentUser -Apply
pause
