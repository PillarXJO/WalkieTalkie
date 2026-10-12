# Build a release APK that talks to a global (non-local) backend.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\build_apk.ps1 -ServerUrl https://api.example.com
#
# The same URL is used for REST (API_BASE_URL) and the realtime WebSocket
# (WS_BASE_URL = <ServerUrl>/ws). Use https:// so Android does not block the
# connection as cleartext traffic.

param(
    [Parameter(Mandatory = $true)]
    [string]$ServerUrl,

    [string]$WsPath = '/ws',

    [string]$OutputName = 'walkie-talkie.apk',

    [string]$FlutterBin = 'C:\flutter\bin'
)

$ErrorActionPreference = 'Stop'

if ($FlutterBin -and (Test-Path -LiteralPath $FlutterBin)) {
    $env:Path = "$FlutterBin;$env:Path"
}

$base = $ServerUrl.TrimEnd('/')
$ws = "$base/$($WsPath.TrimStart('/'))"

Write-Host "Building APK against API_BASE_URL=$base  WS_BASE_URL=$ws"

flutter build apk --release `
    --dart-define=API_BASE_URL=$base `
    --dart-define=WS_BASE_URL=$ws

$apk = Join-Path $PSScriptRoot 'build\app\outputs\flutter-apk\app-release.apk'
if (-not (Test-Path -LiteralPath $apk)) {
    throw "Build did not produce $apk"
}

$outDir = Join-Path $PSScriptRoot 'build\deploy'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$out = Join-Path $outDir $OutputName
Copy-Item -LiteralPath $apk -Destination $out -Force

Write-Host ""
Write-Host "APK ready: $out"
Write-Host "Install on a device with:  adb install -r `"$out`""
