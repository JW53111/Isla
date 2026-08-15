@echo off
rem isla desktop pet launcher - double-click me to summon isla
set "ELECTRON_RUN_AS_NODE="

set "APP_DIR=%~dp0output\isla-20260815-120437\export\dist\win-unpacked"
if exist "%APP_DIR%\isla.exe" (
    start "" "%APP_DIR%\isla.exe"
) else (
    echo [WARN] isla.exe not found, trying dev mode...
    cd /d "%~dp0output\isla-20260815-120437\export"
    call npm start
)
