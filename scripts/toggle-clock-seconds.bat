@echo off
chcp 65001 >nul 2>&1
setlocal

:: ============================================================
::  Windows 任务栏时钟显示秒数 · 一键切换脚本（可恢复）
::  适用：Windows 10 / Windows 11
::  原理：修改注册表 ShowSecondsInSystemClock 值并重启资源管理器
::  默认行为：Windows 原生不含此项（即不显示秒），脚本可随时切回
:: ============================================================

set "regPath=HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\Advanced"
set "regName=ShowSecondsInSystemClock"

:: 读取当前值
set "currentValue=0"
for /f "tokens=3" %%a in ('reg query "%regPath%" /v "%regName%" 2^>nul ^| findstr "%regName%"') do (
    set "currentValue=%%a"
)
:: 去掉 0x 前缀统一判断
if "%currentValue:~0,2%"=="0x" set "currentValue=%currentValue:~2%"

cls
echo ════════════════════════════════════════════
echo   任务栏时钟秒数显示 · 切换工具
echo ════════════════════════════════════════════
echo.
if "%currentValue%"=="1" (
    echo   当前状态：已开启（显示秒数）
    echo.
    echo   [1] 关闭秒数显示（恢复 Windows 默认）
    echo   [0] 退出
) else (
    echo   当前状态：未开启（Windows 默认）
    echo.
    echo   [1] 开启秒数显示
    echo   [0] 退出
)
echo.
set /p "choice=请选择: "

if not "%choice%"=="1" exit /b 0

:: 切换
if "%currentValue%"=="1" (
    echo [操作] 正在关闭秒数显示，恢复默认...
    reg add "%regPath%" /v "%regName%" /t REG_DWORD /d 0 /f >nul
) else (
    echo [操作] 正在开启秒数显示...
    reg add "%regPath%" /v "%regName%" /t REG_DWORD /d 1 /f >nul
)

:: 重启资源管理器使设置生效
echo [操作] 正在重启资源管理器...
taskkill /f /im explorer.exe >nul 2>&1
timeout /t 1 /nobreak >nul
start explorer.exe

echo.
echo [完成] 设置已生效。
echo        如需恢复，再次运行此脚本即可切回。
echo.
pause
