# LoL Spell Timer — Bộ Đếm Hồi Chiêu Thủ Công LMHT

Công cụ desktop độc lập viết bằng **Tauri v2 (Rust + React + TypeScript + Tailwind CSS)** giúp người chơi tự bấm đếm ngược thời gian hồi Phép Bổ Trợ (`D` / `F`) và Chiêu Cuối (`R`) của 5 tướng địch trong chế độ màn hình **Không viền (Borderless)** — **tuyệt đối không can thiệp bộ nhớ game, không tiêm DLL, không hook DirectX, không giả lập gõ phím**.

## Tính năng chính

- **Đọc dữ liệu công khai 1 chiều:** Lấy danh sách 5 tướng địch, cấp độ, phép bổ trợ và trang bị lộ tầm nhìn qua Live Client Data API (`https://127.0.0.1:2999/liveclientdata/allgamedata`) kết hợp dữ liệu từ Riot DataDragon.
- **Tự tính hồi chiêu theo Điểm Hồi Kỹ Năng:** Tự trừ giây hồi theo cấp Chiêu cuối (`6 / 11 / 16`), đồ Điểm Hồi Kỹ Năng, Giày Khai Sáng Ionia (`+10`) và nút bật nhanh ngọc Thấu Thị Vũ Trụ (`⚡ +18`).
- **Thao tác không mất tiêu điểm game (`WS_EX_NOACTIVATE`):**
  - **Click Chuột Trái:** Bắt đầu đếm ngược (click tiếp lúc đang đếm để trừ ngay **-5s** bù độ trễ).
  - **Click Chuột Phải:** Reset ngay về Sẵn sàng.
  - **Nút `Copy`:** Chép mốc giờ hồi theo đồng hồ trận đấu (`MM:SS`) vào Clipboard.
- **Tùy biến giao diện gọn nhẹ:** Đổi nhanh **Thanh Dọc ↔ Thanh Ngang**, chỉnh độ trong suốt, thu gọn thành thanh nhỏ, nháy viền cảnh báo khi còn `<= 10s`, và **Chế độ Xem Thử** ngoài trận để căn vị trí trước.

## Cách build từ mã nguồn (Windows)

```powershell
# 1. Nạp biến môi trường công cụ biên dịch (ổ D:)
. .\dev-env.ps1

# 2. Cài đặt dependencies & build giao diện
npm install
npm run build

# 3. Chạy kiểm thử Rust & biên dịch bản Release
cd src-tauri
cargo test
cargo build --release
```
