export type StructuralEval = {
  score: number;
  checks: Array<{ id: string; ok: boolean; label: string }>;
};

export function evalOutput(output: string, contract: string): StructuralEval {
  const text = output.trim();
  const contractLower = contract.toLowerCase();
  const wantsNumbered = /1\.|^\s*\d+\./m.test(contract) || contractLower.includes("gồm");
  const wantsJson = contractLower.includes("json");
  const wantsTable = contractLower.includes("bảng") || contractLower.includes("table");
  const wantsSources = contractLower.includes("nguồn") || contractLower.includes("url") || contractLower.includes("source");
  const numbered = (text.match(/^\s*\d+\.\s/gm) ?? []).length;
  const hasUrl = /https?:\/\//i.test(text);
  const looksJson = /^\s*[{\[]/.test(text);
  const longEnough = text.length >= 80;
  const notRefusal = !/không thể|i cannot|as an ai/i.test(text.slice(0, 200));

  const checks = [
    { id: "length", ok: longEnough, label: "Output đủ dài để dùng" },
    { id: "refusal", ok: notRefusal, label: "Không phải câu từ chối chung" },
    { id: "numbered", ok: !wantsNumbered || numbered >= 3, label: "Đúng format đánh số nếu contract yêu cầu" },
    { id: "json", ok: !wantsJson || looksJson, label: "JSON nếu contract yêu cầu JSON" },
    { id: "table", ok: !wantsTable || /\|.+\||\t|,/.test(text) || numbered >= 3, label: "Có bảng / danh sách so sánh" },
    { id: "sources", ok: !wantsSources || hasUrl, label: "Có URL nguồn khi contract đòi nguồn" },
  ];
  const passed = checks.filter((item) => item.ok).length;
  return { score: Math.round((passed / checks.length) * 100), checks };
}

export function fillVariables(template: string, rawInput: string) {
  const vars: Record<string, string> = {};
  for (const match of rawInput.matchAll(/(?:^|\n)\s*([A-Za-z_][\w-]*)\s*[:=]\s*(.+)$/gm)) {
    vars[match[1]] = match[2].trim();
  }
  try {
    const parsed = JSON.parse(rawInput);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === "string" || typeof value === "number") vars[key] = String(value);
      }
    }
  } catch {
    /* prose */
  }
  return template.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_, name: string) => vars[name.trim()] ?? `{{​${name.trim()}}}`);
}
