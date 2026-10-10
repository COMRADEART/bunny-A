import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostDatabase } from "../bunny-host/persistence.server.ts";
import { ModelCapabilityRegistry } from "../bunny-host/model-capability.server.ts";
import { TaskManager } from "../bunny-host/manager.server.ts";
import { AgentRuntime } from "../bunny-host/agent-runtime.server.ts";
import { providerBase } from "../bunny-host/adapters.server.ts";
import type { AdapterResult, ProviderAdapter } from "../bunny-host/contracts.ts";
import type { OrchTask, ProviderId, ProviderLive } from "../orch/types.ts";
import { MissionManager, DEVICE_ANSWER_TTL_MS } from "./manager.server.ts";
import { missionCommand } from "./commands.server.ts";
import { FilesystemCapability, NotificationsCapability, TerminalCapability } from "./capabilities/local.server.ts";
import { desktopGrantViolation, providerSessionAuthority, remoteSessionViolation, DESKTOP_GRANT_TTL_MS, capabilityOperation, type DesktopGrantContext } from "./authorization.server.ts";
import type { DesktopGrant } from "./types.ts";

/**
 * M-A-3 T9R-F02 scope intersection (D3) and provider/model independence. A paired device's one-time answer is judged
 * against the owner's current Agent consent, the Mission envelope, its lifetime and the Host generation; narrowing,
 * Stop, restart, expiry and forged bindings all end it. Every case drives the real MissionManager / AgentRuntime /
 * TaskManager / commands boundary. Base F01 provider cases live in remote-authority.test.ts (see notes in the report).
 */
const PHONE = "device:f02-phone";
const APPROVAL = /Approval required on Windows Host/;
const NARROWED = /outside the Agent's current permissions/;

const until = async (check: () => boolean, label: string, timeout = 15000) => {
  const start = Date.now();
  while (!check()) { if (Date.now() - start > timeout) throw new Error(`Timed out waiting for ${label}`); await new Promise((r) => setTimeout(r, 10)); }
};
const settle = () => new Promise((r) => setTimeout(r, 80));

function ready(id: ProviderId): ProviderLive {
  return { ...providerBase(id), installed: true, authenticated: true, availability: "ready", capabilities: id === "ollama" ? ["text"] : ["filesystem", "terminal", "text"], current_model: id === "ollama" ? "test-local" : null };
}
type Launched = { task: OrchTask; finish: (result: AdapterResult) => void };
function fakeAdapter(id: ProviderId, launched: Launched[]): ProviderAdapter {
  return { id, detect: async () => ready(id), launch: (task) => {
    let finish!: (result: AdapterResult) => void; const done = new Promise<AdapterResult>((resolve) => (finish = resolve));
    launched.push({ task, finish });
    return { done, stop: async () => finish({ ok: false, output: "", stopped: true }) };
  } };
}

type Stack = { db: HostDatabase; tasks: TaskManager; missions: MissionManager; agents: AgentRuntime };
async function openStack(dir: string, root: string, providers: ProviderId[], launched: Launched[], hold: { on: boolean }): Promise<Stack> {
  const db = new HostDatabase(join(dir, "host.sqlite"));
  const tasks = new TaskManager(db, root, providers.map((id) => fakeAdapter(id, launched)), { modelRegistry: new ModelCapabilityRegistry(db, { availableProviders: () => [] }) });
  await tasks.discover();
  const missions = new MissionManager(tasks, { dataDirectory: dir, adapters: [new FilesystemCapability(), new TerminalCapability(), new NotificationsCapability(() => {})] });
  missions.configure({ enabled: true }, "workstation");
  await missions.bus.refreshHealth();
  const agents = new AgentRuntime(db, missions);
  // Admission holds while `hold.on`: a device answer can be given and then judged after the owner's change.
  missions.missionPauseGate = (id) => hold.on || agents.blockedForMission(id);
  return { db, tasks, missions, agents };
}

