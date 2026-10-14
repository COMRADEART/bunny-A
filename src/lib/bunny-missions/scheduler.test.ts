import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostDatabase } from "../bunny-host/persistence.server.ts";
import { ModelCapabilityRegistry } from "../bunny-host/model-capability.server.ts";
import { TaskManager } from "../bunny-host/manager.server.ts";
import { providerBase } from "../bunny-host/adapters.server.ts";
import { DEFAULT_FAIRNESS, FAIRNESS_AGING_MS, admitStep, readFairness, validateFairness, type FairnessSettings } from "../bunny-host/fairness.ts";
import type { AdapterHooks, AdapterResult, ProviderAdapter } from "../bunny-host/contracts.ts";
import type { OrchTask, ProviderId, ProviderLive } from "../orch/types.ts";
import { MissionManager } from "./manager.server.ts";
import { classifyTaskFailure, retryVerdict } from "./machine.ts";
import { missionCommand } from "./commands.server.ts";
import { FilesystemCapability } from "./capabilities/local.server.ts";
import { simulatedCodexProfile } from "../bunny-host/testing/codex.test.ts";

/** M-A-3 T13.3 Gate F: Personal Agent fairness admission and quota-safe continuation of write steps. */

const settings = (patch: Partial<FairnessSettings> = {}): FairnessSettings => ({ ...structuredClone(DEFAULT_FAIRNESS), ...patch });
const base = { settings: settings(), live: {}, waiting: [], since: 100, now: 200, memoryUsedPercent: 40 };

test("T13.3 F fairness: per-Agent cap, shared ceiling, fair turn by priority and wait, memory pressure", () => {
  assert.deepEqual(admitStep({ ...base, slot: 1 }), { admit: true });
  assert.equal((admitStep({ ...base, slot: 1, live: { 1: 2 } }) as { code: string }).code, "AGENT_CAP");
  assert.equal((admitStep({ ...base, slot: 1, live: { 2: 2, 3: 2 } }) as { code: string }).code, "SHARED_CEILING", "four live steps fill the shared ceiling");
  // One seat left; Agent 2 has waited longer, so Agent 1 yields; Agent 2 takes it.
  const oneSeat = { ...base, live: { 3: 2, 4: 1 } };
  assert.equal((admitStep({ ...oneSeat, slot: 1, waiting: [{ slot: 2, since: 50 }] }) as { code: string }).code, "FAIR_TURN");
  assert.deepEqual(admitStep({ ...oneSeat, slot: 2, since: 50, waiting: [{ slot: 1, since: 100 }] }), { admit: true });
  // A high-priority Agent goes first even if it started waiting later.
  const high = settings({ agents: { ...DEFAULT_FAIRNESS.agents, 1: { maxConcurrent: 2, priority: "high" } } });
  assert.deepEqual(admitStep({ ...oneSeat, settings: high, slot: 1, waiting: [{ slot: 2, since: 50 }] }), { admit: true });
  // An Agent with fewer live steps goes before one already running work.
  assert.deepEqual(admitStep({ ...base, live: { 1: 1, 3: 2 }, slot: 2, since: 200, waiting: [{ slot: 1, since: 50 }] }), { admit: true });
  // A waiting Agent at its own cap does not block others.
  assert.deepEqual(admitStep({ ...base, live: { 2: 2, 3: 1 }, slot: 1, waiting: [{ slot: 2, since: 10 }] }), { admit: true });
  assert.equal((admitStep({ ...base, slot: 1, live: { 2: 1 }, memoryUsedPercent: 97 }) as { code: string }).code, "MEMORY_PRESSURE");
  assert.deepEqual(admitStep({ ...base, slot: 1, memoryUsedPercent: 97 }), { admit: true }, "memory pressure never starves the only Agent");
});

