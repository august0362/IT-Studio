# Danh sách việc bạn cần tự kiểm tra trên IT Studio v1

## File này dùng để làm gì?

Máy đã tự chạy hơn 1.000 bài test, nhưng có những thứ máy không tự kiểm được: dùng API key thật, nhìn giao diện có đẹp và dễ hiểu không, cài đặt trên Windows, mở VS Code… Những bài dưới đây là phần **bạn tự bấm thử bằng tay**.

Cách dùng:
- Đọc từng bài, **làm** theo dòng "Làm", rồi xem có **thấy** đúng như dòng "Phải thấy" không.
- Đúng thì đổi `[ ]` thành `[x]`.
- Sai thì ghi ngay bên dưới bài đó: *đã làm gì, thấy gì*. Có ảnh chụp càng tốt.

**File cài đặt:** `apps\desktop\src-tauri	argeteleaseundle
sis\IT Studio_0.1.0_x64-setup.exe` (trong thư mục project, build ngày 15/10/2026).
Muốn chạy thẳng từ mã nguồn thay vì cài: bấm đúp `Start-IT-Studio.bat` ở thư mục gốc của project.

Máy đã tự kiểm tra trước khi giao: 1.277 bài unit, 162 bài integration, 14 bài E2E (mở app thật và tự bấm), thử cài/gỡ bản cài. Tất cả đều đạt.

Cần chuẩn bị:
- API key của **2 hãng AI khác nhau** (ví dụ OpenAI và Google).
- Một thư mục trống trên máy để làm project thử.
- Khoảng 45 phút.

---

## A. Cài và mở app

- [ ] **A1. Cài app**
  - Làm: chạy file cài đặt ở đường dẫn trên. Nếu Windows hiện cảnh báo màu xanh, bấm *More info* rồi *Run anyway* (app chưa có chữ ký số, chuyện bình thường).
  - Phải thấy: cài xong, trong menu Start có "IT Studio".

- [ ] **A2. Mở app**
  - Làm: mở IT Studio.
  - Phải thấy: góc dưới hiện chữ *Connecting…* rồi chuyển sang *Ready* trong vài giây. Không có thanh báo lỗi màu đỏ.

- [ ] **A3. Mở lại**
  - Làm: tắt app rồi mở lại.
  - Phải thấy: mọi thứ vẫn như lúc trước khi tắt.

## B. Nhập API key

- [ ] **B1. Key sai**
  - Làm: vào *Settings → API Keys*, dán một key bịa ra, bấm *Verify & save*.
  - Phải thấy: app báo key sai và không lưu.

- [ ] **B2. Key đúng**
  - Làm: dán key thật, bấm *Verify & save*.
  - Phải thấy: lưu thành công, key chỉ hiện 4 ký tự cuối (để không bị lộ).

## C. Project và Chat

- [ ] **C1. Tạo project**
  - Làm: bấm dấu **+** ở trên cùng, đặt tên và chọn thư mục trống đã chuẩn bị.
  - Phải thấy: có thêm một tab mang tên project đó.

- [ ] **C2. Chat thử**
  - Làm: vào *Chat → New chat*, chọn *Auto*, gõ "xin chào".
  - Phải thấy: AI trả lời, chữ hiện dần ra, bên dưới có chi phí bằng USD và VND.

- [ ] **C3. Hai project không lẫn nhau**
  - Làm: tạo thêm một project thứ hai, bấm chuyển qua lại giữa hai tab thật nhanh.
  - Phải thấy: mỗi project chỉ hiện cuộc chat của riêng nó. Không bao giờ gửi nhầm tin sang project kia.

## D. Viết code tự động (Pipeline) — có bước hỏi lại mới

"Pipeline" là chức năng bạn gõ yêu cầu, AI tự lên kế hoạch, viết code, tự review, rồi ghi file vào thư mục project.

