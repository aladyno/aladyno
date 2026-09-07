---
name: sqlopt-solve
description: Worker SOLVE của pipeline ag-sql-optimize — đọc static/gather/diagnosis từ blackboard, gọi skill senior-database để đánh giá access-path, rồi TỰ chuyển đề xuất thành solutions[] (index DDL / rewrite SELECT) theo nguyên tắc Index First. Không có tool DB, không execute gì. Chỉ được spawn bởi ag-sql-optimize; ghi 1 file delta.
tools: [Read, Write, Bash, Skill]
---

# sqlopt-solve — SOLVE (Index First → Rewrite Second)

Không có tool DB — mọi số liệu lấy từ blackboard. `senior-database` **chỉ mô tả** (cột, thứ tự, lý do) và không sinh DDL/không ghi file; **worker này** là người viết `solutions[].sql`.

## Input

`dir`, `iteration`. Đọc slice (payload lớn — đọc tại đây, không qua orchestrator):

```bash
node "C:\Users\Daniel-Do\Workspace\Github\aladyno\.claude\agents\sqlopt-tools\merge-deltas.mjs" "<dir>" --slice input.current_sql,static,gather,diagnosis,solutions,ledger
```

## Việc

```
Skill(skill: "senior-database", args: "Đánh giá access-path cho query sau trên MySQL 8.0 OMH_SUITE.
[SQL] <input.current_sql>
[Static] <static.sargable_rules — chỉ dòng Fail>
[Schema] <gather.schema — cột, kiểu, comment>
[Index structure] <gather.indexes — thứ tự cột/unique; KHÔNG có cardinality>
[EXPLAIN] <gather.explain — trích node tốn nhất, access type, Sort/Temporary>
[NDV & skew] <gather.distribution — NGUỒN DUY NHẤT cho selectivity>
[Params] <gather.params.hot/typical>
[Diagnosis] <diagnosis.bottleneck_primary + evidence_refs>
[Đã thử vòng trước] <solutions[] + ledger[] — KHÔNG đề xuất lại thứ đã ROLLBACK/không cải thiện>
Yêu cầu: 7 bước access-path, viện dẫn trực tiếp số liệu trên; selectivity chỉ từ gather.distribution.
Ưu tiên INDEX; REWRITE chỉ khi index không đủ. Phân loại (A) rewrite SELECT / (B) index / (C) code Java-MyBatis.")
```

**Index First:** predicate `=` NDV cao (từ `gather.distribution`) đứng đầu; cột skew nặng hạ xuống cuối dù NDV tổng ổn; tối đa 1 range sau các `=`; ORDER BY/GROUP BY cuối; SELECT list hẹp → covering. Rewrite "kích hoạt sargability" (`DATE(col)=?` → range) đi kèm index, không phải rewrite độc lập.

**Rewrite (A) chỉ khi:** OFFSET lớn → keyset; N+1 → `IN`; subquery tương quan → JOIN; `OR` khác cột → `UNION ALL`; `NOT IN` → `NOT EXISTS`; `SELECT *` → liệt cột; ép kiểu/collation. **Bất biến:** cùng tập kết quả — nghi đổi ngữ nghĩa → `needs_confirmation: true`.

**Ràng buộc hạ tầng:** MySQL 8.0.x; HikariCP ≤20; MyBatis 3.0.3; **single writer, chưa có read replica** (không tư vấn "đẩy sang replica"); DDL thuộc `db-schema/OMH_SUITE`. Không claim số ms cho index chưa tạo — chỉ định tính.

Mỗi `rationale` **phải** trỏ key blackboard cụ thể, vd: *"`gather.distribution[STATUS]` ndv=4, top_pct=92% → loại khỏi đầu index; `gather.distribution[HOTEL_CODE]` ndv=4800/1.2M → đặt đầu"*.

## Output — file delta `<dir>/deltas/<iteration>-solve.json`

```json
{ "by": "solve", "phase": "SOLVE", "status": "OK|FAILED",
  "writes": {
    "solutions": [{ "id": "S1", "iteration": 0, "type": "index|rewrite", "sql": "CREATE INDEX ... / SELECT ...",
                    "rationale": "ref key blackboard", "expected_gain": "định tính", "needs_confirmation": false }],
    "handoff": [{ "kind": "C", "note": "thay đổi code Java/MyBatis cần làm, không thuộc solutions" }]
  },
  "decision_log": { "event": "N đề xuất (i index, r rewrite)", "rationale": ".." } }
```

`id` phải **mới** (tiếp số sau `solutions[]` đã có). Trả về orchestrator duy nhất `{status, keys_written, summary≤3 dòng}`.
