param(
  [switch]$SkipPrebuild,
  [switch]$Install,
  [switch]$LocalTester,
  [string]$SdkDir = "E:\Android\android-sdk",
  [string]$GradleHome = "E:\Android\gradle-home",
  [string]$JavaHome = "C:\Program Files\Java\jdk-17",
  [string]$TempDir = "E:\Android\tmp"
)

$ErrorActionPreference = "Stop"

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$androidDir = Join-Path $projectRoot "android"

function New-LocalPassword {
  $bytes = New-Object byte[] 24
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($bytes)
  } finally {
    $rng.Dispose()
  }
  return ([Convert]::ToBase64String($bytes) -replace '[^a-zA-Z0-9]', '').Substring(0, 24)
}

function Write-Utf8NoBom {
  param(
    [string]$Path,
    [string]$Value
  )
  $encoding = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Value, $encoding)
}

function Ensure-LocalSigningCredentials {
  param(
    [string]$AndroidDir,
    [string]$ProjectRoot,
    [string]$JavaHome
  )

  $keytool = Join-Path $JavaHome "bin\keytool.exe"
  if (-not (Test-Path -LiteralPath $keytool)) {
    throw "keytool not found: $keytool"
  }

  $keystoreDir = Join-Path $AndroidDir "keystores"
  $keystorePath = Join-Path $keystoreDir "wibungomik-local-release.jks"
  $propertiesPath = Join-Path $AndroidDir "keystore.properties"
  $credentialsPath = Join-Path $ProjectRoot "credentials.json"

  New-Item -ItemType Directory -Force -Path $keystoreDir | Out-Null

  if (-not (Test-Path -LiteralPath $propertiesPath)) {
    if (Test-Path -LiteralPath $keystorePath) {
      throw "Keystore exists but android\keystore.properties is missing. Restore the properties file or remove $keystorePath to generate a new local signing identity."
    }

    $storePassword = New-LocalPassword
    $keyPassword = New-LocalPassword
    $keyAlias = "wibungomik"

    & $keytool -genkeypair `
      -v `
      -storetype JKS `
      -keystore $keystorePath `
      -alias $keyAlias `
      -keyalg RSA `
      -keysize 2048 `
      -validity 10000 `
      -storepass $storePassword `
      -keypass $keyPassword `
      -dname "CN=WibuNgomik Local Release, OU=Local Build, O=WibuNgomik, L=Jakarta, ST=Jakarta, C=ID"
    if ($LASTEXITCODE -ne 0) { throw "Failed to generate local Android keystore." }

    $keystoreRelativeToAndroid = "keystores/wibungomik-local-release.jks"
    $keystoreRelativeToProject = "android/keystores/wibungomik-local-release.jks"
    $propertiesText = @(
      "storeFile=$keystoreRelativeToAndroid",
      "storePassword=$storePassword",
      "keyAlias=$keyAlias",
      "keyPassword=$keyPassword"
    ) -join "`n"
    Set-Content -LiteralPath $propertiesPath -Value ($propertiesText + "`n") -Encoding ASCII

    $credentials = @{
      android = @{
        keystore = @{
          keystorePath = $keystoreRelativeToProject
          keystorePassword = $storePassword
          keyAlias = $keyAlias
          keyPassword = $keyPassword
        }
      }
    }
    $credentials | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $credentialsPath -Encoding ASCII
    Write-Host "Generated local release keystore: $keystorePath"
    Write-Host "Generated local EAS credentials: $credentialsPath"
  }
}

