---
name: stock-value
description: Định giá & mô hình tài chính cổ phiếu Việt Nam (HOSE/HNX/UPCOM) — đọc BCTC, định giá tương đối (P/E, P/B, EV/EBITDA) so peer, định giá tuyệt đối (DCF/FCFE, RIM, DDM), ra khoảng fair value + biên an toàn (margin of safety). Trigger khi user nói "định giá <mã>", "fair value <X>", "<mã> đắt hay rẻ", "P/E <X> hợp lý không", "DCF <mã>", "so sánh định giá <X> với ngành", "đọc BCTC <mã>". Output song ngữ Việt-Anh.
---

# stock-value — Định giá & mô hình tài chính

Entry point cho định giá doanh nghiệp VN. Phần dựng mô hình giao cho agent `vn-valuation-analyst`.

## Khi nào dùng
User muốn biết **giá trị nội tại / đắt-rẻ / fair value** của 1 mã, hoặc so sánh định giá với peer. Muốn quyết định giao dịch (entry/stoploss) → kết hợp `stock-analyze`.

## Quy trình
1. **Xác nhận** ticker + ngành (để chọn mô hình & peer phù hợp: DCF cho DN sản xuất, RIM cho ngân hàng, DDM cho DN cổ tức ổn định).
2. **Spawn agent `vn-valuation-analyst`**. So sánh comps nhiều mã → spawn song song.
3. Trả về: sức khỏe tài chính → định giá tương đối (comps) → định giá tuyệt đối (có sensitivity) → fair value range + biên an toàn → giả định & giới hạn.

## Guardrail (bắt buộc)
- **Tách fact (có nguồn BCTC) vs assumption (g, WACC, growth — hiện rõ).**
- Luôn đưa **range**, không 1 con số giả-chính-xác.
- Cảnh báo lợi nhuận méo bởi **one-off / đánh giá lại tài sản**.
- BCTC mới chưa có → dùng TTM cũ + `(stale)`.
- Thiếu `WebSearch`/`WebFetch` → `⚠️ Giới hạn dữ liệu` + dừng. Không bịa số.

## Output
Tiếng Việt là chính, giữ thuật ngữ định giá + tên chỉ số tiếng Anh.
