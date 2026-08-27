# Re-index a repo with GitNexus, then rebuild the DB layer on top of it.
#
# `gitnexus analyze` recreates the graph from scratch and drops any table it
# does not own — DbTable/DbColumn/DbRelation included. Always pair the two.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File resync.ps1 -Repo oh-api
#   powershell -NoProfile -ExecutionPolicy Bypass -File resync.ps1 -Repo oh-api -Force

param(
  [Parameter(Mandatory = $true)][string]$Repo,
  [switch]$Force,
  [switch]$SkipAnalyze
)

$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

$registry = Get-Content "$env:USERPROFILE\.gitnexus\registry.json" -Raw | ConvertFrom-Json
$entry = $registry | Where-Object { $_.name -eq $Repo }
if (-not $entry) {
  throw "Repo '$Repo' is not registered with GitNexus. Known: $(($registry | ForEach-Object { $_.name }) -join ', ')"
}

if (-not $SkipAnalyze) {
  Write-Host "==> gitnexus analyze $($entry.path)"
  Push-Location $entry.path
  try {
    if ($Force) { gitnexus analyze --force } else { gitnexus analyze }
    if ($LASTEXITCODE -ne 0) { throw "gitnexus analyze exited with $LASTEXITCODE" }
  } finally { Pop-Location }
}

Write-Host "==> rebuilding DB layer"
node "$scriptDir\build-db-layer.mjs" --repo $Repo
if ($LASTEXITCODE -ne 0) { throw "build-db-layer exited with $LASTEXITCODE" }
