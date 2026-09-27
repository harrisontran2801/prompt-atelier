#!/usr/bin/env node
/**
 * User-flow smoke for Prompt Atelier. Not a platform brand check.
 * Requires the dev server on ATELIER_URL (default http://127.0.0.1:8080).
 */
import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = process.env.ATELIER_URL ?? "http://127.0.0.1:8080";
const SECRET_EMAIL = "ada@example.com";
const SECRET_TOKEN = "sk-supersecretvalue";

function card(page, name) {
  return page.locator("article.card", { has: page.getByRole("heading", { name, exact: true }) });
}

async function ensureLibrary(page) {
  const heading = page.getByRole("heading", { name: "Pattern có bằng chứng, không phải snippet." });
  if (await heading.isVisible().catch(() => false)) return;
  const libraryBtn = page.getByRole("button", { name: "Thư viện" });
  if (!(await libraryBtn.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: "Mở menu" }).click();
  }
  await libraryBtn.click();
  await heading.waitFor();
}

async function fresh(page) {
  await page.goto(base, { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.removeItem("prompt-atelier-workspace-v1"));
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Bạn muốn hoàn thành việc gì?" }).waitFor();
}

async function runSuite(page) {
  const button = page.getByRole("button", { name: "Chạy cả suite" });
  await button.click();
  await page.getByRole("button", { name: "Đang chạy suite…" }).waitFor({ timeout: 2000 }).catch(() => {});
  await page.getByRole("button", { name: "Chạy cả suite" }).waitFor();
  await page.getByText(/Suite xanh 100%/).waitFor();
}

async function openPattern(page, name) {
  await page.getByRole("button", { name: "Thư viện" }).click();
  await card(page, name).getByRole("button", { name: "Open" }).click();
  await page.getByRole("button", { name: "Blocks" }).waitFor();
}

const browser = await chromium.launch({ headless: true });
const pageErrors = [];
const consoleErrors = [];

function watch(page) {
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (/grok\.com|fonts\.googleapis|favicon/i.test(text)) return;
    consoleErrors.push(text);
  });
}

const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await desktop.newPage();
watch(page);

