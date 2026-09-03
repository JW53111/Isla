@echo off
rem isla desktop pet launcher - double-click me to summon isla
set "ELECTRON_RUN_AS_NODE="

rem 确保桌面有带 Isla 图标的快捷方式（没有则创建，路径变了则更新）
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\create-shortcut.ps1" >nul 2>&1

set "APP_DIR=%~dp0output\isla-20260815-120437\export"
set "EXE=%APP_DIR%\dist\win-unpacked\isla.exe"

rem 优先开发模式（直接跑最新源码）；没有 node_modules 时退回打包 exe
if exist "%~dp0node_modules\electron\dist\electron.exe" (
  start "" "%~dp0node_modules\electron\dist\electron.exe" "%APP_DIR%"
) else if exist "%EXE%" (
  start "" "%EXE%"
) else (
  echo [WARN] 未找到 electron 运行时与打包程序。
  echo 请先在 create-pet-skill 目录执行 npm install，或重新生成桌宠。
  pause
)
