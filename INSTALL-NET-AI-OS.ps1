$ErrorActionPreference = "Stop"
$ProjectPath = $PSScriptRoot

Write-Host "Installation de Net.AI OS" -ForegroundColor Magenta

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "Node.js 22 ou plus récent est requis : https://nodejs.org/" -ForegroundColor Red
  exit 1
}

Set-Location $ProjectPath

if (-not (Test-Path ".env.local")) {
  Copy-Item ".env.example" ".env.local"
  Write-Host "Le fichier .env.local a été créé. Ajoutez-y vos clés API avant le premier lancement." -ForegroundColor Yellow
}

npm install
Write-Host "Installation terminée. Lancez ensuite .\START-NET-AI-OS.ps1" -ForegroundColor Green
