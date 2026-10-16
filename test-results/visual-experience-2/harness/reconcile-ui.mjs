// Visual Experience 2.0 Gate I: the owner's reconciliation review, driven through the real UI against a DISPOSABLE Host
// (seed-host.mjs) that holds a real "Outcome uncertain" task produced by the Host's own N-C policy. Steps:
//   1. the review renders on Approvals in three themes with Host facts and only retry/close choices;
//   2. "Back" on the confirmation sends nothing;
//   3. "Close without retrying" + confirm sends task.reconcile once; the Host records the review and replays nothing
//      (task count unchanged, no new linked task, reconciliation cleared).
// Usage: node reconcile-ui.mjs <base> <host-state.json> <outDir>
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [base, statePath, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const state = JSON.parse(readFileSync(statePath, "utf8"));
const token = JSON.parse(readFileSync(state.credentialsFile, "utf8")).token;
const hostState = async () => (await fetch(`http://127.0.0.1:${state.port}/state`, { headers: { authorization: `Bearer ${token}` } })).json();
const taskOf = (snapshot) => snapshot.tasks.find((task) => task.id === state.uncertainTaskId);
const receipt = { base, host: state.port, classification: "LIVE UI against a DISPOSABLE Host", steps: [], ok: true };
const check = (name, pass, detail = null) => {
  receipt.steps.push({ name, pass: !!pass, detail });
  if (!pass) receipt.ok = false;
  console.log(`${pass ? "ok " : "FAIL"} ${name}${detail ? ` — ${JSON.stringify(detail)}` : ""}`);
};

const before = await hostState();
check("Host holds the uncertain task", taskOf(before)?.reconciliation?.required === true, { dispatch: taskOf(before)?.dispatch, reason: taskOf(before)?.reconciliation?.reason });
const browser = await chromium.launch();
const sent = [];
const open = async (theme, variant) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: variant });
  const page = await context.newPage();
  page.on("request", (request) => {
    // Commands go through the commandBunnyHost server function; match the action name in its serialized payload.
    const body = request.method() === "POST" ? (request.postData() ?? "") : "";
    for (const action of ["task.reconcile", "mission.reconcile", "task.retry", "task.create"]) if (body.includes(`"${action}"`)) sent.push(action);
  });
  await page.goto(`${base}/?view=approvals&theme=${variant}&uitheme=${theme}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForFunction((id) => !!document.querySelector(`[data-ui-theme="${id}"]`) && !!document.querySelector('.stream-indicator[data-connection="live"]') && !!document.querySelector(".rc-review"), theme, { timeout: 120_000 });
  await page.waitForTimeout(2_000);
  return { context, page };
};

for (const [theme, variant] of [["glass", "light"], ["cyberpunk", "dark"], ["editorial", "light"]]) {
  const { context, page } = await open(theme, variant);
  const card = page.locator(".rc-card").first();
  const text = await card.textContent();
  check(`${theme}: headline and Host facts shown`, (await page.locator("#rc-heading").textContent()).includes("Outcome uncertain") && /may have started/.test(text) && /Nothing is replayed automatically/.test(text));
  const labels = await card.locator(".rc-choices button").allInnerTexts();
  check(`${theme}: only retry/close choices`, JSON.stringify(labels) === JSON.stringify(["Retry as a new task", "Close without retrying"]), labels);
  await page.screenshot({ path: join(out, `reconcile-${theme}-${variant}.png`), fullPage: true, animations: "disabled" });
  await context.close();
}

// Back sends nothing.
let { context, page } = await open("glass", "light");
await page.getByRole("button", { name: "Close without retrying" }).click();
await page.getByRole("group", { name: "Confirm your decision" }).waitFor();
const focused = () => page.evaluate(() => document.activeElement?.textContent?.trim() ?? null);
check("keyboard: focus moves to Confirm", (await focused()) === "Confirm: Close without retrying", await focused());
await page.screenshot({ path: join(out, "reconcile-confirm-glass-light.png"), fullPage: true, animations: "disabled" });
await page.getByRole("button", { name: "Back" }).click();
await page.waitForTimeout(1_000);
check("keyboard: Back returns focus to the choice", (await focused()) === "Close without retrying", await focused());
check("Back sends no command", !sent.includes("task.reconcile"), sent);
check("Host unchanged after Back", taskOf(await hostState())?.reconciliation?.required === true);

// Close + confirm sends exactly one task.reconcile; nothing is replayed.
await page.getByRole("button", { name: "Close without retrying" }).click();
await page.getByRole("button", { name: "Confirm: Close without retrying" }).click();
await page.waitForFunction(() => !document.querySelector(".rc-review"), null, { timeout: 30_000 }).catch(() => {});
await page.waitForTimeout(1_500);
await page.screenshot({ path: join(out, "reconcile-after-close-glass-light.png"), fullPage: true, animations: "disabled" });
const after = await hostState();
const task = taskOf(after);
check("exactly one task.reconcile sent", sent.filter((action) => action === "task.reconcile").length === 1, sent);
check("Host cleared the reconciliation", task && !task.reconciliation?.required, { state: task?.state, reconciliation: task?.reconciliation });
check("no replay: task count unchanged", after.tasks.length === before.tasks.length, { before: before.tasks.length, after: after.tasks.length });
check("no new linked task", !after.tasks.some((row) => row.id !== state.uncertainTaskId && JSON.stringify(row).includes(state.uncertainTaskId)));
check("review gone from Approvals", (await page.locator(".rc-review").count()) === 0);
await context.close();
await browser.close();
receipt.commandsSent = sent;
writeFileSync(join(out, "reconcile-ui.json"), JSON.stringify(receipt, null, 2));
console.log(JSON.stringify({ ok: receipt.ok, steps: receipt.steps.length }));
process.exit(receipt.ok ? 0 : 1);
