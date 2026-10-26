@echo off
:: VirtOffice-OpenCode Development Server Launcher
:: Adjust this path if your project folder moves
set "PROJECT_DIR=D:\_- Research\AI\Personal Research\- AI Tools\VirtOffice-OpenCode"

cd "%PROJECT_DIR%"
echo 🏁 Starting VirtOffice dev server...
echo.
echo Project folder: %PROJECT_DIR%
echo.
npm run dev -- --port 5173 --strictPort
pause