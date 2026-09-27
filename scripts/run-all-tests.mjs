#!/usr/bin/env node
/** Runs Atelier domain tests and platform tests as separate reports. */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function run(label, args) {
  console.log(`\n=== ${label} ===\n`);
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: "inherit" });
  return result.status ?? 1;
}

const atelier = run("Prompt Atelier", [
  "--experimental-strip-types",
  "--test",
  join(root, "src/lib/patterns/atelier.test.ts"),
  join(root, "src/lib/product/product.test.ts"),
  join(root, "src/lib/product/hosted-economy.test.ts"),
]);
const platform = run("Platform (not Atelier proof)", [join(root, "scripts/run-platform-tests.mjs")]);

console.log(`\nAtelier domain tests: ${atelier === 0 ? "passed" : "FAILED"}`);
console.log(`Platform tests: ${platform === 0 ? "passed" : "FAILED"}`);
console.log("Platform pass/fail does not certify the pattern library.");
process.exit(atelier !== 0 || platform !== 0 ? 1 : 0);
