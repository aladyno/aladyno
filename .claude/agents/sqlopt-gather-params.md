---
name: sqlopt-gather-params
description: Worker GATHER đợt 1 của pipeline ag-sql-optimize — tìm tham số thật đang chạy cho câu SQL (Nhóm 6) từ performance_schema (chỉ SELECT qua execute_sql) hoặc dùng tham số user cung cấp. Ghi gather.params (hot/typical/source), mask PII. Chỉ được spawn bởi ag-sql-optimize; ghi 1 file delta.
tools: [Read, Write, Bash, mcp__MCP_DOCKER__execute_sql]
---

# sqlopt-gather-params — Nhóm 6 (tham số thật)

Chỉ có `execute_sql` (read-only SELECT). Không EXPLAIN, không ghi.

## Input

`dir`, `iteration`. Đọc slice:

```bash
node "C:\Users\Daniel-Do\Workspace\Github\aladyno\.claude\agents\sqlopt-tools\merge-deltas.mjs" "<dir>" --slice input.sql_normalized,input.tables,input.user_params
```

## Việc

1. `input.user_params` có → `gather.params = {hot: user_params, typical: null, source: "user-provided"}`, xong.
2. Không có → `performance_schema.events_statements_history_long` (chỉ khi bật; lỗi/rỗng → bước 3):
   ```sql
   SELECT SQL_TEXT, TIMER_WAIT/1000000000 AS ms, EVENT_ID
   FROM performance_schema.events_statements_history_long
   WHERE SQL_TEXT LIKE '%<bảng chính>%' AND SQL_TEXT LIKE '%<cột đặc trưng>%'
   ORDER BY EVENT_ID DESC LIMIT 10;
   ```
   Trích literal của từng predicate → `hot`. Nếu ≥2 giá trị khác nhau xuất hiện → giá trị phổ biến nhất = `hot`, giá trị khác = `typical`. `source="history_long"`.
3. Vẫn không có → suy luận giá trị "điển hình" từ kiểu cột, `source="inferred"`, `note="cần user xác nhận"`.

**Mask PII trước khi ghi** (bắt buộc): `raw_samples` chỉ lưu SQL đã thay mọi literal bằng `?`; giá trị tham số của cột tên khớp `/(EMAIL|PHONE|MOBILE|NAME|PASSPORT|CARD|ADDR|BIRTH|TOKEN|PASSWORD)/i` giữ 2 ký tự đầu + `***` trong `hot`/`typical` — và ghi `pii_masked: true` để `sqlopt-gather-explain` biết phải hỏi orchestrator/user giá trị thật khi cần chạy EXPLAIN (không lưu vào blackboard).

## Output — file delta `<dir>/deltas/<iteration>-gather-params.json`

```json
{ "by": "gather-params", "phase": "GATHER", "status": "OK|PARTIAL",
  "writes": {
    "gather.params": { "hot": {}, "typical": {}, "source": "user-provided|history_long|inferred",
                       "pii_masked": false, "raw_samples": ["SELECT ... WHERE HOTEL_CODE=? ..."], "note": ".." },
    "gather.completeness": [{ "group": 6, "status": "OK|MISSING", "source": "..", "reason": null }],
    "gather.missing": []
  },
  "decision_log": { "event": "params từ <source>", "rationale": ".." } }
```

Trả về orchestrator duy nhất `{status, keys_written, summary≤3 dòng}`. Không ghi `input.*` (orchestrator độc quyền), không ghi `blackboard.json`.
