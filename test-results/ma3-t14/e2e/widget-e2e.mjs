// Widget Studio packaged end-to-end: one disposable Host started from the EXACT Windows test package (its own runtime/node.exe and
// packaged entry, through package-host.mjs) proves the shipped Host carries the widget layout feature. Modelled on ve2-theme-e2e.mjs.
//   W01 the snapshot carries a valid widgets view at revision 0 (board, six live widgets);
//   W02 board -> sidebar -> drawer -> custom order/sizes/hidden apply in turn with expectRevision;
//   W03 stale, unknown-key, markup, __proto__, declared-library-widget, missing-widget and malformed-revision writes are refused
//       and change nothing; a forged widgets.execute is refused;
//   W04 a paired device reads the layout but cannot change or reset it;
//   W05 the layout survives a real Host restart; W06 a theme change leaves the layout alone;
//   W07 reset returns the default board; W08 no Mission, Task or provider use came from any of it.
// Usage: <node> widget-e2e.mjs <packageRoot> <out.json> <port>. Production (43119/8084) is refused.
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
const scratch = join(tmpdir(), `bunny-wd-e2e-${Date.now()}`);
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
  rmSync(join(scratch, "close"), { force: true });
  rmSync(join(scratch, "credentials.json"), { force: true });
};
const call = async (path, data, bearer = token) => {
  const r = await fetch(`http://127.0.0.1:${port}${path}`, { method: data ? "POST" : "GET", headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" }, ...(data ? { body: JSON.stringify(data) } : {}) });
  return { status: r.status, body: JSON.parse(await r.text()) };
};
const command = (action, data = {}, bearer = token) => call("/command", { action, data }, bearer);
const view = async (bearer) => (await call("/state", null, bearer)).body.widgets;
const IDS = ["mission", "agents", "usage", "lotus", "reconciliation", "voice"];
const receipt = { packageRoot: root, port, startedAt: new Date().toISOString(), runtime: "package runtime/node.exe" };
try {
  await start();
  const first = await view();
  check("W01 snapshot carries widgets at revision 0", first?.schema === "bunny-a.widgets.v1" && first.revision === 0 && first.preference.layout === "board"
    && first.preference.items.map((i) => i.id).join() === IDS.join(), { revision: first?.revision, layout: first?.preference?.layout, items: first?.preference?.items?.length });
  let revision = 0;
  const steps = [
    { layout: "sidebar", sidebarWidth: 360 },
    { layout: "drawer", drawerOpen: true, notchEdge: "right" },
    { density: "compact", gap: 16, motion: "reduced", items: [...IDS].reverse().map((id, n) => ({ id, size: id === "mission" ? "wide" : "standard", hidden: n === 5 })) },
  ];
  const bad = [];
  for (const step of steps) {
    const r = await command("widgets.layout", { ...step, expectRevision: revision });
    const saved = r.body?.snapshot?.widgets;
    if (r.status !== 200 || saved?.revision !== revision + 1) bad.push({ step: Object.keys(step), status: r.status, error: r.body?.error });
    revision = saved?.revision ?? revision;
  }
  const applied = await view();
  check("W02 layouts, order, sizes and visibility apply with revision checks", bad.length === 0 && revision === 3 && applied.preference.layout === "drawer"
    && applied.preference.items[0].id === "voice" && applied.preference.items[5].hidden === true && applied.preference.sidebarWidth === 360, { revision, bad, first: applied.preference.items[0].id });
  const attempts = [
    { layout: "board", expectRevision: 0 },
    { theme: "pixel" },
    { focus: { projectId: "<script>alert(1)</script>", slot: null } },
    JSON.parse('{"__proto__":{"layout":"board"}}'),
    { items: [...IDS.slice(0, 5), "notes"].map((id) => ({ id, size: "standard", hidden: false })) },
    { items: IDS.slice(0, 5).map((id) => ({ id, size: "standard", hidden: false })) },
    { layout: "board", expectRevision: "3" },
    { sidebarWidth: 9999 },
  ];
  const refusals = [];
  for (const data of attempts) refusals.push((await command("widgets.layout", data)).status);
  const forged = (await command("widgets.execute", { command: "task.reconcile" })).status;
  const held = await view();
  check("W03 stale, unknown, markup, prototype, library, incomplete, malformed and forged writes refused", refusals.every((s) => s === 400) && forged === 400
    && held.revision === 3 && held.preference.layout === "drawer", { refusals, forged, revision: held.revision });
  const code = (await command("pairing.create")).body.pairCode;
  const paired = await (await fetch(`http://127.0.0.1:${port}/pair`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, name: "Widget package e2e fixture phone" }) })).json();
  const deviceWrite = await command("widgets.layout", { layout: "board" }, paired.token);
  const deviceReset = await command("widgets.reset", {}, paired.token);
  const deviceState = (await call("/state", null, paired.token)).body;
  check("W04 a paired device reads the layout but cannot change or reset it", deviceWrite.status === 400 && deviceWrite.body.code === "WORKSTATION_REQUIRED" && deviceReset.status === 400
    && deviceState.widgets?.preference?.layout === "drawer" && deviceState.sessionLedger === undefined && deviceState.personalAgentContext === undefined,
    { write: [deviceWrite.status, deviceWrite.body.code], reset: deviceReset.status, read: deviceState.widgets?.preference?.layout });
  await stop();
  await start();
  const after = await view();
  check("W05 the layout survives a real Host restart", after.revision === 3 && after.preference.layout === "drawer" && after.preference.items[0].id === "voice", { revision: after.revision, layout: after.preference.layout });
  const themed = await command("appearance.theme", { theme: "cyberpunk" });
  const afterTheme = await view();
  check("W06 a theme change leaves the layout alone", themed.status === 200 && afterTheme.revision === 3 && afterTheme.preference.layout === "drawer", { theme: themed.status, revision: afterTheme.revision });
  const reset = await command("widgets.reset", { expectRevision: 3 });
  const done = reset.body?.snapshot?.widgets;
  check("W07 reset returns the default board", reset.status === 200 && done?.revision === 4 && done.preference.layout === "board" && done.preference.items.every((i) => !i.hidden), { revision: done?.revision, layout: done?.preference?.layout });
} catch (error) {
  check("W00 run completed", false, String(error?.stack ?? error).slice(0, 1200));
} finally {
  if (host?.exitCode === null) await stop().catch(() => host.kill());
}
try {
  const db = new DatabaseSync(join(scratch, "state/host.sqlite"), { readOnly: true });
  const count = (table) => { try { return db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n; } catch { return null; } };
  const counts = { missions: count("missions"), tasks: count("tasks"), session_ledger: count("session_ledger"), widget_rows: count("widget_preference") };
  db.close();
  check("W08 no Mission, Task or provider use from widget changes", !counts.missions && !counts.tasks && !counts.session_ledger && counts.widget_rows === 1, counts);
} catch (error) {
  check("W08 no Mission, Task or provider use from widget changes", false, String(error).slice(0, 300));
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
