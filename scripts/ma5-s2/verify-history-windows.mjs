// MA5-S2 Phase 1C: UI-driven acceptance of the native Mission History against an isolated real Host (Ollama adapter
// only, real local model). Fixtures are real Host runs created with Host commands (a completed team, a completed
// connected task with receipts, a connected task that fails); the History screen is read through UI Automation.
// Usage: node --experimental-strip-types scripts/ma5-s2/verify-history-windows.mjs
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
const PORT = Number(process.env.BUNNY_E2E_PORT ?? 43193);
const exePath = process.env.BUNNY_EXE ?? join(process.cwd(), "native/windows/BunnyA/bin/Debug/net8.0-windows/BunnyA.exe");
const helper = join(process.cwd(), "scripts/ui-automation-helper.ps1");
const out = process.argv[2] ?? "docs/ma5-s2/evidence/windows-history.json";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

assert.ok(!/BunnyA\.exe/i.test(spawnSync("tasklist", ["/FI", "IMAGENAME eq BunnyA.exe", "/FO", "CSV", "/NH"], { encoding: "utf8" }).stdout), "Close the running BunnyA.exe first.");
const hostDir = mkdtempSync(join(tmpdir(), "bunny-host-ma5s2-hist-"));
const configDir = mkdtempSync(join(tmpdir(), "bunny-config-ma5s2-hist-"));
writeFileSync(join(configDir, "config.json"), JSON.stringify({ NotchEdge: "Top", NotchOffsetRatio: 0.5 }));
mkdirSync("test-results/ma5-s2", { recursive: true });
const project = mkdtempSync(join(process.cwd(), "test-results", "ma5-s2", "ui-hist-"));
mkdirSync(join(project, "data"));
writeFileSync(join(project, "data", "inventory.csv"), "name,count\nWidgets,12\nGadgets,3\nSprockets,7\n");
writeFileSync(join(project, "notes.txt"), "Release checklist: installer signed; Android build reproducible; voice qualification blocked.\n");

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
  const body = await res.json().catch(() => ({}));
  assert.ok(res.ok, `${action}: ${body.error ?? res.status}`);
  return body;
}
async function until(what, fn, ms = 30_000, every = 1_000) {
  const start = Date.now();
  for (;;) { const v = await fn().catch(() => null); if (v) return v; if (Date.now() - start > ms) throw new Error(`Timed out: ${what}`); await sleep(every); }
}

const results = { schema: "ma5-s2.windows-history.v1", at: new Date().toISOString(), host: "disposable, Ollama adapter only", fixtures: {}, stages: {} };
const failures = [];
let app;
async function stage(name, fn) {
  log(`── ${name}`);
  try { results.stages[name] = { ok: true, ...scrub(await fn()) }; }
  catch (e) { failures.push(name); results.stages[name] = { ok: false, error: String(e?.message ?? e).slice(0, 2000) }; log(`FAILED ${name}: ${e.message}`); }
}
const detailOf = async (match) => {
  await ui("navigate", { ProcessId: app.pid, TargetId: "NavHistory" });
  await ui("select_list_item", { ProcessId: app.pid, TargetId: "TaskHistoryList", Match: match });
  return until(`detail for ${match}`, async () => { const t = (await ui("read_state", { ProcessId: app.pid, TargetId: "HistoryDetailText" })).name; return t && !/^Select an item/.test(t) ? t : null; }, 20_000, 500);
};

