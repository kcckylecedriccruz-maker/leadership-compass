# Saves the Gmail SMTP sender as Supabase Edge Function secrets for the linked project.
# Run from the project folder:  powershell -ExecutionPolicy Bypass -File .\scripts\set-gmail-secrets.ps1
# Get the App password at https://myaccount.google.com/apppasswords (needs 2-Step Verification).
$ErrorActionPreference = 'Stop'
$npx = 'C:\Program Files\nodejs\npx.cmd'
$ref = (Get-Content (Join-Path $PSScriptRoot '..\supabase\.temp\project-ref') -Raw).Trim()
Write-Host "Project: $ref"

$user = (Read-Host 'Gmail address that sends the emails').Trim()
if ($user -notmatch '^[^\s@]+@[^\s@]+\.[^\s@]+$') { throw 'That is not an email address.' }
$secure = Read-Host 'Google App password (16 letters, spaces are fine)' -AsSecureString
$plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)) -replace '\s', ''
if ($plain.Length -ne 16) { throw "An App password has 16 letters; this one has $($plain.Length). Copy it again from Google." }

# Pass the values through a short-lived file so they never appear on a command line.
$tmp = [IO.Path]::GetTempFileName()
try {
  Set-Content -Path $tmp -Encoding ascii -Value @("GMAIL_SMTP_USER=$user", "GMAIL_SMTP_APP_PASSWORD=$plain")
  cmd /c "`"$npx`" -y supabase secrets set --env-file `"$tmp`" --remote=$ref --yes 2>&1" | Where-Object { $_ -match 'Finished|rror' }
} finally {
  Remove-Item $tmp -Force -ErrorAction SilentlyContinue
}
Write-Host "Saved. Sender settings in the app must use $user as the Sender email."
