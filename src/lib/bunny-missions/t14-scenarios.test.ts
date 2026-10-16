import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostDatabase } from "../bunny-host/persistence.server.ts";
import { ModelCapabilityRegistry } from "../bunny-host/model-capability.server.ts";
import { TaskManager } from "../bunny-host/manager.server.ts";
import { providerBase } from "../bunny-host/adapters.server.ts";
import type { AdapterHooks, AdapterResult, ProviderAdapter } from "../bunny-host/contracts.ts";
import type { OrchTask, ProviderId, ProviderLive } from "../orch/types.ts";
import type { TeamFaults } from "./team-coordination.server.ts";
import { MissionManager } from "./manager.server.ts";
import { FilesystemCapability, NotificationsCapability, TerminalCapability } from "./capabilities/local.server.ts";
import { autonomyPhase, type AutonomyPhase } from "./autonomy.ts";
import { simulatedCodexProfile } from "../bunny-host/testing/codex.test.ts";
import { teamSetup, createTeam, missionOf, reachReview, approvePlan, until as teamUntil } from "../bunny-host/agent-team.fixture.ts";

/**
 * M-A-3 T14 autonomous Mission scenarios on the real MissionManager / TaskManager / Capability Bus. Model I/O is a
 * scripted stand-in (SIMULATED); planning validation, scheduling, retries, verification, rework, reconciliation and
 * recovery are the real Host code. A: autonomous repair. D: provider failure. E: uncertain write. L: long run.
 */

function ready(id: ProviderId): ProviderLive {
  return { ...providerBase(id), installed: true, authenticated: true, availability: "ready", capabilities: ["filesystem", "terminal", "text"], current_model: null, ...(id === "codex" ? { securityCompatibility: simulatedCodexProfile() } : {}) };
}
type Launched = { task: OrchTask; finish: (result: AdapterResult) => void; hooks: AdapterHooks };
function fakeAdapter(id: ProviderId, launched: Launched[]): ProviderAdapter {
  return { id, detect: async () => ready(id), launch: (task, hooks) => {
    let finish!: (result: AdapterResult) => void;
    const done = new Promise<AdapterResult>((resolve) => (finish = resolve));
    launched.push({ task, finish, hooks });
    return { done, stop: async () => finish({ ok: false, output: "", stopped: true }) };
  } };
}
const until = async (check: () => boolean, label: string, timeout = 8000) => {
  const start = Date.now();
  while (!check()) { if (Date.now() - start > timeout) throw new Error(`Timed out waiting for ${label}`); await new Promise((r) => setTimeout(r, 10)); }
};
async function setup(providers: ProviderId[] = ["claude"], options: { dir?: string; root?: string } = {}) {
  const dir = options.dir ?? mkdtempSync(join(tmpdir(), "bunny-t14-m-"));
  const root = options.root ?? join(dir, "project");
  mkdirSync(root, { recursive: true });
  const db = new HostDatabase(join(dir, "host.sqlite"));
  const launched: Launched[] = [];
  const tasks = new TaskManager(db, root, providers.map((id) => fakeAdapter(id, launched)), { modelRegistry: new ModelCapabilityRegistry(db, { availableProviders: () => [] }) });
  await tasks.discover();
  const missions = new MissionManager(tasks, { dataDirectory: dir, adapters: [new FilesystemCapability(), new TerminalCapability(), new NotificationsCapability(() => undefined)] });
  missions.configure({ enabled: true }, "test");
  await missions.bus.refreshHealth();
  const close = async () => { await missions.close(); try { db.close(); } catch { /* closed */ } };
  return { dir, root, db, tasks, missions, launched, close, cleanup: async () => { await close(); rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } };
}
const model = (role: string, objective: string, dependsOn: number[] = [], extra: Record<string, unknown> = {}) => ({ role, objective, dependsOn, executor: { kind: "model" }, ...extra });
const phaseOf = (env: { missions: MissionManager }, id: string) => env.missions.view(env.missions.mission(id)).autonomy!.phase;
/** Every distinct T14 phase a Mission passes through, read from its canonical view after each Host event. */
function phaseTrail(bus: { on: (event: "event", fn: (event: { missionId?: string | null }) => void) => unknown }, read: () => AutonomyPhase | null): AutonomyPhase[] {
  const trail: AutonomyPhase[] = [];
  bus.on("event", () => {
    const phase = read();
    if (phase && trail.at(-1) !== phase) trail.push(phase);
  });
  return trail;
}

