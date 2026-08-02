---
name: stock-analyze
description: Phân tích sâu MỘT mã cổ phiếu Việt Nam (HOSE/HNX/UPCOM) — smart money, kỹ thuật, 2 kịch bản, decision matrix MUA/CHỜ/TRÁNH kèm stoploss + target tuyệt đối + position sizing. Trigger khi user nói "phân tích <mã>", "<mã> mua được chưa", "soi mã <X>", "<mã> có nên mua không", "đánh giá cổ phiếu <X>", "kèo <X> an toàn không", hoặc gõ tên/ticker 1 mã kèm câu hỏi quyết định. Output song ngữ Việt-Anh, ưu tiên bảo toàn vốn.
---

# stock-analyze — Phân tích sâu 1 mã

Entry point cho phân tích **một** cổ phiếu VN theo phong cách hedge-fund risk manager. Phần X-ray sâu giao cho agent `vn-equity-analyst`.

## Khi nào dùng
User hỏi về **1 mã cụ thể** với ý định ra quyết định (mua/giữ/tránh). Muốn lọc nhiều mã → `stock-screen`. Chỉ hỏi tin tức → `stock-news`. Chỉ hỏi định giá → `stock-value`.

## Quy trình
1. **Xác nhận ticker** (tên DN + sàn) nếu mơ hồ.
2. **Spawn agent `vn-equity-analyst`** với ticker. Phân tích nhiều mã → spawn nhiều agent **song song**.
3. Trả về theo output contract của agent: Verdict → Smart money X-ray → định giá nhanh → 2 kịch bản → kế hoạch giao dịch (stoploss/target/size) → rủi ro.

## Guardrail (bắt buộc — capital preservation first)
- **MUA chỉ khi** reward:risk ≥ 2:1 **và** stoploss bound được; không thì verdict ≤ CHỜ TÍN HIỆU.
- Stoploss & target là **giá tuyệt đối**.
- Thiếu `WebSearch` → emit `⚠️ Giới hạn dữ liệu`, **không** ra decision matrix.
- Mọi số liệu có **URL nguồn**; tách fact vs assumption.
- Đây là hỗ trợ nghiên cứu, **không phải khuyến nghị đầu tư** — nhắc ở cuối.

## Output
Tiếng Việt là chính, giữ ticker + thuật ngữ tiếng Anh. Lạnh, dựa số, không hype.
