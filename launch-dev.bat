@echo off
:: VirtOffice-OpenCode Development Server Launcher
:: Stops any instance already listening on the port, then starts a fresh one.
setlocal
cd /d "%~dp0"

set "PORT=%~1"
if "%PORT%"=="" set "PORT=5199"

call :stop_port %PORT%

echo Starting VirtOffice dev server on port %PORT% ...
echo Project folder: %CD%
echo.
call npm run dev -- --port %PORT%
pause
exit /b 0

:stop_port
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":%PORT% " ^| findstr "LISTENING"') do (
  echo Stopping existing process PID %%P on port %PORT% ...
  taskkill /PID %%P /T /F >nul 2>&1
)
%SystemRoot%\System32\PING.EXE -n 2 127.0.0.1 >nul
exit /b 0
