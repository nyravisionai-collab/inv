@echo off
setlocal enabledelayedexpansion

set "ROOT=%~dp0"
cd /d "%ROOT%"

set REINSTALL=0
set START_ARGS=

:parse_args
if "%~1"=="" goto end_parse
if "%~1"=="--reinstall" (
    set REINSTALL=1
) else if "%~1"=="-h" (
    goto show_help
) else if "%~1"=="--help" (
    goto show_help
) else (
    set "START_ARGS=%START_ARGS% %1"
)
shift
goto parse_args
:end_parse

call :needs_setup
if %ERRORLEVEL% equ 0 (
    echo.
    echo ============================================================
    echo First run detected - setting everything up
    echo ------------------------------------------------------------
    echo This happens only once; it takes a few minutes.
    
    if %REINSTALL% equ 1 (
        call scripts\install.bat --reinstall
    ) else (
        call scripts\install.bat
    )
)

call START.bat %START_ARGS%
exit /b %ERRORLEVEL%

:needs_setup
if %REINSTALL% equ 1 exit /b 0
if not exist "backend\.env" exit /b 0
if not exist "backend\data\inventory.db" exit /b 0
if not exist "backend\node_modules" exit /b 0
if not exist "frontend\node_modules" exit /b 0
exit /b 1

:show_help
echo Inventory Management System - Windows Setup
echo.
echo Usage: RUN.bat [options]
echo.
echo Options:
echo   --reinstall    force the full setup step again, then start
echo   --foreground   stay attached; Ctrl-C stops both services
echo   --help         usage
exit /b 0
