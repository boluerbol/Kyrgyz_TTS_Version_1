$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$frontend = Join-Path $repoRoot "kyrgyz-ai-service\\frontend"
$backendDist = Join-Path $repoRoot "kyrgyz-ai-service\\app\\frontend_dist"

Write-Host "Building frontend in: $frontend"
Push-Location $frontend
npm install
npm run build
Pop-Location

Write-Host "Copying dist -> $backendDist"
if (Test-Path $backendDist) {
  Remove-Item -Recurse -Force $backendDist
}
New-Item -ItemType Directory -Path $backendDist | Out-Null
Copy-Item -Recurse -Force (Join-Path $frontend "dist\\*") $backendDist

Write-Host "Done. Backend will now serve the SPA at /"

