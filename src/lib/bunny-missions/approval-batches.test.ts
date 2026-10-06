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
import { consultBatch, rotateBatchEpochForTest, riskAtMost } from "./batches.server.ts";
import { simulatedCodexProfile } from "../bunny-host/testing/codex.test.ts";
import type { ActionManifest, ApprovalBatch, AuthorizationEnvelope, CapabilityManifest, MissionView, PermissionBatchOffer, PermissionRequest, RiskClass } from "./types.ts";

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
  actionManifest("computer.read_controls", "READ", { sensitive: true }),
  actionManifest("computer.focus_window", "EXECUTE"),
  actionManifest("computer.invoke_control", "EXECUTE"),
  actionManifest("computer.type", "EXECUTE"),
  actionManifest("computer.capture", "READ", { sensitive: true }),
  actionManifest("computer.open_app", "EXECUTE"),
];
type World = { owner: Map<string, number>; launchers: Map<string, number>; unique: number; executed: { action: string; params: Record<string, unknown> }[] };
function fakeComputer(world: World): CapabilityAdapter {
  const manifest: CapabilityManifest = { id: "computer", version: "1.0.0", description: "fake desktop", locality: "local", platforms: "any", events: [], cost: { kind: "local_compute", note: "" }, adapter: "fake", actions: COMPUTER_ACTIONS };
  const result = (ok: boolean, status: "succeeded" | "failed" | "unsupported", summary: string, output: unknown) => ({ ok, status, summary, output, evidence: [] });
  return {
    manifest,
    health: async () => ({ availability: "available", detail: "" }),
    execute: async (action, params) => {
      world.executed.push({ action, params });
      const title = String(params.title ?? "");
      // Known titles map to their window-owner pid; unknown titles resolve to distinct fresh pids
      // (drift probes); open_app reports a launcher pid different from any window owner.
      const owner = params.pid !== undefined ? Number(params.pid) : world.owner.get(title.toLowerCase()) ?? 9990 + (world.unique += 1);
      switch (action) {
        case "computer.open_app": return result(true, "succeeded", "started", { pid: world.launchers.get(String(params.app)) ?? 1000 + (world.unique += 1), file: `fake-${String(params.app)}.exe`, newWindows: 1 });
        case "computer.focus_window": return result(true, "succeeded", "focused", { before: "old", after: title, target: { name: title, processId: owner }, focused: true });
        case "computer.invoke_control": return result(true, "succeeded", "invoked", { control: { name: params.name, processId: owner }, pattern: "invoke" });
        case "computer.type": return result(true, "succeeded", "typed", { control: { name: params.name, processId: owner }, beforeLength: 0, afterLength: String(params.text ?? "").length, matches: true });
        case "computer.read_controls": return result(true, "succeeded", "read", { window: { name: title, processId: owner }, controls: [] });
        case "computer.list_windows": return result(true, "succeeded", "listed", { windows: [{ name: title, processId: owner }], foreground: { name: title, processId: owner } });
        case "computer.capture": return result(true, "succeeded", "captured", { path: "x.png", width: 1, height: 1 });
        default: return result(false, "unsupported", "unsupported", null);
      }
    },
  };
}
function makeWorld(): World {
  return { owner: new Map([["calculator", 4242], ["notepad", 5151]]), launchers: new Map([["calculator", 1000], ["notepad", 1001]]), unique: 0, executed: [] };
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
  desktopStep("Type 8", "computer.type", { title: "Calculator", name: "num8Button", text: "8" }, [1]),
  desktopStep("Type 9", "computer.type", { title: "Calculator", name: "num9Button", text: "9" }, [2]),
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
    desktopStep("Type 8", "computer.type", { title: "Calculator", name: "num8Button", text: "8" }, [1]),
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
      desktopStep("Type 3", "computer.type", { title: "Calculator", name: "num3Button", text: "3" }, [3]),
      desktopStep("Lister", "computer.list_windows", {}, [4]),
    ];
    const view = env.missions.create({ objective: "Bounded Calculator run", mode: "fast", origin: "workstation", steps });
    assert.equal(view.requestedScope?.computer.enabled, true);
    env.missions.approve(view.id, "workstation");
    await until(() => env.missions.store.requests(view.id).length === 1, "first ask");
    const request = env.missions.store.requests(view.id)[0];
    assert.equal(request.action, "computer.open_app");
    const offer = request.batchOffer!;
    assert.ok(offer, "five mutating executions in the plan → a batch is offered");
    assert.deepEqual(offer.actions, ["computer.focus_window", "computer.list_windows", "computer.open_app", "computer.type"]);
    assert.deepEqual(offer.readOnly, ["computer.list_windows"], "read-only entries are covered but never counted");
    assert.equal(offer.counts["computer.type"], 3);
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

    // A password-shaped control: the offer may cover an ordinary field of the same app, never the secret one.
    const probeView = env.missions.create({ objective: "Secret target", mode: "fast", origin: "workstation", steps: [
      desktopStep("Launcher", "computer.open_app", { app: "notepad" }),
      desktopStep("Type name", "computer.type", { title: "Notepad", name: "Name box", text: "x" }, [0]),
      desktopStep("Type password", "computer.type", { title: "Notepad", name: "Password field", text: "hunter2" }, [1]),
    ] });
    env.missions.approve(probeView.id, "workstation");
    await until(() => env.missions.store.requests(probeView.id).length === 1, "the notepad ask");
    const missionRecord = env.missions.mission(probeView.id);
    const computed: PermissionBatchOffer | null = env.missions.batchOfferFor(missionRecord, env.missions.store.steps(probeView.id)[0], "computer.open_app");
    assert.ok(computed);
    assert.equal(computed.counts["computer.type"], 1, "only the ordinary field is counted in the offer");
    assert.ok(computed.actions.includes("computer.type"), "ordinary typing stays batch-eligible");
    const envelope = envelopeOf(env, probeView.id);
    const stepIds = plannedStepIds(env, probeView.id);
    const consult = (name: string) => decisionProbe(env, probeView.id, "computer.type", { title: "Notepad", name, text: "x" }, stepIds[1], envelope);
    assert.equal(consult("Name box").decision, "ask", "no batch yet");
    assert.equal(consult("Password field").decision, "ask");
    const { view: liveView } = await grantBatch(env, probeView.id);
    assert.equal(liveView.batch?.status, "active");
    await until(() => env.missions.store.requests(probeView.id).length === 2, "the password field asked on its own after the batch ran ahead");
    assert.equal(consult("Name box").decision, "allow", "the ordinary field rides the batch");
    assert.equal(consult("Password field").decision, "ask", "the password-typed control never inherits the typing approval");
    assert.equal(batchRow(env, probeView.id).usedCount, 2, "open + name-type only; probe decisions never consume");
    assert.equal(env.world.executed.filter((run) => run.params.name === "Password field").length, 0, "the secret field was never typed");
  } finally { await env.cleanup(); }
});

