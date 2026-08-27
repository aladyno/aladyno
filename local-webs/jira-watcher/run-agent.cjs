'use strict';
/*
 * run-agent.cjs — SUPERVISOR cho 1 Jira key. Watcher spawn file này ở chế độ detached,
 * nên nó sống độc lập sau khi watcher thoát. Nó chạy agent ag-omh-jira-to-end (claude -p),
 * CHỜ tới khi xong (đây là tiến trình riêng, được phép block), rồi ghi result-<KEY>.json.
 * Watcher chỉ việc đọc file result đó ở tick sau = "lấy kết quả done".
 *
 *   node run-agent.cjs <JIRA-KEY>
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DIR = __dirname;
const KEY = process.argv[2];
if (!KEY) process.exit(2);

const CONFIG = JSON.parse(fs.readFileSync(path.join(DIR, 'config.json'), 'utf8').replace(/^﻿/, ''));

const prompt = `Bạn LÀ orchestrator ag-omh-jira-to-end cho Jira ${KEY}. Chạy TRỌN quy trình NGAY trong tiến trình này: SPEC → … → RELEASE (implement + test + commit + push + mở Pull Request thật), rồi tự lo phần còn lại (chuyển Jira sang In Review, thông báo).
QUY TẮC CỨNG:
- TUYỆT ĐỐI không dùng tool Agent để spawn sub-agent chạy nền rồi đứng chờ "sẽ báo lại sau". Tự thực thi ĐỒNG BỘ qua các skill worker (gọi bằng tool Skill), chờ từng worker xong mới đi tiếp.
- Jira đi qua MCP_DOCKER (đã ghim sẵn site ohmyjira.atlassian.net): tool tên mcp__MCP_DOCKER__jira_* và KHÔNG nhận tham số cloudId. Đừng tìm getAccessibleAtlassianResources — tool đó không tồn tại ở đây.
- Chỉ kết thúc khi RELEASE xong (PR đã mở, có URL) hoặc FAILED/NEEDS-INPUT. Dòng cuối in: "PR: <url>" hoặc "PR: NONE — <lý do>".`;

const logPath = path.join(DIR, `lastrun-${KEY}.txt`);
const resultPath = path.join(DIR, `result-${KEY}.json`);

let exitCode = 0, raw = '', err = '';
try {
  const out = execFileSync(
    CONFIG.claudeBin || 'claude',
    ['-p', prompt, '--permission-mode', 'bypassPermissions', '--model', CONFIG.actModel],
    {
      cwd: CONFIG.repoPath,
      input: '',
      maxBuffer: 1024 * 1024 * 256,
      timeout: (CONFIG.actTimeoutMin || 90) * 60 * 1000,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    }
  );
  raw = out.toString();
} catch (e) {
  exitCode = e.status || 1;
  raw = (e.stdout && e.stdout.toString()) || '';
  err = (e.killed ? 'timeout; ' : '') + String(e.message || '').slice(0, 200);
}

try { fs.writeFileSync(logPath, raw); } catch {}

const m = raw.match(/https:\/\/github\.com\/[^\s)"']+\/pull\/\d+/);
const prUrl = m ? m[0] : null;
const ok = !!prUrl && exitCode === 0;

// Ghi ATOMIC: write tmp rồi rename, để collectResults không bao giờ đọc trúng file ghi dở.
try {
  const tmp = resultPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({
    key: KEY,
    ok,
    prUrl,
    exitCode,
    finishedAt: new Date().toISOString(),
    error: err.trim() || null,
  }, null, 2));
  fs.renameSync(tmp, resultPath); // rename cùng volume = atomic
} catch {}

process.exit(0);
