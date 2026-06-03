param(
  [switch]$SkipPrebuild,
  [switch]$Install,
  [string]$SdkDir = "E:\Android\android-sdk",
  [string]$GradleHome = "E:\Android\gradle-home",
  [string]$JavaHome = "C:\Program Files\Java\jdk-17",
  [string]$TempDir = "E:\Android\tmp"
)

$ErrorActionPreference = "Stop"

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$androidDir = Join-Path $projectRoot "android"

if (-not (Test-Path -LiteralPath $SdkDir)) {
  throw "Android SDK not found: $SdkDir"
}
if (-not (Test-Path -LiteralPath (Join-Path $JavaHome "bin\java.exe"))) {
  throw "Java 17 not found: $JavaHome"
}

New-Item -ItemType Directory -Force -Path $GradleHome, $TempDir | Out-Null

$env:JAVA_HOME = $JavaHome
$env:ANDROID_HOME = $SdkDir
$env:ANDROID_SDK_ROOT = $SdkDir
$env:GRADLE_USER_HOME = $GradleHome
$env:TEMP = $TempDir
$env:TMP = $TempDir
$env:NODE_ENV = "production"
$env:CI = "1"
$env:Path = "$JavaHome\bin;$SdkDir\platform-tools;$env:Path"

if (-not $SkipPrebuild -or -not (Test-Path -LiteralPath $androidDir)) {
  Push-Location $projectRoot
  try {
    npx expo prebuild --platform android --no-install
    if ($LASTEXITCODE -ne 0) { throw "Expo prebuild failed with exit code $LASTEXITCODE" }
  } finally {
    Pop-Location
  }
}

if (-not (Test-Path -LiteralPath $androidDir)) {
  throw "Android directory was not generated."
}

$localProperties = Join-Path $androidDir "local.properties"
$sdkDirForGradle = $SdkDir.Replace("\", "/")
Set-Content -LiteralPath $localProperties -Value "sdk.dir=$sdkDirForGradle`n" -NoNewline -Encoding ASCII

$gradleProperties = Join-Path $androidDir "gradle.properties"
$properties = Get-Content -LiteralPath $gradleProperties -Raw

function Set-GradleProperty {
  param([string]$Text, [string]$Name, [string]$Value)
  $line = "$Name=$Value"
  if ($Text -match "(?m)^$([regex]::Escape($Name))=.*$") {
    return [regex]::Replace($Text, "(?m)^$([regex]::Escape($Name))=.*$", $line)
  }
  return $Text.TrimEnd() + "`n$line`n"
}

$properties = Set-GradleProperty $properties "org.gradle.jvmargs" "-Xmx6144m -XX:MaxMetaspaceSize=2048m -Dfile.encoding=UTF-8"
$properties = Set-GradleProperty $properties "kotlin.daemon.jvmargs" "-Xmx3072m -XX:MaxMetaspaceSize=1024m"
Set-Content -LiteralPath $gradleProperties -Value $properties -Encoding ASCII

Push-Location $androidDir
try {
  $gradleArgs = @(
    "--no-daemon",
    "--max-workers=2",
    ":app:assembleRelease",
    "-x", "lintVitalAnalyzeRelease",
    "-x", "lintVitalRelease",
    "-x", "generateReleaseLintVitalReportModel"
  )
  .\gradlew.bat @gradleArgs
  if ($LASTEXITCODE -ne 0) { throw "Gradle build failed with exit code $LASTEXITCODE" }
} finally {
  Pop-Location
}

$apk = Get-ChildItem -LiteralPath (Join-Path $androidDir "app\build\outputs\apk\release") -Filter "*.apk" -File |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (-not $apk) {
  throw "Release APK was not produced."
}

$apkMb = [math]::Round($apk.Length / 1MB, 2)
Write-Host "APK: $($apk.FullName)"
Write-Host "Size: $apkMb MB"

if ($Install) {
  $adb = Join-Path $SdkDir "platform-tools\adb.exe"
  if (-not (Test-Path -LiteralPath $adb)) { throw "ADB not found: $adb" }
  & $adb install -r -d $apk.FullName
  if ($LASTEXITCODE -ne 0) { throw "ADB install failed with exit code $LASTEXITCODE" }
}
