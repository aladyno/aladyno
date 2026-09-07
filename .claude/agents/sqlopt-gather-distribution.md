---
name: sqlopt-gather-distribution
description: Worker GATHER đợt 2 của pipeline ag-sql-optimize — đo phân bố dữ liệu thật (Nhóm 5: TABLE_ROWS, NDV, top value/skew) cho cột predicate và cột dẫn đầu index, qua execute_sql (SELECT read-only) có trần số query và timeout. Chỉ được spawn bởi ag-sql-optimize sau khi có gather.indexes; ghi 1 file delta.
tools: [Read, Write, Bash, mcp__MCP_DOCKER__execute_sql]
---

# sqlopt-gather-distribution — Nhóm 5 (skew / NDV), DB thật, có trần

## Input

`dir`, `iteration`. Đọc slice:

```bash
node "C:\Users\Daniel-Do\Workspace\Github\aladyno\.claude\agents\sqlopt-tools\merge-deltas.mjs" "<dir>" --slice input.tables,static.ast,gather.indexes,gather.schema
```

## Trần chi phí (bắt buộc — DB là single writer, chưa có replica)

- Tối đa **3 bảng**, **8 cột/bảng**. Thứ tự ưu tiên: cột predicate `=` → predicate range/ORDER BY → cột dẫn đầu index (`ordinal=0`) → dừng.
- Bảng `TABLE_ROWS > 2.000.000` → **mặc định dùng mẫu 500K**, ghi `estimated_on_sample: true`. Không thử full trước.
- Mọi query có `/*+ MAX_EXECUTION_TIME(5000) */`. Query bị cắt → ghi `MISSING` cho cột đó, không retry.
- Cột bị bỏ vì trần → ghi vào `note` ("bỏ N cột do trần") để report không đọc nhầm là "đã soi hết".

## Query

```sql
SELECT TABLE_NAME, TABLE_ROWS, ROUND(DATA_LENGTH/1048576,1) data_mb, ROUND(INDEX_LENGTH/1048576,1) index_mb
FROM information_schema.TABLES WHERE TABLE_SCHEMA='OMH_SUITE' AND TABLE_NAME IN (<input.tables>);

-- mỗi cột được chọn (full):
SELECT /*+ MAX_EXECUTION_TIME(5000) */ <col>, COUNT(*) cnt FROM <table> GROUP BY <col> ORDER BY cnt DESC LIMIT 5;
SELECT /*+ MAX_EXECUTION_TIME(5000) */ COUNT(DISTINCT <col>) ndv FROM <table>;
-- bảng lớn (mẫu):
SELECT <col>, COUNT(*) cnt FROM (SELECT <col> FROM <table> ORDER BY <PK> LIMIT 500000) s GROUP BY <col> ORDER BY cnt DESC LIMIT 5;

-- histogram nếu DBA đã tạo (worker KHÔNG chạy ANALYZE TABLE):
SELECT COLUMN_NAME, HISTOGRAM FROM information_schema.COLUMN_STATISTICS
WHERE SCHEMA_NAME='OMH_SUITE' AND TABLE_NAME='<table>' AND COLUMN_NAME='<col>';
```

**PII:** cột tên khớp `/(EMAIL|PHONE|MOBILE|NAME|PASSPORT|CARD|ADDR|BIRTH|TOKEN|PASSWORD)/i` hoặc `gather.schema[].columns[].comment` chứa "PII" → ghi `top_value: "<redacted>"`, chỉ giữ `ndv`/`top_pct`. (Merge script cũng redact lần 2, nhưng đừng để giá trị thật đi qua response.)

## Output — file delta `<dir>/deltas/<iteration>-gather-distribution.json`

```json
{ "by": "gather-distribution", "phase": "GATHER", "status": "OK|PARTIAL",
  "writes": {
    "gather.distribution": [{ "table": "..", "column": "..", "origin": "predicate|index|both", "table_rows": 0,
                              "ndv": 0, "top_value": "..", "top_pct": 0, "skew": false,
                              "estimated_on_sample": false, "suggest_typical": null }],
    "gather.completeness": [{ "group": 5, "status": "OK|MISSING", "source": "information_schema+GROUP BY", "reason": null }],
    "gather.missing": []
  },
  "decision_log": { "event": "profiled N cột / M bảng, bỏ K cột do trần", "rationale": ".." } }
```

`suggest_typical`: khi `skew=true` và cột là predicate → giá trị KHÔNG phải top (vd top-5 cuối) để `sqlopt-gather-explain` chạy thêm bộ `typical`. Trả về orchestrator duy nhất `{status, keys_written, summary≤3 dòng}`.