async function setup(options: { providers?: ProviderId[] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "f02-scope-"));
  const root = join(dir, "project"); mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "seed.txt"), "seed");
  const launched: Launched[] = [];
  const providers = options.providers ?? [];
  const hold = { on: false };
  let current = await openStack(dir, root, providers, launched, hold);
  const env = {
    dir, root, hold, launched,
    get db() { return current.db; }, get tasks() { return current.tasks; }, get missions() { return current.missions; }, get agents() { return current.agents; },
    /** A real Host restart over the same state: new managers, new generation. */
    restart: async () => { current.agents.close(); await current.missions.close(); current.db.close(); current = await openStack(dir, root, providers, launched, hold); },
    cleanup: async () => {
      for (const session of launched) session.finish({ ok: false, output: "", stopped: true });
      await settle(); hold.on = false;
      current.agents.close(); await current.missions.close(); try { current.db.close(); } catch { /* closed */ }
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    },
  };
  return env;
}
type Env = Awaited<ReturnType<typeof setup>>;

const readStep = (path = "seed.txt") => ({ role: "Read", objective: "Read the seed", access: "read", dependsOn: [], executor: { kind: "capability", action: "filesystem.read", params: { path } } });
const writeStep = (path: string, content: string) => ({ role: "Write", objective: `Write ${path}`, access: "write", dependsOn: [], executor: { kind: "capability", action: "filesystem.write", params: { path, content, overwrite: true } }, verification: [{ kind: "file_exists", path, contains: content }] });
const phoneRespond = (env: Env, requestId: string, decision: "allow_once" | "allow_batch" | "deny", actor = PHONE) =>
  missionCommand(env.missions, "mission.respond", { requestId, decision }, { local: false, actor });
const pending = (env: Env, missionId: string) => env.missions.store.requests(missionId).find((request) => !request.resolvedAt);
async function waitAsk(env: Env, missionId: string, action: string, notId?: string) {
  await until(() => { const p = pending(env, missionId); return !!p && p.action === action && p.id !== notId; }, `${action} ask`);
  return pending(env, missionId)!;
}
const readOrNull = (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : null);
const grantWrites = (env: Env) => env.missions.store.setGrant("filesystem.write", "global", "ask_every_time", "workstation");

/** An Agent Mission with the owner's real agentic consent, started by the workstation. */
function createAgent(env: Env, steps: unknown[], name = "F02 agent") {
  // create() returns the whole snapshot; the new Agent is the one not listed before.
  const known = new Set(env.agents.snapshot().agents.map((agent) => agent.id));
  const row = env.agents.create({ name, objective: "Write and read disposable project files", steps }, "workstation").agents.find((agent) => !known.has(agent.id))!;
  assert.ok(row?.missionId, "the new Agent has a Mission");
  return { agentId: row.id, missionId: row.missionId!, consent: () => env.missions.agentic.forMission(row.missionId!)! };
}
function beginAgent(env: Env, a: ReturnType<typeof createAgent>) {
  env.missions.proposeAgentAuthorization(a.agentId, { maximumActions: 20 });
  env.agents.start(a.agentId, "workstation", a.consent().revision);
  return a;
}
function startAgent(env: Env, steps: unknown[], name = "F02 agent") {
  return beginAgent(env, createAgent(env, steps, name));
}

// ── E16 / E37 / E39: owner narrowing and Stop ─────────────────────────────────────────────────────────────────────

test("F02-E16a: narrowing after a write ask was offered refuses the device's allow_once and writes nothing", async () => {
  const env = await setup();
  try {
    grantWrites(env);
    const a = startAgent(env, [readStep(), writeStep("note.md", "from phone")]);
    const ask = await waitAsk(env, a.missionId, "filesystem.write");
    const before = a.consent();
    assert.ok(before.permitted_capabilities.includes("filesystem.write"), "consent keeps write before narrowing");
    env.missions.adjustAgentAuthorization(a.missionId, before.revision, { capabilities: ["filesystem.read"] });
    assert.equal(a.consent().revision, before.revision + 1);
    // The superseded offer is closed by the Host: the device cannot answer it any more.
    await assert.rejects(phoneRespond(env, ask.id, "allow_once"), /already answered|no longer waiting/);
    // The re-asked offer is outside the narrowed Agent: a paired device cannot widen it.
    const fresh = await waitAsk(env, a.missionId, "filesystem.write", ask.id);
    await assert.rejects(phoneRespond(env, fresh.id, "allow_once"), NARROWED);
    await settle();
    assert.equal(readOrNull(join(env.root, "note.md")), null, "nothing written");
    assert.deepEqual(env.missions.staging.forMission(a.missionId), [], "nothing staged");
  } finally { await env.cleanup(); }
});

