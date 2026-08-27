$ErrorActionPreference = 'Continue'

# gitnexus statically imports `registerHooks` from node:module (onnxruntime-node-resolver.js),
# which only exists on Node >= 22.15. The machine's Node is now v24.19.0 (via fnm, already on the
# persistent User PATH), so the old pinned Node 22.15.0 runtime is no longer needed.

# Default worker pool size is os.availableParallelism()-1 (~15 on this 16-thread machine), which
# reliably exhausts all pool slots (workers time out during top-of-script init) when the box is
# also running many concurrent Claude Code sessions. Cap it so init has enough CPU/RAM headroom.
$env:GITNEXUS_WORKER_POOL_SIZE = "4"

$logDir = Join-Path $env:USERPROFILE ".gitnexus-data\logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir ("analyze-{0:yyyy-MM-dd_HHmmss}.log" -f (Get-Date))

$ghRoot = Join-Path $env:USERPROFILE "Workspace\Github"
$repos = @(
  (Join-Path $ghRoot "oh-api-worker"),
  (Join-Path $ghRoot "oh-ellis-mcp")
)

foreach ($repo in $repos) {
  "==== $repo ====" | Out-File -FilePath $logFile -Append -Encoding utf8
  if (Test-Path $repo) {
    Push-Location $repo
    & npx gitnexus analyze --embeddings *>> $logFile
    Pop-Location
  } else {
    "SKIPPED: path not found" | Out-File -FilePath $logFile -Append -Encoding utf8
  }
}
