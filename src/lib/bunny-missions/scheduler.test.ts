import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostDatabase } from "../bunny-host/persistence.server.ts";
import { ModelCapabilityRegistry } from "../bunny-host/model-capability.server.ts";
import { TaskManager } from "../bunny-host/manager.server.ts";
import { providerBase } from "../bunny-host/adapters.server.ts";
import { DEFAULT_FAIRNESS, admitStep, readFairness, validateFairness, type FairnessSettings } from "../bunny-host/fairness.ts";
import type { AdapterHooks, AdapterResult, ProviderAdapter } from "../bunny-host/contracts.ts";
import type { OrchTask, ProviderId, ProviderLive } from "../orch/types.ts";
import { MissionManager } from "./manager.server.ts";
import { retryVerdict } from "./machine.ts";
import { FilesystemCapability } from "./capabilities/local.server.ts";
import { simulatedCodexProfile } from "../bunny-host/testing/codex.test.ts";

/** M-A-3 T13.3 Gate F: Personal Agent fairness admission and quota-safe continuation of write steps. */

const settings = (patch: Partial<FairnessSettings> = {}): FairnessSettings => ({ ...structuredClone(DEFAULT_FAIRNESS), ...patch });
const base = { settings: settings(), live: {}, waiting: [], since: 100, memoryUsedPercent: 40 };

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
async function setup(providers: ProviderId[]) {
  const dir = mkdtempSync(join(tmpdir(), "bunny-t13-3-sched-"));
  const root = join(dir, "project"); mkdirSync(root, { recursive: true });
  const db = new HostDatabase(join(dir, "host.sqlite"));
  const launched: Launched[] = [];
  const tasks = new TaskManager(db, root, providers.map((id) => fakeAdapter(id, launched)), { modelRegistry: new ModelCapabilityRegistry(db, { availableProviders: () => [] }) });
  await tasks.discover();
  const missions = new MissionManager(tasks, { dataDirectory: dir, adapters: [new FilesystemCapability()] });
  missions.configure({ enabled: true }, "test");
  await missions.bus.refreshHealth();
  const cleanup = async () => { await missions.close(); try { db.close(); } catch { /* already closed */ } rmSync(dir, { recursive: true, force: true }); };
  return { tasks, missions, launched, cleanup };
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
