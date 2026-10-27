// MA4-S3-T5 Native R1R2: UI-driven acceptance of the compiled WPF client against an isolated real Host.
// Everything recorded here is observed (Host state, UI Automation reads, Ollama, the process table).
// Direct Action Broker runtime tests stay in verify-native-r1.mjs; nothing in this file calls the runtime directly.
import { spawn, spawnSync, execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { startHost } from "../src/lib/bunny-host/http.server.ts";
import { spec, envelope, TEST_BASE } from "../src/lib/bunny-host/ma4-s2t2-fixtures.ts";
import { writeEvidence } from "./evidence-guard.mjs";

const RUN_ID = `r1r2-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const EVIDENCE_DIR = join(process.cwd(), "test-results", "ma4-s3-t5-native-r1r2", RUN_ID);
mkdirSync(EVIDENCE_DIR, { recursive: true });
const REAL_MODEL = "qwen2.5-coder:7b";
const PORT = 43179;
const exePath = join(process.cwd(), "native/windows/BunnyA/bin/Debug/net8.0-windows/BunnyA.exe");
const helper = join(process.cwd(), "scripts/ui-automation-helper.ps1");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const spread = (xs) => Math.max(...xs) - Math.min(...xs);
const sha = (s) => createHash("sha256").update(s).digest("hex");
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

// The single-instance mutex is global: a running owner copy would make our launch exit and test nothing.
const running = spawnSync("tasklist", ["/FI", "IMAGENAME eq BunnyA.exe", "/FO", "CSV", "/NH"], { encoding: "utf8" }).stdout;
assert.ok(!/BunnyA\.exe/i.test(running), "Another BunnyA.exe is running; close it before acceptance.");

const hostDir = mkdtempSync(join(tmpdir(), "bunny-host-r1r2-"));
const configDir = mkdtempSync(join(tmpdir(), "bunny-config-r1r2-"));
const configPath = join(configDir, "config.json");
writeFileSync(configPath, JSON.stringify({ NotchEdge: "Top" }));
mkdirSync(TEST_BASE, { recursive: true });
const projectRoot = mkdtempSync(join(TEST_BASE, "r1r2-approval-"));

let host = await startHost({ port: PORT, dataDirectory: hostDir });
const secrets = () => [host.token];
const credPath = join(hostDir, "client-credentials.json");
writeFileSync(credPath, JSON.stringify({ port: PORT, token: host.token }));
const authSeen = [];
const watchAuth = (h) => h.server.prependListener("request", (req) => {
  if (req.url === "/state" && req.headers.authorization) authSeen.push({ at: Date.now(), authenticated: req.headers.authorization === `Bearer ${h.token}` });
});
watchAuth(host);

// Async on purpose: the Host runs in this process, so a blocking spawn would starve the client it is serving.
async function ui(action, args = {}) {
  const ps = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", helper, "-Action", action];
  for (const [k, v] of Object.entries(args)) if (v !== undefined && v !== "") ps.push(`-${k}`, String(v));
  try {
    const run = execFileAsync("powershell.exe", ps, { encoding: "utf8", timeout: 60_000 });
    run.child.stdin.end(); // PowerShell -File stalls on an open stdin pipe
    const { stdout } = await run;
    return JSON.parse(stdout.trim());
  } catch (e) { throw new Error(`UI ${action} failed: ${`${e.stderr ?? ""} ${e.stdout ?? ""}`.trim().slice(0, 600) || e.message}`); }
}
async function cmd(action, data) {
  const res = await fetch(`http://127.0.0.1:${PORT}/command`, {
    method: "POST", headers: { authorization: `Bearer ${host.token}`, "content-type": "application/json" },
    body: JSON.stringify({ action, data, operationId: crypto.randomUUID() }), signal: AbortSignal.timeout(30_000),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}
