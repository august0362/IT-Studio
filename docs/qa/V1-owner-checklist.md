# IT Studio v1 — Checklist nghiệm thu cho chủ sản phẩm

> Trạng thái: **BẢN NHÁP**. Khi chạy V1-QA, tôi sẽ điền mã hash bản build, đường dẫn bộ cài và kết quả test tự động vào mục 0. Làm xong bước nào thì đánh dấu ☑ ở bước đó. Nếu thấy gì sai, ghi vào cột *Ghi chú*.

## 0. Trước khi bắt đầu

- Bản build cần kiểm tra: `<V1-QA điền: tên file bộ cài, SHA-256, commit>`
- Kết quả test tự động của bản này: `<V1-QA điền: số test unit / integration / E2E / smoke>`
- Cần chuẩn bị: ít nhất **hai** API key của hai nhà cung cấp khác nhau (ví dụ OpenAI + Anthropic hoặc Google), một thư mục trống để làm workspace thử, khoảng 45 phút.
- Báo lỗi theo mẫu: *mục · bước · bạn đã làm gì · mong đợi gì · thực tế ra sao* (kèm ảnh chụp nếu có).
- Mức độ lỗi:
  - **S1**: mất dữ liệu, app crash hoặc lộ key
  - **S2**: tính năng hỏng
  - **S3**: sai nhưng vẫn dùng được
  - **S4**: lỗi hiển thị

## 1. Cài đặt và khởi động

| ✓ | Bước | Kết quả mong đợi | Ghi chú |
|---|---|---|---|
| ☐ | Chạy bộ cài NSIS (nếu SmartScreen cảnh báo thì chọn More info → Run anyway) | Cài xong, có mục "IT Studio" trong Start menu | |
| ☐ | Mở app | Thanh trạng thái chuyển *Connecting…* → *Ready* trong khoảng 3 giây, không có banner đỏ | |
| ☐ | Đóng app rồi mở lại | Project và cài đặt vẫn như cũ, lại lên *Ready* | |

## 2. API key và router

| ✓ | Bước | Kết quả mong đợi | Ghi chú |
|---|---|---|---|
| ☐ | Settings → API Keys: dán một key **sai** → Verify & save | Bị từ chối, có thông báo rõ ràng, không lưu gì | |
| ☐ | Dán key thật → Verify & save | Lưu thành công, chỉ hiện 4 ký tự cuối | |
| ☐ | Settings → Router: tắt Auto Fallback, rồi chat với model chưa có key | App hỏi bạn muốn làm gì (dùng model khác / thử lại / huỷ) | |

## 3. Project và Chat

| ✓ | Bước | Kết quả mong đợi | Ghi chú |
|---|---|---|---|
| ☐ | Bấm + để tạo project với thư mục thử | Xuất hiện tab project mới | |
| ☐ | Chat → New chat → Auto → gõ "xin chào" | Câu trả lời hiện dần, có chi phí bằng USD và VND | |
| ☐ | Tạo project thứ hai, chuyển qua lại giữa hai project thật nhanh | Mỗi project chỉ hiện hội thoại của chính nó, không bao giờ gửi nhầm tin sang hội thoại của project kia | |

## 4. Pipeline Code — bước hỏi làm rõ (mới)

| ✓ | Bước | Kết quả mong đợi | Ghi chú |
|---|---|---|---|
| ☐ | Settings → Pipeline: **tắt** "Auto-answer clarifying questions". Vào Code, nhập một yêu cầu mơ hồ ("thêm đăng nhập") → Run | Pipeline có thể dừng ở bước **Clarify** với tối đa 5 câu hỏi. Mỗi câu có các lựa chọn, một lựa chọn gắn nhãn **Recommended** kèm lý do | |
| ☐ | Tự gõ câu trả lời cho một câu, các câu còn lại chọn theo đề xuất → Submit | Run chạy tiếp: Spec → Code → Review → Write → Validate | |
| ☐ | **Bật** Auto-answer, chạy một yêu cầu mơ hồ khác | Không dừng lại chờ. Các câu hỏi hiện trong run với nhãn **Auto-chosen** | |
| ☐ | Xoá key của provider mà các role pipeline đang dùng (hoặc gán một role sang provider chưa có key) → Run | Run **không** bắt đầu. Thông báo nêu rõ thiếu key của provider nào, có nút mở Settings → Pipeline | |
| ☐ | Một run bị lỗi trước bước ghi file | Báo cáo ghi **"Chưa có thay đổi nào được ghi vào dự án."** | |
| ☐ | Một run bị lỗi ở bước kiểm chứng (validate) | File được hoàn tác, có báo cáo kèm các bước nên làm tiếp | |

## 5. Pipeline Studio (module thêm mới)

