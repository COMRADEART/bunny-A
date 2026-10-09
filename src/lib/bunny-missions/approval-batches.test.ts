import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostDatabase } from "../bunny-host/persistence.server.ts";
import { TaskManager } from "../bunny-host/manager.server.ts";
import { providerBase } from "../bunny-host/adapters.server.ts";
import type { AdapterHooks, AdapterResult, ProviderAdapter } from "../bunny-host/contracts.ts";
import type { OrchTask, ProviderId, ProviderLive } from "../orch/types.ts";
import { MissionManager } from "./manager.server.ts";
import { MissionStore } from "./store.server.ts";
import { missionCommand } from "./commands.server.ts";
import { FilesystemCapability, GitCapability, NotificationsCapability, TerminalCapability } from "./capabilities/local.server.ts";
import { BrowserCapability } from "./capabilities/browser.server.ts";
import { communicationConnectors } from "./capabilities/connectors.server.ts";
import type { CapabilityAdapter } from "./capabilities/bus.server.ts";
import { consultBatch, extractObservedPid, rotateBatchEpochForTest, riskAtMost, operationDigest } from "./batches.server.ts";
import { simulatedCodexProfile } from "../bunny-host/testing/codex.test.ts";
import type { ActionManifest, ApprovalBatch, AuthorizationEnvelope, CapabilityManifest, MissionView, PermissionRequest, RiskClass } from "./types.ts";

// ── the same conventions as missions.test.ts ─────────────────────────────────
function ready(id: ProviderId): ProviderLive {
  return { ...providerBase(id), installed: true, authenticated: true, availability: "ready", capabilities: ["filesystem", "terminal", "text"], current_model: "test-local", ...(id === "codex" ? { securityCompatibility: simulatedCodexProfile() } : {}) };
}
type Launched = { task: OrchTask; finish: (result: AdapterResult) => void; hooks: AdapterHooks; stopped: boolean };
function fakeAdapter(id: ProviderId, launched: Launched[]): ProviderAdapter {
  return { id, detect: async () => ready(id), launch: (task, hooks) => {
    let finish!: (result: AdapterResult) => void; const done = new Promise<AdapterResult>((resolve) => (finish = resolve));
    const session: Launched = { task, finish, hooks, stopped: false }; launched.push(session);
    return { done, stop: async () => { session.stopped = true; finish({ ok: false, output: "", stopped: true }); } };
  } };
}
const until = async (check: () => boolean, label: string, timeout = 4000) => {
  const start = Date.now();
  while (!check()) { if (Date.now() - start > timeout) throw new Error(`Timed out waiting for ${label}`); await new Promise((resolve) => setTimeout(resolve, 10)); }
};

// ── a fake Computer Capability whose outputs follow the real structured shapes ──
const actionManifest = (id: string, risk: RiskClass, extra: Partial<ActionManifest> = {}): ActionManifest =>
  ({ id, description: "", risk, inputs: [], outputs: "", evidence: "", timeoutMs: 1000, implemented: true, ...extra });
const COMPUTER_ACTIONS: ActionManifest[] = [
  actionManifest("computer.list_windows", "READ"),
  actionManifest("computer.read_calculator", "READ"),
  actionManifest("computer.read_controls", "READ", { sensitive: true }),
  actionManifest("computer.focus_window", "EXECUTE"),
  actionManifest("computer.invoke_control", "EXECUTE"),
  actionManifest("computer.type", "EXECUTE"),
  actionManifest("computer.capture", "READ", { sensitive: true }),
  actionManifest("computer.open_app", "EXECUTE"),
];
type World = { owner: Map<string, number>; contentPid: Map<string, number>; launchers: Map<string, number>; unique: number; executed: { action: string; params: Record<string, unknown> }[] };
function fakeComputer(world: World): CapabilityAdapter {
  const manifest: CapabilityManifest = { id: "computer", version: "1.0.0", description: "fake desktop", locality: "local", platforms: "any", events: [], cost: { kind: "local_compute", note: "" }, adapter: "fake", actions: COMPUTER_ACTIONS };
  const result = (ok: boolean, status: "succeeded" | "failed" | "unsupported", summary: string, output: unknown) => ({ ok, status, summary, output, evidence: [] });
  return {
    manifest,
    health: async () => ({ availability: "available", detail: "" }),
    prepareBatchAction: async (action, params, batch) => {
      if (action === "computer.open_app") return null;
      const owner = params.pid !== undefined ? Number(params.pid) : world.owner.get(String(params.title).toLowerCase());
      if (owner !== 4242) throw new Error("Foreign application");
      const identity = { handle: "123", processId: owner, processStartedAt: "123456789" };
      if (batch.windowIdentity && JSON.stringify(batch.windowIdentity) !== JSON.stringify(identity)) throw new Error("Window drift");
      return identity;
    },
    execute: async (action, params) => {
      world.executed.push({ action, params });
      const title = String(params.title ?? "");
      // Known titles map to their window-owner pid; unknown titles resolve to distinct fresh pids
      // (drift probes); open_app reports a launcher pid different from any window owner.
      const owner = params.pid !== undefined ? Number(params.pid) : world.owner.get(title.toLowerCase()) ?? 9990 + (world.unique += 1);
      switch (action) {
        case "computer.open_app": return result(true, "succeeded", "started", { pid: world.launchers.get(String(params.app)) ?? 1000 + (world.unique += 1), file: `fake-${String(params.app)}.exe`, newWindows: 1 });
        case "computer.focus_window": return result(true, "succeeded", "focused", { before: "old", after: title, target: { name: title, processId: owner }, focused: true });
        // The real outputs carry the matched top-level window's owning pid (windowPid) plus the
        // element's own process; on UWP hosts those differ (frame process vs content process).
        case "computer.invoke_control": return result(true, "succeeded", "invoked", { control: { name: params.name, processId: world.contentPid.get(title.toLowerCase()) ?? owner }, pattern: "invoke", windowPid: owner });
        case "computer.type": return result(true, "succeeded", "typed", { control: { name: params.name, processId: world.contentPid.get(title.toLowerCase()) ?? owner }, beforeLength: 0, afterLength: String(params.text ?? "").length, matches: true, windowPid: owner });
        case "computer.read_calculator": return result(true, "succeeded", "result", { windowPid: owner, result: "Display is 89" });
        case "computer.read_controls": return result(true, "succeeded", "read", { window: { name: title, processId: owner }, controls: [] });
        case "computer.list_windows": return result(true, "succeeded", "listed", { windows: [{ name: title, processId: owner }], foreground: { name: title, processId: owner } });
        case "computer.capture": return result(true, "succeeded", "captured", { path: "x.png", width: 1, height: 1 });
        default: return result(false, "unsupported", "unsupported", null);
      }
    },
  };
}
function makeWorld(): World {
  return { owner: new Map([["calculator", 4242], ["notepad", 5151]]), contentPid: new Map(), launchers: new Map([["calculator", 1000], ["notepad", 1001]]), unique: 0, executed: [] };
}
async function setup(world = makeWorld()) {
  const dir = mkdtempSync(join(tmpdir(), "bunny-batch-"));
  const root = join(dir, "project"); mkdirSync(root, { recursive: true }); writeFileSync(join(root, "readme.txt"), "hello");
  const db = new HostDatabase(join(dir, "host.sqlite"));
  const launched: Launched[] = [];
  const tasks = new TaskManager(db, root, [fakeAdapter("claude", launched)]);
  await tasks.discover();
  const adapters: CapabilityAdapter[] = [
    new FilesystemCapability(), new TerminalCapability(), new GitCapability(dir),
    new NotificationsCapability(() => {}), new BrowserCapability(join(dir, "browser")), ...communicationConnectors(), fakeComputer(world),
  ];
  const missions = new MissionManager(tasks, { dataDirectory: dir, adapters });
  missions.configure({ enabled: true }, "test");
  await missions.bus.refreshHealth();
  const cleanup = async () => { await missions.close(); try { db.close(); } catch { /* already closed */ } rmSync(dir, { recursive: true, force: true }); };
  return { dir, root, db, missions, launched, world, cleanup };
}
const desktopStep = (role: string, action: string, params: Record<string, unknown>, dependsOn: number[] = []) =>
  ({ role, objective: `${role}: ${action}`, dependsOn, executor: { kind: "capability", action, params } });