test("T14-A: one approval, then plan → delegate → execute → verify → repair → complete with no owner prompt", async () => {
  // The Implementer's first page misses the required summary; the Host's check fails and the reviewed rework repairs it.
  const faults: TeamFaults = { seedOutput: ({ kind, round, text }) => (kind === "generate_html" && round === 0 ? text.replace(' id="summary"', "") : null) };
  const env = await teamSetup("t14a", { faults });
  try {
    const { coordinatorId, missionId } = createTeam(env);
    const trail = phaseTrail(env.tasks.bus, () => { try { return missionOf(env, missionId).autonomy?.phase ?? null; } catch { return null; } });
    await reachReview(env, coordinatorId, missionId);
    assert.equal(missionOf(env, missionId).autonomy?.phase, "WAITING_AUTHORIZATION", "the one owner decision is the reviewed plan");
    await approvePlan(env, coordinatorId, missionId);
    const done = await teamUntil(() => { const m = missionOf(env, missionId); return ["completed", "failed", "waiting_for_user"].includes(m.state) ? m : null; }, "team completion", 60_000);
    assert.equal(done.state, "completed", JSON.stringify(done.steps.map((step) => [step.team?.key, step.state, step.failure?.detail])));
    assert.equal(done.requests.length, 0, "nothing asked the owner after the plan approval");
    assert.equal(done.team!.reworkRounds, 1, "the failed check was repaired autonomously");
    assert.match(readFileSync(join(env.root, "team-out", "index.html"), "utf8"), /id="summary"/);
    for (const phase of ["PLAN", "WAITING_AUTHORIZATION", "EXECUTE", "VERIFY", "REPAIR", "COMPLETE"] as const) assert.ok(trail.includes(phase), `${phase} in ${trail.join(" → ")}`);
    assert.ok(trail.indexOf("REPAIR") < trail.lastIndexOf("COMPLETE"), "completion follows the repair");
    assert.equal(done.autonomy?.phase, "COMPLETE");
    // Completion is evidence-gated: `verified` says whether every step passed Bunny's own checks.
    assert.equal(done.autonomy?.verified, done.result!.unverifiedSteps === 0);
    console.log(`T14-A trail: ${trail.join(" → ")}; verified=${done.autonomy?.verified}; ${done.result?.summary}`);
  } finally { await env.cleanup(); }
});

test("T14-A: a raw write-capable provider session whose check fails is never auto-replayed (N-C kept)", async () => {
  const env = await setup();
  try {
    const view = env.missions.create({ objective: "Make file", mode: "fast", origin: "workstation", steps: [model("Coding", "create done.txt", [], { access: "write", verification: [{ kind: "file_exists", path: "done.txt" }] })] });
    env.missions.approve(view.id, "workstation");
    await until(() => env.launched.length === 1, "first attempt");
    env.launched[0].finish({ ok: true, output: "I created done.txt and it works." });
    await until(() => env.missions.mission(view.id).state === "waiting_for_user", "paused");
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(env.launched.length, 1, "the plausible success message did not complete the step, and nothing replayed");
    assert.equal(phaseOf(env, view.id), "RECONCILIATION_REQUIRED");
  } finally { await env.cleanup(); }
});

