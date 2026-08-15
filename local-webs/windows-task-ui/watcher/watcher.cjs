'use strict';
/*
 * aladyn_jira_watcher — quét Jira (In Progress + label implement) mỗi 30' trong giờ HC.
 * KIẾN TRÚC LEAN (chốt 2026-06-29): watcher CHỈ làm 4 việc rồi thoát ngay:
 *   1. GUARD    : giờ hành chính + lock nguyên tử (1 instance).
 *   2. DETECT   : gọi THẲNG Jira REST (Node fetch) — $0, không token Claude nào.
 *   3. CLASSIFY : IMPLEMENT (mới) | RE-CODE (đã giao + comment mới) | skip.
 *   4. DISPATCH : spawn agent ag-omh-jira-to-end ở chế độ NỀN (detached, KHÔNG chờ),
 *                 nhiều task -> nhiều agent chạy song song. Ghi pid để UI báo "đang chạy".
 * PHẦN CÒN LẠI (code → test → commit → push → PR → chuyển Jira → thông báo) là việc của AGENT.
 * Watcher KHÔNG block, KHÔNG email, KHÔNG parse PR, KHÔNG transition Jira.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync, spawn } = require('child_process');

const DIR = __dirname;
const readJSON = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8').replace(/^﻿/, ''));
const CONFIG = readJSON('config.json');
const SECRETS = readJSON('secrets.json');
const STATE_FILE = path.join(DIR, 'state.json');
const LOG_FILE = path.join(DIR, 'activity.jsonl');
const LOCK_FILE = path.join(DIR, 'watcher.lock');
const MCP_LEAN = path.join(DIR, 'mcp-jira-only.json');

const ARGS = process.argv.slice(2);
const FORCE = ARGS.includes('--force'); // bỏ qua giờ HC khi test thủ công

const JIRA_AUTH = 'Basic ' + Buffer.from(`${SECRETS.jiraEmail}:${SECRETS.jiraToken}`).toString('base64');

function nowISO() { return new Date().toISOString(); }

function log(obj) {
  const line = JSON.stringify({ ts: nowISO(), pid: process.pid, ...obj });
  fs.appendFileSync(LOG_FILE, line + '\n');
  console.log(line);
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch { return { lastCheck: null, tasks: {} }; }
}
function saveState(s) { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); }

function inBusinessHours() {
  const d = new Date();
  const bh = CONFIG.businessHours;
  return bh.days.includes(d.getDay()) && d.getHours() >= bh.start && d.getHours() < bh.end;
}

// PID còn sống không (Windows/posix)
function isAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; }
  catch (e) { return e.code === 'EPERM'; }
}

// Lock NGUYÊN TỬ: openSync 'wx' fail nếu file đã tồn tại -> chỉ 1 instance thắng.
// Trả về true nếu giữ được lock, false nếu instance khác đang chạy.
function acquireLock() {
  const maxAgeMs = (CONFIG.actTimeoutMin || 90) * 60 * 1000 + 10 * 60 * 1000;
  for (let i = 0; i < 2; i++) {
    try {
      const fd = fs.openSync(LOCK_FILE, 'wx'); // atomic create-exclusive
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      return true;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let pid = 0, age = 0;
      try { pid = parseInt(fs.readFileSync(LOCK_FILE, 'utf8').trim(), 10) || 0; } catch {}
      try { age = Date.now() - fs.statSync(LOCK_FILE).mtimeMs; } catch {}
      // pid chưa kịp ghi (race) hoặc còn sống & chưa quá hạn -> instance khác đang chạy thật
      if ((!pid && age < 60000) || (isAlive(pid) && age < maxAgeMs)) return false;
      // lock rác -> xoá, thử lại
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

// ADF (Atlassian Document Format) -> plain text
function adfText(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (node.text) return node.text;
  const kids = node.content || [];
  return kids.map(adfText).join(node.type === 'paragraph' ? '\n' : '');
}

async function detectTasks() {
  const body = JSON.stringify({
    jql: CONFIG.jql + ' ORDER BY updated DESC',
    maxResults: CONFIG.maxTasksPerTick,
    fields: ['summary', 'status', 'updated'],
  });
  const r = await jira('/rest/api/3/search/jql', { method: 'POST', body });
  const issues = r.issues || [];
  const out = [];
  const seen = new Set();
  for (const it of issues) {
    if (seen.has(it.key)) continue;
    seen.add(it.key);
    let latestComment = null;
    try {
      const c = await jira(`/rest/api/3/issue/${it.key}/comment?orderBy=-created&maxResults=1`);
      if (c.comments && c.comments.length) {
        const cm = c.comments[0];
        latestComment = { id: String(cm.id), author: (cm.author && cm.author.displayName) || '', body: adfText(cm.body).slice(0, 220) };
      }
    } catch (e) { /* bỏ qua lỗi comment lẻ */ }
    out.push({
      key: it.key,
      summary: it.fields.summary,
      status: it.fields.status && it.fields.status.name,
      updated: it.fields.updated,
      latestComment,
    });
  }
  return out;
}

