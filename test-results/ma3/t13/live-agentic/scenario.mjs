// T13 LIVE AGENTIC + WEAPON STATE DEMO (lane live-agentic). One disposable real Host on 43860 with the real capability
// adapters (filesystem / terminal) and real Agents/Missions. No model provider is used, so no paid or cloud call is made.
// Polls GET /state every 300 ms and records each Personal Agent slot's Host-derived presentation. At key states it hands
// a checkpoint to capture.mjs (Playwright on the dev server 8094) and to the real WPF Island (launched by this file).
import { startHost, evidence, now, repo } from "./host.mjs";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const T0 = Date.now();
const rel = () => Date.now() - T0;
const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a);
const CP = join(evidence, "cp");
mkdirSync(CP, { recursive: true });
const CREDS = join(evidence, "credentials.json");
const PORT = 43860;
const results = { checks: [], checkpoints: [], responses: [] };
const check = (name, ok, detail = null) => { results.checks.push({ name, ok: !!ok, detail }); log(ok ? "PASS" : "FAIL", name, detail == null ? "" : JSON.stringify(detail).slice(0, 300)); };
const timeline = { classification: "LIVE: disposable real Host 43860 (real Host code, real filesystem/terminal capabilities, no model provider), polled via GET /state", slots: [], agents: [] };
const islandLog = [];

// -------------------------------------------------------------------- Host + seed workspace
const host = await startHost(PORT, "live");
writeFileSync(CREDS, JSON.stringify({ token: host.token, port: PORT }));
const ws = host.workspace;
writeFileSync(join(ws, "seed.txt"), "seed");
writeFileSync(join(ws, "seed2.txt"), "seed2");
for (let i = 1; i <= 6; i++) writeFileSync(join(ws, `r${i}.txt`), `research note ${i}`);
writeFileSync(join(ws, "t.test.mjs"), "import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('T13 live sleepy test', async () => { await new Promise((r) => setTimeout(r, 3000)); assert.equal(1, 1); });\n");
await host.api("mission.configure", { enabled: true });
// No Project binding: a Project root gave every step a workspace-identity ask (aborted-run1-project-binding.log).

const step = (role, action, params, { dependsOn = [], verify = null, access = "read" } = {}) => ({ role, objective: `${role} (${action})`, access, executor: { kind: "capability", action, params }, dependsOn, verification: verify ? [verify] : [] });
const existsCheck = (path) => ({ kind: "capability", action: "filesystem.exists", params: { path }, expect: { field: "exists", equals: true } });
const compareCheck = (path, content) => ({ kind: "capability", action: "filesystem.compare", params: { path, content }, expect: { field: "matches", equals: true } });
const SPEC = {
  A: { name: "Research pass", steps: [...[1, 2, 3, 4, 5, 6].map((i) => step(`Read ${i}`, "filesystem.read", { path: `r${i}.txt` }, { dependsOn: i > 1 ? [i - 2] : [] }))] },
  B: { name: "File writer", steps: [step("Write", "filesystem.write", { path: "out.txt", content: "hello", overwrite: true }, { access: "write", verify: compareCheck("out.txt", "hello") })] },
  C: { name: "Test runner", steps: [step("Run tests", "terminal.exec", { command: "node --test", args: ["t.test.mjs"] }, { verify: existsCheck("t.test.mjs") })] },
  D: { name: "Delete request", steps: [step("Read seed", "filesystem.read", { path: "seed.txt" }, { verify: existsCheck("seed.txt") }), step("Delete seed", "filesystem.delete", { path: "seed.txt" }, { dependsOn: [0], access: "write" })] },
  E: { name: "Paused runner", steps: [step("Read r1", "filesystem.read", { path: "r1.txt" }, { verify: existsCheck("r1.txt") }), step("Run tests", "terminal.exec", { command: "node --test", args: ["t.test.mjs"] }, { dependsOn: [0], verify: existsCheck("t.test.mjs") }), step("Write final", "filesystem.write", { path: "final.txt", content: "done", overwrite: true }, { dependsOn: [1], access: "write", verify: compareCheck("final.txt", "done") })] },
  F: { name: "Stop target", steps: [step("Delete seed2", "filesystem.delete", { path: "seed2.txt" }, { access: "write" })] },
  G: { name: "Verification mismatch", steps: [step("Write bad", "filesystem.write", { path: "bad.txt", content: "hello", overwrite: true }, { access: "write", verify: compareCheck("bad.txt", "NOT-hello") })] },
  H: { name: "Background runner", steps: [step("Run tests", "terminal.exec", { command: "node --test", args: ["t.test.mjs"] }, { verify: existsCheck("t.test.mjs") })] },
};
const ids = {};
for (const [key, spec] of Object.entries(SPEC)) {
  const created = await host.api("agent.create", { name: spec.name, objective: spec.name, steps: spec.steps });
  if (created.status !== 200) { check(`create ${key}`, false, created.body); continue; }
  ids[key] = created.body.snapshot.agents.agents.find((row) => row.name === spec.name).id;
}
log("agents", JSON.stringify(ids));
check("eight real user Agents created through agent.create", Object.keys(ids).length === 8, { created: Object.keys(ids).length });