test("F02-E16b: narrowing after the device answered but before execution stamps the answer and the step re-asks", async () => {
  const env = await setup();
  try {
    grantWrites(env);
    const a = startAgent(env, [readStep(), writeStep("note.md", "from phone")]);
    const ask = await waitAsk(env, a.missionId, "filesystem.write");
    env.hold.on = true;
    await phoneRespond(env, ask.id, "allow_once");
    assert.equal(env.missions.store.request(ask.id).resolvedBy, PHONE);
    const before = a.consent();
    env.missions.adjustAgentAuthorization(a.missionId, before.revision, { capabilities: ["filesystem.read"] });
    assert.equal(env.missions.store.request(ask.id).lifecycle?.state, "INVALIDATED_BY_SCOPE_CHANGE", "the held answer is ended by narrowing");
    env.hold.on = false;
    env.missions.schedule(a.missionId);
    const fresh = await waitAsk(env, a.missionId, "filesystem.write", ask.id);
    await assert.rejects(phoneRespond(env, fresh.id, "allow_once"), NARROWED);
    await settle();
    assert.equal(readOrNull(join(env.root, "note.md")), null, "the stale answer never wrote");
    assert.equal(env.missions.store.request(ask.id).lifecycle?.state, "INVALIDATED_BY_SCOPE_CHANGE", "lifecycle is first-stamp-wins");
  } finally { await env.cleanup(); }
});

test("F02-E37: a device answer and an immediate owner narrowing in the same tick leave nothing written", async () => {
  const env = await setup();
  try {
    grantWrites(env);
    const a = startAgent(env, [writeStep("note.md", "same tick")]);
    const ask = await waitAsk(env, a.missionId, "filesystem.write");
    env.hold.on = true;
    // Answer and narrow back to back, with no scheduling tick in between.
    const answered = phoneRespond(env, ask.id, "allow_once");
    await answered;
    env.missions.adjustAgentAuthorization(a.missionId, a.consent().revision, { capabilities: [] });
    env.hold.on = false;
    env.missions.schedule(a.missionId);
    await until(() => env.missions.store.request(ask.id).lifecycle?.state === "INVALIDATED_BY_SCOPE_CHANGE", "answer ended by narrowing");
    await settle();
    assert.equal(readOrNull(join(env.root, "note.md")), null, "nothing written after same-tick narrowing");
    assert.deepEqual(env.missions.staging.forMission(a.missionId), []);
    assert.notEqual(env.missions.mission(a.missionId).state, "completed");
  } finally { await env.cleanup(); }
});

test("F02-E39a: Stop before admission blocks a device-answered write; nothing is written", async () => {
  const env = await setup();
  try {
    grantWrites(env);
    const a = startAgent(env, [writeStep("note.md", "after stop")]);
    const ask = await waitAsk(env, a.missionId, "filesystem.write");
    env.hold.on = true;
    await phoneRespond(env, ask.id, "allow_once");
    await env.agents.stop(a.agentId, "workstation");
    env.hold.on = false;
    env.missions.schedule(a.missionId);
    await settle();
    assert.equal(env.agents.snapshot([a.agentId]).agents[0].state, "STOPPED");
    assert.equal(readOrNull(join(env.root, "note.md")), null, "a stopped Agent never admits the answered write");
    assert.deepEqual(env.missions.staging.forMission(a.missionId), []);
  } finally { await env.cleanup(); }
});

