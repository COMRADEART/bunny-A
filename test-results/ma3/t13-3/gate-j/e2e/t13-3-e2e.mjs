// M-A-3 T13.3 Gate J: copied unchanged from gate-i/e2e/t13-3-e2e.mjs.
// M-A-3 T13.3 Gate I end-to-end: one disposable Host, every T13.3 gate in sequence, a paired fixture phone, a real restart.
// Usage: <node> t13-3-e2e.mjs <packageRoot|repoRoot> <out.json> <port>
// With a package root the Host is the package's own runtime and entry (package-host.mjs). No provider is ever asked to
// run: priority is local-only before any Mission exists, the only worker is a skill worker (npm test in a fixture
// Project), and the end checks count every provider dispatch, ledger and usage row. Production (43119/8084) is refused.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const here = resolve(import.meta.dirname);
const [rootArg, outArg, portArg] = process.argv.slice(2);
const root = resolve(rootArg);
const out = resolve(outArg);
const port = Number(portArg);
if (!(port > 1024) || port === 43119 || port === 8084) throw new Error("A disposable port is required.");
const packaged = existsSync(join(root, "release-manifest.json"));
const runtime = packaged ? join(root, "runtime/node.exe") : process.execPath;
const scratch = join(tmpdir(), `bunny-t13-3-e2e-${Date.now()}`);
mkdirSync(scratch, { recursive: true });
const checks = [];
const logs = [];
let host;
let token;
// Assembled at run time and never written to the receipt; the end check proves it reached no state file or log.
const credentialShaped = ["ghp", "_", "E2E", "x".repeat(33)].join("");

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
  host = spawn(runtime, [join(here, "package-host.mjs"), root, scratch, String(port)], { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_OPTIONS: "" } });
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
  const text = await r.text();
  return { status: r.status, body: JSON.parse(text), text };
};
const command = (action, data = {}, bearer = token) => call("/command", { action, data }, bearer);
const state = async (bearer = token) => (await call("/state", null, bearer)).body;
const ok = (r, label) => {
  if (r.status !== 200) throw new Error(`${label}: ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
  return r.body;
};
const slotOf = (s, n) => s.personalAgentContext.slots.find((row) => row.slot === n);
const authorityFacts = (s) => JSON.stringify({
  missions: s.missions.missions.map((m) => [m.id, m.state, m.projectId ?? null]).sort(),
  agents: (s.agents?.agents ?? []).map((a) => [a.id, a.missionId ?? null]).sort(),
  owned: s.personalAgentContext.slots.map((row) => [row.slot, row.owned.map((a) => a.agentId ?? a.id).sort()]),
  foreground: s.personalAgentContext.foreground,
  configRevision: s.personalAgents.revision,
});

const NEW_COMMANDS = [
  "personal_agent.delegate", "personal_agent.assign", "personal_agent.profile", "personal_agent.foreground", "personal_agent.appearance",
  "personal_agent.appearance_reset", "personal_agent.converse", "lotus.remember", "lotus.correct", "lotus.promote", "lotus.forget",
  "lotus.export", "lotus.share", "lotus.recall", "worker.propose", "worker.cancel", "worker.ability.compose", "worker.ability.approve",
  "worker.ability.remove", "harness.test", "harness.disable", "harness.enable", "harness.remove", "scheduler.priority", "scheduler.fairness",
  "routing.learning.propose", "routing.learning.candidate", "routing.learning.shadow", "routing.learning.accept", "routing.learning.reject",
  "routing.learning.rollback", "personalization.preferences", "personalization.feedback", "personalization.feedback.forget",
];
const OWNER_ONLY_KEYS = ["personalAgentContext", "harnesses", "sessionLedger", "scheduler", "routingLearning", "voicePersonalization"];

const receipt = { milestone: "MA3 T13.3 Gate I", purpose: "End-to-end across Gates B-H on one disposable Host", packaged, root: packaged ? "package" : "repository", port, startedAt: new Date().toISOString() };
try {
  await start();
  if (packaged) {
    const manifest = JSON.parse(readFileSync(join(root, "release-manifest.json"), "utf8"));
    receipt.release = { name: manifest.release, version: manifest.version, sourceCommit: manifest.sourceCommit, toolingCommit: manifest.toolingCommit };
    const running = JSON.parse(readFileSync(join(scratch, "host.json"), "utf8"));
    check("E01 packaged runtime and entry", running.node.toLowerCase() === runtime.toLowerCase() && running.entry.startsWith(root), `${running.version}; Host imports the package's own source`);
  } else check("E01 repository Host (rehearsal)", true, "Rehearsal against the repository source with the system Node");

  const initial = await state();
  check("E02 defaults", initial.personalAgents.slots.length === 4 && initial.personalAgentContext.foreground === "bunny" && initial.characterAppearance.slots.every((r) => r.appearance.style === null) && !!initial.harnesses && !!initial.sessionLedger && !!initial.routingLearning, { slots: initial.personalAgents.slots.map((s) => s.weapon), foreground: initial.personalAgentContext.foreground });

  ok(await command("scheduler.priority", { priority: "local_only" }), "local only");
  ok(await command("mission.configure", { enabled: true }), "missions on");
  check("E03 local-only routing before any work", (await state()).scheduler.priority === "local_only", "No cloud provider may be chosen in this run");

  // Gate B: a general-purpose Mission owner.
  const projectPath = join(scratch, "fixture-project");
  mkdirSync(projectPath, { recursive: true });
  writeFileSync(join(projectPath, "package.json"), JSON.stringify({ name: "fixture", private: true, scripts: { test: 'node -e "process.exit(0)"' } }));
  const projectId = ok(await command("project.add", { name: "E2E fixture site", path: projectPath }), "project").data.id;
  const agentId = ok(await command("personal_agent.delegate", { slot: 1, objective: "Prepare the fixture site release", title: "Fixture release", projectId }), "delegate").data.agentId;
  ok(await command("personal_agent.foreground", { identity: 1 }), "foreground");
  ok(await command("personal_agent.profile", { slot: 1, expectRevision: 0, personality: "Calm and precise", goals: ["Ship the fixture site"], preferences: [{ key: "tone", value: "brief" }] }), "profile");
  let s = await state();
  const parentMissionId = s.agents.agents.find((a) => a.id === agentId).missionId;
  const parent = s.missions.missions.find((m) => m.id === parentMissionId);
  check("E04 Gate B ownership and foreground", slotOf(s, 1).owned.some((a) => (a.agentId ?? a.id) === agentId) && s.personalAgentContext.foreground === 1 && parent && !["completed", "verified"].includes(parent.state), { parentState: parent?.state });
  const reply = ok(await command("personal_agent.converse", { slot: 1, text: "Gada, how is the fixture release going?" }), "converse").data.reply.text;
  const firstLine = reply.split("\n")[0];
  check("E05 Gate B reply from Host facts", /^Fixture release: /.test(firstLine) && !/^Fixture release: (completed|done|finished|verified)\b/i.test(firstLine) && /verified by the Host/.test(firstLine), firstLine.slice(0, 160));

  // Gate C: scoped memory with trust ceilings; credentials refused.
  ok(await command("lotus.remember", { scope: "agent:1", key: "Release codename", value: "Kestrel" }), "remember private");
  ok(await command("lotus.remember", { scope: `project:${projectId}`, key: "Test command", value: "The fixture site tests run with npm test" }), "remember project");
  const recall1 = ok(await command("lotus.recall", { slot: 1, query: "release codename" }), "recall").data.lines;
  const recall2 = ok(await command("lotus.recall", { slot: 2, query: "release codename" }), "recall other").data.lines;
  const refusedCredential = await command("lotus.remember", { scope: "agent:1", key: "token", value: `use ${credentialShaped}` });
  check("E06 Gate C private memory, Project scope, credential refusal", recall1.length === 1 && recall2.length === 0 && refusedCredential.status === 400 && /credential/i.test(refusedCredential.body.error), { recall1, recall2: recall2.length, credentialStatus: refusedCredential.status });

  // Gate D: a bounded skill worker as a real child Mission, verified by the Host only.
  const worker = ok(await command("worker.propose", { slot: 1, parentMissionId, ability: "test", objective: "Run the fixture tests", projectId }), "worker").data.worker;
  await until(async () => (await state()).missions.missions.find((m) => m.id === worker.childMissionId)?.state === "waiting_for_approval", "child approval");
  ok(await command("mission.approve", { id: worker.childMissionId, start: true }), "approve child");
  if (packaged) {
    // The package's runtime ships node.exe without the npm CLI, so terminal.exec cannot resolve npm and the step
    // waits for a permission that cannot be granted (limitation L-PKG-NPM). It must fail closed: never VERIFIED.
    await until(async () => (await state()).events.some((event) => event.missionId === worker.childMissionId && event.type === "authorization.required" && /Resolved executable for "npm"/.test(event.detail)), "npm identity refusal");
    ok(await command("worker.cancel", { id: worker.id }), "cancel worker");
  }
  const closed = await until(async () => slotOf(await state(), 1).workers.find((w) => w.id === worker.id && w.state === "CLOSED"), "worker close", 120_000).catch(async (error) => {
    const now = await state();
    const child = ok(await command("mission.get", { id: worker.childMissionId }), "child").data;
    receipt.workerTimeout = {
      worker: slotOf(now, 1).workers.find((w) => w.id === worker.id)?.history.map((h) => [h.state, h.reason]),
      child: { state: child.mission.state, steps: child.mission.steps.map((step) => [step.state, step.result?.summary ?? null]) },
      events: now.events.filter((event) => event.missionId === worker.childMissionId).slice(-12).map((event) => [event.type, String(event.detail).slice(0, 300)]),
    };
    throw error;
  });
  const history = closed.history.map((h) => h.state);
  if (packaged)
    check("E07 Gate D packaged npm worker fails closed (LIMITATION L-PKG-NPM)", closed.result?.verified !== true && !history.includes("VERIFIED") && history.includes("INDETERMINATE") && closed.providers.length === 0 && worker.context.every((line) => !/Kestrel/.test(line)), { history, providers: closed.providers, context: worker.context });
  else
    check("E07 Gate D worker lifecycle", closed.result.verified === true && history.includes("VERIFIED") && closed.providers.length === 0 && worker.context.every((line) => !/Kestrel/.test(line)), { history, providers: closed.providers, context: worker.context });
  // A model worker carries the Project note in its worker record only; it is never approved, so no provider is asked.
  const modelWorker = ok(await command("worker.propose", { slot: 1, parentMissionId, ability: "research", objective: "Summarize the fixture release", projectId }), "model worker").data.worker;
  await until(async () => (await state()).missions.missions.find((m) => m.id === modelWorker.childMissionId)?.state === "waiting_for_approval", "model worker approval");

  // Gate E: harness views over the T13.2 registry; nothing installed or run.
  s = await state();
  const harnessRows = s.harnesses?.harnesses ?? s.harnesses?.rows ?? [];
  check("E08 Gate E harness view", Array.isArray(harnessRows) && harnessRows.length > 0, { harnesses: harnessRows.map((h) => h.id).slice(0, 12) });

  // Gate F: ledger and fairness views; local-only priority held.
  check("E09 Gate F ledger and scheduler", Array.isArray(s.sessionLedger?.sessions ?? s.sessionLedger?.rows ?? []) && s.scheduler.priority === "local_only", { ledgerSessions: (s.sessionLedger?.sessions ?? s.sessionLedger?.rows ?? []).length, priority: s.scheduler.priority });

  // Gate G: no proposal without verified evidence; a voice preference saved and restored.
  const propose = await command("routing.learning.propose");
  ok(await command("personalization.preferences", { preferences: { verbosity: "brief" } }), "verbosity brief");
  const brief = (await state()).voicePersonalization;
  ok(await command("personalization.preferences", { preferences: { verbosity: "normal" } }), "verbosity normal");
  check("E10 Gate G evaluation gate and personalization", propose.status === 400 && JSON.stringify(brief).includes("brief"), { propose: propose.status, error: String(propose.body.error ?? "").slice(0, 120) });

  // Gate H: a style changes nothing else.
  const before = authorityFacts(await state());
  ok(await command("personal_agent.appearance", { slot: 1, appearance: { style: "pixel", intensity: "subtle" } }), "appearance");
  ok(await command("personal_agent.appearance", { slot: 3, appearance: { highContrast: true } }), "appearance contrast");
  s = await state();
  check("E11 Gate H presentation only", authorityFacts(s) === before && s.characterAppearance.slots.find((r) => r.slot === 1).appearance.style === "pixel", "Missions, Agents, ownership, foreground and configuration revision unchanged");

  // Paired fixture phone: supervisory only.
  const code = ok(await command("pairing.create"), "pair code").pairCode;
  const paired = await (await fetch(`http://127.0.0.1:${port}/pair`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, name: "T13.3 E2E fixture phone" }) })).json();
  const phoneState = await call("/state", null, paired.token);
  const leaked = OWNER_ONLY_KEYS.filter((key) => phoneState.body[key] !== undefined);
  const phoneChild = await command("mission.get", { id: modelWorker.childMissionId }, paired.token);
  const phoneApprove = await command("mission.approve", { id: modelWorker.childMissionId, start: true }, paired.token);
  const projectNote = "fixture site tests run with npm test";
  check("E12 phone projection", phoneState.status === 200 && leaked.length === 0 && !!phoneState.body.characterAppearance && !phoneState.text.includes("Kestrel") && !phoneState.text.includes(projectNote) && !phoneChild.text.includes(projectNote) && phoneApprove.body.code === "WORKSTATION_REQUIRED" && modelWorker.context.some((line) => line.includes(projectNote)), { leaked, drawsStyles: !!phoneState.body.characterAppearance, workerMissionGet: phoneChild.status, workerApprove: phoneApprove.body.code });
  const denials = [];
  for (const action of NEW_COMMANDS) {
    const r = await command(action, { slot: 1, appearance: { style: "comic" }, identity: 1, scope: "agent:1", key: "x", value: "y", priority: "fastest" }, paired.token);
    denials.push({ action, status: r.status, code: r.body.code });
  }
  receipt.phoneDenials = denials;
  check("E13 phone refused every T13.3 owner command", denials.every((d) => d.status === 400 && d.code === "WORKSTATION_REQUIRED"), `${denials.filter((d) => d.code === "WORKSTATION_REQUIRED").length}/${denials.length} WORKSTATION_REQUIRED`);
  const afterPhone = await state();
  check("E14 phone attempts changed nothing", authorityFacts(afterPhone) === before && afterPhone.characterAppearance.slots.find((r) => r.slot === 1).appearance.style === "pixel" && afterPhone.scheduler.priority === "local_only", "Same authority facts, style and priority");

  // Restart: everything persists; nothing is completed by the restart.
  const preRestart = await state();
  await stop();
  await start();
  const post = await state();
  const parentAfter = post.missions.missions.find((m) => m.id === parentMissionId);
  check("E15 restart continuity", authorityFacts(post) === authorityFacts(preRestart) && slotOf(post, 1).profile?.personality === "Calm and precise" && slotOf(post, 1).memories.some((m) => m.key === "Release codename") && post.characterAppearance.slots.find((r) => r.slot === 3).appearance.highContrast === true && slotOf(post, 1).workers.some((w) => w.id === worker.id && w.state === "CLOSED"), { parentState: parentAfter?.state, foreground: post.personalAgentContext.foreground });
  check("E16 no false completion after restart", parentAfter && parentAfter.state === parent.state, { before: parent.state, after: parentAfter?.state });
} catch (error) {
  check("E00 run completed", false, String(error?.stack ?? error).slice(0, 1200));
} finally {
  if (host?.exitCode === null) await stop().catch(() => host.kill());
}

