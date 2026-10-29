// MA5-S2 Phase 1B: UI-driven acceptance of native Agent Team coordination in the compiled WPF app against an isolated
// real Host (Ollama adapter only, real local model). UI values are read through UI Automation; Host facts from the Host.
// The project registration is the only Host-command fixture.
// Usage: node --experimental-strip-types scripts/ma5-s2/verify-team-windows.mjs
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
const PORT = Number(process.env.BUNNY_E2E_PORT ?? 43192);
const exePath = process.env.BUNNY_EXE ?? join(process.cwd(), "native/windows/BunnyA/bin/Debug/net8.0-windows/BunnyA.exe");
const helper = join(process.cwd(), "scripts/ui-automation-helper.ps1");
const out = process.argv[2] ?? "docs/ma5-s2/evidence/windows-team.json";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

assert.ok(!/BunnyA\.exe/i.test(spawnSync("tasklist", ["/FI", "IMAGENAME eq BunnyA.exe", "/FO", "CSV", "/NH"], { encoding: "utf8" }).stdout), "Close the running BunnyA.exe first.");
const hostDir = mkdtempSync(join(tmpdir(), "bunny-host-ma5s2-team-"));
const configDir = mkdtempSync(join(tmpdir(), "bunny-config-ma5s2-team-"));
writeFileSync(join(configDir, "config.json"), JSON.stringify({ NotchEdge: "Top", NotchOffsetRatio: 0.5 }));
mkdirSync("test-results/ma5-s2", { recursive: true });
const project = mkdtempSync(join(process.cwd(), "test-results", "ma5-s2", "ui-team-"));
mkdirSync(join(project, "data"));
writeFileSync(join(project, "data", "inventory.csv"), "name,count\nWidgets,12\nGadgets,3\nSprockets,7\n");

const host = await startHost({ port: PORT, dataDirectory: hostDir, adapters: defaultAdapters().filter((a) => a.id === "ollama") });
const credPath = join(hostDir, "client-credentials.json");
writeFileSync(credPath, JSON.stringify({ port: PORT, token: host.token }));
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
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
async function until(what, fn, ms = 30_000, every = 500) {
  const start = Date.now();
  for (;;) { const v = await fn().catch(() => null); if (v) return v; if (Date.now() - start > ms) throw new Error(`Timed out: ${what}`); await sleep(every); }
}
const agents = () => host.agents.snapshot().agents;
const teamOf = (objectivePrefix) => {
  const mission = host.missions.snapshot().missions.find((m) => m.teamView && m.objective.startsWith(objectivePrefix));
  return mission ? { mission, coordinator: agents().find((a) => a.id === mission.teamView.coordinatorAgentId), members: agents().filter((a) => a.team && a.missionId === mission.id) } : null;
};

const results = { schema: "ma5-s2.windows-team.v1", at: new Date().toISOString(), host: "disposable, Ollama adapter only", stages: {} };
const failures = [];
let app;
const pid = () => app.pid;
const read = (id) => ui("read_state", { ProcessId: pid(), TargetId: id });
async function stage(name, fn) {
  log(`── ${name}`);
  try { results.stages[name] = { ok: true, ...scrub(await fn()) }; }
  catch (e) { failures.push(name); results.stages[name] = { ok: false, error: String(e?.message ?? e).slice(0, 1500) }; log(`FAILED ${name}: ${e.message}`); }
}
const OBJ_A = "Build an offline inventory dashboard page from data/inventory.csv.";
const OBJ_B = "Build a second inventory page that will be denied.";
const REQS = "html_id summary | The page has a summary section\nno_external_resources | The page loads nothing from the internet";

async function createTeamThroughUi(objective) {
  await ui("navigate", { ProcessId: pid(), TargetId: "NavProjects" });
  await ui("select_list_item", { ProcessId: pid(), TargetId: "ProjectsList", Match: "Team UI probe" });
  await ui("set_text", { ProcessId: pid(), TargetId: "TeamObjectiveInput", PromptText: objective });
  await ui("set_text", { ProcessId: pid(), TargetId: "TeamRequirementsInput", PromptText: REQS });
  await ui("navigate", { ProcessId: pid(), TargetId: "CreateTeamButton" });
  return until("team created", async () => teamOf(objective.slice(0, 30)));
}
async function selectTeamRow(match) {
  await ui("navigate", { ProcessId: pid(), TargetId: "NavAgents" });
  return ui("select_list_item", { ProcessId: pid(), TargetId: "ActiveTasksList", Match: match });
}

