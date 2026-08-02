---
name: stock-dd
description: Due-diligence ĐẦY ĐỦ cho 1 mã cổ phiếu Việt Nam (HOSE/HNX/UPCOM) — chạy song song cả 4 mảng (tin tức, smart money/kỹ thuật, định giá) rồi tổng hợp thành 1 báo cáo đầu tư có verdict, stoploss/target và biên an toàn. Trigger khi user nói "due diligence <mã>", "soi toàn diện <X>", "phân tích đầy đủ <mã>", "DD <mã>", "báo cáo đầu tư <X>", "research <mã> A-Z". Output song ngữ Việt-Anh.
---

# stock-dd — Due-diligence đầy đủ (multi-agent)

Skill "showcase" — chạy **fan-out song song** cả 4 agent specialist cho **1 ticker**, rồi tổng hợp thành **1 báo cáo đầu tư** thống nhất. Dùng khi user muốn bức tranh toàn diện trước khi xuống tiền.

## Khi nào dùng
User muốn **toàn diện** 1 mã (không chỉ 1 khía cạnh). Một khía cạnh đơn lẻ → dùng skill chuyên biệt tương ứng.

## Quy trình (fan-out → synthesize)

1. **Xác nhận ticker** (tên DN + sàn).
2. **Spawn song song trong 1 message** (run_in_background) cả 4 agent với cùng ticker:
   - `vn-market-news` — tin & sự kiện 24h
   - `vn-equity-analyst` — smart money + kỹ thuật + 2 kịch bản
   - `vn-valuation-analyst` — định giá + biên an toàn
   - (tùy chọn) `vn-equity-screener` — chấm mã so với peer cùng ngành
3. **Chờ cả 4 trả kết quả**, rồi **tổng hợp** thành báo cáo:

```
# 🧭 DUE DILIGENCE: <TICKER> (<sàn>) — <ngày>

## ⚡ Kết luận đầu tư: MUA / CHỜ / TRÁNH | Conviction: <thấp/TB/cao>
> 2–3 câu chốt VI + 1 dòng EN thesis.

## 1. Tin tức & sự kiện      (từ vn-market-news)
## 2. Smart money & kỹ thuật (từ vn-equity-analyst)
## 3. Định giá & biên an toàn (từ vn-valuation-analyst)
## 4. Vị thế so ngành         (từ vn-equity-screener, nếu có)

## 🎯 Kế hoạch (nếu MUA)
- Entry / Stoploss (giá tuyệt đối) / Target 1-2 / Reward:Risk / Position size

## ⚖️ Bull vs Bear (tóm tắt)
## ⚠️ Rủi ro chính & Giới hạn dữ liệu
```

## Guardrail (bắt buộc)
- **Capital preservation first**: MUA chỉ khi reward:risk ≥ 2:1 và stoploss bound được.
- Nếu **các agent mâu thuẫn** (vd định giá rẻ nhưng tin xấu + dòng tiền ra) → nêu rõ xung đột, hạ conviction, **không che giấu**.
- Mọi số liệu giữ URL nguồn từ agent con. Agent nào thiếu data → ghi rõ trong báo cáo.
- Đây là hỗ trợ nghiên cứu, **không phải khuyến nghị đầu tư** — nhắc ở cuối.

## Output
Tiếng Việt là chính, giữ ticker + thuật ngữ + tên nguồn tiếng Anh.