test("F02-E39b: Stop after a device answer was staged withdraws the staged change; the project is untouched", async () => {
  const env = await setup();
  try {
    grantWrites(env);
    const a = startAgent(env, [writeStep("note.md", "withdrawn")]);
    const ask = await waitAsk(env, a.missionId, "filesystem.write");
    await phoneRespond(env, ask.id, "allow_once");
    await until(() => env.missions.staging.forMission(a.missionId).some((r) => r.promotionState === "STAGED"), "staged");
    await env.agents.stop(a.agentId, "workstation");
    await until(() => env.missions.staging.forMission(a.missionId).every((r) => r.promotionState !== "STAGED"), "withdrawn");
    assert.equal(env.missions.staging.forMission(a.missionId)[0].promotionState, "WITHDRAWN");
    await settle();
    assert.equal(readOrNull(join(env.root, "note.md")), null);
    assert.equal(env.missions.store.requests(a.missionId).filter((r) => r.action === "filesystem.promote" && !r.resolvedAt).length, 0, "no promotion stays open");
  } finally { await env.cleanup(); }
});

// ── E17 / E18: in-scope legit path, out-of-envelope refusal ──────────────────────────────────────────────────────

test("F02-E17a: an in-scope write with no ask rule runs under consent alone, with no device involvement", async () => {
  const env = await setup();
  try {
    const a = startAgent(env, [writeStep("note.md", "consent only")]);
    await until(() => env.missions.mission(a.missionId).state === "completed", "consent-only write completed");
    assert.equal(readOrNull(join(env.root, "note.md")), "consent only");
    assert.equal(env.missions.store.requests(a.missionId).length, 0, "no ask was needed");
  } finally { await env.cleanup(); }
});

test("F02-E17: a current in-scope device one-time approval still works: staged, then promoted by the workstation", async () => {
  const env = await setup();
  try {
    grantWrites(env);
    const a = startAgent(env, [writeStep("note.md", "from phone")]);
    assert.ok(a.consent().permitted_capabilities.includes("filesystem.write"), "consent keeps write");
    const ask = await waitAsk(env, a.missionId, "filesystem.write");
    await phoneRespond(env, ask.id, "allow_once");
    await until(() => env.missions.staging.forMission(a.missionId).some((r) => r.promotionState === "STAGED"), "staged");
    assert.equal(readOrNull(join(env.root, "note.md")), null, "project untouched while staged");
    const promote = await waitAsk(env, a.missionId, "filesystem.promote");
    assert.equal(promote.desktopRequired, true);
    await assert.rejects(phoneRespond(env, promote.id, "allow_once"), APPROVAL);
    await env.missions.respond(promote.id, "allow_once", "workstation");
    await until(() => env.missions.mission(a.missionId).state === "completed", "completed after promotion");
    assert.equal(readOrNull(join(env.root, "note.md")), "from phone");
    assert.equal(env.missions.staging.forMission(a.missionId)[0].promotionState, "PROMOTED");
  } finally { await env.cleanup(); }
});

test("F02-E18: a device one-time approval for a path outside the Mission write roots is refused", async () => {
  const env = await setup();
  try {
    grantWrites(env);
    const outside = join(env.dir, "outside", "escape.md");
    mkdirSync(join(env.dir, "outside"));
    const a = startAgent(env, [writeStep(outside, "escape")]);
    // The out-of-roots write is held as an ask the Agent's consent does not cover; the device cannot widen it.
    const ask = await waitAsk(env, a.missionId, "filesystem.write");
    await assert.rejects(phoneRespond(env, ask.id, "allow_once"), NARROWED);
    await settle();
    assert.equal(readOrNull(outside), null, "nothing outside the roots was written");
    assert.deepEqual(env.missions.staging.forMission(a.missionId), []);
  } finally { await env.cleanup(); }
});

// ── E19 / E20 / E21: forged bindings and request ids never transfer authority ────────────────────────────────────

