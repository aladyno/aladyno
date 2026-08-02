# Worked example — degraded-data path (`aladyn-stx XYZ`)

This example shows what to do when WebSearch returns insufficient or stale data, or when the tool is unavailable. The skill must NOT fabricate price levels to fill gaps. It must downgrade the response, refuse to issue a decision matrix, and tell the user clearly.

User invocation:

```
aladyn-stx XYZ
```

Where `XYZ` is a low-liquidity ticker for which:
- WebSearch returns one news article from 12 days ago.
- No reliable current price/volume snapshot.
- VN-Index macro context found, but sector data missing.

Expected response:

---

📡 XYZ — PHÂN TÍCH SMART MONEY

📊 DỮ LIỆU THU THẬP

⚠️ **Giới hạn dữ liệu**

**Bảng nguồn (incomplete)**

```
[S1] cafef.vn — KHÔNG có snapshot giá/khối lượng trong 3 ngày gần nhất
[S2] vietstock.vn — KHÔNG có dữ liệu khối ngoại cập nhật
[S3] doanhnghiepvn.vn — 1 bài news cách đây 12 ngày (đã stale)
[S4] vneconomy.vn — VN-Index sideways 1.225–1.245 (đủ điều kiện dùng)
[S5] (thiếu) — không tìm được performance ngành cập nhật
```

- **Giá & khối lượng hiện tại**: KHÔNG tìm thấy snapshot trong vòng 3 ngày gần nhất [S1][S2].
- **Tin tức**: Chỉ có 1 bài cách đây 12 ngày — đã quá cũ để dùng làm catalyst [S3].
- **VN-Index**: Có dữ liệu — VN-Index dao động sideways 1.225–1.245 [S4].
- **Ngành**: Không tìm được performance ngành cập nhật [S5 thiếu].

🔬 X-QUANG DÒNG TIỀN

Không có đủ dữ liệu để X-quang dòng tiền. Mọi nhận định về "động lực cốt lõi" hay "bẫy" sẽ là phỏng đoán, vi phạm Rule 4 (No Fabricated Data) và Rule 1 (Zero Noise).

🎯 PHÂN TÍCH KỊCH BẢN

KHÔNG dựng kịch bản khi thiếu giá và khối lượng hiện tại [S1][S2]. Bất kỳ "kịch bản tích cực/tiêu cực" nào ở đây đều là cờ bạc dán nhãn phân tích.

⚡ MA TRẬN HÀNH ĐỘNG

**A. Mở vị thế mới**: KHÔNG ĐỦ DỮ LIỆU ĐỂ RA QUYẾT ĐỊNH.
- Hành động đề xuất: KHÔNG mua. Đợi dữ liệu giá/khối lượng cập nhật trong 3 ngày gần nhất.
- Nếu vẫn muốn vào lệnh, đó là quyết định cá nhân, không có cơ sở phân tích — và skill này từ chối cấp stoploss/position size cho một thiết lập không kiểm tra được.

**B. Đang nắm giữ**: KHÔNG ĐỦ DỮ LIỆU.
- Khuyến nghị tạm thời: giữ stoploss hiện tại (nếu có). Không nâng vị thế. Không trung bình giá.
- Hành động bắt buộc của user: cung cấp giá hiện tại + khối lượng 5 phiên gần nhất, hoặc thử lại invocation sau khi WebSearch cập nhật, để skill có thể chạy lại Step 0.

⚠️ TUYÊN BỐ MIỄN TRỪ TRÁCH NHIỆM

> *"Phân tích này chỉ mang tính tham khảo thông tin, không phải lời khuyên đầu tư chính thức. Mọi quyết định giao dịch đều tiềm ẩn rủi ro thua lỗ. Nhà đầu tư tự chịu trách nhiệm với vốn của mình."*

---

## Why this pattern matters

Refusing to issue a decision matrix when data is insufficient is the single most important behavior of this skill. A confident MUA call built on a 12-day-old article is worse than no call at all — it converts user trust into capital loss.

When in doubt, the verdict is always "đợi dữ liệu" or "CHỜ TÍN HIỆU". Never invent a stoploss to make the response look complete.
