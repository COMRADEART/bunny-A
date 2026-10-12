// M-A-3 T11 LIVE multi-Agent long-run acceptance. A DISPOSABLE Host (temp state, port 43811, never 8084/43119) running
// the real Host code with its default provider adapters and REAL local Ollama, a disposable Git project, the loopback dev
// UI (127.0.0.1:8096) driven by headless Chromium, and controlled fault injection. Operator decisions (plan approval,
// consent, pause/resume, stop) are scripted through the same Host command API the Agentic UI uses, and recorded.
// Production is never touched: no installed state, no production port, no tunnel, no Startup entries.
import { fork, spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { DatabaseSync } from "node:sqlite";
import { chromium } from "playwright";

const repo = resolve(import.meta.dirname, "../../../..");
const out = process.env.T11_OUT ?? import.meta.dirname;
for (const dir of ["plans", "outputs", "ui"]) mkdirSync(join(out, dir), { recursive: true });
const PORT = 43811, UI_PORT = 8096;
const TARGET_MS = Number(process.env.T11_TARGET_MS ?? 40 * 60_000);
const MAX_MS = Number(process.env.T11_MAX_MS ?? 75 * 60_000);
const save = (name, value) => writeFileSync(join(out, name), JSON.stringify(value, null, 2) + "\n");
const sha = (text) => createHash("sha256").update(text).digest("hex");
const t0 = Date.now();
const log = [];
const note = (kind, detail = {}) => { const row = { at: Date.now(), t: Math.round((Date.now() - t0) / 1000), kind, ...detail }; log.push(row); console.log(`[${row.t}s] ${kind} ${JSON.stringify(detail).slice(0, 220)}`); };

// ── disposable project (Git) ─────────────────────────────────────────────────
const parent = mkdtempSync(join(tmpdir(), "bunny-t11-live-"));
const data = join(parent, "state"), workspace = join(parent, "workspace"), project = join(parent, "offline-dashboard");
for (const p of [data, workspace, project, join(project, "data"), join(project, "docs")]) mkdirSync(p, { recursive: true });
const git = (...args) => execFileSync("git", ["-c", "user.name=T11 Fixture", "-c", "user.email=t11@example.invalid", "-c", "core.autocrlf=false", ...args], { cwd: project, windowsHide: true });
const commit = (files, message) => { for (const [path, body] of Object.entries(files)) writeFileSync(join(project, path), body); git("add", "."); git("commit", "-qm", message); };
git("init", "-q");
commit({ "README.md": "# Offline research dashboard\n\nDisposable T11 acceptance project. Test data only.\n" }, "Start the offline dashboard project");
commit({ "data/inventory.csv": "name,category,count,status\nWidgets,parts,120,ok\nGadgets,parts,8,warning\nSprockets,parts,0,error\nCables,accessories,64,ok\nAdapters,accessories,15,warning\nBatteries,power,42,ok\n" }, "Add inventory test data");
commit({ "data/services.csv": "service,status,latency_ms,owner\nauth,ok,42,identity\nsearch,warning,310,discovery\nbilling,ok,88,payments\nexport,error,0,reports\nnotify,ok,51,platform\n" }, "Add service status test data");
commit({ "data/team.csv": "name,role,area,focus\nAda,lead,platform,planning\nGrace,engineer,search,indexing\nLinus,engineer,billing,ledger\nMargaret,analyst,reports,exports\n" }, "Add team directory test data");
commit({ "data/budget.csv": "line,category,planned,actual\nHosting,infrastructure,1200,1340\nLicenses,software,800,760\nTraining,people,500,420\nHardware,infrastructure,900,1010\n" }, "Add budget test data");
commit({ "docs/notes.md": "# Notes\n\nThe dashboard must work offline. Every number comes from the data folder.\n" }, "Document the offline constraint");

// ── Host process (owned, exact pid) ──────────────────────────────────────────
const faultsPath = join(parent, "faults.json");
writeFileSync(faultsPath, JSON.stringify({ seed: [] }));
let child, ready;
const hostLog = [];
const boot = async (reason) => {
  child = fork(join(repo, "scripts/fixtures/t11-mission-worker.mjs"), [data, workspace, String(PORT), faultsPath], { cwd: repo, execArgv: ["--experimental-strip-types"], stdio: ["ignore", "pipe", "pipe", "ipc"], windowsHide: true });
  child.stderr.on("data", (d) => hostLog.push(String(d).slice(0, 2000)));
  child.stdout.on("data", () => {});
  ready = await new Promise((done, reject) => { child.once("message", done); child.once("exit", (code) => reject(Error(`Host exited ${code}`))); });
  child.on("message", (message) => { if (message?.fault) note("fault.interrupt.ack", message); });
  note("host.boot", { reason, pid: ready.pid, epoch: ready.generation });
};
const api = async (action, body = {}) => {
  const response = await fetch(`http://127.0.0.1:${PORT}/command`, { method: "POST", headers: { authorization: `Bearer ${ready.token}`, "content-type": "application/json" }, body: JSON.stringify({ action, data: body }) });
  const result = await response.json();
  if (response.status !== 200) throw Object.assign(Error(`${action}: ${result.error}`), { status: response.status, result });
  return result;
};
const state = async () => (await fetch(`http://127.0.0.1:${PORT}/state`, { headers: { authorization: `Bearer ${ready.token}` } })).json();
const until = async (fn, label, timeoutMs = 20 * 60_000, every = 1500) => {
  const start = Date.now();
  for (;;) { let v; try { v = await fn(); } catch { v = undefined; } if (v) return v; if (Date.now() - start > timeoutMs) throw Error(`Timed out: ${label}`); await sleep(every); }
};

// ── telemetry (resource control, §42) ────────────────────────────────────────
const telemetry = [];
const probe = () => {
  try {
    const ps = `$p=Get-Process -Id ${ready.pid} -ErrorAction SilentlyContinue; $o=Get-Process -Name ollama* -ErrorAction SilentlyContinue | Measure-Object WorkingSet64 -Sum; $c=(Get-CimInstance Win32_Processor | Measure-Object LoadPercentage -Average).Average; $m=Get-CimInstance Win32_OperatingSystem; [pscustomobject]@{hostCpuSeconds=$p.CPU; hostWorkingSet=$p.WorkingSet64; ollamaWorkingSet=$o.Sum; cpuLoad=$c; freeMemoryKb=$m.FreePhysicalMemory; totalMemoryKb=$m.TotalVisibleMemorySize} | ConvertTo-Json -Compress`;
    const proc = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { encoding: "utf8", windowsHide: true, timeout: 20000 }));
    const gpu = execFileSync("nvidia-smi", ["--query-gpu=utilization.gpu,memory.used,memory.total", "--format=csv,noheader,nounits"], { encoding: "utf8", windowsHide: true, timeout: 10000 }).trim().split(",").map((v) => Number(v.trim()));
    return { ...proc, gpu: { utilization: gpu[0], memoryUsedMiB: gpu[1], memoryTotalMiB: gpu[2] } };
  } catch (error) { return { error: String(error.message).slice(0, 200) }; }
};
let sampling = true;
const sampler = (async () => {
  while (sampling) {
    try {
      const s = await state();
      const ps = await (await fetch("http://127.0.0.1:11434/api/ps")).json().catch(() => ({ models: [] }));
      const team = s.agents.agents.filter((a) => a.team);
      const missions = s.missions.missions.filter((m) => m.teamView);
      telemetry.push({ at: Date.now(), t: Math.round((Date.now() - t0) / 1000), pid: ready.pid,
        agents: { total: team.length, working: team.filter((a) => a.state === "RUNNING" || a.state === "VERIFYING").length, byState: Object.fromEntries([...new Set(team.map((a) => a.state))].map((k) => [k, team.filter((a) => a.state === k).length])) },
        providerSessions: s.tasks.filter((t) => ["running", "launching"].includes(t.state)).length,
        queue: { ready: missions.flatMap((m) => m.steps).filter((st) => st.state === "ready").length, pendingLive: missions.flatMap((m) => m.steps).filter((st) => st.state === "pending" && !st.team?.dormant).length },
        activeMissions: missions.filter((m) => ["running", "verifying", "waiting_for_user", "waiting_for_approval"].includes(m.state)).length,
        ollama: (ps.models ?? []).map((m) => ({ name: m.name, sizeVram: m.size_vram, contextLength: m.context_length ?? null })), ...probe() });
    } catch { /* Host restarting */ }
    await sleep(15000);
  }
})();