const calculatorFlow = () => [
  desktopStep("Launcher", "computer.open_app", { app: "calculator" }),
  desktopStep("Focus", "computer.focus_window", { title: "Calculator" }, [0]),
  desktopStep("Type 8", "computer.invoke_control", { title: "Calculator", automationId: "num8Button" }, [1]),
  desktopStep("Type 9", "computer.invoke_control", { title: "Calculator", automationId: "num9Button" }, [2]),
];
type Env = Awaited<ReturnType<typeof setup>>;
const envelopeOf = (env: Env, missionId: string): AuthorizationEnvelope => env.missions.store.authorization(env.missions.store.mission(missionId).authorizationId!)!;
const batchRow = (env: Env, missionId: string): ApprovalBatch => env.missions.store.batches(missionId)[0];
const unresolved = (env: Env, missionId: string): PermissionRequest => env.missions.store.requests(missionId).find((request) => !request.resolvedAt)!;
const events = (env: Env, missionId: string) => env.missions.get(missionId).events;
const eventTypes = (env: Env, missionId: string) => events(env, missionId).map((event) => event.type);
const plannedStepIds = (env: Env, missionId: string) => env.missions.store.steps(missionId).map((step) => step.id);
const decisionProbe = (env: Env, missionId: string, action: string, params: Record<string, unknown>, stepId: string | null, envelope: AuthorizationEnvelope | null) =>
  env.missions.bus.decision({ action, params, missionId, stepId, envelope, origin: "test", cwd: env.root, roots: [env.root] });
/** Approve the first open desktop ask with a small batch. */
async function grantBatch(env: Env, missionId: string, options: { maxActions?: number; ttlMs?: number } = {}) {
  await until(() => env.missions.store.requests(missionId).some((request) => !request.resolvedAt), "first permission request");
  const request = unresolved(env, missionId);
  const view: MissionView = await env.missions.respond(request.id, "allow_batch", "workstation", options);
  return { request, view };
}
/** A mission whose last step targets a foreign pid: the batch stays live while that step waits. */
const pausedBatchMission = (env: Env, objective: string) => {
  const view = env.missions.create({ objective, mode: "fast", origin: "workstation", steps: [
    desktopStep("Launcher", "computer.open_app", { app: "calculator" }),
    desktopStep("Focus", "computer.focus_window", { title: "Calculator" }, [0]),
    desktopStep("Type 8", "computer.invoke_control", { title: "Calculator", automationId: "num8Button" }, [1]),
    desktopStep("Foreign", "computer.type", { title: "Calculator", name: "foreign", text: "7", pid: 987 }, [2]),
  ] });
  env.missions.approve(view.id, "workstation");
  return view;
};

// ── Gate T9: bounded desktop approval batching ───────────────────────────────
test("T9 single-action invariant: one desktop action keeps plain Allow once, no batch row ever exists", async () => {
  const env = await setup();
  try {
    const view = env.missions.create({ objective: "One desktop action", mode: "fast", origin: "workstation", steps: [desktopStep("Focus", "computer.focus_window", { title: "Calculator" })] });
    assert.equal(view.requestedScope?.computer.enabled, true);
    env.missions.approve(view.id, "workstation");
    await until(() => env.missions.store.requests(view.id).length === 1, "the ask");
    const request = env.missions.store.requests(view.id)[0];
    assert.equal(request.batchOffer, null, "a plan with fewer than two mutating executions offers no batch");
    await env.missions.respond(request.id, "allow_once", "workstation");
    assert.equal(env.missions.store.steps(view.id)[0].approvedOnce?.action, "computer.focus_window", "today's one-time semantics are untouched");
    await until(() => env.missions.mission(view.id).state === "completed", "completion");
    assert.equal(env.missions.store.batches(view.id).length, 0, "no batch exists");
  } finally { await env.cleanup(); }
});

test("T9 positive example: one approval finishes a whole bounded Calculator sequence — offer shape, counts, ordering", async () => {
  const env = await setup();
  try {
    const steps = [
      ...calculatorFlow(),
      desktopStep("Type 3", "computer.invoke_control", { title: "Calculator", automationId: "num3Button" }, [3]),
      desktopStep("Result", "computer.read_calculator", { title: "Calculator" }, [4]),
    ];
    const view = env.missions.create({ objective: "Bounded Calculator run", mode: "fast", origin: "workstation", steps });
    assert.equal(view.requestedScope?.computer.enabled, true);
    env.missions.approve(view.id, "workstation");
    await until(() => env.missions.store.requests(view.id).length === 1, "first ask");
    const request = env.missions.store.requests(view.id)[0];
    assert.equal(request.action, "computer.open_app");
    const offer = request.batchOffer!;
    assert.ok(offer, "five mutating executions in the plan → a batch is offered");
    assert.deepEqual(offer.actions, ["computer.focus_window", "computer.invoke_control", "computer.open_app", "computer.read_calculator"]);
    assert.deepEqual(offer.readOnly, ["computer.read_calculator"], "read-only entries are covered but never counted");
    assert.equal(offer.counts["computer.invoke_control"], 3);
    assert.equal(offer.maxActions, 10, "min(2 × 5 mutating executions, 12)");
    assert.equal(offer.ttlMs, 120_000);
    assert.deepEqual(offer.target, { app: "calculator", processId: null, title: null });
    assert.equal(offer.targetTier, "app");
    assert.equal(offer.targetLabel, "Calculator");
    const { view: grantedView } = await grantBatch(env, view.id);
    assert.equal(grantedView.batch?.usedCount, 0, "the snapshot's batch is canonical and starts empty");
    assert.equal(grantedView.batch?.targetLabel, "Calculator");
    assert.equal(grantedView.batch?.status, "active");
    await until(() => env.missions.mission(view.id).state === "completed", "the whole sequence on one approval", 8000);
    const stored = batchRow(env, view.id);
    assert.equal(stored.usedCount, 5, "open + focus + three types; the read-only lister never consumed");
    assert.equal(stored.status, "ended");
    assert.equal(stored.endReason, "mission_ended");
    assert.equal(env.missions.store.requests(view.id).length, 1, "exactly one prompt for the whole flow");
    assert.ok(grantedView.steps.every((step) => step.approvedOnce === null), "allow_batch never rides the one-time path");
    assert.equal(env.launched.length, 0, "no provider was involved; nothing about verification changed");
    const types = eventTypes(env, view.id);
    assert.equal(types.filter((type) => type === "approval.batch_started").length, 1);
    assert.equal(types.filter((type) => type === "approval.batch_consumed").length, 5);
    const started = events(env, view.id).find((event) => event.type === "approval.batch_started")!;
    assert.match(started.detail, /within 2 min/, "the journal states the truthful 2-minute ttl (seconds never mislabeled as minutes)");
    assert.ok(events(env, view.id).find((event) => event.type === "approval.batch_ended")!.at >= started.at, "no consumption happens after the batch ends");
    assert.ok(!types.includes("approval.batch_exhausted"), "the sequence fit inside the budget");
  } finally { await env.cleanup(); }
});