test("F02-E19: a device cannot answer another Agent's offer through a forged binding; its own answer never transfers", async () => {
  const env = await setup();
  try {
    grantWrites(env);
    const a = createAgent(env, [writeStep("a.md", "agent A")], "agent A");
    const b = createAgent(env, [writeStep("b.md", "agent B")], "agent B");
    beginAgent(env, a); beginAgent(env, b);
    const askA = await waitAsk(env, a.missionId, "filesystem.write");
    const askB = await waitAsk(env, b.missionId, "filesystem.write");
    // Forged binding: extra keys naming the other Agent/Mission are refused for a paired device.
    await assert.rejects(missionCommand(env.missions, "mission.respond", { requestId: askB.id, decision: "allow_once", missionId: a.missionId, agentId: a.agentId }, { local: false, actor: PHONE }));
    // A legitimate answer to A acts only on A's exact offer.
    await phoneRespond(env, askA.id, "allow_once");
    await until(() => env.missions.staging.forMission(a.missionId).length === 1, "A staged");
    assert.ok(!env.missions.store.request(askB.id).resolvedAt, "B's offer is still open");
    assert.ok(!env.missions.store.step(askB.stepId).approvedOnce, "B has no one-time answer");
    assert.deepEqual(env.missions.staging.forMission(b.missionId), [], "B stages nothing");
    assert.equal(readOrNull(join(env.root, "b.md")), null);
  } finally { await env.cleanup(); }
});

test("F02-E20: a device answer to a plain Mission's offer never transfers to an Agent Mission", async () => {
  const env = await setup();
  try {
    grantWrites(env);
    const a = startAgent(env, [writeStep("agent.md", "agent")]);
    const askA = await waitAsk(env, a.missionId, "filesystem.write");
    const plain = env.missions.create({ objective: "Plain write", mode: "fast", origin: "workstation", steps: [{ role: "Write", objective: "plain", dependsOn: [], executor: { kind: "capability", action: "filesystem.write", params: { path: "plain.md", content: "plain", overwrite: true } } }] });
    await missionCommand(env.missions, "mission.approve", { id: plain.id, start: true }, { local: false, actor: PHONE });
    const askP = await waitAsk(env, plain.id, "filesystem.write");
    // The plain Mission's exact offer is answerable by the device, and only that offer is acted on.
    await phoneRespond(env, askP.id, "allow_once");
    await until(() => env.missions.staging.forMission(plain.id).length === 1, "plain staged");
    assert.ok(!env.missions.store.request(askA.id).resolvedAt, "the Agent's offer stays open");
    assert.ok(!env.missions.store.step(askA.stepId).approvedOnce, "the Agent step holds no transferred answer");
    assert.deepEqual(env.missions.staging.forMission(a.missionId), []);
    assert.equal(readOrNull(join(env.root, "agent.md")), null);
  } finally { await env.cleanup(); }
});

test("F02-E21: a device cannot retarget an answer to another project root; the staged destination stays in the Mission project", async () => {
  const env = await setup();
  try {
    grantWrites(env);
    const other = join(env.dir, "other-project"); mkdirSync(other);
    const a = startAgent(env, [writeStep("note.md", "scoped")]);
    const ask = await waitAsk(env, a.missionId, "filesystem.write");
    await assert.rejects(missionCommand(env.missions, "mission.respond", { requestId: ask.id, decision: "allow_once", cwd: other, roots: [other], root: other }, { local: false, actor: PHONE }));
    await phoneRespond(env, ask.id, "allow_once");
    await until(() => env.missions.staging.forMission(a.missionId).length === 1, "staged");
    const record = env.missions.staging.forMission(a.missionId)[0];
    assert.ok(record.destination.startsWith(env.root), "destination remains the Mission project");
    assert.equal(readOrNull(join(other, "note.md")), null);
  } finally { await env.cleanup(); }
});

// ── E22 / E23 / E24: stale revision, Host generation and lifetime ───────────────────────────────────────────────