try {
  await fresh(page);
  await page.getByRole("button", { name: "Dùng ví dụ: Trả lời khách hàng" }).click();
  await page.getByRole("button", { name: "Xem kết quả ngay" }).click();
  await page.getByRole("region", { name: "Vì sao tin được kết quả này" }).waitFor();
  await page.getByText("Chạy trên máy. Không gọi mạng.").waitFor();
  await page.getByRole("button", { name: "Lưu workflow này" }).click();
  await page.getByText(/Đã lưu workflow/).waitFor();
  const overflowQuick = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  assert.ok(overflowQuick <= 1, `quick desktop overflow ${overflowQuick}`);

  await ensureLibrary(page);
  const allCount = await page.locator("article.card").count();
  assert.ok(allCount >= 8, `library rendered ${allCount} cards`);

  await page.getByPlaceholder("Tìm tên hoặc mô tả").fill("xyzzy-no-such-pattern");
  await page.getByText("Không có pattern khớp").waitFor();
  await page.getByPlaceholder("Tìm tên hoặc mô tả").fill("Research brief");
  await card(page, "Research brief").waitFor();
  assert.equal(await page.locator("article.card").count(), 1);

  await page.locator(".filters select").nth(1).selectOption("verified");
  await page.getByPlaceholder("Tìm tên hoặc mô tả").fill("");
  await card(page, "Research brief").waitFor();
  assert.equal(await page.locator("article.card", { hasText: "draft" }).count(), 0);
  await page.locator(".filters select").nth(1).selectOption("");

  await openPattern(page, "Research brief");
  const directive = page.getByRole("textbox", { name: "Directive" });
  const original = await directive.inputValue();
  await directive.fill(`${original}\nQA marker local.`);
  await page.reload({ waitUntil: "networkidle" });
  await openPattern(page, "Research brief");
  assert.match(await page.getByRole("textbox", { name: "Directive" }).inputValue(), /QA marker local/);

  await page.getByRole("button", { name: "Test lab" }).click();
  const topic = page.getByRole("textbox", { name: /topic/ });
  await topic.waitFor();
  assert.match(await topic.inputValue(), /AI writing tools/);
  await topic.fill("OVERRIDE_TOKEN_91");
  await page.getByRole("button", { name: "Chạy case" }).click();
  await page.locator("pre.prose").filter({ hasText: "OVERRIDE_TOKEN_91" }).waitFor();
  const savedTopic = await page.evaluate(() => {
    const raw = localStorage.getItem("prompt-atelier-workspace-v1");
    const data = JSON.parse(raw);
    return data.tests.find((item) => item.id === "tst.research.1").vars.topic;
  });
  assert.equal(savedTopic, "AI writing tools");

  await runSuite(page);
  await page.getByText(/hash [0-9a-f]{8}/).waitFor();

  await page.getByPlaceholder("Ghi chú ngắn").fill(`mail ${SECRET_EMAIL} token ${SECRET_TOKEN} card 4242424242424242 phone +84 912 345 678`);
  await page.getByRole("button", { name: "Report failure" }).click();
  await page.getByRole("button", { name: /Failure / }).first().waitFor();
  const stored = await page.evaluate(() => localStorage.getItem("prompt-atelier-workspace-v1") ?? "");
  assert.equal(stored.includes(SECRET_EMAIL), false);
  assert.equal(stored.includes(SECRET_TOKEN), false);
  assert.equal(stored.includes("4242424242424242"), false);
  await runSuite(page);

  await page.getByRole("button", { name: "Thư viện" }).click();
  await card(page, "Research brief").getByRole("button", { name: "Add to stack" }).click();
  await page.getByRole("button", { name: "Thư viện" }).click();
  await card(page, "Five-part memo").getByRole("button", { name: "Add to stack" }).click();
  await page.getByText(/Task và Format/).waitFor();
  await page.locator("strong", { hasText: "Five-part memo" }).waitFor();
  await page.getByText(/trong prompt|ngoài prompt/).first().waitFor();

  await page.getByRole("button", { name: "Thư viện" }).click();
  await card(page, "Pragmatic code review").getByRole("button", { name: "Open" }).click();
  await page.getByRole("button", { name: "Release" }).click();
  const blocked = page.getByRole("button", { name: "Promote to Production" });
  assert.equal(await blocked.isDisabled(), true);
  await page.getByText("Promote to Production đang tắt vì:").waitFor();
  assert.ok((await page.locator("#production-reasons li").count()) >= 1);

  await openPattern(page, "Research brief");
  await page.getByRole("button", { name: "Release" }).click();
  const promote = page.getByRole("button", { name: "Promote to Production" });
  assert.equal(await promote.isDisabled(), true);
  await page.getByRole("checkbox", { name: /anti-use-case/ }).check();
  await expectEnabled(promote);
  await promote.click();
  await page.getByText(/Production pointer: v/).waitFor();
  const firstSnap = await page.getByRole("button", { name: "Rollback pointer" }).count();
  assert.ok(firstSnap >= 1);

  const version = page.getByRole("textbox", { name: "Version" });
  await page.getByRole("button", { name: "Blocks" }).click();
  await version.fill("1.3.0");
  await page.getByRole("button", { name: "Test lab" }).click();
  await runSuite(page);
  await page.getByRole("button", { name: "Release" }).click();
  await page.getByRole("checkbox", { name: /anti-use-case/ }).check();
  await page.getByRole("button", { name: "Promote to Production" }).click();
  await page.getByText("Production pointer: v1.3.0").waitFor();
  assert.ok((await page.getByRole("button", { name: "Rollback pointer" }).count()) >= 2);
  await page.getByRole("button", { name: "Rollback pointer" }).first().click();
  await page.getByText(/Production pointer: v1\.2\.0/).waitFor();
  assert.ok((await page.getByRole("button", { name: "Rollback pointer" }).count()) >= 2);

  await page.getByRole("button", { name: "Gói pattern" }).click();
  const beforeImport = await page.evaluate(() => localStorage.getItem("prompt-atelier-workspace-v1"));
  await page.locator('input[aria-label="Import pack JSON"]').setInputFiles({
    name: "bad.json",
    mimeType: "application/json",
    buffer: Buffer.from("{not json", "utf8"),
  });
  await page.getByText(/Không đọc được JSON/).waitFor();
  const afterBad = await page.evaluate(() => localStorage.getItem("prompt-atelier-workspace-v1"));
  assert.equal(afterBad, beforeImport);

  const hijack = {
    pack: {
      id: "pack.evil",
      name: "Evil",
      version: "9.0.0",
      summary: "nope",
      license: "MIT",
      dependsOn: [],
      patterns: ["pat.task.research-brief"],
      testSuite: [],
      manifestHash: "x",
    },
    patterns: [
      {
        id: "pat.task.research-brief",
        version: "9.9.9",
        name: "Hijack",
        summary: "overwrite",
        useCase: "x",
        antiUseCase: "x",
        kind: "task",
        category: "Research & Evidence",
        tags: [],
        roles: [],
        status: "production",
        components: { directive: "H", context: "", task: "H", guardrails: "", output: "" },
        variables: [],
        outputContract: "",
        testCaseIds: [],
        evaluatorIds: [],
        failureModes: [],
        compatibleModels: [],
        redTeamNotes: "",
        evidence: { nTests: 0, verifiedModels: [] },
        provenance: { author: "x", license: "MIT", changelog: [] },
        checksum: "x",
        updatedAt: "2026-09-01T00:00:00.000Z",
      },
    ],
    tests: [],
  };
  await page.locator('input[aria-label="Import pack JSON"]').setInputFiles({
    name: "hijack.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(hijack), "utf8"),
  });
  await page.getByText(/không ghi đè/).waitFor();
  await page.getByRole("button", { name: "Thư viện" }).click();
  await card(page, "Research brief").waitFor();
  await page.getByRole("heading", { name: "Hijack import" }).waitFor();

  const overflowDesktop = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  assert.ok(overflowDesktop <= 1, `desktop overflow ${overflowDesktop}`);
} catch (error) {
  console.error("DESKTOP FLOW FAILED");
  console.error(error);
  process.exitCode = 1;
}

