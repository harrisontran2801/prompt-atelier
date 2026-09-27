import type { TestAssert } from "./types.ts";

export type AssertResult = {
  type: TestAssert["type"];
  ok: boolean;
  detail: string;
};

function numberedCount(text: string) {
  return (text.match(/^\s*\d+\.\s/gm) ?? []).length;
}

function schemaOk(output: string, schemaRaw?: string) {
  if (!schemaRaw?.trim()) return { ok: true, detail: "Không có schema" };
  let schema: { required?: string[] };
  try {
    schema = JSON.parse(schemaRaw) as { required?: string[] };
  } catch {
    return { ok: false, detail: "Schema không phải JSON" };
  }
  let data: unknown;
  try {
    data = JSON.parse(output);
  } catch {
    return { ok: false, detail: "Output không phải JSON" };
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, detail: "Output không phải object" };
  }
  const missing = (schema.required ?? []).filter((key) => !(key in (data as Record<string, unknown>)));
  if (missing.length) return { ok: false, detail: `Thiếu ${missing.join(", ")}` };
  return { ok: true, detail: "Đủ trường bắt buộc" };
}

export function runAsserts(output: string, asserts: TestAssert[], outputSchema?: string): AssertResult[] {
  return asserts.map((assert) => {
    const value = assert.value;
    switch (assert.type) {
      case "min_chars": {
        const min = Number(value ?? 0);
        const ok = output.trim().length >= min;
        return { type: assert.type, ok, detail: ok ? `≥ ${min} ký tự` : `${output.trim().length} < ${min}` };
      }
      case "contains": {
        const needle = String(value ?? "");
        const ok = output.includes(needle);
        return { type: assert.type, ok, detail: ok ? `có “${needle}”` : `thiếu “${needle}”` };
      }
      case "not_contains": {
        const needle = String(value ?? "");
        const ok = !output.includes(needle);
        return { type: assert.type, ok, detail: ok ? `không chứa “${needle}”` : `còn “${needle}”` };
      }
      case "regex": {
        try {
          const ok = new RegExp(String(value ?? ""), "i").test(output);
          return { type: assert.type, ok, detail: ok ? "khớp regex" : "không khớp regex" };
        } catch {
          return { type: assert.type, ok: false, detail: "regex không hợp lệ" };
        }
      }
      case "json_valid": {
        try {
          JSON.parse(output);
          return { type: assert.type, ok: true, detail: "JSON hợp lệ" };
        } catch {
          return { type: assert.type, ok: false, detail: "JSON hỏng" };
        }
      }
      case "numbered_min": {
        const min = Number(value ?? 1);
        const count = numberedCount(output);
        return { type: assert.type, ok: count >= min, detail: `${count} mục / cần ${min}` };
      }
      case "has_url": {
        const ok = /https?:\/\//i.test(output);
        return { type: assert.type, ok, detail: ok ? "có URL" : "không có URL" };
      }
      case "schema":
        return { type: assert.type, ...schemaOk(output, outputSchema) };
      default:
        return { type: assert.type, ok: false, detail: "assert không hỗ trợ" };
    }
  });
}

export function passRateOf(rows: Array<{ ok: boolean }>) {
  if (!rows.length) return 0;
  return Math.round((rows.filter((row) => row.ok).length / rows.length) * 100);
}
