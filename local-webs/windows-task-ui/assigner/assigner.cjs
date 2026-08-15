'use strict';
/*
 * aladyn_jira_assigner — quét task/subtask Jira ASSIGN cho Daniel mà KHÔNG thuộc Ellis
 * (project ELS) và CHƯA link tới ticket Ellis nào, mỗi giờ trong giờ HC (T2-T6, 9h-17h).
 * KIẾN TRÚC LEAN (giống aladyn_jira_watcher):
 *   1. GUARD    : giờ hành chính + lock nguyên tử (1 instance).
 *   2. DETECT   : gọi THẲNG Jira REST (Node fetch, 1 call duy nhất, fields gồm cả
 *                 issuelinks) — $0, không token Claude nào.
 *   3. FILTER   : bỏ qua issue đã có issuelink tới 1 ticket ELS-* (đã "thuộc Ellis" rồi).
 *   4. DISPATCH : spawn run-agent.cjs ở chế độ NỀN (detached, KHÔNG chờ) — agent tự
 *                 gọi skill omh-jira-create để tạo ticket ELS + link lại, rồi ghi
 *                 result-<KEY>.json. Watcher tick sau đọc file đó = "lấy kết quả done".
 * FAILED không tự retry — người xem log/UI rồi xử lý thủ công.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const DIR = __dirname;
const readJSON = (f) => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, ''));
const CONFIG = readJSON(path.join(DIR, 'config.json'));
const SECRETS = readJSON(path.join(DIR, '..', 'watcher', 'secrets.json'));
const STATE_FILE = path.join(DIR, 'state.json');
const LOG_FILE = path.join(DIR, 'activity.jsonl');
const LOCK_FILE = path.join(DIR, 'assigner.lock');

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
function acquireLock() {
  const maxAgeMs = (CONFIG.actTimeoutMin || 20) * 60 * 1000 + 10 * 60 * 1000;
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

// Issue đã có issuelink trỏ tới 1 ticket ELS-* chưa (đã "thuộc Ellis" theo nghĩa liên kết)?
function hasEllisLink(fields) {
  const links = fields.issuelinks || [];
  const prefix = `${CONFIG.ellisProjectKey}-`;
  for (const l of links) {
    const linked = l.outwardIssue || l.inwardIssue;
    if (linked && linked.key && linked.key.startsWith(prefix)) return true;
  }
  return false;
}

// DETECT: 1 call Jira REST duy nhất — assignee=Daniel, project != ELS, task/subtask,
// chưa Done. fields đã gồm issuelinks nên không cần call thêm cho từng issue.
async function detectTasks() {
  const body = JSON.stringify({
    jql: CONFIG.jql + ' ORDER BY updated DESC',
    maxResults: CONFIG.maxTasksPerTick,
    fields: ['summary', 'issuetype', 'status', 'updated', 'issuelinks'],
  });
  const r = await jira('/rest/api/3/search/jql', { method: 'POST', body });
  const issues = r.issues || [];
  const out = [];
  for (const it of issues) {
    if (hasEllisLink(it.fields)) continue; // đã link Ellis rồi -> không phải việc của assigner
    out.push({
      key: it.key,
      summary: it.fields.summary,
      issuetype: it.fields.issuetype && it.fields.issuetype.name,
      status: it.fields.status && it.fields.status.name,
      updated: it.fields.updated,
    });
  }
  return out;
}

// === DISPATCH: ném cho agent chạy nền, KHÔNG chờ. Agent tự lo phần còn lại. ===
function spawnAgent(key) {
  const child = spawn(process.execPath, [path.join(DIR, 'run-agent.cjs'), key], {
    cwd: DIR,
    detached: true,
    windowsHide: true,
    stdio: 'ignore',
  });
  child.unref();
  return child.pid;
}

// === LẤY KẾT QUẢ DONE: đọc result-<KEY>.json mà agent ghi khi xong. ===
function collectResults(state) {
  const maxAgeMs = ((CONFIG.actTimeoutMin || 20) + 10) * 60 * 1000; // timeout agent + đệm
  for (const [key, v] of Object.entries(state.tasks)) {
    if (!v || v.state !== 'RUNNING') continue;
    const rp = path.join(DIR, `result-${key}.json`);
    if (fs.existsSync(rp)) {
      let r = null;
      try { r = JSON.parse(fs.readFileSync(rp, 'utf8')); } catch { r = null; }
      if (r === null) {
        log({ event: 'warn', phase: 'collect', key, msg: 'result chưa đọc được, để tick sau' });
        continue;
      }
      v.state = r.ok ? 'DONE' : 'FAILED';
      v.elsKey = r.elsKey || v.elsKey || null;
      v.elsUrl = r.elsUrl || v.elsUrl || null;
      v.exitCode = r.exitCode;
      v.finishedAt = r.finishedAt || nowISO();
      log({ event: 'act-done', key, ok: !!r.ok, elsKey: v.elsKey, exitCode: r.exitCode, error: r.error || undefined });
      try { fs.unlinkSync(rp); } catch {}
    } else if (!isAlive(v.pid)) {
      v.state = 'FAILED';
      v.finishedAt = nowISO();
      log({ event: 'act-done', key, ok: false, reason: 'crashed-no-result' });
    } else if (v.startedAt && (Date.now() - new Date(v.startedAt).getTime()) > maxAgeMs) {
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

    collectResults(state);
    saveState(state);

    let tasks;
    try { tasks = await detectTasks(); }
    catch (e) { log({ event: 'error', phase: 'detect', error: String(e).slice(0, 400) }); return; }

    log({ event: 'detect', mode, source: 'jira-rest', count: tasks.length, cost: 0, keys: tasks.map(t => t.key) });

    const maxConc = CONFIG.maxConcurrentAgents || 2;
    let runningNow = Object.values(state.tasks).filter((v) => v && v.state === 'RUNNING' && isAlive(v.pid)).length;

    for (const t of tasks) {
      const key = t.key;
      const prev = state.tasks[key] || {};

      if (prev.state === 'RUNNING' && isAlive(prev.pid)) {
        log({ event: 'skip', key, reason: 'already-running', agentPid: prev.pid });
        continue;
      }
      if (prev.state === 'RUNNING' || prev.state === 'DONE') {
        log({ event: 'skip', key, reason: `already-${prev.state.toLowerCase()}` });
        continue;
      }
      if (prev.state === 'FAILED') {
        // Không tự retry: người xem log rồi xử lý thủ công (xoá entry trong state.json để cho thử lại).
        log({ event: 'skip', key, reason: 'failed-no-auto-retry' });
        continue;
      }

      // Kill-switch: live=false -> chỉ phát hiện, KHÔNG dispatch.
      if (!CONFIG.live) {
        log({ event: 'deferred', key, reason: 'observe-mode (live=false)' });
        continue;
      }

      if (runningNow >= maxConc) {
        log({ event: 'deferred', key, reason: `đã đạt maxConcurrentAgents=${maxConc}, để tick sau` });
        continue; // KHÔNG cập nhật state -> tick sau xử lý lại
      }

      // Đóng cửa sổ double-dispatch: ghi RUNNING (pid=null) TRƯỚC khi spawn.
      const startedAt = nowISO();
      state.tasks[key] = {
        state: 'RUNNING',
        pid: null,
        summary: t.summary || '',
        issuetype: t.issuetype || null,
        startedAt,
      };
      saveState(state);

      let pid;
      try {
        pid = spawnAgent(key);
      } catch (e) {
        log({ event: 'error', phase: 'dispatch', key, error: String(e).slice(0, 400) });
        state.tasks[key].state = 'FAILED';
        saveState(state);
        continue;
      }
      runningNow++;
      state.tasks[key].pid = pid;
      saveState(state);
      log({ event: 'dispatch', key, agentPid: pid });
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
