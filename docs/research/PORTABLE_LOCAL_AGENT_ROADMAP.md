# Lộ trình nghiên cứu: Local Coding Agent và Specialized Agent Library (portable)

> **Loại tài liệu:** Research roadmap — **không phải** tính năng đã có của IT Studio, **không phải** kế hoạch đã được duyệt để triển khai.
> **Cập nhật lần cuối:** 2026-10-22
> **Giai đoạn hiện tại:** R0 — Single Local Coding Agent (IN_PROGRESS)
> **Người duy trì:** Claude (Architect / Documentation Maintainer), theo chỉ đạo của chủ dự án.

## 0. Tóm tắt

Dự án hiện **chỉ tập trung vào một Local Coding Agent duy nhất**. **Qwen3.5 4B** là baseline đã được kiểm chứng (có giới hạn). **Qwen3.5 9B** đang được tải và chờ đánh giá để quyết định có thể trở thành model chính hay không. **Specialized Agent Library** và **LoRA training** là hướng nghiên cứu dài hạn, **chưa được duyệt để triển khai**.

## 1. Bảng trạng thái (status taxonomy)

`IDEA` · `PROPOSED` · `TBD` · `APPROVED` · `IN_PROGRESS` · `EVALUATION` · `COMPLETED` · `DEFERRED` · `REJECTED`

| Hạng mục | Trạng thái |
|---|---|
| R0 — Single Local Coding Agent | IN_PROGRESS |
| R0.1 — Qwen3.5 4B baseline | COMPLETED (BASELINE_VALIDATED_WITH_LIMITATIONS) |
| R0.2 — Qwen3.5 9B evaluation | TBD (DOWNLOAD_IN_PROGRESS — USER_REPORTED, EVALUATION_PENDING, ADOPTION_DECISION_TBD) |
| R0.3 — Single-agent reliability | PROPOSED |
| R1–R7 | IDEA / PROPOSED — chưa được phép bắt đầu |
| Tích hợp vào IT Studio | DEFERRED (chưa được duyệt) |

## 2. Môi trường thử nghiệm (user-reported)

| Thành phần | Giá trị |
|---|---|
| OS | Windows 11 |
| CPU | Intel i5-12500H |
| RAM | ~16 GB |
| GPU | RTX 3050 Laptop, 4 GB VRAM |
| Runtime | Ollama 0.40.5 (endpoint `127.0.0.1:11434`) |
| Agent shell | OpenCode 1.19.0 |
| Node.js | 24.19.0 |
| Nơi lưu model | `D:\AI\Models` (ổ USB) |

> Các thông số trên do chủ dự án báo cáo; Claude chưa tự đo lại.

## 3. R0 — Single Local Coding Agent

**Mục tiêu:** xây dựng và đánh giá **một** Local Coding Agent đáng tin cậy. Chỉ duy trì và đánh giá đúng một agent tại một thời điểm.

### 3.1. R0.1 — Qwen3.5 4B (BASELINE_VALIDATED_WITH_LIMITATIONS)

Model: `qwen3.5:4b`, chạy local qua Ollama, dùng trong OpenCode.

**Kết quả thực tế (user-reported):**

| Làm được | Hạn chế quan sát được |
|---|---|
| Đọc source code | **Vô tình xóa 3 unit test có sẵn** |
| Giải thích logic code | **Báo sai số test PASS** |
| Tìm ra bug | Đôi khi đề xuất hành động ngoài phạm vi task |
| Sửa hàm `subtract` | Context 16K hết rất nhanh |
| Chạy unit test | Chưa chứng minh được khả năng làm task lớn |
| Dùng tool trong OpenCode | Tốc độ bị giới hạn bởi phần cứng và I/O của USB |
| Chạy hoàn toàn local qua Ollama | |

**Kết luận:** Qwen3.5 4B = **VALIDATED BASELINE / SUPERVISED CODING WORKER**. Không được ghi nhận là autonomous coding agent dùng được cho production. Mọi thay đổi do 4B tạo ra cần người kiểm tra diff và chạy lại test độc lập.

