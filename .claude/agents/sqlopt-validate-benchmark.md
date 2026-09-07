---
name: sqlopt-validate-benchmark
description: Worker VALIDATE của pipeline ag-sql-optimize — benchmark MỘT rewrite solution (EXPLAIN ANALYZE ≥3 lần, median, hot+typical) và kiểm equivalence BIT_XOR(CRC32) so với SQL gốc. BẮT BUỘC sanitize-sql.mjs trước mỗi execute_unsafe_sql. Chỉ được spawn bởi ag-sql-optimize với solution_id; ghi 1 file delta.
tools: [Read, Write, Bash, Skill, mcp__MCP_DOCKER__execute_unsafe_sql]
---

# sqlopt-validate-benchmark — 1 worker / 1 rewrite solution

## Gate cứng — trước MỌI lần gọi `execute_unsafe_sql`

```bash
printf '%s' "<SQL>" > "<dir>/tmp-bench-<solution_id>.sql"
node "C:\Users\Daniel-Do\Workspace\Github\aladyno\.claude\agents\sqlopt-tools\sanitize-sql.mjs" "<dir>/tmp-bench-<solution_id>.sql"
```

Exit ≠ 0 → không gọi DB, `status="FAILED"`, ghi lý do vào `validation.<id>.benchmark.error`. Áp cho **cả** SQL rewrite lẫn SQL gốc lẫn câu equivalence.

## Input

`dir`, `iteration`, `solution_id`. Đọc slice:

```bash
node "C:\Users\Daniel-Do\Workspace\Github\aladyno\.claude\agents\sqlopt-tools\merge-deltas.mjs" "<dir>" --slice input.sql_normalized,input.current_sql,solutions,gather.params,gather.distribution,ledger
```

Chọn `solutions[]` có `id == solution_id` và `type == "rewrite"` (type=index → ghi `not-applicable`, không đo).

## Việc

1. **Benchmark:** `Skill(skill:"omh-sql-analize", args:"<sql đã sanitize>")` hoặc `EXPLAIN ANALYZE` trực tiếp, **≥3 lần, bỏ lần đầu, lấy median**; cho `hot` và `typical` (nếu có `gather.params.typical` hoặc `gather.distribution[].suggest_typical`). So với `ledger[best_iteration]`: chênh <10% **và** access-path không đổi → ghi `noise: true`.
2. **Equivalence** (cùng mẫu cho cả 2 câu):
   ```sql
   SELECT COUNT(*) cnt, BIT_XOR(CRC32(CONCAT_WS('|', <cột khoá + cột SELECT chính>))) chk
   FROM (<query ORDER BY <khoá> LIMIT 1000) t;
   ```
   Chạy với `input.sql_normalized` (gốc) và `solutions[id].sql`. Khác → `mismatch` (orchestrator sẽ loại solution).

## Output — file delta `<dir>/deltas/<iteration>-validate-benchmark-<solution_id>.json`

```json
{ "by": "validate-benchmark-<solution_id>", "phase": "VALIDATE", "status": "OK|PARTIAL|FAILED",
  "writes": {
    "validation.<solution_id>": {
      "benchmark": { "hot": { "median_ms": 0, "risk": 0, "rows_examined": 0, "access_path": ".." },
                     "typical": { "median_ms": 0, "risk": 0, "rows_examined": 0, "access_path": ".." },
                     "runs": 3, "noise": false, "error": null },
      "equivalence": { "method": "BIT_XOR(CRC32)", "sample": "LIMIT 1000 ORDER BY <khoá>", "result": "match|mismatch|not-applicable" }
    }
  },
  "decision_log": { "event": "benchmark <id>", "rationale": ".." } }
```

Trả về orchestrator duy nhất `{status, keys_written, summary≤3 dòng}`. Không tạo index để "đo thử", không DML/DDL.
