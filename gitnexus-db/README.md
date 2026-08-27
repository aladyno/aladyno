# gitnexus-db — database layer for a GitNexus knowledge graph

GitNexus indexes code only. Its graph has `File`, `Class`, `Method`, `Route`… and
nothing that represents a database, so a question like *"which endpoints break if
I drop a column from `BK_BOOKING_MASTER`?"* is unanswerable from the index alone.

This tool reads the DDL and MyBatis mappers that already sit in the repo and
writes a **DB layer** into the same graph, beside the code graph:

```
File(db-schema/OMH_SUITE/X.sql) ──DEFINES_TABLE──▶ DbTable ──HAS_COLUMN──▶ DbColumn
Method(mapper interface)        ──READS/WRITES───▶ DbTable
Interface(mapper)               ──READS/WRITES───▶ DbTable
File(mapper XML, .sql script)   ──READS/WRITES───▶ DbTable
```

Because `Method` nodes are the existing code-graph nodes, the normal `CALLS`
edges keep working through the join: **Controller → Service → Mapper method →
table** is one Cypher query.

## Usage

```bash
node build-db-layer.mjs --repo oh-api --dry-run   # parse + report, no writes
node build-db-layer.mjs --repo oh-api             # rebuild the layer
```

```powershell
# re-index and rebuild in one step (see "Resync" below)
powershell -NoProfile -ExecutionPolicy Bypass -File resync.ps1 -Repo oh-api
```

Options: `--schema-dir <rel>` (default `db-schema/OMH_SUITE`),
`--mapper-suffix <s>` (default `Mapper.xml`), `--dry-run`.

The repo is located through `~/.gitnexus/registry.json`, so `--repo` takes the
same name `gitnexus list` shows.

## Current coverage on oh-api

| | |
|---|---|
| `DbTable` nodes | 389 |
| `DbColumn` nodes | 7,634 (type, nullability, PK, default, Korean comment) |
| `DbIndex` nodes | 2,263 (PRIMARY, unique constraints, `create index`; column order kept) |
| `DbRelation` edges | 32,497 |
| Mapper statements resolved to tables | 3,982 of 4,434 (90%) |
| Non-DDL `.sql` files linked | 285 (stored procedures, functions, events) |

## Schema

**`DbTable`** — `id` (`db:TABLE_NAME`), `name`, `ddlPath`, `comment`, `columnCount`

**`DbColumn`** — `id` (`db:TABLE.COLUMN`), `name`, `tableName`, `dataType`,
`nullable`, `isPrimaryKey`, `isAutoIncrement`, `defaultValue`, `comment`, `ordinal`

**`DbIndex`** — `id` (`db:TABLE#INDEX`), `name` (`PRIMARY` for the PK), `tableName`,
`isUnique`, `isPrimary`, `columnCount`, `columns` (comma-joined, in index order)

**`DbRelation`** — `type` ∈ `HAS_COLUMN` | `HAS_INDEX` | `INDEX_COLUMN` | `DEFINES_TABLE` | `READS` | `WRITES`,
plus `statement` and `kind` on method edges (the MyBatis statement id and its
`select`/`insert`/`update`/`delete` tag) and `ordinal` on `INDEX_COLUMN` edges
(position of the column inside the index, 0 = leading column).

`DbRelation` is a separate edge table from GitNexus's own `CodeRelation`, which
is never modified.

## Example queries