test("T9 sensitive never covered: read_controls excluded from the offer and asks again; a password control is never admitted", async () => {
  const env = await setup();
  try {
    const view = env.missions.create({ objective: "Sensitive probe", mode: "fast", origin: "workstation", steps: [
      desktopStep("Launcher", "computer.open_app", { app: "calculator" }),
      desktopStep("Focus", "computer.focus_window", { title: "Calculator" }, [0]),
      desktopStep("Read controls", "computer.read_controls", { title: "Calculator" }, [1]),
    ] });
    env.missions.approve(view.id, "workstation");
    await until(() => env.missions.store.requests(view.id).length === 1, "first ask");
    const first = env.missions.store.requests(view.id)[0];
    assert.ok(!first.batchOffer!.actions.includes("computer.read_controls"), "sensitive reads are outside the offer");
    await env.missions.respond(first.id, "allow_batch", "workstation");
    await until(() => env.missions.store.requests(view.id).length === 2, "the sensitive read asked again on its own");
    const second = unresolved(env, view.id);
    assert.equal(second.action, "computer.read_controls");
    assert.equal(second.batchOffer, null, "sensitive asks never carry a batch button");
    assert.equal(batchRow(env, view.id).status, "active");
    assert.equal(batchRow(env, view.id).usedCount, 2, "only the two mutating actions consumed");
    await env.missions.respond(second.id, "deny", "workstation");
    await until(() => env.missions.mission(view.id).state === "failed", "deny ends the mission");
    assert.equal(batchRow(env, view.id).endReason, "mission_ended");

    const probeView = env.missions.create({ objective: "Secret target", mode: "fast", origin: "workstation", steps: [
      desktopStep("Launcher", "computer.open_app", { app: "notepad" }),
      desktopStep("Type name", "computer.type", { title: "Notepad", name: "Name box", text: "x" }, [0]),
      desktopStep("Type password", "computer.type", { title: "Notepad", name: "Password field", text: "hunter2" }, [1]),
    ] });
    env.missions.approve(probeView.id, "workstation");
    await until(() => env.missions.store.requests(probeView.id).length === 1, "the notepad ask");
    assert.equal(unresolved(env, probeView.id).batchOffer, null, "unverified apps and arbitrary typing have no batch offer");
    await assert.rejects(grantBatch(env, probeView.id), /does not offer/);
    assert.equal(env.world.executed.length, 2, "no ordinary or secret Notepad input executed");
  } finally { await env.cleanup(); }
});

test("T9 consult boundary: exact operations, own steps, pid, risk ceiling and envelope guards", () => {
  const now = Date.now();
  const action = "computer.focus_window";
  const params = { title: "Calculator" };
  const env = { id: "e1", missionId: "m1", expiresAt: now + 60_000, revokedAt: null, computer: { enabled: true }, capabilities: [action] } as AuthorizationEnvelope;
  const batch = { id: "b1", missionId: "m1", authorizationId: "e1", family: "computer", actions: [action], riskCeiling: "EXECUTE", target: { app: "calculator", processId: null, title: null }, maxActions: 5, usedCount: 1, batchEpoch: "boot", status: "active", expiresAt: now + 60_000, operations: [{ stepId: "s1", digest: operationDigest(action, params) }] } as ApprovalBatch;
  const consult = (over: Partial<ApprovalBatch> = {}, envelope: AuthorizationEnvelope = env, opts: { params?: Record<string, unknown>; risk?: RiskClass; stepId?: string; epoch?: string } = {}) => consultBatch({ ...batch, ...over }, { action, params: opts.params ?? params, manifest: COMPUTER_ACTIONS.find((m) => m.id === action)!, risk: opts.risk ?? "EXECUTE", envelope, now, stepIds: new Set(["s1", "s2"]), stepId: opts.stepId ?? "s1", epoch: opts.epoch ?? "boot" });
  assert.equal(consult()?.match, true);
  assert.equal(consult({}, env, { stepId: "s2" })?.match, false, "even another planned step cannot reuse the operation");
  assert.equal(consult({}, env, { stepId: "delegated" })?.match, false);
  assert.equal(consult({}, env, { params: { title: "Calculator help" } })?.match, false);
  assert.equal(consult({}, env, { params: { pid: 999 } })?.match, false);
  assert.equal(consult({}, env, { risk: "DESTRUCTIVE" })?.match, false);
  assert.equal(consult({ riskCeiling: "READ" })?.match, false);
  assert.equal(consult({ usedCount: 5 })?.match, false);
  assert.equal(consult({}, { ...env, missionId: "other" })?.match, false);
  assert.equal(consult({}, { ...env, revokedAt: now })?.match, false);
  assert.equal(consult({}, { ...env, expiresAt: now - 1 })?.match, false);
  assert.equal(consult({}, { ...env, capabilities: [], computer: { enabled: false } })?.match, false);
  assert.equal(consult({ status: "ended" }), null);
  assert.equal(consult({ expiresAt: now - 1 }), null);
  assert.equal(consult({}, env, { epoch: "new" }), null);
  assert.equal(consult({ operations: undefined })?.match, false, "old loose grants fail closed");
  const pidParams = { pid: 4242 };
  const pinned = consult({ observedPid: 4242, observedPidFrom: "params", operations: [{ stepId: "s1", digest: operationDigest(action, pidParams) }] }, env, { params: pidParams });
  assert.equal(pinned?.match, true);
  assert.equal(pinned?.consume, true);
});

