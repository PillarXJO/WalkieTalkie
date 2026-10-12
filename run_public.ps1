# Run the backend on THIS PC and give it a free public HTTPS URL via a
# Cloudflare quick tunnel (no account, no domain, $0). Works while this PC is on.
#
# Prereqs:
#   - Docker Desktop (for Postgres + Redis + API):  winget install Docker.DockerDesktop
#   - cloudflared:                                  winget install --id Cloudflare.cloudflared
#
# Usage:  powershell -ExecutionPolicy Bypass -File .\run_public.ps1

param(
    [int]$Port = 3000,
    [string]$ComposeFile = 'backend\docker-compose.local.yml'
)

$ErrorActionPreference = 'Stop'

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker is required. Install Docker Desktop:  winget install Docker.DockerDesktop"
}
if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) {
    throw "cloudflared is required. Install it:  winget install --id Cloudflare.cloudflared"
}

Write-Host "==> Starting local backend stack (Postgres + Redis + API)..."
docker compose -f $ComposeFile up -d --build

Write-Host "==> Waiting for the API to become healthy..."
$healthy = $false
for ($i = 0; $i -lt 90; $i++) {
    try {
        $r = Invoke-WebRequest "http://localhost:$Port/healthz" -UseBasicParsing -TimeoutSec 2
        if ($r.StatusCode -eq 200) { $healthy = $true; break }
    } catch { }
    Start-Sleep -Seconds 2
}
if (-not $healthy) {
    Write-Host "API did not become healthy. Recent logs:"
    docker compose -f $ComposeFile logs --tail 40 api
    exit 1
}

Write-Host "==> Starting Cloudflare quick tunnel..."
$log = Join-Path $env:TEMP 'cloudflared-ptt.log'
Remove-Item $log -ErrorAction SilentlyContinue
$tunnel = Start-Process -FilePath 'cloudflared' `
    -ArgumentList @('tunnel', '--url', "http://localhost:$Port", '--no-autoupdate') `
    -RedirectStandardError $log -PassThru

Write-Host "==> Waiting for the public URL..."
$url = $null
for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Seconds 1
    if (Test-Path $log) {
        $m = Select-String -Path $log -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -ErrorAction SilentlyContinue |
            Select-Object -First 1
        if ($m) { $url = $m.Matches[0].Value; break }
    }
}

if (-not $url) {
    Write-Host "Tunnel started but the URL was not found. See $log"
    exit 1
}

Write-Host ""
Write-Host "==========================================================="
Write-Host " Public server URL: $url"
Write-Host "==========================================================="
Write-Host ""
Write-Host "Build the APK against it:"
Write-Host "  powershell -ExecutionPolicy Bypass -File .\build_apk.ps1 -ServerUrl $url"
Write-Host ""
Write-Host "Keep this window open while phones use the app. Ctrl+C to stop."
Wait-Process -Id $tunnel.Id
