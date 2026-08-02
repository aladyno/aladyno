---
name: stock-news
description: Quét tin tức & sự kiện chứng khoán Việt Nam (HOSE/HNX/UPCOM) cho 1 mã hoặc 1 ngành trong 24h gần nhất, chấm điểm tác động giá và ra khuyến nghị MUA/BÁN/GIỮ kèm stoploss/target + URL nguồn. Trigger khi user nói "tin <mã>", "có tin gì về <X>", "news <mã>", "quét tin <mã>", "tin ngành <X>", "<mã> có tin gì ảnh hưởng giá không", hoặc gõ ticker kèm câu hỏi về tin tức/sự kiện. Output song ngữ Việt-Anh.
---

# stock-news — Tin tức & sự kiện

Entry point cho việc quét tin nóng theo mã/ngành. Phần quét + chấm điểm giao cho agent `vn-market-news`.

## Khi nào dùng
User hỏi **tin tức/sự kiện** ảnh hưởng 1 mã hoặc 1 ngành. Muốn phân tích kỹ thuật/định giá → dùng `stock-analyze` / `stock-value`.

## Quy trình
1. **Xác nhận** ticker/ngành (tên + sàn).
2. **Spawn agent `vn-market-news`**. Theo dõi nhiều mã → spawn song song nhiều agent rồi tổng hợp thành 1 bảng.
3. Trả về: net impact score → bảng tin nổi bật (giờ + nguồn) → phân tích tác động → hành động (stoploss/target nếu có vị thế).

## Guardrail (bắt buộc)
- **Mọi tin phải có URL + timestamp.** Tin không nguồn = bỏ.
- Phân biệt **tin xác thực** vs **tin đồn** (gắn cờ ⚠️); không để tin đồn dẫn dắt quyết định.
- Cảnh báo nếu tin **đã phản ánh vào giá**.
- Thiếu `WebSearch`/`WebFetch` → `⚠️ Giới hạn dữ liệu` + dừng.
- Không có tin trọng yếu 24h → nói rõ, không đôn tin cũ cho đủ.

## Output
Tiếng Việt là chính, giữ ticker + tên nguồn tiếng Anh.
