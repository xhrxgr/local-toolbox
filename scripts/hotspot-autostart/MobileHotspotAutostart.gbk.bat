@echo off
setlocal enabledelayedexpansion
title 移动热点开机自启

:: ============================================================
::  Windows 移动热点 · 开机自动开启
::  适用：Windows 10 / Windows 11
::  原理：通过 WinRT 的 NetworkOperatorTetheringManager 开启热点，
::        与「设置 - 网络和 Internet - 移动热点」里的开关同一套接口，
::        因此设置页里的开关状态会同步眮！?
::  自启：注册计划任务（SYSTEM 身份、系统启动时触发）
::  注意：需以管理员身份运行；本脚本不联网、不上传任何数据
:: ============================================================

set "taskName=MobileHotspotAutostart"
set "installDir=%ProgramData%\MobileHotspotAutostart"
set "ps1File=%installDir%\MobileHotspotAutostart.ps1"

:: ---------- 管理员权限检查 ----------
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 请右键本文件，选择「以管理员身份运行」。
    echo.
    pause
    exit /b 1
)

:menu
cls
echo ═══════════════════════════════════════════
echo    移动热点 · 开机自动开启
echo ═══════════════════════════════════════════
echo.
echo   [1] 安装开机自启（开机后自动开启移动热点）
echo   [2] 卸载开机自启
echo   [3] 立即开启一次移动热点
echo   [4] 关闭移动热点
echo   [5] 查看当前状态
echo   [0] 退出
echo.
set "choice="
set /p "choice=请选择操作: "

if "%choice%"=="1" goto install
if "%choice%"=="2" goto uninstall
if "%choice%"=="3" goto run_now
if "%choice%"=="4" goto run_off
if "%choice%"=="5" goto show_status
if "%choice%"=="0" exit /b 0
echo 输入无效。
timeout /t 1 /nobreak >nul
goto menu

:: ---------- 释放脚本文件 ----------
:release
if not exist "%installDir%" mkdir "%installDir%" >nul 2>&1
rem 载荷在 .bat 同目录（用户解压下载包的位置），不在 ProgramData。
rem %~dp0 自带末尾反斜杠，直接拼文件名即可。
set "payloadSrc=%~dp0payload.b64"
if not exist "%payloadSrc%" (
    echo [错误] 缺少载荷文件 payload.b64，
    echo        请把它与 MobileHotspotAutostart.bat 放在同一目录后再运行。
    pause
    exit /b 1
)
certutil -decode "%payloadSrc%" "%ps1File%" >nul 2>&1
if not exist "%ps1File%" (
    echo [错误] 释放脚本失败，请确认文件未被杀毒软件拦截。
    pause
    exit /b 1
)
exit /b 0

:: ---------- 安装 ----------
:install
call :release
if errorlevel 1 exit /b 1
echo.
echo [操作] 正在注册计划任务...
rem /TR 的参数里要保留引号，必须用 cmd 的成对双写 ""。
rem 用 \" 是无效的（cmd 不认反斜杠转义），单层引号会被 schtasks 剥掉，
rem 路径含空格时参数会被截断 —— 实测报「无效参数/选项」。
schtasks /Create /TN "%taskName%" /TR "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""%ps1File%""" /SC ONSTART /RU SYSTEM /RL HIGHEST /F >nul 2>&1
if errorlevel 1 (
    echo [错误] 注册计划任务失败。
    echo        可以在「任务计划程序」里手动新建一个开机触发的任务，
    echo        程序填 powershell.exe，参数填：
    echo        -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%ps1File%"
    pause
    goto menu
)
echo [完成] 已注册开机自启任务：%taskName%
echo.
echo   开机后系统会自动开启移动热点。
echo   如果开机时网络尚未就绪，脚本会等待并重试（最多 180 秒）。
echo   如需查看运行日志：%installDir%\hotspot.log
echo.
pause
goto menu

:: ---------- 卸载 ----------
:uninstall
echo.
echo [操作] 正在删除计划任务...
schtasks /Delete /TN "%taskName%" /F >nul 2>&1
if errorlevel 1 (
    echo [提示] 任务不存在，可能已经卸载过了。
) else (
    echo [完成] 已删除开机自启任务。
)
echo.
set /p "delFiles=是否同时删除程序文件（%installDir% 共约 20 KB）？(Y/N): "
if /i not "%delFiles%"=="Y" (
    echo   程序文件保留在 %installDir%，重新运行此脚本选 [1] 即可再次启用。
    goto uninstall_done
)
rem 卸载顺带删文件 = 完全还原到安装前；目录删掉后日志也随之消失
rd /s /q "%installDir%" >nul 2>&1
if exist "%installDir%" (
    echo [错误] 删除失败，可能有文件被占用，请手动删除 %installDir%
) else (
    echo [完成] 程序文件已删除，已还原到安装前的状态。
)

:uninstall_done
echo.
pause
goto menu

:: ---------- 立即开启 ----------
:run_now
call :release
if errorlevel 1 exit /b 1
echo.
echo [操作] 正在开启移动热点...
powershell -NoProfile -ExecutionPolicy Bypass -File "%ps1File%"
echo.
pause
goto menu

:: ---------- 关闭 ----------
:run_off
call :release
if errorlevel 1 exit /b 1
echo.
echo [操作] 正在关闭移动热点...
powershell -NoProfile -ExecutionPolicy Bypass -File "%ps1File%" -Disable
echo.
pause
goto menu

:: ---------- 查看状态 ----------
:show_status
call :release
if errorlevel 1 exit /b 1
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%ps1File%" -Status
echo.
echo   若已安装开机自启，可执行：schtasks /Query /TN "%taskName%"
echo.
pause
goto menu
