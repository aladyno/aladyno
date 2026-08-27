'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');
const { createClient, RESP_TYPES } = require('redis');
const zstd = require('@mongodb-js/zstd');

const PORT = process.env.PORT || 4321;
const HOST = '127.0.0.1';
const PS1 = path.join(__dirname, 'tasks.ps1');
const WATCHER_DIR = path.join(__dirname, 'watcher');
const REDIS_CONFIG_PATH = path.join(__dirname, 'redis', 'config.json');

// Đọc value theo đúng 1 key (không SCAN/KEYS), decode zstd, trả JSON.
async function redisGetDecoded(key) {
  const cfg = JSON.parse(fs.readFileSync(REDIS_CONFIG_PATH, 'utf8'));
  const opts = cfg.url
    ? { url: cfg.url, socket: { connectTimeout: 5000, reconnectStrategy: false } }
    : {
        socket: { host: cfg.host || '127.0.0.1', port: cfg.port || 6379, tls: !!cfg.tls, connectTimeout: 5000, reconnectStrategy: false },
        username: cfg.username || undefined,
        password: cfg.password || undefined,
        database: cfg.db || 0,
      };
  const client = createClient(opts).withTypeMapping({ [RESP_TYPES.BLOB_STRING]: Buffer });
  client.on('error', () => {});
  await client.connect();
  try {
    const buf = await client.get(key);
    if (buf === null || buf === undefined) return { found: false };
    let decoded;
    try {
      decoded = await zstd.decompress(buf);
    } catch (e) {
      return { found: true, decodeError: 'Không decode được zstd: ' + e.message };
    }
    try {
      return { found: true, data: JSON.parse(decoded.toString('utf8')) };
    } catch (e) {
      return { found: true, decodeError: 'Dữ liệu sau decode không phải JSON hợp lệ' };
    }
  } finally {
    await client.quit().catch(() => client.disconnect());
  }
}

// Run the PowerShell bridge script and parse its JSON output.
function runPS(args) {
  return new Promise((resolve, reject) => {
    const psArgs = [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-File', PS1,
      ...args,
    ];
    execFile('powershell.exe', psArgs, { maxBuffer: 1024 * 1024 * 16 }, (err, stdout, stderr) => {
      if (err && !stdout) {
        return reject(new Error(stderr || err.message));
      }
      const text = (stdout || '').trim();
      if (!text) return resolve({ ok: true });
      try {
        resolve(JSON.parse(text));
      } catch (e) {
        reject(new Error('Bad JSON from PowerShell: ' + text.slice(0, 500)));
      }
    });
  });
}

// PID còn sống không (để biết agent có đang chạy thật)
function isAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; }
  catch (e) { return e.code === 'EPERM'; }
}

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { resolve({}); }
    });
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

const PUBLIC_DIR = path.join(__dirname, 'public');

function serveStatic(res, file) {
  let decoded;
  try { decoded = decodeURIComponent(file); } catch { decoded = file; }
  if (decoded.includes('\\') || decoded.includes('\0')) {
    res.writeHead(400);
    return res.end('Bad request');
  }
  const safe = path.posix.normalize('/' + decoded).replace(/^\/+/, '');
  const full = path.join(PUBLIC_DIR, safe);
  if (full !== PUBLIC_DIR && !full.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(full, (err, buf) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
    res.end(buf);
  });
}