test("T9 admission guards: count boundary, epoch, expiry and end state are all enforced atomically; risk lattice holds", async () => {
  const env = await setup();
  try {
    const store: MissionStore = env.missions.store;
    const base = (over: Partial<ApprovalBatch> = {}): ApprovalBatch => ({ id: "b1", missionId: "m1", authorizationId: "a1", family: "computer", actions: ["computer.type"], riskCeiling: "EXECUTE", target: { app: null, processId: 42, title: null }, targetTier: "process", maxActions: 2, usedCount: 0, observedPid: null, observedPidFrom: "params", batchEpoch: "boot-e1", createdAt: 1, createdBy: "test", expiresAt: Date.now() + 60_000, status: "active", endAt: null, endReason: null, endBy: null, originStepId: "s1", ...over });
    store.saveBatch(base());
    const first = store.consumeBatch("b1", "boot-e1", Date.now());
    assert.ok(first.ok && first.usedCount === 1);
    const boundary = store.consumeBatch("b1", "boot-e1", Date.now());
    assert.ok(boundary.ok && boundary.usedCount === 2);
    const beyond = store.consumeBatch("b1", "boot-e1", Date.now());
    assert.ok(!beyond.ok, "no off-by-one: exactly maxActions admissions succeed, one more is refused");
    store.saveBatch(base({ id: "b2", usedCount: 0 }));
    assert.ok(!store.consumeBatch("b2", "stale-boot", Date.now()).ok, "a stale process epoch is refused");
    store.saveBatch(base({ id: "b3", usedCount: 0, expiresAt: Date.now() - 1 }));
    assert.ok(!store.consumeBatch("b3", "boot-e1", Date.now()).ok, "expiry is enforced at admission");
    assert.ok(!store.consumeBatch("b4", "boot-e1", Date.now()).ok, "an unknown batch is refused");
    store.saveBatch(base({ id: "b5", usedCount: 0, status: "ended", endReason: "revoked" }));
    assert.ok(!store.consumeBatch("b5", "boot-e1", Date.now()).ok, "an ended batch is refused");
    assert.ok(riskAtMost("READ", "EXECUTE") && riskAtMost("WRITE", "EXECUTE") && riskAtMost("EXECUTE", "EXECUTE"));
    assert.ok(!riskAtMost("EXTERNAL_SIDE_EFFECT", "EXECUTE") && !riskAtMost("DESTRUCTIVE", "EXECUTE"));
  } finally { await env.cleanup(); }
});

test("T9 exhaustion: a shrunk budget ends the batch with an event and re-prompts; nothing slips past", async () => {
  const env = await setup();
  try {
    const view = env.missions.create({ objective: "Too small", mode: "fast", origin: "workstation", steps: calculatorFlow() });
    env.missions.approve(view.id, "workstation");
    await grantBatch(env, view.id, { maxActions: 1, ttlMs: 60_000 });
    await until(() => env.missions.store.requests(view.id).length === 2, "a fresh ask after exhaustion");
    const ended = batchRow(env, view.id);
    assert.equal(ended.status, "ended");
    assert.equal(ended.endReason, "exhausted");
    assert.equal(ended.usedCount, 1);
    assert.ok(eventTypes(env, view.id).includes("approval.batch_exhausted"));
    const second = unresolved(env, view.id);
    assert.equal(second.action, "computer.focus_window", "the paused step asks on its own");
    assert.equal(env.world.executed.filter((run) => run.action === "computer.focus_window").length, 0, "nothing ran outside approval");
    await env.missions.respond(second.id, "deny", "workstation");
    await until(() => env.missions.mission(view.id).state === "failed", "deny fails the mission");
  } finally { await env.cleanup(); }
});

test("T9 expiry: a lapsed batch admits nothing, and the UI shows it ended without a silent revive", async () => {
  const env = await setup();
  try {
    const view = pausedBatchMission(env, "Expiry probe");
    const { view: grantedView } = await grantBatch(env, view.id);
    await until(() => env.missions.store.requests(view.id).length === 2, "the foreign-pid step holds the mission with a live batch");
    assert.equal(grantedView.batch?.usedCount, 0, "the batch starts empty in the respond snapshot");
    assert.deepEqual([batchRow(env, view.id).status, batchRow(env, view.id).usedCount, batchRow(env, view.id).endReason], ["active", 3, null], "open + focus + one type consumed");
    const envelope = envelopeOf(env, view.id);
    const stepIds = plannedStepIds(env, view.id);
    const before = batchRow(env, view.id);
    const probe = () => decisionProbe(env, view.id, "computer.invoke_control", { title: "Calculator", automationId: "num8Button" }, stepIds[2], envelope);
    assert.equal(probe().decision, "allow", "still covered for a planned step while live");
    assert.equal(batchRow(env, view.id).usedCount, 3, "a permission probe alone consumes nothing");
    env.missions.store.saveBatch({ ...before, expiresAt: Date.now() - 1 });
    assert.equal(probe().decision, "ask", "the Host clock lapsed the batch; it rescues nothing");
    const panel = env.missions.view(env.missions.mission(view.id));
    assert.equal(panel.batch?.status, "ended");
    assert.equal(panel.batch?.endReason, "expired", "the display tells the truth: ended, expired — not active");
    const second = unresolved(env, view.id);
    assert.equal(second.action, "computer.type");
    await env.missions.respond(second.id, "deny", "workstation");
    await until(() => env.missions.mission(view.id).state === "failed", "deny fails the mission");
    assert.equal(env.world.executed.filter((run) => run.params.pid === 987).length, 0, "the foreign window was never touched");
  } finally { await env.cleanup(); }
});

test("T9 scope escapes fail closed with a live batch: foreign pid, other app, shell, browser, files, sensitive probes", async () => {
  const env = await setup();
  try {
    const view = pausedBatchMission(env, "Calculator only");
    const { view: grantedView } = await grantBatch(env, view.id);
    await until(() => env.missions.store.requests(view.id).length === 2, "mission paused with a live batch");
    assert.equal(grantedView.batch?.status, "active");
    assert.equal(env.missions.mission(view.id).state, "waiting_for_user");
    const envelope = envelopeOf(env, view.id);
    const stepIds = plannedStepIds(env, view.id);
    const decisionFor = (action: string, params: Record<string, unknown>, stepId = stepIds[0]) => decisionProbe(env, view.id, action, params, stepId, envelope).decision;
    assert.equal(decisionProbe(env, view.id, "computer.invoke_control", { title: "Calculator", automationId: "num8Button" }, stepIds[2], envelope).decision, "allow", "a planned step stays covered (positive control)");
    assert.equal(decisionFor("computer.focus_window", { title: "Calculator" }, stepIds[1]), "allow");
    assert.equal(decisionFor("computer.focus_window", { pid: 987 }), "ask", "another window's explicit pid asks");
    assert.equal(decisionFor("computer.focus_window", { title: "Chrome" }), "ask", "another application's window asks");
    assert.equal(decisionFor("terminal.exec", { command: "npm", args: ["test"] }), "ask", "the shell is structurally outside every batch");
    assert.equal(decisionFor("browser.navigate", { url: "https://example.com" }), "ask", "the Bunny browser is outside desktop batches");
    assert.equal(decisionFor("filesystem.write", { path: "x.txt", content: "y" }), "ask", "files are outside desktop batches");
    assert.equal(decisionFor("git.status", {}), "ask", "git is outside desktop batches");
    assert.equal(decisionFor("computer.capture", {}), "ask", "sensitive capture asks even mid-batch");
    assert.equal(decisionFor("computer.type", { title: "Notepad", name: "doc", text: "x" }), "ask", "another app's field asks");
    assert.equal(decisionProbe(env, view.id, "computer.type", { title: "Calculator", name: "delegated", text: "1" }, "delegated-child-step-id-not-planned", envelope).decision, "ask", "a delegated child step id is never covered");
    assert.equal(batchRow(env, view.id).usedCount, 3, "decisions never consume — only admission at execution does");
    assert.equal(env.launched.length, 0, "no provider was involved");
    const second = unresolved(env, view.id);
    await env.missions.respond(second.id, "deny", "workstation");
    await until(() => env.missions.mission(view.id).state === "failed", "deny fails the mission");
    assert.equal(env.world.executed.filter((run) => run.action === "computer.type" && run.params.name === "foreign").length, 0, "the refused request never executed");
  } finally { await env.cleanup(); }
});

