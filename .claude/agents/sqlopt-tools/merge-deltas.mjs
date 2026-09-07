#!/usr/bin/env node
// merge-deltas.mjs — orchestrator merge delta files của worker vào blackboard.json (đơn luồng, không cần lock).
// Usage: node merge-deltas.mjs <dir>            # dir chứa blackboard.json và deltas/
//        node merge-deltas.mjs <dir> --slice meta,ledger,gather.completeness   # chỉ in slice (không merge)
// Worker KHÔNG bao giờ ghi blackboard.json — chỉ ghi deltas/<iteration>-<worker>[-<id>].json:
//   { "by": "<worker>", "phase": "GATHER", "status": "OK|PARTIAL|FAILED|NEEDS-INPUT",
//     "writes": { "gather.schema": [...], "gather.completeness": [...] },
//     "decision_log": { "event": "...", "rationale": "..." } }
// Quy tắc: chỉ key trong OWNERSHIP[by] được merge; mảng → append, object → assign (không xoá dữ liệu cũ);
// delta đã merge được ghi vào meta.applied_deltas (idempotent); PII trong distribution.top_value bị redact.
import { readFileSync, writeFileSync, readdirSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OWNERSHIP = {
  'gather-schema-index':   ['gather.schema', 'gather.indexes', 'gather.completeness', 'gather.missing'],
  'gather-params':         ['gather.params', 'gather.completeness', 'gather.missing'],
  'gather-distribution':   ['gather.distribution', 'gather.completeness', 'gather.missing'],
  'gather-explain':        ['gather.explain', 'gather.completeness', 'gather.missing'],
  'solve':                 ['solutions', 'handoff'],
  'validate-benchmark':    ['validation'],      // validation.<solution_id>.benchmark / .equivalence
  'validate-write-impact': ['validation'],      // validation.<solution_id>.write_impact_matrix / .read_impact
  'orchestrator':          ['*'],
};

const PII_RE = /(EMAIL|PHONE|MOBILE|NAME|PASSPORT|CARD|ADDR|BIRTH|TOKEN|PASSWORD|PASSWD|SECRET|IDENTITY|ID_NO)/i;

const dir = process.argv[2];
if (!dir) { console.error('usage: merge-deltas.mjs <dir> [--slice a,b.c]'); process.exit(2); }
const bbPath = join(dir, 'blackboard.json');
const bb = JSON.parse(readFileSync(bbPath, 'utf8'));

const sliceIdx = process.argv.indexOf('--slice');
if (sliceIdx > -1) {
  const out = {};
  for (const p of process.argv[sliceIdx + 1].split(',')) out[p] = get(bb, p);
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

const deltaDir = join(dir, 'deltas');
if (!existsSync(deltaDir)) mkdirSync(deltaDir);
bb.meta.applied_deltas ||= [];
const report = { merged: [], rejected: [], statuses: {} };

for (const f of readdirSync(deltaDir).filter((n) => n.endsWith('.json')).sort()) {
  if (bb.meta.applied_deltas.includes(f)) continue;
  let d;
  try { d = JSON.parse(readFileSync(join(deltaDir, f), 'utf8')); }
  catch (e) { report.rejected.push({ file: f, reason: 'JSON hỏng: ' + e.message }); continue; }

  const by = String(d.by || '').replace(/-S\d+$/, '');           // validate-benchmark-S2 → validate-benchmark
  const allowed = OWNERSHIP[by];
  if (!allowed) { report.rejected.push({ file: f, reason: `worker không biết: ${d.by}` }); continue; }

  const keys = Object.keys(d.writes || {});
  const bad = allowed[0] === '*' ? [] : keys.filter((k) => !allowed.some((a) => k === a || k.startsWith(a + '.')));
  if (bad.length) { report.rejected.push({ file: f, reason: `ghi ngoài phạm vi: ${bad.join(', ')}` }); continue; }

  for (const k of keys) merge(bb, k, d.writes[k]);
  bb.decision_log.push({
    ts: new Date().toISOString(), by: d.by, phase: d.phase, event: d.decision_log?.event || `merged ${f}`,
    keys_written: keys, rationale: d.decision_log?.rationale || null,
  });
  report.statuses[d.by] = d.status || 'OK';
  bb.meta.applied_deltas.push(f);
  report.merged.push(f);
}

for (const r of report.rejected) renameSync(join(deltaDir, r.file), join(deltaDir, r.file + '.rejected'));
redactPII(bb);
bb.meta.updated_at = new Date().toISOString();
const tmp = bbPath + '.tmp';
writeFileSync(tmp, JSON.stringify(bb, null, 2));
renameSync(tmp, bbPath);                                          // atomic replace
console.log(JSON.stringify(report, null, 2));

// ---------- helpers ----------
function get(obj, path) { return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj); }

function merge(obj, path, value) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]] ||= {};
  const last = parts[parts.length - 1];
  const existing = cur[last];
  if (Array.isArray(value)) cur[last] = [...(Array.isArray(existing) ? existing : []), ...value];
  else if (value && typeof value === 'object' && existing && typeof existing === 'object' && !Array.isArray(existing))
    cur[last] = deepAssign(existing, value);
  else cur[last] = value;
}

function deepAssign(target, src) {
  for (const [k, v] of Object.entries(src)) {
    if (Array.isArray(v)) target[k] = [...(Array.isArray(target[k]) ? target[k] : []), ...v];
    else if (v && typeof v === 'object' && target[k] && typeof target[k] === 'object') deepAssign(target[k], v);
    else target[k] = v;
  }
  return target;
}

function redactPII(b) {
  for (const row of b.gather?.distribution || []) {
    const comment = (b.gather?.schema || []).flatMap((t) => t.columns || []).find((c) => c.name === row.column)?.comment || '';
    if (PII_RE.test(row.column) || /PII/i.test(comment)) row.top_value = '<redacted>';
  }
  if (b.gather?.params?.raw_samples) {
    b.gather.params.raw_samples = b.gather.params.raw_samples.map((s) =>
      typeof s === 'string' ? s.replace(/'(?:[^'\\]|\\.)*'/g, '?').replace(/\b\d{4,}\b/g, '?') : s);
  }
}
