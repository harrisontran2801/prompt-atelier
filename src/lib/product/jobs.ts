import { compileStack, fillTemplate, type StackState } from "../patterns/compose.ts";
import type { Pattern, TestAssert } from "../patterns/types.ts";

export type JobId = "reply" | "summary" | "compare" | "rewrite" | "review" | "research";

export type JobField = {
  name: string;
  label: string;
  example: string;
  multiline?: boolean;
};

export type Job = {
  id: JobId;
  title: string;
  blurb: string;
  stack: StackState;
  fields: JobField[];
  asserts: TestAssert[];
  /** Pattern opened when the user asks to see Studio. */
  studioPatternId: string;
};

const base = (partial: Partial<StackState>): StackState => ({
  protocolIds: partial.protocolIds ?? [],
  guardrailIds: partial.guardrailIds ?? ["pat.guardrail.no-fabrication"],
  safetyIds: partial.safetyIds ?? ["pat.safety.pii-redact", "pat.safety.injection-defense"],
  evaluatorIds: partial.evaluatorIds ?? ["pat.evaluator.structural"],
  resolutions: partial.resolutions ?? {},
  personaId: partial.personaId,
  taskId: partial.taskId,
  formatId: partial.formatId,
});

export const JOBS: Job[] = [
  {
    id: "reply",
    title: "Trả lời khách hàng",
    blurb: "Email ngắn, không xin mật khẩu, không đi theo câu lệnh lạ trong ticket.",
    studioPatternId: "pat.task.support-reply",
    stack: base({ taskId: "pat.task.support-reply" }),
    fields: [
      { name: "issue", label: "Khách đang cần gì?", example: "Khách muốn hoàn tiền đơn #1842 vì nhận nhầm size.", multiline: true },
      { name: "tone", label: "Giọng", example: "điềm tĩnh" },
    ],
    asserts: [
      { type: "numbered_min", value: 3 },
      { type: "contains", value: "Mình hiểu" },
      { type: "not_contains", value: "mật khẩu của bạn là" },
    ],
  },
  {
    id: "summary",
    title: "Tóm tắt và việc cần làm",
    blurb: "Biến ghi chú lộn xộn thành memo có fact và bước tiếp theo.",
    studioPatternId: "pat.task.research-brief",
    stack: base({
      personaId: "pat.persona.independent-researcher",
      protocolIds: ["pat.protocol.evidence-split"],
      taskId: "pat.task.research-brief",
      formatId: "pat.format.memo-five",
    }),
    fields: [
      { name: "topic", label: "Ghi chú hoặc tài liệu", example: "Cuộc họp: chốt trang giá tuần sau, còn thiếu ảnh và FAQ.", multiline: true },
      { name: "market", label: "Ai sẽ đọc?", example: "nhóm sản phẩm nội bộ" },
    ],
    asserts: [
      { type: "numbered_min", value: 3 },
      { type: "contains", value: "Fact" },
    ],
  },
  {
    id: "compare",
    title: "So sánh lựa chọn",
    blurb: "Hai hướng, một khuyến nghị có điều kiện, một rủi ro. Không bịa số liệu.",
    studioPatternId: "pat.task.strategy-memo",
    stack: base({ taskId: "pat.task.strategy-memo" }),
    fields: [
      { name: "product", label: "Việc cần quyết", example: "Nên thuê studio hay làm landing một mình", multiline: true },
      { name: "constraint", label: "Ràng buộc", example: "một người, không thuê thêm trong tháng này" },
    ],
    asserts: [
      { type: "contains", value: "Khuyến nghị" },
      { type: "contains", value: "Rủi ro" },
    ],
  },
  {
    id: "rewrite",
    title: "Viết lại cho rõ",
    blurb: "Bản nháp thành memo 5 phần. Sandbox chỉ dựng khung, không phải văn hay.",
    studioPatternId: "pat.format.memo-five",
    stack: base({
      personaId: "pat.persona.independent-researcher",
      taskId: "pat.task.research-brief",
      formatId: "pat.format.memo-five",
    }),
    fields: [
      { name: "topic", label: "Bản nháp", example: "Sản phẩm giúp trả lời khách theo một cách giống nhau mỗi lần.", multiline: true },
      { name: "market", label: "Người đọc", example: "khách lần đầu, không biết prompt" },
    ],
    asserts: [{ type: "numbered_min", value: 3 }],
  },
  {
    id: "review",
    title: "Xem code có lỗi gì",
    blurb: "Finding có mức độ và test plan. Không chấm style.",
    studioPatternId: "pat.task.code-review",
    stack: base({
      personaId: "pat.persona.pragmatic-reviewer",
      taskId: "pat.task.code-review",
      guardrailIds: [],
    }),
    fields: [
      { name: "code", label: "Đoạn code", example: "async function retry(fn){ return fn(); }", multiline: true },
      { name: "stack", label: "Ngôn ngữ", example: "TypeScript" },
      { name: "goal", label: "Mục tiêu", example: "retry an toàn khi mạng lỗi" },
    ],
    asserts: [
      { type: "contains", value: "P1" },
      { type: "contains", value: "Test plan" },
    ],
  },
  {
    id: "research",
    title: "Tìm hiểu có kiểm chứng",
    blurb: "Tách fact và suy luận. Thiếu nguồn thì nói thiếu, không bịa.",
    studioPatternId: "pat.task.research-brief",
    stack: base({
      personaId: "pat.persona.independent-researcher",
      protocolIds: ["pat.protocol.evidence-split"],
      taskId: "pat.task.research-brief",
      formatId: "pat.format.memo-five",
    }),
    fields: [
      { name: "topic", label: "Câu hỏi", example: "Nên dùng sandbox hay gọi model ngoài cho lần chạy đầu?", multiline: true },
      { name: "market", label: "Bối cảnh", example: "một người dùng thử trên máy" },
    ],
    asserts: [
      { type: "numbered_min", value: 3 },
      { type: "contains", value: "Inference" },
      { type: "contains", value: "Fact" },
    ],
  },
];

export function jobById(id: string) {
  return JOBS.find((item) => item.id === id);
}

export function exampleVars(job: Job) {
  return Object.fromEntries(job.fields.map((field) => [field.name, field.example]));
}

export function compileWorkflow(patterns: Pattern[], stack: StackState, vars: Record<string, string>) {
  const built = compileStack(stack, patterns);
  const ids = new Set(built.sources.map((item) => item.id));
  const variables = patterns.filter((item) => ids.has(item.id)).flatMap((item) => item.variables);
  return { ...built, compiled: fillTemplate(built.compiled, vars, variables, true) };
}