test("T9 window drift: a title lookalike asks before any foreign mutation", async () => {
  const env = await setup();
  try {
    const view = env.missions.create({ objective: "Drift probe", mode: "fast", origin: "workstation", steps: [
      desktopStep("Launcher", "computer.open_app", { app: "calculator" }),
      desktopStep("Focus", "computer.focus_window", { title: "Calculator" }, [0]),
      desktopStep("Type 7", "computer.invoke_control", { title: "Calculator", automationId: "num7Button" }, [1]),
      desktopStep("Lookalike", "computer.type", { title: "Calculator help consent", name: "continue", text: "x" }, [2]),
      desktopStep("After", "computer.invoke_control", { title: "Calculator", automationId: "num8Button" }, [3]),
    ] });
    env.missions.approve(view.id, "workstation");
    const { request } = await grantBatch(env, view.id);
    assert.equal(request.action, "computer.open_app");
    await until(() => env.missions.store.requests(view.id).length === 2, "drift asks before execution");
    const stored = batchRow(env, view.id);
    assert.equal(stored.endReason, null, "the foreign action asks without touching the window");
    assert.equal(stored.usedCount, 3, "only open, focus and the approved digit executed");
    assert.equal(stored.observedPid, 4242, "the batch is pinned to Calculator's real window owner");
    assert.equal(env.world.executed.filter((r) => r.params.title === "Calculator help consent").length, 0, "foreign window never touched");
    await until(() => env.missions.store.requests(view.id).length >= 2, "a fresh ask for the next step");
    const after = unresolved(env, view.id);
    assert.equal(after.action, "computer.type", "the next planned step asks for fresh approval — no silent continuation");
    await env.missions.respond(after.id, "deny", "workstation");
    await until(() => env.missions.mission(view.id).state === "failed", "denied");
  } finally { await env.cleanup(); }
});

test("T9 observed pid: the declared windowPid is the window owner a batch binds to, ahead of control element pids", () => {
  // The live UWP reality (review packet): Calculator's top-level window is owned by the frame
  // process (34640) while its buttons report a content process (51388).
  assert.equal(extractObservedPid({ control: { name: "Five", processId: 51388 }, pattern: "invoke", windowPid: 34640 }), 34640, "the declared window owner outranks the control element's pid");
  assert.equal(extractObservedPid({ control: { processId: 51388 }, pattern: "invoke" }), 51388, "an output without windowPid falls back to the element's pid");
  assert.equal(extractObservedPid({ target: { name: "Calculator", processId: 34640 }, focused: true }), 34640, "focus still reports the window owner");
  assert.equal(extractObservedPid({ windows: [{ processId: 1 }, { name: "Other", processId: 2 }], foreground: "" }), null, "a window list has no single observed owner");
  assert.equal(extractObservedPid({ windowPid: 0 }), null, "a non-positive pid binds nothing");
  assert.equal(extractObservedPid(null), null);
});

test("T9 UWP reality: control elements in a content process never end the batch while the window owner holds", async () => {
  const env = await setup();
  try {
    env.world.contentPid.set("calculator", 7788);
    const view = env.missions.create({ objective: "UWP content process", mode: "fast", origin: "workstation", steps: [
      ...calculatorFlow(),
      desktopStep("Type 3", "computer.invoke_control", { title: "Calculator", automationId: "num3Button" }, [3]),
    ] });
    env.missions.approve(view.id, "workstation");
    await grantBatch(env, view.id);
    await until(() => env.missions.mission(view.id).state === "completed", "the whole sequence under one batch", 8000);
    const stored = batchRow(env, view.id);
    assert.equal(stored.status, "ended");
    assert.equal(stored.endReason, "mission_ended", "divergent control pids alone never end a batch");
    assert.equal(stored.usedCount, 5);
    assert.equal(stored.observedPid, 4242, "the batch is pinned to the window owner, not a content process");
    assert.ok(!eventTypes(env, view.id).includes("approval.batch_scope_mismatch"));
    assert.equal(env.missions.store.requests(view.id).length, 1, "one approval ran the flow");
  } finally { await env.cleanup(); }
});

test("T9 UWP drift: divergent content pids do not authorize a title lookalike", async () => {
  const env = await setup();
  try {
    env.world.contentPid.set("calculator", 7788);
    const view = env.missions.create({ objective: "UWP drift", mode: "fast", origin: "workstation", steps: [
      desktopStep("Launcher", "computer.open_app", { app: "calculator" }),
      desktopStep("Focus", "computer.focus_window", { title: "Calculator" }, [0]),
      desktopStep("Type 7", "computer.invoke_control", { title: "Calculator", automationId: "num7Button" }, [1]),
      desktopStep("Lookalike", "computer.type", { title: "Calculator help consent", name: "continue", text: "x" }, [2]),
      desktopStep("After", "computer.invoke_control", { title: "Calculator", automationId: "num8Button" }, [3]),
    ] });
    env.missions.approve(view.id, "workstation");
    await grantBatch(env, view.id);
    await until(() => env.missions.store.requests(view.id).length === 2, "drift asks before execution");
    const stored = batchRow(env, view.id);
    assert.equal(stored.endReason, null, "the foreign action asks without touching the window");
    assert.equal(stored.observedPid, 4242);
    assert.equal(env.world.executed.filter((r) => r.params.title === "Calculator help consent").length, 0, "foreign window never touched");
    await until(() => env.missions.store.requests(view.id).length >= 2, "the next step asks fresh");
    await env.missions.respond(unresolved(env, view.id).id, "deny", "workstation");
    await until(() => env.missions.mission(view.id).state === "failed", "denied");
  } finally { await env.cleanup(); }
});

test("T9 mission boundary: another mission, even for the same app and the same user, inherits nothing", async () => {
  const env = await setup();
  try {
    const a = env.missions.create({ objective: "A", mode: "fast", origin: "workstation", steps: calculatorFlow() });
    const b = env.missions.create({ objective: "B", mode: "fast", origin: "workstation", steps: [desktopStep("Launcher", "computer.open_app", { app: "calculator" })] });
    env.missions.approve(a.id, "workstation"); env.missions.approve(b.id, "workstation");
    await grantBatch(env, a.id);
    await until(() => env.missions.store.requests(b.id).length === 1, "mission B asked on its own");
    assert.equal(env.missions.store.requests(b.id)[0].action, "computer.open_app", "no rescue from A's batch");
    await until(() => (batchRow(env, a.id)?.usedCount ?? 0) >= 1, "A's flow consumed under its own batch");
    assert.ok(batchRow(env, a.id).usedCount >= 1, "A's batch was busy with its own flow");
    const usedBefore = batchRow(env, a.id).usedCount;
    const probe = decisionProbe(env, b.id, "computer.open_app", { app: "calculator" }, plannedStepIds(env, b.id)[0], envelopeOf(env, b.id));
    assert.equal(probe.decision, "ask", "the identical action on the same app is not rescued across missions");
    assert.equal(env.missions.store.requests(b.id).length, 1, "still just its own ask");
    assert.equal(batchRow(env, a.id).usedCount, usedBefore, "B's decision probe never touched A's budget");
    await env.missions.respond(env.missions.store.requests(b.id)[0].id, "allow_once", "workstation");
    await until(() => env.missions.mission(b.id).state === "completed", "B completed");
  } finally { await env.cleanup(); }
});