test("T13.3 F11: aging; a low-priority Agent held long enough is no longer starved by a high-priority one", () => {
  const ranked = settings({ agents: { ...DEFAULT_FAIRNESS.agents, 1: { maxConcurrent: 2, priority: "high" }, 2: { maxConcurrent: 2, priority: "low" } } });
  const oneSeat = { ...base, settings: ranked, live: { 3: 2, 4: 1 } };
  const t0 = 1_000_000;
  // The exact reported case: Agent 2 (low) waits while Agent 1 (high) keeps arriving with fresh ready work.
  assert.equal((admitStep({ ...oneSeat, slot: 2, since: t0, now: t0 + 1000, waiting: [{ slot: 1, since: t0 + 900 }] }) as { code: string }).code, "FAIR_TURN");
  assert.deepEqual(admitStep({ ...oneSeat, slot: 1, since: t0 + 900, now: t0 + 1000, waiting: [{ slot: 2, since: t0 }] }), { admit: true });
  // After two aging intervals the low-priority Agent ranks as high and its longer wait wins the seat.
  const later = t0 + 2 * FAIRNESS_AGING_MS;
  assert.deepEqual(admitStep({ ...oneSeat, slot: 2, since: t0, now: later, waiting: [{ slot: 1, since: later - 100 }] }), { admit: true });
  assert.equal((admitStep({ ...oneSeat, slot: 1, since: later - 100, now: later, waiting: [{ slot: 2, since: t0 }] }) as { code: string }).code, "FAIR_TURN");
});

test("T13.3 F fairness settings validate bounds and fall back to defaults on corrupt storage", () => {
  const next = validateFairness({ sharedCeiling: 2, agents: { 3: { maxConcurrent: 1, priority: "low" } } });
  assert.equal(next.sharedCeiling, 2);
  assert.deepEqual(next.agents[3], { maxConcurrent: 1, priority: "low" });
  assert.deepEqual(next.agents[1], DEFAULT_FAIRNESS.agents[1]);
  for (const bad of [{ sharedCeiling: 0 }, { sharedCeiling: 17 }, { sharedCeiling: 2.5 }, { memoryCeilingPercent: 10 }, { agents: { 5: { maxConcurrent: 1 } } }, { agents: { 1: { maxConcurrent: 9 } } }, { agents: { 1: { priority: "urgent" } } }, null])
    assert.throws(() => validateFairness(bad), Error, JSON.stringify(bad));
  assert.deepEqual(readFairness("{not json"), DEFAULT_FAIRNESS);
  assert.deepEqual(readFairness(JSON.stringify({ sharedCeiling: 99 })), DEFAULT_FAIRNESS);
});

test("T13.3 F quota on a write step waits for the owner; read steps keep the bounded reroute", () => {
  const write = retryVerdict("provider_rate_limited", 1, 2, 0, 10, "write");
  assert.deepEqual([write.retry, write.reroute, write.waitForUser], [false, false, true]);
  const read = retryVerdict("provider_rate_limited", 1, 2, 0, 10, "read");
  assert.deepEqual([read.retry, read.reroute], [true, true]);
  assert.equal(retryVerdict("provider_failed", 1, 2, 0, 10, "write").retry, true, "only quota exhaustion changes");
});

