<#
.SYNOPSIS
    开机自动开启 Windows「移动热点」（设置 → 网络和 Internet → 移动热点）。

.DESCRIPTION
    使用 WinRT 的 NetworkOperatorTetheringManager 开启移动热点 ——
    这与设置界面里的「移动热点」开关是同一套底层接口，开关状态会在
    设置页里同步显示（老式 netsh wlan set hostednetwork 不行：
    它在 Windows 10 1803 之后已被这套接口取代，且不会更新设置页）。

    开机自启通过计划任务实现：以 SYSTEM 身份、最高权限，在系统启动时触发。
    实测 SYSTEM 会话（Session 0）下 StartTetheringAsync 可正常返回 Success。

    开机瞬间网卡与网络栈往往还没就绪，因此脚本会等待并重试，
    直到热点真正开启或超过等待上限。

.PARAMETER Enable
    开启移动热点（默认）。

.PARAMETER Disable
    关闭移动热点。

.PARAMETER Status
    只显示当前状态，不做修改。

.PARAMETER WaitSeconds
    等待网络就绪并重试开启的最长秒数，默认 180。

.PARAMETER LogPath
    日志文件路径，默认写入 %ProgramData%\MobileHotspotAutostart\hotspot.log。

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File MobileHotspotAutostart.ps1
    powershell -ExecutionPolicy Bypass -File MobileHotspotAutostart.ps1 -Disable
#>
[CmdletBinding()]
param(
    [switch]$Enable,
    [switch]$Disable,
    [switch]$Status,
    [int]$WaitSeconds = 180,
    [string]$LogPath = "$env:ProgramData\MobileHotspotAutostart\hotspot.log"
)

$ErrorActionPreference = 'Stop'

# 热点操作的返回码（0 = 成功）。见 Start-Hotspot 的说明。
$script:HotspotRc = 1

function Write-Log {
    param([string]$Message, [string]$Level = 'INFO')
    $line = '[{0}] [{1}] {2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Level, $Message
    try {
        $dir = Split-Path -Parent $LogPath
        if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
        Add-Content -Path $LogPath -Value $line -Encoding UTF8
    } catch {
        # 日志写不进去不该影响主流程
    }
}

# —— WinRT 异步等待 ——
# PowerShell 5.1 无法直接 await WinRT 的 IAsyncOperation<T>，
# 需要借 System.Runtime.WindowsRuntime 的 AsTask 扩展方法。
# 用反射取是因为它有多个泛型/非泛型重载，必须按参数类型精确筛选。
#
# 惰性求值：这个类型所在的程序集要等 Add-Type 加载后才可用，
# 在脚本顶层直接取会报「找不到类型」。
$script:AsTaskGeneric = $null

function Get-AsTaskGeneric {
    if ($null -eq $script:AsTaskGeneric) {
        $methods = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
            $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
            $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
        }
        if (-not $methods) { throw '找不到 AsTask 扩展方法' }
        $script:AsTaskGeneric = $methods[0]
    }
    return $script:AsTaskGeneric
}

function Await-WinRt {
    param($Operation, [Type]$ResultType)
    $method = (Get-AsTaskGeneric).MakeGenericMethod($ResultType)
    $task = $method.Invoke($null, @($Operation))
    $task.Wait(-1) | Out-Null
    $task.Result
}

function Initialize-WinRt {
    # WinRT 类型必须显式加载才能在 PowerShell 里用
    [Windows.Networking.Connectivity.NetworkInformation, Windows.Networking.Connectivity, ContentType = WindowsRuntime] | Out-Null
    [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager, Windows.Networking.NetworkOperators, ContentType = WindowsRuntime] | Out-Null
    [Windows.Networking.NetworkOperators.NetworkOperatorTetheringOperationResult, Windows.Networking.NetworkOperators, ContentType = WindowsRuntime] | Out-Null
}

