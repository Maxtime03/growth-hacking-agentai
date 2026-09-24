$ErrorActionPreference = "Stop"
$ProjectPath = $PSScriptRoot

Set-Location $ProjectPath

if (-not (Test-Path "node_modules")) {
  Write-Host "Dépendances absentes. Lancez INSTALL-NET-AI-OS.ps1." -ForegroundColor Red
  exit 1
}

$env:LOCAL_DEV_MODE = "true"

Write-Host "Mode local activé." -ForegroundColor Green
Write-Host "Net.AI OS démarre sur http://127.0.0.1:3000" -ForegroundColor Magenta

npx vite --host 127.0.0.1 --port 3000 --strictPort
