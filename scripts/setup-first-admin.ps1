# Creates the first administrator for the linked Supabase project.
# Run from the project folder:  & .\scripts\setup-first-admin.ps1
# Needs: `npx supabase login` and `npx supabase link` done first.
$ErrorActionPreference = 'Stop'
$npx = 'C:\Program Files\nodejs\npx.cmd'
$ref = (Get-Content (Join-Path $PSScriptRoot '..\supabase\.temp\project-ref') -Raw).Trim()

Write-Host "Project: $ref"
# Run through cmd so the CLI's status lines on stderr don't trip Windows PowerShell.
$keysJson = cmd /c "`"$npx`" -y supabase projects api-keys --remote=$ref -o json 2>nul" | Out-String
$keys = $keysJson.Substring($keysJson.IndexOf('[')) | ConvertFrom-Json
$service = ($keys | Where-Object { $_.name -eq 'service_role' }).api_key
if (-not $service) { throw 'Could not read the service role key. Run: npx supabase login' }

$email = Read-Host 'Admin work email'
$name = Read-Host 'Admin full name'
$secure = Read-Host 'Temporary password (8+ characters, you will change it at first sign-in)' -AsSecureString
$plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))

$env:SUPABASE_URL = "https://$ref.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY = $service
$env:ADMIN_EMAIL = $email
$env:ADMIN_FULL_NAME = $name
$env:ADMIN_PASSWORD = $plain
try {
  & 'C:\Program Files\nodejs\node.exe' (Join-Path $PSScriptRoot 'create-first-admin.mjs')
} finally {
  Remove-Item Env:SUPABASE_SERVICE_ROLE_KEY, Env:ADMIN_PASSWORD -ErrorAction SilentlyContinue
}
