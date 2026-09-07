#!/usr/bin/env node
// sanitize-sql.mjs — gate cứng TRƯỚC MỌI lần gọi execute_unsafe_sql (EXPLAIN ANALYZE thực thi thật).
// Usage:  node sanitize-sql.mjs <file.sql>        (đọc SQL từ file)
//         echo "<sql>" | node sanitize-sql.mjs -  (đọc từ stdin)
// Exit 0 + in JSON {ok:true, sql} nếu an toàn; exit 1 + {ok:false, reasons:[...]} nếu không.
// Quy tắc: đúng 1 statement, bắt đầu SELECT/WITH, không token nguy hiểm, không placeholder MyBatis.
import { readFileSync } from 'node:fs';

const src = process.argv[2] && process.argv[2] !== '-'
  ? readFileSync(process.argv[2], 'utf8')
  : readFileSync(0, 'utf8');

const reasons = [];
let sql = src.trim();

// 1. Bỏ comment (-- ..., # ..., /* ... */) nhưng GIỮ optimizer hint /*+ ... */
const noComments = sql
  .replace(/\/\*(?!\+)[\s\S]*?\*\//g, ' ')
  .replace(/--[^\n]*/g, ' ')
  .replace(/(^|\s)#[^\n]*/g, ' ');

// 2. Thay string literal bằng '' để không match token trong chuỗi
const stripped = noComments.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`[^`]*`/g, (m) => (m[0] === '`' ? m : "''"));

// 3. Đúng 1 statement
const body = stripped.replace(/;\s*$/, '');
if (body.includes(';')) reasons.push('Có nhiều hơn 1 statement (dấu ; ngoài string literal)');

// 4. Bắt đầu bằng SELECT hoặc WITH
if (!/^\s*(SELECT|WITH)\b/i.test(body)) reasons.push('Không bắt đầu bằng SELECT/WITH — chỉ SELECT đơn mới được EXPLAIN ANALYZE');

// 5. Token cấm
const banned = [
  [/\bFOR\s+UPDATE\b/i, 'FOR UPDATE (giữ row lock trên single writer)'],
  [/\bLOCK\s+IN\s+SHARE\s+MODE\b/i, 'LOCK IN SHARE MODE'],
  [/\bFOR\s+SHARE\b/i, 'FOR SHARE'],
  [/\bINTO\s+(OUTFILE|DUMPFILE)\b/i, 'INTO OUTFILE/DUMPFILE'],
  [/\bINTO\s+@/i, 'INTO @var'],
  [/\bSLEEP\s*\(/i, 'SLEEP()'],
  [/\bBENCHMARK\s*\(/i, 'BENCHMARK()'],
  [/\bLOAD_FILE\s*\(/i, 'LOAD_FILE()'],
  [/\bGET_LOCK\s*\(/i, 'GET_LOCK()'],
  [/\bRELEASE_LOCK\s*\(/i, 'RELEASE_LOCK()'],
  [/\b(INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP|TRUNCATE|RENAME|GRANT|REVOKE|SET|CALL|LOAD|HANDLER|ANALYZE|OPTIMIZE|FLUSH|KILL|SHUTDOWN)\b/i, 'từ khoá DML/DDL/admin'],
];
for (const [re, label] of banned) if (re.test(body)) reasons.push(`Token cấm: ${label}`);

// 6. Placeholder MyBatis chưa materialize
if (/#\{|\$\{/.test(noComments)) reasons.push('Còn placeholder MyBatis #{...}/${...} — phải materialize tại INIT');

// 7. Bắt buộc có hint timeout (thêm nếu thiếu)
if (!/\/\*\+\s*MAX_EXECUTION_TIME\s*\(\s*\d+\s*\)\s*\*\//i.test(sql)) {
  sql = sql.replace(/^(\s*SELECT)\b/i, '$1 /*+ MAX_EXECUTION_TIME(5000) */');
}

if (reasons.length) {
  console.log(JSON.stringify({ ok: false, reasons }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, sql: sql.replace(/;\s*$/, '') }, null, 2));
