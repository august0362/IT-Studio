# 04 — Hướng dẫn nghiệm thu cho chủ dự án (đợt ổn định hoá, 21/10/2026)

File này thay cho phần còn lại của [V1-owner-checklist.md](../V1-owner-checklist.md) và bổ sung các bài về
**điều phối nhiều agent (Orchestration)** và **khôi phục sau sự cố**. Kết quả ghi ở đây là kết quả do **bạn** tự
làm. Máy chỉ ghi "ĐẠT" cho bài bạn đã đánh dấu trước đó; các bài còn lại đều là **CHƯA CHẠY** — test tự động
đạt **không** có nghĩa là bài nghiệm thu đạt.

Trạng thái dùng trong file: **ĐẠT** · **KHÔNG ĐẠT** · **BỊ CHẶN** · **CHƯA CHẠY**.
Khi làm xong một bài: sửa dòng *Trạng thái*, ghi ngày, và (nếu KHÔNG ĐẠT) ghi *đã làm gì, thấy gì* + ảnh chụp.

---

## 0. Chuẩn bị (khoảng 10 phút)

1. **Bản cần thử:** nhánh `stabilization/v1-hardening` (đã gồm toàn bộ bản sửa). Cách nhanh nhất: mở thư mục
   project, bấm đúp `Start-IT-Studio.bat` (chạy từ mã nguồn). Bản cài `.exe` ngày 16/10 **không** có các bản sửa
   này — đừng dùng nó cho các bài ORCH và RAG bên dưới.
