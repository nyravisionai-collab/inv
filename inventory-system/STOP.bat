@echo off
setlocal enabledelayedexpansion

set "ROOT=%~dp0"
cd /d "%ROOT%"

set QUIET=0
set STATUS_ONLY=0

:parse_args
if "%~1"=="" goto end_parse
if "%~1"=="-q" set QUIET=1
if "%~1"=="--quiet" set QUIET=1
if "%~1"=="-s" set STATUS_ONLY=1
if "%~1"=="--status" set STATUS_ONLY=1
if "%~1"=="-h" goto show_help
if "%~1"=="--help" goto show_help
shift
goto parse_args
:end_parse

if %STATUS_ONLY% equ 1 (
    echo Inventory Management System - status
    echo ------------------------------------------------------------
    call :check_svc backend
    call :check_svc frontend
    exit /b 0
)

if %QUIET% equ 0 echo Stopping Inventory Management System...

call :stop_svc backend
call :stop_svc frontend

if %QUIET% equ 0 (
    echo.
    echo [OK] Inventory Management System stopped.
)

exit /b 0

:check_svc
set "SVC=%1"
if exist ".run\%SVC%.pid" (
    set /p PID=<.run\%SVC%.pid
    tasklist /fi "pid eq !PID!" 2>nul | find "!PID!" >nul
    if !ERRORLEVEL! equ 0 (
        echo   %SVC%: running (PID !PID!)
    ) else (
        echo   %SVC%: not running (stale PID file)
    )
) else (
    echo   %SVC%: not running
)
goto :eof

:stop_svc
set "SVC=%1"
if exist ".run\%SVC%.pid" (
    set /p PID=<.run\%SVC%.pid
    tasklist /fi "pid eq !PID!" 2>nul | find "!PID!" >nul
    if !ERRORLEVEL! equ 0 (
        if %QUIET% equ 0 echo   Stopping %SVC% (PID !PID!)...
        taskkill /f /t /pid !PID! >nul 2>&1
    )
    del ".run\%SVC%.pid"
)
goto :eof

:show_help
echo Usage: STOP.bat [options]
echo.
echo Options:
echo   --status   report what is running, change nothing
echo   --quiet    stop without the summary
echo   --help     usage
exit /b 0