// No provider was asked to work; nothing chargeable happened; the credential-shaped text reached no file or log.
try {
  const db = new DatabaseSync(join(scratch, "state/host.sqlite"), { readOnly: true });
  const count = (table) => { try { return db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n; } catch { return null; } };
  const counts = { session_ledger: count("session_ledger"), connection_usage: count("connection_usage"), jev_usage: count("jev_usage"), provider_tasks: count("tasks") };
  db.close();
  receipt.dispatchCounts = counts;
  check("E17 no provider dispatch or chargeable use", counts.session_ledger === 0 && (counts.connection_usage ?? 0) === 0 && (counts.jev_usage ?? 0) === 0 && (counts.provider_tasks ?? 0) === 0, counts);
} catch (error) {
  check("E17 no provider dispatch or chargeable use", false, String(error).slice(0, 300));
}
const files = [];
const walk = (dir) => { for (const name of readdirSync(dir)) { const p = join(dir, name); if (statSync(p).isDirectory()) walk(p); else files.push(p); } };
walk(join(scratch, "state"));
check("E18 credential-shaped text stored nowhere", files.every((p) => !readFileSync(p).includes(Buffer.from(credentialShaped))) && !logs.join("").includes(credentialShaped), `${files.length} state files and the Host log checked`);

receipt.checks = checks;
receipt.result = checks.every((c) => c.ok) ? "PASS" : "FAIL";
receipt.finishedAt = new Date().toISOString();
receipt.installed = false;
receipt.published = false;
writeFileSync(out, JSON.stringify(receipt, null, 2) + "\n");
rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
console.log(`${receipt.result}: ${checks.filter((c) => c.ok).length}/${checks.length}`);
process.exitCode = receipt.result === "PASS" ? 0 : 1;