async function until(what, fn, ms = 30_000, every = 200) {
  const start = Date.now();
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() - start > ms) throw new Error(`Timed out: ${what}`); await sleep(every); }
}
function launch(tag) {
  const child = spawn(exePath, [], { env: { ...process.env, BUNNY_HOST_CREDENTIALS_FILE: credPath, BUNNY_CONFIG_DIRECTORY: configDir }, stdio: "ignore" });
  const exited = new Promise((resolve) => child.on("exit", (code, signal) => resolve({ code, signal, at: Date.now() })));
  log(`launched BunnyA.exe (${tag}) pid ${child.pid}`);
  return { child, exited };
}
const ptask = (id) => host.ptasks.view(id);
const hostTask = (pred) => host.manager.snapshot().tasks.find(pred);
const results = { runId: RUN_ID, binary: exePath, binarySha256: sha(readFileSync(exePath)), host: { port: PORT, isolatedDataDirectory: true }, configIsolated: true };

let app;
try {
  // ── Stage 1: local-only Ollama conversation driven through the WPF UI ──────────────────────────────
  log("Stage 1: local-only conversation");
  await host.manager.discover();
  const ollama = host.manager.snapshot().providers.find((p) => p.id === "ollama");
  assert.equal(ollama?.availability, "ready", "Ollama must be ready");
  assert.ok(ollama.models?.includes(REAL_MODEL), `${REAL_MODEL} must be installed`);
  const tags = await (await fetch("http://127.0.0.1:11434/api/tags")).json();
  const digest = tags.models.find((m) => m.name === REAL_MODEL)?.digest;
  assert.match(digest ?? "", /^[a-f0-9]{64}$/, "Ollama must report the model digest");

  app = launch("primary");
  await until("authenticated /state from BunnyA", () => authSeen.length > 0, 20_000);
  assert.ok(authSeen.every((a) => a.authenticated), "every client /state request must carry the Host token");
  let pickErr = "";
  const selection = await until("model list in the chat picker", async () => { try { return await ui("select_model", { ProcessId: app.child.pid, ModelName: REAL_MODEL, LocalOnly: "1" }); } catch (e) { pickErr = e.message; return null; } }, 30_000, 1000)
    .catch((e) => { throw new Error(`${e.message}; last UI error: ${pickErr}`); });
  assert.equal(selection.selectedModel, REAL_MODEL, "UI must show the explicitly selected local model");
  assert.equal(selection.localOnlyChecked, true, "UI must show Local only checked");

  const prompt = "What is 34 + 28? Answer with ONLY the number.";
  await ui("enter_and_send", { ProcessId: app.child.pid, PromptText: prompt });
  const submitted = await until("Host task from the UI", () => hostTask((t) => t.prompt === prompt), 15_000);
  const routes = new Set();
  const done = await until("local task to settle", () => {
    const t = hostTask((x) => x.id === submitted.id);
    if (t?.provider) routes.add(`${t.provider}:${t.model}`);
    // Fail closed the moment the route is anything but the selected local model.
    if (t?.provider && (t.provider !== "ollama" || t.model !== REAL_MODEL)) { host.manager.stop?.(t.id, "R1R2: route left local-only"); throw new Error(`Route changed to ${t.provider}:${t.model}`); }
    return t && ["completed", "failed", "stopped"].includes(t.state) ? t : null;
  }, 120_000, 250);
  assert.equal(done.state, "completed", `local task ended ${done.state}: ${done.error ?? ""}`);
  assert.equal(done.constraints?.localOnly, true); assert.equal(done.constraints?.offlineOnly, true);
  assert.match(done.output, /62/);
  const receiptEvents = (host.manager.db?.recentEvents?.() ?? []).filter((e) => e.taskId === done.id && e.type === "provider.receipt").map((e) => e.detail);
  let lastItems = [];
  const chat = await until("answer in native chat", async () => {
    const items = (lastItems = await ui("read_chat_items", { ProcessId: app.child.pid }));
    return items.find((i) => i.text.trim() === done.output.trim() && i.labels.some((l) => l.includes(`ollama · ${REAL_MODEL}`))) ? items : null;
  }, 15_000, 500).catch((e) => { throw new Error(`${e.message}; Host output ${JSON.stringify(done.output)}; UI items ${JSON.stringify(lastItems).slice(0, 800)}`); });
  const shown = chat.find((i) => i.text.trim() === done.output.trim());

  // Negative: hosted routes with Local only must be refused by the Host, never answered. Two shapes:
  // a hosted provider, and a cloud model listed under the local provider (Ollama ":cloud").
  const providersNow = host.manager.snapshot().providers;
  const hostedCandidates = [
    providersNow.filter((p) => p.id !== "ollama" && p.availability === "ready" && p.models?.length).map((p) => ({ provider: p.id, model: p.models[0] }))[0],
    (ollama.models ?? []).filter((m) => m.endsWith(":cloud")).map((m) => ({ provider: "ollama", model: m }))[0],
  ].filter(Boolean);
  const hostedRefusal = [];
  for (const [i, c] of hostedCandidates.entries()) {
    try { await ui("select_model", { ProcessId: app.child.pid, ModelName: c.model, LocalOnly: "1" }); }
    catch (e) { hostedRefusal.push({ ...c, attempted: false, reason: `not offered in UI: ${e.message.slice(0, 120)}` }); continue; }
    const p2 = `Reply with the single word OK. (${i})`;
    await ui("enter_and_send", { ProcessId: app.child.pid, PromptText: p2 });
    let ran = [];
    const settled = await until("hosted attempt settles in UI", async () => {
      ran = host.manager.snapshot().tasks.filter((t) => t.prompt === p2 && t.provider && (t.provider !== "ollama" || t.model !== REAL_MODEL) && ["running", "completed"].includes(t.state));
      for (const t of ran) host.manager.stop(t.id, "R1R2: hosted route under local-only");
      const items = await ui("read_chat_items", { ProcessId: app.child.pid });
      const last = items.at(-1);
      // The list virtualizes, so count is unreliable: settle on this prompt bubble followed by a final status.
      const prev = items.at(-2);
      return prev?.text === p2 && ["Completed", "Failed", "Cancelled", "Error", "Refused", "Timeout"].includes(last?.labels?.[1]) ? last : null;
    }, 30_000, 1000).catch(async (e) => { throw new Error(`${e.message}; ${c.provider}:${c.model}; Host tasks ${JSON.stringify(host.manager.snapshot().tasks.filter((t) => t.prompt === p2).map((t) => [t.state, t.provider, t.model, t.error, t.activity]))}; UI ${JSON.stringify(await ui("read_chat_items", { ProcessId: app.child.pid }).slice(-2))}`.slice(0, 1500)); });
    assert.equal(ran.length, 0, `local-only chat ran on ${c.provider}:${c.model}`);
    const tasks = host.manager.snapshot().tasks.filter((t) => t.prompt === p2).map((t) => ({ id: t.id, state: t.state, provider: t.provider ?? null, model: t.model ?? null, error: t.error ?? null }));
    hostedRefusal.push({ ...c, attempted: true, hostedRunsObserved: 0, hostTasks: tasks, uiShows: settled.text.slice(0, 300), uiLabels: settled.labels });
  }
  await ui("select_model", { ProcessId: app.child.pid, ModelName: REAL_MODEL, LocalOnly: "1" });

  // Stop through the native Stop button.
  const longPrompt = "Write a detailed 2000-word essay about planetary astrophysics.";
  await ui("enter_and_send", { ProcessId: app.child.pid, PromptText: longPrompt });
  const longTask = await until("long local task running", () => hostTask((t) => t.prompt === longPrompt && t.state === "running"), 30_000);
  await ui("click_stop", { ProcessId: app.child.pid });
  const stopped = await until("task stopped", () => { const t = hostTask((x) => x.id === longTask.id); return t?.state === "stopped" ? t : null; }, 15_000);

  results.stage1 = {
    selectedInUi: selection, prompt, taskId: done.id, state: done.state,
    hostProvider: done.provider, hostModel: done.model, servedModel: done.servedModel ?? null, routesObserved: [...routes],
    constraints: { localOnly: done.constraints.localOnly, offlineOnly: done.constraints.offlineOnly },
    ollamaModelDigest: `sha256:${digest}`, providerReceipts: receiptEvents,
    hostOutput: done.output.trim(), uiDisplayedText: shown.text.trim(), uiDisplayedLabels: shown.labels,
    uiMatchesHost: shown.text.trim() === done.output.trim(),
    hostedRouteUnderLocalOnly: hostedRefusal,
    stopViaUi: { taskId: stopped.id, provider: stopped.provider, model: stopped.model, state: stopped.state },
    authenticatedStateRequests: authSeen.length,
  };
  writeEvidence(join(EVIDENCE_DIR, "stage1-local-ollama-conversation.json"), results.stage1, secrets());
  log("Stage 1 observed:", results.stage1.hostProvider, results.stage1.hostModel, results.stage1.hostOutput);

  // ── Stage 2: Approval Center, driven through the WPF UI ────────────────────────────────────────────
  log("Stage 2: Approval Center");
  const roots = await cmd("connector.roots.set", { roots: [{ id: "r1r2", label: "r1r2", path: projectRoot }] });
  assert.equal(roots.status, 200, `register root: ${JSON.stringify(roots.body).slice(0, 200)}`);
  const target = join(projectRoot, "config.json");
  const initial = '{"state":"clean"}';
  writeFileSync(target, initial);
  writeFileSync(join(projectRoot, "verify.test.js"), 'import test from "node:test";import assert from "node:assert/strict";import {readFileSync} from "node:fs";\ntest("updated",()=>assert.equal(JSON.parse(readFileSync("config.json","utf8")).state,"updated"));\n');
  const fileHash = () => sha(readFileSync(target));
  async function pendingTask(title, content, withTest) {
    const steps = [
      { id: "prepare", kind: "file.prepare", input: { root: "r1r2", path: "config.json", content } },
      { id: "apply", kind: "file.apply", input: { root: "r1r2", path: "config.json", content } },
      ...(withTest ? [{ id: "verify", kind: "local.test", model: REAL_MODEL, input: { root: "r1r2", testFile: "verify.test.js", criteria: "All tests pass" } }] : []),
    ];
    const created = await cmd("ptask.create", { spec: spec(steps, title), envelope: envelope(steps, { files: [{ root: "r1r2", access: "write" }] }, { capabilities: [...new Set(steps.map((s) => s.kind))], sideEffects: true, models: [REAL_MODEL] }) });
    assert.equal(created.status, 200, `ptask.create: ${JSON.stringify(created.body).slice(0, 300)}`);
    const id = (created.body.data ?? created.body).id ?? created.body.result?.id;
    const approved = await cmd("ptask.approve", { id });
    assert.equal(approved.status, 200, `ptask.approve: ${JSON.stringify(approved.body).slice(0, 300)}`);
    return until(`${title} pending action`, () => { host.ptasks.wake?.(); const v = ptask(id); return v.state === "AWAITING_APPROVAL" && v.pendingAction ? v : null; }, 30_000);
  }
  await ui("navigate", { ProcessId: app.child.pid, TargetId: "NavApprovals" });
  // A refresh that throws leaves the Approval Center stale; surface the client's own status text when a row is missing.
  const selectRow = async (actionId) => { try { return await ui("select_approval", { ProcessId: app.child.pid, Match: actionId }); } catch (e) { throw new Error(`${e.message}; client status: ${await ui("read_text", { ProcessId: app.child.pid, TargetId: "HostStatusText" }).text} / ${await ui("read_text", { ProcessId: app.child.pid, TargetId: "HostEpochText" }).text}`); } };

  // 2a. Approve the exact payload in the UI and observe the effect plus the process-test receipt.
  const okTask = await pendingTask("R1R2 approve", '{"state":"updated"}', true);
  const before = fileHash();
  await selectRow(okTask.pendingAction.actionId);
  const shownOk = await ui("read_approvals", { ProcessId: app.child.pid });
  assert.equal(shownOk.payloadSha256, okTask.pendingAction.payloadSha256, "UI must show the Host's exact payload hash");
  assert.equal(fileHash(), before, "nothing changes before approval");
  const approveClick = await ui("invoke_and_dialog", { ProcessId: app.child.pid, TargetId: "ApproveActionButton" });
  const okDone = await until("approved task settles", () => { host.ptasks.wake?.(); const v = ptask(okTask.id); return ["COMPLETED", "FAILED"].includes(v.state) ? v : null; }, 60_000);
  assert.equal(okDone.state, "COMPLETED", `approved task ended ${okDone.state}`);
  assert.equal(readFileSync(target, "utf8"), '{"state":"updated"}');
  const testOut = JSON.parse((await cmd("ptask.output", { id: okTask.id, stepId: "verify" })).body.data?.content ?? "{}");
  const receipts = (await cmd("action.receipts", { id: okTask.id })).body.data ?? {};
  assert.equal(testOut.exitCode, 0); assert.match(testOut.receipt ?? "", /^receipt:test-exec:/);

  // 2b. Incorrect hash (Host contract the UI uses) is refused; then Deny through the UI.
  writeFileSync(target, initial);
  const denyTask = await pendingTask("R1R2 deny", '{"state":"denied"}', false);
  const wrong = await cmd("action.approve", { id: denyTask.id, actionId: denyTask.pendingAction.actionId, payloadSha256: "0".repeat(64) });
  assert.notEqual(wrong.status, 200, "a wrong payload hash must be refused");
  assert.equal(ptask(denyTask.id).state, "AWAITING_APPROVAL");
  await selectRow(denyTask.pendingAction.actionId);
  const denyClick = await ui("invoke_and_dialog", { ProcessId: app.child.pid, TargetId: "DenyActionButton" });
  const denied = await until("denied task", () => { const v = ptask(denyTask.id); return ["FAILED", "CANCELLED"].includes(v.state) ? v : null; }, 15_000);
  assert.equal(readFileSync(target, "utf8"), initial, "denial must leave the file untouched");

  // 2c. Stale task identity: the row is selected, the Host task is cancelled underneath it, then Approve is clicked.
  const staleTask = await pendingTask("R1R2 stale", '{"state":"stale"}', false);
  await selectRow(staleTask.pendingAction.actionId);
  const shownStale = await ui("read_approvals", { ProcessId: app.child.pid });
  const cancelled = await cmd("ptask.cancel", { id: staleTask.id });
  assert.equal(cancelled.status, 200);
  const staleClick = await ui("invoke_and_dialog", { ProcessId: app.child.pid, TargetId: "ApproveActionButton" });
  assert.equal(ptask(staleTask.id).state, "CANCELLED", "a stale approval must not revive a cancelled task");
  assert.equal(readFileSync(target, "utf8"), initial, "stale approval must not apply");

  // 2d. Restart: a pending action survives a Host restart and is approved through the reconnected UI.
  const restartTask = await pendingTask("R1R2 restart", '{"state":"updated"}', false);
  const epochBefore = host.manager.instanceId;
  await host.close();
  host = await startHost({ port: PORT, dataDirectory: hostDir });
  watchAuth(host);
  const afterRestart = await until("pending action after restart", () => { const v = ptask(restartTask.id); return v ? v : null; }, 15_000);
  let restartOutcome = { stateAfterRestart: afterRestart.state, pendingActionSurvived: !!afterRestart.pendingAction, epochChanged: host.manager.instanceId !== epochBefore };
  if (afterRestart.pendingAction) {
    await sleep(4000); // one UI refresh cycle against the new Host
    await selectRow(afterRestart.pendingAction.actionId);
    const restartClick = await ui("invoke_and_dialog", { ProcessId: app.child.pid, TargetId: "ApproveActionButton" });
    const settled = await until("post-restart task", () => { host.ptasks.wake?.(); const v = ptask(restartTask.id); return ["COMPLETED", "FAILED", "CANCELLED", "AWAITING_APPROVAL"].includes(v.state) && !v.pendingAction ? v : null; }, 60_000);
    restartOutcome = { ...restartOutcome, uiDialog: restartClick, finalState: settled.state, fileAfter: readFileSync(target, "utf8") };
  }

  results.stage2 = {
    approve: { taskId: okTask.id, actionId: okTask.pendingAction.actionId, hostPayloadSha256: okTask.pendingAction.payloadSha256, uiPayloadSha256: shownOk.payloadSha256, uiOperation: shownOk.operation, beforeSha256: before, afterSha256: fileHash(), uiDialog: approveClick, finalState: okDone.state, testReceipt: testOut.receipt, testExitCode: testOut.exitCode, actionReceipts: receipts.receipts?.length ?? 0, ledgerVerified: receipts.chain ?? null },
    incorrectHash: { channel: "Host command (same contract the UI calls)", httpStatus: wrong.status, refusal: String(wrong.body.error ?? "").slice(0, 200), stateAfter: "AWAITING_APPROVAL" },
    deny: { taskId: denyTask.id, uiDialog: denyClick, finalState: denied.state, fileUnchanged: true },
    staleIdentity: { taskId: staleTask.id, uiShowedRow: shownStale.payloadSha256 === staleTask.pendingAction.payloadSha256, uiDialog: staleClick, finalState: "CANCELLED", fileUnchanged: true },
    cancellation: { channel: "Host command", taskId: staleTask.id, httpStatus: cancelled.status },
    restart: restartOutcome,
  };
  writeEvidence(join(EVIDENCE_DIR, "stage2-approval-center-ui.json"), results.stage2, secrets());
  log("Stage 2 observed:", JSON.stringify(results.stage2.restart));

  // ── Stage 3: notch geometry, agent arrangement, focus, persistence ────────────────────────────────
  log("Stage 3: notch");
  const startLayout = await ui("notch_layout", { ProcessId: app.child.pid, ConfigPath: configPath });
  const edges = [];
  for (const edge of ["Right", "Bottom", "Left", "Top", "Right"]) {
    await ui("cycle_dock_edge", { ProcessId: app.child.pid, ExpectedEdge: edge, ConfigPath: configPath });
    await sleep(300);
    const l = await ui("notch_layout", { ProcessId: app.child.pid, ConfigPath: configPath });
    const n = l.notch, wa = l.workArea;
    const gaps = { top: n.y - wa.y, bottom: wa.y + wa.height - (n.y + n.height), left: n.x - wa.x, right: wa.x + wa.width - (n.x + n.width) };
    const horizontal = edge === "Top" || edge === "Bottom";
    const ids = l.agents.map((a) => a.id);
    edges.push({
      edge, persistedEdge: l.persistedEdge, notch: n, workArea: wa, gapsPx: gaps,
      gapToDockedEdgePx: gaps[edge.toLowerCase()],
      centeredOffsetPx: horizontal ? Math.round(n.x + n.width / 2 - (wa.x + wa.width / 2)) : Math.round(n.y + n.height / 2 - (wa.y + wa.height / 2)),
      agentsRendered: ids, agents: l.agents,
      // Images are Stretch=Uniform inside fixed badges, so widths differ per PNG; alignment is judged on centres (±1 px).
      agentCentres: l.agents.map((a) => ({ id: a.id, cx: a.x + a.width / 2, cy: a.y + a.height / 2 })),
      agentsInOneRow: horizontal ? spread(l.agents.map((a) => a.y + a.height / 2)) <= 1 : null,
      agentsInOneColumn: horizontal ? null : spread(l.agents.map((a) => a.x + a.width / 2)) <= 1,
      agentsLeadingOffsetPx: l.agents.length ? (horizontal ? Math.min(...l.agents.map((a) => a.x)) - n.x : Math.min(...l.agents.map((a) => a.y)) - n.y) : null,
      agentOrder: [...l.agents].sort((a, b) => horizontal ? a.x - b.x : a.y - b.y).map((a) => a.id.replace(/^V?Agent/, "")),
      foreground: l.foreground,
    });
  }
  for (const e of edges) {
    assert.equal(e.persistedEdge, e.edge, `${e.edge} must persist`);
    assert.ok(Math.abs(e.gapToDockedEdgePx) <= 2, `${e.edge} notch must touch its edge (gap ${e.gapToDockedEdgePx}px)`);
    assert.ok(Math.abs(e.centeredOffsetPx) <= 2, `${e.edge} notch must be centred (offset ${e.centeredOffsetPx}px)`);
    assert.equal(e.agentsRendered.length, 4, `${e.edge} must render four agents`);
    assert.ok(e.agentsRendered.every((id) => id.startsWith(e.edge === "Top" || e.edge === "Bottom" ? "Agent" : "VAgent")), `${e.edge} must use its own layout`);
    assert.ok(e.agentsInOneRow ?? e.agentsInOneColumn, `${e.edge} agents must align`);
    assert.deepEqual(e.agentOrder, ["Gada", "Spear", "Chakra", "Sword"]);
  }
  results.stage3 = { note: "Rectangles are physical pixels (DPI-aware UIA). The notch window includes a 12 DIP transparent margin around the visible glass.", initial: startLayout, edges, reducedMotion: "AppConfiguration.ReducedMotion exists but nothing reads it, and the app defines no animations (no Storyboard or *Animation in native/windows). There is no motion to reduce; the setting is inert." };

  // ── Stage 4: lifecycle — clean exit, owned process tree, persistence, single instance, forced kill ──
  log("Stage 4: lifecycle");
  const second = launch("second-instance");
  const secondExit = await Promise.race([second.exited, sleep(8000).then(() => null)]);
  if (!secondExit) second.child.kill();
  const treeBefore = await ui("process_tree", { ProcessId: app.child.pid });
  const quit = await ui("invoke_and_dialog", { ProcessId: app.child.pid, TargetId: "QuitButton" });
  const cleanExit = await Promise.race([app.exited, sleep(15000).then(() => null)]);
  const treeAfter = await ui("process_tree", { ProcessId: app.child.pid });
  const survivors = treeBefore.descendants.filter((d) => spawnSync("powershell.exe", ["-NoProfile", "-Command", `(Get-Process -Id ${d.pid} -ErrorAction SilentlyContinue).StartTime.ToUniversalTime().ToString('o')`], { encoding: "utf8" }).stdout.trim().slice(0, 19) === d.created.slice(0, 19));
  const relaunch = launch("persistence");
  await until("relaunched client authenticated", () => authSeen.length > 0, 20_000);
  await sleep(2500);
  const persisted = await ui("notch_layout", { ProcessId: relaunch.child.pid, ConfigPath: configPath });
  const relTree = await ui("process_tree", { ProcessId: relaunch.child.pid });
  relaunch.child.kill();
  const forced = await relaunch.exited;
  app = null;
  results.stage4 = {
    singleInstance: { secondExit: secondExit ? { code: secondExit.code, signal: secondExit.signal } : "did not exit within 8 s (killed)" },
    cleanExit: { method: "UIA invoke of QuitButton → Application.Shutdown(0)", uiDialog: quit.dialogTitle, exit: cleanExit ? { code: cleanExit.code, signal: cleanExit.signal } : "did not exit within 15 s", ownedTreeBefore: treeBefore.descendants, mainAliveAfter: treeAfter.alive, survivingDescendants: survivors },
    persistenceAcrossRestart: { lastEdgeBeforeQuit: edges.at(-1).edge, persistedEdge: persisted.persistedEdge, notchAfterRelaunch: persisted.notch, workArea: persisted.workArea, agentsRendered: persisted.agents.map((a) => a.id) },
    forcedTermination: { method: "ChildProcess.kill() → TerminateProcess", exit: { code: forced.code, signal: forced.signal }, ownedTreeBefore: relTree.descendants, classifiedAs: "forced, not clean" },
  };
  writeEvidence(join(EVIDENCE_DIR, "stage3-notch-geometry.json"), results.stage3, secrets());
  writeEvidence(join(EVIDENCE_DIR, "stage4-lifecycle.json"), results.stage4, secrets());
  writeEvidence(join(EVIDENCE_DIR, "summary.json"), { runId: RUN_ID, binarySha256: results.binarySha256, completedAt: new Date().toISOString() }, secrets());
  log(`Evidence written to ${EVIDENCE_DIR}`);
} catch (error) {
  writeEvidence(join(EVIDENCE_DIR, "failure.json"), { runId: RUN_ID, failedAt: new Date().toISOString(), error: String(error?.message ?? error).slice(0, 2000), partial: results }, secrets());
  throw error;
} finally {
  if (app) { try { app.child.kill(); } catch {} }
  await host.close();
  for (const d of [hostDir, configDir, projectRoot]) try { rmSync(d, { recursive: true, force: true }); } catch {}
}
