# run-daily-standup.ps1
# Chay boi Windows Scheduled Task "daily-standup-report" luc 08:50 thu 2 - thu 6.
# Orchestrator headless: chay skill /standup — pull Jira + comment cua task chua xong + git log,
# tao bao cao Yesterday/Today/Blockers song ngu Anh-Viet (task chua xong carry-over sang Today
# kem van de tu comment), khong ma Jira, VOC gop 1 dong,
# export HTML parseable vao Workspace\Ohmyhotel\StandupReport\<YYYYMMDD>.html
# va gui email toi dung.dt@ohmyhotel.com qua mcp__MCP_DOCKER__sendMessage.

$ErrorActionPreference = 'Continue'

$claude    = 'C:\Users\dzung\.local\bin\claude.exe'
$work      = 'C:\Users\dzung\Workspace\Ohmyhotel'
$reportDir = Join-Path $work 'StandupReport'

if (-not (Test-Path $reportDir)) { New-Item -ItemType Directory -Path $reportDir | Out-Null }

$today = Get-Date -Format 'yyyy-MM-dd'

# Lookback: "Yesterday" = ngay lam viec gan nhat -> thu 2 lui 3 ngay (thu 6 + cuoi tuan), ngay khac lui 1 ngay
$lookback = if ((Get-Date).DayOfWeek -eq 'Monday') { 3 } else { 1 }

# Nap prompt template (cung folder windows-schedule) va chen ngay hien tai + lookback
$tpl    = Get-Content -Raw (Join-Path $PSScriptRoot 'daily-standup-prompt.md')
$prompt = $tpl.Replace('{{DATE}}', $today).Replace('{{LOOKBACK}}', "$lookback")

Set-Location $work

# Cac tool duoc phep trong phien headless (khong co prompt tuong tac -> phai allow truoc)
$allowed = @(
  'Skill','Read','Write','Edit','Glob','Grep','Bash','PowerShell','ToolSearch',
  'mcp__MCP_DOCKER__jira_get_user_profile',
  'mcp__MCP_DOCKER__jira_search',
  'mcp__MCP_DOCKER__jira_get_issue',
  'mcp__MCP_DOCKER__sendMessage'
)

# Gui prompt qua stdin de tranh loi quoting voi noi dung nhieu dong.
# Output ghi vao log de chan doan khi buoc gui email bi bo qua / that bai.
$logDir = Join-Path $PSScriptRoot 'logs'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
$logFile = Join-Path $logDir "standup-$today.log"

$prompt | & $claude -p --output-format text --allowedTools $allowed *> $logFile

# Don log cu hon 30 ngay
Get-ChildItem $logDir -Filter 'standup-*.log' |
  Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } |
  Remove-Item -Force -ErrorAction SilentlyContinue
