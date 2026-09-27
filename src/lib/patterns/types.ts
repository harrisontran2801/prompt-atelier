export type PatternStatus = "draft" | "verified" | "production" | "deprecated";

export type PatternKind =
  | "persona"
  | "protocol"
  | "task"
  | "format"
  | "guardrail"
  | "evaluator"
  | "safety";

export type VarType = "string" | "text" | "number" | "enum" | "json" | "code";

export type VariableDef = {
  name: string;
  type: VarType;
  required: boolean;
  default?: string | number | null;
  example?: string;
  enumValues?: string[];
  secret?: boolean;
};

export type PromptComponents = {
  directive: string;
  context: string;
  task: string;
  guardrails: string;
  output: string;
};

export type Pattern = {
  id: string;
  version: string;
  name: string;
  summary: string;
  useCase: string;
  antiUseCase: string;
  kind: PatternKind;
  category: string;
  tags: string[];
  roles: string[];
  status: PatternStatus;
  components: PromptComponents;
  variables: VariableDef[];
  outputContract: string;
  outputSchema?: string;
  testCaseIds: string[];
  evaluatorIds: string[];
  failureModes: string[];
  compatibleModels: string[];
  redTeamNotes: string;
  evidence: {
    nTests: number;
    passRate?: number;
    testsetHash?: string;
    verifiedModels: string[];
    lastRunAt?: string;
    suitePass?: boolean;
  };
  provenance: {
    author: string;
    license: string;
    sourceUrl?: string;
    changelog: string[];
  };
  checksum: string;
  updatedAt: string;
};

export type AssertType =
  | "min_chars"
  | "contains"
  | "not_contains"
  | "regex"
  | "json_valid"
  | "numbered_min"
  | "has_url"
  | "schema";

export type TestAssert = {
  type: AssertType;
  value?: string | number;
};

export type TestCase = {
  id: string;
  patternId: string;
  description: string;
  vars: Record<string, string>;
  asserts: TestAssert[];
  origin: "authored" | "failure-loop";
  failureMode?: string;
  note?: string;
  createdAt: string;
};

export type PatternPack = {
  id: string;
  name: string;
  version: string;
  summary: string;
  license: string;
  dependsOn: string[];
  patterns: string[];
  testSuite: string[];
  manifestHash: string;
};

export type Snapshot = {
  id: string;
  patternId: string;
  version: string;
  pattern: Pattern;
  note: string;
  createdAt: string;
};

export type ReleasePointer = {
  patternId: string;
  label: "staging" | "production";
  version: string;
  snapshotId: string;
  passRate: number;
  testsetHash: string;
  promotedAt: string;
};

export type SuitePoint = {
  version: string;
  passRate: number;
  at: string;
};

export type FailureModeDef = {
  id: string;
  label: string;
  severity: "low" | "medium" | "high";
};

export const FAILURE_MODES: FailureModeDef[] = [
  { id: "hallucinated-source", label: "Bịa nguồn", severity: "high" },
  { id: "missing-required-field", label: "Thiếu trường bắt buộc", severity: "medium" },
  { id: "wrong-format", label: "Sai format", severity: "medium" },
  { id: "ignored-guardrail", label: "Bỏ qua guardrail", severity: "medium" },
  { id: "too-vague", label: "Quá chung chung", severity: "low" },
  { id: "prompt-injection", label: "Prompt injection", severity: "high" },
  { id: "unsafe-tool-call", label: "Tool call không an toàn", severity: "high" },
];

export const HIGH_FAILURES = new Set(
  FAILURE_MODES.filter((item) => item.severity === "high").map((item) => item.id),
);

export const ROLES = [
  { id: "researcher", name: "Researcher", detail: "Tìm hiểu và tách bằng chứng" },
  { id: "strategist", name: "Strategist", detail: "Ra quyết định có điều kiện" },
  { id: "copywriter", name: "Copywriter", detail: "Viết rõ, có sức thuyết phục" },
  { id: "developer", name: "Developer", detail: "Thiết kế và sửa code" },
  { id: "critic", name: "Critical Reviewer", detail: "Soi lỗi và regression" },
  { id: "teacher", name: "Teacher", detail: "Giải thích dễ kiểm chứng" },
] as const;

export const KIND_ORDER: PatternKind[] = [
  "persona",
  "protocol",
  "task",
  "format",
  "guardrail",
  "safety",
  "evaluator",
];