test("T9 consult boundary: step binding, verified pids, app/title targets, family and envelope guards (direct)", () => {
  const now = Date.now();
  const envelope = (over: Partial<AuthorizationEnvelope> = {}): AuthorizationEnvelope => ({ id: "e1", missionId: "m1", grantedAt: 1, grantedBy: "test", expiresAt: now + 60_000, projectRoots: [], riskClasses: ["READ"], capabilities: ["computer.open_app", "computer.focus_window", "computer.type", "computer.list_windows"], providers: { execution: false, allow: null, localOnly: false }, filesystem: { read: [], write: [] }, browser: { enabled: false, domains: "public" }, terminal: { enabled: false, commands: [] }, git: { actions: [] }, network: { allowed: false }, computer: { enabled: true }, budget: { maxExternalModelCalls: 0, maxRuntimeMs: 1, maxRetries: 0, maxTokens: null }, alwaysAsk: [], revokedAt: null, ...over });
  const batchOf = (over: Partial<ApprovalBatch> = {}): ApprovalBatch => ({ id: "b1", missionId: "m1", authorizationId: "e1", family: "computer", actions: ["computer.open_app", "computer.focus_window", "computer.type", "computer.list_windows"], riskCeiling: "EXECUTE", target: { app: "calculator", processId: null, title: null }, targetTier: "app", maxActions: 5, usedCount: 1, observedPid: null, observedPidFrom: null, batchEpoch: "boot-e1", createdAt: 1, createdBy: "test", expiresAt: now + 60_000, status: "active", endAt: null, endReason: null, endBy: null, originStepId: "s1", ...over });
  const manifestOf = (action: string): ActionManifest => COMPUTER_ACTIONS.find((item) => item.id === action)!;
  const consult = (batchFixture: ApprovalBatch, env: AuthorizationEnvelope, opts: { action: string; params?: Record<string, unknown>; risk?: RiskClass; stepId?: string; epoch?: string }) =>
    consultBatch(batchFixture, { action: opts.action, params: opts.params ?? {}, manifest: manifestOf(opts.action), risk: opts.risk ?? "EXECUTE", envelope: env, now, stepIds: new Set(["s1", "s2"]), stepId: opts.stepId ?? "s1", epoch: opts.epoch ?? "boot-e1" });
  assert.equal(consult(batchOf(), envelope(), { action: "computer.type", params: { title: "Calculator", name: "ok", text: "1" } })?.match, true, "a title-only request matches its app target");
  assert.equal(consult(batchOf(), envelope(), { action: "computer.type", params: { title: "Calculator", name: "x", text: "1" }, stepId: "delegated-child" })?.match, false, "delegated child steps inherit nothing");
  assert.equal(consult(batchOf(), envelope(), { action: "computer.open_app", params: { app: "calculator" } })?.match, true, "the app tier matches its own app");
  assert.equal(consult(batchOf(), envelope(), { action: "computer.open_app", params: { app: "chrome" } })?.match, false, "another application is not covered");
  assert.equal(consult(batchOf(), envelope(), { action: "computer.type", risk: "DESTRUCTIVE" })?.match, false, "above the risk ceiling asks fresh");
  assert.equal(consult(batchOf(), envelope(), { action: "computer.capture", risk: "READ" })?.match, false, "sensitive actions are never covered");
  assert.equal(consult(batchOf(), envelope({ revokedAt: now - 1 }), { action: "computer.type", params: { title: "Calculator", name: "x", text: "1" } })?.match, false, "the envelope being revoked ends coverage");
  assert.equal(consult(batchOf(), envelope({ expiresAt: now - 1 }), { action: "computer.type", params: { title: "Calculator", name: "x", text: "1" } })?.match, false, "the envelope expiring ends coverage");
  assert.equal(consult(batchOf(), envelope({ capabilities: ["computer.open_app"], computer: { enabled: false } }), { action: "computer.type", params: { title: "Calculator", name: "x", text: "1" } })?.match, false, "desktop work not in the envelope is never covered");
  assert.equal(consult(batchOf({ status: "ended", endReason: "revoked" }), envelope(), { action: "computer.type", params: { title: "Calculator", name: "x", text: "1" } }), null, "an ended batch is not consulted at all");
  assert.equal(consult(batchOf({ expiresAt: now - 1 }), envelope(), { action: "computer.type", params: { title: "Calculator", name: "x", text: "1" } }), null, "an expired batch is not consulted at all");
  assert.equal(consult(batchOf(), envelope(), { action: "computer.focus_window", params: { pid: 4242 } })?.match, false, "an explicit pid cannot match an unpinned app binding yet");
  const pinned = consult(batchOf({ observedPid: 4242, observedPidFrom: "post-run" }), envelope(), { action: "computer.focus_window", params: { pid: 4242 } });
  assert.equal(pinned?.match, true, "the pinned window owner is covered by pid");
  assert.equal(pinned?.consume, true);
  assert.equal(consult(batchOf({ observedPid: 4242, observedPidFrom: "post-run" }), envelope(), { action: "computer.focus_window", params: { pid: 999 } })?.match, false, "a different pid is not covered");
  const readBatch = batchOf({ actions: ["computer.list_windows"] });
  const readOnly = consult(readBatch, envelope(), { action: "computer.list_windows", risk: "READ" });
  assert.equal(readOnly?.match, true, "an identity-less read-only covered action is allowed while the batch lives");
  assert.equal(readOnly?.consume, false, "read-only actions never consume the budget");
  assert.equal(consult(readBatch, envelope(), { action: "computer.list_windows", params: { title: "Calculator" }, risk: "READ" })?.match, true);
  assert.equal(consult(readBatch, envelope(), { action: "computer.type", risk: "EXECUTE" })?.match, false, "a mutating action without any identity asks again");
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
    const probe = () => decisionProbe(env, view.id, "computer.type", { title: "Calculator", name: "num9Button", text: "9" }, stepIds[2], envelope);
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
    assert.equal(decisionProbe(env, view.id, "computer.type", { title: "Calculator", name: "num9Button", text: "9" }, stepIds[2], envelope).decision, "allow", "a planned step stays covered (positive control)");
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

test("T9 window drift: a title-lookalike window of the same app is admitted per the approved title rule, then its foreign owner ends the batch and the next step asks fresh", async () => {
  const env = await setup();
  try {
    const view = env.missions.create({ objective: "Drift probe", mode: "fast", origin: "workstation", steps: [
      desktopStep("Launcher", "computer.open_app", { app: "calculator" }),
      desktopStep("Focus", "computer.focus_window", { title: "Calculator" }, [0]),
      desktopStep("Type 7", "computer.type", { title: "Calculator", name: "num7Button", text: "7" }, [1]),
      desktopStep("Lookalike", "computer.type", { title: "Calculator help consent", name: "continue", text: "x" }, [2]),
      desktopStep("After", "computer.type", { title: "Calculator", name: "num8Button", text: "8" }, [3]),
    ] });
    env.missions.approve(view.id, "workstation");
    const { request } = await grantBatch(env, view.id);
    assert.equal(request.action, "computer.open_app");
    await until(() => batchRow(env, view.id).status === "ended", "drift ended the batch", 8000);
    const stored = batchRow(env, view.id);
    assert.equal(stored.endReason, "scope_mismatch", "the lookalike window's real owner pid ended the batch at once");
    assert.equal(stored.usedCount, 4, "open + focus + type + the admitted lookalike; nothing after it ran under the batch");
    assert.equal(stored.observedPid, 4242, "the batch is pinned to Calculator's real window owner");
    assert.ok(eventTypes(env, view.id).includes("approval.batch_scope_mismatch"));
    await until(() => env.missions.store.requests(view.id).length >= 2, "a fresh ask for the next step");
    const after = unresolved(env, view.id);
    assert.equal(after.action, "computer.type", "the next planned step asks for fresh approval — no silent continuation");
    await env.missions.respond(after.id, "deny", "workstation");
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

test("T9 ask_every_time refuses batching: ask again forever, no rescue, no batch button; a denied offer creates nothing", async () => {
  const env = await setup();
  try {
    env.missions.store.setGrant("computer.type", "global", "ask_every_time", "workstation");
    const view = env.missions.create({ objective: "Always ask", mode: "fast", origin: "workstation", steps: calculatorFlow() });
    env.missions.approve(view.id, "workstation");
    const { request } = await grantBatch(env, view.id);
    assert.equal(request.action, "computer.open_app", "the standing rule covers only its own action; open and focus still batch");
    await until(() => env.missions.store.requests(view.id).some((candidate) => candidate.action === "computer.type"), "type asked despite the batch");
    const typeRequest = env.missions.store.requests(view.id).find((candidate) => candidate.action === "computer.type")!;
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

test("T9 privacy: typed values exist only in the in-memory adapter call — never in requests, runs, events or the batch records", async () => {
  const env = await setup();
  try {
    const secret = "hunter2-typed-value";
    const view = env.missions.create({ objective: "Privacy", mode: "fast", origin: "workstation", steps: [
      desktopStep("Launcher", "computer.open_app", { app: "calculator" }),
      desktopStep("Type", "computer.type", { title: "Calculator", name: "num1Button", text: secret }, [0]),
    ] });
    env.missions.approve(view.id, "workstation");
    await grantBatch(env, view.id);
    await until(() => env.missions.mission(view.id).state === "completed", "done", 8000);
    assert.ok(env.world.executed.some((run) => run.params.text === secret), "the fake capability really received the value (execution needs it)");
    assert.ok(!JSON.stringify(env.missions.store.requests(view.id)).includes(secret), "requests hold no typed values");
    for (const run of env.missions.store.runs({ missionId: view.id })) {
      assert.ok(!JSON.stringify(run.params).includes(secret), "the typed value itself is never stored");
      if (run.action === "computer.type") assert.equal((run.params as { text: string }).text, `[${secret.length} characters]`, "the value is represented by its length only");
    }
    for (const event of events(env, view.id)) assert.ok(!event.detail.includes(secret), "journal events carry actions, never content");
    assert.ok(!JSON.stringify(batchRow(env, view.id)).includes(secret), "batch records carry no typed values");
    const snapshot = env.missions.snapshot().missions.find((mission) => mission.id === view.id)!;
    assert.ok(!JSON.stringify(snapshot.batch).includes(secret), "the batch block the UI renders carries no typed values");
  } finally { await env.cleanup(); }
});