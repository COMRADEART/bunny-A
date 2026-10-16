// Visual Experience 2.0 packaged theme end-to-end: one disposable Host started from the EXACT Windows test package (its own
// runtime/node.exe and packaged entry, through package-host.mjs) proves the shipped Host carries the theme feature:
//   V01 the snapshot carries a valid uiTheme view at revision 0 (glass);
//   V02 all 22 themes apply in turn with expectRevision, and every view's Notch tokens are #rrggbb;
//   V03 a stale, an unknown, an authority-shaped and a malformed-revision write are refused and change nothing;
//   V04 a paired device reads the theme but cannot change it; V05 the theme survives a real restart;
//   V06 reset returns glass following the system; V07 no Mission, Task or provider row came from any of it.
// Usage: <node> ve2-theme-e2e.mjs <packageRoot> <out.json> <port>. Production (43119/8084) is refused.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const here = resolve(import.meta.dirname);
const [rootArg, outArg, portArg] = process.argv.slice(2);
const root = resolve(rootArg);
const port = Number(portArg);
if (!(port > 1024) || port === 43119 || port === 8084) throw new Error("A disposable port is required.");
if (!existsSync(join(root, "release-manifest.json"))) throw new Error("A package root (with release-manifest.json) is required.");
const scratch = join(tmpdir(), `bunny-ve2-e2e-${Date.now()}`);
mkdirSync(scratch, { recursive: true });
const checks = [];
const logs = [];
let host;
let token;
const check = (id, ok, detail) => {
  checks.push({ id, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${id}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (probe, label, max = 90_000) => {
  const end = Date.now() + max;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() > end) throw new Error(`Timed out: ${label}`);
    await sleep(200);
  }
};
const start = async () => {
  host = spawn(join(root, "runtime/node.exe"), [join(here, "package-host.mjs"), root, scratch, String(port)], { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_OPTIONS: "" } });
  host.stdout.on("data", (s) => logs.push(String(s)));
  host.stderr.on("data", (s) => logs.push(String(s)));
  await until(async () => {
    if (host.exitCode !== null) throw new Error("Host exited: " + logs.join("").slice(-1500));
    try { return existsSync(join(scratch, "credentials.json")) && (await fetch(`http://127.0.0.1:${port}/health`)).ok; } catch { return false; }
  }, "Host start");
  token = JSON.parse(readFileSync(join(scratch, "credentials.json"), "utf8")).token;
};
const stop = async () => {
  writeFileSync(join(scratch, "close"), "");
  await until(() => host.exitCode !== null, "Host close", 30_000);
};
const call = async (path, data, bearer = token) => {
  const r = await fetch(`http://127.0.0.1:${port}${path}`, { method: data ? "POST" : "GET", headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" }, ...(data ? { body: JSON.stringify(data) } : {}) });
  return { status: r.status, body: JSON.parse(await r.text()) };
};
const command = (action, data = {}, bearer = token) => call("/command", { action, data }, bearer);
const ok = (r, label) => {
  if (r.status !== 200) throw new Error(`${label}: ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
  return r.body;
};
const view = async () => (await call("/state")).body.uiTheme;
const IDS = ["clay", "cybercore", "brutalism", "scrapbook", "surreal", "y2k", "pixel", "synthwave", "glass", "neumorph", "bento", "editorial", "swiss", "minimal", "maximal", "luxury", "sketch", "ethereal", "bohemian", "victorian", "cyberpunk", "wabisabi"];
const hex = /^#[0-9a-f]{6}$/;
const receipt = { packageRoot: root, port, startedAt: new Date().toISOString(), runtime: "package runtime/node.exe" };
try {
  await start();
  const first = await view();
  check("V01 snapshot carries uiTheme at revision 0", first?.schema === "bunny-a.ui-theme.v1" && first.revision === 0 && first.preference.theme === "glass", { revision: first?.revision, theme: first?.preference?.theme });
  let revision = 0;
  const bad = [];
  for (const id of IDS) {
    const r = await command("appearance.theme", { theme: id, expectRevision: revision });
    const v = r.body?.data;
    const tokensOk = v && ["light", "dark"].every((side) => Object.values(v.notch[side]).every((c) => hex.test(c)));
    if (r.status !== 200 || v.preference.theme !== id || v.revision !== revision + 1 || !tokensOk) bad.push({ id, status: r.status });
    revision = v?.revision ?? revision;
  }
  check("V02 all 22 themes apply with revision checks and valid Notch tokens", bad.length === 0 && revision === 22, { revision, bad });
  const refusals = [];
  for (const data of [{ theme: "pixel", expectRevision: 0 }, { theme: "hologram" }, { approvals: "phone" }, { theme: "pixel", expectRevision: "22" }]) refusals.push((await command("appearance.theme", data)).status);
  const held = await view();
  check("V03 stale, unknown, authority-shaped and malformed writes refused", refusals.every((s) => s === 400) && held.revision === 22 && held.preference.theme === "wabisabi", { refusals, revision: held.revision });
  const code = ok(await command("pairing.create"), "pair code").pairCode;
  const paired = await (await fetch(`http://127.0.0.1:${port}/pair`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, name: "VE2 package e2e fixture phone" }) })).json();
  const deviceWrite = await command("appearance.theme", { theme: "minimal" }, paired.token);
  const deviceRead = await call("/state", null, paired.token);
  check("V04 a paired device reads the theme but cannot change it", deviceWrite.status >= 400 && deviceRead.status === 200 && deviceRead.body.uiTheme?.preference?.theme === "wabisabi", { write: deviceWrite.status, read: deviceRead.body.uiTheme?.preference?.theme });
  await stop();
  await start();
  const after = await view();
  check("V05 the theme survives a real Host restart", after.preference.theme === "wabisabi" && after.revision === 22, { theme: after.preference.theme, revision: after.revision });
  const reset = await command("appearance.theme_reset", { expectRevision: 22 });
  check("V06 reset returns glass following the system", reset.status === 200 && reset.body.data.preference.theme === "glass" && reset.body.data.preference.variant === "system", reset.body.data?.preference);
} catch (error) {
  check("V00 run completed", false, String(error?.stack ?? error).slice(0, 1200));
} finally {
  if (host?.exitCode === null) await stop().catch(() => host.kill());
}
try {
  const db = new DatabaseSync(join(scratch, "state/host.sqlite"), { readOnly: true });
  const count = (table) => { try { return db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n; } catch { return null; } };
  const counts = { missions: count("missions"), tasks: count("tasks"), session_ledger: count("session_ledger") };
  db.close();
  check("V07 no Mission, Task or provider use from theme changes", Object.values(counts).every((n) => !n), counts);
} catch (error) {
  check("V07 no Mission, Task or provider use from theme changes", false, String(error).slice(0, 300));
}
receipt.checks = checks;
receipt.result = checks.every((c) => c.ok) ? "PASS" : "FAIL";
receipt.finishedAt = new Date().toISOString();
receipt.installed = false;
receipt.published = false;
writeFileSync(resolve(outArg), JSON.stringify(receipt, null, 2) + "\n");
rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
console.log(`${receipt.result}: ${checks.filter((c) => c.ok).length}/${checks.length}`);
process.exitCode = receipt.result === "PASS" ? 0 : 1;
