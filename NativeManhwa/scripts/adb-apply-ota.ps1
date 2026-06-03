param(
  [string]$PackageName = "com.osmium.manhwahub",
  [string]$ActivityName = ".MainActivity",
  [string]$AdbPath = "",
  [int]$WaitSeconds = 25
)

$ErrorActionPreference = "Stop"

function Find-Adb {
  if ($AdbPath -and (Test-Path -LiteralPath $AdbPath)) {
    return (Resolve-Path -LiteralPath $AdbPath).Path
  }

  $fromPath = Get-Command adb.exe -ErrorAction SilentlyContinue
  if ($fromPath) {
    return $fromPath.Source
  }

  $candidates = @(
    "$env:ANDROID_HOME\platform-tools\adb.exe",
    "$env:ANDROID_SDK_ROOT\platform-tools\adb.exe",
    "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe",
    "$env:USERPROFILE\Android\sdk\platform-tools\adb.exe",
    "E:\Android\android-sdk\platform-tools\adb.exe",
    "D:\Android\android-sdk\platform-tools\adb.exe",
    "C:\Android\Sdk\platform-tools\adb.exe"
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

  if ($candidates.Count -gt 0) {
    return (Resolve-Path -LiteralPath $candidates[0]).Path
  }

  throw "adb.exe not found. Pass -AdbPath or install Android platform-tools."
}

function Invoke-Adb {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Args)
  & $script:ResolvedAdb @Args
}

$script:ResolvedAdb = Find-Adb
Write-Host "Using ADB: $script:ResolvedAdb"

$devices = Invoke-Adb devices
$activeDevices = $devices | Select-String -Pattern "`tdevice$"
if (-not $activeDevices) {
  throw "No authorized Android device found. Check USB debugging and authorization prompt."
}

$installed = Invoke-Adb shell pm list packages $PackageName
if (-not ($installed | Select-String -SimpleMatch "package:$PackageName")) {
  throw "Package $PackageName is not installed on the connected device."
}

Invoke-Adb logcat -c | Out-Null
Invoke-Adb shell am force-stop $PackageName | Out-Null
Start-Sleep -Seconds 1
Invoke-Adb shell am start -n "$PackageName/$ActivityName" | Out-Null
Write-Host "Launched $PackageName. Waiting $WaitSeconds seconds for OTA check..."
Start-Sleep -Seconds $WaitSeconds

Invoke-Adb shell uiautomator dump /sdcard/window.xml | Out-Null
$windowXml = Invoke-Adb shell cat /sdcard/window.xml
$hasUpdateDialog = ($windowXml | Select-String -SimpleMatch 'Update ready') -and
  ($windowXml | Select-String -SimpleMatch 'RESTART')

if ($hasUpdateDialog) {
  Write-Host "Update dialog found. Restarting app..."
  Invoke-Adb shell input tap 880 1360 | Out-Null
  Start-Sleep -Seconds 12
} else {
  Write-Host "No update dialog found. App may already be current."
}

Invoke-Adb shell uiautomator dump /sdcard/window.xml | Out-Null
$afterXml = Invoke-Adb shell cat /sdcard/window.xml
$hasAppUi = ($afterXml | Select-String -SimpleMatch 'Discover') -or
  ($afterXml | Select-String -SimpleMatch 'Settings') -or
  ($afterXml | Select-String -SimpleMatch 'Search')

$crashes = Invoke-Adb logcat -d -v time |
  Select-String -Pattern 'FATAL EXCEPTION|ReactNativeJS.*Error|JSApplicationIllegalArgumentException|JavascriptException' |
  Select-Object -Last 20

if ($crashes) {
  Write-Host "Recent crash-like log lines:"
  $crashes | ForEach-Object { Write-Host $_.Line }
  throw "Crash-like logs detected after OTA apply."
}

if (-not $hasAppUi) {
  throw "App UI was not detected after OTA apply."
}

Write-Host "OTA apply check finished. App UI is visible and no crash-like logs were detected."
