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
const SECRETS = readJSON(path.join(DIR, '..', 'watcher', 'secrets.json'));

const JIRA_AUTH = 'Basic ' + Buffer.from(`${SECRETS.jiraEmail}:${SECRETS.jiraToken}`).toString('base64');

// ADF (Atlassian Document Format) -> plain text
function adfText(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (node.text) return node.text;
  const kids = node.content || [];
  return kids.map(adfText).join(node.type === 'paragraph' ? '\n' : '');
}

async function fetchIssue() {
  const res = await fetch(`${SECRETS.jiraSite}/rest/api/3/issue/${KEY}?fields=summary,description,issuetype,status`, {
    headers: { Authorization: JIRA_AUTH, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Jira ${res.status} ${res.statusText}`);
  return res.json();
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
    summary = issue.fields.summary || '';
    description = adfText(issue.fields.description) || '(không có mô tả)';
    issuetype = (issue.fields.issuetype && issue.fields.issuetype.name) || '';
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
- Mọi call Jira MCP PHẢI dùng cloudId=${CONFIG.cloudId} (ohmyjira.atlassian.net). KHÔNG gọi getAccessibleAtlassianResources để tự đoán cloudId.
- CHỈ dùng Jira tool của MCP server MCP_DOCKER (mcp__MCP_DOCKER__createJiraIssue, mcp__MCP_DOCKER__createIssueLink, ...). TUYỆT ĐỐI KHÔNG dùng bất kỳ tool mcp__claude_ai_Atlassian__* nào (connector cloud — đã bị chặn).
- Sau khi tạo xong ticket ELS, gọi createIssueLink nối ${KEY} <-> ticket ELS vừa tạo, link type "${CONFIG.linkType}".
- Chỉ kết thúc khi đã tạo xong + link xong, hoặc FAILED/NEEDS-INPUT (ví dụ thiếu field bắt buộc mà không tự suy ra được). Dòng cuối cùng in đúng định dạng: "ELS: <key mới>" hoặc "ELS: NONE — <lý do>".`;

  let exitCode = 0, raw = '', err = '';
  try {
    const out = execFileSync(
      CONFIG.claudeBin || 'claude',
      ['-p', prompt, '--permission-mode', 'bypassPermissions', '--model', CONFIG.actModel,
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
