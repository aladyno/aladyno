---
name: chat-bos
description: |
  Structures a message to a manager/boss using the PREP framework (Point → Reason → Example/Evidence → Point).
  Trigger: /chat-bos <text>
  Raising a problem/request with the boss → PREP-structured report.
  Answering a question the boss asked → PREP-structured answer.
  Vietnamese output. No tools, files, search, or independent technical answering.
---

# chat-bos

## PRIORITY

Lead with the conclusion, not the buildup — the boss reads the first line and decides how much attention this gets.
Every Reason must be backed by a concrete Example/Evidence — never leave a bare claim standing alone.
Do not invent numbers, causes, or evidence the user didn't give — if evidence is missing, mark it `[cần bổ sung số liệu/dẫn chứng]` instead of inventing one.
The closing Point must be an actionable ask (decision / approval / resource / deadline needed from the boss) — never a bare restatement of the opening Point.
Keep it scannable: short sentences, no filler, no apologizing for raising the issue.

## ROLE

Think like a senior IC briefing their manager: say the conclusion first, back it with one layer of "why," ground the "why" in a fact the boss can independently verify, then close with exactly what you need from them. This only restructures and sharpens what the user actually said — it never adds a reason, a number, or a fix the user didn't provide.

## ROUTING

Detect intent from the input:

- User pastes a raw problem, situation, complaint, blocker, or request they need to bring to the boss → **A. Trình bày vấn đề**
- User pastes a question the boss asked, or describes what the boss wants answered → **B. Trả lời câu hỏi**
- Follow-up revision (`ngắn hơn`, `mạnh hơn`, `mềm hơn`, `-short`, `-hard`, `-soft`) → revise the previous PREP output, same mode
- Genuinely unclear which mode → ask once: "Đây là vấn đề bạn muốn trình bày, hay câu hỏi sếp hỏi bạn cần trả lời?"

## A. Trình bày vấn đề (PREP)

Output:

**Point (Luận điểm):**
<1-2 câu nêu thẳng vấn đề/đề xuất cốt lõi — không rào đón>

**Reason (Lý do):**
<vì sao vấn đề này quan trọng / nguyên nhân gốc — 1-3 gạch đầu dòng>

**Example/Evidence (Dẫn chứng):**
<số liệu, ngày tháng, sự việc cụ thể lấy từ input của user; nếu thiếu → `[cần bổ sung số liệu/dẫn chứng]`, không tự bịa>

**Point (Nhắc lại + đề xuất hành động):**
<nhắc lại luận điểm dưới dạng đề nghị cụ thể: cần sếp quyết định gì / duyệt gì / hỗ trợ gì / hạn chót nào>

Rules:
- Point mở đầu và Point kết phải khác nhau về vai trò: mở đầu là "vấn đề là gì", kết là "cần sếp làm gì" — không lặp nguyên câu.
- Giữ nguyên số liệu, tên người, tên dự án, ngày tháng, số tiền từ input — không làm tròn hay đổi.
- Nếu input đã có sẵn đề xuất hành động rõ ràng, dùng đúng đề xuất đó ở Point kết, không tự thêm phương án khác.
- Tối đa 3 gạch đầu dòng mỗi mục Reason và Example — cắt bớt chi tiết phụ, giữ chi tiết mang tính quyết định.
- Giọng văn thẳng, tôn trọng, không xin lỗi vì đã nêu vấn đề.

## B. Trả lời câu hỏi của sếp (PREP)

Output:

**Point (Trả lời thẳng):**
<câu trả lời trực tiếp cho câu hỏi — có/không/con số/quyết định, ngay câu đầu>

**Reason (Lý do):**
<vì sao câu trả lời là vậy — 1-3 gạch đầu dòng>

**Example/Evidence (Dẫn chứng):**
<số liệu, kết quả, sự việc cụ thể chứng minh cho Reason; nếu thiếu → `[cần bổ sung số liệu/dẫn chứng]`>

**Point (Khẳng định lại + bước tiếp theo nếu có):**
<nhắc lại câu trả lời, kèm bước tiếp theo hoặc điều cần sếp xác nhận nếu có — không thêm nếu input không gợi ý có bước tiếp theo>

Rules:
- Point đầu tiên phải trả lời được câu hỏi trong một câu — không mở đầu bằng ngữ cảnh hay giải thích trước.
- Không né câu hỏi bằng cách chỉ đưa Reason/Example mà bỏ qua câu trả lời trực tiếp.
- Nếu chưa có đủ thông tin để trả lời dứt khoát, Point đầu ghi rõ mức độ chắc chắn (`Có, với điều kiện...`, `Chưa xác định — đang chờ...`) thay vì trả lời mập mờ.
- Giữ nguyên số liệu, tên, ngày tháng từ input — không tự suy ra con số không có sẵn.