function ready(id: ProviderId): ProviderLive {
  return { ...providerBase(id), installed: true, authenticated: true, availability: "ready", capabilities: ["filesystem", "terminal", "text"], current_model: null, ...(id === "codex" ? { securityCompatibility: simulatedCodexProfile() } : {}) };
}
type Launched = { task: OrchTask; finish: (result: AdapterResult) => void; hooks: AdapterHooks };
function fakeAdapter(id: ProviderId, launched: Launched[]): ProviderAdapter {
  return { id, detect: async () => ready(id), launch: (task, hooks) => {
    let finish!: (result: AdapterResult) => void; const done = new Promise<AdapterResult>((resolve) => (finish = resolve));
    launched.push({ task, finish, hooks });
    return { done, stop: async () => finish({ ok: false, output: "", stopped: true }) };
  } };
}
const until = async (check: () => boolean, label: string, timeout = 4000) => {
  const start = Date.now();
  while (!check()) { if (Date.now() - start > timeout) throw new Error(`Timed out waiting for ${label}`); await new Promise((r) => setTimeout(r, 10)); }
};
async function setup(providers: ProviderId[], filesystem: FilesystemCapability = new FilesystemCapability()) {
  const dir = mkdtempSync(join(tmpdir(), "bunny-t13-3-sched-"));
  const root = join(dir, "project"); mkdirSync(root, { recursive: true });
  const db = new HostDatabase(join(dir, "host.sqlite"));
  const launched: Launched[] = [];
  const tasks = new TaskManager(db, root, providers.map((id) => fakeAdapter(id, launched)), { modelRegistry: new ModelCapabilityRegistry(db, { availableProviders: () => [] }) });
  await tasks.discover();
  const missions = new MissionManager(tasks, { dataDirectory: dir, adapters: [filesystem] });
  missions.configure({ enabled: true }, "test");
  await missions.bus.refreshHealth();
  const cleanup = async () => { await missions.close(); try { db.close(); } catch { /* already closed */ } rmSync(dir, { recursive: true, force: true }); };
  return { tasks, missions, launched, cleanup, root };
}
const model = (role: string, objective: string, dependsOn: number[] = [], extra: Record<string, unknown> = {}) => ({ role, objective, dependsOn, executor: { kind: "model" }, ...extra });

test("T13.3 F admission hold keeps the step ready and admits it when a live step ends", async () => {
  const env = await setup(["claude"]);
  try {
    const owned = new Set<string>();
    // Two Missions owned by different Agents, a shared ceiling of one live Agent step.
    const live = () => [...owned].reduce((sum, id) => sum + env.missions.store.steps(id).filter((step) => step.state === "running" || step.state === "verifying").length, 0);
    env.missions.missionAdmissionGate = (missionId) => (owned.has(missionId) && live() >= 1 ? "SHARED_CEILING: All 1 shared Agent step slots are in use." : null);
    const first = env.missions.create({ objective: "One", mode: "fast", origin: "workstation", steps: [model("A", "a")] });
    const second = env.missions.create({ objective: "Two", mode: "fast", origin: "workstation", steps: [model("B", "b")] });
    owned.add(first.id); owned.add(second.id);
    env.missions.approve(first.id, "workstation");
    await until(() => env.launched.length === 1, "first Agent step");
    env.missions.approve(second.id, "workstation");
    await until(() => env.missions.admissionHolds.has(second.id), "second held");
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(env.launched.length, 1, "the shared ceiling holds");
    assert.equal(env.missions.store.steps(second.id)[0].state, "ready", "a held step is not failed");
    assert.equal(env.missions.mission(second.id).state, "running");
    assert.ok(env.missions.get(second.id).events.some((event) => event.type === "mission.step.held"));
    env.launched[0].finish({ ok: true, output: "a" });
    await until(() => env.launched.length === 2, "second admitted after release");
    assert.equal(env.missions.admissionHolds.has(second.id), false);
    env.launched[1].finish({ ok: true, output: "b" });
    await until(() => env.missions.mission(second.id).state === "completed", "second done");
  } finally { await env.cleanup(); }
});