test("T9 stop: ending a mission ends its batch; the concurrent mission's batch and paused work survive untouched", async () => {
  const env = await setup();
  try {
    const a = pausedBatchMission(env, "A");
    const b = pausedBatchMission(env, "B survives");
    await grantBatch(env, a.id);
    await grantBatch(env, b.id);
    await until(() => env.missions.store.requests(a.id).length === 2 && env.missions.store.requests(b.id).length === 2, "both missions paused with live batches");
    await env.missions.stop(a.id, "workstation");
    assert.equal(batchRow(env, a.id).endReason, "mission_ended", "Stop ends A's batch");
    assert.equal(batchRow(env, a.id).status, "ended");
    assert.ok(eventTypes(env, a.id).includes("approval.batch_ended"));
    assert.equal(batchRow(env, b.id).status, "active", "B's batch survived");
    assert.equal(env.missions.mission(b.id).state, "waiting_for_user", "B's paused step is untouched");
    const envelopeB = envelopeOf(env, b.id);
    const stepIdsB = plannedStepIds(env, b.id);
    assert.equal(decisionProbe(env, b.id, "computer.focus_window", { title: "Calculator" }, stepIdsB[1], envelopeB).decision, "allow", "B's batch still covers B's plan");
    await env.missions.stop(b.id, "workstation");
    assert.equal(batchRow(env, b.id).endReason, "mission_ended");
  } finally { await env.cleanup(); }
});

test("T9 restart: every batch fails closed twice — the boot epoch refuses immediately and recovery sweeps the rows", async () => {
  const env = await setup();
  try {
    const view = pausedBatchMission(env, "Restart probe");
    await grantBatch(env, view.id);
    await until(() => env.missions.store.requests(view.id).length === 2, "live batch paused");
    assert.equal(env.missions.view(env.missions.mission(view.id)).batch?.status, "active");
    const stepIds = plannedStepIds(env, view.id);
    const envelope = envelopeOf(env, view.id);
    const alive = () => decisionProbe(env, view.id, "computer.focus_window", { title: "Calculator" }, stepIds[1], envelope);
    rotateBatchEpochForTest();
    assert.equal(alive().decision, "ask", "a new Host boot's epoch refuses the old batch at once, even before any sweep");
    env.missions.recover();
    assert.equal(batchRow(env, view.id).endReason, "host_restart", "the recovery sweep also cleared the row");
    assert.ok(eventTypes(env, view.id).includes("approval.batch_ended"));
    assert.equal(env.missions.view(env.missions.mission(view.id)).batch, null, "the UI shows no active batch after a restart");
  } finally { await env.cleanup(); }
});

test("T10-XG-13: Host restart invalidates a pending request; explicit retry creates a fresh decision", async () => {
  const env = await setup();
  try {
    const view = pausedBatchMission(env, "Pending approval across restart");
    await grantBatch(env, view.id);
    await until(() => env.missions.store.requests(view.id).length === 2, "separate pending request");
    const old = unresolved(env, view.id), before = env.world.executed.length;
    env.missions.recover();
    assert.equal(env.missions.store.request(old.id).resolvedBy, "bunny-host-restart");
    assert.equal(env.missions.store.request(old.id).resolution, "deny");
    await assert.rejects(env.missions.respond(old.id, "allow_once", "workstation"), /already answered/);
    assert.equal(env.world.executed.length, before);
    assert.equal(env.missions.mission(view.id).state, "waiting_for_user");
    env.missions.retry(view.id, "workstation");
    await until(() => env.missions.store.requests(view.id).some(request => !request.resolvedAt), "fresh request after explicit retry");
    assert.notEqual(unresolved(env, view.id).id, old.id);
    assert.equal(env.world.executed.length, before, "retry never reuses the old permission");
  } finally { await env.cleanup(); }
});

test("T10-XG-05: restart discards a one-time decision that has not begun GUI execution", async () => {
  const env = await setup();
  try {
    const view = pausedBatchMission(env, "Unstarted approval across restart");
    await grantBatch(env, view.id);
    await until(() => env.missions.store.requests(view.id).length === 2, "separate pending request");
    const request = unresolved(env, view.id), step = env.missions.store.step(request.stepId);
    // Reproduce the narrow persisted boundary after allow_once commits and before scheduling.
    env.missions.store.saveRequest({ ...request, resolvedAt: Date.now(), resolution: "allow_once", resolvedBy: "workstation" });
    env.missions.store.saveStep({ ...step, state: "ready", pendingRequestId: null, pendingPhase: null, approvedOnce: { requestId: request.id, action: request.action } });
    const before = env.world.executed.length;
    env.missions.recover();
    const recovered = env.missions.store.step(step.id);
    assert.equal(recovered.approvedOnce, null);
    assert.equal(recovered.failure?.category, "host_restart");
    assert.equal(env.world.executed.length, before);
    assert.equal(env.missions.mission(view.id).state, "waiting_for_user");
  } finally { await env.cleanup(); }
});

test("T9 remote: a paired phone may grant only the offered batch, revoke its own, and the counts stay canonical", async () => {
  const env = await setup();
  try {
    const view = pausedBatchMission(env, "From the phone");
    await until(() => env.missions.store.requests(view.id).length === 1, "the ask");
    const openRequest = env.missions.store.requests(view.id)[0];
    const offer = openRequest.batchOffer!;
    await missionCommand(env.missions, "mission.respond", { requestId: openRequest.id, decision: "allow_batch", maxActions: 9999 }, { local: false, actor: "device:paired-phone" });
    assert.equal(batchRow(env, view.id).maxActions, offer.maxActions, "client data cannot exceed the Host-computed offer");
    assert.equal(batchRow(env, view.id).createdBy, "device:paired-phone");
    assert.deepEqual(batchRow(env, view.id).target, { app: "calculator", processId: null, title: null });
    await until(() => env.missions.store.requests(view.id).length === 2, "paused with a live phone batch");
    assert.equal(batchRow(env, view.id).usedCount, 3, "open + focus + one type consumed");
    await missionCommand(env.missions, "mission.revoke_batch", { missionId: view.id, batchId: batchRow(env, view.id).id }, { local: false, actor: "device:paired-phone" });
    assert.equal(batchRow(env, view.id).endReason, "revoked");
    assert.ok(eventTypes(env, view.id).includes("approval.batch_ended"));
    assert.equal(env.missions.view(env.missions.mission(view.id)).batch, null, "a revoked batch is gone from the UI snapshot");
    const second = unresolved(env, view.id);
    assert.equal(second.action, "computer.type", "the foreign step still waits for its own fresh approval");
    await assert.rejects(
      missionCommand(env.missions, "mission.respond", { requestId: "00000000-0000-0000-0000-000000000000", decision: "allow_batch" }, { local: true, actor: "workstation" }),
      /Unknown permission request/,
      "no batch without a real request",
    );
  } finally { await env.cleanup(); }
});