```bash
# who writes to a table
gitnexus cypher -r oh-api "MATCH (m:Method)-[r:DbRelation {type:'WRITES'}]->(t:DbTable {name:'BK_BOOKING_MASTER'}) RETURN m.filePath, m.name, r.statement"

# blast radius: callers of anything that touches a table
gitnexus cypher -r oh-api "MATCH (caller:Method)-[c:CodeRelation]->(m:Method)-[r:DbRelation]->(t:DbTable {name:'PM_PAYMENT_INFO'}) WHERE c.type='CALLS' RETURN DISTINCT caller.filePath, caller.name, r.type"

# a table's primary key and columns
gitnexus cypher -r oh-api "MATCH (t:DbTable {name:'BK_BOOKING_MASTER'})-[:DbRelation]->(c:DbColumn) RETURN c.name, c.dataType, c.nullable, c.isPrimaryKey, c.comment ORDER BY c.ordinal"

# indexes of a table
gitnexus cypher -r oh-api "MATCH (t:DbTable {name:'VD_VENDOR_ROOM_DAILY_PRICE'})-[:DbRelation]->(i:DbIndex) RETURN i.name, i.isUnique, i.columns ORDER BY i.isPrimary DESC, i.name"

# which indexes cover a column, and at what position
gitnexus cypher -r oh-api "MATCH (i:DbIndex)-[r:DbRelation {type:'INDEX_COLUMN'}]->(c:DbColumn {id:'db:VD_VENDOR_ROOM_DAILY_PRICE.APPLIED_DATE'}) RETURN i.name, r.ordinal, i.columns ORDER BY r.ordinal"

# hottest tables by code usage
gitnexus cypher -r oh-api "MATCH (t:DbTable) OPTIONAL MATCH (m:Method)-[:DbRelation]->(t) WITH t, count(m) AS uses RETURN t.name, uses ORDER BY uses DESC LIMIT 20"

# tables nothing in the code touches
gitnexus cypher -r oh-api "MATCH (t:DbTable) WHERE NOT EXISTS { MATCH ()-[r:DbRelation]->(t) WHERE r.type IN ['READS','WRITES'] } RETURN t.name"
```

## Resync

`gitnexus analyze` rebuilds the graph and drops every table it does not own —
verified: after `analyze --force` the `DbTable` table is gone, not merely stale.
So the DB layer must be rebuilt after any re-index.

**Automatic:** `C:UsersDaniel-Do.gitnexusin` holds a `gitnexus` shim
(`gitnexus.cmd` for cmd/PowerShell, `gitnexus` for Git Bash, both delegating to
`gitnexus-shim.mjs`). Put that folder **first** in the user PATH and every
`gitnexus analyze` — including `node .gitnexus/run.cjs analyze`, which resolves
the global binary via PATH — is followed by `build-db-layer.mjs --repo <root>`
whenever the analyzed repo has a `db-schema/` folder. `npx gitnexus analyze`
bypasses the shim. `GITNEXUS_SKIP_DB_LAYER=1` skips the rebuild once.

**Manual:** `resync.ps1` runs analyze + rebuild; running `build-db-layer.mjs`
alone is also safe at any time, since it drops and recreates its four tables
(`DbTable`, `DbColumn`, `DbIndex`, `DbRelation`) on every run.

## Limits

- **Only `cypher` sees this layer.** GitNexus's own `impact`, `context`, `trace`
  and `query` tools traverse `CodeRelation` only — they will not follow a
  `DbRelation` edge. Ask DB questions through `cypher`.
- **Table names built at runtime are missed.** 78 mapper statements interpolate
  the table name via `${}` and resolve to nothing. Same for any table name
  assembled in Java.
- **Regex, not a SQL parser.** Table references come from `FROM` / `JOIN` /
  `INSERT INTO` / `UPDATE` / `DELETE FROM` matches, kept only when the name
  exists in the DDL set. That filter removes alias and CTE noise, but a table
  absent from `db-schema/` is invisible even when the SQL names it.
- **`@Select`-annotated mappers are not read.** Only mapper XML.
- **7 mapper namespaces have no indexed Java interface**, so their statements
  produce file-level edges but no `Method → DbTable` edge.
- Column-level lineage (which column a statement selects) is not modelled —
  edges stop at the table.
- Don't widen a caller search with `-[:CodeRelation*1..3]->`: the hop type can't
  be filtered inside a variable-length pattern, so it walks every edge type and
  hangs on a hot table. Chain explicit `CALLS` hops instead (~4s for 2 hops).
