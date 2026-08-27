/**
 * Parse MySQL `create table` DDL files into { name, ddlPath, columns[], indexes[] }.
 *
 * Tolerates the OMH_SUITE dump style: column-level `primary key` on a
 * continuation line, backticked identifiers, and Korean `comment '...'`
 * text containing commas and parentheses.
 *
 * Indexes come from in-body `primary key` / `constraint X unique (...)` /
 * `[unique] key|index NAME (...)` clauses and from standalone
 * `create [unique] index NAME on TABLE (...)` statements that follow the
 * table in the same file.
 */
import { readFileSync } from 'node:fs';

const CONSTRAINT_START =
  /^(primary\s+key|unique\s+key|unique\s+index|unique|constraint|foreign\s+key|key|index|fulltext|spatial|check)\b/i;

const unquote = (s) => s.replace(/^[`"']|[`"']$/g, '');

/** Split a DDL body on commas that sit at paren-depth 0 and outside quotes. */
function splitTopLevel(body) {
  const parts = [];
  let buf = '';
  let depth = 0;
  let quote = null;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quote) {
      buf += ch;
      if (ch === '\\') { buf += body[++i] ?? ''; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; buf += ch; continue; }
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { parts.push(buf); buf = ''; continue; }
    buf += ch;
  }
  if (buf.trim()) parts.push(buf);
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** Extract the balanced `( ... )` body that starts at `openIdx`. */
function tableBody(sql, openIdx) {
  let depth = 0;
  let quote = null;
  for (let i = openIdx; i < sql.length; i++) {
    const ch = sql[i];
    if (quote) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '(') depth++;
    else if (ch === ')') { depth--; if (depth === 0) return sql.slice(openIdx + 1, i); }
  }
  return null;
}

/** Balanced `( ... )` body starting at the first `(` at or after `from`; null if none. */
function parenBody(text, from = 0) {
  const open = text.indexOf('(', from);
  return open === -1 ? null : tableBody(text, open);
}

/**
 * Index column list -> ['A', 'B', 'C'].
 * Plain entries drop prefix length / sort order (`B(10)`, `C DESC`). Functional
 * entries such as `(IFNULL(ROLE_SEQ, 0))` contribute every identifier that is a
 * real column of the table, so the index still links to the columns it covers.
 */
function indexColumns(list, knownColumns) {
  const out = [];
  for (const raw of splitTopLevel(list)) {
    if (raw.startsWith('(')) {
      for (const id of raw.match(/[A-Za-z_$][\w$]*/g) ?? []) {
        const n = id.toUpperCase();
        if (knownColumns?.has(n) && !out.includes(n)) out.push(n);
      }
      continue;
    }
    const n = unquote(raw).replace(/[\s(].*$/, '').toUpperCase();
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

function parseColumn(part, ordinal) {
  const m = /^(`[^`]+`|"[^"]+"|[A-Za-z_$][\w$]*)\s+([A-Za-z_][\w]*(?:\s+\w+)?)\s*(\([^)]*\))?/.exec(part);
  if (!m) return null;
  const comment = /\bcomment\s+'((?:[^'\\]|\\.|'')*)'/i.exec(part);
  return {
    name: unquote(m[1]).toUpperCase(),
    dataType: (m[2] + (m[3] ?? '')).replace(/\s+/g, ' ').toLowerCase(),
    nullable: !/\bnot\s+null\b/i.test(part),
    isPrimaryKey: /\bprimary\s+key\b/i.test(part),
    isAutoIncrement: /\bauto_increment\b/i.test(part),
    defaultValue: (/\bdefault\s+('(?:[^'\\]|\\.)*'|[\w.]+)/i.exec(part)?.[1] ?? '').slice(0, 120),
    comment: (comment?.[1] ?? '').replace(/\\'/g, "'").replace(/''/g, "'").slice(0, 500),
    ordinal,
  };
}

/**
 * In-body index clause -> { name, unique, columns[] } or null.
 * Handles: `constraint NAME unique (cols)`, `unique [key|index] [NAME] (cols)`,
 * `key NAME (cols)`, `index NAME (cols)`, `fulltext|spatial [key|index] [NAME] (cols)`.
 * `foreign key` and `check` are not indexes and return null.
 */
function parseIndexClause(part, knownColumns) {
  if (/^(constraint\s+\S+\s+)?(foreign\s+key|check)\b/i.test(part)) return null;
  const m = /^(?:constraint\s+(`[^`]+`|[A-Za-z_$][\w$]*)\s+)?(unique|key|index|fulltext|spatial)(?:\s+(?:key|index))?\s*(`[^`]+`|[A-Za-z_$][\w$]*)?\s*\(/i
    .exec(part);
  if (!m) return null;
  const columns = indexColumns(parenBody(part, m[0].length - 1) ?? '', knownColumns);
  if (!columns.length) return null;
  const kind = m[2].toUpperCase();
  return {
    name: unquote(m[1] ?? m[3] ?? `${kind}_${columns.join('_')}`),
    unique: kind === 'UNIQUE',
    columns,
  };
}

export function parseDdlFile(absPath, repoRelPath) {
  const sql = readFileSync(absPath, 'utf8');
  const head = /create\s+table\s+(?:if\s+not\s+exists\s+)?(`[^`]+`|[A-Za-z_$][\w$]*(?:\.[\w$]+)?)\s*\(/i.exec(sql);
  if (!head) return null;

  const openIdx = head.index + head[0].length - 1;
  const body = tableBody(sql, openIdx);
  if (body == null) return null;

  const tableName = unquote(head[1]).split('.').pop().toUpperCase();
  const columns = [];
  const constraintParts = [];

  for (const part of splitTopLevel(body)) {
    if (CONSTRAINT_START.test(part)) { constraintParts.push(part); continue; }
    const col = parseColumn(part, columns.length);
    if (col) columns.push(col);
  }
  const knownColumns = new Set(columns.map((c) => c.name));

  const indexes = [];
  const pkFromConstraint = new Set();
  for (const part of constraintParts) {
    if (/^primary\s+key/i.test(part)) {
      for (const n of indexColumns(parenBody(part) ?? '', knownColumns)) pkFromConstraint.add(n);
    } else {
      const idx = parseIndexClause(part, knownColumns);
      if (idx) indexes.push(idx);
    }
  }

  for (const col of columns) if (pkFromConstraint.has(col.name)) col.isPrimaryKey = true;
  const pkCols = columns.filter((c) => c.isPrimaryKey).map((c) => c.name);
  if (pkCols.length) indexes.unshift({ name: 'PRIMARY', unique: true, columns: pkCols });

  // Table-level options and standalone statements live after the closing paren.
  const tail = sql.slice(openIdx + body.length + 1);

  const createIdx =
    /create\s+(unique\s+)?(?:fulltext\s+|spatial\s+)?index\s+(`[^`]+`|[A-Za-z_$][\w$]*)\s+on\s+(`[^`]+`|[A-Za-z_$][\w$]*(?:\.[\w$]+)?)\s*\(/gi;
  for (let m; (m = createIdx.exec(tail));) {
    if (unquote(m[3]).split('.').pop().toUpperCase() !== tableName) continue;
    const cols = indexColumns(parenBody(tail, m.index + m[0].length - 1) ?? '', knownColumns);
    if (cols.length) indexes.push({ name: unquote(m[2]), unique: Boolean(m[1]), columns: cols });
  }

  // Dedupe by name, first definition wins.
  const seen = new Set();
  const dedupedIndexes = indexes.filter((i) => !seen.has(i.name) && seen.add(i.name));

  return {
    name: tableName,
    ddlPath: repoRelPath,
    comment: (/comment\s*=?\s*'((?:[^'\\]|\\.)*)'/i.exec(tail)?.[1] ?? '').slice(0, 500),
    columns,
    indexes: dedupedIndexes,
  };
}