// ---------- Git: branch khớp Jira key? ----------
function findBranch(key) {
  if (!/^[A-Z][A-Z0-9]+-\d+$/.test(key || '')) return null;
  try {
    const out = execFileSync('git', ['ls-remote', '--heads', 'origin', `${key}-*`], {
      cwd: CONFIG.repoPath,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
    if (!out) return null;
    const ref = out.split('\n')[0].split('refs/heads/')[1];
    return ref || null;
  } catch { return null; }
}

// === JOB 2 — KÍCH AGENT: spawn supervisor (run-agent.cjs) ở chế độ NỀN (detached), KHÔNG chờ. ===
// Supervisor sống độc lập sau khi watcher thoát; nó chạy agent tới xong rồi ghi result-<KEY>.json.
// Trả về pid của supervisor (để theo dõi "đang chạy"); result file là tín hiệu "done" (JOB 3).
function spawnAgent(key) {
  const child = spawn(process.execPath, [path.join(DIR, 'run-agent.cjs'), key], {
    cwd: DIR,
    detached: true,        // tách process group -> sống tiếp sau khi watcher thoát
    windowsHide: true,
    stdio: 'ignore',
  });
  child.unref();
  return child.pid;
}

// === JOB 3 — LẤY KẾT QUẢ DONE: đọc result-<KEY>.json mà supervisor ghi khi agent xong. ===
// RUNNING + có result  -> DONE (ok=có PR) hoặc FAILED (không PR / exit≠0).
// RUNNING + pid chết + KHÔNG result -> FAILED (supervisor crash).
// Không retry, không email — chỉ ghi nhận trạng thái cuối + log act-done để UI/người thấy.
function collectResults(state) {
  const maxAgeMs = ((CONFIG.actTimeoutMin || 90) + 15) * 60 * 1000; // timeout agent + 15' đệm
  for (const [key, v] of Object.entries(state.tasks)) {
    if (!v || v.state !== 'RUNNING') continue;
    const rp = path.join(DIR, `result-${key}.json`);
    if (fs.existsSync(rp)) {
      let r = null;
      try { r = JSON.parse(fs.readFileSync(rp, 'utf8')); } catch { r = null; }
      if (r === null) { // file ghi dở/hỏng -> KHÔNG xóa, KHÔNG đổi state; để tick sau đọc lại
        log({ event: 'warn', phase: 'collect', key, msg: 'result chưa đọc được, để tick sau' });
        continue;
      }
      v.state = r.ok ? 'DONE' : 'FAILED';
      v.prUrl = r.prUrl || v.prUrl || null;
      v.exitCode = r.exitCode;
      v.finishedAt = r.finishedAt || nowISO();
      log({ event: 'act-done', key, ok: !!r.ok, prUrl: v.prUrl, exitCode: r.exitCode, error: r.error || undefined });
      try { fs.unlinkSync(rp); } catch {}
    } else if (!isAlive(v.pid)) {
      // supervisor chết mà không để lại result -> crash thật.
      v.state = 'FAILED';
      v.finishedAt = nowISO();
      log({ event: 'act-done', key, ok: false, reason: 'crashed-no-result' });
    } else if (v.startedAt && (Date.now() - new Date(v.startedAt).getTime()) > maxAgeMs) {
      // pid còn "sống" nhưng quá hạn (treo, hoặc pid bị OS tái dùng) -> failsafe, không kẹt RUNNING mãi.
      v.state = 'FAILED';
      v.finishedAt = nowISO();
      log({ event: 'act-done', key, ok: false, reason: 'stale-timeout', agentPid: v.pid });
    }
  }
}

async function main() {
  if (!FORCE && !inBusinessHours()) { log({ event: 'skip', reason: 'outside-business-hours' }); return; }

  if (!acquireLock()) { log({ event: 'skip', reason: 'locked' }); return; }

  try {
    const state = loadState();
    const mode = CONFIG.live ? 'LIVE' : 'OBSERVE';

    // JOB 3 — lấy kết quả done của các agent đã chạy xong trước khi quét tiếp.
    collectResults(state);
    saveState(state);

    let tasks;
    try { tasks = await detectTasks(); }
    catch (e) { log({ event: 'error', phase: 'detect', error: String(e).slice(0, 400) }); return; }

    log({ event: 'detect', mode, source: 'jira-rest', count: tasks.length, cost: 0, keys: tasks.map(t => t.key) });

    const maxConc = CONFIG.maxConcurrentAgents || 3;
    // số agent đang THỰC SỰ chạy (pid còn sống) tính trên toàn bộ state
    let runningNow = Object.values(state.tasks).filter((v) => v && v.state === 'RUNNING' && isAlive(v.pid)).length;

    for (const t of tasks) {
      const key = t.key;
      const prev = state.tasks[key] || {};
      const branch = findBranch(key);
      const commentId = t.latestComment ? String(t.latestComment.id) : null;
      const commentNew = commentId && commentId !== prev.lastCommentId;

      // Đang chạy thật (pid sống) -> KHÔNG double-dispatch.
      if (prev.state === 'RUNNING' && isAlive(prev.pid)) {
        log({ event: 'skip', key, reason: 'already-running', agentPid: prev.pid });
        continue;
      }

      // Đã giao trước đó (có branch remote, hoặc state đã ở trạng thái terminal/đang chạy)
      // -> chỉ giao lại khi có comment mới. FAILED không tự retry: người xem log rồi comment để RE-CODE.
      const handed = !!branch || ['RUNNING', 'DISPATCHED', 'DONE', 'FAILED'].includes(prev.state);
      let action;
      if (!handed) action = 'IMPLEMENT';
      else if (commentNew) action = 'RE-CODE';
      else {
        state.tasks[key] = { ...prev, branch: branch || prev.branch || null, lastCommentId: commentId || prev.lastCommentId || null };
        continue;
      }

      // Kill-switch: live=false -> chỉ phát hiện, KHÔNG dispatch (vẫn detect + collect).
      if (!CONFIG.live) {
        log({ event: 'deferred', key, action, reason: 'observe-mode (live=false)' });
        continue;
      }

      if (runningNow >= maxConc) {
        log({ event: 'deferred', key, action, reason: `đã đạt maxConcurrentAgents=${maxConc}, để tick sau` });
        continue; // KHÔNG cập nhật state -> tick sau xử lý lại
      }

      // === DISPATCH: ném cho agent chạy nền, KHÔNG chờ. Agent tự lo phần còn lại. ===
      // Đóng cửa sổ double-dispatch: ghi RUNNING (pid=null) + lưu TRƯỚC khi spawn.
      // Nếu watcher chết ngay sau đây, tick sau thấy RUNNING+pid=null -> collectResults đánh FAILED
      // (isAlive(null)=false, hoặc result-first nếu agent đã kịp ghi) -> KHÔNG bao giờ dispatch lần 2.
      const startedAt = nowISO();
      state.tasks[key] = {
        state: 'RUNNING',
        pid: null,
        summary: t.summary || prev.summary || '',
        branch: branch || prev.branch || null,
        lastCommentId: commentId || prev.lastCommentId || null,
        lastAction: action,
        lastActionAt: startedAt,
        startedAt,
      };
      saveState(state);

      let pid;
      try {
        pid = spawnAgent(key);
      } catch (e) {
        log({ event: 'error', phase: 'dispatch', key, action, error: String(e).slice(0, 400) });
        state.tasks[key].state = 'FAILED';
        saveState(state);
        continue;
      }
      runningNow++;
      state.tasks[key].pid = pid; // cập nhật pid thật ngay sau spawn
      saveState(state);
      log({ event: 'dispatch', key, action, agentPid: pid, branch });
    }

    state.lastCheck = nowISO();
    saveState(state);
    const runningKeys = Object.entries(state.tasks).filter(([, v]) => v.state === 'RUNNING' && isAlive(v.pid)).map(([k]) => k);
    log({ event: 'tick-done', mode, processed: tasks.length, running: runningKeys.length, runningKeys });
  } finally {
    try { fs.unlinkSync(LOCK_FILE); } catch {}
  }
}

main().catch((e) => { log({ event: 'error', phase: 'main', error: String(e).slice(0, 400) }); process.exit(1); });
