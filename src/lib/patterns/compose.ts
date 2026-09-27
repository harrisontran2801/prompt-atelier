import type { Pattern, PatternKind, PromptComponents, VariableDef } from "./types";

export type StackState = {
  personaId?: string;
  protocolIds: string[];
  taskId?: string;
  formatId?: string;
  guardrailIds: string[];
  safetyIds: string[];
  evaluatorIds: string[];
  /** conflictId -> chosen pattern id or "format" | "task" */
  resolutions: Record<string, string>;
};

export type Conflict = {
  id: string;
  message: string;
  blocking: boolean;
  options: Array<{ id: string; label: string }>;
};

export type SourceLine = {
  kind: PatternKind | "code";
  id: string;
  name: string;
  included: boolean;
  note: string;
};

const EMPTY: PromptComponents = {
  directive: "",
  context: "",
  task: "",
  guardrails: "",
  output: "",
};

export const emptyStack = (): StackState => ({
  protocolIds: [],
  guardrailIds: [],
  safetyIds: [],
  evaluatorIds: [],
  resolutions: {},
});

export function fillTemplate(
  text: string,
  vars: Record<string, string>,
  variables: VariableDef[],
  maskSecrets: boolean,
) {
  const secrets = new Set(variables.filter((item) => item.secret).map((item) => item.name));
  return text.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, name: string) => {
    const variable = variables.find((item) => item.name === name);
    const raw = vars[name];
    const value = raw?.trim() ? raw : variable?.default != null ? String(variable.default) : "";
    if (!value) return `{{${name}}}`;
    if (maskSecrets && secrets.has(name)) return "••••";
    return value;
  });
}

export function missingRequired(variables: VariableDef[], vars: Record<string, string>) {
  return variables.filter((item) => {
    if (!item.required) return false;
    const raw = vars[item.name]?.trim();
    if (raw) return false;
    return item.default == null || String(item.default).trim() === "";
  });
}

function wantsJson(text: string) {
  return /\bjson\b/i.test(text);
}

function oppositeGuard(a: string, b: string) {
  const pairs: Array<[RegExp, RegExp]> = [
    [/không bịa|do not invent|không bịa số/i, /được bịa|may invent|cứ bịa/i],
    [/luôn trả lời|always answer/i, /từ chối|refuse|không trả lời/i],
    [/không dùng tool|không gọi tool/i, /tự gọi tool|call tools freely/i],
  ];
  return pairs.some(([left, right]) => (left.test(a) && right.test(b)) || (left.test(b) && right.test(a)));
}