### 3.2. R0.2 — Qwen3.5 9B (EVALUATION_PENDING)

Model: `qwen3.5:9b`.

- **DOWNLOAD_IN_PROGRESS — USER_REPORTED**: chủ dự án báo đang tải; **chưa xác nhận tải xong**.
- **EVALUATION_PENDING**: chưa có bất kỳ kết quả đánh giá nào.
- **ADOPTION_DECISION_TBD**: chưa quyết định thay 4B.

Tài liệu này **không** khẳng định 9B đã chạy được, đã tích hợp vào OpenCode, tốt hơn 4B, hay đã thay thế model chính.

**Việc cần làm sau khi tải xong** (chỉ khi chủ dự án cho phép):

1. Xác minh model có trong Ollama (`ollama list`).
2. Kiểm tra dung lượng chiếm trên ổ USB D.
3. Đo RAM và VRAM khi load và khi suy luận.
4. Đo thời gian load model.
5. Đo tốc độ suy luận (tokens/s).
6. Thử tool calling trong OpenCode.
7. Chạy **đúng bộ coding benchmark đã dùng cho 4B**.
8. So sánh kết quả với 4B, đặc biệt: giữ nguyên test có sẵn, báo cáo PASS chính xác, bám phạm vi task.
9. Ghi lại lỗi và edge case quan sát được.
10. Đề xuất chọn model (quyết định thuộc về chủ dự án).

**Nguyên tắc:** luôn đánh giá khả năng chạy trên laptop 16 GB RAM / 4 GB VRAM. Không mặc định model lớn hơn là tốt hơn nếu nó quá chậm hoặc thiếu bộ nhớ. Nếu 9B không chạy ổn định trên phần cứng hiện tại hoặc không cải thiện rõ rệt, **tiếp tục dùng 4B**.

### 3.3. R0.3 — Single-Agent Reliability (PROPOSED)

Hướng nghiên cứu, ưu tiên cách **không cần fine-tune trước**:

- Task contract (mục tiêu, phạm vi, tiêu chí nghiệm thu rõ ràng).
- Scope control và giới hạn quyền của agent.
- Kiểm tra git diff sau mỗi lần agent sửa code.
- Bảo toàn test có sẵn (cấm xóa test nếu không được duyệt).
- Chạy test độc lập, không tin vào báo cáo của agent.
- Báo cáo kết quả chính xác (đối chiếu với output thật).
- Tối ưu context cho cửa sổ 16K.
- Khôi phục khi thất bại.
- Workspace isolation (git worktree hoặc thư mục tách riêng).

## 4. Specialized Agent Library (LONG-TERM RESEARCH / NOT APPROVED)

Tầm nhìn: một thư viện agent chuyên biệt, mỗi agent có tên, vai trò, tool, quyền và benchmark riêng; có thể dùng chung base model; chạy offline; mang theo được giữa các ổ đĩa và máy.

**Kiến trúc ưu tiên (hybrid):**

```text
Shared Base Model
  → Role Configuration
  → Tools / MCP
  → Optional LoRA Adapter
  → Agent Runtime
  → Independent Verification
```

- Không phải agent nào cũng cần train riêng.
- Không phải agent nào cũng cần base model riêng.
- Chỉ fine-tune khi có giả thuyết rõ ràng, dataset, benchmark và mục tiêu đo được.

## 5. Các nhóm agent dự kiến (IDEA — chưa triển khai)

### 5.1. Claude Team — Planning & Architecture

Claude là Research / Training Lead.

| Agent | Vai trò |
|---|---|
| **Atlas** — Requirement Decomposer | Phân tích spec, chia milestone và task, xác định dependency, lập acceptance criteria, ghi TBD và câu hỏi mở |
| **Archon** — Architecture Assistant | Đề xuất kiến trúc, phân tích trade-off, thiết kế API/interface, soạn ADR; không tự duyệt quyết định quan trọng |

Claude có thể được giao xây dataset và Kaggle notebook cho Planning/Architecture trong tương lai — **chưa thực hiện**.

### 5.2. Codex Team — Software Engineering

Codex là Research / Training Lead.