- [ ] **D1. AI hỏi lại khi yêu cầu chưa rõ**
  - Làm: vào *Settings → Pipeline*, **tắt** ô "Auto-answer clarifying questions". Sau đó vào tab *Code*, gõ một yêu cầu mơ hồ như "thêm đăng nhập", bấm *Run*.
  - Phải thấy: AI có thể dừng lại và hỏi bạn tối đa 5 câu. Mỗi câu có vài lựa chọn, một lựa chọn được AI **đề xuất** (nhãn *Recommended*) kèm lý do.

- [ ] **D2. Trả lời câu hỏi**
  - Làm: một câu tự gõ câu trả lời, các câu còn lại chọn theo đề xuất, rồi bấm *Submit*.
  - Phải thấy: AI chạy tiếp các bước còn lại cho đến khi xong.

- [ ] **D3. Chế độ tự trả lời**
  - Làm: quay lại *Settings → Pipeline*, **bật** "Auto-answer", rồi chạy một yêu cầu mơ hồ khác.
  - Phải thấy: AI không dừng lại hỏi, tự chọn theo đề xuất (ghi là *Auto-chosen*), nhưng bạn vẫn xem lại được các câu hỏi đó.

- [ ] **D4. Thiếu key thì không chạy**
  - Làm: xoá hết key ở *Settings → API Keys*, rồi bấm *Run* một pipeline.
  - Phải thấy: app **không chạy**, báo rõ là thiếu key của hãng nào và chỉ chỗ để thêm.

- [ ] **D5. Lỗi thì không làm hỏng thư mục**
  - Làm: để ý những lần pipeline bị lỗi.
  - Phải thấy: nếu lỗi trước khi ghi file thì app báo "Chưa có thay đổi nào được ghi vào dự án". Nếu lỗi sau khi ghi thì file được trả về như cũ, kèm hướng dẫn nên làm gì tiếp.

## E. Pipeline Studio — màn hình đen xem pipeline chạy (mới)

- [ ] **E1. Mở màn hình**
  - Làm: ở menu bên trái, kéo xuống cuối phần *Settings*, bấm **Pipeline Studio**.
  - Phải thấy: một trang đen toàn màn hình, các ô (module) nối nhau theo thứ tự Yêu cầu → Làm rõ → Đặc tả → Lập trình → Đánh giá → Ghi tệp → Kiểm chứng → Hoàn tất.

- [ ] **E2. Xem chạy trực tiếp**
  - Làm: gõ yêu cầu vào ô **Yêu cầu mới** ngay trên trang đó, rồi bấm chạy.
  - Phải thấy: một chấm sáng chạy từ ô này sang ô kia, ô đang làm thì sáng nhấp nháy, ô làm xong hiện dấu **✓**.

- [ ] **E3. Dấu ? khi cần bạn trả lời**
  - Làm: tắt "Auto-answer" (như bài D1), rồi chạy một yêu cầu mơ hồ.
  - Phải thấy: ô *Làm rõ* hiện dấu **?**. Bấm vào ô đó thì trả lời được luôn, xong thì pipeline chạy tiếp.

- [ ] **E4. Kéo thả**
  - Làm: kéo vài ô sang chỗ khác, thoát ra rồi vào lại.
  - Phải thấy: các ô vẫn ở chỗ bạn đã kéo. Bấm *Đặt lại bố cục* thì chúng về như cũ.

- [ ] **E5. Xem chi tiết**
  - Làm: bấm vào từng ô.
  - Phải thấy: bên phải mở ra một bảng với đầy đủ thông tin của bước đó.

- [ ] **E6. Khi bị lỗi**
  - Làm: xem một lần chạy bị lỗi.
  - Phải thấy: ô bị lỗi hiện dấu **✕** màu đỏ, ô *Hoàn tất* vẫn để màu xám.

- [ ] **E7. Thoát**
  - Làm: bấm phím Esc hoặc nút *← Quay lại*.
  - Phải thấy: lần đầu đóng bảng chi tiết, lần sau quay về trang trước.

## F. Các chức năng khác