function Get-TetheringManager {
    <#
        找一个能作为热点上游的连接配置文件。
        优先用「互联网连接」；没有就退而求其次用任何一个有连通性的配置。
    #>
    $profile = [Windows.Networking.Connectivity.NetworkInformation]::GetInternetConnectionProfile()
    if ($null -eq $profile) {
        Write-Log '未找到互联网连接配置，尝试其它配置文件' 'WARN'
        foreach ($p in [Windows.Networking.Connectivity.NetworkInformation]::GetConnectionProfiles()) {
            try {
                $mgr = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager]::CreateFromConnectionProfile($p)
                Write-Log "改用配置 '$($p.ProfileName)'"
                return $mgr
            } catch {
                Write-Log "配置 '$($p.ProfileName)' 不可用: $($_.Exception.Message)" 'WARN'
            }
        }
        return $null
    }
    Write-Log "上游连接: $($profile.ProfileName)"
    return [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager]::CreateFromConnectionProfile($profile)
}

function Get-HotspotState {
    try {
        $mgr = Get-TetheringManager
        if ($null -eq $mgr) { return 'Unknown' }
        return [string]$mgr.TetheringOperationalState
    } catch {
        return 'Unknown'
    }
}

function Start-Hotspot {
    # 返回码放在脚本级变量里，而不是走输出流 ——
    # PowerShell 中 0 是假值，一旦输出流里混进别的东西，
    # `if (函数调用)` 的判断就不可靠。
    $script:HotspotRc = 1
    $mgr = Get-TetheringManager
    if ($null -eq $mgr) {
        Write-Log '无法创建热点管理器（可能没有可共享的连接）' 'ERROR'
        return
    }
    $state = [string]$mgr.TetheringOperationalState
    if ($state -eq 'On') {
        Write-Log '移动热点已处于开启状态，无需操作'
        $script:HotspotRc = 0
        return
    }
    Write-Log "当前状态 $state，尝试开启..."
    try {
        $result = Await-WinRt ($mgr.StartTetheringAsync()) ([Windows.Networking.NetworkOperators.NetworkOperatorTetheringOperationResult])
    } catch {
        Write-Log "开启时抛出异常: $($_.Exception.Message)" 'ERROR'
        return
    }
    if ([string]$result.Status -eq 'Success') {
        Write-Log '开启成功'
        $script:HotspotRc = 0
        return
    }
    Write-Log "开启失败: Status=$($result.Status) 详情=$($result.AdditionalErrorMessage)" 'ERROR'
}

function Stop-Hotspot {
    $script:HotspotRc = 1
    $mgr = Get-TetheringManager
    if ($null -eq $mgr) {
        Write-Log '无法创建热点管理器' 'ERROR'
        return
    }
    if ([string]$mgr.TetheringOperationalState -ne 'On') {
        Write-Log '移动热点本来就是关闭的'
        $script:HotspotRc = 0
        return
    }
    try {
        $result = Await-WinRt ($mgr.StopTetheringAsync()) ([Windows.Networking.NetworkOperators.NetworkOperatorTetheringOperationResult])
        if ([string]$result.Status -eq 'Success') {
            Write-Log '关闭成功'
            $script:HotspotRc = 0
            return
        }
        Write-Log "关闭失败: Status=$($result.Status)" 'ERROR'
    } catch {
        Write-Log "关闭时抛出异常: $($_.Exception.Message)" 'ERROR'
    }
}

# —— 主流程 ——
try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null
    Initialize-WinRt
} catch {
    Write-Log "初始化失败: $($_.Exception.Message)" 'ERROR'
    exit 1
}

if ($Status) {
    $state = Get-HotspotState
    Write-Log "移动热点当前状态: $state"
    Write-Output "移动热点状态: $state"
    exit 0
}

if ($Disable) {
    Stop-Hotspot
    exit $script:HotspotRc
}

# 默认动作：开启。开机时网络可能还没就绪，所以轮询重试。
#
# 注意：PowerShell 里 0 是假值，`if (Start-Hotspot)` 会把「返回 0（成功）」
# 当成失败。必须显式与 0 比较。
$deadline = (Get-Date).AddSeconds($WaitSeconds)
$attempt = 0
while ($true) {
    $attempt++
    Start-Hotspot
    if ($script:HotspotRc -eq 0) {
        Write-Output "移动热点已开启（第 $attempt 次尝试）"
        exit 0
    }
    if ((Get-Date) -ge $deadline) {
        Write-Log "等待超过 $WaitSeconds 秒仍未开启，放弃" 'ERROR'
        Write-Output "移动热点开启失败：等待 $WaitSeconds 秒后仍未成功，请检查网络连接与网卡驱动"
        exit 1
    }
    Start-Sleep -Seconds 5
}
