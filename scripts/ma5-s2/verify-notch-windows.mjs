// MA5-S2 Phase 2: acceptance of the native glass notch in the compiled WPF app against an isolated real Host (Ollama
// adapter only, real local model). Everything the notch shows is read through UI Automation; Host facts come from the
// Host. Host commands are used for fixtures (project, tasks, team creation/start) and to check the contract.
// Visual evidence uses the app's own BUNNY_NOTCH_SNAPSHOT render (the notch's visual tree only, never the desktop).
// Usage: node --experimental-strip-types scripts/ma5-s2/verify-notch-windows.mjs
import { spawn, execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { startHost } from "../../src/lib/bunny-host/http.server.ts";
import { defaultAdapters } from "../../src/lib/bunny-host/adapters.server.ts";
import { writeEvidence } from "../evidence-guard.mjs";

const execFileAsync = promisify(execFile);
const PORT = Number(process.env.BUNNY_E2E_PORT ?? 43194);
const exePath = process.env.BUNNY_EXE ?? join(process.cwd(), "native/windows/BunnyA/bin/Debug/net8.0-windows/BunnyA.exe");
const helper = join(process.cwd(), "scripts/ui-automation-helper.ps1");
const EVIDENCE = "docs/ma5-s2/evidence/notch";
const ONLY = process.env.NOTCH_STAGES ? new Set(process.env.NOTCH_STAGES.split(",")) : null;
mkdirSync(EVIDENCE, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

assert.ok(!/BunnyA\.exe/i.test(spawnSync("tasklist", ["/FI", "IMAGENAME eq BunnyA.exe", "/FO", "CSV", "/NH"], { encoding: "utf8" }).stdout), "Close the running BunnyA.exe first.");
const hostDir = mkdtempSync(join(tmpdir(), "bunny-host-ma5s2-notch-"));
const configDir = mkdtempSync(join(tmpdir(), "bunny-config-ma5s2-notch-"));
const scratch = mkdtempSync(join(tmpdir(), "bunny-notch-evidence-"));
const snapshotPng = join(scratch, "notch.png");
const frameLog = join(scratch, "frames.jsonl");
const configPath = join(configDir, "config.json");
const writeConfig = (patch) => writeFileSync(configPath, JSON.stringify({ NotchEdge: "Top", NotchOffsetRatio: 0.5, ...patch }));
writeConfig({});
mkdirSync("test-results/ma5-s2", { recursive: true });
const project = mkdtempSync(join(process.cwd(), "test-results", "ma5-s2", "ui-notch-"));
mkdirSync(join(project, "data"));
writeFileSync(join(project, "data", "inventory.csv"), "name,count\nWidgets,12\nGadgets,3\nSprockets,7\n");
writeFileSync(join(project, "notes.txt"), "Release checklist: installer signed; Android build reproducible; voice qualification blocked.\n");

let host = await startHost({ port: PORT, dataDirectory: hostDir, adapters: defaultAdapters().filter((a) => a.id === "ollama") });
const credPath = join(hostDir, "client-credentials.json");
const writeCreds = () => writeFileSync(credPath, JSON.stringify({ port: PORT, token: host.token }));
writeCreds();
const scrub = (v) => JSON.parse(JSON.stringify(v ?? null).split(JSON.stringify(project).slice(1, -1)).join("<project>"));

async function ui(action, args = {}) {
  const ps = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", helper, "-Action", action];
  for (const [k, v] of Object.entries(args)) if (v !== undefined && v !== "") ps.push(`-${k}`, String(v));
  const run = execFileAsync("powershell.exe", ps, { encoding: "utf8", timeout: 60_000 });
  run.child.stdin.end();
  return JSON.parse((await run).stdout.trim());
}
async function cmd(action, data) {
  const res = await fetch(`http://127.0.0.1:${PORT}/command`, { method: "POST", headers: { authorization: `Bearer ${host.token}`, "content-type": "application/json" }, body: JSON.stringify({ action, data, operationId: crypto.randomUUID() }) });
  const body = await res.json().catch(() => ({}));
  assert.ok(res.ok, `${action}: ${body.error ?? res.status}`);
  return body;
}
async function until(what, fn, ms = 30_000, every = 500) {
  const start = Date.now();
  for (;;) { const v = await fn().catch(() => null); if (v) return v; if (Date.now() - start > ms) throw new Error(`Timed out: ${what}`); await sleep(every); }
}
let app;
function launch(env = {}) {
  app = spawn(exePath, [], { env: { ...process.env, BUNNY_HOST_CREDENTIALS_FILE: credPath, BUNNY_CONFIG_DIRECTORY: configDir, BUNNY_NOTCH_SNAPSHOT: snapshotPng, ...env }, stdio: "ignore" });
  return until("notch window", () => ui("notch_tree", { ProcessId: app.pid }), 30_000);
}
async function relaunch(env) { app.kill(); await sleep(1_500); return launch(env); }
const tree = () => ui("notch_tree", { ProcessId: app.pid });
const chipsOf = (t) => t.items.filter((i) => /^V?Agent/.test(i.id) && !/AgentOverflow$/.test(i.id) && !i.offscreen);
const shot = async (name) => { await sleep(900); if (existsSync(snapshotPng)) copyFileSync(snapshotPng, join(EVIDENCE, `${name}.png`)); return `${EVIDENCE}/${name}.png`; };

const results = { schema: "ma5-s2.windows-notch.v1", at: new Date().toISOString(), host: "disposable, Ollama adapter only", stages: {} };
const verdicts = {};
async function stage(name, fn) {
  if (ONLY && !ONLY.has(name)) return;
  log(`── ${name}`);
  try { const r = await fn(); results.stages[name] = { ok: r?.blocked ? "BLOCKED" : true, ...scrub(r) }; verdicts[name] = r?.blocked ? "BLOCKED" : "PASS"; }
  catch (e) { results.stages[name] = { ok: false, error: String(e?.message ?? e).slice(0, 2000), ...(e?.detail ? scrub(e.detail) : {}) }; verdicts[name] = "FAIL"; log(`FAILED ${name}: ${e.message}`); }
}

try {
  await host.manager.discover();
  const ollama = host.manager.snapshot().providers.find((p) => p.id === "ollama");
  const model = (ollama?.models ?? []).find((m) => !(ollama.remoteModels ?? []).includes(m) && !/(:|-)cloud$/i.test(m));
  assert.ok(model, "a local Ollama model must be installed");
  results.model = model;
  await cmd("mission.configure", { enabled: true });
  const projectId = (await cmd("project.add", { path: project, name: "Notch probe", description: "Disposable" })).data.id;
  await launch();

  await stage("n1-four-edges", async () => {
    const edges = [];
    for (const expected of ["Top", "Right", "Bottom", "Left"]) {
      const t = await until(`edge ${expected}`, async () => {
        const x = await tree(); const cfg = JSON.parse(readFileSync(configPath, "utf8").replace(/^\uFEFF/, ""));
        return cfg.NotchEdge === expected ? x : null;
      }, 10_000);
      const n = t.notch, w = t.workArea, horizontal = expected === "Top" || expected === "Bottom";
      const collapse = t.items.find((i) => i.id === (horizontal ? "CollapseButton" : "VCollapseButton"));
      const chips = chipsOf(t);
      const touches = { Top: Math.abs(n.y - w.y), Bottom: Math.abs(n.y + n.height - (w.y + w.height)), Left: Math.abs(n.x - w.x), Right: Math.abs(n.x + n.width - (w.x + w.width)) }[expected];
      assert.ok(touches <= 2, `${expected}: notch is ${touches}px from its edge`);
      assert.ok(n.x >= w.x - 1 && n.y >= w.y - 1 && n.x + n.width <= w.x + w.width + 1 && n.y + n.height <= w.y + w.height + 1, `${expected}: notch leaves the work area`);
      assert.equal(chips.length, 4, `${expected}: the four characters are shown`);
      assert.ok(chips.every((c) => c.id.startsWith(horizontal ? "Agent" : "VAgent")), `${expected} uses its own layout`);
      assert.ok(chips.every((c) => horizontal ? c.x + c.width <= collapse.x + 1 : c.y + c.height <= collapse.y + 1), `${expected}: agents must be ${horizontal ? "left of" : "above"} the notch`);
      for (let i = 1; i < chips.length; i++) assert.ok(horizontal ? chips[i].x >= chips[i - 1].x + chips[i - 1].width - 1 : chips[i].y >= chips[i - 1].y + chips[i - 1].height - 1, `${expected}: chips overlap`);
      edges.push({ edge: expected, notch: n, workArea: w, distanceToEdge: touches, chips: chips.map((c) => c.id), image: await shot(`edge-${expected.toLowerCase()}`) });
      await ui("invoke_notch", { ProcessId: app.pid, TargetId: horizontal ? "DockEdgeButton" : "VDockEdgeButton" });
    }
    return { edges };
  });

  await stage("n2-placement-survives-restart", async () => {
    // n1 left the notch on Top again after cycling; move it to Right at a non-default offset, then restart.
    writeConfig({ NotchEdge: "Right", NotchOffsetRatio: 0.3 });
    const before = await relaunch();
    const after = await relaunch();
    const cfgAfter = JSON.parse(readFileSync(configPath, "utf8").replace(/^\uFEFF/, ""));
    assert.equal(cfgAfter.NotchEdge, "Right");
    assert.ok(Math.abs(after.notch.x - before.notch.x) <= 2 && Math.abs(after.notch.y - before.notch.y) <= 2, "same place after restart");
    assert.ok(Math.abs(after.notch.x + after.notch.width - (after.workArea.x + after.workArea.width)) <= 2, "still on the right edge");
    const expectedY = after.workArea.y + 0.3 * (after.workArea.height - after.notch.height);
    assert.ok(Math.abs(after.notch.y - expectedY) <= 3, `offset ratio 0.3 kept (y ${after.notch.y} vs ${expectedY})`);
    writeConfig({});
    await relaunch();
    return { before: before.notch, after: after.notch, saved: { edge: cfgAfter.NotchEdge, ratio: cfgAfter.NotchOffsetRatio, left: cfgAfter.NotchLeft, top: cfgAfter.NotchTop } };
  });

  await stage("n3-monitors-and-dpi", async () => {
    const monitors = await ui("monitors");
    const list = Array.isArray(monitors) ? monitors : monitors.monitors ?? [monitors];
    if (list.length < 2) return { blocked: true, reason: "Only one monitor is attached; multi-monitor and mixed-DPI placement cannot be exercised on this workstation.", monitors: list };
    // Restore onto each monitor through the saved corner (the same path a restart uses), at a horizontal and a vertical edge.
    const placed = [];
    for (const m of list) for (const edge of ["Top", "Left"]) {
      writeConfig({ NotchEdge: edge, NotchOffsetRatio: 0.5, NotchLeft: m.workArea.x + 40, NotchTop: m.workArea.y + 40 });
      const t = await relaunch();
      const n = t.notch, w = t.workArea;
      assert.deepEqual(w, m.workArea, `${m.device} ${edge}: restored onto the saved monitor`);
      assert.ok(n.x >= w.x - 1 && n.y >= w.y - 1 && n.x + n.width <= w.x + w.width + 1 && n.y + n.height <= w.y + w.height + 1, `${m.device} ${edge}: inside its work area`);
      assert.ok(edge === "Top" ? Math.abs(n.y - w.y) <= 2 : Math.abs(n.x - w.x) <= 2, `${m.device} ${edge}: on its edge`);
      placed.push({ device: m.device, primary: m.primary, edge, notch: n, workArea: w });
    }
    // Per-monitor DPI: the same notch layout measures differently in physical pixels on monitors of different scale.
    const tops = placed.filter((p) => p.edge === "Top");
    const ratio = Math.round((tops[0].notch.height / tops[1].notch.height) * 100) / 100;
    writeConfig({});
    await relaunch();
    return { monitors: list, placed, horizontalHeightRatio: ratio, note: "A ratio near 1 means both monitors run the same scale; otherwise it is their DPI ratio." };
  });

  await stage("n4-live-team-states-and-approval-from-the-notch", async () => {
    const created = await cmd("agent.create", { objective: "Build an offline inventory dashboard page from data/inventory.csv.", projectId,
      team: { requirements: [{ id: "R1", text: "The page has a summary section", check: { kind: "html_id", value: "summary" } }, { id: "R2", text: "The page loads nothing from the internet", check: { kind: "no_external_resources" } }] } });
    const coordinatorId = created.agents.agents.find((a) => a.team?.role === "coordinator").id;
    const coordChip = `AgentTeam-${coordinatorId}`;
    const before = await until("unstarted team chip", async () => { const c = chipsOf(await tree()).find((i) => i.id === coordChip); return c ? c : null; });
    assert.equal(before.status, "Waiting for you", "an unstarted team waits to be started, not for an approval");
    await cmd("agent.start", { id: coordinatorId });
    const samples = [];
    const sample = async () => {
      const t = await tree();
      const team = chipsOf(t).filter((c) => c.id.startsWith("AgentTeam-"));
      samples.push({ at: Date.now(), chips: team.map((c) => `${c.name.split(" · ")[0]}:${c.status}`) });
      return team;
    };
    const inReview = await until("coordinator chip awaiting approval", async () => { const team = await sample(); return team.find((c) => c.id === coordChip && c.status === "Approval needed") ? team : null; }, 600_000, 700);
    const reviewImage = await shot("team-approval-needed");
    const hostPhase = host.missions.snapshot().missions.find((m) => m.teamView?.coordinatorAgentId === coordinatorId)?.teamView?.phase;
    assert.equal(hostPhase, "review", "the notch claims approval only while the Host is in plan review");
    // Invoke the chip (keyboard/Narrator path): it opens the Approval Center on this team's plan; the decision is made there.
    await ui("invoke_notch", { ProcessId: app.pid, TargetId: coordChip });
    const shown = await until("Approval Center on the team plan", async () => { const a = await ui("read_approvals", { ProcessId: app.pid }); return /agent\.team\.approve/.test(a.operation ?? "") ? a : null; });
    assert.equal(host.missions.snapshot().missions.find((m) => m.teamView?.coordinatorAgentId === coordinatorId).state, "waiting_for_approval", "invoking the chip approved nothing");
    await ui("navigate", { ProcessId: app.pid, TargetId: "ApproveActionButton" });
    let maxSimultaneous = 0, sawWorking = false;
    const done = await until("team finished", async () => {
      const team = await sample();
      const working = team.filter((c) => /Planning|Thinking|Executing|Delegating/.test(c.status));
      maxSimultaneous = Math.max(maxSimultaneous, working.length);
      sawWorking ||= working.length > 0;
      const m = host.missions.snapshot().missions.find((x) => x.teamView?.coordinatorAgentId === coordinatorId);
      return ["completed", "failed", "stopped"].includes(m?.state) ? m : null;
    }, 900_000, 400);
    const final = await until("final chips", async () => { const team = await sample(); return team.length && team.every((c) => /Completed|Failed|Canceled/.test(c.status)) ? team : null; }, 20_000);
    const finalImage = await shot("team-completed");
    const hostMembers = host.agents.snapshot().agents.filter((a) => a.missionId === done.id);
    // Agreement with the Host: every final chip state equals the Host's terminal Agent state.
    const want = { COMPLETED: "Completed", FAILED: "Failed", STOPPED: "Canceled" };
    for (const chip of final) { const a = hostMembers.find((x) => chip.id === `AgentTeam-${x.id}`); assert.equal(chip.status, want[a.state], `${chip.name}`); }
    return { reviewChips: inReview.map((c) => `${c.name.split(" · ")[0]}:${c.status}`), approvalShown: shown.operation, reviewImage, finalImage, sawWorking, maxSimultaneousWorking: maxSimultaneous,
      final: final.map((c) => c.name), missionState: done.state, requirements: done.teamView.requirementResults.map((r) => ({ id: r.id, passed: r.passed })), samples: samples.length, distinctSamples: [...new Set(samples.map((s) => s.chips.join("|")))] };
  });

  await stage("n5-task-outcomes", async () => {
    await cmd("connector.roots.set", { roots: [{ id: "probe", label: "Probe", path: project }] });
    const env = (extra = {}) => ({ capabilities: ["file.read"], providers: ["ollama"], localOnly: true, models: [], projectScopes: ["personal"], sideEffects: false, background: false,
      budgets: { maxModelCalls: 0, maxWallMs: 600_000 }, expiresAt: Date.now() + 3_600_000, grants: { files: [{ root: "probe", access: "read" }], origins: [], services: [] }, ...extra });
    const spec = (title, path, extra = {}) => ({ title, projectId: "personal", steps: [{ id: "read", kind: "file.read", input: { root: "probe", path } }], acceptance: { requiredSteps: ["read"] }, ...extra });
    const ok = (await cmd("ptask.create", { spec: spec("Read the notes", "notes.txt"), envelope: env() })).data;
    const fail = (await cmd("ptask.create", { spec: spec("Read a missing file", "missing.txt"), envelope: env() })).data;
    const waiting = (await cmd("ptask.create", { spec: spec("Background read awaiting approval", "notes.txt"), envelope: env({ background: true }) })).data;
    const queued = (await cmd("ptask.create", { spec: spec("Read after the background task", "notes.txt", { dependsOn: [waiting.id] }), envelope: env() })).data;
    const cancel = (await cmd("ptask.create", { spec: spec("Read that the owner cancels", "notes.txt"), envelope: env({ background: true }) })).data;
    await cmd("ptask.cancel", { id: cancel.id });
    const want = { [ok.id]: "Completed", [fail.id]: "Failed", [waiting.id]: "Approval needed", [queued.id]: "Queued", [cancel.id]: "Canceled" };
    const chips = await until("task chips", async () => {
      const t = await tree();
      const got = Object.fromEntries(chipsOf(t).filter((c) => c.id.startsWith("AgentTask-")).map((c) => [c.id.slice("AgentTask-".length), c.status]));
      return Object.entries(want).every(([id, s]) => got[id] === s) ? got : null;
    }, 60_000, 700);
    const hostStates = Object.fromEntries(Object.keys(want).map((id) => [id, host.ptasks.view(id).state]));
    const image = await shot("task-outcomes");
    await cmd("ptask.cancel", { id: queued.id }); await cmd("ptask.cancel", { id: waiting.id });
    return { chips: Object.fromEntries(Object.entries(chips).filter(([id]) => id in want).map(([id, s]) => [want[id] === s ? s : `MISMATCH ${s}`, hostStates[id]])), image };
  });

  await stage("n6-host-loss-reconnect-restart", async () => {
    const live = chipsOf(await tree()).map((c) => c.status);
    const commandsBefore = host.manager.snapshot().tasks.length;
    await host.close();
    const offline = await until("offline notch", async () => { const t = await tree(); const title = t.items.find((i) => i.id === "NotchTitle")?.name; return /Offline/.test(title ?? "") ? t : null; }, 60_000, 1_000);
    const offlineChips = chipsOf(offline).map((c) => c.status);
    assert.ok(offlineChips.length > 0 && offlineChips.every((s) => s === "Disconnected"), "nothing the Host last said is claimed while it is gone");
    const offlineImage = await shot("host-offline");
    host = await startHost({ port: PORT, dataDirectory: hostDir, adapters: defaultAdapters().filter((a) => a.id === "ollama") });
    writeCreds();
    const back = await until("reconnected notch", async () => { const t = await tree(); const title = t.items.find((i) => i.id === "NotchTitle")?.name; return title && !/Offline|Connecting/.test(title) ? t : null; }, 90_000, 1_000);
    const backChips = chipsOf(back).map((c) => c.status);
    assert.ok(!backChips.includes("Disconnected"), "chips reflect the restarted Host");
    assert.ok(host.manager.snapshot().tasks.length <= commandsBefore, "the notch replayed nothing");
    return { live, offlineChips, offlineImage, backChips, reconnectedTitle: back.items.find((i) => i.id === "NotchTitle")?.name };
  });

  await stage("n7-appearance-fallbacks", async () => {
    const modes = [];
    for (const [name, cfg, expect] of [
      ["dark", { NotchTheme: "Dark" }, "theme=dark;opaque=false;reducedMotion=false"],
      ["light", { NotchTheme: "Light" }, "theme=light;opaque=false;reducedMotion=false"],
      ["high-contrast", { NotchTheme: "HighContrast" }, "theme=high-contrast;opaque=true;reducedMotion=false"],
      ["reduced-transparency", { NotchTheme: "Dark", ReducedTransparency: true }, "theme=dark;opaque=true;reducedMotion=false"],
      ["reduced-motion", { NotchTheme: "Dark", ReducedMotion: true }, "theme=dark;opaque=false;reducedMotion=true"],
    ]) {
      writeConfig(cfg);
      const t = await relaunch();
      assert.equal(t.notch.status, expect, name);
      modes.push({ name, status: t.notch.status, image: await shot(`theme-${name}`) });
    }
    writeConfig({});
    await relaunch();
    return { modes, systemHighContrastToggle: "not exercised: switching the Windows contrast theme changes the owner's whole desktop" };
  });

  await stage("n8-keyboard-and-accessible-names", async () => {
    const t = await tree();
    const actionable = t.items.filter((i) => !i.offscreen && (/^V?Agent/.test(i.id) || /Button$|Badge$|Pill$/.test(i.id)));
    const unnamed = actionable.filter((i) => !i.name);
    const unfocusable = actionable.filter((i) => !i.focusable);
    assert.deepEqual(unnamed.map((i) => i.id), [], "every control has a name");
    assert.deepEqual(unfocusable.map((i) => i.id), [], "every control takes keyboard focus");
    const chip = chipsOf(t)[0];
    const focus = await ui("focus_notch", { ProcessId: app.pid, TargetId: chip.id });
    assert.equal(focus.focused, true);
    const names = chipsOf(t).map((c) => ({ id: c.id, name: c.name, status: c.status, help: c.help }));
    assert.ok(names.every((n) => n.status && n.name.includes(n.status)), "each chip's name states its state in words");
    return { controls: actionable.length, chipNames: names, focused: focus, narrator: "UI Automation names and states verified; Narrator itself was not run" };
  });

  await stage("n9-performance", async () => {
    const cpu = async (seconds) => {
      const ps = `$p=Get-Process -Id ${app.pid}; $c0=$p.TotalProcessorTime.TotalMilliseconds; $m0=$p.WorkingSet64; Start-Sleep -Seconds ${seconds}; $p.Refresh(); $c1=$p.TotalProcessorTime.TotalMilliseconds; [PSCustomObject]@{ cpuMs=$c1-$c0; seconds=${seconds}; workingSetStartMb=[math]::Round($m0/1MB,1); workingSetEndMb=[math]::Round($p.WorkingSet64/1MB,1); cores=[Environment]::ProcessorCount } | ConvertTo-Json -Compress`;
      const r = JSON.parse((await execFileAsync("powershell.exe", ["-NoProfile", "-Command", ps], { encoding: "utf8", timeout: 120_000 })).stdout.trim());
      return { ...r, cpuPercentOfOneCore: Math.round((r.cpuMs / (r.seconds * 1000)) * 1000) / 10 };
    };
    // Idle: nothing running, notch idle, no frame meter (it would keep WPF rendering).
    const idle = await cpu(30);
    // Active: a live team with the frame meter on.
    rmSync(frameLog, { force: true });
    await relaunch({ BUNNY_NOTCH_FRAME_LOG: frameLog });
    // Let startup (JIT, first layout) finish so it is not counted as notch work.
    const warmup = await cpu(15);
    const created = await cmd("agent.create", { objective: "Build a small offline inventory page from data/inventory.csv.", projectId, team: { requirements: [{ id: "R1", text: "No internet resources", check: { kind: "no_external_resources" } }] } });
    // The Host lists every Agent: the new team's Coordinator is the one not started yet (n4's team is finished).
    const coordinatorId = created.agents.agents.find((a) => a.team?.role === "coordinator" && a.state === "CREATED").id;
    await cmd("agent.start", { id: coordinatorId });
    const active = await cpu(15);
    const review = await until("perf team review", async () => host.missions.snapshot().missions.find((m) => m.teamView?.coordinatorAgentId === coordinatorId && m.teamView.phase === "review"), 600_000, 1_000);
    await cmd("agent.team.approve", { id: coordinatorId, planReference: review.teamView.planReference });
    await until("perf team finished", async () => ["completed", "failed", "stopped"].includes(host.missions.snapshot().missions.find((m) => m.id === review.id)?.state), 900_000, 1_000);
    await sleep(6_000);
    const frames = existsSync(frameLog) ? readFileSync(frameLog, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
    const idleAfter = await cpu(30);
    // The frame meter itself makes WPF render every frame, so CPU is also measured without it: once with motion, once
    // with motion off, to attribute the cost of the animations.
    const planningCpu = async (config, hideNotch = false) => {
      writeConfig(config);
      await relaunch({});
      if (hideNotch) await ui("navigate", { ProcessId: app.pid, TargetId: "ToggleNotchButton" });
      await cpu(15);
      const created = await cmd("agent.create", { objective: "Build a small offline inventory page from data/inventory.csv.", projectId, team: { requirements: [{ id: "R1", text: "No internet resources", check: { kind: "no_external_resources" } }] } });
      const coordinator = created.agents.agents.find((a) => a.team?.role === "coordinator" && a.state === "CREATED").id;
      await cmd("agent.start", { id: coordinator });
      const r = await cpu(15);
      await cmd("agent.stop", { id: coordinator });
      return r;
    };
    const activeNoMeter = await planningCpu({});
    const activeReducedMotion = await planningCpu({ ReducedMotion: true });
    const activeNotchHidden = await planningCpu({ ReducedMotion: true }, true);
    writeConfig({});
    const animated = frames.filter((f) => f.animatedElements > 0);
    const memoryGrowthMb = Math.round((idleAfter.workingSetEndMb - idle.workingSetStartMb) * 10) / 10;
    // Budgets, derived from the 30 fps cap on ambient loops: p95 gap within two target frames, no stall a person
    // notices (100 ms), at least 25 fps; idle near-free; no runaway memory.
    const budgets = { idleCpuPercentOfOneCoreMax: 3, animatedP95MsMax: 67, animatedMaxGapMsMax: 100, animatedFpsMin: 25, memoryGrowthMbMax: 100 };
    const fail = [];
    if (idle.cpuPercentOfOneCore > budgets.idleCpuPercentOfOneCoreMax || idleAfter.cpuPercentOfOneCore > budgets.idleCpuPercentOfOneCoreMax) fail.push("idle CPU");
    if (!animated.length) fail.push("no animated frame window recorded");
    if (animated.some((f) => f.p95Ms > budgets.animatedP95MsMax || f.maxMs > budgets.animatedMaxGapMsMax || f.fps < budgets.animatedFpsMin)) fail.push("frame pacing");
    if (memoryGrowthMb > budgets.memoryGrowthMbMax) fail.push("memory growth");
    const result = { budgets, idle, startupWarmup: warmup, activeDuringPlanningWithFrameMeter: active, activeDuringPlanningNoMeter: activeNoMeter, activeDuringPlanningReducedMotionNoMeter: activeReducedMotion, activeDuringPlanningNotchHidden: activeNotchHidden, idleAfterWork: idleAfter, frameWindows: frames, memoryGrowthMb };
    if (fail.length) throw Object.assign(new Error(`performance budget exceeded: ${fail.join(", ")}`), { detail: result });
    return result;
  });
} finally {
  results.verdicts = verdicts;
  // A partial run (NOTCH_STAGES) updates its stages in the existing evidence instead of replacing the others.
  const evidenceFile = join(EVIDENCE, "windows-notch.json");
  if (ONLY && existsSync(evidenceFile)) {
    const prior = JSON.parse(readFileSync(evidenceFile, "utf8"));
    results.stages = { ...prior.stages, ...results.stages };
    results.verdicts = { ...prior.verdicts, ...verdicts };
    results.partialRerun = [...new Set([...(prior.partialRerun ?? []), ...ONLY])];
  }
  try { writeEvidence(evidenceFile, scrub(results), [host.token]); } catch (e) { log(`evidence not written: ${e.message}`); }
  try { app?.kill(); } catch { /* gone */ }
  await sleep(1_000);
  await host.close().catch(() => {});
  for (const d of [hostDir, configDir, project, scratch]) rmSync(d, { recursive: true, force: true });
  log(JSON.stringify(verdicts));
  process.exitCode = Object.values(verdicts).includes("FAIL") ? 1 : 0;
}