test("F02-E22: a device answer carrying a stale authorization revision is refused", async () => {
  const env = await setup();
  try {
    grantWrites(env);
    const a = startAgent(env, [writeStep("note.md", "stale")]);
    const ask = await waitAsk(env, a.missionId, "filesystem.write");
    const current = a.consent().revision;
    assert.ok(current >= 1 && ask.agentic);
    env.missions.store.saveRequest({ ...ask, agentic: { ...ask.agentic!, revision: current - 1 } });
    await assert.rejects(phoneRespond(env, ask.id, "allow_once"), APPROVAL);
    await settle();
    assert.equal(readOrNull(join(env.root, "note.md")), null);
    assert.ok(!env.missions.store.request(ask.id).resolvedAt, "the refused answer leaves the offer open");
  } finally { await env.cleanup(); }
});

test("F02-E23a: a Host restart invalidates a pending device offer; the device cannot answer it afterwards", async () => {
  const env = await setup();
  try {
    grantWrites(env);
    const a = startAgent(env, [writeStep("note.md", "restart")]);
    const ask = await waitAsk(env, a.missionId, "filesystem.write");
    await env.restart();
    const old = env.missions.store.request(ask.id);
    assert.ok(old.resolvedAt, "the pre-restart offer is closed");
    assert.match(old.resolvedBy ?? "", /bunny-host-restart/);
    await assert.rejects(phoneRespond(env, ask.id, "allow_once"), /already answered|no longer waiting|not waiting/);
    await settle();
    assert.equal(readOrNull(join(env.root, "note.md")), null);
  } finally { await env.cleanup(); }
});

test("F02-E23b: a device answer held across a Host restart is stamped INVALIDATED_BY_HOST_RESTART and never executes", async () => {
  const env = await setup();
  try {
    grantWrites(env);
    const a = startAgent(env, [writeStep("note.md", "held")]);
    const ask = await waitAsk(env, a.missionId, "filesystem.write");
    env.hold.on = true;
    await phoneRespond(env, ask.id, "allow_once");
    await env.restart();
    assert.equal(env.missions.store.request(ask.id).lifecycle?.state, "INVALIDATED_BY_HOST_RESTART");
    env.hold.on = false;
    env.missions.schedule(a.missionId);
    await settle();
    assert.equal(readOrNull(join(env.root, "note.md")), null, "the pre-restart answer never wrote");
  } finally { await env.cleanup(); }
});

test("F02-E24a: an expired device answer is ended as EXPIRED before the step runs, and the step re-asks", async () => {
  const env = await setup();
  try {
    grantWrites(env);
    const a = startAgent(env, [writeStep("note.md", "late")]);
    const ask = await waitAsk(env, a.missionId, "filesystem.write");
    env.hold.on = true;
    await phoneRespond(env, ask.id, "allow_once");
    const answered = env.missions.store.request(ask.id);
    env.missions.store.saveRequest({ ...answered, resolvedAt: Date.now() - DEVICE_ANSWER_TTL_MS - 1000 });
    env.hold.on = false;
    env.missions.schedule(a.missionId);
    await until(() => env.missions.store.request(ask.id).lifecycle?.state === "EXPIRED", "answer expired");
    const fresh = await waitAsk(env, a.missionId, "filesystem.write", ask.id);
    await settle();
    assert.equal(readOrNull(join(env.root, "note.md")), null, "the expired answer never wrote");
    assert.notEqual(fresh.id, ask.id);
  } finally { await env.cleanup(); }
});

test("F02-E24b: a trusted-desktop grant past its lifetime is refused for the exact operation", () => {
  const operation = capabilityOperation("terminal.exec", { command: "node", args: ["probe.mjs"] }, "C:/p", { file: "C:/node.exe", prefix: [], display: "node" });
  const context: DesktopGrantContext = { hostId: "host-a", epoch: "epoch-1", missionId: "m1", agentId: null, stepId: "s1", taskId: null, planReference: "plan-1", authorizationId: "env-1", operation, mutationSequence: 7, now: 1_000 };
  const { now: _now, ...bindings } = context;
  const grant: DesktopGrant = { id: "g", requestId: "r", ...bindings, grantedBy: "workstation", grantedAt: 900, expiresAt: 900 + DESKTOP_GRANT_TTL_MS, maxUses: 1, uses: 0, revokedAt: null };
  assert.equal(desktopGrantViolation(grant, context), null, "inside its lifetime it is valid");
  assert.match(desktopGrantViolation(grant, { ...context, now: 900 + DESKTOP_GRANT_TTL_MS + 1 }) ?? "", /expired|lifetime/i);
});

