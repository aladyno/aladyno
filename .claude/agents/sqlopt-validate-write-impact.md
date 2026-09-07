---
name: sqlopt-validate-write-impact
description: Worker VALIDATE của pipeline ag-sql-optimize — với MỌI index solution, tra gitnexus-db (mcp__gitnexus__cypher) xem method nào WRITES (chi phí ghi thêm) và READS (plan có thể đổi) bảng đó, ước lượng index_size_mb, lock risk. Hoàn toàn offline, không có tool DB. Chỉ được spawn bởi ag-sql-optimize; ghi 1 file delta.
tools: [Read, Write, Bash, Grep, mcp__gitnexus__cypher]
---

# sqlopt-validate-write-impact — Write/Read Impact Matrix (offline)

## Input

`dir`, `iteration`. Đọc slice:

```bash
node "C:\Users\Daniel-Do\Workspace\Github\aladyno\.claude\agents\sqlopt-tools\merge-deltas.mjs" "<dir>" --slice solutions,gather.schema,gather.distribution
```

Lọc `solutions[]` có `type == "index"` và chưa có `validation.<id>.write_impact_matrix`.

## Việc (mỗi bảng của mỗi index solution)

```cypher
MATCH (m:Method)-[r:DbRelation]->(t:DbTable {name: $TABLE}) WHERE r.type = 'WRITES'
RETURN m.filePath, m.name, r.statement, r.kind ORDER BY r.kind

MATCH (m:Method)-[r:DbRelation]->(t:DbTable {name: $TABLE}) WHERE r.type = 'READS'
RETURN m.filePath, m.name, r.statement, r.kind ORDER BY m.filePath
```

Điều kiện: cwd repo `oh-api` + layer đã build (lỗi "Table DbTable does not exist" → `node C:\Users\Daniel-Do\Workspace\Github\aladyno\gitnexus-db\build-db-layer.mjs --repo oh-api` 1 lần). Không thoả → `Grep` INSERT/UPDATE/DELETE/SELECT nhắm bảng trong mapper XML, ghi `source: "grep-fallback"` (kém tin cậy). Luôn ghi coverage gap: `${}` không resolve, `@Select` vô hình, bảng thiếu trong `db-schema/` vô hình.

- `index_size_mb ≈ table_rows (gather.distribution) × (Σ độ dài cột trong index theo gather.schema + PK ref) / 1048576` — ghi rõ là ước lượng.
- `lock_risk`: "ALGORITHM=INPLACE LOCK=NONE khả thi cho hầu hết composite secondary index InnoDB 8.0; MySQL có thể fallback COPY — DBA xác nhận trước giờ cao điểm".
- `read_impact` liệt **mọi** method READS khác trên bảng — mục đích là cảnh báo tác dụng phụ plan đổi, khuyến nghị re-EXPLAIN sau khi áp dụng.

## Output — file delta `<dir>/deltas/<iteration>-validate-write-impact.json`

```json
{ "by": "validate-write-impact", "phase": "VALIDATE", "status": "OK|PARTIAL",
  "writes": {
    "validation.<solution_id>": {
      "write_impact_matrix": [{ "table": "..", "method": "..", "kind": "insert|update|delete", "source": "gitnexus|grep-fallback",
                                "write_cost_note": "+1 B-Tree write / hàng", "index_size_mb": 0, "lock_risk": ".." }],
      "read_impact": [{ "table": "..", "method": "..", "statement": "..", "kind": "select", "note": "re-EXPLAIN sau khi áp dụng" }],
      "coverage_gap": ".."
    }
  },
  "decision_log": { "event": "impact cho N index / M bảng", "rationale": ".." } }
```

Nhiều index solution → nhiều key `validation.<id>` trong cùng 1 delta. Trả về orchestrator duy nhất `{status, keys_written, summary≤3 dòng}`. Không sửa code, không gọi DB.
