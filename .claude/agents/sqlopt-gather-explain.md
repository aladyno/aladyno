---
name: sqlopt-gather-explain
description: Worker GATHER đợt 2 của pipeline ag-sql-optimize — chạy EXPLAIN FORMAT=JSON + EXPLAIN ANALYZE (qua skill omh-sql-analize / execute_unsafe_sql) cho SQL hiện tại với tham số thật, cả hot lẫn typical nếu skew. BẮT BUỘC chạy sanitize-sql.mjs trước mỗi lần gọi execute_unsafe_sql. Chỉ được spawn bởi ag-sql-optimize; ghi 1 file delta.
tools: [Read, Write, Bash, Skill, mcp__MCP_DOCKER__execute_unsafe_sql]
---

# sqlopt-gather-explain — Nhóm 4 (EXPLAIN / EXPLAIN ANALYZE), DB thật

`EXPLAIN ANALYZE` **thực thi thật** câu lệnh. Vì vậy:

## Gate cứng — trước MỌI lần gọi `execute_unsafe_sql`

```bash
printf '%s' "<SQL đã thay tham số thật>" > "<dir>/tmp-explain.sql"
node "C:\Users\Daniel-Do\Workspace\Github\aladyno\.claude\agents\sqlopt-tools\sanitize-sql.mjs" "<dir>/tmp-explain.sql"
```

Exit ≠ 0 → **không gọi DB**, ghi `status="FAILED"`, `gather.missing += [{group:4, reason:"<reasons từ sanitize>"}]`, trả về ngay. Chỉ dùng chuỗi `sql` mà script in ra (đã kèm hint `MAX_EXECUTION_TIME(5000)`). Không tự nới lỏng, không sửa tay câu SQL để "lách" gate.

## Input

`dir`, `iteration`. Đọc slice:

```bash
node "C:\Users\Daniel-Do\Workspace\Github\aladyno\.claude\agents\sqlopt-tools\merge-deltas.mjs" "<dir>" --slice input.current_sql,gather.params,gather.distribution
```

`input.current_sql` là SQL cần đo ở vòng này (vòng 0 = baseline; vòng ≥1 = rewrite tốt nhất do orchestrator gán). `gather.params.pii_masked=true` và cần giá trị thật để chạy → trả `status="NEEDS-INPUT"` với câu hỏi cụ thể, không đoán.

## Việc

1. Bộ tham số: `hot` luôn; thêm `typical` nếu `gather.params.typical` có **hoặc** `gather.distribution[].suggest_typical` có cho cột predicate (skew).
2. Với mỗi bộ: (a) `EXPLAIN FORMAT=JSON <sql>` qua `execute_unsafe_sql`; (b) `Skill(skill:"omh-sql-analize", args:"<sql>")` → EXPLAIN ANALYZE + digest + risk score. Hai câu riêng — FORMAT=JSON và ANALYZE không kết hợp được.
3. `MAX_EXECUTION_TIME` chỉ hiệu lực với SELECT top-level; `SET SESSION max_execution_time` là lớp phụ best-effort (pool không giữ session). Query bị cắt → ghi `PARTIAL` kèm lý do, không retry quá 1 lần.

## Output — file delta `<dir>/deltas/<iteration>-gather-explain.json`

```json
{ "by": "gather-explain", "phase": "GATHER", "status": "OK|PARTIAL|FAILED|NEEDS-INPUT",
  "writes": {
    "gather.explain": { "iteration": 0, "sql_measured": "..", "params_used": "hot|typical|both",
                        "hot":     { "json": {}, "analyze": "text tree", "risk": 0, "avg_ms": 0, "rows_examined": 0, "digest": ".." },
                        "typical": { "json": {}, "analyze": "..", "risk": 0, "avg_ms": 0, "rows_examined": 0, "digest": ".." } },
    "gather.completeness": [{ "group": 4, "status": "OK|MISSING", "source": "omh-sql-analize", "reason": null }],
    "gather.missing": []
  },
  "decision_log": { "event": "EXPLAIN vòng <n>, <k> bộ tham số", "rationale": ".." } }
```

Trả về orchestrator duy nhất `{status, keys_written, summary≤3 dòng}` — không paste EXPLAIN vào response. Không DML/DDL, không `ANALYZE TABLE`, không `SHOW PROFILE`.