const VALID_MUTATIONS = new Set(['run', 'stop', 'enable', 'disable']);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);

  // API: list tasks
  if (url.pathname === '/api/tasks' && req.method === 'GET') {
    try {
      const all = url.searchParams.get('all') === 'true';
      const args = ['-Action', 'list'];
      if (all) args.push('-All');
      const data = await runPS(args);
      return sendJSON(res, 200, data);
    } catch (e) {
      return sendJSON(res, 500, { ok: false, error: e.message });
    }
  }

  // API: mutate a task
  if (url.pathname === '/api/action' && req.method === 'POST') {
    const body = await readBody(req);
    const { action, name, path: taskPath } = body;
    if (!VALID_MUTATIONS.has(action) || !name) {
      return sendJSON(res, 400, { ok: false, error: 'Invalid action or task name' });
    }
    try {
      const data = await runPS([
        '-Action', action,
        '-TaskName', name,
        '-TaskPath', taskPath || '\\',
      ]);
      return sendJSON(res, 200, data);
    } catch (e) {
      return sendJSON(res, 500, { ok: false, error: e.message });
    }
  }

  // API: watcher status + activity log
  if (url.pathname === '/api/watcher' && req.method === 'GET') {
    try {
      const readJSON = (f, fb) => { try { return JSON.parse(fs.readFileSync(path.join(WATCHER_DIR, f), 'utf8')); } catch { return fb; } };
      const config = readJSON('config.json', {});
      const state = readJSON('state.json', { lastCheck: null, tasks: {} });
      let log = [];
      try {
        const raw = fs.readFileSync(path.join(WATCHER_DIR, 'activity.jsonl'), 'utf8').trim().split('\n');
        log = raw.slice(-150).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).reverse();
      } catch {}
      // các task có agent đang chạy thật (state RUNNING + pid còn sống)
      const running = Object.entries((state && state.tasks) || {})
        .filter(([, v]) => v && v.state === 'RUNNING' && isAlive(v.pid))
        .map(([key, v]) => ({ key, pid: v.pid, action: v.lastAction || '', summary: v.summary || '', startedAt: v.startedAt || v.lastActionAt || null }));
      return sendJSON(res, 200, {
        ok: true,
        config: { live: !!config.live, jql: config.jql, email: config.email, businessHours: config.businessHours, detectModel: config.detectModel, maxConcurrentAgents: config.maxConcurrentAgents },
        state, running, log,
      });
    } catch (e) {
      return sendJSON(res, 500, { ok: false, error: e.message });
    }
  }

  // API: run watcher now (observe/force)
  if (url.pathname === '/api/watcher/run' && req.method === 'POST') {
    try {
      // chặn double-spawn: nếu watcher đang chạy (lock còn sống) thì không spawn cái thứ 2
      const lockPath = path.join(WATCHER_DIR, 'watcher.lock');
      if (fs.existsSync(lockPath)) {
        let pid = 0, alive = false;
        try { pid = parseInt(fs.readFileSync(lockPath, 'utf8').trim(), 10) || 0; } catch {}
        try { if (pid) { process.kill(pid, 0); alive = true; } } catch (e) { alive = e.code === 'EPERM'; }
        if (alive) return sendJSON(res, 200, { ok: true, alreadyRunning: true });
      }
      // chạy ẩn qua wscript (không bật cửa sổ console)
      const child = spawn('wscript.exe', [path.join(WATCHER_DIR, 'run-hidden-watcher-force.vbs')], {
        cwd: WATCHER_DIR, detached: true, stdio: 'ignore', windowsHide: true,
      });
      child.unref();
      return sendJSON(res, 200, { ok: true });
    } catch (e) {
      return sendJSON(res, 500, { ok: false, error: e.message });
    }
  }

  // API: get 1 key từ Redis, decode zstd, trả JSON (không scan/search)
  if (url.pathname === '/api/redis/get' && req.method === 'GET') {
    try {
      const key = (url.searchParams.get('key') || '').trim();
      if (!key) return sendJSON(res, 400, { ok: false, error: 'Thiếu key' });
      const result = await redisGetDecoded(key);
      return sendJSON(res, 200, { ok: true, ...result });
    } catch (e) {
      return sendJSON(res, 500, { ok: false, error: e.message });
    }
  }

  // Static
  if (req.method === 'GET') {
    return serveStatic(res, url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, HOST, () => {
  console.log(`\n  Windows Task Scheduler UI`);
  console.log(`  →  http://${HOST}:${PORT}\n`);
});
