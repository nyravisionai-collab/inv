@echo off
setlocal enabledelayedexpansion

set "ROOT=%~dp0.."
cd /d "%ROOT%"

set REINSTALL=0
set RESET_DB=0
set DO_BUILD=1

:parse_args
if "%~1"=="" goto end_parse
if "%~1"=="--reinstall" (
    set REINSTALL=1
) else if "%~1"=="--reset-db" (
    set RESET_DB=1
) else if "%~1"=="--no-build" (
    set DO_BUILD=0
) else if "%~1"=="-h" (
    goto show_help
) else if "%~1"=="--help" (
    goto show_help
)
shift
goto parse_args
:end_parse

echo.
echo Inventory System - Installer (Windows)
echo ------------------------------------------------------------
echo Project:  %CD%

:: Check Node
node --version >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js is not installed. Please install Node.js >= 18.
    exit /b 2
)

:: Directories
echo Creating data directories...
if not exist "backend\data" mkdir "backend\data"
if not exist "backend\backups" mkdir "backend\backups"
if not exist "backend\logs" mkdir "backend\logs"
if not exist ".run" mkdir ".run"
for %%d in (logos products avatars imports misc) do (
    if not exist "backend\uploads\%%d" mkdir "backend\uploads\%%d"
)
echo [OK] Directories ready

:: Configuration
set "ENV_FILE=backend\.env"
set "ENV_EXAMPLE=backend\.env.example"

if not exist "%ENV_EXAMPLE%" (
    echo [ERROR] backend\.env.example is missing.
    exit /b 1
)

if exist "%ENV_FILE%" (
    echo [OK] Keeping your existing backend\.env
    :: Optional: Append missing keys from .env.example
) else (
    copy "%ENV_EXAMPLE%" "%ENV_FILE%" >nul
    echo [OK] Created backend\.env from .env.example
)

:: Dependencies
if %REINSTALL% equ 1 (
    echo --reinstall: removing existing node_modules...
    if exist "backend\node_modules" rmdir /s /q "backend\node_modules"
    if exist "frontend\node_modules" rmdir /s /q "frontend\node_modules"
)

echo Installing backend dependencies...
cd backend
call npm install --no-optional --omit=optional
if %ERRORLEVEL% neq 0 (
    echo [ERROR] 'npm install' failed for the backend.
    exit /b 1
)
cd ..

echo Installing frontend dependencies...
cd frontend
call npm install
if %ERRORLEVEL% neq 0 (
    echo [ERROR] 'npm install' failed for the frontend.
    exit /b 1
)
cd ..

:: Database
set "DB_FILE=backend\data\inventory.db"
if %RESET_DB% equ 1 (
    if exist "%DB_FILE%" (
        set "TIMESTAMP=%DATE:~10,4%%DATE:~4,2%%DATE:~7,2%-%TIME:~0,2%%TIME:~3,2%%TIME:~6,2%"
        set "TIMESTAMP=!TIMESTAMP: =0!"
        copy "%DB_FILE%" "backend\backups\inventory-!TIMESTAMP!.db" >nul
        del /f /q "%DB_FILE%"
        echo [OK] Old database backed up and removed
    )
)

if exist "%DB_FILE%" (
    echo [OK] Existing database kept.
) else (
    echo Creating a fresh empty database...
    cd backend
    node -e "const { bootstrap } = require('./src/server.js'); bootstrap().then(({ server, db }) => { db.persist(); server.close(() => process.exit(0)); }).catch((e) => { console.error(e.message); process.exit(1); });"
    if %ERRORLEVEL% neq 0 (
        echo [ERROR] Database initialisation failed.
        exit /b 1
    )
    cd ..
    echo [OK] Fresh database created
)

:: Frontend build
if %DO_BUILD% equ 1 (
    echo Building the frontend...
    cd frontend
    call npm run build
    if %ERRORLEVEL% neq 0 (
        echo [WARN] Frontend build failed - the app still works via START.bat (dev server).
    )
    cd ..
)

echo.
echo ============================================================
echo Install complete
echo ============================================================
echo.
echo Start the app:  START.bat
echo Stop the app:   STOP.bat
echo.

exit /b 0

:show_help
echo Usage: scripts\install.bat [options]
echo.
echo Options:
echo   --reinstall  wipe node_modules and reinstall
echo   --reset-db   DELETE the database and recreate it
echo   --no-build   skip the production frontend build
exit /b 0
