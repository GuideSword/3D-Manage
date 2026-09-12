@echo off
setlocal
cd /d "%~dp0"

set "POWERSHELL=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
"%POWERSHELL%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy\docker-backend.ps1" -Mode Install
set "EXIT_CODE=%ERRORLEVEL%"

echo.
pause
exit /b %EXIT_CODE%