| Agent | Vai trò |
|---|---|
| **Forge** — Coding Agent | Viết code trong giới hạn task contract và scope |
| **Sentinel** — QA Agent | Viết test, bắt regression, kiểm tra test cũ còn nguyên |
| **Lens** — Code Reviewer | Review git diff: tính đúng, khả năng bảo trì, rủi ro |
| **Tracer** — Debug Agent | Tái hiện bug, đọc log/traceback, tìm root cause |
| **Veritas** — Verification Agent | Đối chiếu kết quả chạy thật với báo cáo của agent |

Không bắt buộc fine-tune cả 5. Mỗi agent phải được đánh giá trước chỉ bằng prompt + tool.

### 5.3. Antigravity Team — Game Art & Graphics

Antigravity là Visual Pipeline Research Lead.

| Agent | Vai trò |
|---|---|
| **PixelSmith** — Sprite Generation | Nghiên cứu tạo sprite, pixel art, game asset, giữ nhất quán hình ảnh. Phải đánh giá model sinh ảnh chuyên dụng; **không** mặc định fine-tune Qwen (language model) để sinh ảnh |
| **FrameKeeper** — Animation & Asset QA | Kiểm tra spritesheet, căn chỉnh, frame animation, tính nhất quán asset |
| **UIWeaver** — Graphics Programming | Hỗ trợ Unity UI, shader, rendering pipeline, sprite atlas, code đồ họa |

Pipeline cho sinh ảnh và cho lập trình đồ họa phải tách riêng khi cần. Tất cả vẫn là đề xuất cho tương lai.

## 6. Các giai đoạn nghiên cứu dài hạn (R1–R7)

> **Không bắt đầu bất kỳ giai đoạn nào từ R1 đến R7 khi chưa có phê duyệt rõ ràng của chủ dự án.**

| Giai đoạn | Nội dung | Trạng thái |
|---|---|---|
| **R1** — Agent Role Research | Vai trò từng agent, input/output schema, tool contract, quyền, benchmark | IDEA |
| **R2** — Dataset Engineering | Thu thập, làm sạch, gán nhãn, kiểm chứng ground truth; kiểm tra license, data leakage, chia train/test | IDEA |
| **R3** — Kaggle Training Feasibility | LoRA, PEFT, TRL, Unsloth, tương thích GPU, checkpoint, khả năng tái lập | IDEA |
| **R4** — First Specialized Agent | Chọn **đúng một** agent để fine-tune thử, đo chênh lệch trước/sau | IDEA |
| **R5** — Agent Specialization Expansion | Mở rộng sang agent khác chỉ khi R4 thành công và có nhu cầu thật | IDEA |
| **R6** — Portable Agent Library | Cấu trúc lưu trên USB/SSD: model, adapter, config, tool, manifest, launcher; không hard-code ký tự ổ đĩa; checksum, versioning, kiểm tra tương thích, rollback | IDEA |
| **R7** — IT Studio Integration | Agent registry, model routing, workflow node, tool execution, theo dõi context/token, QA gate | IDEA (DEFERRED) |

## 7. Vòng đời model (Model Lifecycle)

```text
Research → Role Specification → Baseline → Dataset → Fine-tuning
→ Independent Evaluation → Packaging → Deployment → Monitoring → Update / Rollback
```

Mỗi model/agent phải quản lý: model version, dataset version, training configuration, adapter version, evaluation metrics, runtime compatibility, tool permissions, known limitations, release notes.

**Một bản cập nhật model không được coi là thành công nếu benchmark bị giảm.**

## 8. An toàn và quản trị (bắt buộc)

- Agent không được sửa file ngoài phạm vi task.
- Không được xóa unit test có sẵn khi chưa được duyệt rõ ràng.
- Không được báo PASS khi không có output test thật, không mock.
- Quyền phải được runtime enforce, không chỉ dựa vào prompt.
- Dùng git worktree hoặc workspace tách riêng khi phù hợp.
- Thay đổi rủi ro cao phải có người duyệt.
- Không tự động merge hay push commit.
- Không dùng dataset vi phạm license open-source hoặc thương mại.
- Không train trên output của LLM thương mại khi điều khoản dịch vụ cấm.
- Không deploy model chưa kiểm chứng vào production hoặc repository quan trọng.

