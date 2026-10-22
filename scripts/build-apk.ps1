# Builds the Fire TV (Fire OS) release APK of the TV app.
#   powershell -File scripts\build-apk.ps1 -ServerUrl http://192.168.1.5:8788
# The server URL is baked into the app: use the family PC's LAN address and the plain TV port.
param(
  [string]$ServerUrl = 'http://10.0.2.2:8788',
  [string]$JavaHome = 'C:\Program Files\Android\Android Studio\jbr',
  [string]$AndroidHome = "$env:LOCALAPPDATA\Android\Sdk",
  [switch]$SkipPrebuild
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$app = Join-Path $root 'tv-app\apps\expo-multi-tv'
$env:EXPO_TV = '1'
$env:EXPO_NO_METRO_WORKSPACE_ROOT = '1'   # release bundling looks for expo/AppEntry.js in the app's own node_modules
$env:EXPO_PUBLIC_RC_SERVER_URL = $ServerUrl
$env:JAVA_HOME = $JavaHome                # Gradle needs JDK 17 or 21, not the system JDK 25
$env:ANDROID_HOME = $AndroidHome
$env:CI = '1'
$start = Get-Date
Set-Location $app
if (-not $SkipPrebuild) {
  Write-Host "[build-apk] expo prebuild (android)"
  npx expo prebuild --platform android --clean
  if ($LASTEXITCODE -ne 0) { throw "prebuild failed" }
}
Set-Location (Join-Path $app 'android')
Write-Host "[build-apk] gradlew assembleRelease (server: $ServerUrl)"
.\gradlew.bat assembleRelease "-Dorg.gradle.jvmargs=-Xmx4g -XX:MaxMetaspaceSize=1g" --console=plain
if ($LASTEXITCODE -ne 0) { throw "gradle build failed" }
$apk = Join-Path $app 'android\app\build\outputs\apk\release\app-release.apk'
$out = Join-Path $root 'dist'
New-Item -ItemType Directory -Force $out | Out-Null
Copy-Item $apk (Join-Path $out 'roomcaption-tv.apk') -Force
$mins = [math]::Round(((Get-Date) - $start).TotalMinutes, 1)
Write-Host "[build-apk] done in $mins min -> $(Join-Path $out 'roomcaption-tv.apk') ($([math]::Round((Get-Item $apk).Length/1MB,1)) MB)"
