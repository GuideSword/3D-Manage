@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-web.ps1" %*
set "WEB_EXIT_CODE=%ERRORLEVEL%"
if not "%WEB_EXIT_CODE%"=="0" (
  echo.
  echo Web startup failed. See the message above.
  pause
)
exit /b %WEB_EXIT_CODE%
