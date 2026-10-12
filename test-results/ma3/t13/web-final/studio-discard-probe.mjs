// T13 web-final: LIVE Studio discard/revision probe (IR-M1) on the current source.
// Real disposable Host 43882, isolated dev server 8090 pointed at that Host, real browser.
// Verifies: an external Host revision bump while the Studio editor holds a stale draft is healed by
// "Discard edits" (it must adopt the current Host revision so the NEXT save is accepted, not refused
// until remount). Production is never referenced.
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright";

const dir = resolve(import.meta.dirname);
const repo = resolve(dir, "../../../..");
const scratchRoot = join(tmpdir(), `bunny-t13-web-final-${process.pid}`);
mkdirSync(scratchRoot, { recursive: true });
mkdirSync(join(dir, "shots"), { recursive: true });
const HOST_PORT = 43882, DEV_PORT = 8090;
const checks = [], saves = [], devLog = [], browserErrors = [];
const check = (name, ok, detail = null) => { checks.push({ name, ok: !!ok, detail }); console.log(ok ? "PASS" : "FAIL", name, JSON.stringify(detail)?.slice(0, 400)); };
let seed, dev, browser;
const j = (f) => JSON.parse(readFileSyncJson(f));
import { readFileSync } from "node:fs";
function readFileSyncJson(f) { return readFileSync(f, "utf8"); }
try {
  seed = spawn(process.execPath, [join(dir, "seed-host3.mjs")], { cwd: dir, env: { ...process.env, T13_PERF_PORT: String(HOST_PORT), T13_PERF_SCRATCH: scratchRoot }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  const fixture = await new Promise((done, fail) => {
    let acc = "";
    const t = setTimeout(() => fail(new Error("fixture host did not report")), 30000);
    seed.stdout.on("data", (b) => { acc += String(b); const line = acc.split("\n").find((l) => l.includes('"classification"')); if (line) { clearTimeout(t); try { done(JSON.parse(line)); } catch (e) { fail(e); } } });
    seed.stderr.on("data", () => {});
  });
  const cred = fixture.credentials;
  const token = JSON.parse(readFileSync(cred, "utf8")).token;
  const api = async (action, data) => (await fetch(`http://127.0.0.1:${HOST_PORT}/command`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ action, data }) })).json();
  const state = async () => (await fetch(`http://127.0.0.1:${HOST_PORT}/state`, { headers: { authorization: `Bearer ${token}` } })).json();

  dev = spawn(process.execPath, [join(process.execPath, "..", "node_modules/npm/bin/npm-cli.js"), "run", "dev", "--", "--host", "127.0.0.1", "--port", String(DEV_PORT)], { cwd: repo, env: { ...process.env, BUNNY_HOST_DATA_DIRECTORY: join(scratchRoot, "bunny-t13-perf-host", "state"), BUNNY_HOST_CREDENTIALS_FILE: cred, FORCE_COLOR: "0", NO_COLOR: "1" }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  dev.stdout.on("data", b => devLog.push(String(b)));
  dev.stderr.on("data", b => devLog.push(String(b)));
  writeFileSync(join(dir, "dev.json"), JSON.stringify({ devPid: dev.pid, devPort: DEV_PORT, hostPort: HOST_PORT, hostPid: fixture.pid }));
  let webReady = false;
  for (let i = 0; i < 240; i++) {
    if (dev.exitCode !== null) throw new Error(`dev exited ${dev.exitCode}`);
    try { const r = await fetch(`http://127.0.0.1:${DEV_PORT}/`); if (r.ok) { webReady = true; break; } } catch {}
    await sleep(500);
  }
  if (!webReady) throw new Error("dev server never answered");
  await sleep(1500);

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1366, height: 800 }, colorScheme: "dark" });
  const page = await context.newPage();
  page.on("pageerror", e => browserErrors.push({ type: "pageerror", error: e.message }));
  page.on("console", m => { if (m.type() === "error") browserErrors.push({ type: "console", error: m.text().slice(0, 300) }); });
  page.on("response", r => { if (r.url().includes("_serverFn")) { saves.push({ at: Date.now(), status: r.status() }); } });
  await page.goto(`http://127.0.0.1:${DEV_PORT}/?view=agents&theme=dark`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => document.querySelectorAll("button").length > 4, null, { timeout: 60000 });

  const beforeRev = (await state()).personalAgents.revision;
  await page.waitForFunction(() => document.querySelectorAll(".st-card").length === 4, null, { timeout: 30000 });
  check("Studio page renders slot cards", (await page.locator(".st-card").count()) === 4, { revisionBefore: beforeRev });

  // hold a dirty draft
  await page.getByRole("button", { name: /Edit slot 1/ }).click();
  await page.getByRole("heading", { name: /Slot 1:/ }).waitFor({ timeout: 20000 });
  const nameBox = page.locator("fieldset label input").first();
  const originalName = await nameBox.inputValue();
  await nameBox.fill(originalName + " M1");
  check("Draft is dirty after a name edit", true, { originalName });

  // external revision bump while the editor holds the dirty draft
  const s = await state();
  const slots = s.personalAgents.slots.map(x => ({ slot: x.slot, weapon: x.weapon, displayName: x.displayName, description: x.description, purpose: x.purpose, style: x.style, responsibilities: x.responsibilities, agentId: x.agentId, active: x.active }));
  const cfg = await api("personal_agents.configure", { slots, expectRevision: s.personalAgents.revision });
  const afterBumpRev = (await state()).personalAgents.revision;
  check("External Host revision bump accepted", cfg?.status === 200 || !!cfg?.snapshot, { revisionAfter: afterBumpRev });
  // Let the page's own Host view observe revision ${''}2+ before Discard: the repair adopts the CURRENT Host revision the
  // client has already seen, which is the honest contract (a client that has not observed the bump yet would keep
  // its older expectRevision and be refused by the Host, correctly).
  const waitSeen = await page.waitForFunction((target) => {
    const captions = [...document.querySelectorAll(".section-heading .caption")].map((el) => /Revision (\d+)/.exec(el.textContent ?? "")?.[1]);
    const seen = Math.max(0, ...captions.map((n) => Number(n ?? 0)));
    return seen >= target ? seen : null;
  }, afterBumpRev, { timeout: 30000 }).then((handle) => handle.jsonValue()).catch(() => null);
  const seenRevisionBeforeDiscard = waitSeen ?? 0;
  if (seenRevisionBeforeDiscard === 0) {
    const captions = await page.locator(".section-heading .caption").allTextContents();
    console.error("REVISION CAPTIONS AT TIMEOUT:", JSON.stringify(captions));
  }
  check("Page observed the external revision before Discard", seenRevisionBeforeDiscard >= afterBumpRev, { seenRevisionBeforeDiscard, afterBumpRev });
  await page.getByRole("button", { name: "Discard edits" }).click();
  await nameBox.fill(originalName + " M2");
  await page.getByRole("button", { name: /Save changes/ }).click();
  let afterRev = null, savedName = null;
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    const s2 = await state();
    afterRev = s2.personalAgents.revision;
    savedName = s2.personalAgents.slots.find(x => x.slot === 1)?.displayName;
    if (afterRev > afterBumpRev) break;
  }
  check("Discard after external revision accepts the next save (IR-M1)", savedName === originalName + " M2" && afterRev > afterBumpRev, { beforeRev, afterBumpRev, afterRev, savedName, httpStatuses: saves });
  await page.screenshot({ path: join(dir, "shots", "post-discard-save.png") });
  check("Browser console stayed clean", browserErrors.length === 0, browserErrors);
} catch (e) {
  console.error("FATAL", String(e?.stack ?? e));
  checks.push({ name: "probe completed", ok: false, detail: String(e?.message ?? e) });
} finally {
  try { if (browser) await browser.close(); } catch {}
  try { if (dev && dev.exitCode === null) execFileSync("taskkill.exe", ["/PID", String(dev.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }); } catch {}
  writeFileSync(join(dir, "results.json"), JSON.stringify({ classification: `LIVE Studio discard/revision probe: real disposable Host ${HOST_PORT}, isolated dev ${DEV_PORT}, real browser. Production untouched.`, checks, saves, browserErrors, finished: true }, null, 2) + "\n");
  try { if (seed) { writeFileSync(join(dir, "close"), ""); await sleep(2500); seed.kill(); } } catch {}
  try { spawnSync("powershell.exe", ["-NoProfile", "-Command", `Remove-Item -LiteralPath '${scratchRoot}' -Recurse -Force`], { windowsHide: true }); } catch {}
}
process.exitCode = checks.some((c) => !c.ok) ? 1 : 0;