// ── team helpers ─────────────────────────────────────────────────────────────
const missionOf = async (missionId) => (await state()).missions.missions.find((m) => m.id === missionId);
const coordinatorOf = (s, missionId) => s.agents.agents.find((a) => a.team?.role === "coordinator" && a.missionId === missionId);
const memberOf = (s, missionId, role) => s.agents.agents.find((a) => a.team?.role === role && a.missionId === missionId);
let projectId;
const create = async (spec) => {
  const result = await api("agent.create", { projectId, name: spec.name, objective: spec.objective, team: { outputDir: spec.outputDir, requirements: spec.requirements, ...(spec.limits ? { limits: spec.limits } : {}) } });
  const coordinator = result.snapshot.agents.agents.find((a) => a.team?.role === "coordinator" && a.name === spec.name);
  note("team.created", { name: spec.name, missionId: coordinator.missionId, coordinatorId: coordinator.id });
  return { ...spec, missionId: coordinator.missionId, coordinatorId: coordinator.id, createdAt: Date.now() };
};
const startPlanning = async (team) => { await api("agent.start", { id: team.coordinatorId }); note("team.planning", { name: team.name }); };
const waitReview = async (team, revised = false) => {
  const m = await until(async () => { const x = await missionOf(team.missionId); return x && ((x.state === "waiting_for_approval" && x.teamView?.phase === "review") || ["waiting_for_user", "failed", "stopped"].includes(x.state)) ? x : null; }, `${team.name} plan review`, 15 * 60_000);
  const plan = { mission: team.name, missionId: team.missionId, phase: m.teamView.phase, state: m.state, planReference: m.teamView.planReference, planRevisions: m.teamView.planRevisions, rejected: m.teamView.rejected,
    members: m.teamView.members, tasks: m.steps.map((st) => ({ key: st.team?.key, role: st.team?.role, kind: st.team?.kind, objective: st.objective, dependsOn: st.dependsOn.map((d) => m.steps.find((x) => x.id === d)?.team?.key), dormant: !!st.team?.dormant, target: st.team?.target ?? null, requirements: st.team?.requirements ?? null })) };
  save(`plans/${team.slug}.json`, plan);
  note("team.plan_reviewed", { name: team.name, phase: m.teamView.phase, state: m.state, tasks: plan.tasks.filter((x) => !x.dormant).length, revisions: m.teamView.planRevisions });
  if (m.teamView.phase === "planning" && m.state === "waiting_for_user" && !revised) {
    // The operator presses "Ask for a revised plan" once; the Planner Agent tries again with Bunny's reasons.
    await api("agent.team.revise", { id: team.coordinatorId, note: "Follow every rule Bunny listed; keep one chain per deliverable." });
    note("team.revision_requested", { name: team.name });
    await api("agent.team.approve", { id: team.coordinatorId }).catch(() => {});
    return waitReview(team, true);
  }
  return m;
};
const terminal = (m) => ["completed", "failed", "stopped"].includes(m.state) || (m.state === "waiting_for_user" && m.teamView?.phase !== "review" && !m.requests.some((r) => !r.resolvedAt));
const waitEnd = async (team, timeoutMs = 30 * 60_000) => until(async () => { const m = await missionOf(team.missionId); return m && terminal(m) ? m : null; }, `${team.name} end`, timeoutMs, 2000);
const record = async (team, m) => {
  const folder = join(project, team.outputDir);
  const files = existsSync(folder) ? readdirSync(folder).map((name) => { const body = readFileSync(join(folder, name)); mkdirSync(join(out, "outputs", team.slug), { recursive: true }); copyFileSync(join(folder, name), join(out, "outputs", team.slug, name)); return { name, bytes: body.length, sha256: sha(body) }; }) : [];
  const result = { name: team.name, missionId: team.missionId, state: m.state, phase: m.teamView?.phase, requirementResults: m.teamView?.requirementResults, reworkRounds: m.teamView?.reworkRounds, planRevisions: m.teamView?.planRevisions,
    findings: m.teamView?.findings, handoffs: m.teamView?.handoffs?.length, files, endedAt: Date.now(), durationMs: Date.now() - team.createdAt,
    steps: m.steps.map((st) => ({ key: st.team?.key, role: st.team?.role, kind: st.team?.kind, owner: st.team?.agentId, state: st.state, attempts: st.attempts.map((a) => ({ outcome: a.outcome, category: a.category ?? null, taskId: a.taskId ?? null })), verified: st.result?.verified ?? null, supersededBy: st.team?.supersededBy ?? null, dormant: !!st.team?.dormant })) };
  note("team.ended", { name: team.name, state: m.state, requirements: (m.teamView?.requirementResults ?? []).map((r) => `${r.id}:${r.passed}`).join(","), files: files.map((f) => f.name).join(",") });
  return result;
};

