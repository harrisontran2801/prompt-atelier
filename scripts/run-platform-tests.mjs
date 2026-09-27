#!/usr/bin/env node
/**
 * Platform tests are not Prompt Atelier proof.
 * They run with an empty cwd so public/og.jpg and src/lib/og/site.json
 * (valid Prompt Atelier brand) do not leak into generic PWA assertions.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const skill = join(root, ".grok/skills/og/SKILL.md");
const refs = join(root, ".grok/skills/og/references");
const shipped = existsSync(skill) && existsSync(refs);

if (shipped) {
  console.log("Platform fixtures: .grok/skills/og is present in this checkout.");
} else {
  console.log(
    "PLATFORM FIXTURE NOTE: .grok/skills/og/SKILL.md and references are not shipped with Prompt Atelier. Tests that pin those files fail only because the fixture is absent. src/lib/og/site.json and public/og.jpg stay as the Atelier card; this run uses an empty cwd so those assets are not read.",
  );
}

function walk(dir, acc = []) {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, name.name);
    if (name.isDirectory()) walk(path, acc);
    else if (name.name.endsWith(".test.mjs")) acc.push(path);
  }
  return acc;
}

const files = [
  ...walk(join(root, "scripts")),
  join(root, "src/lib/app-data/app-data.test.ts"),
  join(root, "src/lib/app-data/readiness-schedule.test.ts"),
  join(root, "src/lib/auth/gate-identity.test.ts"),
  join(root, "src/lib/auth/sign-in-gate.test.ts"),
];

const cwd = mkdtempSync(join(tmpdir(), "atelier-platform-"));
const result = spawnSync(process.execPath, ["--experimental-strip-types", "--test", ...files], {
  cwd,
  stdio: "inherit",
});
process.exit(result.status ?? 1);