// -------------------------------------------------------------------- Host poller (GET /state only)
let latest = null, polls = 0, pollErrors = 0, polling = true;
const pendingOf = (state, agent) => {
  if (!agent) return [];
  const mission = state.missions?.missions?.find((m) => m.id === agent.missionId);
  const fromMission = (mission?.requests ?? []).filter((r) => r.resolution === null).map((r) => r.id);
  const fromAuth = (agent.authorization?.pending ?? []).map((p) => p.id);
  return [...new Set([...fromMission, ...fromAuth])];
};
const pollLoop = (async () => {
  const lastSlot = {}, lastAgent = {};
  while (polling) {
    try {
      const s = await host.state();
      latest = s; polls++;
      const ps = s.personalAgents;
      for (const slot of ps?.slots ?? []) {
        const row = { state: slot.presentation.state, label: slot.presentation.label, basis: slot.presentation.basis, agentId: slot.agentId, agentState: slot.agent?.state ?? null, progress: slot.progress, pendingApprovals: slot.attention?.pendingApprovals ?? 0, result: slot.result, failure: slot.agent?.failure ?? null, revision: ps.revision };
        const sig = JSON.stringify(row);
        if (lastSlot[slot.slot] !== sig) {
          lastSlot[slot.slot] = sig;
          const agent = s.agents.agents.find((a) => a.id === slot.agentId);
          timeline.slots.push({ t: rel(), at: now(), slot: slot.slot, weapon: slot.weapon, displayName: slot.displayName, ...row, requestIds: pendingOf(s, agent), source: "GET /state personalAgents.slots[].presentation" });
        }
      }
      for (const agent of s.agents.agents) {
        const sig = `${agent.state}|${agent.failure?.category ?? ""}|${agent.authorization?.state ?? ""}`;
        if (lastAgent[agent.id] !== sig) {
          lastAgent[agent.id] = sig;
          timeline.agents.push({ t: rel(), at: now(), agentId: agent.id, name: agent.name, state: agent.state, failure: agent.failure ?? null, pending: pendingOf(s, agent), missionState: s.missions?.missions?.find((m) => m.id === agent.missionId)?.state ?? null });
        }
      }
    } catch { pollErrors++; }
    await sleep(300);
  }
})();
const waitUntil = async (fn, timeoutMs, label) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (latest) { try { const v = fn(latest); if (v) return v; } catch { /* keep polling */ } }
    await sleep(100);
  }
  check(`wait: ${label}`, false, { timeoutMs });
  return null;
};
const agentOf = (s, key) => s.agents.agents.find((a) => a.id === ids[key]);
const stateOf = (key) => (latest ? agentOf(latest, key)?.state : null);
const slotOf = (s, n) => s.personalAgents.slots.find((x) => x.slot === n);
const pendingFor = (key) => (latest ? pendingOf(latest, agentOf(latest, key)) : []);

