'use strict';
/*
 * run-agent.cjs — SUPERVISOR cho 1 Jira key. assigner.cjs spawn file này ở chế độ
 * detached, nên nó sống độc lập sau khi assigner thoát. Nó tự fetch lại issue nguồn
 * (assigner chỉ truyền KEY qua argv, không truyền text dài để tránh lỗi quote trên
 * Windows), rồi gọi Claude (claude -p) chạy skill omh-jira-create để tạo 1 ticket
 * Task trong space ELS mirror lại issue nguồn + link 2 ticket lại với nhau. CHỜ tới
 * khi xong (tiến trình riêng, được phép block), rồi ghi result-<KEY>.json.
 *
 *   node run-agent.cjs <JIRA-KEY>
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DIR = __dirname;
const KEY = process.argv[2];
if (!KEY) process.exit(2);

const readJSON = (f) => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, ''));
const CONFIG = readJSON(path.join(DIR, 'config.json'));
const { withGateway } = require('./mcp-jira.cjs');

const MCP_LEAN = path.join(DIR, 'mcp-jira-only.json');
// Tên tool THẬT trên docker mcp gateway (profile omh_mcp). KHÔNG phải createJiraIssue/
// createIssueLink — đó là tên của connector cloud claude.ai Atlassian, không tồn tại ở đây.
const ALLOWED_TOOLS = [
  'mcp__MCP_DOCKER__jira_create_issue',
  'mcp__MCP_DOCKER__jira_create_issue_link',
  'mcp__MCP_DOCKER__jira_get_issue',
  'mcp__MCP_DOCKER__jira_get_link_types',
  'mcp__MCP_DOCKER__jira_get_project_fields',
  'mcp__MCP_DOCKER__jira_update_issue',
  'Skill', 'Read', 'Glob', 'Grep',
].join(',');

// Đọc issue nguồn qua MCP_DOCKER gateway. Trước đây gọi thẳng Jira REST bằng token
// trong jira-watcher/secrets.json — token đó hết hạn định kỳ (2026-08-21, 2026-08-26)
// và làm mọi agent chết ở fetch-issue-failed. Gateway giữ credential riêng.
// Bonus: gateway trả description đã là plain text nên không cần bộ chuyển ADF nữa.
async function fetchIssue() {
  return withGateway((call) => call('jira_get_issue', {
    issue_key: KEY,
    fields: 'summary,description,issuetype,status',
  }));
}

function writeResult(resultPath, payload) {
  try {
    const tmp = resultPath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
    fs.renameSync(tmp, resultPath); // rename cùng volume = atomic
  } catch {}
}

async function main() {
  const logPath = path.join(DIR, `lastrun-${KEY}.txt`);
  const resultPath = path.join(DIR, `result-${KEY}.json`);

  let summary = '', description = '', issuetype = '';
  try {
    const issue = await fetchIssue();
    // gateway trả field phẳng + issue_type (snake_case); giữ nhánh .fields để phòng đổi shape.
    const f = issue.fields || issue;
    summary = f.summary || '';
    description = f.description || '(không có mô tả)';
    const itype = f.issue_type || f.issuetype;
    issuetype = (itype && itype.name) || '';
  } catch (e) {
    writeResult(resultPath, {
      key: KEY, ok: false, elsKey: null, elsUrl: null, exitCode: 1,
      finishedAt: new Date().toISOString(), error: `fetch-issue-failed: ${String(e).slice(0, 200)}`,
    });
    return;
  }

  const prompt = `Bạn đang chạy TỰ ĐỘNG trong tiến trình nền, KHÔNG có người ngồi cạnh để confirm hay trả lời câu hỏi làm rõ. Nhiệm vụ DUY NHẤT: dùng skill omh-jira-create để tạo 1 ticket type Task trong space ELS (ELLIS) mirror lại issue nguồn dưới đây, rồi link 2 ticket lại với nhau. Sau đó DỪNG.

NGUỒN: ${KEY} (${issuetype}) — "${summary}"
Mô tả gốc:
"""
${description}
"""

QUY TẮC CỨNG:
- Đây là exception rule cho chế độ chạy nền: BỎ QUA bước "Preview + chờ user Confirm" của skill omh-jira-create — soạn xong tạo luôn, KHÔNG hỏi lại, KHÔNG chờ ai duyệt.
- Title: giữ nguyên ý của title gốc; chỉ viết lại nếu title gốc chưa đạt chuẩn Action+Target+Outcome của skill.
- Description: dựa trên nội dung gốc ở trên. Ticket ELS này là mirror của 1 issue BTBS sẽ được link lại (theo exception "ELS ticket mirrored from a BTBS-linked source" trong skill) — CHỈ cần 2 mục Glossary/Context và Constraints/Non-goals. KHÔNG viết mục Technical Approach và Acceptance, kể cả dạng TBD — bỏ hẳn 2 mục đó.
- Priority: Medium (mặc định).
- Assignee: accountId ${CONFIG.assigneeAccountId} (chính là assignee của issue nguồn).
- Jira đi qua MCP_DOCKER (đã ghim sẵn site ohmyjira.atlassian.net): tool KHÔNG nhận tham số cloudId. Đừng tìm getAccessibleAtlassianResources — tool đó không tồn tại ở đây.
- CHỈ dùng Jira tool của MCP server MCP_DOCKER. TÊN TOOL ĐÚNG trên gateway này (GHI ĐÈ mọi tên khác mà skill omh-jira-create nhắc tới): tạo ticket = mcp__MCP_DOCKER__jira_create_issue, link 2 ticket = mcp__MCP_DOCKER__jira_create_issue_link, đọc ticket = mcp__MCP_DOCKER__jira_get_issue. KHÔNG hề tồn tại tool tên createJiraIssue / createIssueLink — ĐỪNG chờ chúng đăng ký.
- TUYỆT ĐỐI KHÔNG dùng bất kỳ tool mcp__claude_ai_Atlassian__* nào (connector cloud — đã bị chặn).
- Nếu sau 2 lần thử mà vẫn không gọi được tool Jira: DỪNG NGAY và in "ELS: NONE — <lý do>". KHÔNG được chờ MCP warm-up, KHÔNG hẹn retry sau, KHÔNG schedule wake-up — tiến trình này chạy nền, không ai đọc lời hứa retry.
- Sau khi tạo xong ticket ELS, gọi mcp__MCP_DOCKER__jira_create_issue_link nối ${KEY} <-> ticket ELS vừa tạo, link type "${CONFIG.linkType}".
- Chỉ kết thúc khi đã tạo xong + link xong, hoặc FAILED/NEEDS-INPUT (ví dụ thiếu field bắt buộc mà không tự suy ra được). Dòng cuối cùng in đúng định dạng: "ELS: <key mới>" hoặc "ELS: NONE — <lý do>".`;

  let exitCode = 0, raw = '', err = '';
  try {
    const out = execFileSync(
      CONFIG.claudeBin || 'claude',
      ['-p', prompt, '--permission-mode', 'bypassPermissions', '--model', CONFIG.actModel,
       // Ghim MCP: CHỈ nạp MCP_DOCKER từ file lean (bỏ gitnexus + config project), giống
       // jira-epic-notifier. --strict-mcp-config để không nạp thêm config global nào khác.
       '--mcp-config', MCP_LEAN, '--strict-mcp-config',
       // Whitelist đúng tên tool có thật trên gateway -> agent không ngồi chờ tool ma.
       '--allowedTools', ALLOWED_TOOLS,
       // Bắt buộc đi qua Jira local (MCP_DOCKER) — chặn connector cloud claude.ai Atlassian.
       '--disallowedTools', 'mcp__claude_ai_Atlassian'],
      {
        cwd: DIR,
        input: '',
        maxBuffer: 1024 * 1024 * 256,
        timeout: (CONFIG.actTimeoutMin || 20) * 60 * 1000,
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

  const m = raw.match(/ELS:\s*(ELS-\d+)/);
  const elsKey = m ? m[1] : null;
  const ok = !!elsKey && exitCode === 0;

  writeResult(resultPath, {
    key: KEY,
    ok,
    elsKey,
    elsUrl: elsKey ? `https://ohmyjira.atlassian.net/browse/${elsKey}` : null,
    exitCode,
    finishedAt: new Date().toISOString(),
    error: err.trim() || null,
  });
}

main().catch((e) => {
  const resultPath = path.join(DIR, `result-${KEY}.json`);
  writeResult(resultPath, {
    key: KEY, ok: false, elsKey: null, elsUrl: null, exitCode: 1,
    finishedAt: new Date().toISOString(), error: `run-agent-crash: ${String(e).slice(0, 200)}`,
  });
  process.exit(1);
});