try {
  // ── Fixtures: real Host runs ────────────────────────────────────────────────────────────────────────────────
  await host.manager.discover();
  const ollama = host.manager.snapshot().providers.find((p) => p.id === "ollama");
  const model = (ollama?.models ?? []).find((m) => !(ollama.remoteModels ?? []).includes(m) && !/(:|-)cloud$/i.test(m));
  assert.ok(model, "a local Ollama model must be installed");
  results.model = model;
  // Foreground persistent tasks run only while a workstation client is attached (task-runtime mayRun → uiAttached).
  app = spawn(exePath, [], { env: { ...process.env, BUNNY_HOST_CREDENTIALS_FILE: credPath, BUNNY_CONFIG_DIRECTORY: configDir }, stdio: "ignore" });
  await until("main window", () => ui("read_state", { ProcessId: app.pid, TargetId: "NavHistory" }).then((s) => s.present), 30_000, 500);
  await cmd("mission.configure", { enabled: true });
  const projectId = (await cmd("project.add", { path: project, name: "History probe", description: "Disposable" })).data.id;
  const created = await cmd("agent.create", { objective: "Build an offline inventory dashboard page from data/inventory.csv.", projectId,
    team: { requirements: [{ id: "R1", text: "The page has a summary section", check: { kind: "html_id", value: "summary" } }, { id: "R2", text: "The page loads nothing from the internet", check: { kind: "no_external_resources" } }] } });
  const coordinatorId = created.agents.agents.find((a) => a.team?.role === "coordinator").id;
  await cmd("agent.start", { id: coordinatorId });
  const reviewed = await until("team review", async () => host.missions.snapshot().missions.find((m) => m.teamView?.phase === "review"), 600_000, 2_000);
  await cmd("agent.team.approve", { id: coordinatorId, planReference: reviewed.teamView.planReference });
  const team = await until("team finished", async () => { const m = host.missions.snapshot().missions.find((x) => x.id === reviewed.id); return ["completed", "failed", "stopped"].includes(m?.state) ? m : null; }, 900_000, 2_000);
  results.fixtures.team = { state: team.state, requirements: team.teamView.requirementResults.map((r) => ({ id: r.id, passed: r.passed })) };

  await cmd("connector.roots.set", { roots: [{ id: "probe", label: "Probe", path: project }] });
  const envelope = { capabilities: ["file.read", "local.generate"], providers: ["ollama"], localOnly: true, models: [model], projectScopes: ["personal"], sideEffects: false, background: false,
    budgets: { maxModelCalls: 4, maxWallMs: 600_000 }, expiresAt: Date.now() + 3_600_000, grants: { files: [{ root: "probe", access: "read" }], origins: [], services: [] } };
  const okSpec = { title: "Summarize the release notes", projectId: "personal", steps: [
    { id: "read", kind: "file.read", input: { root: "probe", path: "notes.txt" } },
    { id: "summary", kind: "local.generate", input: { prompt: "Summarize these notes in one sentence.", contextFrom: "read", maxTokens: 60 }, model }], acceptance: { requiredSteps: ["read", "summary"] } };
  const failSpec = { title: "Read a file that does not exist", projectId: "personal", steps: [{ id: "read", kind: "file.read", input: { root: "probe", path: "missing.txt" } }], acceptance: { requiredSteps: ["read"] } };
  const okTask = (await cmd("ptask.create", { spec: okSpec, envelope })).data;
  const failTask = (await cmd("ptask.create", { spec: failSpec, envelope })).data;
  const settle = (id) => until(`ptask ${id}`, async () => { const v = host.ptasks.view(id); return ["COMPLETED", "FAILED", "CANCELLED", "UNCERTAIN"].includes(v.state) ? v : null; }, 240_000)
    .catch((e) => { const v = host.ptasks.view(id); throw new Error(`${e.message}: ${JSON.stringify({ state: v.state, blocked: v.blocked, failure: v.failure, progress: v.progress, activity: v.activity })}`); });
  results.fixtures.okTask = (await settle(okTask.id)).state;
  results.fixtures.failTask = { state: (await settle(failTask.id)).state, failure: host.ptasks.view(failTask.id).failure };


  await stage("h1-team-mission-record", async () => {
    const text = await detailOf("Build an offline");
    for (const must of ["Team Mission", "— COMPLETED", "Objective: Build an offline", "Created ", "started ", "finished ", "Steps:", "Host-verified", `attempt 1: ollama · ${model}`, "Permission decisions:", "Host events (", "R1 PASSED (Host check)", "Coordinator", "Approvals logged by the Host:\n", "agent.started (approved=team-plan)"])
      assert.ok(text.includes(must), `missing "${must}"`);
    assert.match(text, /after t\d/, "step dependencies are shown");
    assert.doesNotMatch(text, /\d+\s?%/, "no invented progress percentages");
    return { text };
  });

  await stage("h2-connected-task-record-with-receipts", async () => {
    const text = await detailOf("Summarize the release notes");
    for (const must of ["Persistent task", "COMPLETED", `models: ${model}`, "Completed steps (output digests):", "read · sha256 ", "summary · sha256 ", "ledger chain verified", "Approval: not required"])
      assert.ok(text.includes(must), `missing "${must}"`);
    assert.match(text, /Receipts \([1-9]\d*\)/, "receipts recorded by the Host are listed");
    return { text };
  });

  await stage("h3-failed-task-shows-the-host-failure", async () => {
    const text = await detailOf("Read a file that does not exist");
    assert.ok(text.includes("FAILED"), "state");
    assert.match(text, /Failure: [A-Z_]+ — /, "the Host's failure code and detail");
    assert.ok(text.includes("Completed steps: none"));
    return { text, hostFailure: results.fixtures.failTask.failure };
  });
} finally {
  results.failures = failures;
  try { writeEvidence(out, scrub(results), [host.token]); } catch (e) { log(`evidence not written: ${e.message}`); }
  try { app?.kill(); } catch { /* gone */ }
  await sleep(1_000);
  await host.close();
  for (const d of [hostDir, configDir, project]) rmSync(d, { recursive: true, force: true });
  log(failures.length ? `FAILED: ${failures.join(", ")}` : "all stages passed");
  process.exitCode = failures.length ? 1 : 0;
}