- [ ] **F1. Kho tài liệu (Knowledge)**
  - Làm: vào *Knowledge*, thêm một thư mục có tài liệu, chờ đến khi hiện "Indexed", rồi gõ thử một câu hỏi.
  - Phải thấy: tìm ra đúng đoạn liên quan. Khi chat có bật *Use knowledge*, câu trả lời có ghi nguồn dạng `[1]`.

- [ ] **F2. Xoá tài liệu**
  - Làm: xoá một tài liệu trong *Knowledge*.
  - Phải thấy: tài liệu đó biến mất hẳn và không tự xuất hiện lại.

- [ ] **F3. Sơ đồ Workflow**
  - Làm: mở tab *Workflow*, bấm nút *Fit view*.
  - Phải thấy: thấy đủ mọi ô trên màn hình. Ô nào đã làm xong thì không còn hiện "Active".

- [ ] **F4. Tạo ảnh**
  - Làm: vào *Settings → Images*, bật một hãng tạo ảnh, rồi nhờ Chat vẽ một bức ảnh.
  - Phải thấy: ảnh hiện trong khung chat, và có trong tab *Gallery*.

- [ ] **F5. Web chat**
  - Làm: mở *Web chat*, chọn 2 trang để mở cạnh nhau.
  - Phải thấy: hai trang hiện ra; trang nào không cho đăng nhập bên trong app thì có nút *Open in browser* để mở bằng trình duyệt.

## G. Chi phí và ngân sách

- [ ] **G1. Không bị cộng trùng doanh thu**
  - Làm: vào *Cost*, nhập một khoản doanh thu, bấm nút *Add* liền 2–3 lần thật nhanh.
  - Phải thấy: chỉ có **một** dòng được thêm.

- [ ] **G2. Tên project**
  - Làm: chọn *All projects*, xem mục chi tiêu nhiều nhất.
  - Phải thấy: hiện **tên** project, không phải một dãy mã khó hiểu.

- [ ] **G3. Chặn khi hết ngân sách**
  - Làm: vào *Settings → Budget*, đặt ngân sách thật nhỏ và bật *Hard Stop*, rồi gửi một tin chat.
  - Phải thấy: app không cho gọi AI nữa và báo lý do rõ ràng.

- [ ] **G4. Giá tự đặt**
  - Làm: vào *Settings → Pricing*, tự đặt giá cho một model rồi xoá đi. Tắt app, mở lại, làm lại một lần nữa.
  - Phải thấy: chỉ dòng của model đó thay đổi. Sau khi xoá giá tự đặt, giá quay về giá cập nhật gần nhất chứ không về giá mặc định ban đầu.

## H. VS Code (chỉ khi máy có cài VS Code)

- [ ] **H1. Tự mở VS Code**
  - Làm: vào *Settings → VS Code*, bật *Auto launch*, rồi chạy một pipeline có ghi file.
  - Phải thấy: VS Code tự mở project và đánh dấu những file vừa bị sửa.

## I. An toàn

- [ ] **I1. Nhật ký không lộ key**
  - Làm: mở thư mục `%APPDATA%\com.itstudio.app\logs` (dán đường dẫn này vào thanh địa chỉ của File Explorer), mở file log mới nhất.
  - Phải thấy: trong file không có API key, không có nội dung bạn đã chat.

- [ ] **I2. App bị tắt đột ngột**
  - Làm: trong lúc pipeline đang ghi file, mở Task Manager và tắt hẳn IT Studio. Sau đó mở lại app.
  - Phải thấy: thư mục project được trả về như trước khi chạy, lần chạy đó hiện là đã hoàn tác.

---

## Kết luận

- [ ] Đã làm hết các bài trên (bài nào sai đều đã ghi chú).
- Người kiểm tra: ____________ Ngày: ____________
- Kết luận (chọn một): **Đạt** / **Đạt nhưng cần sửa thêm** / **Chưa đạt**

<!-- QA: commit 50cbd1a, NSIS SHA-256 c692db41b95ba88024044e380c331cc14059cbe20bcda5bec389d5c2226fb15f, chi tiết trong docs/qa/V1-report.md -->
