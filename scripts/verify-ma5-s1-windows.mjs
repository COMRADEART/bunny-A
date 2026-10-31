// MA5-S1: UI-driven acceptance of the compiled WPF client against an isolated real Host (local Ollama only).
// Every value recorded is observed: Host state, UI Automation reads, Ollama tags, the process table and monitors.
// Nothing here calls the task runtime directly; Host commands are used only to set up fixtures or check the contract.
import { spawn, execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { startHost } from "../src/lib/bunny-host/http.server.ts";
import { spec, envelope, TEST_BASE } from "../src/lib/bunny-host/ma4-s2t2-fixtures.ts";
import { writeEvidence } from "./evidence-guard.mjs";

const execFileAsync = promisify(execFile);
const RUN_ID = `ma5s1-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const EVIDENCE_DIR = join(process.cwd(), "test-results", "ma5-s1-windows", RUN_ID);
mkdirSync(EVIDENCE_DIR, { recursive: true });
const REAL_MODEL = "qwen2.5-coder:7b";
const PORT = 43189;
const exePath = process.env.BUNNY_EXE ?? join(process.cwd(), "native/windows/BunnyA/bin/Debug/net8.0-windows/BunnyA.exe");
const helper = join(process.cwd(), "scripts/ui-automation-helper.ps1");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const spread = (xs) => Math.max(...xs) - Math.min(...xs);
const sha = (s) => createHash("sha256").update(s).digest("hex");
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

// The single-instance mutex is global: a running owner copy would make our launch exit and test nothing.
const running = spawnSync("tasklist", ["/FI", "IMAGENAME eq BunnyA.exe", "/FO", "CSV", "/NH"], { encoding: "utf8" }).stdout;
assert.ok(!/BunnyA\.exe/i.test(running), "Another BunnyA.exe is running; close it before acceptance.");

const hostDir = mkdtempSync(join(tmpdir(), "bunny-host-ma5s1-"));
const configDir = mkdtempSync(join(tmpdir(), "bunny-config-ma5s1-"));
const configPath = join(configDir, "config.json");
writeFileSync(configPath, JSON.stringify({ NotchEdge: "Top", NotchOffsetRatio: 0.5 }));
mkdirSync(TEST_BASE, { recursive: true });
const projectRoot = mkdtempSync(join(TEST_BASE, "ma5s1-approval-"));

let host = await startHost({ port: PORT, dataDirectory: hostDir });
const secrets = () => [host.token];
const credPath = join(hostDir, "client-credentials.json");
const writeCreds = () => writeFileSync(credPath, JSON.stringify({ port: PORT, token: host.token }));
writeCreds();
const requests = [];
const watch = (h) => h.server.prependListener("request", (req) => {
  if (req.headers.authorization) requests.push({ at: Date.now(), path: req.url.split("?")[0], authenticated: req.headers.authorization === `Bearer ${h.token}` });
});
watch(host);

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
    body: JSON.stringify({ action, data, operationId: crypto.randomUUID() }), signal: AbortSignal.timeout(60_000),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
async function until(what, fn, ms = 30_000, every = 250) {
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
const config = () => JSON.parse(readFileSync(configPath, "utf8").replace(/^\uFEFF/, ""));
const results = { runId: RUN_ID, binary: exePath, binarySha256: sha(readFileSync(exePath)), host: { port: PORT, isolatedDataDirectory: true }, configIsolated: true, stages: {} };
const failures = [];
const ONLY = process.env.MA5_STAGES ? new Set(process.env.MA5_STAGES.split(",")) : null;
async function diagnose() {
  const read = async (fn) => { try { return await fn(); } catch (e) { return String(e.message).slice(0, 200); } };
  return {
    hostStatus: await read(async () => (await ui("read_text", { ProcessId: app.child.pid, TargetId: "HostStatusText" })).text),
    hostEpochText: await read(async () => (await ui("read_text", { ProcessId: app.child.pid, TargetId: "HostEpochText" })).text),
    chatTail: await read(async () => (await ui("read_chat_items", { ProcessId: app.child.pid })).slice(-3)),
    hostTasks: host.manager.snapshot().tasks.slice(-4).map((t) => ({ prompt: t.prompt?.slice(0, 60), state: t.state, provider: t.provider, model: t.model, error: t.error })),
    missions: host.missions.snapshot().missions?.slice(-3).map((m) => ({ title: m.title, state: m.state, objective: m.objective?.slice(0, 60) })),
  };
}
async function stage(name, fn) {
  if (ONLY && !ONLY.has(name)) return;
  log(`── ${name}`);
  try { results.stages[name] = { ok: true, ...(await fn()) }; }
  catch (e) { failures.push(name); results.stages[name] = { ok: false, error: String(e?.message ?? e).slice(0, 2000), diagnostics: await diagnose() }; log(`FAILED ${name}: ${e.message}`); }
  writeEvidence(join(EVIDENCE_DIR, `${name}.json`), results.stages[name], secrets());
}

let app;
try {
  results.monitors = await ui("monitors");
  await host.manager.discover();
  const ollama = host.manager.snapshot().providers.find((p) => p.id === "ollama");
  assert.equal(ollama?.availability, "ready", "Ollama must be ready");
  assert.ok(ollama.models?.includes(REAL_MODEL), `${REAL_MODEL} must be installed`);
  const tags = await (await fetch("http://127.0.0.1:11434/api/tags")).json();
  const digest = tags.models.find((m) => m.name === REAL_MODEL)?.digest;
  assert.match(digest ?? "", /^[a-f0-9]{64}$/, "Ollama must report the model digest");
  const cloudTag = (ollama.models ?? []).find((m) => /(:|-)cloud$/i.test(m)) ?? null;

  app = launch("primary");
  await until("authenticated /state from BunnyA", () => requests.some((r) => r.path === "/state"), 20_000);

  // ── W3 chat: explicit local model, local-only, served digest, Stop ─────────────────────────────────
  await stage("w3-chat", async () => {
    let pickErr = "";
    const selection = await until("model list in the chat picker", async () => { try { return await ui("select_model", { ProcessId: app.child.pid, ModelName: REAL_MODEL, LocalOnly: "1" }); } catch (e) { pickErr = e.message; return null; } }, 30_000, 1000)
      .catch((e) => { throw new Error(`${e.message}; last UI error: ${pickErr}`); });
    assert.equal(selection.selectedModel, REAL_MODEL);
    assert.equal(selection.localOnlyChecked, true);
    // Local only hides hosted routes from the picker itself (the Host also refuses them).
    let cloudOffered = null;
    if (cloudTag) {
      try { await ui("select_model", { ProcessId: app.child.pid, ModelName: cloudTag, LocalOnly: "1" }); cloudOffered = true; }
      catch { cloudOffered = false; }
      await ui("select_model", { ProcessId: app.child.pid, ModelName: REAL_MODEL, LocalOnly: "1" });
    }
    assert.notEqual(cloudOffered, true, `${cloudTag} must not be offered under Local only`);

    const prompt = "What is 34 + 28? Answer with ONLY the number.";
    await ui("enter_and_send", { ProcessId: app.child.pid, PromptText: prompt });
    const submitted = await until("Host task from the UI", () => hostTask((t) => t.prompt === prompt), 15_000);
    const done = await until("local task settles", () => {
      const t = hostTask((x) => x.id === submitted.id);
      if (t?.provider && (t.provider !== "ollama" || t.model !== REAL_MODEL)) throw new Error(`Route changed to ${t.provider}:${t.model}`);
      return t && ["completed", "failed", "stopped"].includes(t.state) ? t : null;
    }, 180_000);
    assert.equal(done.state, "completed", `local task ended ${done.state}: ${done.error ?? ""}`);
    assert.match(done.output, /62/);
    let items = [];
    const shown = await until("answer in native chat", async () => {
      items = await ui("read_chat_items", { ProcessId: app.child.pid });
      return items.find((i) => i.text.trim() === done.output.trim() && i.labels.some((l) => l.includes(`ollama · ${REAL_MODEL}`)));
    }, 20_000, 500).catch((e) => { throw new Error(`${e.message}; UI ${JSON.stringify(items).slice(0, 800)}`); });
    const label = shown.labels.find((l) => l.includes(`ollama · ${REAL_MODEL}`));
    const servedDigest = done.servedModel?.digest ?? null;

    const longPrompt = "Write a detailed 2000-word essay about planetary astrophysics.";
    await ui("enter_and_send", { ProcessId: app.child.pid, PromptText: longPrompt });
    const longTask = await until("long local task running", () => hostTask((t) => t.prompt === longPrompt && t.state === "running"), 60_000);
    await ui("click_stop", { ProcessId: app.child.pid });
    const stopped = await until("task stopped", () => { const t = hostTask((x) => x.id === longTask.id); return t?.state === "stopped" ? t : null; }, 20_000);
    const stoppedUi = await until("stopped shown", async () => (await ui("read_chat_items", { ProcessId: app.child.pid })).at(-1)?.labels?.includes("Cancelled") ? true : null, 10_000, 500);
    return {
      selection, cloudTag, cloudOfferedUnderLocalOnly: cloudOffered,
      taskId: done.id, hostProvider: done.provider, hostModel: done.model, constraints: done.constraints,
      ollamaDigest: `sha256:${digest}`, hostServedDigest: servedDigest, uiLabel: label,
      uiShowsServedDigest: !!servedDigest && label.includes(servedDigest.slice(0, 19)),
      hostOutput: done.output.trim(), uiText: shown.text.trim(), uiMatchesHost: shown.text.trim() === done.output.trim(),
      stop: { taskId: stopped.id, state: stopped.state, uiShowsCancelled: stoppedUi },
      submitsForPrompt: host.manager.snapshot().tasks.filter((t) => t.prompt === prompt).length,
    };
  });

  // ── W4 agent execution: Mission created from the UI, plan reviewed and approved in the UI, real step states ──
  await stage("w4-mission", async () => {
    // Missions are off by default on a Host; the owner turns them on in the native Settings screen.
    await ui("navigate", { ProcessId: app.child.pid, TargetId: "NavSettings" });
    await until("Missions setting loaded", async () => (await ui("read_toggle", { ProcessId: app.child.pid, TargetId: "MissionsEnabledCheck" })).enabled ? true : null, 15_000, 500);
    await ui("click_toggle", { ProcessId: app.child.pid, TargetId: "MissionsEnabledCheck" });
    await until("Host has Missions enabled", () => host.missions.snapshot().enabled, 15_000);
    await ui("navigate", { ProcessId: app.child.pid, TargetId: "NavChat" });
    const objective = `MA5-S1 mission ${Date.now()}: list three prime numbers below 20 and check them.`;
    await ui("set_text", { ProcessId: app.child.pid, TargetId: "PromptInput", PromptText: objective });
    const delegateClick = await ui("invoke_and_dialog", { ProcessId: app.child.pid, TargetId: "DelegateButton" });
    const created = await until("Mission from the UI", () => host.missions.snapshot().missions.find((m) => m.objective === objective), 20_000)
      .catch((e) => { throw new Error(`${e.message}; dialog ${JSON.stringify(delegateClick)}`); });
    const missionId = created.id;
    const view = () => host.missions.snapshot().missions.find((m) => m.id === missionId);
    const planned = await until("Mission waits for plan approval", () => { const m = view(); if (["failed", "stopped"].includes(m?.state)) throw new Error(`Mission ${m.state} during planning`); return m?.state === "waiting_for_approval" ? m : null; }, 300_000, 1000);
    await ui("navigate", { ProcessId: app.child.pid, TargetId: "NavAgents" });
    await sleep(1500);
    await ui("select_list_item", { ProcessId: app.child.pid, TargetId: "ActiveTasksList", Match: "[Mission]" });
    const stepsShown = await ui("read_list", { ProcessId: app.child.pid, TargetId: "MissionStepsList" });
    await ui("navigate", { ProcessId: app.child.pid, TargetId: "RunWithAgentsButton" });
    const review = await ui("read_approvals", { ProcessId: app.child.pid });
    // The reference /state projects for a waiting Mission (the raw in-process snapshot does not carry it).
    const planRef = host.missions.agenticPlanReference(missionId);
    // Host contract the UI binds to: a different plan reference is refused and nothing starts.
    const wrongPlan = await cmd("mission.approve", { id: missionId, start: true, plan: "0".repeat(64) });
    assert.notEqual(wrongPlan.status, 200, "a stale plan reference must be refused");
    assert.equal(view().state, "waiting_for_approval");
    assert.ok(review.payloadSha256 === planRef && review.approveEnabled, `UI must show the plan reference ${planRef} (shows ${review.payloadSha256})`);
    await ui("invoke_and_dialog", { ProcessId: app.child.pid, TargetId: "ApproveActionButton" });
    const states = [];
    const finished = await until("Mission finishes", async () => {
      const m = view();
      const row = (m?.steps ?? []).map((s) => `${s.role}:${s.state}`).join(",");
      if (states.at(-1)?.host !== row) states.push({ at: Date.now(), host: row, mission: m?.state });
      return ["completed", "failed", "stopped"].includes(m?.state) ? m : null;
    }, 600_000, 1500);
    await ui("navigate", { ProcessId: app.child.pid, TargetId: "NavAgents" });
    await sleep(1500);
    let finalUi = [];
    try { await ui("select_list_item", { ProcessId: app.child.pid, TargetId: "TaskHistoryList", Match: "[Mission]" }); } catch { /* the UI list may not be open yet; the Host-side state still records it */ }
    try { await ui("select_list_item", { ProcessId: app.child.pid, TargetId: "ActiveTasksList", Match: "[Mission]" }); finalUi = await ui("read_list", { ProcessId: app.child.pid, TargetId: "MissionStepsList" }); } catch { /* same fallback as above */ }
    await ui("navigate", { ProcessId: app.child.pid, TargetId: "NavApprovals" });
    const receipts = (await ui("read_approvals", { ProcessId: app.child.pid })).receipts;
    return {
      missionId, createdFromUi: true, plannedSteps: planned.steps.map((s) => ({ role: s.role, objective: s.objective, state: s.state })),
      uiStepsAtReview: stepsShown.map((r) => r.name), planReference: planRef, uiPlanReference: review.payloadSha256, uiPlanText: review.plan,
      wrongPlanRefusal: { status: wrongPlan.status, error: String(wrongPlan.body.error ?? "").slice(0, 200) },
      hostStepTimeline: states, finalState: finished.state,
      finalSteps: finished.steps.map((s) => ({ role: s.role, state: s.state, verified: s.result?.verified ?? null, taskId: s.taskId })),
      finalUiSteps: finalUi.map((r) => r.name), decisionLog: receipts,
    };
  });

  // ── W4b: a four-role Mission (explicit plan supplied on the workstation), reviewed and approved in the UI ──
  await stage("w4b-roles", async () => {
    if (!host.missions.snapshot().enabled) assert.equal((await cmd("mission.configure", { enabled: true })).status, 200);
    const objective = `MA5-S1 roles ${Date.now()}: is 17 prime?`;
    const step = (role, text, dependsOn) => ({ role, objective: text, dependsOn, executor: { kind: "model" }, preferences: { local: true } });
    const created = await cmd("mission.create", { objective, mode: "fast", localOnly: true, steps: [
      step("Planner", "In one sentence, plan how to decide whether 17 is prime.", []),
      step("Worker", "Decide whether 17 is prime. Answer yes or no with one reason.", [0]),
      step("Tester", "Check the previous answer about 17 by trial division up to 4. Reply PASS or FAIL.", [1]),
      step("Reviewer", "In one sentence, review whether the conclusion about 17 is correct.", [2]),
    ] });
    assert.equal(created.status, 200, JSON.stringify(created.body).slice(0, 300));
    const missionId = created.body.mission.id;
    const view = () => host.missions.snapshot().missions.find((m) => m.id === missionId);
    await until("plan waits for approval", () => view()?.state === "waiting_for_approval", 60_000, 500);
    await ui("navigate", { ProcessId: app.child.pid, TargetId: "NavAgents" });
    await sleep(2000);
    await ui("select_list_item", { ProcessId: app.child.pid, TargetId: "ActiveTasksList", Match: "MA5-S1 roles" });
    const reviewSteps = (await ui("read_list", { ProcessId: app.child.pid, TargetId: "MissionStepsList" })).map((r) => r.name);
    await ui("navigate", { ProcessId: app.child.pid, TargetId: "RunWithAgentsButton" });
    const review = await ui("read_approvals", { ProcessId: app.child.pid });
    assert.equal(review.payloadSha256, host.missions.agenticPlanReference(missionId));
    await ui("invoke_and_dialog", { ProcessId: app.child.pid, TargetId: "ApproveActionButton" });
    // Sample what the Host reports and what the dashboard shows for the same Mission while it runs.
    await ui("navigate", { ProcessId: app.child.pid, TargetId: "NavAgents" });
    const timeline = [];
    const finished = await until("four-role Mission finishes", async () => {
      const m = view();
      let shown = null;
      try { await ui("select_list_item", { ProcessId: app.child.pid, TargetId: "ActiveTasksList", Match: "MA5-S1 roles" }); shown = (await ui("read_list", { ProcessId: app.child.pid, TargetId: "MissionStepsList" })).map((r) => r.name.split("\n")[0]); } catch { /* UI list may be closed between polls; the host snapshot still advances the timeline */ }
      const host = (m?.steps ?? []).map((s) => `${s.role}:${s.state}`);
      if (JSON.stringify(timeline.at(-1)?.host) !== JSON.stringify(host)) timeline.push({ at: new Date().toISOString(), mission: m?.state, host, ui: shown });
      return ["completed", "failed", "stopped"].includes(m?.state) ? m : null;
    }, 900_000, 2000);
    const uiMatchedHost = timeline.filter((t) => t.ui).every((t) => t.host.every((h) => t.ui.some((u) => u.includes(h.split(":")[0]) && u.includes(h.split(":")[1].toUpperCase()))));
    return {
      missionId, roles: finished.steps.map((s) => s.role), reviewSteps, planReference: review.payloadSha256, finalState: finished.state,
      finalSteps: finished.steps.map((s) => ({ role: s.role, state: s.state, verified: s.result?.verified ?? null, summary: s.result?.summary?.slice(0, 160) ?? null })),
      timeline, uiStepRowsMatchedHostWhenSampled: uiMatchedHost,
    };
  });

  // ── Voice wiring: the native controls drive the Host's voice session. No listening is started, so no audio is
  // captured and nothing here is acoustic evidence.
  await stage("voice-wiring", async () => {
    await ui("navigate", { ProcessId: app.child.pid, TargetId: "NavVoice" });
    const read = async () => (await (await fetch(`http://127.0.0.1:${PORT}/state`, { headers: { authorization: `Bearer ${host.token}` } })).json()).voice ?? null;
    const before = await read();
    const steps = [];
    const press = async (id, label, check) => {
      const click = await ui("invoke_and_dialog", { ProcessId: app.child.pid, TargetId: id });
      const after = await until(label, async () => { const v = await read(); return check(v) ? v : null; }, 20_000, 500)
        .catch(async (e) => { throw new Error(`${e.message}; dialog ${JSON.stringify(click)}; voice ${JSON.stringify(await read()).slice(0, 400)}`); });
      const shown = (await ui("read_text", { ProcessId: app.child.pid, TargetId: "VoiceStateText" })).text;
      steps.push({ control: id, hostOpen: after.open, hostState: after.state, hostMuted: after.muted, hostError: after.error, uiState: shown, dialog: click.dialogTitle });
      return after;
    };
    const opened = await press("VoiceSessionButton", "session open", (v) => v?.open === true);
    await press("VoiceMuteButton", "muted", (v) => v?.muted === true);
    await press("VoiceMuteButton", "unmuted", (v) => v?.muted === false);
    await press("VoiceSessionButton", "session closed", (v) => v?.open === false);
    return { before: { open: before?.open ?? null, state: before?.state ?? null }, devicesReported: opened.devices ?? null, engines: opened.engines ?? null, steps,
      note: "Listening was never started: no microphone capture, no playback. Physical acoustic qualification is separate." };
  });

  // ── W5 Approval Center: exact payload, Host context, wrong hash, deny, stale, restart ────────────────
  await stage("w5-approvals", async () => {
    const roots = await cmd("connector.roots.set", { roots: [{ id: "ma5s1", label: "ma5s1", path: projectRoot }] });
    assert.equal(roots.status, 200, `register root: ${JSON.stringify(roots.body).slice(0, 200)}`);
    const target = join(projectRoot, "config.json");
    const initial = '{"state":"clean"}';
    writeFileSync(target, initial);
    writeFileSync(join(projectRoot, "verify.test.js"), 'import test from "node:test";import assert from "node:assert/strict";import {readFileSync} from "node:fs";\ntest("updated",()=>assert.equal(JSON.parse(readFileSync("config.json","utf8")).state,"updated"));\n');
    const fileHash = () => sha(readFileSync(target));
    async function pendingTask(title, content, withTest) {
      const steps = [
        { id: "prepare", kind: "file.prepare", input: { root: "ma5s1", path: "config.json", content } },
        { id: "apply", kind: "file.apply", input: { root: "ma5s1", path: "config.json", content } },
        ...(withTest ? [{ id: "verify", kind: "local.test", model: REAL_MODEL, input: { root: "ma5s1", testFile: "verify.test.js", criteria: "All tests pass" } }] : []),
      ];
      const created = await cmd("ptask.create", { spec: spec(steps, title), envelope: envelope(steps, { files: [{ root: "ma5s1", access: "write" }] }, { capabilities: [...new Set(steps.map((s) => s.kind))], sideEffects: true, models: [REAL_MODEL] }) });
      assert.equal(created.status, 200, `ptask.create: ${JSON.stringify(created.body).slice(0, 300)}`);
      const id = (created.body.data ?? created.body).id;
      assert.equal((await cmd("ptask.approve", { id })).status, 200);
      return until(`${title} pending action`, () => { host.ptasks.wake?.(); const v = ptask(id); return v.state === "AWAITING_APPROVAL" && v.pendingAction ? v : null; }, 30_000);
    }
    await ui("navigate", { ProcessId: app.child.pid, TargetId: "NavApprovals" });
    const select = (actionId) => ui("select_approval", { ProcessId: app.child.pid, Match: actionId });
    const readUntilInspected = () => until("Host context in the Approval Center", async () => { const r = await ui("read_approvals", { ProcessId: app.child.pid }); return r.approveEnabled ? r : null; }, 15_000, 500);

    // Approve: the pane shows the Host's exact grants (action.inspect) and hash; the effect and receipt follow.
    const okTask = await pendingTask("MA5 approve", '{"state":"updated"}', true);
    const before = fileHash();
    await sleep(3500);
    await select(okTask.pendingAction.actionId);
    const shown = await readUntilInspected();
    assert.equal(shown.payloadSha256, okTask.pendingAction.payloadSha256);
    assert.match(shown.scope, /ma5s1|Folder/i, "scope must come from the Host's grants");
    assert.equal(fileHash(), before, "nothing changes before approval");
    const approveClick = await ui("invoke_and_dialog", { ProcessId: app.child.pid, TargetId: "ApproveActionButton" });
    const okDone = await until("approved task settles", () => { host.ptasks.wake?.(); const v = ptask(okTask.id); return ["COMPLETED", "FAILED"].includes(v.state) ? v : null; }, 120_000);
    assert.equal(okDone.state, "COMPLETED");
    const testOut = JSON.parse((await cmd("ptask.output", { id: okTask.id, stepId: "verify" })).body.data?.content ?? "{}");
    const actionReceipts = (await cmd("action.receipts", { id: okTask.id })).body.data ?? {};
    const afterApprove = await ui("read_approvals", { ProcessId: app.child.pid });
    assert.match(afterApprove.receipts, /APPROVED .* operation [0-9a-f-]{36} applied/, "the decision log must carry the Host operation receipt");

    // Wrong hash on the Host contract the UI uses; then Deny through the UI.
    writeFileSync(target, initial);
    const denyTask = await pendingTask("MA5 deny", '{"state":"denied"}', false);
    const wrong = await cmd("action.approve", { id: denyTask.id, actionId: denyTask.pendingAction.actionId, payloadSha256: "0".repeat(64) });
    assert.notEqual(wrong.status, 200);
    assert.equal(ptask(denyTask.id).state, "AWAITING_APPROVAL");
    await sleep(3500);
    await select(denyTask.pendingAction.actionId);
    const denyClick = await ui("invoke_and_dialog", { ProcessId: app.child.pid, TargetId: "DenyActionButton" });
    const denied = await until("denied task", () => { const v = ptask(denyTask.id); return ["FAILED", "CANCELLED"].includes(v.state) ? v : null; }, 15_000);
    assert.equal(readFileSync(target, "utf8"), initial);

    // Stale: the reviewed row is cancelled on the Host, then Approve is clicked. The UI must not send it.
    const staleTask = await pendingTask("MA5 stale", '{"state":"stale"}', false);
    await sleep(3500);
    await select(staleTask.pendingAction.actionId);
    await readUntilInspected();
    const journalBefore = host.manager.db.cursor();
    assert.equal((await cmd("ptask.cancel", { id: staleTask.id })).status, 200);
    // What the Approval Center shows the moment the cancel is known, then the click (which a disabled button refuses).
    const paneAfterCancel = await ui("read_approvals", { ProcessId: app.child.pid });
    const staleClick = await ui("invoke_and_dialog", { ProcessId: app.child.pid, TargetId: "ApproveActionButton" }).catch((e) => ({ refused: e.message.slice(0, 200) }));
    await sleep(3000);
    assert.equal(ptask(staleTask.id).state, "CANCELLED");
    assert.equal(readFileSync(target, "utf8"), initial);
    // The client's own record, and the Host journal of every command it received after the cancel.
    const staleLog = (await ui("read_approvals", { ProcessId: app.child.pid })).receipts ?? "";
    const commandsAfterCancel = host.manager.db.events(journalBefore).filter((e) => e.type === "audit.command").map((e) => e.detail);
    const rowGone = !paneAfterCancel.rows.some((r) => r.name.includes(staleTask.pendingAction.actionId));
    const loggedRefusal = /NOT SENT|REFUSED BY HOST/.test(staleLog.split("\n")[0]);
    // Fail closed either way: the row disappeared and Approve was disabled, or the client refused/the Host refused.
    assert.ok((rowGone && !paneAfterCancel.approveEnabled) || loggedRefusal, `stale request still approvable: ${JSON.stringify(paneAfterCancel).slice(0, 400)}`);
    assert.ok(!commandsAfterCancel.some((d) => /action\.approve/.test(d)), "no approval of the cancelled action may reach the Host");

    // Restart: the pending action survives; the UI drops its selection and requires a fresh review before approving.
    const restartTask = await pendingTask("MA5 restart", '{"state":"updated"}', false);
    await sleep(3500);
    await select(restartTask.pendingAction.actionId);
    await readUntilInspected();
    const epochBefore = host.manager.instanceId;
    await host.close();
    host = await startHost({ port: PORT, dataDirectory: hostDir });
    watch(host); writeCreds();
    await until("UI on the new epoch", async () => (await ui("read_text", { ProcessId: app.child.pid, TargetId: "HostEpochText" })).text?.includes(host.manager.instanceId) ? true : null, 45_000, 1000);
    const afterRestart = await ui("read_approvals", { ProcessId: app.child.pid });
    const selectedAfterRestart = afterRestart.rows.some((r) => r.selected);
    const view = ptask(restartTask.id);
    let restartOutcome = { epochChanged: host.manager.instanceId !== epochBefore, pendingActionSurvived: !!view?.pendingAction, selectionClearedByUi: !selectedAfterRestart, approveEnabledWithoutReview: afterRestart.approveEnabled };
    if (view?.pendingAction) {
      await select(view.pendingAction.actionId);
      await readUntilInspected();
      const click = await ui("invoke_and_dialog", { ProcessId: app.child.pid, TargetId: "ApproveActionButton" });
      const settled = await until("post-restart task", () => { host.ptasks.wake?.(); const v = ptask(restartTask.id); return ["COMPLETED", "FAILED", "CANCELLED"].includes(v.state) ? v : null; }, 60_000);
      restartOutcome = { ...restartOutcome, uiDialog: click, finalState: settled.state, fileAfter: readFileSync(target, "utf8") };
    }
    assert.ok(restartOutcome.selectionClearedByUi && !restartOutcome.approveEnabledWithoutReview, "after a restart the UI must require a fresh review");
    return {
      approve: { taskId: okTask.id, actionId: okTask.pendingAction.actionId, hostPayloadSha256: okTask.pendingAction.payloadSha256, uiPayloadSha256: shown.payloadSha256, uiScope: shown.scope, uiEffects: shown.effects, uiContext: shown.context, beforeSha256: before, afterSha256: fileHash(), uiDialog: approveClick, finalState: okDone.state, testReceipt: testOut.receipt ?? null, testExitCode: testOut.exitCode ?? null, actionReceipts: actionReceipts.receipts?.length ?? 0, ledgerVerified: actionReceipts.chain ?? null },
      incorrectHash: { channel: "Host command (contract the UI calls)", httpStatus: wrong.status, refusal: String(wrong.body.error ?? "").slice(0, 200) },
      deny: { taskId: denyTask.id, uiDialog: denyClick, finalState: denied.state, fileUnchanged: true },
      stale: { taskId: staleTask.id, uiDialog: staleClick, uiRowGoneAfterCancel: rowGone, approveEnabledAfterCancel: paneAfterCancel.approveEnabled, uiDecision: staleLog.split("\n")[0], hostCommandsAfterCancel: commandsAfterCancel, approveReachedHost: commandsAfterCancel.some((d) => /action\.approve/.test(d)), finalState: "CANCELLED", fileUnchanged: true },
      restart: restartOutcome,
      decisionLog: staleLog,
    };
  });

  // ── W2 Host lifecycle: Host down while the UI and notch are up, then back; no duplicate commands ─────
  await stage("w2-host-restart", async () => {
    await host.close();
    const offline = await until("UI shows Host offline", async () => { const t = (await ui("read_text", { ProcessId: app.child.pid, TargetId: "HostStatusText" })).text; return /not running|connection|not responding/i.test(t ?? "") ? t : null; }, 30_000, 1000);
    const notchOffline = await ui("notch_layout", { ProcessId: app.child.pid, ConfigPath: configPath });
    const downAt = Date.now();
    await sleep(8000);
    host = await startHost({ port: PORT, dataDirectory: hostDir });
    watch(host); writeCreds();
    const upAt = Date.now();
    await until("UI reconnected", async () => (await ui("read_text", { ProcessId: app.child.pid, TargetId: "HostEpochText" })).text?.includes(host.manager.instanceId) ? true : null, 45_000, 500);
    const reconnectMs = Date.now() - upAt;
    await host.manager.discover();
    await ui("navigate", { ProcessId: app.child.pid, TargetId: "NavChat" });
    const prompt = "After restart: what is 7 + 5? Answer with ONLY the number.";
    await ui("enter_and_send", { ProcessId: app.child.pid, PromptText: prompt });
    const t = await until("chat after restart settles", () => { const x = hostTask((y) => y.prompt === prompt); return x && ["completed", "failed", "stopped"].includes(x.state) ? x : null; }, 180_000);
    return {
      uiOfflineText: offline, notchOffline: { title: notchOffline.title, subtitle: notchOffline.subtitle }, hostDownMs: upAt - downAt,
      reconnectAfterHostUpMs: reconnectMs, chatAfterRestart: { state: t.state, provider: t.provider, model: t.model, output: t.output.trim() },
      tasksForPrompt: host.manager.snapshot().tasks.filter((x) => x.prompt === prompt).length,
    };
  });

  // ── Notch: four edges, drag-snap on two monitors, collapse, focus ──────────────────────────────────
  await stage("notch", async () => {
    const edges = [];
    for (const edge of ["Right", "Bottom", "Left", "Top"]) {
      await ui("cycle_dock_edge", { ProcessId: app.child.pid, ExpectedEdge: edge, ConfigPath: configPath });
      await sleep(400);
      const l = await ui("notch_layout", { ProcessId: app.child.pid, ConfigPath: configPath });
      const n = l.notch, wa = l.workArea;
      const gaps = { top: n.y - wa.y, bottom: wa.y + wa.height - (n.y + n.height), left: n.x - wa.x, right: wa.x + wa.width - (n.x + n.width) };
      const horizontal = edge === "Top" || edge === "Bottom";
      const ids = l.agents.map((a) => a.id);
      const notchCentre = horizontal ? n.x + n.width / 2 : n.y + n.height / 2;
      const firstAgent = l.agents.length ? (horizontal ? Math.min(...l.agents.map((a) => a.x)) : Math.min(...l.agents.map((a) => a.y))) : null;
      edges.push({
        edge, persistedEdge: l.persistedEdge, notch: n, workArea: wa, gapToDockedEdgePx: gaps[edge.toLowerCase()],
        centeredOffsetPx: Math.round(notchCentre - (horizontal ? wa.x + wa.width / 2 : wa.y + wa.height / 2)),
        agentsRendered: ids, agentOrder: [...l.agents].sort((a, b) => horizontal ? a.x - b.x : a.y - b.y).map((a) => a.id.replace(/^V?Agent/, "")),
        agentsAligned: horizontal ? spread(l.agents.map((a) => a.y + a.height / 2)) <= 1 : spread(l.agents.map((a) => a.x + a.width / 2)) <= 1,
        agentsLead: firstAgent !== null && firstAgent < notchCentre,
        agentsInsideNotch: l.agents.every((a) => a.x >= n.x && a.y >= n.y && a.x + a.width <= n.x + n.width && a.y + a.height <= n.y + n.height),
        visibleControls: l.visibleControls, foreground: l.foreground,
      });
    }
    for (const e of edges) {
      assert.equal(e.persistedEdge, e.edge);
      assert.ok(Math.abs(e.gapToDockedEdgePx) <= 2, `${e.edge} gap ${e.gapToDockedEdgePx}`);
      assert.ok(Math.abs(e.centeredOffsetPx) <= 2, `${e.edge} centre offset ${e.centeredOffsetPx}`);
      assert.equal(e.agentsRendered.length, 4);
      assert.deepEqual(e.agentOrder, ["Gada", "Spear", "Chakra", "Sword"]);
      assert.ok(e.agentsAligned && e.agentsLead && e.agentsInsideNotch, `${e.edge} agent placement`);
      assert.notEqual(e.foreground.name, "Bunny Island Notch", `${e.edge}: the notch must not keep focus after a UIA invoke (foreground ${JSON.stringify(e.foreground)}; all ${JSON.stringify(edges.map((x) => x.foreground))})`);
    }

    // Real mouse drags: to the primary's left edge, then onto the secondary monitor's top edge (if present).
    const monitors = results.monitors;
    const primary = monitors.find((m) => m.primary).workArea;
    const drags = [];
    const dragTo = async (label, x, y, expectEdge, expectMonitor) => {
      const drag = await ui("drag_notch", { ProcessId: app.child.pid, TargetX: x, TargetY: y });
      await sleep(600);
      const l = await ui("notch_layout", { ProcessId: app.child.pid, ConfigPath: configPath });
      const n = l.notch, wa = l.workArea;
      const gap = { Top: n.y - wa.y, Bottom: wa.y + wa.height - (n.y + n.height), Left: n.x - wa.x, Right: wa.x + wa.width - (n.x + n.width) }[expectEdge];
      const cfg = config();
      drags.push({ label, dropAt: { x, y }, grip: drag.from, whileHeld: drag.whileHeld, persistedEdge: l.persistedEdge, notch: n, workArea: wa, gapPx: gap, onExpectedMonitor: wa.x === expectMonitor.x && wa.y === expectMonitor.y, persistedRatio: cfg.NotchOffsetRatio, persistedLeftTop: [cfg.NotchLeft, cfg.NotchTop], agents: l.agents.map((a) => a.id) });
      assert.equal(l.persistedEdge, expectEdge, `${label}: snapped edge ${JSON.stringify(drags.at(-1))}`);
      assert.ok(Math.abs(gap) <= 2, `${label}: gap ${gap}`);
      assert.ok(drags.at(-1).onExpectedMonitor, `${label}: monitor`);
    };
    await dragTo("primary left", primary.x + 40, primary.y + Math.round(primary.height * 0.6), "Left", primary);
    const secondary = monitors.find((m) => !m.primary)?.workArea;
    if (secondary) await dragTo("secondary top", secondary.x + Math.round(secondary.width / 2), secondary.y + 30, "Top", secondary);

    // Collapse and expand through the keyboard/UIA path.
    const wide = await ui("notch_layout", { ProcessId: app.child.pid, ConfigPath: configPath });
    await ui("invoke_notch", { ProcessId: app.child.pid, TargetId: secondary ? "CollapseButton" : "VCollapseButton" });
    const collapsed = await ui("notch_layout", { ProcessId: app.child.pid, ConfigPath: configPath });
    await ui("invoke_notch", { ProcessId: app.child.pid, TargetId: secondary ? "CollapseButton" : "VCollapseButton" });
    const expanded = await ui("notch_layout", { ProcessId: app.child.pid, ConfigPath: configPath });
    assert.ok(collapsed.notch.width < wide.notch.width || collapsed.notch.height < wide.notch.height, `collapse must shrink the notch: ${JSON.stringify({ wide: wide.notch, collapsed: collapsed.notch, controls: collapsed.visibleControls })}`);
    return { edges, drags, collapse: { before: wide.notch, collapsed: collapsed.notch, expanded: expanded.notch, persistedCollapsedFlag: config().NotchCollapsed }, dpiNote: "UIA and work areas are physical pixels (helper is per-monitor DPI aware)." };
  });

  // ── Lifecycle: close-to-notch, reopen from notch, single instance, Quit, relaunch persistence ──────
  await stage("lifecycle", async () => {
    const closed = await ui("close_main_window", { ProcessId: app.child.pid });
    assert.ok(closed.processAlive && closed.visibleWindows.includes("Bunny Island Notch") && !closed.visibleWindows.some((n) => /Workstation/.test(n)), `close hides to the notch: ${JSON.stringify(closed)}`);
    await ui("invoke_notch", { ProcessId: app.child.pid, TargetId: "OpenWindowButton" }).catch(() => ui("invoke_notch", { ProcessId: app.child.pid, TargetId: "VOpenWindowButton" }));
    const reopened = await ui("read_text", { ProcessId: app.child.pid, TargetId: "HostStatusText" });
    const second = launch("second-instance");
    const secondExit = await Promise.race([second.exited, sleep(8000).then(() => null)]);
    if (!secondExit) second.child.kill();
    const lastCfg = config();
    const treeBefore = await ui("process_tree", { ProcessId: app.child.pid });
    const quit = await ui("invoke_and_dialog", { ProcessId: app.child.pid, TargetId: "QuitButton" });
    const cleanExit = await Promise.race([app.exited, sleep(15000).then(() => null)]);
    const treeAfter = await ui("process_tree", { ProcessId: app.child.pid });
    app = null;
    const relaunch = launch("persistence");
    requests.length = 0;
    await until("relaunched client authenticated", () => requests.some((r) => r.path === "/state"), 20_000);
    await sleep(2500);
    const persisted = await ui("notch_layout", { ProcessId: relaunch.child.pid, ConfigPath: configPath });
    relaunch.child.kill();
    const forced = await relaunch.exited;
    // The notch comes back on the monitor it was saved on.
    const [sx, sy] = [lastCfg.NotchLeft, lastCfg.NotchTop];
    const wa = persisted.workArea;
    assert.ok(sx >= wa.x - 2 && sx <= wa.x + wa.width && sy >= wa.y - 2 && sy <= wa.y + wa.height, `relaunch restored to another monitor: saved ${sx},${sy}; now ${JSON.stringify(wa)}`);
    assert.equal(persisted.persistedEdge, lastCfg.NotchEdge);
    return {
      closeToNotch: closed, reopenedFromNotch: reopened.text,
      singleInstance: secondExit ? { code: secondExit.code } : "did not exit within 8 s (killed)",
      cleanExit: { exit: cleanExit ? { code: cleanExit.code } : "did not exit within 15 s", ownedTreeBefore: treeBefore.descendants, mainAliveAfter: treeAfter.alive, uiDialog: quit.dialogTitle },
      persistence: { savedEdge: lastCfg.NotchEdge, savedRatio: lastCfg.NotchOffsetRatio, savedLeftTop: [lastCfg.NotchLeft, lastCfg.NotchTop], relaunchedEdge: persisted.persistedEdge, relaunchedNotch: persisted.notch, relaunchedWorkArea: persisted.workArea },
      forcedTermination: { exit: { code: forced.code, signal: forced.signal } },
    };
  });

  results.authenticatedRequests = { total: requests.length, allAuthenticated: requests.every((r) => r.authenticated) };
  results.failures = failures;
  writeEvidence(join(EVIDENCE_DIR, "summary.json"), { runId: RUN_ID, binarySha256: results.binarySha256, monitors: results.monitors, failures, stageOk: Object.fromEntries(Object.entries(results.stages).map(([k, v]) => [k, v.ok])), completedAt: new Date().toISOString() }, secrets());
  log(`Evidence: ${EVIDENCE_DIR}; failures: ${failures.length ? failures.join(", ") : "none"}`);
  if (failures.length) process.exitCode = 1;
} catch (error) {
  writeEvidence(join(EVIDENCE_DIR, "failure.json"), { runId: RUN_ID, failedAt: new Date().toISOString(), error: String(error?.message ?? error).slice(0, 2000), partial: results }, secrets());
  throw error;
} finally {
  if (app) { try { app.child.kill(); } catch { /* the app process is already gone */ } }
  await host.close();
  for (const d of [hostDir, configDir, projectRoot]) try { rmSync(d, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
}
