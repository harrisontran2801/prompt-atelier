import { runAsserts, type AssertResult } from "./assert.ts";
import { compilePattern } from "./compose.ts";
import { sandboxAnswer } from "./sandbox.ts";
import type { Pattern, TestCase } from "./types.ts";

/** Copy of the saved case, used to prefill the Test Lab form. */
export function caseFormVars(test: Pick<TestCase, "vars">): Record<string, string> {
  return { ...test.vars };
}

/**
 * Vars that one case run will actually use.
 * An override wins key-by-key and never writes back onto the saved case.
 * Omit the override (suite) to run the stored vars.
 */
export function resolveRunVars(
  test: Pick<TestCase, "vars">,
  override?: Record<string, string>,
): Record<string, string> {
  if (!override) return { ...test.vars };
  return { ...test.vars, ...override };
}

export function caseUserInput(vars: Record<string, string>): string {
  return Object.entries(vars)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
}

export function sandboxCaseOutput(pattern: Pattern, vars: Record<string, string>): string {
  const compiled = compilePattern(pattern, vars, false);
  return sandboxAnswer(compiled, caseUserInput(vars));
}

export function runSandboxCase(
  pattern: Pattern,
  test: TestCase,
  override?: Record<string, string>,
): { vars: Record<string, string>; output: string; checks: AssertResult[]; ok: boolean } {
  const vars = resolveRunVars(test, override);
  const output = sandboxCaseOutput(pattern, vars);
  const checks = runAsserts(output, test.asserts, pattern.outputSchema);
  return { vars, output, checks, ok: checks.every((item) => item.ok) };
}

/** Suite always reads saved cases. A form override is not an argument. */
export function suiteSandboxOutputs(pattern: Pattern, tests: TestCase[]): string[] {
  return tests
    .filter((item) => item.patternId === pattern.id)
    .map((item) => sandboxCaseOutput(pattern, item.vars));
}
