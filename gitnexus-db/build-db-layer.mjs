/**
 * Add a database layer to an existing GitNexus knowledge graph.
 *
 * Reads MySQL DDL files and MyBatis mapper XML straight from the repo, then
 * writes DbTable / DbColumn / DbIndex nodes and a DbRelation edge table into the repo's
 * `.gitnexus/lbug` graph — beside the code graph, never touching CodeRelation.
 *
 * The layer is rebuilt from scratch on every run, so re-running after
 * `gitnexus analyze` is the supported way to resync.
 *
 * Usage:
 *   node build-db-layer.mjs --repo oh-api
 *   node build-db-layer.mjs --repo oh-api --schema-dir db-schema/OMH_SUITE --dry-run
 */
import { readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { parseDdlFile } from './parse-ddl.mjs';
import { parseMapperFile } from './parse-mappers.mjs';
import { extractTableRefs, normalizeSql } from './extract-tables.mjs';

// ---------------------------------------------------------------- args

const args = process.argv.slice(2);
const flag = (name, fallback = undefined) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const has = (name) => args.includes(`--${name}`);

const repoName = flag('repo');
const schemaDir = flag('schema-dir', 'db-schema/OMH_SUITE');
const mapperSuffix = flag('mapper-suffix', 'Mapper.xml');
const dryRun = has('dry-run');

if (!repoName) {
  console.error('Usage: node build-db-layer.mjs --repo <name> [--schema-dir <rel>] [--dry-run]');
  process.exit(2);
}

// ---------------------------------------------------------------- registry

const registryPath = path.join(homedir(), '.gitnexus', 'registry.json');
const registry = JSON.parse(readFileSync(registryPath, 'utf8'));
const entry = registry.find((r) => r.name === repoName || r.path === repoName);
if (!entry) {
  console.error(`Repo "${repoName}" not in ${registryPath}. Known: ${registry.map((r) => r.name).join(', ')}`);
  process.exit(2);
}
const repoRoot = entry.path;
const lbugPath = path.join(entry.storagePath, 'lbug');

// ---------------------------------------------------------------- scan repo

const toRel = (abs) => path.relative(repoRoot, abs).split(path.sep).join('/');

function walk(dir, predicate, out = []) {
  let items;
  try { items = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const item of items) {
    const abs = path.join(dir, item.name);
    if (item.isDirectory()) {
      if (item.name === 'build' || item.name === '.git' || item.name === 'node_modules') continue;
      walk(abs, predicate, out);
    } else if (predicate(item.name)) {
      out.push(abs);
    }
  }
  return out;
}

const ddlFiles = walk(path.join(repoRoot, schemaDir), (n) => n.toLowerCase().endsWith('.sql'));
const tables = [];
for (const abs of ddlFiles) {
  const parsed = parseDdlFile(abs, toRel(abs));
  if (parsed) tables.push(parsed);
}
const knownTables = new Set(tables.map((t) => t.name));
console.log(`DDL: ${tables.length} tables, ${tables.reduce((n, t) => n + t.columns.length, 0)} columns, `
  + `${tables.reduce((n, t) => n + t.indexes.length, 0)} indexes (from ${ddlFiles.length} files)`);

const mapperFiles = walk(repoRoot, (n) => n.endsWith(mapperSuffix));
const mappers = [];
for (const abs of mapperFiles) {
  const parsed = parseMapperFile(abs, toRel(abs), knownTables);
  if (parsed) mappers.push(parsed);
}
const stmtCount = mappers.reduce((n, m) => n + m.statements.length, 0);
const linkedStmts = mappers.reduce(
  (n, m) => n + m.statements.filter((s) => s.reads.length || s.writes.length).length, 0);
const dynamicStmts = mappers.reduce(
  (n, m) => n + m.statements.filter((s) => s.hasDynamicTable && !s.reads.length && !s.writes.length).length, 0);
console.log(`Mappers: ${mappers.length} files, ${stmtCount} statements, ${linkedStmts} resolved to tables `
  + `(${dynamicStmts} unresolved and using dynamic table names)`);

// Every .sql in the repo that is not one of the parsed CREATE TABLEs — stored
// procedures, functions, events, ad-hoc scripts. They touch tables too.
const ddlPaths = new Set(tables.map((t) => t.ddlPath));
const scripts = [];
for (const abs of walk(repoRoot, (n) => n.toLowerCase().endsWith('.sql'))) {
  const rel = toRel(abs);
  if (ddlPaths.has(rel)) continue;
  const refs = extractTableRefs(normalizeSql(readFileSync(abs, 'utf8')), knownTables);
  if (refs.reads.length || refs.writes.length) scripts.push({ path: rel, ...refs });
}
console.log(`SQL scripts: ${scripts.length} non-DDL .sql files referencing known tables`);

// ---------------------------------------------------------------- connect

const require = createRequire(import.meta.url);
const lbugEntry = require.resolve('@ladybugdb/core', {
  paths: [
    path.join(path.dirname(process.execPath), 'node_modules/gitnexus/node_modules'),
    path.join(path.dirname(process.execPath), 'node_modules'),
    process.cwd(),
  ],
});
const lb = await import(pathToFileURL(path.join(path.dirname(lbugEntry), 'index.mjs')).href);

const db = new lb.Database(lbugPath);
const conn = new lb.Connection(db);

const run = async (cypher, params = {}) => {
  const stmt = await conn.prepare(cypher);
  if (!stmt.isSuccess()) throw new Error(`${await stmt.getErrorMessage()}\n  in: ${cypher.trim().slice(0, 200)}`);
  const result = await conn.execute(stmt, params);
  return await result.getAll();
};
const runIgnoring = async (cypher) => { try { await run(cypher); } catch { /* table not present yet */ } };

// ---------------------------------------------------------------- resolve code nodes

const MAPPER_METHODS = `
MATCH (owner)-[r:CodeRelation]->(m:Method)
WHERE r.type = 'HAS_METHOD' AND owner.filePath =~ '.*Mapper[.]java'
RETURN owner.filePath AS ownerPath, owner.id AS ownerId, m.name AS methodName, m.id AS methodId`;

const methodsByOwner = new Map(); // ownerPath -> { ownerId, methods: Map<name, id> }
for (const row of await run(MAPPER_METHODS)) {
  let bucket = methodsByOwner.get(row.ownerPath);
  if (!bucket) methodsByOwner.set(row.ownerPath, (bucket = { ownerId: row.ownerId, methods: new Map() }));
  if (!bucket.methods.has(row.methodName)) bucket.methods.set(row.methodName, row.methodId);
}

/** `com.ohmy.api.mapper.X` -> the indexed Java file whose path ends with `com/ohmy/api/mapper/X.java`. */
const ownerForNamespace = (namespace) => {
  const suffix = `${namespace.replace(/\./g, '/')}.java`;
  for (const [ownerPath, bucket] of methodsByOwner) {
    if (ownerPath.endsWith(suffix)) return { ownerPath, ...bucket };
  }
  return null;
};

const indexedFiles = new Set((await run('MATCH (f:File) RETURN f.filePath AS p')).map((r) => r.p));

// ---------------------------------------------------------------- build rows

const tableId = (name) => `db:${name}`;
const columnId = (table, col) => `db:${table}.${col}`;

const tableRows = tables.map((t) => ({
  id: tableId(t.name), name: t.name, ddlPath: t.ddlPath,
  comment: t.comment, columnCount: t.columns.length,
}));

const columnRows = tables.flatMap((t) => t.columns.map((c) => ({
  id: columnId(t.name, c.name), name: c.name, tableName: t.name,
  dataType: c.dataType, nullable: c.nullable, isPrimaryKey: c.isPrimaryKey,
  isAutoIncrement: c.isAutoIncrement, defaultValue: c.defaultValue,
  comment: c.comment, ordinal: c.ordinal,
})));

const hasColumnRows = columnRows.map((c) => ({ from: tableId(c.tableName), to: c.id }));

const indexId = (table, idx) => `db:${table}#${idx}`;
const indexRows = tables.flatMap((t) => t.indexes.map((i) => ({
  id: indexId(t.name, i.name), name: i.name, tableName: t.name,
  isUnique: i.unique, isPrimary: i.name === 'PRIMARY',
  columnCount: i.columns.length, columns: i.columns.join(','),
})));

const hasIndexRows = indexRows.map((i) => ({ from: tableId(i.tableName), to: i.id }));

// DbIndex -> DbColumn; ordinal = position of the column inside the index (0 = leading column).
const indexColumnRows = tables.flatMap((t) => t.indexes.flatMap((i) => i.columns.map((c, ordinal) => ({
  from: indexId(t.name, i.name), to: columnId(t.name, c), ordinal,
}))));

const definesRows = tables
  .filter((t) => indexedFiles.has(t.ddlPath))
  .map((t) => ({ from: t.ddlPath, to: tableId(t.name) }));

const methodRows = [];        // Method -> DbTable
const ownerRows = new Map();  // Interface/Class -> DbTable, deduped
const fileRows = new Map();    // mapper XML File -> DbTable, deduped
const unresolvedNamespaces = [];

for (const mapper of mappers) {
  const owner = ownerForNamespace(mapper.namespace);
  if (!owner) unresolvedNamespaces.push(mapper.namespace);

  for (const stmt of mapper.statements) {
    const edges = [
      ...stmt.reads.map((t) => ['READS', t]),
      ...stmt.writes.map((t) => ['WRITES', t]),
    ];
    for (const [type, table] of edges) {
      const to = tableId(table);
      if (indexedFiles.has(mapper.xmlPath)) {
        fileRows.set(`${mapper.xmlPath}|${to}|${type}`, { from: mapper.xmlPath, to, type });
      }
      if (!owner) continue;
      ownerRows.set(`${owner.ownerId}|${to}|${type}`, { from: owner.ownerId, to, type });
      const methodId = owner.methods.get(stmt.id);
      if (methodId) methodRows.push({ from: methodId, to, type, statement: stmt.id, kind: stmt.kind });
    }
  }
}

for (const script of scripts) {
  if (!indexedFiles.has(script.path)) continue;
  for (const [type, list] of [['READS', script.reads], ['WRITES', script.writes]]) {
    for (const table of list) {
      const to = tableId(table);
      fileRows.set(`${script.path}|${to}|${type}`, { from: script.path, to, type });
    }
  }
}

console.log(`Edges: ${hasColumnRows.length} HAS_COLUMN, ${hasIndexRows.length} HAS_INDEX, `
  + `${indexColumnRows.length} INDEX_COLUMN, ${definesRows.length} DEFINES_TABLE, `
  + `${methodRows.length} method->table, ${ownerRows.size} mapper->table, ${fileRows.size} file->table`);
if (unresolvedNamespaces.length) {
  console.log(`  note: ${unresolvedNamespaces.length} mapper namespaces had no indexed Java interface `
    + `(e.g. ${unresolvedNamespaces.slice(0, 3).join(', ')})`);
}

if (dryRun) {
  console.log('\n--dry-run: graph not modified.');
  process.exit(0);
}

// ---------------------------------------------------------------- write

console.log('\nRebuilding DB layer...');
await runIgnoring('DROP TABLE DbRelation');
await runIgnoring('DROP TABLE DbIndex');
await runIgnoring('DROP TABLE DbColumn');
await runIgnoring('DROP TABLE DbTable');

await run(`CREATE NODE TABLE DbTable (
  id STRING, name STRING, ddlPath STRING, comment STRING, columnCount INT64,
  PRIMARY KEY (id))`);
await run(`CREATE NODE TABLE DbColumn (
  id STRING, name STRING, tableName STRING, dataType STRING, nullable BOOLEAN,
  isPrimaryKey BOOLEAN, isAutoIncrement BOOLEAN, defaultValue STRING, comment STRING, ordinal INT64,
  PRIMARY KEY (id))`);
await run(`CREATE NODE TABLE DbIndex (
  id STRING, name STRING, tableName STRING, isUnique BOOLEAN, isPrimary BOOLEAN,
  columnCount INT64, columns STRING,
  PRIMARY KEY (id))`);
await run(`CREATE REL TABLE DbRelation (
  FROM DbTable TO DbColumn,
  FROM DbTable TO DbIndex,
  FROM DbIndex TO DbColumn,
  FROM File TO DbTable,
  FROM Method TO DbTable,
  FROM Interface TO DbTable,
  FROM Class TO DbTable,
  FROM DbTable TO DbTable,
  type STRING, statement STRING, kind STRING, ordinal INT64)`);

const BATCH = 500;
async function batched(label, rows, cypher) {
  for (let i = 0; i < rows.length; i += BATCH) {
    await run(cypher, { rows: rows.slice(i, i + BATCH) });
  }
  console.log(`  ${label}: ${rows.length}`);
}

await batched('DbTable nodes', tableRows, `
UNWIND $rows AS r
CREATE (:DbTable {id: r.id, name: r.name, ddlPath: r.ddlPath, comment: r.comment, columnCount: r.columnCount})`);

await batched('DbColumn nodes', columnRows, `
UNWIND $rows AS r
CREATE (:DbColumn {id: r.id, name: r.name, tableName: r.tableName, dataType: r.dataType,
  nullable: r.nullable, isPrimaryKey: r.isPrimaryKey, isAutoIncrement: r.isAutoIncrement,
  defaultValue: r.defaultValue, comment: r.comment, ordinal: r.ordinal})`);

await batched('DbIndex nodes', indexRows, `
UNWIND $rows AS r
CREATE (:DbIndex {id: r.id, name: r.name, tableName: r.tableName, isUnique: r.isUnique,
  isPrimary: r.isPrimary, columnCount: r.columnCount, columns: r.columns})`);

await batched('HAS_COLUMN edges', hasColumnRows, `
UNWIND $rows AS r
MATCH (t:DbTable {id: r.from}), (c:DbColumn {id: r.to})
CREATE (t)-[:DbRelation {type: 'HAS_COLUMN'}]->(c)`);

await batched('HAS_INDEX edges', hasIndexRows, `
UNWIND $rows AS r
MATCH (t:DbTable {id: r.from}), (i:DbIndex {id: r.to})
CREATE (t)-[:DbRelation {type: 'HAS_INDEX'}]->(i)`);

await batched('INDEX_COLUMN edges', indexColumnRows, `
UNWIND $rows AS r
MATCH (i:DbIndex {id: r.from}), (c:DbColumn {id: r.to})
CREATE (i)-[:DbRelation {type: 'INDEX_COLUMN', ordinal: r.ordinal}]->(c)`);

await batched('DEFINES_TABLE edges', definesRows, `
UNWIND $rows AS r
MATCH (f:File {filePath: r.from}), (t:DbTable {id: r.to})
CREATE (f)-[:DbRelation {type: 'DEFINES_TABLE'}]->(t)`);

await batched('Method->table edges', methodRows, `
UNWIND $rows AS r
MATCH (m:Method {id: r.from}), (t:DbTable {id: r.to})
CREATE (m)-[:DbRelation {type: r.type, statement: r.statement, kind: r.kind}]->(t)`);

const ownerList = [...ownerRows.values()];
await batched('Mapper(Interface)->table edges', ownerList.filter((r) => r.from.startsWith('Interface:')), `
UNWIND $rows AS r
MATCH (i:Interface {id: r.from}), (t:DbTable {id: r.to})
CREATE (i)-[:DbRelation {type: r.type}]->(t)`);

await batched('Mapper(Class)->table edges', ownerList.filter((r) => r.from.startsWith('Class:')), `
UNWIND $rows AS r
MATCH (c:Class {id: r.from}), (t:DbTable {id: r.to})
CREATE (c)-[:DbRelation {type: r.type}]->(t)`);

await batched('File->table edges (mapper XML + SQL scripts)', [...fileRows.values()], `
UNWIND $rows AS r
MATCH (f:File {filePath: r.from}), (t:DbTable {id: r.to})
CREATE (f)-[:DbRelation {type: r.type}]->(t)`);

const [{ n: tableCount }] = await run('MATCH (t:DbTable) RETURN count(t) AS n');
const [{ n: indexCount }] = await run('MATCH (i:DbIndex) RETURN count(i) AS n');
const [{ n: edgeCount }] = await run('MATCH ()-[r:DbRelation]->() RETURN count(r) AS n');
console.log(`\nDone. Graph now holds ${tableCount} DbTable nodes, ${indexCount} DbIndex nodes and ${edgeCount} DbRelation edges.`);
console.log(`Query it with:  gitnexus cypher -r ${repoName} "MATCH (m:Method)-[r:DbRelation]->(t:DbTable) RETURN m.name, r.type, t.name LIMIT 10"`);
