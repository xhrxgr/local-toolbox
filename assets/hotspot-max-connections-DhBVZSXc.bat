@echo off
setlocal enabledelayedexpansion

:: ============================================================
::  Windows 系统自带「移动热点」连接数上限修改脚本（可恢复）
::  适用：Windows 10 / Windows 11
::  原理：修改注册表 icssvc 服务的 WifiMaxPeers 值
::        系统默认上限 8 台，可自定义 1-100
::  注意：需以管理员身份运行；修改后需重启或重开移动热点
:: ============================================================

set "regPath=HKLM\SYSTEM\CurrentControlSet\Services\icssvc\Settings"
set "regName=WifiMaxPeers"

:: 检查管理员权限
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 请右键"以管理员身份运行"此脚本！
    echo.
    pause
    exit /b 1
)

:: 读取当前值
set "currentValue="
for /f "tokens=3" %%a in ('reg query "%regPath%" /v "%regName%" 2^>nul ^| findstr "%regName%"') do (
    set "currentValue=%%a"
)

:: 读取默认值（首次运行时备份原始状态）
set "backupFile=%USERPROFILE%\hotspot_maxpeers_backup.txt"
if not exist "%backupFile%" (
    if "%currentValue%"=="" (
        echo default > "%backupFile%"
    ) else (
        echo %currentValue% > "%backupFile%"
    )
)

:menu
cls
echo ════════════════════════════════════════════
echo   Windows 移动热点 · 连接数上限设置工具
echo ════════════════════════════════════════════
echo.
echo   注册表路径：%regPath%
echo.
if "%currentValue%"=="" (
    echo   当前上限：系统默认（8 台）
) else (
    :: 去掉 0x 前缀
    set "displayVal=%currentValue%"
    if "!displayVal:~0,2!"=="0x" set "displayVal=!displayVal:~2!"
    echo   当前上限：!displayVal! 台
)
echo.
echo   [1] 修改连接数上限
echo   [2] 恢复默认（删除自定义值，恢复系统默认 8 台）
echo   [3] 查看当前设置
echo   [0] 退出
echo.
set /p "choice=请选择操作: "

if "%choice%"=="1" goto set_max
if "%choice%"=="2" goto restore
if "%choice%"=="3" goto show_current
if "%choice%"=="0" exit /b 0
echo 输入无效。
timeout /t 1 /nobreak >nul
goto menu

:set_max
cls
echo ── 修改连接数上限 ──
echo.
echo   系统默认上限为 8 台设备。
echo   可设置范围 1-100（实际受网卡硬件限制）。
echo.
set /p "newmax=请输入新的最大连接数（1-100）: "
if "!newmax!"=="" goto menu

:: 数字校验
set /a test_num=newmax 2>nul
if "!test_num!"=="0" if not "!newmax!"=="0" (
    echo [错误] 请输入有效数字！
    pause
    goto menu
)
if !newmax! lss 1 (
    echo [错误] 最小值为 1。
    set "newmax=1"
)
if !newmax! gtr 100 (
    echo [警告] 超过 100，已限制为 100（实际受网卡硬件限制）。
    set "newmax=100"
)

echo.
echo 即将设置：
echo   最大连接数 = !newmax! 台
echo   注册表路径 = %regPath%
echo.
set /p "confirm=确认修改？(Y/N): "
if /i not "!confirm!"=="Y" goto menu

echo [操作] 正在写入注册表...
reg add "%regPath%" /v "%regName%" /t REG_DWORD /d !newmax! /f >nul
if %errorlevel% neq 0 (
    echo [错误] 注册表写入失败！请确认以管理员身份运行。
    pause
    goto menu
)

echo [完成] 最大连接数已设置为 !newmax! 台。
echo.
echo   生效方式（任选其一）：
echo   1. 关闭移动热点再重新打开（设置 → 网络和 Internet → 移动热点）
echo   2. 重启电脑
echo.
echo   如需恢复默认，重新运行此脚本选择 [2]。
echo.
pause
goto menu

:restore
cls
echo ── 恢复原始值 ──
echo.
echo 将按首次运行时的备份恢复 WifiMaxPeers：
echo   备份为 default   → 删除自定义值，回到系统默认（8 台）
echo   备份为具体数值   → 恢复成你当时的设置
echo.
set /p "confirm=确认恢复？(Y/N): "
if /i not "!confirm!"=="Y" goto menu

if not exist "%backupFile%" (
    echo [提示] 找不到备份文件，按「删除自定义值」处理。
    reg delete "%regPath%" /v "%regName%" /f >nul 2>&1
    echo [完成] 已恢复系统默认（8 台）。
    goto restore_done
)
rem 读取备份内容：default 或 0x 开头的十六进制
set "savedValue="
for /f "usebackq tokens=*" %%b in (`type "%backupFile%"`) do set "savedValue=%%b"
if "%savedValue%"=="default" (
    echo [操作] 备份记录为系统默认，正在删除自定义值...
    reg delete "%regPath%" /v "%regName%" /f >nul 2>&1
    echo [完成] 已恢复系统默认（8 台）。
    goto restore_done
)
rem 0x 十六进制转十进制再写回（reg add 对十进制最稳）
set "decVal="
if "!savedValue:~0,2!"=="0x" set /a decVal=!savedValue! >nul 2>&1
if "!decVal!"=="" set "decVal=!savedValue!"
echo [操作] 正在恢复备份值 !decVal!...
reg add "%regPath%" /v "%regName%" /t REG_DWORD /d !decVal! /f >nul 2>&1
if !errorlevel! equ 0 (
    echo [完成] 已恢复为首次运行前的值（!decVal! 台）。
    del "%backupFile%" >nul 2>&1
) else (
    echo [错误] 恢复失败，请确认以管理员身份运行。
    echo        备份文件保留在 %backupFile%，修复后可再次恢复。
)

:restore_done

:show_current
cls
echo ── 当前设置 ──
echo.
echo 注册表路径：%regPath%
echo.
if "%currentValue%"=="" (
    echo   WifiMaxPeers = （未设置，系统默认 8 台）
) else (
    echo   WifiMaxPeers = %currentValue%
)
echo.
echo 备份文件：%backupFile%
if exist "%backupFile%" (
    for /f "tokens=*" %%b in ('type "%backupFile%"') do echo   原始值 = %%b
) else (
    echo   原始值 = （无备份）
)
echo.
pause
goto menu