// ── the catalog: distinct real work over the project's test data ─────────────
const html = (id, text) => ({ id, text, check: { kind: "html_id", value: id === "R1" ? "summary" : "details" } });
const CATALOG = [
  { slug: "a-inventory", name: "Inventory dashboard team", outputDir: "inventory-dashboard", objective: "Build an offline inventory dashboard page from data/inventory.csv with a README that explains how to use it.",
    requirements: [{ id: "R1", text: "The dashboard has a summary section", check: { kind: "html_id", value: "summary" } }, { id: "R2", text: "Every inventory item is shown", check: { kind: "dataset_values" } }, { id: "R3", text: "The page works offline", check: { kind: "no_external_resources" } }, { id: "R4", text: "The README has a Usage section", check: { kind: "markdown_heading", value: "Usage" } }] },
  { slug: "b-services", name: "Service status team", outputDir: "service-status", objective: "Build an offline service status page from data/services.csv and a short operations note in Markdown.", consent: true,
    requirements: [{ id: "R1", text: "The page has a status table section", check: { kind: "html_id", value: "status" } }, { id: "R2", text: "Every service is listed", check: { kind: "dataset_values" } }, { id: "R3", text: "The page works offline", check: { kind: "no_external_resources" } }, { id: "R4", text: "The note has an Incidents section", check: { kind: "markdown_heading", value: "Incidents" } }] },
  { slug: "c-release-notes", name: "Release notes team", outputDir: "release-notes", objective: "Write release notes for this project from its Git history as Markdown, and an offline HTML changelog page.",
    requirements: [{ id: "R1", text: "The notes have a Changes section", check: { kind: "markdown_heading", value: "Changes" } }, { id: "R2", text: "The page has a changelog section", check: { kind: "html_id", value: "changelog" } }, { id: "R3", text: "The page works offline", check: { kind: "no_external_resources" } }] },
  { slug: "d-team-directory", name: "Team directory team", outputDir: "team-directory", objective: "Build an offline team directory page from data/team.csv and a Markdown onboarding note.",
    requirements: [{ id: "R1", text: "The page has a directory section", check: { kind: "html_id", value: "directory" } }, { id: "R2", text: "Every person is shown", check: { kind: "dataset_values" } }, { id: "R3", text: "The page works offline", check: { kind: "no_external_resources" } }, { id: "R4", text: "The note has a Getting started section", check: { kind: "markdown_heading", value: "Getting started" } }] },
  { slug: "e-budget", name: "Budget review team", outputDir: "budget-review", objective: "Build an offline budget review page from data/budget.csv comparing planned and actual amounts, with a Markdown summary.",
    requirements: [{ id: "R1", text: "The page has a totals section", check: { kind: "html_id", value: "totals" } }, { id: "R2", text: "Every budget line is shown", check: { kind: "dataset_values" } }, { id: "R3", text: "The page works offline", check: { kind: "no_external_resources" } }, { id: "R4", text: "The summary has a Variance section", check: { kind: "markdown_heading", value: "Variance" } }] },
  { slug: "f-inventory-categories", name: "Inventory categories team", outputDir: "inventory-categories", objective: "Build an offline page that groups data/inventory.csv items by category, with a Markdown restock note.",
    requirements: [{ id: "R1", text: "The page has a categories section", check: { kind: "html_id", value: "categories" } }, { id: "R2", text: "Every item is shown", check: { kind: "dataset_values" } }, { id: "R3", text: "The page works offline", check: { kind: "no_external_resources" } }, { id: "R4", text: "The note has a Restock section", check: { kind: "markdown_heading", value: "Restock" } }] },
  { slug: "g-service-latency", name: "Service latency team", outputDir: "service-latency", objective: "Build an offline latency overview page from data/services.csv with a Markdown follow-up list.",
    requirements: [{ id: "R1", text: "The page has a latency section", check: { kind: "html_id", value: "latency" } }, { id: "R2", text: "Every service is listed", check: { kind: "dataset_values" } }, { id: "R3", text: "The page works offline", check: { kind: "no_external_resources" } }, { id: "R4", text: "The list has a Follow-up section", check: { kind: "markdown_heading", value: "Follow-up" } }] },
  { slug: "h-project-overview", name: "Project overview team", outputDir: "project-overview", objective: "Write a Markdown project overview from docs/notes.md and the Git history, and an offline HTML overview page.",
    requirements: [{ id: "R1", text: "The overview has a History section", check: { kind: "markdown_heading", value: "History" } }, { id: "R2", text: "The page has an overview section", check: { kind: "html_id", value: "overview" } }, { id: "R3", text: "The page works offline", check: { kind: "no_external_resources" } }] },
];
void html;

