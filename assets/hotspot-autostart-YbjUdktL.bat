@echo off
setlocal
title 移动热点开机自启

:: ============================================================
::  Windows 移动热点 · 开机自动开启
::  适用：Windows 10 / Windows 11
::  原理：通过 WinRT 的 NetworkOperatorTetheringManager 开启热点，
::        与「设置 - 网络和 Internet - 移动热点」里的开关同一套接口，
::        因此设置页里的开关状态会同步变化
::  自启：注册计划任务（SYSTEM 身份、系统启动时触发）
::  注意：需以管理员身份运行；本脚本不联网、不上传任何数据
::
::  单文件版：PowerShell 脚本以 base64 内嵌在本文件末尾，
::  运行时自动释放到 %ProgramData%\MobileHotspotAutostart\。
::  只需要这一个文件 —— 不用解压、不用把多个文件放一起。
:: ============================================================

set "taskName=MobileHotspotAutostart"
set "installDir=%ProgramData%\MobileHotspotAutostart"
set "ps1File=%installDir%\MobileHotspotAutostart.ps1"

:: ---------- 管理员权限检查 ----------
net session >nul 2>&1
if errorlevel 1 (
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

if "%choice%"=="" exit /b 0
if "%choice%"=="1" goto install
if "%choice%"=="2" goto uninstall
if "%choice%"=="3" goto run_now
if "%choice%"=="4" goto run_off
if "%choice%"=="5" goto show_status
if "%choice%"=="0" exit /b 0
echo 输入无效。
rem 用 ping 延时而不是 timeout —— timeout 会先被 PATH 里的同名程序抢走
rem （Git Bash / Cygwin 都带 coreutils 的 timeout），参数格式不兼容会报错。
ping -n 2 127.0.0.1 >nul 2>&1
goto menu

:: ---------- 释放内嵌脚本 ----------
:release
if not exist "%installDir%" mkdir "%installDir%" >nul 2>&1
set "MHS_SELF=%~f0"
set "MHS_PS1=%ps1File%"
rem 从本文件末尾读出 base64 载荷并还原成 .ps1。
rem 用 28591（Latin-1）读取：字节与字符一一对应，载荷段是纯 ASCII，
rem 不受当前代码页影响。用 LastIndexOf 是因为标记串本身也出现在上面
rem 的命令行里，取最后一次出现才是真正的载荷分隔符。
rem 载荷被截断时 FromBase64String 会抛异常，这里吞掉它并返回非零，
rem 免得用户看到一屏英文堆栈 —— 上面的中文提示已经说明该怎么办了。
powershell -NoProfile -ExecutionPolicy Bypass -Command "try{$b=[IO.File]::ReadAllBytes($env:MHS_SELF);$t=[Text.Encoding]::GetEncoding(28591).GetString($b);$m='::PAYLOAD_B64::';$i=$t.LastIndexOf($m);if($i -lt 0){exit 9};$c=$t.Substring($i+$m.Length) -replace '\s','';$d=[Convert]::FromBase64String($c);if($d.Length -lt 1000){exit 8};[IO.File]::WriteAllBytes($env:MHS_PS1,$d);exit 0}catch{exit 8}" 2>nul
if errorlevel 1 (
    echo [错误] 释放脚本失败，文件可能下载不完整。
    echo        请重新下载完整的 hotspot-autostart.bat 再运行。
    pause
    exit /b 1
)
if not exist "%ps1File%" (
    echo [错误] 释放脚本失败，文件可能下载不完整。
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

exit /b 0

:: ===== 以下为构建时注入的 base64 载荷（PowerShell 脚本本体） =====
rem ::PAYLOAD_B64::
77u/PCMNCi5TWU5PUFNJUw0KICAgIOW8gOacuuiHquWKqOW8gOWQryBXaW5kb3dz44CM56e75Yqo
54Ot54K544CN77yI6K6+572uIOKGkiDnvZHnu5zlkowgSW50ZXJuZXQg4oaSIOenu+WKqOeDreeC
ue+8ieOAgg0KDQouREVTQ1JJUFRJT04NCiAgICDkvb/nlKggV2luUlQg55qEIE5ldHdvcmtPcGVy
YXRvclRldGhlcmluZ01hbmFnZXIg5byA5ZCv56e75Yqo54Ot54K5IOKAlOKAlA0KICAgIOi/meS4
juiuvue9rueVjOmdoumHjOeahOOAjOenu+WKqOeDreeCueOAjeW8gOWFs+aYr+WQjOS4gOWll+W6
leWxguaOpeWPo++8jOW8gOWFs+eKtuaAgeS8muWcqA0KICAgIOiuvue9rumhtemHjOWQjOatpeaY
vuekuu+8iOiAgeW8jyBuZXRzaCB3bGFuIHNldCBob3N0ZWRuZXR3b3JrIOS4jeihjO+8mg0KICAg
IOWug+WcqCBXaW5kb3dzIDEwIDE4MDMg5LmL5ZCO5bey6KKr6L+Z5aWX5o6l5Y+j5Y+W5Luj77yM
5LiU5LiN5Lya5pu05paw6K6+572u6aG177yJ44CCDQoNCiAgICDlvIDmnLroh6rlkK/pgJrov4fo
rqHliJLku7vliqHlrp7njrDvvJrku6UgU1lTVEVNIOi6q+S7veOAgeacgOmrmOadg+mZkO+8jOWc
qOezu+e7n+WQr+WKqOaXtuinpuWPkeOAgg0KICAgIOWunua1iyBTWVNURU0g5Lya6K+d77yIU2Vz
c2lvbiAw77yJ5LiLIFN0YXJ0VGV0aGVyaW5nQXN5bmMg5Y+v5q2j5bi46L+U5ZueIFN1Y2Nlc3Pj
gIINCg0KICAgIOW8gOacuueerOmXtOe9keWNoeS4jue9kee7nOagiOW+gOW+gOi/mOayoeWwsee7
qu+8jOWboOatpOiEmuacrOS8muetieW+heW5tumHjeivle+8jA0KICAgIOebtOWIsOeDreeCueec
n+ato+W8gOWQr+aIlui2hei/h+etieW+heS4iumZkOOAgg0KDQouUEFSQU1FVEVSIEVuYWJsZQ0K
ICAgIOW8gOWQr+enu+WKqOeDreeCue+8iOm7mOiupO+8ieOAgg0KDQouUEFSQU1FVEVSIERpc2Fi
bGUNCiAgICDlhbPpl63np7vliqjng63ngrnjgIINCg0KLlBBUkFNRVRFUiBTdGF0dXMNCiAgICDl
j6rmmL7npLrlvZPliY3nirbmgIHvvIzkuI3lgZrkv67mlLnjgIINCg0KLlBBUkFNRVRFUiBXYWl0
U2Vjb25kcw0KICAgIOetieW+hee9kee7nOWwsee7quW5tumHjeivleW8gOWQr+eahOacgOmVv+en
kuaVsO+8jOm7mOiupCAxODDjgIINCg0KLlBBUkFNRVRFUiBMb2dQYXRoDQogICAg5pel5b+X5paH
5Lu26Lev5b6E77yM6buY6K6k5YaZ5YWlICVQcm9ncmFtRGF0YSVcTW9iaWxlSG90c3BvdEF1dG9z
dGFydFxob3RzcG90LmxvZ+OAgg0KDQouRVhBTVBMRQ0KICAgIHBvd2Vyc2hlbGwgLUV4ZWN1dGlv
blBvbGljeSBCeXBhc3MgLUZpbGUgTW9iaWxlSG90c3BvdEF1dG9zdGFydC5wczENCiAgICBwb3dl
cnNoZWxsIC1FeGVjdXRpb25Qb2xpY3kgQnlwYXNzIC1GaWxlIE1vYmlsZUhvdHNwb3RBdXRvc3Rh
cnQucHMxIC1EaXNhYmxlDQojPg0KW0NtZGxldEJpbmRpbmcoKV0NCnBhcmFtKA0KICAgIFtzd2l0
Y2hdJEVuYWJsZSwNCiAgICBbc3dpdGNoXSREaXNhYmxlLA0KICAgIFtzd2l0Y2hdJFN0YXR1cywN
CiAgICBbaW50XSRXYWl0U2Vjb25kcyA9IDE4MCwNCiAgICBbc3RyaW5nXSRMb2dQYXRoID0gIiRl
bnY6UHJvZ3JhbURhdGFcTW9iaWxlSG90c3BvdEF1dG9zdGFydFxob3RzcG90LmxvZyINCikNCg0K
JEVycm9yQWN0aW9uUHJlZmVyZW5jZSA9ICdTdG9wJw0KDQojIOeDreeCueaTjeS9nOeahOi/lOWb
nuegge+8iDAgPSDmiJDlip/vvInjgILop4EgU3RhcnQtSG90c3BvdCDnmoTor7TmmI7jgIINCiRz
Y3JpcHQ6SG90c3BvdFJjID0gMQ0KDQpmdW5jdGlvbiBXcml0ZS1Mb2cgew0KICAgIHBhcmFtKFtz
dHJpbmddJE1lc3NhZ2UsIFtzdHJpbmddJExldmVsID0gJ0lORk8nKQ0KICAgICRsaW5lID0gJ1t7
MH1dIFt7MX1dIHsyfScgLWYgKEdldC1EYXRlIC1Gb3JtYXQgJ3l5eXktTU0tZGQgSEg6bW06c3Mn
KSwgJExldmVsLCAkTWVzc2FnZQ0KICAgIHRyeSB7DQogICAgICAgICRkaXIgPSBTcGxpdC1QYXRo
IC1QYXJlbnQgJExvZ1BhdGgNCiAgICAgICAgaWYgKCRkaXIgLWFuZCAtbm90IChUZXN0LVBhdGgg
JGRpcikpIHsgTmV3LUl0ZW0gLUl0ZW1UeXBlIERpcmVjdG9yeSAtUGF0aCAkZGlyIC1Gb3JjZSB8
IE91dC1OdWxsIH0NCiAgICAgICAgQWRkLUNvbnRlbnQgLVBhdGggJExvZ1BhdGggLVZhbHVlICRs
aW5lIC1FbmNvZGluZyBVVEY4DQogICAgfSBjYXRjaCB7DQogICAgICAgICMg5pel5b+X5YaZ5LiN
6L+b5Y675LiN6K+l5b2x5ZON5Li75rWB56iLDQogICAgfQ0KfQ0KDQojIOKAlOKAlCBXaW5SVCDl
vILmraXnrYnlvoUg4oCU4oCUDQojIFBvd2VyU2hlbGwgNS4xIOaXoOazleebtOaOpSBhd2FpdCBX
aW5SVCDnmoQgSUFzeW5jT3BlcmF0aW9uPFQ+77yMDQojIOmcgOimgeWAnyBTeXN0ZW0uUnVudGlt
ZS5XaW5kb3dzUnVudGltZSDnmoQgQXNUYXNrIOaJqeWxleaWueazleOAgg0KIyDnlKjlj43lsITl
j5bmmK/lm6DkuLrlroPmnInlpJrkuKrms5vlnosv6Z2e5rOb5Z6L6YeN6L2977yM5b+F6aG75oyJ
5Y+C5pWw57G75Z6L57K+56Gu562b6YCJ44CCDQojDQojIOaDsOaAp+axguWAvO+8mui/meS4quex
u+Wei+aJgOWcqOeahOeoi+W6j+mbhuimgeetiSBBZGQtVHlwZSDliqDovb3lkI7miY3lj6/nlKjv
vIwNCiMg5Zyo6ISa5pys6aG25bGC55u05o6l5Y+W5Lya5oql44CM5om+5LiN5Yiw57G75Z6L44CN
44CCDQokc2NyaXB0OkFzVGFza0dlbmVyaWMgPSAkbnVsbA0KDQpmdW5jdGlvbiBHZXQtQXNUYXNr
R2VuZXJpYyB7DQogICAgaWYgKCRudWxsIC1lcSAkc2NyaXB0OkFzVGFza0dlbmVyaWMpIHsNCiAg
ICAgICAgJG1ldGhvZHMgPSBbU3lzdGVtLldpbmRvd3NSdW50aW1lU3lzdGVtRXh0ZW5zaW9uc10u
R2V0TWV0aG9kcygpIHwgV2hlcmUtT2JqZWN0IHsNCiAgICAgICAgICAgICRfLk5hbWUgLWVxICdB
c1Rhc2snIC1hbmQgJF8uR2V0UGFyYW1ldGVycygpLkNvdW50IC1lcSAxIC1hbmQNCiAgICAgICAg
ICAgICRfLkdldFBhcmFtZXRlcnMoKVswXS5QYXJhbWV0ZXJUeXBlLk5hbWUgLWVxICdJQXN5bmNP
cGVyYXRpb25gMScNCiAgICAgICAgfQ0KICAgICAgICBpZiAoLW5vdCAkbWV0aG9kcykgeyB0aHJv
dyAn5om+5LiN5YiwIEFzVGFzayDmianlsZXmlrnms5UnIH0NCiAgICAgICAgJHNjcmlwdDpBc1Rh
c2tHZW5lcmljID0gJG1ldGhvZHNbMF0NCiAgICB9DQogICAgcmV0dXJuICRzY3JpcHQ6QXNUYXNr
R2VuZXJpYw0KfQ0KDQpmdW5jdGlvbiBBd2FpdC1XaW5SdCB7DQogICAgcGFyYW0oJE9wZXJhdGlv
biwgW1R5cGVdJFJlc3VsdFR5cGUpDQogICAgJG1ldGhvZCA9IChHZXQtQXNUYXNrR2VuZXJpYyku
TWFrZUdlbmVyaWNNZXRob2QoJFJlc3VsdFR5cGUpDQogICAgJHRhc2sgPSAkbWV0aG9kLkludm9r
ZSgkbnVsbCwgQCgkT3BlcmF0aW9uKSkNCiAgICAkdGFzay5XYWl0KC0xKSB8IE91dC1OdWxsDQog
ICAgJHRhc2suUmVzdWx0DQp9DQoNCmZ1bmN0aW9uIEluaXRpYWxpemUtV2luUnQgew0KICAgICMg
V2luUlQg57G75Z6L5b+F6aG75pi+5byP5Yqg6L295omN6IO95ZyoIFBvd2VyU2hlbGwg6YeM55So
DQogICAgW1dpbmRvd3MuTmV0d29ya2luZy5Db25uZWN0aXZpdHkuTmV0d29ya0luZm9ybWF0aW9u
LCBXaW5kb3dzLk5ldHdvcmtpbmcuQ29ubmVjdGl2aXR5LCBDb250ZW50VHlwZSA9IFdpbmRvd3NS
dW50aW1lXSB8IE91dC1OdWxsDQogICAgW1dpbmRvd3MuTmV0d29ya2luZy5OZXR3b3JrT3BlcmF0
b3JzLk5ldHdvcmtPcGVyYXRvclRldGhlcmluZ01hbmFnZXIsIFdpbmRvd3MuTmV0d29ya2luZy5O
ZXR3b3JrT3BlcmF0b3JzLCBDb250ZW50VHlwZSA9IFdpbmRvd3NSdW50aW1lXSB8IE91dC1OdWxs
DQogICAgW1dpbmRvd3MuTmV0d29ya2luZy5OZXR3b3JrT3BlcmF0b3JzLk5ldHdvcmtPcGVyYXRv
clRldGhlcmluZ09wZXJhdGlvblJlc3VsdCwgV2luZG93cy5OZXR3b3JraW5nLk5ldHdvcmtPcGVy
YXRvcnMsIENvbnRlbnRUeXBlID0gV2luZG93c1J1bnRpbWVdIHwgT3V0LU51bGwNCn0NCg0KZnVu
Y3Rpb24gR2V0LVRldGhlcmluZ01hbmFnZXIgew0KICAgIDwjDQogICAgICAgIOaJvuS4gOS4quiD
veS9nOS4uueDreeCueS4iua4uOeahOi/nuaOpemFjee9ruaWh+S7tuOAgg0KICAgICAgICDkvJjl
hYjnlKjjgIzkupLogZTnvZHov57mjqXjgI3vvJvmsqHmnInlsLHpgIDogIzmsYLlhbbmrKHnlKjk
u7vkvZXkuIDkuKrmnInov57pgJrmgKfnmoTphY3nva7jgIINCiAgICAjPg0KICAgICRwcm9maWxl
ID0gW1dpbmRvd3MuTmV0d29ya2luZy5Db25uZWN0aXZpdHkuTmV0d29ya0luZm9ybWF0aW9uXTo6
R2V0SW50ZXJuZXRDb25uZWN0aW9uUHJvZmlsZSgpDQogICAgaWYgKCRudWxsIC1lcSAkcHJvZmls
ZSkgew0KICAgICAgICBXcml0ZS1Mb2cgJ+acquaJvuWIsOS6kuiBlOe9kei/nuaOpemFjee9ru+8
jOWwneivleWFtuWug+mFjee9ruaWh+S7ticgJ1dBUk4nDQogICAgICAgIGZvcmVhY2ggKCRwIGlu
IFtXaW5kb3dzLk5ldHdvcmtpbmcuQ29ubmVjdGl2aXR5Lk5ldHdvcmtJbmZvcm1hdGlvbl06Okdl
dENvbm5lY3Rpb25Qcm9maWxlcygpKSB7DQogICAgICAgICAgICB0cnkgew0KICAgICAgICAgICAg
ICAgICRtZ3IgPSBbV2luZG93cy5OZXR3b3JraW5nLk5ldHdvcmtPcGVyYXRvcnMuTmV0d29ya09w
ZXJhdG9yVGV0aGVyaW5nTWFuYWdlcl06OkNyZWF0ZUZyb21Db25uZWN0aW9uUHJvZmlsZSgkcCkN
CiAgICAgICAgICAgICAgICBXcml0ZS1Mb2cgIuaUueeUqOmFjee9riAnJCgkcC5Qcm9maWxlTmFt
ZSknIg0KICAgICAgICAgICAgICAgIHJldHVybiAkbWdyDQogICAgICAgICAgICB9IGNhdGNoIHsN
CiAgICAgICAgICAgICAgICBXcml0ZS1Mb2cgIumFjee9riAnJCgkcC5Qcm9maWxlTmFtZSknIOS4
jeWPr+eUqDogJCgkXy5FeGNlcHRpb24uTWVzc2FnZSkiICdXQVJOJw0KICAgICAgICAgICAgfQ0K
ICAgICAgICB9DQogICAgICAgIHJldHVybiAkbnVsbA0KICAgIH0NCiAgICBXcml0ZS1Mb2cgIuS4
iua4uOi/nuaOpTogJCgkcHJvZmlsZS5Qcm9maWxlTmFtZSkiDQogICAgcmV0dXJuIFtXaW5kb3dz
Lk5ldHdvcmtpbmcuTmV0d29ya09wZXJhdG9ycy5OZXR3b3JrT3BlcmF0b3JUZXRoZXJpbmdNYW5h
Z2VyXTo6Q3JlYXRlRnJvbUNvbm5lY3Rpb25Qcm9maWxlKCRwcm9maWxlKQ0KfQ0KDQpmdW5jdGlv
biBHZXQtSG90c3BvdFN0YXRlIHsNCiAgICB0cnkgew0KICAgICAgICAkbWdyID0gR2V0LVRldGhl
cmluZ01hbmFnZXINCiAgICAgICAgaWYgKCRudWxsIC1lcSAkbWdyKSB7IHJldHVybiAnVW5rbm93
bicgfQ0KICAgICAgICByZXR1cm4gW3N0cmluZ10kbWdyLlRldGhlcmluZ09wZXJhdGlvbmFsU3Rh
dGUNCiAgICB9IGNhdGNoIHsNCiAgICAgICAgcmV0dXJuICdVbmtub3duJw0KICAgIH0NCn0NCg0K
ZnVuY3Rpb24gU3RhcnQtSG90c3BvdCB7DQogICAgIyDov5Tlm57noIHmlL7lnKjohJrmnKznuqfl
j5jph4/ph4zvvIzogIzkuI3mmK/otbDovpPlh7rmtYEg4oCU4oCUDQogICAgIyBQb3dlclNoZWxs
IOS4rSAwIOaYr+WBh+WAvO+8jOS4gOaXpui+k+WHuua1gemHjOa3t+i/m+WIq+eahOS4nOilv++8
jA0KICAgICMgYGlmICjlh73mlbDosIPnlKgpYCDnmoTliKTmlq3lsLHkuI3lj6/pnaDjgIINCiAg
ICAkc2NyaXB0OkhvdHNwb3RSYyA9IDENCiAgICAkbWdyID0gR2V0LVRldGhlcmluZ01hbmFnZXIN
CiAgICBpZiAoJG51bGwgLWVxICRtZ3IpIHsNCiAgICAgICAgV3JpdGUtTG9nICfml6Dms5XliJvl
u7rng63ngrnnrqHnkIblmajvvIjlj6/og73msqHmnInlj6/lhbHkuqvnmoTov57mjqXvvIknICdF
UlJPUicNCiAgICAgICAgcmV0dXJuDQogICAgfQ0KICAgICRzdGF0ZSA9IFtzdHJpbmddJG1nci5U
ZXRoZXJpbmdPcGVyYXRpb25hbFN0YXRlDQogICAgaWYgKCRzdGF0ZSAtZXEgJ09uJykgew0KICAg
ICAgICBXcml0ZS1Mb2cgJ+enu+WKqOeDreeCueW3suWkhOS6juW8gOWQr+eKtuaAge+8jOaXoOmc
gOaTjeS9nCcNCiAgICAgICAgJHNjcmlwdDpIb3RzcG90UmMgPSAwDQogICAgICAgIHJldHVybg0K
ICAgIH0NCiAgICBXcml0ZS1Mb2cgIuW9k+WJjeeKtuaAgSAkc3RhdGXvvIzlsJ3or5XlvIDlkK8u
Li4iDQogICAgdHJ5IHsNCiAgICAgICAgJHJlc3VsdCA9IEF3YWl0LVdpblJ0ICgkbWdyLlN0YXJ0
VGV0aGVyaW5nQXN5bmMoKSkgKFtXaW5kb3dzLk5ldHdvcmtpbmcuTmV0d29ya09wZXJhdG9ycy5O
ZXR3b3JrT3BlcmF0b3JUZXRoZXJpbmdPcGVyYXRpb25SZXN1bHRdKQ0KICAgIH0gY2F0Y2ggew0K
ICAgICAgICBXcml0ZS1Mb2cgIuW8gOWQr+aXtuaKm+WHuuW8guW4uDogJCgkXy5FeGNlcHRpb24u
TWVzc2FnZSkiICdFUlJPUicNCiAgICAgICAgcmV0dXJuDQogICAgfQ0KICAgIGlmIChbc3RyaW5n
XSRyZXN1bHQuU3RhdHVzIC1lcSAnU3VjY2VzcycpIHsNCiAgICAgICAgV3JpdGUtTG9nICflvIDl
kK/miJDlip8nDQogICAgICAgICRzY3JpcHQ6SG90c3BvdFJjID0gMA0KICAgICAgICByZXR1cm4N
CiAgICB9DQogICAgV3JpdGUtTG9nICLlvIDlkK/lpLHotKU6IFN0YXR1cz0kKCRyZXN1bHQuU3Rh
dHVzKSDor6bmg4U9JCgkcmVzdWx0LkFkZGl0aW9uYWxFcnJvck1lc3NhZ2UpIiAnRVJST1InDQp9
DQoNCmZ1bmN0aW9uIFN0b3AtSG90c3BvdCB7DQogICAgJHNjcmlwdDpIb3RzcG90UmMgPSAxDQog
ICAgJG1nciA9IEdldC1UZXRoZXJpbmdNYW5hZ2VyDQogICAgaWYgKCRudWxsIC1lcSAkbWdyKSB7
DQogICAgICAgIFdyaXRlLUxvZyAn5peg5rOV5Yib5bu654Ot54K5566h55CG5ZmoJyAnRVJST1In
DQogICAgICAgIHJldHVybg0KICAgIH0NCiAgICBpZiAoW3N0cmluZ10kbWdyLlRldGhlcmluZ09w
ZXJhdGlvbmFsU3RhdGUgLW5lICdPbicpIHsNCiAgICAgICAgV3JpdGUtTG9nICfnp7vliqjng63n
grnmnKzmnaXlsLHmmK/lhbPpl63nmoQnDQogICAgICAgICRzY3JpcHQ6SG90c3BvdFJjID0gMA0K
ICAgICAgICByZXR1cm4NCiAgICB9DQogICAgdHJ5IHsNCiAgICAgICAgJHJlc3VsdCA9IEF3YWl0
LVdpblJ0ICgkbWdyLlN0b3BUZXRoZXJpbmdBc3luYygpKSAoW1dpbmRvd3MuTmV0d29ya2luZy5O
ZXR3b3JrT3BlcmF0b3JzLk5ldHdvcmtPcGVyYXRvclRldGhlcmluZ09wZXJhdGlvblJlc3VsdF0p
DQogICAgICAgIGlmIChbc3RyaW5nXSRyZXN1bHQuU3RhdHVzIC1lcSAnU3VjY2VzcycpIHsNCiAg
ICAgICAgICAgIFdyaXRlLUxvZyAn5YWz6Zet5oiQ5YqfJw0KICAgICAgICAgICAgJHNjcmlwdDpI
b3RzcG90UmMgPSAwDQogICAgICAgICAgICByZXR1cm4NCiAgICAgICAgfQ0KICAgICAgICBXcml0
ZS1Mb2cgIuWFs+mXreWksei0pTogU3RhdHVzPSQoJHJlc3VsdC5TdGF0dXMpIiAnRVJST1InDQog
ICAgfSBjYXRjaCB7DQogICAgICAgIFdyaXRlLUxvZyAi5YWz6Zet5pe25oqb5Ye65byC5bi4OiAk
KCRfLkV4Y2VwdGlvbi5NZXNzYWdlKSIgJ0VSUk9SJw0KICAgIH0NCn0NCg0KIyDigJTigJQg5Li7
5rWB56iLIOKAlOKAlA0KdHJ5IHsNCiAgICBBZGQtVHlwZSAtQXNzZW1ibHlOYW1lIFN5c3RlbS5S
dW50aW1lLldpbmRvd3NSdW50aW1lIHwgT3V0LU51bGwNCiAgICBJbml0aWFsaXplLVdpblJ0DQp9
IGNhdGNoIHsNCiAgICBXcml0ZS1Mb2cgIuWIneWni+WMluWksei0pTogJCgkXy5FeGNlcHRpb24u
TWVzc2FnZSkiICdFUlJPUicNCiAgICBleGl0IDENCn0NCg0KaWYgKCRTdGF0dXMpIHsNCiAgICAk
c3RhdGUgPSBHZXQtSG90c3BvdFN0YXRlDQogICAgV3JpdGUtTG9nICLnp7vliqjng63ngrnlvZPl
iY3nirbmgIE6ICRzdGF0ZSINCiAgICBXcml0ZS1PdXRwdXQgIuenu+WKqOeDreeCueeKtuaAgTog
JHN0YXRlIg0KICAgIGV4aXQgMA0KfQ0KDQppZiAoJERpc2FibGUpIHsNCiAgICBTdG9wLUhvdHNw
b3QNCiAgICBleGl0ICRzY3JpcHQ6SG90c3BvdFJjDQp9DQoNCiMg6buY6K6k5Yqo5L2c77ya5byA
5ZCv44CC5byA5py65pe2572R57uc5Y+v6IO96L+Y5rKh5bCx57uq77yM5omA5Lul6L2u6K+i6YeN
6K+V44CCDQojDQojIOazqOaEj++8mlBvd2VyU2hlbGwg6YeMIDAg5piv5YGH5YC877yMYGlmIChT
dGFydC1Ib3RzcG90KWAg5Lya5oqK44CM6L+U5ZueIDDvvIjmiJDlip/vvInjgI0NCiMg5b2T5oiQ
5aSx6LSl44CC5b+F6aG75pi+5byP5LiOIDAg5q+U6L6D44CCDQokZGVhZGxpbmUgPSAoR2V0LURh
dGUpLkFkZFNlY29uZHMoJFdhaXRTZWNvbmRzKQ0KJGF0dGVtcHQgPSAwDQp3aGlsZSAoJHRydWUp
IHsNCiAgICAkYXR0ZW1wdCsrDQogICAgU3RhcnQtSG90c3BvdA0KICAgIGlmICgkc2NyaXB0Okhv
dHNwb3RSYyAtZXEgMCkgew0KICAgICAgICBXcml0ZS1PdXRwdXQgIuenu+WKqOeDreeCueW3suW8
gOWQr++8iOesrCAkYXR0ZW1wdCDmrKHlsJ3or5XvvIkiDQogICAgICAgIGV4aXQgMA0KICAgIH0N
CiAgICBpZiAoKEdldC1EYXRlKSAtZ2UgJGRlYWRsaW5lKSB7DQogICAgICAgIFdyaXRlLUxvZyAi
562J5b6F6LaF6L+HICRXYWl0U2Vjb25kcyDnp5Lku43mnKrlvIDlkK/vvIzmlL7lvIMiICdFUlJP
UicNCiAgICAgICAgV3JpdGUtT3V0cHV0ICLnp7vliqjng63ngrnlvIDlkK/lpLHotKXvvJrnrYnl
voUgJFdhaXRTZWNvbmRzIOenkuWQjuS7jeacquaIkOWKn++8jOivt+ajgOafpee9kee7nOi/nuaO
peS4jue9keWNoempseWKqCINCiAgICAgICAgZXhpdCAxDQogICAgfQ0KICAgIFN0YXJ0LVNsZWVw
IC1TZWNvbmRzIDUNCn0NCg==
