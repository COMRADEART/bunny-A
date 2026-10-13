// T13.1 key-form interaction probe (disposable Host, saved phase). Never screenshots a revealed key.
// Checks: Replace opens a password field; Show reveals with aria-pressed; it hides itself after 20 s; Save clears the field,
// returns to the mask and the key never reaches localStorage/sessionStorage or the console.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = process.env.T131_BASE ?? "http://127.0.0.1:8093";
const KEY = "ts_FIXTURE_screenshot_not_a_real_key_111";
const browser = await chromium.launch({ headless: true });
const result = {};
const consoleText = [];
try {
  const page = await (await browser.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
  page.on("console", (message) => consoleText.push(message.text()));
  await page.goto(`${BASE}/?view=settings&theme=light`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(2500);
  await page.getByRole("navigation", { name: "Settings groups" }).getByRole("button", { name: "AI & Models" }).click();
  await page.getByRole("button", { name: "Replace" }).click();
  const input = page.getByLabel("New TypeSafe API key");
  result.inputType = await input.getAttribute("type");
  result.autocomplete = await input.getAttribute("autocomplete");
  await input.fill(KEY);
  const show = page.getByRole("button", { name: /Show|Hide/ });
  await show.click();
  result.revealedType = await input.getAttribute("type");
  result.revealedPressed = await show.getAttribute("aria-pressed");
  await page.waitForTimeout(21_000);
  result.autoHiddenType = await input.getAttribute("type");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.waitForTimeout(2500);
  result.formClosed = (await page.getByLabel("New TypeSafe API key").count()) === 0;
  result.maskVisible = await page.getByLabel("Saved API key, hidden").isVisible();
  result.status = (await page.locator('[role="status"]').allTextContents()).map((text) => text.trim()).filter(Boolean);
  result.keyInDom = (await page.content()).includes(KEY);
  result.keyInStorage = await page.evaluate((key) => JSON.stringify({ ...localStorage, ...sessionStorage }).includes(key), KEY);
  result.keyInConsole = consoleText.some((text) => text.includes(KEY));
  await page.screenshot({ path: resolve("test-results/ma3/t13-1/shots/ai-models-key-replaced-desktop-light.png"), fullPage: true });
} finally {
  await browser.close();
}
result.pass = result.inputType === "password" && result.revealedType === "text" && result.revealedPressed === "true" && result.autoHiddenType === "password" && result.formClosed && result.maskVisible && !result.keyInDom && !result.keyInStorage && !result.keyInConsole;
writeFileSync(resolve("test-results/ma3/t13-1/key-form-probe.json"), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result));