test("T14-D: provider loss reroutes read work to an eligible fallback; retries are bounded (WAITING_RESOURCE); quota loss mid-write pauses for reconciliation", async () => {
  const env = await setup(["claude", "codex"]);
  try {
    // Read work: the first provider disconnects, the next eligible one finishes it.
    const read = env.missions.create({ objective: "Inspect", mode: "balanced", origin: "workstation", steps: [model("Reader", "Inspect files", [], { access: "read", maxRetries: 1 })] });
    env.missions.approve(read.id, "workstation");
    await until(() => env.launched.length === 1, "reader");
    const first = env.launched[0].task.provider;
    env.launched[0].finish({ ok: false, output: "", error: "provider unavailable: connection lost" });
    await until(() => env.launched.length === 2, "fallback");
    assert.notEqual(env.launched[1].task.provider, first, "rerouted to the other eligible provider");
    env.launched[1].finish({ ok: true, output: "inspected" });
    await until(() => env.missions.mission(read.id).state === "completed", "read done");

    // Bounded: a second read whose every attempt fails stops after maxRetries and waits; it does not loop.
    const flaky = env.missions.create({ objective: "Inspect again", mode: "balanced", origin: "workstation", steps: [model("Reader", "Inspect files", [], { access: "read", maxRetries: 1 })] });
    env.missions.approve(flaky.id, "workstation");
    await until(() => env.launched.length === 3, "flaky first");
    env.launched[2].finish({ ok: false, output: "", error: "HTTP 429 rate limit" });
    await until(() => env.launched.length === 4, "flaky retry");
    env.launched[3].finish({ ok: false, output: "", error: "HTTP 429 rate limit" });
    await until(() => env.missions.mission(flaky.id).state === "waiting_for_user", "flaky paused");
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(env.launched.length, 4, "two attempts, then it waits");
    assert.equal(phaseOf(env, flaky.id), "WAITING_RESOURCE");

    // Write work: quota runs out mid-write; no provider switch, no second write.
    const write = env.missions.create({ objective: "Edit", mode: "balanced", origin: "workstation", steps: [model("Writer", "Edit file", [], { access: "write", maxRetries: 2 })] });
    env.missions.approve(write.id, "workstation");
    await until(() => env.launched.length === 5, "writer");
    env.launched[4].finish({ ok: false, output: "", error: "HTTP 429: usage limit reached (quota exceeded)." });
    await until(() => env.missions.mission(write.id).state === "waiting_for_user", "write paused");
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(env.launched.length, 5, "no reroute and no duplicate write");
    // The write may already have started, so reconciliation outranks the resource wait.
    assert.equal(env.missions.store.steps(write.id)[0].failure?.category, "provider_rate_limited");
    assert.equal(phaseOf(env, write.id), "RECONCILIATION_REQUIRED");
  } finally { await env.cleanup(); }
});

test("T14-E: a write that may have started and then lost its connection is never replayed; only the owner's reconciliation moves it", async () => {
  const env = await setup(["claude", "codex"]);
  try {
    const view = env.missions.create({ objective: "Edit", mode: "balanced", origin: "workstation", steps: [model("Writer", "Edit file", [], { access: "write", maxRetries: 2 })] });
    env.missions.approve(view.id, "workstation");
    await until(() => env.launched.length === 1, "writer");
    env.launched[0].finish({ ok: false, output: "", error: "connection reset after the request was sent" });
    await until(() => env.missions.mission(view.id).state === "waiting_for_user", "paused for reconciliation");
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(env.launched.length, 1, "the uncertain write was not replayed on any provider, despite maxRetries 2");
    const step = env.missions.store.steps(view.id)[0];
    assert.equal(step.reconciliation?.required, true);
    assert.equal(phaseOf(env, view.id), "RECONCILIATION_REQUIRED");
    assert.match(env.missions.view(env.missions.mission(view.id)).autonomy!.basis, /Outcome uncertain — reconciliation required/);
    assert.throws(() => env.missions.retry(view.id, "workstation"), /OUTCOME_UNCERTAIN/);
    await env.missions.reconcile(view.id, step.id, "retry", "workstation");
    await until(() => env.launched.length === 2, "owner-chosen retry");
    env.launched[1].finish({ ok: true, output: "edited" });
    await until(() => env.missions.mission(view.id).state === "completed", "completed");
    assert.equal(phaseOf(env, view.id), "COMPLETE");
  } finally { await env.cleanup(); }
});

