# run-daily-report-stock.ps1
# Chạy bởi Windows Scheduled Task "aladyn_daily-report-stock" lúc 9:00 mỗi ngày.
# Orchestrator headless: delegate cho agent `vn-uptrend-scanner` quét 2 tuần HOSE+HNX,
# tìm mã vừa vào uptrend mạnh, gửi email qua Docker Gmail (mcp__MCP_DOCKER__sendMessage)
# và lưu bản dashboard vào windows-schedule\reports\. Sau đó copy dashboard sang
# stox-daily\data (cùng repo), commit + push lên origin. Không ghi log.

$ErrorActionPreference = 'Continue'

# Script nằm trong <repo>\windows-schedule -> repo root là thư mục cha
$work      = Split-Path -Parent $PSScriptRoot
$claude    = 'C:\Users\dzung\.local\bin\claude.exe'
$reportDir = Join-Path $PSScriptRoot 'reports'

if (-not (Test-Path $reportDir)) { New-Item -ItemType Directory -Path $reportDir | Out-Null }

$today = Get-Date -Format 'yyyy-MM-dd'

# Nạp prompt template (nằm cùng folder windows-schedule với script) và chèn ngày hiện tại
$tpl    = Get-Content -Raw (Join-Path $PSScriptRoot 'daily-report-stock-prompt.md')
$prompt = $tpl.Replace('{{DATE}}', $today)

Set-Location $work

# Các tool được phép trong phiên headless (không có prompt tương tác -> phải allow trước)
$allowed = @(
  'Task',
  'WebSearch','WebFetch','Read','Write','Glob','Grep',
  'mcp__MCP_DOCKER__sendMessage','mcp__MCP_DOCKER__listMessages','mcp__MCP_DOCKER__findMessage'
)

# Gửi prompt qua stdin để tránh giới hạn độ dài / lỗi quoting với nội dung nhiều dòng.
# Output bỏ qua — kết quả nằm ở email + file dashboard trong windows-schedule\reports\.
$prompt | & $claude -p --output-format text --allowedTools $allowed | Out-Null

# --- Export dashboard sang stox-daily/data (cùng repo) và commit + push ---
$stoxData = Join-Path $work 'stox-daily\data'
$report   = Join-Path $reportDir "uptrend-scan-$today.html"

if (Test-Path $report) {
  if (-not (Test-Path $stoxData)) { New-Item -ItemType Directory -Path $stoxData | Out-Null }
  Copy-Item $report $stoxData -Force

  # Cập nhật manifest.json (danh sách report cho web đọc): thêm file hôm nay nếu chưa có, giữ sorted
  $manifestPath = Join-Path $stoxData 'manifest.json'
  $files = @()
  if (Test-Path $manifestPath) {
    $files = @((Get-Content -Raw $manifestPath | ConvertFrom-Json).files)
  }
  $todayFile = "uptrend-scan-$today.html"
  if ($files -notcontains $todayFile) { $files += $todayFile }
  $manifest = @{ files = @($files | Sort-Object -Unique) } | ConvertTo-Json
  [System.IO.File]::WriteAllText($manifestPath, $manifest, (New-Object System.Text.UTF8Encoding($false)))

  # Chỉ add đúng file của hôm nay + manifest để không vô tình stage các thay đổi khác trong repo
  git -C $work add -- "stox-daily/data/$todayFile" "stox-daily/data/manifest.json"

  # Commit chỉ khi có thay đổi staged (tránh commit rỗng khi chạy lại trong ngày)
  git -C $work diff --cached --quiet
  if ($LASTEXITCODE -ne 0) {
    git -C $work commit -m "data: uptrend scan $today" | Out-Null
    git -C $work push | Out-Null
  }
}