// ── E25: a consumed one-time answer cannot be reused ────────────────────────────────────────────────────────────

test("F02-E25: after the device-answered write completes its request is CONSUMED and the step holds no one-time answer", async () => {
  const env = await setup();
  try {
    grantWrites(env);
    const a = startAgent(env, [writeStep("note.md", "once")]);
    const ask = await waitAsk(env, a.missionId, "filesystem.write");
    await phoneRespond(env, ask.id, "allow_once");
    const promote = await waitAsk(env, a.missionId, "filesystem.promote");
    await env.missions.respond(promote.id, "allow_once", "workstation");
    await until(() => env.missions.mission(a.missionId).state === "completed", "completed");
    const step = env.missions.store.step(ask.stepId);
    assert.ok(!step.approvedOnce, "the spent answer is cleared");
    assert.equal(env.missions.store.request(promote.id).lifecycle?.state, "CONSUMED", "the promotion answer is spent with the change");
    assert.equal(env.missions.store.request(promote.id).resolution, "allow_once");
    assert.equal(env.missions.store.requests(a.missionId).filter((r) => r.action === "filesystem.write" && !r.resolvedAt).length, 0);
  } finally { await env.cleanup(); }
});

// ── E40 / E41 / E42 / E43 / E44: provider and model independence (combined with one-time answers) ───────────────

const modelStep = (role: string, objective: string, access: "read" | "write") => ({ role, objective, dependsOn: [], access, maxRetries: 0, executor: { kind: "model" } });

test("F02-E40: a device one-time answer cannot authorize shell through a Claude write, and no Codex route is reachable from it", async () => {
  const env = await setup({ providers: ["claude", "codex"] });
  try {
    const view = env.missions.create({ objective: "Edit", mode: "fast", origin: "workstation", steps: [modelStep("Coder", "Edit", "write")] });
    await missionCommand(env.missions, "mission.approve", { id: view.id, start: true }, { local: false, actor: PHONE });
    const ask = await waitAsk(env, view.id, "provider.execute");
    const child = env.tasks.db.get(env.missions.store.step(ask.stepId).taskId!);
    for (const provider of ["codex", "claude"] as ProviderId[]) assert.match(env.tasks.missionScopeCheck!({ ...child, provider }) ?? "", APPROVAL, `${provider} shell write is refused for the device`);
    await assert.rejects(phoneRespond(env, ask.id, "allow_once"), APPROVAL);
    await settle();
    assert.deepEqual(env.launched.map((l) => l.task.provider), [], "no provider session launched");
    assert.equal(providerSessionAuthority("codex", "write"), "shell", "Codex write is shell authority");
  } finally { await env.cleanup(); }
});

test("F02-E41: a device one-time answer to a terminal command or code execution is refused even inside an approved Mission", async () => {
  const env = await setup();
  try {
    const view = env.missions.create({ objective: "Run tests", mode: "fast", origin: "workstation", steps: [{ role: "Check", objective: "node check", dependsOn: [], executor: { kind: "capability", action: "terminal.exec", params: { command: "node", args: ["seed.txt"] } } }] });
    await missionCommand(env.missions, "mission.approve", { id: view.id, start: true }, { local: false, actor: PHONE });
    const ask = await waitAsk(env, view.id, "terminal.exec");
    await assert.rejects(phoneRespond(env, ask.id, "allow_once"), APPROVAL);
    await settle();
    assert.equal(env.missions.store.step(ask.stepId).approvedOnce, null);
    assert.equal(env.missions.mission(view.id).state !== "completed", true);
  } finally { await env.cleanup(); }
});

