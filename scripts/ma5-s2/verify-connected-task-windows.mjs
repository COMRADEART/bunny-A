// MA5-S2 Phase 1A: UI-driven acceptance of the compiled WPF "New Connected Task" screen against an isolated real Host
// (Ollama adapter only, local model). Every UI value is read through UI Automation; Host facts come from the Host itself.
// Host commands are used only to check the contract or create the background-task fixture for the approval stage.
// Usage: node --experimental-strip-types scripts/ma5-s2/verify-connected-task-windows.mjs
import { spawn, execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { startHost } from "../../src/lib/bunny-host/http.server.ts";
import { defaultAdapters } from "../../src/lib/bunny-host/adapters.server.ts";
import { writeEvidence } from "../evidence-guard.mjs";

const execFileAsync = promisify(execFile);
const PORT = Number(process.env.BUNNY_E2E_PORT ?? 43191);
const exePath = process.env.BUNNY_EXE ?? join(process.cwd(), "native/windows/BunnyA/bin/Debug/net8.0-windows/BunnyA.exe");
const helper = join(process.cwd(), "scripts/ui-automation-helper.ps1");
const out = process.argv[2] ?? "docs/ma5-s2/evidence/windows-connected-task.json";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

const running = spawnSync("tasklist", ["/FI", "IMAGENAME eq BunnyA.exe", "/FO", "CSV", "/NH"], { encoding: "utf8" }).stdout;
assert.ok(!/BunnyA\.exe/i.test(running), "Another BunnyA.exe is running (single-instance mutex); close it first.");

const hostDir = mkdtempSync(join(tmpdir(), "bunny-host-ma5s2-"));
const configDir = mkdtempSync(join(tmpdir(), "bunny-config-ma5s2-"));
writeFileSync(join(configDir, "config.json"), JSON.stringify({ NotchEdge: "Top", NotchOffsetRatio: 0.5 }));
// A granted folder may not be an application folder (%LOCALAPPDATA%), so it lives in this checkout's ignored test-results/.
mkdirSync("test-results/ma5-s2", { recursive: true });
const folder = mkdtempSync(join(process.cwd(), "test-results", "ma5-s2", "ui-notes-"));
writeFileSync(join(folder, "notes.txt"), "Release checklist: the installer is signed, the Android build is reproducible, and voice qualification is blocked until a real microphone test runs.\n");

const host = await startHost({ port: PORT, dataDirectory: hostDir, adapters: defaultAdapters().filter((a) => a.id === "ollama") });
const credPath = join(hostDir, "client-credentials.json");
writeFileSync(credPath, JSON.stringify({ port: PORT, token: host.token }));
const scrub = (v) => JSON.parse(JSON.stringify(v ?? null).split(JSON.stringify(folder).slice(1, -1)).join("<registered-folder>"));

async function ui(action, args = {}) {
  const ps = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", helper, "-Action", action];
  for (const [k, v] of Object.entries(args)) if (v !== undefined && v !== "") ps.push(`-${k}`, String(v));
  // Async on purpose: the Host runs in this process, so a blocking spawn would starve the client it serves.
  const run = execFileAsync("powershell.exe", ps, { encoding: "utf8", timeout: 60_000 });
  run.child.stdin.end();
  const { stdout } = await run;
  return JSON.parse(stdout.trim());
}
async function cmd(action, data) {
  const res = await fetch(`http://127.0.0.1:${PORT}/command`, { method: "POST", headers: { authorization: `Bearer ${host.token}`, "content-type": "application/json" }, body: JSON.stringify({ action, data, operationId: crypto.randomUUID() }) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
async function until(what, fn, ms = 30_000, every = 300) {
  const start = Date.now();
  for (;;) { const v = await fn().catch(() => null); if (v) return v; if (Date.now() - start > ms) throw new Error(`Timed out: ${what}`); await sleep(every); }
}

const results = { schema: "ma5-s2.windows-connected-task.v1", at: new Date().toISOString(), host: "disposable, Ollama adapter only", stages: {} };
const failures = [];
let app;
const pid = () => app.pid;
const text = async (id) => (await ui("read_state", { ProcessId: pid(), TargetId: id }));
async function stage(name, fn) {
  log(`── ${name}`);
  try { results.stages[name] = { ok: true, ...scrub(await fn()) }; }
  catch (e) { failures.push(name); results.stages[name] = { ok: false, error: String(e?.message ?? e).slice(0, 1500) }; log(`FAILED ${name}: ${e.message}`); }
}

try {
  await host.manager.discover();
  const ollama = host.manager.snapshot().providers.find((p) => p.id === "ollama");
  assert.equal(ollama?.availability, "ready", "Ollama must be ready");
  const remote = new Set(ollama.remoteModels ?? []);
  const model = (ollama.models ?? []).find((m) => !remote.has(m) && !/(:|-)cloud$/i.test(m));
  assert.ok(model, "a local Ollama model must be installed");
  results.model = model;

  app = spawn(exePath, [], { env: { ...process.env, BUNNY_HOST_CREDENTIALS_FILE: credPath, BUNNY_CONFIG_DIRECTORY: configDir }, stdio: "ignore" });
  await until("main window", () => ui("read_state", { ProcessId: app.pid, TargetId: "NavConnected" }).then((s) => s.present), 30_000);
  await ui("navigate", { ProcessId: pid(), TargetId: "NavConnected" });

  await stage("c1-register-folder", async () => {
    await until("folder list loaded", async () => /No folders registered/.test((await text("ConnectedRootsStatus")).name ?? ""));
    await ui("set_text", { ProcessId: pid(), TargetId: "ConnectedRootLabelInput", PromptText: "Notes" });
    await ui("set_text", { ProcessId: pid(), TargetId: "ConnectedRootPathInput", PromptText: folder });
    await ui("navigate", { ProcessId: pid(), TargetId: "AddConnectedRootButton" });
    const rows = await until("folder row", async () => { const r = await ui("read_list", { ProcessId: pid(), TargetId: "ConnectedRootsList" }); return r.length ? r : null; });
    const roots = (await cmd("connector.roots.list", {})).body.data.roots;
    assert.deepEqual(roots.map((r) => r.id), ["notes"]);
    return { uiRows: rows.map((r) => r.name), hostRoots: roots };
  });

  await stage("c2-system-folder-refused", async () => {
    await ui("set_text", { ProcessId: pid(), TargetId: "ConnectedRootLabelInput", PromptText: "Windows" });
    await ui("set_text", { ProcessId: pid(), TargetId: "ConnectedRootPathInput", PromptText: process.env.SystemRoot ?? "C:\\Windows" });
    const dialog = await ui("invoke_and_dialog", { ProcessId: pid(), TargetId: "AddConnectedRootButton" });
    assert.match(dialog.dialogText ?? "", /System and application folders cannot be granted/);
    const roots = (await cmd("connector.roots.list", {})).body.data.roots;
    assert.deepEqual(roots.map((r) => r.id), ["notes"], "nothing changed on refusal");
    return { dialog, hostRootIds: roots.map((r) => r.id) };
  });

  const planOnce = async (goal) => {
    await ui("set_text", { ProcessId: pid(), TargetId: "ConnectedGoalInput", PromptText: goal });
    await ui("navigate", { ProcessId: pid(), TargetId: "ConnectedPlanButton" });
    const t0 = Date.now();
    const title = await until("review panel", async () => { const s = await text("ConnectedReviewTitle"); return s.present && !s.offscreen && s.name ? s.name : null; }, 330_000, 1_000);
    return { title, planMs: Date.now() - t0 };
  };

  let planned;
  await stage("c3-plan-and-review", async () => {
    await ui("select_list_item", { ProcessId: pid(), TargetId: "ConnectedRootsList", Match: "Notes" });
    planned = await planOnce("Read notes.txt and summarize it in two sentences.");
    const verdict = (await text("ConnectedReviewVerdict")).name;
    const steps = (await ui("read_list", { ProcessId: pid(), TargetId: "ConnectedStepsList" })).map((r) => r.name);
    const permissions = (await text("ConnectedPermissionsText")).name;
    const approval = (await text("ConnectedApprovalText")).name;
    const createBefore = (await text("ConnectedCreateButton")).enabled;
    assert.match(verdict ?? "", /validated/);
    assert.equal(createBefore, false, "Create stays disabled until the owner confirms the review");
    assert.match(permissions ?? "", /Folders \(read only\): Notes/);
    assert.match(permissions ?? "", new RegExp(`Model:\\s+${model.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\(local Ollama only`));
    assert.match(approval ?? "", /Create starts this task immediately|waits for your approval/);
    return { ...planned, verdict, steps, permissions, approval, createEnabledBeforeReview: createBefore };
  });

  await stage("c4-stale-input-discards-plan", async () => {
    await ui("click_toggle", { ProcessId: pid(), TargetId: "ConnectedReviewedCheck" });
    const enabledAfterReview = (await text("ConnectedCreateButton")).enabled;
    assert.equal(enabledAfterReview, true);
    await ui("set_text", { ProcessId: pid(), TargetId: "ConnectedGoalInput", PromptText: "Read notes.txt and summarize it in one sentence." });
    const review = await text("ConnectedReviewTitle");
    const status = (await text("ConnectedPlanStatus")).name;
    assert.ok(!review.present || review.offscreen, "the review is withdrawn once its inputs change");
    assert.match(status ?? "", /changed after planning/);
    assert.equal((await cmd("ptask.list", {})).body.data.tasks.length, 0, "nothing was created");
    return { enabledAfterReview, reviewVisibleAfterEdit: review.present && !review.offscreen, status };
  });

  await stage("c5-create-and-monitor", async () => {
    const again = await planOnce("Read notes.txt and summarize it in one sentence.");
    await ui("click_toggle", { ProcessId: pid(), TargetId: "ConnectedReviewedCheck" });
    await ui("navigate", { ProcessId: pid(), TargetId: "ConnectedCreateButton" });
    const result = await until("created message", async () => { const s = (await text("ConnectedResultText")).name; return /Created/.test(s ?? "") ? s : null; }, 30_000);
    const tasks = (await cmd("ptask.list", {})).body.data.tasks;
    assert.equal(tasks.length, 1, "exactly one task created");
    const id = tasks[0].id;
    const record = host.ptasks.store.get(id).record;
    assert.deepEqual(record.envelope.models, [model]);
    assert.equal(record.envelope.localOnly, true);
    assert.equal(record.envelope.sideEffects, false);
    assert.deepEqual(record.envelope.grants.files, [{ root: "notes", access: "read" }]);
    const final = await until("task finished", async () => { const v = host.ptasks.view(id); return ["COMPLETED", "FAILED", "CANCELLED", "UNCERTAIN"].includes(v.state) ? v : null; }, 240_000, 1_000);
    // The create button is consumed: a second click has nothing to send.
    const createAfter = await text("ConnectedCreateButton");
    assert.equal(createAfter.present && !createAfter.offscreen, false, "the review is consumed by Create");
    // Monitoring: the finished task appears in the native Task History from Host state.
    await ui("navigate", { ProcessId: pid(), TargetId: "NavHistory" });
    const historyRows = await until("task in history", async () => {
      const rows = (await ui("read_list", { ProcessId: pid(), TargetId: "TaskHistoryList" })).map((r) => r.name);
      return rows.some((r) => r.includes(final.title)) ? rows : null;
    }, 15_000);
    await ui("navigate", { ProcessId: pid(), TargetId: "NavConnected" });
    assert.equal((await cmd("ptask.list", {})).body.data.tasks.length, 1, "still exactly one task");
    return { replanMs: again.planMs, uiResult: result, taskId: id, finalState: final.state, models: final.models, evidence: final.evidence, historyRows: historyRows.slice(0, 5) };
  });

  await stage("c6-task-level-approval-in-approval-center", async () => {
    // Fixture: a background task needs whole-task approval (no pending action); before MA5-S2 Windows could not approve it.
    const spec = { title: "Background read", projectId: "personal", steps: [{ id: "r", kind: "file.read", input: { root: "notes", path: "notes.txt" } }], acceptance: { requiredSteps: ["r"] } };
    const envelope = { capabilities: ["file.read"], providers: ["ollama"], localOnly: true, models: [], projectScopes: ["personal"], sideEffects: false, background: true, budgets: { maxModelCalls: 0, maxWallMs: 600_000 }, expiresAt: Date.now() + 3_600_000, grants: { files: [{ root: "notes", access: "read" }], origins: [], services: [] } };
    const created = (await cmd("ptask.create", { spec, envelope })).body.data;
    assert.equal(created.state, "AWAITING_APPROVAL");
    await ui("navigate", { ProcessId: pid(), TargetId: "NavApprovals" });
    await ui("select_approval", { ProcessId: pid(), Match: "Background read" });
    const shown = await until("approval detail", async () => { const a = await ui("read_approvals", { ProcessId: pid() }); return /Start persistent task/.test(a.operation ?? "") ? a : null; });
    assert.equal(shown.approveEnabled, true);
    await ui("navigate", { ProcessId: pid(), TargetId: "ApproveActionButton" });
    const after = await until("task approved", async () => { const v = host.ptasks.view(created.id); return v.state !== "AWAITING_APPROVAL" ? v : null; });
    const approval = host.ptasks.store.get(created.id).record.approval;
    assert.equal(approval?.by, "workstation");
    const receipt = (await ui("read_approvals", { ProcessId: pid() })).receipts;
    return { shown: { operation: shown.operation, scope: shown.scope, payload: shown.payloadSha256, context: shown.context }, stateAfter: after.state, approvalBy: approval.by, receipt };
  });
} finally {
  results.failures = failures;
  try { writeEvidence(out, results, [host.token]); } catch (e) { log(`evidence not written: ${e.message}`); }
  try { app?.kill(); } catch { /* already gone */ }
  await sleep(1_000);
  await host.close();
  for (const d of [hostDir, configDir, folder]) rmSync(d, { recursive: true, force: true });
  log(failures.length ? `FAILED: ${failures.join(", ")}` : "all stages passed");
  process.exitCode = failures.length ? 1 : 0;
}
