@echo off
setlocal
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-project.ps1"
set START_EXIT_CODE=%ERRORLEVEL%

echo.
if not "%START_EXIT_CODE%"=="0" (
  echo Startup failed. Check the log paths printed above.
) else (
  echo You can close this window. The backend and frontend keep running in the background.
)
echo.
pause
exit /b %START_EXIT_CODE%