2. **Project thử dùng một lần** (không bao giờ thử trên project thật của bạn). Mở PowerShell trong thư mục IT
   Studio và chạy:
   ```
   node scripts/dev/acceptance-fixture.mjs
   ```
   Lệnh tạo thư mục `%USERPROFILE%\itstudio-acceptance-<ngày>` gồm: một ít code JavaScript, test chạy bằng
   `npm test`, 3 tài liệu trong `docs\` cho bài Knowledge, đã là một Git repo có commit. Thư mục đã có file thì
   lệnh từ chối, không ghi đè. Xong việc thì xoá thư mục đó.
3. **Cần có:** key API của ít nhất 1 hãng (bài pipeline/chat); với bài ORCH-R: đăng nhập sẵn `claude` và `codex`
   CLI hoặc key API cho supervisor/worker/reviewer (Settings → Orchestration). **Các bài ORCH-R tốn tiền/hạn mức
   thật** — đặt *Maximum cost (USD)* nhỏ (ví dụ 0.5) trước khi chạy.
4. Mỗi bài, ghi lại: ảnh chụp màn hình lúc kết thúc, và với bài ORCH: mã run (hiện trong Code → Orchestration).
   Log ở `%APPDATA%\com.itstudio.app\logs`.

---

## 1. Tóm tắt trạng thái

| Nhóm | Bài | Trạng thái |
|---|---|---|
| A. Cài & mở | A1, A2, A3 | ĐẠT (bạn đánh dấu, bản 16/10) |
| B. API key | B1, B2, B3 | ĐẠT (bạn đánh dấu, bản 16/10) |
| C. Project & Chat | C1–C6 | ĐẠT (bạn đánh dấu, bản 16/10) |
| D. Pipeline | D1 ĐẠT · D2, D3, D4, D5 | CHƯA CHẠY |
| ORCH-R. Orchestration với agent thật (mới) | R1–R6 | CHƯA CHẠY |
| E. Pipeline Studio | E1–E7 | CHƯA CHẠY |
| S. Settings | S1 | CHƯA CHẠY |
| P. Processes | P1–P3 | CHƯA CHẠY |
| F. Knowledge, Workflow, ảnh, web chat | F1–F5 | CHƯA CHẠY |
| G. Chi phí & ngân sách | G1–G4 | CHƯA CHẠY |
| H. VS Code | H1 | CHƯA CHẠY |
| I. An toàn & sự cố | I1, I2 | CHƯA CHẠY |

13/40 bài cũ đã ĐẠT; 27 bài cũ + 6 bài ORCH-R mới đang CHƯA CHẠY. Không bài nào đang BỊ CHẶN bởi lỗi đã biết.
Không bài nào trở nên lỗi thời: tên nút/menu trong checklist cũ vẫn còn trong giao diện (đã đối chiếu với file
ngôn ngữ của app ngày 21/10). Nên mở lại nhanh A2 và C2 trên bản mới vì mã đã thay đổi nhiều từ 16/10.

---

## 2. Các bài cần làm, theo thứ tự ưu tiên

### Ưu tiên 1 — Pipeline viết code thật

**D2. Trả lời câu hỏi làm rõ**
- Mục đích: pipeline chạy tiếp đúng sau khi bạn trả lời.
- Điều kiện: đã làm D1 (đang có câu hỏi chờ trả lời), project thử ở mục 0.
- Làm: một câu tự gõ câu trả lời, các câu còn lại chọn theo *Recommended*, bấm *Submit*.
- Phải thấy: pipeline chạy tiếp tới *Done*; file mới/sửa xuất hiện trong thư mục project thử.
- Ghi lại: ảnh màn hình kết quả; danh sách file thay đổi (`git status` trong thư mục project thử).
- Trạng thái: CHƯA CHẠY. Phụ thuộc: key API thật (tốn chi phí nhỏ).

**D3. Chế độ tự trả lời**
- Làm: Settings → Pipeline → bật "Auto-answer clarifying questions…", chạy một yêu cầu mơ hồ khác.
- Phải thấy: không dừng lại hỏi; câu hỏi vẫn xem được, ghi *Auto-chosen*.
- Ghi lại: ảnh phần câu hỏi đã tự trả lời. Trạng thái: CHƯA CHẠY.

**D4. Thiếu key thì không chạy**
- Làm: Settings → API Keys, xoá hết key; bấm *Run* một pipeline.
- Phải thấy: không chạy; báo rõ thiếu key hãng nào, chỉ chỗ thêm. Thêm lại key sau bài này.
- Trạng thái: CHƯA CHẠY. Ghi chú: test tự động có kiểm tra tương tự, nhưng chưa thay cho bài này.

### Ưu tiên 2 — Lỗi thì trả thư mục về như cũ

**D5. Lỗi không làm hỏng thư mục**
- Làm: trong project thử, chạy một yêu cầu chắc chắn làm test hỏng, ví dụ "đổi hàm greet để trả về chuỗi rỗng"
  (test `npm test` của project thử sẽ hỏng).
- Phải thấy: nếu lỗi trước khi ghi → "Chưa có thay đổi nào được ghi vào dự án"; nếu lỗi sau khi ghi → file được trả
  về như cũ (`git status` sạch) và có hướng dẫn bước tiếp.
- Ghi lại: ảnh thông báo; kết quả `git status`. Trạng thái: CHƯA CHẠY.

**I2. App bị tắt đột ngột khi đang ghi file**
- Làm: chạy một pipeline có ghi file; khi đến bước *Ghi tệp*, mở Task Manager, tắt hẳn IT Studio (cả tiến trình
  `itstudio-sidecar` nếu thấy). Mở lại app.
- Phải thấy: thư mục project thử về như trước khi chạy (`git status` sạch), lần chạy đó hiện là đã hoàn tác.
- Trạng thái: CHƯA CHẠY. Giới hạn: khó canh đúng thời điểm; nếu tắt quá sớm/muộn, ghi rõ bạn tắt ở bước nào.

### Ưu tiên 3 — Orchestration với agent thật (mới, tốn tiền thật)

Chuẩn bị chung: project thử (mục 0) mở trong IT Studio; Settings → Orchestration: chọn supervisor/worker/reviewer,
*Maximum cost (USD)* nhỏ, bấm lưu và thấy chữ *Saved*. Vào Code → Orchestration.

**R1. Một run hoàn chỉnh**
- Làm: gõ "Thêm hàm `capitalize(text)` vào `src/text/capitalize.js` kèm test trong `test/`", bấm *Plan*, xem DAG,
  bấm *Start*.
- Phải thấy: các task chạy và đổi trạng thái trực tiếp; mỗi task có lượt worker và reviewer; cuối cùng có lượt
  *supervisor* (review cuối) và run sang *Awaiting approval*. **Chưa có gì được merge vào `main`** (`git log` của
  project thử chưa đổi).
- Ghi lại: ảnh DAG lúc xong, mã run, chi phí hiển thị. Trạng thái: CHƯA CHẠY.

**R2. Duyệt merge**
- Điều kiện: R1 đang *Awaiting approval*. Làm: bấm *Approve merge*.
- Phải thấy: run *Completed*; trong project thử có đúng **một** merge commit mới (`git log --oneline -3`), file
  `src/text/capitalize.js` (thư mục con — trước đợt sửa này bị chặn nhầm) có mặt; `npm test` đạt; không còn thư
  mục `.itstudio\orch\...` và nhánh `itstudio/orch/...` (`git branch`).
- Trạng thái: CHƯA CHẠY.

**R3. Nhánh đích đổi sau khi review (bảo vệ duyệt cũ)**
- Làm: chạy một run tới *Awaiting approval*; **trước khi duyệt**, tự commit một thay đổi nhỏ vào `main` của project
  thử (ví dụ sửa `README.md`, `git commit -am "owner"`), rồi bấm *Approve merge*.
- Phải thấy: app **từ chối** merge, run chuyển *Paused* với lý do `TARGET_CHANGED`; `main` không bị merge. Bấm
  *Resume* → app tích hợp lại trên `main` mới, review cuối lại → *Awaiting approval* → duyệt được, kết quả có cả
  thay đổi của bạn lẫn của run.
- Trạng thái: CHƯA CHẠY.

**R4. File đang sửa dở**
- Làm: run tới *Awaiting approval*; mở một file mà run sẽ thay đổi, gõ thêm vài chữ, lưu (không commit); bấm duyệt.
- Phải thấy: app từ chối, báo có thay đổi chưa commit trong file liên quan; nội dung bạn gõ còn nguyên; run vẫn
  *Awaiting approval*. Bỏ thay đổi đó rồi duyệt lại được.
- Trạng thái: CHƯA CHẠY.

**R5. Huỷ giữa chừng**
- Làm: khi một task đang chạy, bấm *Cancel*.
- Phải thấy: run *Cancelled* trong vài giây; Task Manager không còn tiến trình `claude`/`codex` do run sinh ra;
  `main` không đổi. Bấm *Discard* để dọn worktree.
- Trạng thái: CHƯA CHẠY.

**R6. Tắt app khi run đang chạy (khôi phục)**
- Làm: khi một task đang chạy, tắt hẳn IT Studio bằng Task Manager; mở lại app, vào Code → Orchestration.
- Phải thấy: run hiện *Paused after interruption*, **không tự chạy lại** (không gọi agent khi bạn chưa bấm); bấm *Resume*
  → run tiếp tục với lượt mới, kết thúc *Awaiting approval*; task đã xong trước đó không làm lại; duyệt xong chỉ có
  một merge commit; chi phí không bị cộng hai lần cho cùng một lượt.
- Trạng thái: CHƯA CHẠY. Giới hạn: lượt agent đang chạy dở lúc tắt sẽ được chạy lại (tốn thêm một lượt).

### Ưu tiên 4 — Ngân sách

**G3. Chặn khi hết ngân sách (chat)**
- Làm: Settings → Budget, đặt ngân sách rất nhỏ, bật *Hard Stop*, gửi một tin chat.
- Phải thấy: không gọi AI, báo lý do rõ ràng. Trả ngân sách về như cũ sau bài.
- Trạng thái: CHƯA CHẠY.

**G3-ORCH. Ngân sách của một run**
- Làm: Settings → Orchestration, *Agent calls* = 2; chạy một run.
- Phải thấy: run dừng *Paused* với lý do `BUDGET_CALLS`, không có thêm lượt agent nào sau đó.
- Trạng thái: CHƯA CHẠY.

### Ưu tiên 5 — Knowledge (RAG) với tài liệu thật

**F1. Tìm đúng đoạn liên quan**
- Làm: Knowledge → thêm thư mục `docs` của project thử, chờ *Indexed*; hỏi "Mã cửa bến bốc hàng là gì?".
- Phải thấy: kết quả chứa đoạn có `ORCHID-7` (file `warehouse-policy.md`). Chat có bật *Use knowledge*: câu trả lời
  có `[1]` trỏ về tài liệu đó. Thử thêm: "Hoàn tiền trong bao nhiêu ngày?" → 41 ngày.
- Trạng thái: CHƯA CHẠY. Ghi chú: đợt này sửa lỗi Knowledge **không tìm thấy file nào** khi project nằm dưới
  junction/đường dẫn rút gọn kiểu `RUNNER~1` — nếu máy bạn có đường dẫn như vậy, đây là bài quan trọng.

**F2. Xoá tài liệu**
- Làm: xoá `refund-rules.md` khỏi Knowledge.
- Phải thấy: biến mất hẳn, không tự xuất hiện lại; câu hỏi về hoàn tiền không còn trả về đoạn đó.
- Trạng thái: CHƯA CHẠY.

### Ưu tiên 6 — VS Code

**H1. Tự mở VS Code**
- Làm: Settings → VS Code, bật "Launch VS Code automatically"; chạy một pipeline có ghi file trong project thử.
- Phải thấy: VS Code mở đúng project thử, đánh dấu file vừa sửa.
- Trạng thái: CHƯA CHẠY. Phụ thuộc: máy có cài VS Code.

### Ưu tiên 7 — Khôi phục sau sự cố

Đã gồm trong **I2** (pipeline) và **R6** (orchestration) ở trên.

### Ưu tiên 8 — Processes và màn hình theo dõi

**P1. Danh sách tiến trình** — chat vài tin, chạy một pipeline, nạp Knowledge, mở *Processes*. Phải thấy: mỗi hoạt
động một dòng với chấm 🟢/🟡/🔴/⚪; thanh trạng thái có số chấm, bấm vào mở Processes. Run orchestration cũng có
dòng riêng. Trạng thái: CHƯA CHẠY.

**P2. Sơ đồ một tiến trình** — bấm *Open* ở tiến trình chat rồi Knowledge. Phải thấy: màn hình đen với các ô nối
nhau, ô xong có ✓, kéo thả được, bấm ô thấy dữ liệu vào/ra. Trạng thái: CHƯA CHẠY.

**P3. Huỷ / thử lại / xoá** — *Cancel* một tiến trình đang chạy (ví dụ nạp tài liệu) → 🔴; *Retry* → tiến trình mới;
*Delete* tiến trình ⚪ → mất dòng; chỉ giữ ~20 tiến trình ⚪ gần nhất. Trạng thái: CHƯA CHẠY.

**E1–E7. Pipeline Studio** — làm đúng như checklist cũ (Settings → Labs → Pipeline Studio): E1 mở màn hình;
E2 chấm sáng chạy qua các ô, ô xong có ✓; E3 dấu **?** ở ô *Làm rõ* và trả lời ngay tại ô; E4 kéo thả, thoát vào lại
vẫn giữ, *Reset layout* trả về cũ; E5 bấm ô mở bảng chi tiết; E6 lần chạy lỗi có ô ✕ đỏ, ô *Hoàn tất* xám; E7 Esc
lần đầu đóng bảng, lần sau quay lại. Trạng thái: CHƯA CHẠY (cả 7).

### Ưu tiên 9 — Các bài còn lại

**S1. Settings gộp** — menu trái chỉ còn chức năng chính + nút Settings; ô tìm "key", "theme", "budget" lọc đúng
mục. Trạng thái: CHƯA CHẠY.

**F3. Sơ đồ Workflow** — tab Workflow, *Fit view*: thấy đủ ô; ô đã xong không còn "Active". Trạng thái: CHƯA CHẠY.

**F4. Tạo ảnh** — Settings → Images bật một hãng; nhờ Chat vẽ ảnh → ảnh hiện trong chat và tab Gallery. Phụ
thuộc: key của hãng tạo ảnh (tốn tiền). Trạng thái: CHƯA CHẠY.

**F5. Web chat** — mở 2 trang cạnh nhau; trang không cho đăng nhập bên trong có *Open in browser*. Trạng thái:
CHƯA CHẠY.

**G1. Không cộng trùng doanh thu** — Cost, nhập doanh thu, bấm *Add* 2–3 lần thật nhanh → chỉ một dòng. Trạng
thái: CHƯA CHẠY.

**G2. Tên project** — *All projects*: mục chi nhiều nhất hiện **tên** project. Trạng thái: CHƯA CHẠY.

**G4. Giá tự đặt** — Settings → Pricing đặt giá một model, xoá; tắt mở lại, làm lại → chỉ dòng đó đổi; xoá xong
quay về giá cập nhật gần nhất. Trạng thái: CHƯA CHẠY.

**I1. Log không lộ key** — mở log mới nhất ở `%APPDATA%\com.itstudio.app\logs` → không có API key, không có nội
dung chat. Trạng thái: CHƯA CHẠY.

---

## 3. Kết luận của chủ dự án

- [ ] Đã làm hết các bài trên (bài nào KHÔNG ĐẠT/BỊ CHẶN đều đã ghi chú).
- Người kiểm tra: ____________ Ngày: ____________
- Kết luận (chọn một): **Đạt** / **Đạt nhưng cần sửa thêm** / **Chưa đạt**

Chỉ khi bạn chọn **Đạt** thì trạng thái **OWNER_ACCEPTED** mới được ghi vào báo cáo. Kết quả kỹ thuật
(ENGINEERING_VERIFIED) nằm ở `03-VERIFICATION.md`; đánh giá phát hành ở `06-FINAL-REPORT.md`.
