Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot

Write-Host "Exporting local STT model to browser ONNX format..."
python "$PSScriptRoot\export_stt_to_onnx.py" --repo-root "$repoRoot"
Write-Host "Done."
