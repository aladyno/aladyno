'use strict';
/*
 * aladyn_jira_epic_notifier — quét các Jira epic đang follow (config.json) mỗi giờ,
 * 8h-19h T2-T6. KIẾN TRÚC LEAN (giống aladyn_jira_watcher / aladyn_jira_assigner):
 *   1. GUARD    : giờ hành chính + lock nguyên tử (1 instance).
 *   2. DETECT   : gọi THẲNG Jira REST (Node fetch, 1 JQL call cho TOÀN BỘ epic cùng lúc)
 *                 — $0, không token Claude nào.
 *   3. DEDUPE   : so với state.json (key -> updated đã từng notify) để không báo trùng
 *                 dù cửa sổ JQL (75') gối lên tick trước (chạy mỗi 60').
 *   3b. ENRICH  : với issue fresh, gọi thẳng Jira REST lấy changelog (ai đổi field gì,
 *                 từ → sang) + comment mới kể từ lần notify trước — vẫn $0 token Claude.
 *   4. NOTIFY   : CHỈ khi có issue mới/thật sự thay đổi mới gọi `claude -p` — đúng 1 lần,
 *                 model rẻ (Haiku), --mcp-config lean (chỉ MCP_DOCKER) + --allowedTools
 *                 chỉ sendMessage — Claude không cần đọc lại Jira, dữ liệu đã có sẵn từ
 *                 bước 2/3b; nó relay to/subject/body vào 1 tool call, và nếu có comment
 *                 dài thì tóm tắt các placeholder {{SUM_n}} ngay trong call đó.
 * Không có gì mới -> thoát ngay, $0 token Claude cho cả lượt chạy.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DIR = __dirname;
const readJSON = (f) => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, ''));
const CONFIG = readJSON(path.join(DIR, 'config.json'));
const SECRETS = readJSON(path.join(DIR, '..', 'jira-watcher', 'secrets.json'));
const STATE_FILE = path.join(DIR, 'state.json');
const LOG_FILE = path.join(DIR, 'activity.jsonl');
const LOCK_FILE = path.join(DIR, 'notifier.lock');
const MCP_LEAN = path.join(DIR, 'mcp-jira-only.json');

const ARGS = process.argv.slice(2);
const FORCE = ARGS.includes('--force'); // bỏ qua giờ HC khi test thủ công
const DRY_RUN = ARGS.includes('--dry-run'); // in email ra console thay vì gọi Claude gửi thật, không đánh dấu notified

const JIRA_AUTH = 'Basic ' + Buffer.from(`${SECRETS.jiraEmail}:${SECRETS.jiraToken}`).toString('base64');

function nowISO() { return new Date().toISOString(); }

function log(obj) {
  const line = JSON.stringify({ ts: nowISO(), pid: process.pid, ...obj });
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch {}
  console.log(line);
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch { return { lastCheck: null, notified: {} }; }
}
function saveState(s) { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); }

function inBusinessHours() {
  const d = new Date();
  const bh = CONFIG.businessHours;
  return bh.days.includes(d.getDay()) && d.getHours() >= bh.start && d.getHours() < bh.end;
}

function isAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; }
  catch (e) { return e.code === 'EPERM'; }
}

// Lock NGUYÊN TỬ: openSync 'wx' fail nếu file đã tồn tại -> chỉ 1 instance thắng.
function acquireLock() {
  const maxAgeMs = 10 * 60 * 1000; // job này chạy vài giây -> 10' là quá đủ dư
  for (let i = 0; i < 2; i++) {
    try {
      const fd = fs.openSync(LOCK_FILE, 'wx');
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      return true;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let pid = 0, age = 0;
      try { pid = parseInt(fs.readFileSync(LOCK_FILE, 'utf8').trim(), 10) || 0; } catch {}
      try { age = Date.now() - fs.statSync(LOCK_FILE).mtimeMs; } catch {}
      if ((!pid && age < 60000) || (isAlive(pid) && age < maxAgeMs)) return false;
      try { fs.unlinkSync(LOCK_FILE); } catch {}
    }
  }
  return false;
}

// ---------- Jira REST (gọi thẳng, không qua Claude) ----------
async function jira(pathStr, opts = {}) {
  const res = await fetch(SECRETS.jiraSite + pathStr, {
    ...opts,
    headers: { Authorization: JIRA_AUTH, 'Content-Type': 'application/json', Accept: 'application/json', ...(opts.headers || {}) },
  });
  if (!res.ok) throw new Error(`Jira ${res.status} ${res.statusText} @ ${pathStr}`);
  if (res.status === 204) return {};
  const txt = await res.text();
  return txt ? JSON.parse(txt) : {};
}

// DETECT: 1 JQL call duy nhất cho TẤT CẢ epic trong config — không lặp theo từng key.
async function detectUpdates(epicKeys) {
  const list = epicKeys.join(',');
  const windowExpr = `-${CONFIG.windowMinutes || 75}m`;
  const fields = ['summary', 'status', 'updated', 'parent'];

  const tryJql = async (jql) => {
    const body = JSON.stringify({ jql, maxResults: 50, fields });
    const r = await jira('/rest/api/3/search/jql', { method: 'POST', body });
    return r.issues || [];
  };

  try {
    return await tryJql(`(parent in (${list}) OR key in (${list})) AND updated >= "${windowExpr}" ORDER BY updated DESC`);
  } catch (e) {
    // company-managed project không có "parent" hierarchy -> thử thêm Epic Link
    return await tryJql(`("Epic Link" in (${list}) OR parent in (${list}) OR key in (${list})) AND updated >= "${windowExpr}" ORDER BY updated DESC`);
  }
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- ENRICH: changelog (ai đổi gì) + comment mới — vẫn Jira REST thẳng, $0 ----------

// Comment API v3 trả body dạng ADF (Atlassian Document Format) -> đi bộ cây lấy text thuần.
function adfToText(node) {
  if (!node || typeof node !== 'object') return '';
  let out = '';
  if (typeof node.text === 'string') out += node.text;
  if (node.type === 'mention' || node.type === 'emoji') out += (node.attrs && node.attrs.text) || '';
  if (node.type === 'hardBreak') out += ' ';
  if (Array.isArray(node.content)) for (const c of node.content) out += adfToText(c);
  if (node.type === 'paragraph' || node.type === 'heading' || node.type === 'listItem') out += ' ';
  return out;
}
const collapseWs = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const hhmm = (iso) => (iso ? new Date(iso).toTimeString().slice(0, 5) : '');

// Lấy thay đổi field + comment của 1 issue KỂ TỪ sinceMs (lần notify trước, hoặc đầu cửa sổ JQL).
// 3 REST call / issue, chỉ chạy cho issue "fresh" (thường 1-3 mã) -> vẫn không tốn token Claude nào.
async function enrichIssue(it, sinceMs) {
  const enrich = { changes: [], comments: [] };
  try {
    // Changelog phân trang tăng dần theo thời gian -> lấy total trước rồi đọc trang CUỐI (mới nhất).
    const head = await jira(`/rest/api/3/issue/${it.key}/changelog?maxResults=1`);
    const total = head.total || 0;
    const startAt = Math.max(0, total - 15);
    const page = total ? await jira(`/rest/api/3/issue/${it.key}/changelog?startAt=${startAt}&maxResults=15`) : { values: [] };
    for (const h of page.values || []) {
      if (new Date(h.created).getTime() <= sinceMs) continue; // <=: bỏ cả đúng sự kiện đã notify lần trước
      const author = (h.author && h.author.displayName) || 'N/A';
      for (const item of h.items || []) {
        enrich.changes.push({ author, created: h.created, field: item.field, from: item.fromString, to: item.toString });
      }
    }
  } catch (e) { log({ event: 'warn', phase: 'enrich-changelog', key: it.key, error: String(e).slice(0, 200) }); }
  try {
    const r = await jira(`/rest/api/3/issue/${it.key}/comment?orderBy=-created&maxResults=5`);
    for (const c of r.comments || []) {
      const ts = c.updated || c.created;
      if (new Date(ts).getTime() <= sinceMs) continue;
      const who = (c.updateAuthor && c.updateAuthor.displayName) || (c.author && c.author.displayName) || 'N/A';
      enrich.comments.push({ author: who, created: ts, text: collapseWs(adfToText(c.body)) });
    }
    enrich.comments.reverse(); // hiển thị cũ -> mới
  } catch (e) { log({ event: 'warn', phase: 'enrich-comments', key: it.key, error: String(e).slice(0, 200) }); }
  it._enrich = enrich;
}

const FIELD_VI = { status: 'Trạng thái', assignee: 'Người xử lý', summary: 'Tiêu đề', priority: 'Ưu tiên', duedate: 'Hạn chót', description: 'Mô tả', labels: 'Labels' };

// Gộp issue theo epic (dùng title cache trong config); issue không xác định được epic cha -> bucket "Khác".
function groupByEpic(issues, epicsCfg) {
  const byKey = new Map(epicsCfg.map((e) => [e.key, e]));
  const groups = new Map(); // epicKey|'other' -> { title, items: [] }
  for (const it of issues) {
    const parentKey = it.fields.parent && it.fields.parent.key;
    let epicKey = null;
    if (byKey.has(it.key)) epicKey = it.key; // chính epic gốc vừa đổi
    else if (parentKey && byKey.has(parentKey)) epicKey = parentKey;

    const bucketKey = epicKey || 'other';
    if (!groups.has(bucketKey)) {
      groups.set(bucketKey, { title: epicKey ? byKey.get(epicKey).title : 'Khác (không xác định epic cha)', items: [] });
    }
    groups.get(bucketKey).items.push(it);
  }
  return groups;
}

// HTML email Outlook-safe: document đầy đủ (DOCTYPE + meta charset) + layout <table>
// inline-style — Outlook desktop render bằng Word engine, không ăn div fragment/max-width,
// và thiếu charset là vỡ tiếng Việt. Ký tự •/→ dùng entity để miễn nhiễm lỗi encoding.
// Nội dung mỗi issue: field nào đổi (từ → sang, ai đổi) + comment mới. Comment dài chèn
// placeholder {{SUM_n}} — bước sendEmail nhờ chính call Haiku sẵn có tóm tắt trước khi gửi.
const SUMMARIZE_THRESHOLD = 180; // ký tự; comment ngắn hơn -> nhét thẳng, không cần tóm tắt

function buildEmail(groups, whenStr) {
  const titles = [...groups.values()].map((g) => g.title);
  const prefix = CONFIG.subjectPrefix || '[Jira Epic]';
  let subj = `${prefix} Jira update: ${titles.slice(0, 3).join(', ')}`;
  if (titles.length > 3) subj += '...';
  subj += ` — ${whenStr}`;

  const font = 'font-family:Arial,Helvetica,sans-serif';
  const sub = (html) => `<tr><td style="${font};font-size:13px;color:#444444;padding:0 0 3px 30px">${html}</td></tr>`;
  const commentJobs = []; // [{id:'SUM_n', text}] — comment dài cần Haiku tóm tắt
  let rows = '';
  for (const [bucketKey, g] of groups) {
    const heading = bucketKey === 'other' ? escapeHtml(g.title) : `${escapeHtml(bucketKey)} &middot; ${escapeHtml(g.title)}`;
    rows += `<tr><td style="${font};font-size:14px;font-weight:bold;color:#222222;padding:0 0 4px 0">${heading}</td></tr>`;
    for (const it of g.items) {
      const status = (it.fields.status && it.fields.status.name) || 'N/A';
      rows += `<tr><td style="${font};font-size:14px;color:#222222;padding:0 0 3px 14px">&bull; ${escapeHtml(it.key)} — ${escapeHtml(it.fields.summary)} &rarr; <b>${escapeHtml(status)}</b> <span style="color:#888888">(cập nhật lúc ${hhmm(it.fields.updated)})</span></td></tr>`;
      const en = it._enrich || { changes: [], comments: [] };
      for (const ch of en.changes) {
        const label = FIELD_VI[ch.field] || ch.field;
        const meta = `<span style="color:#888888">— ${escapeHtml(ch.author)}, ${hhmm(ch.created)}</span>`;
        if (ch.field === 'description') {
          rows += sub(`&ndash; ${escapeHtml(label)}: đã cập nhật nội dung ${meta}`);
        } else {
          rows += sub(`&ndash; ${escapeHtml(label)}: ${escapeHtml(trunc(ch.from || '(trống)', 60))} &rarr; <b>${escapeHtml(trunc(ch.to || '(trống)', 60))}</b> ${meta}`);
        }
      }
      for (const c of en.comments) {
        let content;
        if (c.text.length <= SUMMARIZE_THRESHOLD) {
          content = escapeHtml(c.text);
        } else {
          const id = `SUM_${commentJobs.length + 1}`;
          commentJobs.push({ id, text: trunc(c.text, 1500) });
          content = `{{${id}}}`;
        }
        rows += sub(`&ndash; &#128172; <b>${escapeHtml(c.author)}</b> <span style="color:#888888">(${hhmm(c.created)})</span>: ${content}`);
      }
      if (!en.changes.length && !en.comments.length) {
        rows += sub(`&ndash; <span style="color:#888888">Có cập nhật khác (worklog/liên kết...) — xem chi tiết trên Jira.</span>`);
      }
    }
    rows += `<tr><td style="font-size:1px;line-height:1px;height:12px">&nbsp;</td></tr>`;
  }

  const body =
    `<!DOCTYPE html><html lang="vi"><head><meta charset="utf-8">` +
    `<meta http-equiv="Content-Type" content="text/html; charset=utf-8">` +
    `<title>Cập nhật Jira epic</title></head>` +
    `<body style="margin:0;padding:0;background-color:#ffffff">` +
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" align="left" style="width:600px">${rows}</table>` +
    `</body></html>`;
  return { subject: subj, body, commentJobs };
}

// NOTIFY: gọi Claude ĐÚNG 1 lần — relay to/subject/body vào 1 tool call sendMessage.
// Nếu body có placeholder {{SUM_n}} (comment dài) thì cũng chính call này tóm tắt trước khi
// gửi — vẫn 1 call duy nhất. Scoped tối đa: mcp-config lean, allowedTools chỉ sendMessage.
function sendEmail(subject, body, commentJobs = []) {
  const lines = [
    'Gọi tool mcp__MCP_DOCKER__sendMessage ĐÚNG 1 LẦN với to/subject/body dưới đây,',
    'KHÔNG gọi thêm tool nào khác. Xong thì dừng ngay.',
  ];
  if (commentJobs.length) {
    lines.push(
      'Body HTML có các placeholder dạng {{SUM_n}}. TRƯỚC KHI GỬI: thay MỖI placeholder bằng',
      'tóm tắt tiếng Việt của comment tương ứng trong mục "COMMENTS CẦN TÓM TẮT" cuối prompt',
      '(1 câu, tối đa ~30 từ, không xuống dòng; escape các ký tự < > & thành &lt; &gt; &amp;).',
      'NGOÀI các placeholder đó, giữ NGUYÊN VĂN toàn bộ HTML, không chỉnh sửa gì khác.'
    );
  } else {
    lines.push('Giữ NGUYÊN VĂN body, KHÔNG chỉnh sửa nội dung.');
  }
  lines.push('', `to: ${CONFIG.email}`, `subject: ${subject}`, 'body (HTML):', body);
  if (commentJobs.length) {
    lines.push('', 'COMMENTS CẦN TÓM TẮT:');
    for (const j of commentJobs) lines.push(`[${j.id}] ${j.text}`);
  }
  const prompt = lines.join('\n');

  execFileSync(
    CONFIG.claudeBin || 'claude',
    [
      '-p', prompt,
      '--model', CONFIG.actModel || 'claude-haiku-4-5',
      '--mcp-config', MCP_LEAN,
      '--strict-mcp-config',
      '--allowedTools', 'mcp__MCP_DOCKER__sendMessage',
      '--permission-mode', 'bypassPermissions',
    ],
    { cwd: DIR, timeout: 5 * 60 * 1000, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }
  );
}

async function main() {
  if (!FORCE && !inBusinessHours()) { log({ event: 'skip', reason: 'outside-business-hours' }); return; }
  if (!acquireLock()) { log({ event: 'skip', reason: 'locked' }); return; }

  try {
    const epics = (CONFIG.epics || []).filter((e) => e && e.key && e.key !== 'OMH-000');
    if (!epics.length) { log({ event: 'skip', reason: 'no-epics-configured' }); return; }
    if (!CONFIG.live) { log({ event: 'skip', reason: 'observe-mode (live=false)' }); return; }

    const state = loadState();
    const epicKeys = epics.map((e) => e.key);

    let issues;
    try { issues = await detectUpdates(epicKeys); }
    catch (e) { log({ event: 'error', phase: 'detect', error: String(e).slice(0, 400) }); return; }

    log({ event: 'detect', source: 'jira-rest', count: issues.length, cost: 0, keys: issues.map((i) => i.key) });

    // DEDUPE: chỉ giữ issue mà updated timestamp khác lần đã notify gần nhất.
    const fresh = issues.filter((it) => state.notified[it.key] !== it.fields.updated);
    state.lastCheck = nowISO();

    if (!fresh.length) {
      log({ event: 'tick-done', notified: 0, reason: fresh.length === issues.length ? 'no-updates' : 'all-duplicates' });
      saveState(state);
      return;
    }

    // ENRICH: mỗi issue fresh lấy changelog + comment KỂ TỪ lần notify trước (fallback: đầu cửa sổ JQL).
    const windowStartMs = Date.now() - (CONFIG.windowMinutes || 75) * 60 * 1000;
    await Promise.all(fresh.map((it) => {
      const since = state.notified[it.key] ? new Date(state.notified[it.key]).getTime() : windowStartMs;
      return enrichIssue(it, since);
    }));

    const groups = groupByEpic(fresh, epics);
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const whenStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const { subject, body, commentJobs } = buildEmail(groups, whenStr);

    if (DRY_RUN) {
      console.log('--- DRY RUN: subject ---\n' + subject);
      console.log('--- DRY RUN: body (HTML) ---\n' + body);
      if (commentJobs.length) console.log('--- DRY RUN: comments cần tóm tắt ---\n' + commentJobs.map((j) => `[${j.id}] ${j.text}`).join('\n'));
      log({ event: 'dry-run', count: fresh.length, subject, keys: fresh.map((i) => i.key) });
      saveState(state); // lastCheck vẫn lưu; KHÔNG đánh dấu notified -> chạy thật sau vẫn gửi
      return;
    }

    try {
      sendEmail(subject, body, commentJobs);
    } catch (e) {
      log({ event: 'error', phase: 'send-email', error: String(e).slice(0, 400) });
      saveState(state); // vẫn lưu lastCheck; KHÔNG đánh dấu notified -> tick sau thử lại
      return;
    }

    for (const it of fresh) state.notified[it.key] = it.fields.updated;
    saveState(state);
    log({ event: 'notified', count: fresh.length, subject, keys: fresh.map((i) => i.key) });
  } finally {
    try { fs.unlinkSync(LOCK_FILE); } catch {}
  }
}

main().catch((e) => { log({ event: 'error', phase: 'main', error: String(e).slice(0, 400) }); process.exit(1); });
