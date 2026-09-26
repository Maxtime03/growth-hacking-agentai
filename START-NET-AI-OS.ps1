$ErrorActionPreference = "Stop"
$ProjectPath = $PSScriptRoot
$Production = $args -contains '-Production'
$LocalProduction = $args -contains '-LocalProduction'

Set-Location $ProjectPath

if (-not (Test-Path "node_modules")) {
  Write-Host "Dépendances absentes. Lancez INSTALL-NET-AI-OS.ps1." -ForegroundColor Red
  exit 1
}

$env:LOCAL_DEV_MODE = if ($Production -and -not $LocalProduction) { "false" } else { "true" }
$env:NODE_USE_SYSTEM_CA = "1"
if (Test-Path ".env.local") {
  Get-Content ".env.local" | ForEach-Object {
    if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$') {
      $name = $Matches[1]
      $value = $Matches[2].Trim()
      if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) { $value = $value.Substring(1, $value.Length - 2) }
      [Environment]::SetEnvironmentVariable($name, $value, 'Process')
    }
  }
}

Write-Host "Mode local activé." -ForegroundColor Green
Write-Host "Net.AI OS démarre sur http://127.0.0.1:3000" -ForegroundColor Magenta

if ($Production -or $LocalProduction) { npx.cmd vinext start --hostname 127.0.0.1 --port 3000 } else { npx.cmd vite --host 127.0.0.1 --port 3000 --strictPort }