// -------------------------------------------------------------------- bindings, start, answers
const bind = async (assignments) => {
  if (!latest) latest = await host.state();
  const current = latest.personalAgents;
  const slots = current.slots.map((slot) => ({ slot: slot.slot, weapon: slot.weapon, displayName: slot.displayName, description: slot.description, purpose: slot.purpose, style: slot.style, responsibilities: slot.responsibilities, agentId: assignments[slot.slot] !== undefined ? assignments[slot.slot] : slot.agentId, active: slot.active }));
  const response = await host.api("personal_agents.configure", { slots, expectRevision: current.revision });
  results.responses.push({ action: "personal_agents.configure", at: now(), assignments, status: response.status, revision: response.body.snapshot?.personalAgents?.revision ?? null, error: response.body.error ?? null });
  check(`personal_agents.configure ${JSON.stringify(assignments)}`, response.status === 200, response.body.error ?? null);
  await sleep(350);
  return response;
};
const start = async (key) => { const r = await host.api("agent.start", { id: ids[key] }); results.responses.push({ action: "agent.start", key, at: now(), status: r.status, error: r.body.error ?? null }); check(`agent.start ${key}`, r.status === 200, r.body.error ?? null); };
const respondAll = async (key, decision = "allow_once", max = 4) => {
  const answered = [];
  for (let i = 0; i < max; i++) {
    await sleep(800);
    if (!pendingFor(key).length) break;
    answered.push(await respond(key, decision));
  }
  return answered;
};
const respond = async (key, decision = "allow_once") => {
  const requestIds = pendingFor(key);
  if (!requestIds.length) { check(`mission.respond ${key}: a pending ask exists`, false); return null; }
  const sentAt = rel();
  const r = await host.api("mission.respond", { requestId: requestIds[0], decision });
  const ackAt = rel();
  results.responses.push({ action: "mission.respond", key, requestId: requestIds[0], decision, sentAt, ackAt, status: r.status, error: r.body.error ?? null, at: now() });
  check(`mission.respond ${decision} on ${key}`, r.status === 200, r.body.error ?? null);
  return { requestId: requestIds[0], sentAt, ackAt, status: r.status };
};
const act = async (action, key) => { const r = await host.api(action, { id: ids[key] }); results.responses.push({ action, key, at: now(), status: r.status, error: r.body.error ?? null }); return r; };

// -------------------------------------------------------------------- checkpoints (Playwright capture.mjs + Island)
const checkpoint = async (name, { wait = 600_000 } = {}) => {
  const req = join(CP, `${name}.req`), done = join(CP, `${name}.done`);
  writeFileSync(req, JSON.stringify({ name, at: now(), hostSlots: latest ? latest.personalAgents.slots.map((x) => ({ slot: x.slot, state: x.presentation.state, label: x.presentation.label })) : null }));
  const start = Date.now();
  while (!existsSync(done) && Date.now() - start < wait) await sleep(150);
  if (!existsSync(done)) { check(`checkpoint ${name} captured`, false); results.checkpoints.push({ name, captured: false }); return null; }
  const out = JSON.parse(readFileSync(done, "utf8"));
  results.checkpoints.push({ name, captured: true, ...out });
  log("checkpoint", name, JSON.stringify(out.summary ?? "").slice(0, 240));
  return out;
};
const launchIsland = () => {
  const work = join(host.parent, "island");
  mkdirSync(work, { recursive: true });
  const pref = join(work, "pref.json");
  writeFileSync(pref, JSON.stringify({ edge: "top", position: "center", size: "compact", motion: "full", theme: "dark" }));
  const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(repo, "install/Bunny-Island.ps1"), "-CredentialPath", CREDS, "-DeploymentPath", join(work, "no-deploy"), "-PreferencePath", pref], { stdio: "ignore", windowsHide: false });
  islandLog.push({ at: now(), event: "launched", pid: child.pid });
  log("island launched by this run, pid", child.pid);
  return child;
};
const closeIsland = (child) => {
  if (!child || child.exitCode !== null) return;
  try { execFileSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" }); } catch { child.kill(); }
  islandLog.push({ at: now(), event: "closed", pid: child.pid });
  log("island (pid " + child.pid + ") closed");
};

// Filesystem read/list/write asks that the Host raised on an Agent whose script did not plan them are answered
// allow_once and recorded as UNSCRIPTED. Terminal and delete asks are never auto-answered: they are the scripted asks.
const unscripted = [];
const pendingDetail = (key) => {
  if (!latest) return [];
  const agent = agentOf(latest, key);
  const mission = latest.missions?.missions?.find((m) => m.id === agent?.missionId);
  return (mission?.requests ?? []).filter((r) => r.resolution === null).map((r) => ({ id: r.id, action: r.action, risk: r.risk }));
};
const settle = async (key, predicate, timeoutMs, label, { autoReadWrite = false } = {}) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (latest) {
      try { if (predicate(latest)) return true; } catch { /* keep polling */ }
      if (autoReadWrite && agentOf(latest, key)?.state === "WAITING_FOR_USER") {
        const open = pendingDetail(key).filter((r) => /^filesystem\.(read|list|exists|write)$/.test(r.action) && r.risk !== "DESTRUCTIVE");
        if (open.length && unscripted.filter((u) => u.agent === key).length < 3) {
          const r = await host.api("mission.respond", { requestId: open[0].id, decision: "allow_once" });
          unscripted.push({ at: now(), agent: key, action: open[0].action, risk: open[0].risk, decision: "allow_once", status: r.status });
          log("unscripted read/write ask answered for", key, open[0].action, r.status);
        }
      }
    }
    await sleep(150);
  }
  check(`wait: ${label}`, false, { timeoutMs });
  return false;
};