test("T9R-F01: a phone keeps the Calculator batch where a single allow would exceed remote authority (batch-only verdict)", async () => {
  const env = await setup();
  try {
    const view = pausedBatchMission(env, "Phone batch-only");
    await until(() => env.missions.store.requests(view.id).length === 1, "the ask");
    const ask = env.missions.store.requests(view.id)[0];
    assert.ok(ask.batchOffer, "a Host-computed Calculator batch is offered");
    const foreign = env.missions.store.steps(view.id).find((step) => step.role === "Foreign")!;
    const typeAsk = { ...ask, id: "f01-synthetic", action: "computer.type", stepId: foreign.id };
    assert.match(env.missions.deviceRequestRefusal(typeAsk) ?? "", /Approval required on Windows Host/, "a single phone allow of computer.type is workstation-only");
    assert.equal(env.missions.deviceRequestRefusal(typeAsk, "allow_batch"), null, "the bounded Calculator batch stays remote-approvable");
    const snapshot = env.missions.snapshot();
    const projected = env.missions.remoteVerdicts({ ...snapshot, missions: snapshot.missions.map((m) => m.id === view.id ? { ...m, requests: [typeAsk] } : m) });
    assert.deepEqual(projected.missions.find((m) => m.id === view.id)!.requests[0].remote, { answerable: true, reason: null, batchOnly: true });
    const ordinary = env.missions.remoteVerdicts(env.missions.snapshot()).missions.find((m) => m.id === view.id)!.requests[0].remote!;
    assert.equal(ordinary.answerable, true); assert.equal(ordinary.batchOnly, undefined, "exact Calculator operations keep Allow once");
  } finally { await env.cleanup(); }
});

test("T9 ask_every_time refuses batching: ask again forever, no rescue, no batch button; a denied offer creates nothing", async () => {
  const env = await setup();
  try {
    env.missions.store.setGrant("computer.invoke_control", "global", "ask_every_time", "workstation");
    const view = env.missions.create({ objective: "Always ask", mode: "fast", origin: "workstation", steps: calculatorFlow() });
    env.missions.approve(view.id, "workstation");
    const { request } = await grantBatch(env, view.id);
    assert.equal(request.action, "computer.open_app", "the standing rule covers only its own action; open and focus still batch");
    await until(() => env.missions.store.requests(view.id).some((candidate) => candidate.action === "computer.invoke_control"), "type asked despite the batch");
    const typeRequest = env.missions.store.requests(view.id).find((candidate) => candidate.action === "computer.invoke_control")!;
    assert.equal(typeRequest.batchOffer, null, "the standing rule also suppresses any batch button on its asks");
    await assert.rejects(env.missions.respond(typeRequest.id, "allow_batch", "workstation"), /does not offer/, "the standing rule outranks batching");
    assert.ok(!typeRequest.resolvedAt, "the step stays paused until the user's own rule is honored");
    assert.equal(env.missions.mission(view.id).state, "waiting_for_user");
    const denied = env.missions.create({ objective: "Denied batch", mode: "fast", origin: "workstation", steps: calculatorFlow() });
    env.missions.approve(denied.id, "workstation");
    await until(() => env.missions.store.requests(denied.id).length === 1, "the open ask");
    await env.missions.respond(env.missions.store.requests(denied.id)[0].id, "deny", "workstation");
    await until(() => env.missions.mission(denied.id).state === "failed", "the mission failed");
    assert.equal(env.missions.store.batches(denied.id).length, 0, "a denied approval creates no batch");
  } finally { await env.cleanup(); }
});

test("T9 privacy: canonical execution input never reaches renderer snapshots, requests, runs, events or batch records", async () => {
  const env = await setup();
  try {
    const secret = "hunter2-typed-value";
    const view = env.missions.create({ objective: "Privacy", mode: "fast", origin: "workstation", steps: [
      desktopStep("Launcher", "computer.open_app", { app: "calculator" }),
      desktopStep("Type", "computer.type", { title: "Calculator", name: "num1Button", text: secret }, [0]),
    ] });
    assert.ok(!JSON.stringify(view).includes(secret), "the initial renderer response redacts typed input before approval");
    const inputStep = env.missions.store.steps(view.id)[1];
    assert.equal(inputStep.executor.kind === "capability" && inputStep.executor.params.text, secret, "Host input stays intact for the authorized execution");
    env.missions.approve(view.id, "workstation");
    await until(() => env.missions.store.requests(view.id).length === 1, "launch ask");
    await env.missions.respond(unresolved(env, view.id).id, "allow_once", "workstation");
    await until(() => env.missions.store.requests(view.id).length === 2, "typing asks independently");
    assert.equal(unresolved(env, view.id).batchOffer, null);
    await env.missions.respond(unresolved(env, view.id).id, "allow_once", "workstation");
    await until(() => env.missions.mission(view.id).state === "completed", "done", 8000);
    assert.ok(env.world.executed.some((run) => run.params.text === secret), "the fake capability really received the value (execution needs it)");
    assert.ok(!JSON.stringify(env.missions.store.requests(view.id)).includes(secret), "requests hold no typed values");
    for (const run of env.missions.store.runs({ missionId: view.id })) {
      assert.ok(!JSON.stringify(run.params).includes(secret), "the typed value itself is never stored");
      if (run.action === "computer.type") assert.equal((run.params as { text: string }).text, `[${secret.length} characters]`, "the value is represented by its length only");
    }
    for (const event of events(env, view.id)) assert.ok(!event.detail.includes(secret), "journal events carry actions, never content");
    assert.equal(env.missions.store.batches(view.id).length, 0, "secret input created no batch authority");
    const snapshot = env.missions.snapshot().missions.find((mission) => mission.id === view.id)!;
    assert.ok(!JSON.stringify(snapshot).includes(secret), "the entire renderer mission snapshot carries no typed values");
    assert.ok(!JSON.stringify(env.missions.get(view.id)).includes(secret), "the mission detail response also redacts typed input");
  } finally { await env.cleanup(); }
});

const pausedRequest = (env: Env, id: string, index = 1) => {
  const step = env.missions.store.steps(id)[index];
  if (step.executor.kind !== "capability") throw new Error("Expected capability step");
  return { action: step.executor.action, params: step.executor.params, missionId: id, stepId: step.id, envelope: envelopeOf(env, id), origin: "test", cwd: env.root, roots: [env.root] };
};

