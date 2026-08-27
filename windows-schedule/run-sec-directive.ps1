# run-sec-directive.ps1
# Chay boi Windows Scheduled Task "omh-sec-directive": 1 lan/ngay luc 09:10, thu 2 - thu 6.
# Orchestrator headless: chay skill omh-sec-directive — quet task/sub-task/comment MOI cua team dev
# trong project OMH & ELS, doi chieu Security Directive, gui email canh bao neu phat hien lo secret.
# State watermark (moc lan chay truoc) luu o sec-directive-state.json de khong bo sot / khong trung cua so.

$ErrorActionPreference = 'Continue'

$claude    = 'C:\Users\dzung\.local\bin\claude.exe'
$work      = 'C:\Users\dzung\Workspace\Ohmyhotel'
$stateFile = Join-Path $PSScriptRoot 'sec-directive-state.json'

# --- Tinh cua so quet [SINCE, NOW] ---
# SINCE = moc lan chay thanh cong gan nhat (watermark). Vi chay 1 lan/ngay, fallback (lan dau / mat state)
# phu ngay lam viec truoc: thu 2 lui 3 ngay (thu 6 + cuoi tuan), cac ngay khac lui 1 ngay.
$nowDt = Get-Date
$now   = $nowDt.ToString('yyyy-MM-ddTHH:mm:sszzz')
$fallbackDays = if ($nowDt.DayOfWeek -eq 'Monday') { 3 } else { 1 }
$since = $nowDt.AddDays(-$fallbackDays).ToString('yyyy-MM-ddTHH:mm:sszzz')
if (Test-Path $stateFile) {
  try {
    $st = Get-Content -Raw $stateFile | ConvertFrom-Json
    if ($st.lastRun) { $since = [string]$st.lastRun }
  } catch { }
}

# --- Nap prompt template va chen SINCE/NOW ---
$tpl    = Get-Content -Raw (Join-Path $PSScriptRoot 'sec-directive-prompt.md')
$prompt = $tpl.Replace('{{SINCE}}', $since).Replace('{{NOW}}', $now)

Set-Location $work

# Tool duoc phep trong phien headless (khong co prompt tuong tac -> phai allow truoc)
$allowed = @(
  'Skill','Read','Write','Bash','PowerShell','Glob','Grep','ToolSearch',
  'mcp__MCP_DOCKER__jira_get_user_profile',
  'mcp__MCP_DOCKER__jira_search',
  'mcp__MCP_DOCKER__jira_get_issue',
  'mcp__MCP_DOCKER__sendMessage'
)

# Log de chan doan (gui email co bi bo qua / that bai khong)
$logDir = Join-Path $PSScriptRoot 'logs'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
$stamp   = $nowDt.ToString('yyyy-MM-dd_HH-mm')
$logFile = Join-Path $logDir "sec-directive-$stamp.log"

# Gui prompt qua stdin de tranh loi quoting voi noi dung nhieu dong.
$prompt | & $claude -p --output-format text --allowedTools $allowed *> $logFile
$exit = $LASTEXITCODE

# --- Cap nhat watermark CHI khi chay thanh cong ---
# Uu tien moc WATERMARK do skill in ra (= NOW), fallback = $now.
if ($exit -eq 0) {
  $wm = $now
  $line = Select-String -Path $logFile -Pattern '^WATERMARK\s+(\S+)' -ErrorAction SilentlyContinue | Select-Object -Last 1
  if ($line -and $line.Matches.Count -gt 0) { $wm = $line.Matches[0].Groups[1].Value }
  @{ lastRun = $wm; updatedAt = $now } | ConvertTo-Json | Set-Content -Path $stateFile -Encoding utf8
} else {
  Add-Content -Path $logFile -Value "RUN FAILED (exit $exit) — watermark NOT advanced; next run will re-cover this window."
}

# Don log cu hon 30 ngay
Get-ChildItem $logDir -Filter 'sec-directive-*.log' |
  Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } |
  Remove-Item -Force -ErrorAction SilentlyContinue