// ================================================================== SCENARIO
let island = null;
// Phase 1: bind four slots (Gada, Spear, Vishnu Chakra, Sword) and start four Agents.
await bind({ 1: ids.A, 2: ids.B, 3: ids.C, 4: ids.D });
for (const key of ["A", "B", "C", "D"]) { await start(key); await sleep(400); }
const aDone = await settle("A", (s) => agentOf(s, "A").state === "COMPLETED", 90_000, "A COMPLETED", { autoReadWrite: true });
check("A (research, no verification) reaches COMPLETED with unverified steps", !!aDone && slotOf(latest, 1).presentation.state === "COMPLETED", slotOf(latest, 1).presentation);
const bVerified = await settle("B", (s) => slotOf(s, 2).presentation.state === "VERIFIED", 90_000, "B VERIFIED", { autoReadWrite: true });
check("B (write + compare) is VERIFIED from the Host mission result", !!bVerified, latest ? slotOf(latest, 2).presentation : null);
const cWait = await settle("C", (s) => slotOf(s, 3).presentation.state === "WAITING_FOR_USER" && pendingDetail("C").some((r) => r.action === "terminal.exec"), 90_000, "C WAITING_FOR_USER (terminal.exec)", { autoReadWrite: true });
const dWait = await settle("D", (s) => slotOf(s, 4).presentation.state === "WAITING_FOR_USER" && pendingDetail("D").some((r) => r.action === "filesystem.delete"), 90_000, "D WAITING_FOR_USER (delete)", { autoReadWrite: true });
check("C (terminal.exec test) asks permission: WAITING_FOR_USER", !!cWait, cWait ? slotOf(latest, 3).presentation : null);
check("D (delete) asks permission: WAITING_FOR_USER", !!dWait, dWait ? slotOf(latest, 4).presentation : null);
// First page load happens here: B is already VERIFIED, so no cue may appear for it on load.
island = launchIsland();
await sleep(9000);
await checkpoint("cp1-first-load-waiting");
await sleep(4000);
check("nothing auto-grants: C and D still WAITING_FOR_USER after 4 s with no answer", stateOf("C") === "WAITING_FOR_USER" && stateOf("D") === "WAITING_FOR_USER", { C: stateOf("C"), D: stateOf("D") });
// Answer C through the real Host command. The slot may leave WAITING_FOR_USER only after the Host acknowledged.
const cAns = await respondAll("C");
const cTesting = await waitUntil((s) => slotOf(s, 3).presentation.state === "TESTING", 20_000, "C TESTING after allow_once");
check("C leaves WAITING_FOR_USER only after the Host acknowledged (ackAt precedes first non-waiting poll)", !!cTesting && !!cAns && cAns.status === 200, { ackAt: cAns?.ackAt, firstTesting: cTesting ? slotOf(latest, 3).presentation : null });
await checkpoint("cp2-testing");
const cVerified = await waitUntil((s) => slotOf(s, 3).presentation.state === "VERIFIED", 60_000, "C VERIFIED");
check("C reaches VERIFIED (test ran, verification passed) while the page stays open", !!cVerified, cVerified ? slotOf(latest, 3).presentation : null);
await sleep(1200);
await checkpoint("cp3-c-verified-live");

// Phase 2: Spear slot now runs the paused runner E. Pause lands on the running test step, then resume.
await bind({ 2: ids.E });
await start("E");
const eAsk = await settle("E", (s) => slotOf(s, 2).presentation.state === "WAITING_FOR_USER" && pendingDetail("E").some((r) => r.action === "terminal.exec"), 90_000, "E WAITING_FOR_USER (test step)", { autoReadWrite: true });
check("E asks permission before its test step", !!eAsk);
await respondAll("E");
const eTesting = await waitUntil((s) => slotOf(s, 2).presentation.state === "TESTING", 20_000, "E TESTING");
check("E TESTING is derived from the terminal.exec test command", !!eTesting, eTesting ? slotOf(latest, 2).presentation : null);
const paused = await act("agent.pause", "E");
check("agent.pause accepted by the Host", paused.status === 200, paused.body.error ?? null);
const ePaused = await waitUntil((s) => slotOf(s, 2).presentation.state === "PAUSED", 20_000, "E PAUSED");
check("E shows PAUSED from Host AgentState PAUSED", !!ePaused, ePaused ? slotOf(latest, 2).presentation : null);
await checkpoint("cp4-paused");
await sleep(2500);
const resumed = await act("agent.resume", "E");
check("agent.resume accepted by the Host", resumed.status === 200, resumed.body.error ?? null);
const eVerified = await waitUntil((s) => slotOf(s, 2).presentation.state === "VERIFIED" || agentOf(s, "E").state === "COMPLETED", 90_000, "E finished");
check("E resumes and finishes", !!eVerified, eVerified ? slotOf(latest, 2).presentation : null);