export function compileStack(stack: StackState, patterns: Pattern[]): {
  compiled: string;
  conflicts: Conflict[];
  sources: SourceLine[];
  evaluatorNames: string[];
} {
  const byId = new Map(patterns.map((item) => [item.id, item]));
  const pick = (id?: string) => (id ? byId.get(id) : undefined);
  const conflicts: Conflict[] = [];
  const sources: SourceLine[] = [];

  const persona = pick(stack.personaId);
  if (persona) {
    sources.push({ kind: "persona", id: persona.id, name: persona.name, included: true, note: "Persona chính" });
  }

  const protocols = stack.protocolIds.map(pick).filter(Boolean) as Pattern[];
  protocols.forEach((item) =>
    sources.push({ kind: "protocol", id: item.id, name: item.name, included: true, note: "Protocol" }),
  );

  const task = pick(stack.taskId);
  const format = pick(stack.formatId);
  if (task) sources.push({ kind: "task", id: task.id, name: task.name, included: true, note: "Task" });
  if (format) sources.push({ kind: "format", id: format.id, name: format.name, included: true, note: "Output format" });

  if (task && format && wantsJson(task.components.output + task.outputContract) !== wantsJson(format.components.output + format.outputContract)) {
    const choice = stack.resolutions["format-vs-task"] ?? "format";
    conflicts.push({
      id: "format-vs-task",
      blocking: false,
      message: "Task và Format mô tả hợp đồng đầu ra khác nhau. Format thắng mặc định — bạn có thể đổi.",
      options: [
        { id: "format", label: format.name },
        { id: "task", label: task.name },
      ],
    });
    if (choice === "task") {
      sources.find((item) => item.id === format.id)!.note = "Bị task ghi đè phần format";
    }
  }

  const guards = [...stack.guardrailIds.map(pick), ...stack.safetyIds.map(pick)].filter(Boolean) as Pattern[];
  const safety = guards.filter((item) => item.kind === "safety");
  const plain = guards.filter((item) => item.kind !== "safety");

  for (let i = 0; i < plain.length; i += 1) {
    for (let j = i + 1; j < plain.length; j += 1) {
      if (oppositeGuard(plain[i].components.guardrails, plain[j].components.guardrails)) {
        const id = `guard-${plain[i].id}-${plain[j].id}`;
        conflicts.push({
          id,
          blocking: !stack.resolutions[id],
          message: `Guardrail trái dấu giữa “${plain[i].name}” và “${plain[j].name}”. Chọn một. Không merge thầm.`,
          options: [
            { id: plain[i].id, label: plain[i].name },
            { id: plain[j].id, label: plain[j].name },
          ],
        });
      }
    }
  }

  const dropped = new Set<string>();
  for (const conflict of conflicts) {
    if (!conflict.id.startsWith("guard-")) continue;
    const chosen = stack.resolutions[conflict.id];
    if (!chosen) continue;
    for (const option of conflict.options) {
      if (option.id !== chosen) dropped.add(option.id);
    }
  }

  safety.forEach((item) =>
    sources.push({ kind: "safety", id: item.id, name: item.name, included: true, note: "Safety thắng mọi lớp — code vẫn redact riêng" }),
  );
  plain.forEach((item) =>
    sources.push({
      kind: "guardrail",
      id: item.id,
      name: item.name,
      included: !dropped.has(item.id),
      note: dropped.has(item.id) ? "Bỏ vì xung đột" : "Union guardrail",
    }),
  );

  const evaluators = stack.evaluatorIds.map(pick).filter(Boolean) as Pattern[];
  evaluators.forEach((item) =>
    sources.push({
      kind: "evaluator",
      id: item.id,
      name: item.name,
      included: false,
      note: "Chạy sau inference, không nằm trong prompt",
    }),
  );

  const formatWins = (stack.resolutions["format-vs-task"] ?? "format") === "format";
  const blocks: PromptComponents = { ...EMPTY };
  const push = (pattern: Pattern | undefined, part: keyof PromptComponents, into: keyof PromptComponents) => {
    if (!pattern) return;
    const chunk = pattern.components[part]?.trim();
    if (!chunk) return;
    blocks[into] = blocks[into] ? `${blocks[into]}\n\n${chunk}` : chunk;
  };

  if (persona) push(persona, "directive", "directive");
  protocols.forEach((item) => push(item, "directive", "directive"));
  protocols.forEach((item) => push(item, "task", "task"));
  if (task) {
    push(task, "directive", "directive");
    push(task, "context", "context");
    push(task, "task", "task");
    push(task, "guardrails", "guardrails");
    if (!format || !formatWins) push(task, "output", "output");
  }
  if (format && (formatWins || !task)) push(format, "output", "output");
  safety.forEach((item) => push(item, "guardrails", "guardrails"));
  plain.filter((item) => !dropped.has(item.id)).forEach((item) => push(item, "guardrails", "guardrails"));

  const compiled = [
    blocks.directive && `# Directive\n${blocks.directive}`,
    blocks.context && `# Context\n${blocks.context}`,
    blocks.task && `# Task\n${blocks.task}`,
    blocks.guardrails && `# Guardrails\n${blocks.guardrails}`,
    blocks.output && `# Output contract\n${blocks.output}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    compiled,
    conflicts,
    sources,
    evaluatorNames: evaluators.map((item) => item.name),
  };
}

export function compilePattern(pattern: Pattern, vars: Record<string, string>, maskSecrets: boolean) {
  const filled = (Object.keys(pattern.components) as Array<keyof PromptComponents>).reduce(
    (acc, key) => {
      acc[key] = fillTemplate(pattern.components[key], vars, pattern.variables, maskSecrets);
      return acc;
    },
    { ...EMPTY },
  );
  return [
    filled.directive && `# Directive\n${filled.directive}`,
    filled.context && `# Context\n${filled.context}`,
    filled.task && `# Task\n${filled.task}`,
    filled.guardrails && `# Guardrails\n${filled.guardrails}`,
    (filled.output || pattern.outputContract) &&
      `# Output contract\n${filled.output || pattern.outputContract}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function addPatternToStack(stack: StackState, pattern: Pattern): { stack: StackState; notice?: string } {
  const next: StackState = {
    ...stack,
    protocolIds: [...stack.protocolIds],
    guardrailIds: [...stack.guardrailIds],
    safetyIds: [...stack.safetyIds],
    evaluatorIds: [...stack.evaluatorIds],
    resolutions: { ...stack.resolutions },
  };
  if (pattern.kind === "persona") {
    if (next.personaId && next.personaId !== pattern.id) {
      return { stack, notice: "Chỉ một persona chính. Gỡ persona hiện tại trước khi thêm." };
    }
    next.personaId = pattern.id;
  } else if (pattern.kind === "protocol") {
    if (!next.protocolIds.includes(pattern.id)) next.protocolIds.push(pattern.id);
  } else if (pattern.kind === "task") {
    next.taskId = pattern.id;
  } else if (pattern.kind === "format") {
    next.formatId = pattern.id;
  } else if (pattern.kind === "guardrail") {
    if (!next.guardrailIds.includes(pattern.id)) next.guardrailIds.push(pattern.id);
  } else if (pattern.kind === "safety") {
    if (!next.safetyIds.includes(pattern.id)) next.safetyIds.push(pattern.id);
  } else if (pattern.kind === "evaluator") {
    if (!next.evaluatorIds.includes(pattern.id)) next.evaluatorIds.push(pattern.id);
  }
  return { stack: next };
}