async function expectEnabled(button) {
  await page.waitForFunction((el) => el && !el.disabled, await button.elementHandle());
}

const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
const phone = await mobile.newPage();
watch(phone);
try {
  await fresh(phone);
  await phone.getByRole("heading", { name: "Bạn muốn hoàn thành việc gì?" }).waitFor();
  await phone.getByRole("button", { name: "Dùng ví dụ: So sánh lựa chọn" }).click();
  await phone.getByRole("button", { name: "Xem kết quả ngay" }).click();
  await phone.getByRole("region", { name: "Vì sao tin được kết quả này" }).waitFor();
  const overflow = await phone.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  assert.ok(overflow <= 1, `mobile overflow ${overflow}`);
  await phone.getByRole("button", { name: "Mở menu" }).click();
  await phone.getByRole("button", { name: "Thư viện" }).waitFor();
} catch (error) {
  console.error("MOBILE FLOW FAILED");
  console.error(error);
  process.exitCode = 1;
}

await browser.close();

if (pageErrors.length) {
  console.error("UNCAUGHT", pageErrors);
  process.exitCode = 1;
}
if (consoleErrors.length) {
  console.error("CONSOLE", consoleErrors);
  process.exitCode = 1;
}
if (!process.exitCode) console.log("atelier smoke: desktop + mobile flows passed");