test("T14-L: an accelerated long Mission survives a crash at a checkpoint without duplicate dispatch and stays within its limits", async () => {
  const first = await setup();
  const snapshotDir = mkdtempSync(join(tmpdir(), "bunny-t14-l-"));
  let missionId = "";
  const steps = Array.from({ length: 10 }, (_, index) => model(`Stage${index + 1}`, `Stage ${index + 1}`, index ? [index - 1] : [], { access: "read" }));
  try {
    const view = first.missions.create({ objective: "Ten-stage run", mode: "deep", origin: "workstation", steps });
    missionId = view.id;
    first.missions.approve(view.id, "workstation");
    for (let n = 0; n < 6; n++) {
      await until(() => first.launched.length === n + 1, `stage ${n + 1}`);
      first.launched[n].finish({ ok: true, output: `stage ${n + 1} done` });
    }
    await until(() => first.launched.length === 7, "stage 7 dispatched");
    // Crash with stage 7 in flight: the durable state at this instant becomes a fresh Host.
    first.db.db.exec(`VACUUM INTO '${join(snapshotDir, "host.sqlite").replaceAll("'", "''")}'`);
  } catch (error) { await first.cleanup(); rmSync(snapshotDir, { recursive: true, force: true }); throw error; }
  const second = await setup(["claude"], { dir: snapshotDir, root: first.root });
  try {
    const recovered = second.missions.mission(missionId);
    assert.equal(recovered.state, "waiting_for_user", "recovery reconciles before dispatching anything");
    assert.equal(second.launched.length, 0, "no duplicate dispatch after restart");
    const rows = second.missions.store.steps(missionId);
    assert.equal(rows.filter((s) => s.state === "completed").length, 6, "verified checkpoints survived");
    second.missions.retry(missionId, "workstation");
    for (let n = 0; n < 4; n++) {
      await until(() => second.launched.length === n + 1, `resumed stage ${n + 7}`);
      second.launched[n].finish({ ok: true, output: `stage ${n + 7} done` });
    }
    await until(() => second.missions.mission(missionId).state === "completed", "completed");
    const final = second.missions.store.steps(missionId);
    assert.ok(final.every((s) => s.attempts.filter((a) => a.outcome === "completed").length === 1), "every stage completed exactly once");
    assert.equal(final.find((s) => s.role === "Stage7")!.attempts[0].outcome, "interrupted");
    assert.ok(second.missions.memory.entries(missionId).length <= 300, "working memory stays within its bound");
    // The interrupted attempt is charged too: 11 external calls against the deep-mode allowance of 12.
    assert.equal(second.missions.mission(missionId).accounting.externalModelCalls, 11);

    // Accelerated clock: the same Host check that ends a Mission after its runtime limit, with the start moved back.
    const longRun = second.missions.create({ objective: "Prolonged", mode: "fast", origin: "workstation", steps: [model("Slow", "a"), model("Next", "b", [0])] });
    second.missions.approve(longRun.id, "workstation");
    await until(() => second.launched.length === 5, "slow launched");
    const started = second.missions.mission(longRun.id);
    second.missions.store.saveMission({ ...started, startedAt: Date.now() - 3 * 60 * 60_000 });
    second.launched[4].finish({ ok: true, output: "a" });
    await until(() => second.missions.mission(longRun.id).state === "failed", "runtime limit enforced");
    assert.equal(second.missions.mission(longRun.id).failure?.category, "budget_exceeded");
    assert.equal(second.launched.length, 5, "no step started past the limit");
    assert.equal(phaseOf(second, longRun.id), "FAILED");
  } finally {
    await second.cleanup();
    await first.missions.close();
    first.launched.at(-1)?.finish({ ok: false, output: "", error: "old process gone" });
    await new Promise((r) => setTimeout(r, 30));
    await first.cleanup();
  }
});

test("T14 autonomy projection: COMPLETE needs canonical completion, never a final message", () => {
  const step = (state: string, extra: Record<string, unknown> = {}) => ({ state, attempts: [], failure: null, ...extra }) as never;
  assert.equal(autonomyPhase({ state: "running", steps: [step("running", { attempts: [{ outcome: "completed" }] })], requests: [], result: null }).phase, "OBSERVE");
  assert.equal(autonomyPhase({ state: "running", steps: [step("completed")], requests: [], result: null }, { open: 2, verified: 0, unverified: 0 }).phase, "WAITING_DEPENDENCY");
  const done = autonomyPhase({ state: "completed", steps: [step("completed")], requests: [], result: { unverifiedSteps: 0 } }, { open: 0, verified: 1, unverified: 1 });
  assert.deepEqual([done.phase, done.verified], ["COMPLETE", false], "an unverified worker keeps completion unverified");
  assert.equal(autonomyPhase({ state: "running", steps: [step("running", { reconciliation: { required: true } })], requests: [], result: null }).phase, "OUTCOME_UNCERTAIN");
  assert.equal(autonomyPhase({ state: "waiting_for_user", steps: [step("failed", { failure: { category: "dependency_failed" } })], requests: [], result: null }).phase, "WAITING_DEPENDENCY");
  assert.equal(autonomyPhase({ state: "stopped", steps: [], requests: [], result: null }).phase, "CANCELLED");
});