| ✓ | Bước | Kết quả mong đợi | Ghi chú |
|---|---|---|---|
| ☐ | Cuối mục Settings → bấm **Pipeline Studio** | Trang đen toàn màn hình, không có thanh điều hướng. Các module theo thứ tự: Yêu cầu → Làm rõ → Đặc tả → Lập trình → Đánh giá → (Sửa lỗi → Đánh giá lại) → Ghi tệp → Kiểm chứng → Hoàn tất | |
| ☐ | Gõ yêu cầu ở ô **Yêu cầu mới** trên trang này rồi chạy | Chấm sáng chạy từ module này sang module kia, module đang chạy nhấp nháy, module xong hiện ✓ | |
| ☐ | Chạy một run có câu hỏi (Auto-answer đang tắt) | Module Làm rõ hiện **?**. Bấm vào, trả lời trong panel, run chạy tiếp | |
| ☐ | Kéo các module sang chỗ khác, thoát ra rồi vào lại | Vị trí vẫn giữ nguyên. Bấm **Đặt lại bố cục** thì về như cũ | |
| ☐ | Bấm vào từng module | Panel bên phải hiện đủ thông tin của module đó: yêu cầu, câu hỏi, spec, file, nhận xét review, lệnh kiểm chứng, kết quả, chi phí | |
| ☐ | Một run bị lỗi | Module bị lỗi hiện ✕, module Hoàn tất giữ màu xám | |
| ☐ | Bấm Esc hoặc ← Quay lại | Lần đầu đóng panel, lần sau quay về trang trước | |
| ☐ | (Tuỳ chọn) Đặt `PIPELINE_STUDIO_ENABLED = false` trong `apps/desktop/src/features/pipeline-studio/index.ts` rồi build lại | Nút Pipeline Studio biến mất, app vẫn chạy bình thường | |

## 6. Knowledge, Workflow, Ảnh, Web chat

| ✓ | Bước | Kết quả mong đợi | Ghi chú |
|---|---|---|---|
| ☐ | Knowledge → thêm một thư mục → chờ "Indexed" → thử truy vấn | Ra kết quả liên quan. Trong Chat bật *Use knowledge* thì câu trả lời có trích dẫn `[1]` | |
| ☐ | Xoá một nguồn trong lúc nó đang được index lại | Nguồn đó bị xoá hẳn, không tự xuất hiện lại | |
| ☐ | Workflow → mở sơ đồ, bấm Fit view ở cỡ cửa sổ bạn hay dùng | Thấy đủ mọi node. Module đã xong việc không còn hiện "Active" | |
| ☐ | Settings → Images → bật một provider → nhờ Chat vẽ một ảnh | Ảnh hiện trong chat. Gallery có ảnh đó kèm prompt và chi phí | |
| ☐ | Web chat → mở 2 khung; bấm Open in browser | Các khung tải được trang, hoặc hiện nút Open in browser. Trình duyệt ngoài mở đúng trang | |

## 7. Chi phí, ngân sách, bảng giá

| ✓ | Bước | Kết quả mong đợi | Ghi chú |
|---|---|---|---|
| ☐ | Cost → Add revenue, bấm Add liên tục thật nhanh | Chỉ có **một** dòng doanh thu được thêm | |
| ☐ | Chế độ All projects → mục Top spend by project | Hiện **tên** project, không phải mã id | |
| ☐ | Settings → Budget → bật Hard Stop với ngân sách rất nhỏ → gửi một tin chat | Lệnh gọi trả phí bị chặn, có thông báo rõ ràng | |
| ☐ | Settings → Pricing: đặt giá tay cho một model rồi xoá đi; khởi động lại app rồi đặt và xoá lại một lần nữa | Chỉ nhãn Origin của đúng dòng đó thay đổi. Sau khi khởi động lại, xoá giá tay sẽ trả về giá đã cập nhật hoặc đã xác minh gần nhất, không phải giá mặc định ban đầu | |

## 8. VS Code (nếu máy có cài)

| ✓ | Bước | Kết quả mong đợi | Ghi chú |
|---|---|---|---|
| ☐ | Settings → VS Code → bật Auto launch → chạy một pipeline có ghi file | VS Code mở project và đánh dấu các file vừa thay đổi | |

## 9. Kiểm tra an toàn nhanh

| ✓ | Bước | Kết quả mong đợi | Ghi chú |
|---|---|---|---|
| ☐ | Mở `%APPDATA%\com.itstudio.app\logs\sidecar-*.log` | Không có API key, không có nội dung prompt | |
| ☐ | Mở Task Manager, kill tiến trình sidecar của IT Studio trong lúc pipeline đang ghi file, rồi mở lại app | Workspace được khôi phục như trước. Run hiện trạng thái đã hoàn tác, kèm báo cáo | |

## 10. Ký nghiệm thu

- ☐ Tất cả các mục đều đạt, hoặc mọi lỗi đã được báo kèm mức độ.
- Người kiểm tra: ____________ Ngày: ____________
- Kết luận: **chấp nhận / chấp nhận kèm việc cần làm tiếp / không chấp nhận**