test("T13.3 F quota exhaustion in a write step pauses at the last verified step instead of switching providers", async () => {
  const env = await setup(["claude", "codex"]);
  try {
    // Balanced mode leaves external-call budget for a reroute, so only the quota rule can stop one.
    const view = env.missions.create({ objective: "Inspect then edit", mode: "balanced", origin: "workstation", steps: [model("Reader", "Inspect files", [], { access: "read" }), model("Writer", "Edit file", [0], { access: "write", maxRetries: 2 })] });
    env.missions.approve(view.id, "workstation");
    await until(() => env.launched.length === 1, "reader");
    env.launched[0].finish({ ok: true, output: "Read evidence" });
    await until(() => env.launched.length === 2, "writer");
    const writer = env.launched[1];
    assert.deepEqual(writer.task.executionScope, { access: "write" });
    writer.finish({ ok: false, output: "", error: "HTTP 429: usage limit reached for this plan (quota exceeded)." });
    await until(() => env.missions.mission(view.id).state === "waiting_for_user", "paused for the owner");
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(env.launched.length, 2, "no provider switch and no duplicate write attempt");
    const [reader, edited] = env.missions.store.steps(view.id);
    assert.equal(reader.state, "completed", "the verified checkpoint is kept");
    assert.equal(edited.state, "failed");
    assert.equal(edited.failure?.category, "provider_rate_limited");
    assert.match(edited.failure?.detail ?? "", /QUOTA_PAUSE|quota/i);
  } finally { await env.cleanup(); }
});

test("T13.3 N-C 3/10: a Mission write step never replays after an uncertain failure; it waits for the owner's reconciliation", async () => {
  const env = await setup(["claude", "codex"]);
  try {
    const view = env.missions.create({ objective: "Edit", mode: "balanced", origin: "workstation", steps: [model("Writer", "Edit file", [], { access: "write", maxRetries: 2 })] });
    env.missions.approve(view.id, "workstation");
    await until(() => env.launched.length === 1, "writer");
    const provider = env.launched[0].task.provider;
    const firstTask = env.launched[0].task.id;
    // A plain crash after dispatch: the Mission's own retry budget (maxRetries 2) would have replayed it before N-C.
    env.launched[0].finish({ ok: false, output: "", error: "provider crashed" });
    await until(() => env.missions.mission(view.id).state === "waiting_for_user", "paused for the owner");
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(env.launched.length, 1, "no automatic replay on any provider");
    const [edited] = env.missions.store.steps(view.id);
    assert.equal(edited.state, "failed");
    assert.equal(edited.reconciliation?.required, true);
    assert.equal(env.tasks.db.get(firstTask).reconciliation?.required, true, "the child task records it too");
    // Ordinary Retry and a paired device cannot bypass it.
    assert.throws(() => env.missions.retry(view.id, "workstation"), /OUTCOME_UNCERTAIN/);
    await assert.rejects(missionCommand(env.missions, "mission.reconcile", { id: view.id, stepId: edited.id, resolution: "retry" }, { local: false, actor: "device:phone" }), /workstation/);
    assert.equal(env.launched.length, 1);
    // The owner reviewed the workspace and chose to retry: same Mission, same step, a fresh child task.
    await missionCommand(env.missions, "mission.reconcile", { id: view.id, stepId: edited.id, resolution: "retry" }, { local: true, actor: "workstation" });
    await until(() => env.launched.length === 2, "the reconciled retry");
    assert.equal(env.launched[1].task.mission?.stepId, edited.id);
    assert.notEqual(env.launched[1].task.id, firstTask);
    assert.equal(env.missions.store.step(edited.id).reconciliation?.resolution, "retry");
    assert.equal(env.launched[1].task.provider, provider);
    env.launched[1].finish({ ok: true, output: "edited" });
    await until(() => env.missions.mission(view.id).state === "completed", "completed after reconciliation");
  } finally { await env.cleanup(); }
});

test("T13.3 N-D: an address or port containing 429 is not quota evidence", () => {
  assert.equal(classifyTaskFailure("connect ECONNREFUSED 127.0.0.1:14290", "failed"), "provider_failed");
  assert.equal(classifyTaskFailure("HTTP 429 Too Many Requests", "failed"), "provider_rate_limited");
  const paused = retryVerdict(classifyTaskFailure("stream reset. all_eligible_models_failed — WRITE_PAUSE: the connection kept failing", "failed"), 1, 2, 0, 10, "write");
  assert.deepEqual([paused.retry, paused.reroute, paused.waitForUser], [false, false, true]);
});

