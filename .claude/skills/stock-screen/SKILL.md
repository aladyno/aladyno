---
name: stock-screen
description: Lọc/screen cổ phiếu Việt Nam (HOSE/HNX/UPCOM) theo tiêu chí định lượng (growth / value / momentum / small-cap / dòng tiền) và trả về TOP danh sách kèm điểm + URL nguồn. Trigger khi user nói "screen cổ phiếu", "lọc mã ...", "tìm cổ phiếu growth/value/small-cap", "tìm mã có tiền vào", "tìm mã x2 x3", "quét HOSE/HNX theo tiêu chí", hoặc paste bộ tiêu chí lọc. Output song ngữ Việt-Anh.
---

# stock-screen — Quét & lọc cổ phiếu VN

Skill này là **entry point** cho việc screening thị trường VN. Nó định nghĩa **khi nào** chạy và **output user nhận được**; phần quét sâu giao cho agent `vn-equity-screener`.

## Khi nào dùng
User muốn **một danh sách** mã thỏa tiêu chí (không phải phân tích 1 mã cụ thể — cái đó dùng `stock-analyze`).

## Quy trình

1. **Xác định bộ tiêu chí**. Hỏi lại nếu user chưa nêu rõ preset hoặc ngưỡng. Preset hỗ trợ: `growth`, `value`, `momentum`, `smallcap`, `cashflow` (xem mô tả trong agent). Default = `growth` small-cap.
2. **Spawn agent `vn-equity-screener`** với bộ tiêu chí + N (default 5).
   - 1 rổ tiêu chí → spawn 1 agent.
   - Nhiều rổ / nhiều ngành cần quét song song → spawn **nhiều agent cùng lúc** rồi tổng hợp.
3. **Trả kết quả** theo đúng output contract của agent (bảng TOP N + chi tiết từng mã + danh sách đã loại).

## Guardrail (bắt buộc)
- Screener chỉ ra **candidate**, **không phải khuyến nghị mua**. Nói rõ điều này ở cuối.
- Mọi số liệu phải có **URL nguồn**. Thiếu `WebSearch`/`WebFetch` → báo và dừng, không bịa.
- Nếu thiếu mã thỏa, trả số thực — **không nới tiêu chí cho đủ số**.
- Gợi ý bước tiếp: "Chạy `stock-analyze <mã>` để phân tích sâu trước khi vào lệnh."

## Output
Tiếng Việt là chính, giữ ticker + thuật ngữ + tên nguồn tiếng Anh.
