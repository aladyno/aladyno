'use strict';
/*
 * mcp-jira.cjs — client JSON-RPC stdio tối thiểu nói chuyện với `docker mcp gateway`.
 *
 * VÌ SAO TỒN TẠI: token trong jira-watcher/secrets.json hết hạn định kỳ (2026-08-21,
 * rồi lại 2026-08-26) và khi chết thì cả DETECT của assigner lẫn fetchIssue của
 * run-agent cùng gãy — schedule vẫn báo Last Result 0 nên không ai biết. Gateway
 * MCP_DOCKER giữ credential Jira riêng (secret docker/mcp/atlassian.jira.api_token,
 * không đọc ngược ra được), nên đi qua nó thì trong repo không còn token nào để hết hạn.
 *
 * VẪN $0: đây là JSON-RPC thẳng tới gateway, KHÔNG spawn Claude, không tốn token model.
 *
 *   const { withGateway } = require('./mcp-jira.cjs');
 *   const r = await withGateway(call => call('jira_search', { jql, limit }));
 */

const { spawn } = require('child_process');

const GATEWAY_CMD = 'docker';
const GATEWAY_ARGS = ['mcp', 'gateway', 'run', '--profile', 'omh_mcp'];
const DEFAULT_TIMEOUT_MS = 120000;

// Gateway trả kết quả tool dạng {content:[{type:'text',text:'<json>'}]}, và nội dung
// text ấy thường lại là JSON lồng một lớp nữa ({"result":"{...}"}). Bóc cho tới khi ra object.
function unwrap(result) {
  let node = result;
  if (node && Array.isArray(node.content)) {
    const txt = node.content.filter(c => c && c.type === 'text').map(c => c.text).join('');
    node = txt;
  }
  for (let i = 0; i < 3 && typeof node === 'string'; i++) {
    try { node = JSON.parse(node); } catch { break; }
    if (node && typeof node === 'object' && typeof node.result === 'string') node = node.result;
  }
  return node;
}

async function withGateway(fn, opts = {}) {
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
  const child = spawn(GATEWAY_CMD, GATEWAY_ARGS, {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });

  let nextId = 1;
  const pending = new Map();
  let buf = '';
  let stderr = '';
  let fatal = null;

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; } // gateway có log không phải JSON
      if (msg.id != null && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(`MCP ${msg.error.code}: ${msg.error.message}`));
        else resolve(msg.result);
      }
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (c) => { stderr = (stderr + c).slice(-4000); });

  const died = new Promise((_, reject) => {
    child.on('exit', (code) => {
      fatal = new Error(`mcp-gateway exit ${code}${stderr ? ': ' + stderr.slice(-600) : ''}`);
      for (const { reject: rj } of pending.values()) rj(fatal);
      pending.clear();
      reject(fatal);
    });
    child.on('error', (e) => {
      fatal = new Error(`mcp-gateway spawn failed: ${e.message}`);
      reject(fatal);
    });
  });
  died.catch(() => {}); // tránh unhandled rejection khi không ai await nó

  function send(obj) {
    if (fatal) throw fatal;
    child.stdin.write(JSON.stringify(obj) + '\n');
  }

  function rpc(method, params) {
    const id = nextId++;
    const p = new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      try { send({ jsonrpc: '2.0', id, method, params }); }
      catch (e) { pending.delete(id); reject(e); }
    });
    return p;
  }

  // call(<tên tool>, <args>) -> object đã bóc vỏ content/text/JSON lồng
  async function call(name, args) {
    const res = await rpc('tools/call', { name, arguments: args || {} });
    if (res && res.isError) {
      throw new Error(`tool ${name} lỗi: ${JSON.stringify(unwrap(res)).slice(0, 400)}`);
    }
    return unwrap(res);
  }

  const timer = setTimeout(() => {
    fatal = new Error(`mcp-gateway timeout sau ${Math.round(timeoutMs / 1000)}s`);
    try { child.kill(); } catch {}
  }, timeoutMs);

  try {
    await Promise.race([
      rpc('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'aladyn-jira-assigner', version: '1.0.0' },
      }),
      died,
    ]);
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    return await Promise.race([fn(call), died]);
  } finally {
    clearTimeout(timer);
    try { child.stdin.end(); } catch {}
    try { child.kill(); } catch {}
  }
}

module.exports = { withGateway, unwrap };
