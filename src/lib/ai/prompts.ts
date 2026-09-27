type PromptFields = {
  directive: string;
  context: string;
  task: string;
  guardrails: string;
  output: string;
};

export function compilePrompt(fields: PromptFields) {
  return [
    `# ROLE\n${fields.directive}`,
    `# CONTEXT\n${fields.context}`,
    `# TASK\n${fields.task}`,
    `# GUARDRAILS\n${fields.guardrails}`,
    `# OUTPUT CONTRACT\n${fields.output}`,
  ].join("\n\n");
}

export function generateSystem() {
  return `Bạn là Prompt Engineer senior. Trả lời tiếng Việt, cụ thể, không sáo rỗng.
Luôn phân biệt fact / giả định. Không bịa nguồn. Khi được yêu cầu JSON, chỉ trả JSON hợp lệ.`;
}

export function generateFromIdea(idea: string, roleName: string) {
  return `Thiết kế một prompt có cấu trúc 5 khối cho role "${roleName}".
Ý tưởng của người dùng:
"""
${idea}
"""

Trả về JSON đúng schema:
{
  "title": "tên ngắn",
  "directive": "system / persona",
  "context": "bối cảnh, dùng {{variable}} khi dữ liệu thay đổi",
  "task": "nhiệm vụ một động từ",
  "guardrails": "rào chắn dạng bullet",
  "output": "hợp đồng đầu ra rõ ràng"
}`;
}

export function improveField(field: keyof PromptFields, value: string, compiled: string) {
  return `Cải thiện khối "${field}" của prompt dưới đây.
Khối hiện tại:
"""
${value}
"""

Toàn bộ prompt:
"""
${compiled}
"""

Chỉ trả về nội dung khối đã cải thiện, không giải thích, không markdown fence.`;
}

export function critiquePrompt(compiled: string) {
  return `Chấm prompt sau trên thang 0-100 và nêu 4 điểm sửa cụ thể.

"""
${compiled}
"""

Trả JSON:
{
  "score": 0,
  "verdict": "một câu",
  "strengths": ["..."],
  "fixes": ["..."]
}`;
}

export function runLab(compiled: string, testInput: string) {
  return `Hãy thực thi prompt sau với input thật. Tôn trọng role, guardrails và output contract.

# PROMPT
${compiled}

# TEST INPUT
${testInput}`;
}
