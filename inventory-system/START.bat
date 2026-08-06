@echo off
setlocal enabledelayedexpansion

set "ROOT=%~dp0"
cd /d "%ROOT%"

set FORCE=0
set FOREGROUND=0

:parse_args
if "%~1"=="" goto end_parse
if "%~1"=="-f" set FORCE=1
if "%~1"=="--force" set FORCE=1
if "%~1"=="--foreground" set FOREGROUND=1
if "%~1"=="--fg" set FOREGROUND=1
if "%~1"=="-h" goto show_help
if "%~1"=="--help" goto show_help
shift
goto parse_args
:end_parse

echo.
echo Inventory Management System - starting (Windows)
echo ------------------------------------------------------------
echo Project:  %ROOT%

:: Check Node
node --version >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js is not installed. Please install Node.js >= 18.
    exit /b 2
)

:: Directories
if not exist "backend\data" mkdir "backend\data"
if not exist "backend\backups" mkdir "backend\backups"
if not exist "backend\logs" mkdir "backend\logs"
if not exist ".run" mkdir ".run"
for %%d in (logos products avatars imports misc) do (
    if not exist "backend\uploads\%%d" mkdir "backend\uploads\%%d"
)

:: .env
if not exist "backend\.env" (
    if exist "backend\.env.example" (
        copy "backend\.env.example" "backend\.env" >nul
        echo [OK] Created backend\.env from .env.example
    )
)

:: Simple .env parser for PORT
set PORT=5000
if exist "backend\.env" (
    for /f "usebackq tokens=1,2 delims==" %%a in ("backend\.env") do (
        if "%%a"=="PORT" set PORT=%%b
    )
)
set FRONTEND_PORT=5173

:: Dependencies check
if not exist "backend\node_modules" (
    echo [WARN] Backend dependencies missing. Running install...
    call scripts\install.bat
)

:: Check if already running
if exist ".run\backend.pid" (
    set /p BACKEND_PID=<.run\backend.pid
    tasklist /fi "pid eq !BACKEND_PID!" 2>nul | find "!BACKEND_PID!" >nul
    if !ERRORLEVEL! equ 0 (
        if %FORCE% equ 1 (
            echo --force given; stopping the running instance first...
            call STOP.bat --quiet
        ) else (
            echo [ERROR] The Inventory System is already running (PID !BACKEND_PID!).
            echo   Open it:     http://localhost:%FRONTEND_PORT%
            echo   Stop it:     STOP.bat
            exit /b 4
        )
    )
)

:: Check ports
powershell -Command "if (Get-NetTCPConnection -LocalPort %PORT% -ErrorAction SilentlyContinue) { exit 1 } else { exit 0 }"
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Port %PORT% (backend) is already in use.
    exit /b 3
)

:: Start Backend
echo Starting backend on http://localhost:%PORT% ...
if exist "backend\logs\backend.log" del "backend\logs\backend.log"
powershell -Command "$p = Start-Process node -ArgumentList 'src/server.js' -WorkingDirectory 'backend' -NoNewWindow -PassThru -RedirectStandardOutput 'logs\backend.log' -RedirectStandardError 'logs\backend.log'; $p.Id" > .run\backend.pid
set /p BACKEND_PID=<.run\backend.pid
echo [OK] Backend started (PID %BACKEND_PID%)

:: Wait for backend to be healthy
echo Waiting for backend to start...
set HEALTH_OK=0
for /L %%i in (1,1,20) do (
    if !HEALTH_OK! equ 0 (
        powershell -Command "(Invoke-WebRequest -Uri http://localhost:%PORT%/api/health -UseBasicParsing).StatusCode" 2>nul | find "200" >nul
        if !ERRORLEVEL! equ 0 (
            set HEALTH_OK=1
        ) else (
            timeout /t 1 >nul
        )
    )
)

:: Start Frontend
echo Starting frontend on http://localhost:%FRONTEND_PORT% ...
if exist "backend\logs\frontend.log" del "backend\logs\frontend.log"
:: Use .cmd for Windows
powershell -Command "$p = Start-Process 'node_modules\.bin\vite.cmd' -ArgumentList '--host 0.0.0.0 --port %FRONTEND_PORT% --strictPort' -WorkingDirectory 'frontend' -NoNewWindow -PassThru -RedirectStandardOutput '..\backend\logs\frontend.log' -RedirectStandardError '..\backend\logs\frontend.log'; $p.Id" > .run\frontend.pid
set /p FRONTEND_PID=<.run\frontend.pid
echo [OK] Frontend started (PID %FRONTEND_PID%)

:: Get LAN IP for display
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr "IPv4 Address"') do (
    set "LAN_IP=%%a"
    set "LAN_IP=!LAN_IP:~1!"
    goto :show_summary
)
set LAN_IP=localhost

:show_summary
echo.
echo ============================================================
echo Inventory Management System is running
echo.
echo Open the app:
echo   http://localhost:%FRONTEND_PORT%
if not "%LAN_IP%"=="localhost" (
    echo   http://%LAN_IP%:%FRONTEND_PORT%   (other devices on this Wi-Fi)
    echo   http://%LAN_IP%:%PORT%/lite (for older browsers)
) else (
    echo   http://localhost:%PORT%/lite (for older browsers)
)
echo.
echo Logs:
echo   backend/logs/backend.log
echo   backend/logs/frontend.log
echo.
echo Stop with: STOP.bat
echo ============================================================

:: Auto-open browser
start http://localhost:%FRONTEND_PORT%

if %FOREGROUND% equ 1 (
    echo Running in the foreground - press Ctrl-C to stop both services.
    :loop
    tasklist /fi "pid eq %BACKEND_PID!" 2>nul | find "%BACKEND_PID%" >nul
    if !ERRORLEVEL! neq 0 goto exited
    tasklist /fi "pid eq %FRONTEND_PID%" 2>nul | find "%FRONTEND_PID%" >nul
    if !ERRORLEVEL! neq 0 goto exited
    timeout /t 2 >nul
    goto loop
    :exited
    echo A service exited on its own; shutting down.
    call STOP.bat --quiet
)

exit /b 0

:show_help
echo Usage: START.bat [options]
echo.
echo Options:
echo   --force       stop an existing instance first, then start
echo   --foreground  run in the foreground (Ctrl-C stops both)
echo   --help        usage
exit /b 0
