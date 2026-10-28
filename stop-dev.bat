@echo off
:: VirtOffice-OpenCode Development Server Stopper
:: Kills only the process listening on the given port (default 5199) and its children.
setlocal
set "PORT=%~1"
if "%PORT%"=="" set "PORT=5199"

set "FOUND="
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":%PORT% " ^| findstr "LISTENING"') do (
  set "FOUND=1"
  echo Stopping process PID %%P on port %PORT% ...
  taskkill /PID %%P /T /F >nul 2>&1
)

if not defined FOUND (
  echo No process is listening on port %PORT%.
  exit /b 0
)

%SystemRoot%\System32\PING.EXE -n 2 127.0.0.1 >nul
echo Stopped.
exit /b 0
