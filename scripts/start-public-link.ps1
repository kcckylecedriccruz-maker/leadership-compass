# Shares the app outside your network with a temporary Cloudflare quick tunnel.
#
#   powershell -ExecutionPolicy Bypass -File .\scripts\start-public-link.ps1
#
# What it does:
#   1. Builds the app if there is no build yet, and starts the production server on port 4173 if it is not running.
#   2. Opens a quick tunnel (no Cloudflare account) and prints the public https address.
#   3. Points APP_URL (links in emails) at that address in Supabase.
# Keep this window open: closing it or pressing Ctrl+C ends the link. Each run gets a NEW address.
# Needs: Node.js, cloudflared (winget install Cloudflare.cloudflared) and `npx supabase login` done once.

$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$npm = 'C:\Program Files\nodejs\npm.cmd'
$npx = 'C:\Program Files\nodejs\npx.cmd'
$cloudflared = @('C:\Program Files (x86)\cloudflared\cloudflared.exe', 'C:\Program Files\cloudflared\cloudflared.exe') |
  Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $cloudflared) { throw 'cloudflared is not installed. Run: winget install Cloudflare.cloudflared' }
$ref = (Get-Content (Join-Path $root 'supabase\.temp\project-ref') -Raw).Trim()

function Test-AppServer {
  try { (Invoke-WebRequest 'http://localhost:4173/' -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200 } catch { $false }
}

Set-Location $root
if (-not (Test-AppServer)) {
  if (-not (Test-Path (Join-Path $root 'dist\index.html'))) {
    Write-Host 'Building the app...'
    & $npm run build | Out-Null
  }
  Write-Host 'Starting the app server on port 4173 (minimised window)...'
  Start-Process -FilePath $npm -ArgumentList 'run', 'preview', '--', '--port', '4173', '--strictPort' -WorkingDirectory $root -WindowStyle Minimized
  for ($i = 0; $i -lt 30 -and -not (Test-AppServer); $i++) { Start-Sleep -Seconds 1 }
  if (-not (Test-AppServer)) { throw 'The app server did not start on port 4173.' }
}
Write-Host 'App server is running on http://localhost:4173'
Write-Host 'Opening the public tunnel...'

$script:linkSet = $false
# cloudflared logs to stderr; Windows PowerShell 5.1 would treat that as an error under 'Stop'.
$ErrorActionPreference = 'Continue'
& $cloudflared tunnel --no-autoupdate --url http://localhost:4173 2>&1 | ForEach-Object {
  $line = "$_"
  if (-not $script:linkSet -and $line -match '(https://[a-z0-9-]+\.trycloudflare\.com)') {
    $url = $Matches[1]
    $script:linkSet = $true
    cmd /c "`"$npx`" -y supabase secrets set APP_URL=$url --remote=$ref --yes >nul 2>&1"
    Write-Host ''
    Write-Host '=====================================================================' -ForegroundColor Green
    Write-Host "  PUBLIC LINK: $url" -ForegroundColor Green
    Write-Host '  Email links (APP_URL) now point here. It can take a minute to open.' -ForegroundColor Green
    Write-Host '  Keep this window open. Ctrl+C ends the link.' -ForegroundColor Green
    Write-Host '=====================================================================' -ForegroundColor Green
    Write-Host ''
  } elseif ($line -match ' ERR ') {
    Write-Host $line -ForegroundColor Yellow
  }
}