## 9. Câu hỏi mở (tất cả đều TBD)

| # | Câu hỏi | Trạng thái |
|---|---|---|
| Q1 | Qwen3.5 9B có chạy ổn định trên laptop hiện tại không? | TBD |
| Q2 | 9B có đáng thay 4B trong thực tế không? | TBD |
| Q3 | Tốc độ suy luận thực tế là bao nhiêu? | TBD |
| Q4 | Độ dài context window tối ưu là bao nhiêu? | TBD |
| Q5 | Tiếp tục dùng USB flash hay chuyển sang SSD ngoài? | TBD |
| Q6 | Khi nào thật sự cần model lớn hơn? | TBD |
| Q7 | Khi nào fine-tune thật sự cần thiết? | TBD |
| Q8 | Vai trò nào thật sự cần LoRA adapter? | TBD |
| Q9 | Nguồn dataset chất lượng cao và hợp lệ về license là gì? | TBD |
| Q10 | Hạn mức GPU của Kaggle có đủ cho pipeline không? | TBD |
| Q11 | Portable runtime sẽ hoạt động thế nào khi chuyển giữa các máy? | TBD |
| Q12 | Cập nhật adapter thế nào để không bị catastrophic forgetting / tụt kỹ năng? | TBD |
| Q13 | Khi nào nên bắt đầu tích hợp vào IT Studio? | TBD |

## 10. Quyết định đang có hiệu lực

| ID | Quyết định | Trạng thái |
|---|---|---|
| LA-D1 | Chỉ duy trì và đánh giá **một** Local Coding Agent tại một thời điểm | APPROVED |
| LA-D2 | Qwen3.5 4B là validated baseline (supervised worker, không autonomous) | APPROVED |
| LA-D3 | Qwen3.5 9B là ứng viên nâng cấp; ưu tiên đánh giá 9B trước khi chọn model chính | APPROVED |
| LA-D4 | Nếu 9B không chạy được trên phần cứng hoặc không cải thiện rõ, tiếp tục dùng 4B | APPROVED |
| LA-D5 | Chưa fine-tune; chưa tải hay train thêm model; chưa xây multi-agent runtime; chưa tích hợp vào IT Studio | APPROVED |
| LA-D6 | Chọn 4B hay 9B làm Coding Agent chính | TBD — chờ benchmark |

## 11. Hành động tiếp theo được phép

1. Chủ dự án hoàn tất tải `qwen3.5:9b` và báo lại.
2. Khi được cho phép: chạy R0.2 theo danh sách ở mục 3.2 với **đúng benchmark đã dùng cho 4B**.
3. Ghi kết quả thực tế vào tài liệu này (mục 3.2, mục 9, mục 10), kèm nguồn: verified hay user-reported.

**Quy trình khi quay lại nghiên cứu:** đọc lại tài liệu → xác minh sự thật hiện tại → chọn **đúng một** mục tiêu → đặt giả thuyết có thể bác bỏ → xây benchmark → xin duyệt trước khi chạy → ghi kết quả → cập nhật bảng quyết định. Không tự động chuyển sang milestone tiếp theo.

## 12. Phân loại thông tin

- **Verified (đã kiểm chứng trong repo này):** chưa có — mọi kết quả về 4B/9B ở trên đều do chủ dự án báo cáo.
- **User-reported:** cấu hình phần cứng/runtime (mục 2), kết quả thử nghiệm 4B (mục 3.1), trạng thái đang tải 9B (mục 3.2).
- **Proposals:** mục 3.3 và các mục từ 4 đến 7.

## 13. Lịch sử thay đổi

| Ngày | Thay đổi | Người |
|---|---|---|
| 2026-10-22 | Tạo tài liệu: trạng thái 4B (baseline có giới hạn), 9B (đang tải, chờ đánh giá), lộ trình R0–R7, nhóm agent dự kiến, vòng đời model, quy tắc an toàn, câu hỏi mở | Claude |