function Ensure-AndroidLocalSigningPatch {
  param([string]$AndroidDir)

  $appGradle = Join-Path $AndroidDir "app\build.gradle"
  $manifest = Join-Path $AndroidDir "app\src\main\AndroidManifest.xml"
  if (-not (Test-Path -LiteralPath $appGradle)) {
    throw "Android Gradle file not found: $appGradle"
  }

  $gradle = Get-Content -LiteralPath $appGradle -Raw

  if ($gradle -notmatch "def localPackageSuffix") {
    $gradle = $gradle -replace "def projectRoot = rootDir\.getAbsoluteFile\(\)\.getParentFile\(\)\.getAbsolutePath\(\)", @"
def projectRoot = rootDir.getAbsoluteFile().getParentFile().getAbsolutePath()
def localPackageSuffix = (findProperty('localPackageSuffix') ?: "").toString().trim()
def localAppLabel = (findProperty('localAppLabel') ?: "WibuNgomik").toString()
def keystoreProperties = new Properties()
def keystorePropertiesFile = rootProject.file('keystore.properties')
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}
def hasReleaseKeystore = keystoreProperties['storeFile'] && keystoreProperties['storePassword'] && keystoreProperties['keyAlias'] && keystoreProperties['keyPassword']
"@
  } elseif ($gradle -notmatch "def keystoreProperties = new Properties\(\)") {
    $gradle = $gradle -replace "(?m)^def localAppLabel = \(findProperty\('localAppLabel'\) \?: `"WibuNgomik`"\)\.toString\(\)\s*$", @"
def localAppLabel = (findProperty('localAppLabel') ?: "WibuNgomik").toString()
def keystoreProperties = new Properties()
def keystorePropertiesFile = rootProject.file('keystore.properties')
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}
def hasReleaseKeystore = keystoreProperties['storeFile'] && keystoreProperties['storePassword'] && keystoreProperties['keyAlias'] && keystoreProperties['keyPassword']
"@
  }

  if ($gradle -notmatch "applicationIdSuffix localPackageSuffix") {
    $gradle = $gradle -replace "(?m)^(\s*)applicationId 'com\.osmium\.manhwahub'\s*$", "`$1applicationId 'com.osmium.manhwahub'`n`$1if (localPackageSuffix) {`n`$1    applicationIdSuffix localPackageSuffix`n`$1}"
  }

  if ($gradle -notmatch "manifestPlaceholders = \[appLabel: localAppLabel\]") {
    $gradle = $gradle -replace "(?m)^(\s*)versionName `"1\.1\.2`"\s*$", "`$1versionName `"1.1.2`"`n`$1manifestPlaceholders = [appLabel: localAppLabel]"
  }

  if ($gradle -notmatch "rootProject\.file\(keystoreProperties\['storeFile'\]\)") {
    $releaseSigningConfig = @"
        release {
            storeFile rootProject.file(keystoreProperties['storeFile'])
            storePassword keystoreProperties['storePassword']
            keyAlias keystoreProperties['keyAlias']
            keyPassword keystoreProperties['keyPassword']
        }
"@
    $gradle = $gradle -replace "(?s)(\s*debug\s*\{\s*storeFile file\('debug\.keystore'\)\s*storePassword 'android'\s*keyAlias 'androiddebugkey'\s*keyPassword 'android'\s*\})", "`$1`n$releaseSigningConfig"
  }

  $gradle = $gradle -replace "(?s)(release\s*\{[\s\S]*?)signingConfig signingConfigs\.debug", "`$1signingConfig hasReleaseKeystore ? signingConfigs.release : signingConfigs.debug"

  Write-Utf8NoBom -Path $appGradle -Value $gradle

  if (Test-Path -LiteralPath $manifest) {
    $manifestText = Get-Content -LiteralPath $manifest -Raw
    if ($manifestText -match 'android:label="@string/app_name"') {
      $manifestText = $manifestText -replace 'android:label="@string/app_name"', 'android:label="${appLabel}"'
      Write-Utf8NoBom -Path $manifest -Value $manifestText
    }
  }
}

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

Ensure-LocalSigningCredentials -AndroidDir $androidDir -ProjectRoot $projectRoot -JavaHome $JavaHome
Ensure-AndroidLocalSigningPatch -AndroidDir $androidDir

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
  if ($LocalTester) {
    $gradleArgs += @(
      "-PlocalPackageSuffix=.local",
      "-PlocalAppLabel=WibuNgomik Local"
    )
  }
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
if ($LocalTester) {
  Write-Host "Package: com.osmium.manhwahub.local"
} else {
  Write-Host "Package: com.osmium.manhwahub"
}

if ($Install) {
  $adb = Join-Path $SdkDir "platform-tools\adb.exe"
  if (-not (Test-Path -LiteralPath $adb)) { throw "ADB not found: $adb" }
  & $adb install -r -d $apk.FullName
  if ($LASTEXITCODE -ne 0) { throw "ADB install failed with exit code $LASTEXITCODE" }
}
