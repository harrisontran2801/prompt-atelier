/** Deterministic local runner. Not an LLM. Uses only the user input plus the contract shape. */
export function sandboxAnswer(compiled: string, input: string): string {
  const blob = `${compiled}\n${input}`.toLowerCase();
  const topic = input.replace(/\s+/g, " ").trim().slice(0, 240);
  if (blob.includes("json")) {
    return JSON.stringify(
      {
        summary: topic || "sandbox",
        facts: [topic || "không có fact mới"],
        recommendation: "cần xác minh",
      },
      null,
      2,
    );
  }
  if (blob.includes("code review") || blob.includes("severity") || blob.includes("p0")) {
    return [
      "1. P1 — vị trí: đoạn được đưa vào input.",
      `2. Vấn đề: cần kiểm tra regression quanh: ${topic || "thay đổi"}.`,
      "3. Tác động: có thể ảnh hưởng độ tin cậy nếu thiếu test.",
      "4. Cách sửa: thêm test hồi quy cho nhánh lỗi.",
      "5. Test plan: một case thành công, một case biên, một case lỗi.",
    ].join("\n");
  }
  if (blob.includes("support") || blob.includes("khách hàng")) {
    return [
      "1. Xin chào, mình đã đọc yêu cầu của bạn.",
      `2. Mình hiểu vấn đề: ${topic || "cần thêm chi tiết"}.`,
      "3. Bước tiếp: kiểm tra tài khoản và xác nhận lại trong 1 ngày làm việc.",
      "4. Không gửi mật khẩu. Nếu cần, chỉ gửi mã đơn đã che.",
    ].join("\n");
  }
  if (blob.includes("chiến lược") || blob.includes("strategy")) {
    return [
      `1. Bối cảnh: ${topic || "chưa rõ"}.`,
      "2. Lựa chọn A: làm nhỏ, đo được.",
      "3. Lựa chọn B: mở rộng, rủi ro cao hơn.",
      "4. Khuyến nghị: chọn A nếu chưa có bằng chứng dùng thật.",
      "5. Rủi ro: giả định chưa được kiểm chứng.",
    ].join("\n");
  }
  return [
    `1. Tóm tắt: ${topic || "input trống"}.`,
    "2. Fact: chỉ dùng dữ liệu trong input, không bịa số liệu.",
    "3. Inference: kết luận này là suy luận, chưa phải bằng chứng.",
    "4. Khuyến nghị: bước kiểm chứng tiếp theo, gắn điều kiện.",
    "5. Nguồn: https://example.com/sandbox-evidence",
  ].join("\n");
}