// Phase 3 (Demo E continuity): H waits for permission; the UI is closed; the Host finishes the Mission alone.
await bind({ 3: ids.H });
await start("H");
const hAsk = await settle("H", (s) => slotOf(s, 3).presentation.state === "WAITING_FOR_USER" && pendingDetail("H").some((r) => r.action === "terminal.exec"), 90_000, "H WAITING_FOR_USER (terminal.exec)", { autoReadWrite: true });
check("H (background runner) waits for permission before the UI is closed", !!hAsk);
await checkpoint("cp5-before-close");
await checkpoint("cp6-close-ui");
if (island) { closeIsland(island); island = null; }
await sleep(1500);
const bgAnswer = (await respondAll("H"))[0];
const hBg = await waitUntil((s) => agentOf(s, "H").state === "COMPLETED", 90_000, "H COMPLETED with UI closed");
check("with the UI closed the Host keeps the Mission running to completion", !!hBg && !!bgAnswer && bgAnswer.status === 200, { state: stateOf("H") });
await sleep(1500);
island = launchIsland();
await checkpoint("cp7-reopen-after-background", { wait: 600_000 });

// Phase 4: deny D (authority lost => FAILED). Sword then runs F and the user stops it => STOPPED.
const dDeny = (await respondAll("D", "deny"))[0];
const dFailed = await waitUntil((s) => slotOf(s, 4).presentation.state === "FAILED", 60_000, "D FAILED");
check("denied delete ends the Agent FAILED (Host AgentState FAILED)", !!dFailed && !!dDeny && dDeny.status === 200, dFailed ? { presentation: slotOf(latest, 4).presentation, failure: agentOf(latest, "D").failure } : null);
await checkpoint("cp8-failed");
await bind({ 4: ids.F });
await start("F");
const fWait = await settle("F", (s) => slotOf(s, 4).presentation.state === "WAITING_FOR_USER" && pendingDetail("F").some((r) => r.action === "filesystem.delete"), 90_000, "F WAITING_FOR_USER (delete)", { autoReadWrite: true });
check("F (delete ask) waits for the user", !!fWait);
const fStop = await act("agent.stop", "F");
check("agent.stop accepted by the Host", fStop.status === 200, fStop.body.error ?? null);
const fStopped = await waitUntil((s) => slotOf(s, 4).presentation.state === "STOPPED", 30_000, "F STOPPED");
check("stopped Agent shows STOPPED from Host AgentState", !!fStopped, fStopped ? slotOf(latest, 4).presentation : null);
await checkpoint("cp9-stopped");

// Unslotted: an Agent whose verification fails. Recorded as Host truth (no bound slot).
await start("G");
const gSettled = await waitUntil((s) => ["WAITING_FOR_USER", "FAILED", "COMPLETED"].includes(agentOf(s, "G").state), 60_000, "G settles");
check("G (failing verification) settles at a Host-recorded state", !!gSettled, gSettled ? { state: agentOf(latest, "G").state, failure: agentOf(latest, "G").failure } : null);

// Final: the slots as the Host projects them now.
await checkpoint("cp10-final");
await sleep(600);
results.finalSlots = latest.personalAgents.slots.map((x) => ({ slot: x.slot, weapon: x.weapon, agent: x.agent?.name ?? null, presentation: x.presentation, progress: x.progress, result: x.result, pendingApprovals: x.attention.pendingApprovals }));
results.agentStates = latest.agents.agents.map((a) => ({ name: a.name, state: a.state, failure: a.failure ?? null }));
polling = false;
await pollLoop;
timeline.counts = { polls, pollErrors };
writeFileSync(join(evidence, "timeline.json"), JSON.stringify(timeline, null, 2) + "\n");
writeFileSync(join(evidence, "results.json"), JSON.stringify({ lane: "live-agentic", classification: timeline.classification, hostPid: host.pid, port: PORT, ids, polls, pollErrors, durationMs: rel(), checks: results.checks, unscriptedReadWriteAsks: unscripted, responses: results.responses, checkpoints: results.checkpoints, finalSlots: results.finalSlots, agentStates: results.agentStates, islandLog }, null, 2) + "\n");
if (island) closeIsland(island);
await host.stop();
writeFileSync(CREDS, "{}\n");
log("DONE checks passed:", results.checks.filter((c) => c.ok).length, "/", results.checks.length);
process.exit(0);