test("T13.3 F quota exhaustion in a read step still reroutes within bounds", async () => {
  const env = await setup(["claude", "codex"]);
  try {
    const view = env.missions.create({ objective: "Inspect", mode: "balanced", origin: "workstation", steps: [model("Reader", "Inspect files", [], { access: "read", maxRetries: 2 })] });
    env.missions.approve(view.id, "workstation");
    await until(() => env.launched.length === 1, "reader");
    const firstProvider = env.launched[0].task.provider;
    env.launched[0].finish({ ok: false, output: "", error: "HTTP 429 rate limit" });
    await until(() => env.launched.length === 2, "rerouted reader");
    assert.notEqual(env.launched[1].task.provider, firstProvider);
    env.launched[1].finish({ ok: true, output: "ok" });
    await until(() => env.missions.mission(view.id).state === "completed", "done");
  } finally { await env.cleanup(); }
});

/** A real filesystem capability whose first write lands and then loses its connection (an uncertain outcome). */
class LandsThenDrops extends FilesystemCapability {
  calls = 0;
  override async execute(...args: Parameters<FilesystemCapability["execute"]>) {
    const result = await super.execute(...args);
    if (args[0] === "filesystem.write" && this.calls++ === 0) throw new Error("connection reset after the write was sent");
    return result;
  }
}
const writeStep = (params: Record<string, unknown>) => ({ role: "Writer", objective: "write the file", dependsOn: [], maxRetries: 2, executor: { kind: "capability", action: "filesystem.write", params } });

test("T13.3 N-C 7: a write with Host-enforced duplicate protection retries after an uncertain outcome and lands exactly once", async () => {
  const flaky = new LandsThenDrops();
  const env = await setup([], flaky);
  try {
    const view = env.missions.create({ objective: "Write once", mode: "fast", origin: "workstation", steps: [writeStep({ path: "out.txt", content: "hello", expectBeforeSha256: "absent" })] });
    env.missions.approve(view.id, "workstation");
    await until(() => ["completed", "failed", "waiting_for_user"].includes(env.missions.mission(view.id).state), "mission end", 20_000);
    const [step] = env.missions.store.steps(view.id);
    assert.equal(env.missions.mission(view.id).state, "completed", JSON.stringify(step.failure));
    assert.equal(flaky.calls, 2, "one uncertain attempt, one guarded retry");
    assert.equal(readFileSync(join(env.root, "out.txt"), "utf8"), "hello");
    assert.equal(step.reconciliation, undefined, "the pre-image guard made the replay safe, so nothing waits for the owner");
    assert.match(step.result?.summary ?? "", /Already applied/, "the retry detected the landed write instead of writing again");
  } finally { await env.cleanup(); }
});

test("T13.3 N-C 8: a claim of idempotency the Host does not enforce is ignored; the uncertain write waits for the owner", async () => {
  const flaky = new LandsThenDrops();
  const env = await setup([], flaky);
  try {
    // No pre-image guard. The step says it is idempotent and carries a key; neither is a mechanism the Host enforces.
    const view = env.missions.create({ objective: "Claimed idempotent", mode: "fast", origin: "workstation", steps: [writeStep({ path: "claimed.txt", content: "hello", overwrite: true, idempotent: true, idempotencyKey: "claimed-1" })] });
    env.missions.approve(view.id, "workstation");
    await until(() => ["completed", "failed", "waiting_for_user"].includes(env.missions.mission(view.id).state), "mission end", 20_000);
    const [step] = env.missions.store.steps(view.id);
    assert.equal(env.missions.mission(view.id).state, "waiting_for_user", JSON.stringify(step.failure));
    assert.equal(flaky.calls, 1, "no replay");
    assert.equal(step.reconciliation?.required, true);
    assert.match(step.reconciliation?.reason ?? "", /OUTCOME_UNCERTAIN: filesystem.write started/);
  } finally { await env.cleanup(); }
});
