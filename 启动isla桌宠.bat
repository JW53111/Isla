@echo off
rem isla desktop pet launcher - double-click me to summon isla
set "ELECTRON_RUN_AS_NODE="

rem 确保桌面有带 Isla 图标的快捷方式（没有则创建，路径变了则更新）
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\create-shortcut.ps1" >nul 2>&1

set "APP_DIR=%~dp0output\isla-20260815-120437\export\dist\win-unpacked"
if exist "%APP_DIR%\isla.exe" (
    start "" "%APP_DIR%\isla.exe"
) else (
    echo [WARN] isla.exe not found, trying dev mode...
    cd /d "%~dp0output\isla-20260815-120437\export"
    call npm start
)
