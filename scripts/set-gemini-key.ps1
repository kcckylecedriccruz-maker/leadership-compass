# Saves the Google Gemini API key as a Supabase Edge Function secret and makes Gemini the AI provider.
# Run from the project folder:  powershell -ExecutionPolicy Bypass -File .\scripts\set-gemini-key.ps1
# Create a free key at https://aistudio.google.com/apikey (it usually starts with AIza).
$ErrorActionPreference = 'Stop'
$npx = 'C:\Program Files\nodejs\npx.cmd'
$ref = (Get-Content (Join-Path $PSScriptRoot '..\supabase\.temp\project-ref') -Raw).Trim()
Write-Host "Project: $ref"

$secure = Read-Host 'Gemini API key (input is hidden)' -AsSecureString
$plain = ([Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))).Trim()
if ($plain.Length -lt 20 -or $plain -match '\s') { throw 'That does not look like a Gemini API key. Copy it again from Google AI Studio.' }

# Pass the value through a short-lived file so it never appears on a command line.
$tmp = [IO.Path]::GetTempFileName()
try {
  Set-Content -Path $tmp -Encoding ascii -Value @("GEMINI_API_KEY=$plain", "AI_PROVIDER=gemini")
  cmd /c "`"$npx`" -y supabase secrets set --env-file `"$tmp`" --remote=$ref --yes 2>&1" | Where-Object { $_ -match 'Finished|rror' }
} finally {
  Remove-Item $tmp -Force -ErrorAction SilentlyContinue
}
Write-Host 'Saved. The AI features now use Gemini (free tier).'
