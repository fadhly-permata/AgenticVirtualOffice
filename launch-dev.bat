@echo off
:: VirtOffice-OpenCode Development Server Launcher
cd /d "%~dp0"

echo 🏁 Starting VirtOffice dev server...
echo.
echo Project folder: %CD%
echo.
npm run dev -- --port 5199
pause