try {
  assert.equal((await cmd("mission.configure", { enabled: true })).status, 200);
  assert.equal((await cmd("project.add", { path: project, name: "Team UI probe", description: "Disposable" })).status, 200);
  app = spawn(exePath, [], { env: { ...process.env, BUNNY_HOST_CREDENTIALS_FILE: credPath, BUNNY_CONFIG_DIRECTORY: configDir }, stdio: "ignore" });
  await until("main window", () => ui("read_state", { ProcessId: app.pid, TargetId: "NavProjects" }).then((s) => s.present));

  await stage("t1-create-team-from-form", async () => {
    await ui("navigate", { ProcessId: pid(), TargetId: "NavProjects" });
    await ui("set_text", { ProcessId: pid(), TargetId: "TeamObjectiveInput", PromptText: OBJ_A });
    await ui("set_text", { ProcessId: pid(), TargetId: "TeamRequirementsInput", PromptText: "bogus_check x | nothing" });
    await ui("navigate", { ProcessId: pid(), TargetId: "CreateTeamButton" });
    const parseError = (await read("TeamCreateStatus")).name;
    assert.match(parseError ?? "", /unknown check "bogus_check"/);
    assert.equal(teamOf(OBJ_A.slice(0, 30)), null, "a malformed requirement never reaches the Host");
    const t = await createTeamThroughUi(OBJ_A);
    assert.equal(t.coordinator.state, "CREATED");
    assert.equal(t.coordinator.run, null, "creating a team starts nothing");
    assert.deepEqual(t.mission.teamView.requirements.map((r) => r.id), ["R1", "R2"]);
    return { parseError, status: (await read("TeamCreateStatus")).name, coordinatorState: t.coordinator.state, roles: t.members.map((m) => `${m.team.role}:${m.state}`) };
  });

  await stage("t2-team-shown-not-working-before-start", async () => {
    const selected = await selectTeamRow("Build an offline");
    const team = (await read("MissionTeamText")).name;
    const start = await read("StartTeamButton");
    const review = await read("RunWithAgentsButton");
    assert.match(team ?? "", /Coordinator .* not started/);
    assert.doesNotMatch(team ?? "", /working/, `nothing is shown as working before the owner starts it: ${team}`);
    assert.match(team ?? "", /planner\s+idle/, "the Host's PLANNING role phase with a pending step is shown as idle");
    assert.equal(start.enabled, true);
    assert.equal(review.enabled, false, "no plan to review yet");
    const approvals = await ui("read_approvals", { ProcessId: pid() }).catch(() => ({ rows: [] }));
    return { selected: selected.selected, team, startEnabled: start.enabled, reviewEnabled: review.enabled, approvalRows: approvals.rows?.length ?? null };
  });

  let reference;
  await stage("t3-start-planning-to-review", async () => {
    await selectTeamRow("Build an offline");
    const dialog = await ui("invoke_and_dialog", { ProcessId: pid(), TargetId: "StartTeamButton" });
    const t0 = Date.now();
    const t = await until("plan review", async () => { const x = teamOf(OBJ_A.slice(0, 30)); return x?.mission.teamView.phase === "review" ? x : null; }, 600_000, 2_000);
    reference = t.mission.teamView.planReference;
    await selectTeamRow("Build an offline");
    const team = await until("team text shows review", async () => { const s = (await read("MissionTeamText")).name; return /phase review/.test(s ?? "") ? s : null; });
    const steps = (await ui("read_list", { ProcessId: pid(), TargetId: "MissionStepsList" })).map((r) => r.name);
    return { dialog, planMs: Date.now() - t0, planReference: reference, team, steps, reviewEnabled: (await read("RunWithAgentsButton")).enabled };
  });

  await stage("t4-approve-exact-plan-via-coordinator", async () => {
    await ui("navigate", { ProcessId: pid(), TargetId: "NavApprovals" });
    await ui("select_approval", { ProcessId: pid(), Match: "Build an offline" });
    const shown = await until("team approval detail", async () => { const a = await ui("read_approvals", { ProcessId: pid() }); return /agent\.team\.approve/.test(a.operation ?? "") ? a : null; });
    assert.equal(shown.payloadSha256, reference, "the reviewed reference is the Host's");
    assert.equal(shown.approveEnabled, true);
    await ui("navigate", { ProcessId: pid(), TargetId: "ApproveActionButton" });
    const receipt = await until("decision receipt", async () => { const r = (await ui("read_approvals", { ProcessId: pid() })).receipts; return /APPROVED · agent\.team\.approve/.test(r ?? "") ? r : null; });
    const t1 = Date.now();
    const done = await until("team finished", async () => { const x = teamOf(OBJ_A.slice(0, 30)); return ["completed", "failed", "stopped"].includes(x?.mission.state) ? x : null; }, 900_000, 2_000);
    return {
      shown: { operation: shown.operation, scope: shown.scope, context: shown.context, plan: shown.plan }, receipt, runMs: Date.now() - t1,
      missionState: done.mission.state, coordinator: done.coordinator.state,
      members: done.members.map((m) => ({ role: m.team.role, state: m.state, owned: m.owned ?? null, failure: m.failure?.code ?? null })),
      requirements: done.mission.teamView.requirementResults.map((r) => ({ id: r.id, passed: r.passed })),
    };
  });

  await stage("t5-deny-stops-the-whole-team", async () => {
    await createTeamThroughUi(OBJ_B);
    await selectTeamRow("Build a second");
    await ui("invoke_and_dialog", { ProcessId: pid(), TargetId: "StartTeamButton" });
    await until("second plan review", async () => teamOf(OBJ_B.slice(0, 30))?.mission.teamView.phase === "review", 600_000, 2_000);
    await ui("navigate", { ProcessId: pid(), TargetId: "NavApprovals" });
    await ui("select_approval", { ProcessId: pid(), Match: "Build a second" });
    await until("deny enabled", async () => (await ui("read_approvals", { ProcessId: pid() })).denyEnabled);
    await ui("navigate", { ProcessId: pid(), TargetId: "DenyActionButton" });
    const t = await until("team stopped", async () => { const x = teamOf(OBJ_B.slice(0, 30)); return x?.coordinator.state === "STOPPED" ? x : null; });
    assert.ok(t.members.every((m) => ["STOPPED", "COMPLETED"].includes(m.state)), "every member stopped (the Planner had already finished)");
    return { mission: t.mission.state, coordinator: t.coordinator.state, members: t.members.map((m) => `${m.team.role}:${m.state}`) };
  });
} finally {
  results.failures = failures;
  try { writeEvidence(out, results, [host.token]); } catch (e) { log(`evidence not written: ${e.message}`); }
  try { app?.kill(); } catch { /* gone */ }
  await sleep(1_000);
  await host.close();
  for (const d of [hostDir, configDir, project]) rmSync(d, { recursive: true, force: true });
  log(failures.length ? `FAILED: ${failures.join(", ")}` : "all stages passed");
  process.exitCode = failures.length ? 1 : 0;
}