test("F02-E42: a tool-free Ollama step cannot be rerouted into shell: the device answer is refused for a Claude route", async () => {
  const env = await setup({ providers: ["ollama", "claude"] });
  try {
    const view = env.missions.create({ objective: "Summarize locally", mode: "fast", origin: "workstation", localOnly: true, steps: [modelStep("Writer", "Summarize", "read")] });
    await missionCommand(env.missions, "mission.approve", { id: view.id, start: true }, { local: false, actor: PHONE });
    await until(() => env.launched.length === 1, "ollama launch");
    const child = env.launched[0].task;
    assert.equal(child.provider, "ollama");
    assert.equal(env.tasks.missionScopeCheck!(child), null, "tool-free inference stays inside remote authority");
    assert.equal(env.tasks.missionScopeCheck!({ ...child, provider: "claude", model: "auto" }, "launch"), null, "a Claude read reroute keeps only the Read tool");
    assert.match(env.tasks.missionScopeCheck!({ ...child, provider: "claude", model: "auto", executionScope: { access: "write" } }, "launch") ?? "", APPROVAL, "a Claude write reroute needs the workstation");
    env.launched[0].finish({ ok: true, output: "Summary." });
    await until(() => env.missions.mission(view.id).state === "completed", "local read completed");
    assert.equal(env.launched.length, 1, "no Claude or Codex session was started from the device route");
  } finally { await env.cleanup(); }
});

test("F02-E43: a specialized or local model name cannot increase permissions; unknown providers fail closed", () => {
  for (const provider of ["abliterated", "uncensored-local", "unknown", "", null]) {
    assert.equal(providerSessionAuthority(provider, "write"), null, `${String(provider)} has no session authority`);
    assert.equal(providerSessionAuthority(provider, "read"), null);
  }
  const remoteEnvelope = { grantedBy: PHONE, authority: { kind: "remote", sessionCeiling: ["tool_free", "read_tools"] }, providers: [] } as unknown as Parameters<typeof remoteSessionViolation>[1];
  assert.equal(remoteSessionViolation({ provider: "ollama", executionScope: { access: "write" } }, remoteEnvelope), null, "the tool-free ceiling still admits Ollama");
  assert.ok(remoteSessionViolation({ provider: "abliterated", executionScope: { access: "write" } }, remoteEnvelope), "an unknown model cannot run under remote authority");
  assert.ok(remoteSessionViolation({ provider: "abliterated", executionScope: { access: "read" } }, remoteEnvelope), "a local model name is not read authority either");
});

test("F02-E44: a provider reroute after a device-approved read does not carry that answer into a write", async () => {
  const env = await setup({ providers: ["ollama", "claude"] });
  try {
    const view = env.missions.create({ objective: "Read then edit", mode: "fast", origin: "workstation", steps: [modelStep("Writer", "Read", "read")] });
    await missionCommand(env.missions, "mission.approve", { id: view.id, start: true }, { local: false, actor: PHONE });
    await until(() => env.launched.length === 1, "read launch");
    env.launched[0].finish({ ok: false, output: "failed", exitCode: 1 });
    await settle();
    const write = env.missions.create({ objective: "Edit", mode: "fast", origin: "workstation", steps: [modelStep("Coder", "Edit", "write")] });
    await missionCommand(env.missions, "mission.approve", { id: write.id, start: true }, { local: false, actor: PHONE });
    const ask = await waitAsk(env, write.id, "provider.execute");
    const child = env.tasks.db.get(env.missions.store.step(ask.stepId).taskId!);
    assert.match(env.tasks.missionScopeCheck!({ ...child, provider: "claude" }) ?? "", APPROVAL, "the reroute to Claude write is judged afresh and refused");
    await assert.rejects(phoneRespond(env, ask.id, "allow_once"), APPROVAL);
    await settle();
    assert.ok(!env.launched.some((l) => l.task.provider === "claude" && l.task.executionScope?.access === "write"), "no Claude write session started");
  } finally { await env.cleanup(); }
});
