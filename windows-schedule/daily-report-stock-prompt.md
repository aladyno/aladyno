Hôm nay là ngày {{DATE}}.

# NHIỆM VỤ (orchestrator)
Bạn là lớp điều phối cho job "daily uptrend scan". Việc thực thi giao **toàn bộ** cho agent
`vn-uptrend-scanner` (project-local, .claude/agents) — đây là agent tự chủ đã đóng gói: quét 2 tuần dữ liệu
giá-volume HOSE + HNX, lọc mã VỪA BƯỚC VÀO nhịp uptrend mạnh (breakout + volume + MA20>MA50 +
RS dẫn dắt + smart money gom), tự dựng HTML, tự lưu file và tự gửi email.

# CÁCH CHẠY
Spawn subagent `vn-uptrend-scanner` (qua tool Task/Agent, subagent_type chính xác là
`vn-uptrend-scanner`) với chỉ thị:

> Chạy daily uptrend scan cho hôm nay {{DATE}}.
> Sàn: HOSE + HNX (KHÔNG UPCOM). Cửa sổ quét: 2 tuần gần nhất (~10 phiên).
> Theo luồng top-down của agent: (1) market regime → (1B) dự báo kinh tế vĩ mô → nhóm ngành KHẢ QUAN quý tới →
>   (2B) danh sách mã TIỀM NĂNG tăng mạnh 1 tháng tới → (3-5) xác nhận kỹ thuật chốt TOP 5.
> Bắt buộc GHI RÕ trong report cả mục dự báo ngành quý tới (#view-macro) và mục mã tiềm năng 1 tháng (#view-potential).
> Tìm các mã VỪA khởi phát uptrend mạnh (đầu sóng, chưa tăng nóng) theo bộ tiêu chí A–E của agent.
> Trả TOP 5 kèm Entry/Stop/Target tuyệt đối, R:R ≥ 2:1 và URL nguồn verify cho mỗi tiêu chí.
> Dựng email HTML theo template windows-schedule\msg_daily_report.html (fill tĩnh, không JS — xem §6.2 của agent),
> GỬI tới dung.dt@ohmyhotel.com với
>   subject "Uptrend scan {{DATE}} — HOSE+HNX (<N> mã)",
> rồi lưu bản dashboard đẹp (template windows-schedule\msg_daily_report_dashboard.html, cùng nội dung)
> vào windows-schedule\reports\uptrend-scan-{{DATE}}.html.
> Tuyệt đối không bịa số — số không tra được ghi "N/A — cần xác minh". Vẫn gửi email kể cả khi thiếu data.

# SAU KHI AGENT XONG
In lại tóm tắt ngắn: market regime, TOP 5 mã + điểm, và xác nhận đã gửi email + đường dẫn file đã lưu.
Nếu agent báo `⚠️ Giới hạn dữ liệu`, nêu rõ phần nào thiếu để user bổ sung thủ công.

# GHI CHÚ
- Deep-dive 1 mã trước khi xuống tiền: gợi ý user chạy agent `vn-equity-analyst` / skill `stock-analyze`.
- Bối cảnh tin tức/sự kiện 1 mã: agent `vn-market-news` / skill `stock-news`.