// ── fault plan bookkeeping ───────────────────────────────────────────────────
const faults = { dependencyDelay: null, providerInterruption: null, failedVerification: null, agentRetry: null, authorizationChange: null, hostRestart: null, uiClosure: null };
const results = [];
const run = { classification: "LIVE disposable Windows Host + real local Ollama (tool-free) + disposable Git project; operator decisions scripted through the Host command API", sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(), parent, project, port: PORT, uiPort: UI_PORT, startedAt: t0 };
save("live-run-start.json", run);

// ── UI (dev server against the disposable Host's data directory) ─────────────
let vite, browser;
const startUi = async () => {
  vite = spawn(process.execPath, [join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"), "run", "dev", "--", "--host", "127.0.0.1", "--port", String(UI_PORT), "--strictPort"], { cwd: repo, env: { ...process.env, BUNNY_HOST_DATA_DIRECTORY: data }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  vite.stdout.on("data", () => {}); vite.stderr.on("data", () => {});
  await until(async () => (await fetch(`http://127.0.0.1:${UI_PORT}/`)).ok, "dev UI", 180000, 1000);
};
const openAgentic = async (label) => {
  browser ??= await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const consoleErrors = [];
  page.on("pageerror", (e) => consoleErrors.push(String(e).slice(0, 300)));
  await page.goto(`http://127.0.0.1:${UI_PORT}/?view=agentic`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.locator("[data-testid=teams-section]").first().waitFor({ timeout: 90000 }).catch(() => {});
  await sleep(3000);
  const cards = await page.locator("[data-testid^=team-]").evaluateAll((nodes) => nodes.filter((n) => /^team-[0-9a-f-]{36}$/.test(n.dataset.testid ?? "")).map((n) => ({ id: n.dataset.testid.slice(5), phase: n.dataset.phase, text: n.innerText.slice(0, 1500) })));
  await page.screenshot({ path: join(out, "ui", `${label}.png`), fullPage: true });
  return { page, cards, consoleErrors };
};

// ── voice supervision (typed turns into a real voice session on this disposable Host) ──
const voice = { classification: "LIVE disposable Host voice session; typed turns (no microphone capture), answers from canonical Host facts, spoken on the default output", probes: [] };
const voiceProbe = async (label, questions) => {
  const command = async (action, body = {}) => { const r = await fetch(`http://127.0.0.1:${PORT}/command`, { method: "POST", headers: { authorization: `Bearer ${ready.token}`, "content-type": "application/json" }, body: JSON.stringify({ action, data: body }) }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
  const probe = { label, at: Date.now(), turns: [] };
  try {
    const opened = await command("voice.session.open", { mode: "push_to_talk" });
    if (opened.status !== 200) { probe.error = `open refused: ${opened.body.error ?? opened.status}`; voice.probes.push(probe); return; }
    for (const text of questions) {
      const before = (await command("voice.state")).body.data;
      const sent = await command("voice.text", { text });
      let vs = before;
      const deadline = Date.now() + 45000;
      while (Date.now() < deadline) { await sleep(300); vs = (await command("voice.state")).body.data; if (vs?.timing?.completedAt && vs.timing.completedAt !== before?.timing?.completedAt && !vs.playing) break; }
      const s = await state();
      const team = s.agents.agents.filter((a) => a.team);
      probe.turns.push({ text, status: sent.status, turnKind: vs?.turnKind ?? null, answerSource: vs?.answerSource ?? null, answer: vs?.answer ?? null,
        canonical: { working: team.filter((a) => (a.state === "RUNNING" || a.state === "VERIFYING") && a.team.role !== "coordinator").map((a) => ({ role: a.team.role, task: a.current?.kind ?? null })), testers: team.filter((a) => a.team.role === "tester" && !["COMPLETED", "FAILED", "STOPPED"].includes(a.state)).map((a) => a.state) } });
    }
    await command("voice.session.close", { source: "t11_live_probe" });
  } catch (error) { probe.error = error.message; }
  voice.probes.push(probe);
  note("voice.probe", { label, turns: probe.turns.map((t) => `${t.turnKind}:${(t.answer ?? "").slice(0, 60)}`).join(" | "), error: probe.error ?? null });
};
const VOICE_QUESTIONS = ["How many agents are working?", "Which agent is testing?", "What is the planning agent doing?", "Has the mission finished?", "Which tasks failed?", "Approve the team plan."];

// ── the run ──────────────────────────────────────────────────────────────────
let fatal = null;
try {
  await boot("initial");
  await api("mission.configure", { enabled: true, limits: { maxSteps: 20, maxActiveMissions: 3 } });
  projectId = (await api("project.add", { name: "T11 offline dashboard (disposable)", path: project })).data.id;
  await startUi();

  // Mission A: dependency delay, seeded defect, provider interruption, Host restart, UI closure.
  const A = await create(CATALOG[0]);
  writeFileSync(faultsPath, JSON.stringify({ seed: [{ missionId: A.missionId, kind: "generate_html", round: 0, remove: ['id="summary"', "id='summary'"], replace: 'id="overview-seeded"' }] }));
  faults.failedVerification = { mission: A.name, seededAt: Date.now(), seed: "round-0 dashboard: id=\"summary\" renamed (test-only Host hook, recorded as mission.team.seeded)" };
  await startPlanning(A);
  const reviewA = await waitReview(A);
  if (reviewA.teamView.phase !== "review") throw Error(`Mission A planning ended ${reviewA.state}`);
  let s = await state();
  const researcher = memberOf(s, A.missionId, "researcher");
  if (researcher) {
    await api("agent.pause", { id: researcher.id });
    faults.dependencyDelay = { mission: A.name, pausedAgent: researcher.id, pausedAt: Date.now() };
    note("fault.dependency_delay.pause", { agent: researcher.name });
  }
  await api("agent.team.approve", { id: A.coordinatorId, planReference: reviewA.teamView.planReference });
  note("team.approved", { name: A.name });
  // UI open while the team works.
  const ui1 = await openAgentic("agentic-a-running");
  faults.uiClosure = { openedAt: Date.now(), cardsBefore: ui1.cards.map((c) => ({ id: c.id, phase: c.phase })), consoleErrorsBefore: ui1.consoleErrors };
  await ui1.page.close(); await browser.close(); browser = null;
  faults.uiClosure.closedAt = Date.now();
  note("fault.ui_closure.closed", {});
  // Dependency delay evidence: dependents of the paused member wait; then resume.
  await sleep(60000);
  let mA = await missionOf(A.missionId);
  faults.dependencyDelay.during = mA.steps.filter((st) => !st.team?.dormant).map((st) => ({ key: st.team.key, role: st.team.role, state: st.state }));
  s = await state();
  faults.dependencyDelay.agentsDuring = s.agents.agents.filter((a) => a.missionId === A.missionId).map((a) => ({ role: a.team?.role, state: a.state }));
  await api("agent.resume", { id: researcher.id });
  faults.dependencyDelay.resumedAt = Date.now();
  note("fault.dependency_delay.resume", {});

  // Provider interruption: abort the real Ollama stream of A's page generation mid-flight.
  const target = await until(async () => { const m = await missionOf(A.missionId); const st = m.steps.find((x) => x.team?.kind === "generate_html" && x.team.round === 0); return st?.state === "running" && st.taskId ? st : null; }, "A page generation running", 20 * 60_000, 500);
  await sleep(4000);
  child.send({ fault: "interrupt", taskId: target.taskId });
  faults.providerInterruption = { mission: A.name, stepId: target.id, taskId: target.taskId, at: Date.now() };
  note("fault.provider_interruption", { taskId: target.taskId });
  const retried = await until(async () => { const m = await missionOf(A.missionId); const st = m.steps.find((x) => x.id === target.id); return st.attempts.length >= 2 ? st : null; }, "interrupted step retried", 10 * 60_000);
  faults.providerInterruption.attempts = retried.attempts.map((a) => ({ outcome: a.outcome, category: a.category ?? null, taskId: a.taskId ?? null }));

  // Host restart: abrupt termination of the exact owned Host pid while A has model work in flight.
  await until(async () => { const m = await missionOf(A.missionId); return m.steps.some((x) => x.executor?.kind === "model" && x.state === "running" && x.team?.kind !== "plan" && x.id !== target.id) || terminal(m) ? m : null; }, "A model work in flight for restart", 20 * 60_000, 1000);
  const before = await state();
  const oldPid = ready.pid, oldEpoch = ready.generation;
  child.kill("SIGKILL");
  await new Promise((done) => child.once("exit", done));
  const orphans = (() => { try { return execFileSync("powershell.exe", ["-NoProfile", "-Command", `@(Get-CimInstance Win32_Process -Filter "ParentProcessId=${oldPid}" | Select-Object ProcessId,Name) | ConvertTo-Json -Compress`], { encoding: "utf8", windowsHide: true }).trim() || "[]"; } catch (e) { return `probe failed: ${e.message}`; } })();
  note("fault.host_restart.killed", { oldPid, orphans });
  const downAt = Date.now();
  await sleep(5000);
  await boot("after abrupt termination");
  const after = await state();
  faults.hostRestart = { mission: A.name, oldPid, newPid: ready.pid, oldEpoch, newEpoch: ready.generation, downMs: Date.now() - downAt, orphanChildrenOfOldPid: orphans,
    agentsBefore: before.agents.agents.map((a) => ({ id: a.id, state: a.state, run: a.run?.generation ?? null })), agentsAfter: after.agents.agents.map((a) => ({ id: a.id, state: a.state, run: a.run?.generation ?? null })),
    identitiesPreserved: before.agents.agents.every((a) => after.agents.agents.some((b) => b.id === a.id)),
    dependenciesPreserved: (() => { const x = before.missions.missions.find((m) => m.id === A.missionId), y = after.missions.missions.find((m) => m.id === A.missionId); return JSON.stringify(x.steps.map((st) => st.dependsOn)) === JSON.stringify(y.steps.map((st) => st.dependsOn)); })() };

  // UI reopen after closure + restart: the Agentic view shows current canonical state.
  const ui2 = await openAgentic("agentic-a-after-restart");
  const canonical = await missionOf(A.missionId);
  faults.uiClosure = { ...faults.uiClosure, reopenedAt: Date.now(), cardsAfter: ui2.cards.map((c) => ({ id: c.id, phase: c.phase, text: c.text.slice(0, 600) })), consoleErrorsAfter: ui2.consoleErrors,
    canonicalPhase: canonical.teamView.phase, matches: ui2.cards.some((c) => c.id === A.missionId && c.phase === canonical.teamView.phase) };
  await ui2.page.close();

  const endA = await waitEnd(A);
  results.push(await record(A, endA));
  if (endA.state === "waiting_for_user") { await api("agent.stop", { id: A.coordinatorId }).catch(() => {}); note("team.stopped_held", { name: A.name }); }
  faults.agentRetry = { mission: A.name, reworkRounds: endA.teamView.reworkRounds, superseded: endA.steps.filter((x) => x.team?.supersededBy).map((x) => ({ key: x.team.key, kind: x.team.kind, ownState: x.state, failure: x.failure?.category ?? null, supersededBy: endA.steps.find((y) => y.id === x.team.supersededBy)?.team?.key, replacementState: endA.steps.find((y) => y.id === x.team.supersededBy)?.state })) };
  // Mission B (consent, mid-run reduction) runs concurrently with Mission C, each with at most 3 member Agents so both
  // fit the 10 active-Agent bound together.
  const B = await create({ ...CATALOG[1], limits: { maxAgents: 3 } });
  const C = await create({ ...CATALOG[3], limits: { maxAgents: 3 } });
  await startPlanning(B); await startPlanning(C);
  // B review + consent: the Coordinator's one consent covers the reviewed execution plan.
  const reviewB = await waitReview(B);
  if (reviewB.teamView.phase === "review") {
    const proposed = await api("agent.authorization.propose", { id: B.coordinatorId });
    const offer = proposed.snapshot.agents.agents.find((a) => a.id === B.coordinatorId).authorization;
    await api("agent.authorization.approve", { id: B.coordinatorId, revision: offer.revision });
    B.consent = { revision: offer.revision, capabilities: offer.capabilities };
    note("team.consent_approved", { name: B.name, revision: offer.revision });
  }
  const reviewC = await waitReview(C);
  setTimeout(() => { void voiceProbe("during B and C", VOICE_QUESTIONS); }, 30000);
  if (reviewC.teamView.phase === "review") { await api("agent.team.approve", { id: C.coordinatorId, planReference: reviewC.teamView.planReference }); note("team.approved", { name: C.name }); }
  // B authorization change: after B's first write, remove file writes from its consent.
  (async () => {
    try {
      const firstWrite = await until(async () => { const m = await missionOf(B.missionId); return m?.steps.some((x) => x.team?.kind === "observe" && x.state === "completed") ? m : null; }, "B first input observed", 25 * 60_000, 500);
      const sB = await state();
      const consent = sB.agents.agents.find((a) => a.id === B.coordinatorId).authorization;
      await api("agent.authorization.adjust", { id: B.coordinatorId, revision: consent.revision, patch: { capabilities: consent.capabilities.filter((c) => c !== "filesystem.write") } });
      faults.authorizationChange = { mission: B.name, at: Date.now(), removed: "filesystem.write", fromRevision: consent.revision, writesBefore: firstWrite.steps.filter((x) => x.team?.kind === "write_file").map((x) => ({ key: x.team.key, state: x.state })) };
      note("fault.authorization_change", { removed: "filesystem.write" });
      const asked = await until(async () => { const m = await missionOf(B.missionId); return m && (m.requests.some((r) => !r.resolvedAt && r.action === "filesystem.write") || terminal(m)) ? m : null; }, "B write held", 25 * 60_000, 2000);
      const pending = asked.requests.filter((r) => !r.resolvedAt && r.action === "filesystem.write");
      faults.authorizationChange.heldRequests = pending.map((r) => ({ action: r.action, reason: r.reason.slice(0, 240) }));
      for (const r of pending) await api("mission.respond", { requestId: r.id, decision: "allow_once" }).catch((e) => { faults.authorizationChange.answerRefused = e.message.slice(0, 200); });
      await sleep(8000);
      const after = await missionOf(B.missionId);
      faults.authorizationChange.afterOneTimeAnswer = { state: after.state, stillAsking: after.requests.filter((r) => !r.resolvedAt).map((r) => r.reason.slice(0, 200)), writes: after.steps.filter((x) => x.team?.kind === "write_file").map((x) => ({ key: x.team.key, state: x.state })) };
      await api("agent.stop", { id: B.coordinatorId });
      faults.authorizationChange.stoppedAt = Date.now();
      note("team.stopped_after_reduction", { name: B.name });
    } catch (error) { faults.authorizationChange = { ...(faults.authorizationChange ?? {}), error: error.message }; }
  })();

  const [endB, endC] = await Promise.all([until(async () => { const m = await missionOf(B.missionId); return m && ["completed", "failed", "stopped"].includes(m.state) ? m : null; }, "B end", 40 * 60_000, 3000), waitEnd(C)]);
  results.push(await record(B, endB));
  if (endC.state === "waiting_for_user") await api("agent.stop", { id: C.coordinatorId }).catch(() => {});
  results.push(await record(C, await missionOf(C.missionId)));
  const ui3 = await openAgentic("agentic-after-b-c");
  await ui3.page.close();

  // Long run: more distinct team Missions over the project's data, two at a time, until the target duration.
  const ORDER = [4, 5, 2, 6, 7];
  let next = 0;
  const active = new Set();
  const launch = async (spec) => {
    const team = await create(spec);
    await startPlanning(team);
    const review = await waitReview(team);
    if (review.teamView.phase === "review" && review.state === "waiting_for_approval") {
      await api("agent.team.approve", { id: team.coordinatorId, planReference: review.teamView.planReference });
      note("team.approved", { name: team.name });
    } else note("team.planning_held", { name: team.name, state: review.state });
    const end = review.teamView.phase === "review" ? await waitEnd(team) : review;
    if (end.state === "waiting_for_user") { await api("agent.stop", { id: team.coordinatorId }).catch(() => {}); note("team.stopped_held", { name: team.name }); }
    results.push(await record(team, await missionOf(team.missionId)));
  };
  let soloJob = null;
  while (Date.now() - t0 < TARGET_MS && Date.now() - t0 < MAX_MS) {
    while (active.size < 2 && !soloJob && Date.now() - t0 < TARGET_MS) {
      const base = CATALOG[ORDER[next % ORDER.length]];
      // Git-history objectives need the full role set (a separate Documenter): they run alone with default limits.
      const solo = /Git history/.test(base.objective);
      if (solo && active.size) break;
      const spec = { ...base, ...(solo ? {} : { limits: { maxAgents: 3 } }) };
      if (next >= ORDER.length) Object.assign(spec, { slug: `${spec.slug}-${next}`, name: `${spec.name} ${next}`, outputDir: `${spec.outputDir}-${next}` });
      next++;
      const job = launch(spec).catch((error) => note("team.error", { name: spec.name, error: error.message.slice(0, 300) })).finally(() => { active.delete(job); if (soloJob === job) soloJob = null; });
      active.add(job);
      if (solo) soloJob = job;
      await sleep(20000);
    }
    await Promise.race([...active, sleep(30000)]);
  }
  await Promise.all([...active]);

  // Isolated DOM inspection of A's delivered dashboard: offline browser, every network request refused.
  try {
    browser ??= await chromium.launch();
    const context = await browser.newContext({ offline: true });
    const requests = [];
    await context.route("**/*", (route) => { const url = route.request().url(); if (url.startsWith("file:")) return route.continue(); requests.push(url); return route.abort(); });
    const page = await context.newPage();
    await page.goto(`file:///${join(project, A.outputDir, "index.html").replaceAll("\\", "/")}`).catch(() => {});
    const dom = await page.evaluate(() => ({ title: document.title, summary: !!document.getElementById("summary"), text: document.body?.innerText.slice(0, 4000) ?? "" }));
    const datasetNames = ["Widgets", "Gadgets", "Sprockets", "Cables", "Adapters", "Batteries"];
    save("dom-inspection.json", { classification: "LIVE harness-side isolated DOM inspection (offline Chromium, network refused); supplementary to Host verification, not a Host verdict", file: `${A.outputDir}/index.html`, summaryElement: dom.summary, namesRendered: datasetNames.filter((n) => dom.text.includes(n)), blockedRequests: requests, title: dom.title });
    await context.close();
  } catch (error) { save("dom-inspection.json", { error: error.message }); }
} catch (error) {
  fatal = { message: error.message, stack: String(error.stack).slice(0, 2000) };
  note("run.error", { message: error.message });
} finally {
  sampling = false;
  await sampler.catch(() => {});
  try { await browser?.close(); } catch { /* closed */ }
  try { vite?.kill(); } catch { /* gone */ }
  run.endedAt = Date.now(); run.durationMs = run.endedAt - t0;
  try { await new Promise((done) => { const timer = setTimeout(done, 20000); child.once("exit", () => { clearTimeout(timer); done(); }); child.send("close"); }); } catch { /* exited */ }
  // Canonical SQLite evidence, read after the Host closed (read-only).
  try {
    const db = new DatabaseSync(join(data, "host.sqlite"), { readOnly: true });
    const events = db.prepare("SELECT sequence,type,task_id AS taskId,mission_id AS missionId,at,detail FROM events ORDER BY sequence").all();
    const keep = (e) => e.type !== "agent.output";
    save("timeline.json", { classification: "LIVE canonical Host journal (agent.output provider text excluded; counted)", providerOutputEvents: events.filter((e) => !keep(e)).length,
      events: events.filter(keep).map((e) => ({ ...e, detail: e.type.startsWith("agent.") || e.type.startsWith("mission.team.") || e.type === "provider.receipt" ? e.detail.slice(0, 1200) : e.detail.slice(0, 300) })) });
    save("receipts.json", { classification: "LIVE provider receipts from Ollama's own final message (counts and durations are provider-reported; no cost exists for local models)", receipts: events.filter((e) => e.type === "provider.receipt").map((e) => ({ at: e.at, taskId: e.taskId, missionId: e.missionId, ...JSON.parse(e.detail) })) });
    const tasks = db.prepare("SELECT record FROM tasks").all().map((r) => JSON.parse(r.record)).filter((t) => t.mission);
    const steps = db.prepare("SELECT record FROM mission_steps").all().map((r) => JSON.parse(r.record));
    save("model-invocations.json", { invocations: tasks.map((t) => { const st = steps.find((x) => x.id === t.mission.stepId); return { taskId: t.id, missionId: t.mission.missionId, stepKey: st?.team?.key ?? null, kind: st?.team?.kind ?? null, agentId: st?.team?.agentId ?? null, provider: t.provider, model: t.model, state: t.state, createdAt: t.createdAt, access: t.executionScope?.access ?? null }; }) });
    save("routing-decisions.json", { decisions: db.prepare("SELECT task_id, mission_id, created_at, policy_version, decision FROM routing_decisions ORDER BY created_at").all().map((r) => {
      const d = JSON.parse(r.decision);
      return { taskId: r.task_id, missionId: r.mission_id, at: r.created_at, policy: r.policy_version, mode: d.routing_mode, requirements: d.requirements, selected: d.selected, fallbackOrder: d.fallback_order, reroutes: d.reroutes,
        candidates: d.candidates_considered.map((c) => ({ provider: c.provider_id, model: c.model_id || null, eligible: c.eligible, score: c.score, exclusions: c.exclusion_reasons })) };
    }) });
    save("capability-runs.json", { runs: db.prepare("SELECT record FROM capability_runs ORDER BY started_at").all().map((r) => { const x = JSON.parse(r.record); return { id: x.id, missionId: x.missionId, stepId: x.stepId, action: x.action, status: x.status, path: typeof x.params?.path === "string" ? x.params.path : null, startedAt: x.startedAt, finishedAt: x.finishedAt ?? null, outputRef: x.outputRef ?? null }; }) });
    save("handoffs.json", { handoffs: db.prepare("SELECT record FROM mission_handoffs ORDER BY created_at").all().map((r) => JSON.parse(r.record)) });
    save("agents.json", { agents: db.prepare("SELECT record,state FROM agents").all().map((r) => ({ state: r.state, ...JSON.parse(r.record) })), runs: db.prepare("SELECT record FROM agent_runs").all().map((r) => JSON.parse(r.record)) });
    save("checkpoints.json", { count: db.prepare("SELECT count(*) n FROM agent_checkpoints").get().n, checkpoints: db.prepare("SELECT record FROM agent_checkpoints ORDER BY created_at").all().map((r) => { const c = JSON.parse(r.record); return { agentId: c.agentId, runId: c.runId, boundary: c.boundary, at: c.at, revision: c.revision, replaySafety: c.replaySafety, refs: c.refs }; }) });
    save("authorizations.json", { mission: db.prepare("SELECT record FROM mission_authorizations").all().map((r) => { const a = JSON.parse(r.record); return { id: a.id, missionId: a.missionId, grantedBy: a.grantedBy, grantedAt: a.grantedAt, revokedAt: a.revokedAt, expiresAt: a.expiresAt, agentic: a.agentic ?? null, capabilities: a.capabilities }; }),
      agentic: db.prepare("SELECT record FROM agentic_authorizations").all().map((r) => { const e = JSON.parse(r.record); return { id: e.id, missionId: e.mission_id, agentId: e.agent_id, state: e.current_state, revision: e.revision, capabilities: e.permitted_capabilities, planReference: e.plan_reference }; }),
      admissions: db.prepare("SELECT record FROM agentic_admissions").all().map((r) => { const a = JSON.parse(r.record); return { agentId: a.agent_id, missionId: a.mission_id, stepId: a.step_id, capability: a.capability, outcome: a.outcome, revision: a.revision }; }) });
    db.close();
  } catch (error) { save("sqlite-export-error.json", { error: error.message }); }
  try {
    const owned = [];
    for (const kind of ["git-operations", "provider-sessions"]) {
      const folder = join(data, "runtime", kind);
      if (!existsSync(folder)) continue;
      for (const name of readdirSync(folder).filter((n) => n.endsWith(".json"))) {
        const r = JSON.parse(readFileSync(join(folder, name), "utf8"));
        owned.push({ kind, operationId: r.operationId, missionId: r.missionId ?? null, agentId: r.agentId ?? null, taskId: r.taskId ?? null, provider: r.provider ?? null, state: r.state, containment: r.containment ?? null, members: Array.isArray(r.members) ? r.members.length : null, startedAt: r.startedAt, endedAt: r.endedAt ?? null, closed: !!r.closed });
      }
    }
    save("owned-process-records.json", { classification: "LIVE Host-owned process records (Windows job containment); local Ollama generation is HTTP to an independently managed service and owns no process", records: owned });
  } catch (error) { save("owned-process-records.json", { error: error.message }); }
  save("telemetry.json", { classification: "LIVE samples every 15 s (Host pid, system CPU, memory, GPU, loaded Ollama models)", samples: telemetry });
  save("faults.json", faults);
  save("voice-probe.json", voice);
  save("missions.json", { results });
  save("live-run.json", { ...run, fatal, log, hostStderrTail: hostLog.join("").slice(-4000) });
  console.log("LIVE RUN DONE", JSON.stringify({ durationMin: Math.round(run.durationMs / 60000), missions: results.map((r) => `${r.name}:${r.state}`), fatal: fatal?.message ?? null }));
  process.exit(0);
}