test("T9 TOCTOU: a foreign window with the exact Calculator title is rejected before mutation or budget consumption", async () => {
  const env = await setup();
  try {
    const view = pausedBatchMission(env, "TOCTOU"); await grantBatch(env, view.id);
    await until(() => env.missions.store.requests(view.id).length === 2, "paused");
    const before = env.world.executed.length;
    env.world.owner.set("calculator", 5151);
    const out = await env.missions.bus.request(pausedRequest(env, view.id));
    assert.equal(out.decision.decision, "ask");
    assert.equal(out.run, null);
    assert.equal(env.world.executed.length, before, "no foreign-window mutation");
    assert.equal(batchRow(env, view.id).usedCount, 3);
    assert.equal(batchRow(env, view.id).endReason, "scope_mismatch");
    assert.ok(eventTypes(env, view.id).includes("approval.batch_scope_mismatch"));
  } finally { await env.cleanup(); }
});

test("T9 approval replay: changed planned action cannot answer an old offer and the request stays open", async () => {
  const env = await setup();
  try {
    const view = pausedBatchMission(env, "Changed plan");
    await until(() => env.missions.store.requests(view.id).length === 1, "ask");
    const request = unresolved(env, view.id);
    const step = env.missions.store.steps(view.id)[1];
    env.missions.store.saveStep({ ...step, executor: { kind: "capability", action: "computer.focus_window", params: { title: "Chrome" } } });
    await assert.rejects(env.missions.respond(request.id, "allow_batch", "workstation"), /planned batch changed/);
    assert.equal(env.missions.store.request(request.id).resolvedAt, null);
    assert.equal(env.missions.store.batches(view.id).length, 0);
    assert.equal(env.world.executed.length, 0);
  } finally { await env.cleanup(); }
});

test("T9 immutable operations: changed selectors, extra fields and spoofed UI claims ask without execution", async () => {
  const env = await setup();
  try {
    const view = pausedBatchMission(env, "Immutable operations"); await grantBatch(env, view.id);
    await until(() => env.missions.store.requests(view.id).length === 2, "paused");
    const request = pausedRequest(env, view.id, 2);
    const before = env.world.executed.length;
    for (const params of [{ title: "Calculator", automationId: "equalButton" }, { ...request.params, approved: true }, { title: "Calculator", automationId: "purchaseButton" }, { ...request.params, text: "secret" }, { ...request.params, grantId: batchRow(env, view.id).id }]) {
      const out = await env.missions.bus.request({ ...request, params });
      assert.equal(out.decision.decision, "ask"); assert.equal(out.run, null);
    }
    assert.equal(env.world.executed.length, before);
    assert.equal(batchRow(env, view.id).usedCount, 3);
  } finally { await env.cleanup(); }
});

test("T9 Stop races preflight: canonical Stop wins before admission and unrelated work survives", async () => {
  const env = await setup();
  try {
    const a = pausedBatchMission(env, "Stop race"); await grantBatch(env, a.id);
    await until(() => env.missions.store.requests(a.id).length === 2, "paused");
    const b = pausedBatchMission(env, "B survives"); await grantBatch(env, b.id);
    await until(() => env.missions.store.requests(b.id).length === 2, "B paused");
    const adapter = env.missions.bus.adapters.get("computer")!;
    const original = adapter.prepareBatchAction!;
    let entered = false; let resume!: () => void;
    adapter.prepareBatchAction = async (...args) => { entered = true; await new Promise<void>((resolve) => { resume = resolve; }); return original(...args); };
    const before = env.world.executed.length;
    const pending = env.missions.bus.request(pausedRequest(env, a.id));
    await until(() => entered, "probe entered");
    await env.missions.stop(a.id, "workstation"); resume();
    const out = await pending;
    assert.equal(out.decision.decision, "deny");
    assert.equal(env.world.executed.length, before);
    assert.equal(batchRow(env, a.id).usedCount, 3);
    assert.equal(batchRow(env, b.id).status, "active");
  } finally { await env.cleanup(); }
});

test("T9 expiration races preflight: time is rechecked after the asynchronous target check", async () => {
  const env = await setup();
  try {
    const view = pausedBatchMission(env, "Expiry race"); await grantBatch(env, view.id);
    await until(() => env.missions.store.requests(view.id).length === 2, "paused");
    const adapter = env.missions.bus.adapters.get("computer")!; const original = adapter.prepareBatchAction!;
    adapter.prepareBatchAction = async (...args) => { const result = await original(...args); env.missions.store.saveBatch({ ...batchRow(env, view.id), expiresAt: Date.now() - 1 }); return result; };
    const before = env.world.executed.length;
    const out = await env.missions.bus.request(pausedRequest(env, view.id));
    assert.equal(out.decision.decision, "ask");
    assert.equal(out.run, null);
    assert.equal(env.world.executed.length, before);
    assert.equal(batchRow(env, view.id).usedCount, 3);
  } finally { await env.cleanup(); }
});

test("T9 retries and provider reroute: each new admission consumes exactly one; provider origin cannot broaden scope", async () => {
  const env = await setup();
  try {
    const view = pausedBatchMission(env, "Retries"); await grantBatch(env, view.id, { maxActions: 5 });
    await until(() => env.missions.store.requests(view.id).length === 2, "paused");
    const request = pausedRequest(env, view.id, 2);
    for (const origin of ["provider:codex", "provider:claude"]) {
      const out = await env.missions.bus.request({ ...request, origin }); assert.equal(out.result?.ok, true);
    }
    assert.equal(batchRow(env, view.id).usedCount, 5);
    const out = await env.missions.bus.request(request);
    assert.equal(out.decision.decision, "ask"); assert.equal(out.run, null);
    assert.equal(batchRow(env, view.id).usedCount, 5);
    assert.equal(eventTypes(env, view.id).filter((type) => type === "approval.batch_consumed").length, 5);
  } finally { await env.cleanup(); }
});

test("T9 risk escalation: a previously eligible operation asks fresh when adapter risk increases", async () => {
  const env = await setup();
  try {
    const view = pausedBatchMission(env, "Risk escalation"); await grantBatch(env, view.id);
    await until(() => env.missions.store.requests(view.id).length === 2, "paused");
    env.missions.bus.adapters.get("computer")!.riskFor = () => "EXTERNAL_SIDE_EFFECT";
    const before = env.world.executed.length;
    const out = await env.missions.bus.request(pausedRequest(env, view.id, 2));
    assert.equal(out.decision.decision, "ask"); assert.equal(out.decision.risk, "EXTERNAL_SIDE_EFFECT");
    assert.equal(out.run, null); assert.equal(env.world.executed.length, before);
  } finally { await env.cleanup(); }
});

test("T9 rule changes before approval: standing ask-every-time prevents granting an old offer", async () => {
  const env = await setup();
  try {
    const view = pausedBatchMission(env, "Rule changes");
    await until(() => env.missions.store.requests(view.id).length === 1, "ask");
    const request = unresolved(env, view.id);
    env.missions.store.setGrant("computer.open_app", "global", "ask_every_time", "workstation");
    await assert.rejects(env.missions.respond(request.id, "allow_batch", "workstation"), /standing ask every time/);
    assert.equal(env.missions.store.request(request.id).resolvedAt, null);
    assert.equal(env.missions.store.batches(view.id).length, 0);
  } finally { await env.cleanup(); }
});
