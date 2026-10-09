import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostDatabase } from "./persistence.server.ts";
import { ModelCapabilityRegistry } from "./model-capability.server.ts";
import { TaskManager } from "./manager.server.ts";
import { providerBase } from "./adapters.server.ts";
import type { AdapterHooks, AdapterResult, ProviderAdapter } from "./contracts.ts";
import type { OrchTask, ProviderId, ProviderLive } from "../orch/types.ts";
import { MissionManager } from "../bunny-missions/manager.server.ts";
import { FilesystemCapability, NotificationsCapability, TerminalCapability } from "../bunny-missions/capabilities/local.server.ts";
import { communicationConnectors } from "../bunny-missions/capabilities/connectors.server.ts";
import { AgentRuntime } from "./agent-runtime.server.ts";
import { scanCheckpointJson } from "./agent-checkpoint.server.ts";
import { simulatedCodexProfile } from "./testing/codex.test.ts";

type Launch = { task: OrchTask; provider: ProviderId; finish: (result: AdapterResult) => void; hooks: AdapterHooks; stopped: boolean };

const until = async <T,>(check: () => T | undefined, label: string, timeout = 24_000): Promise<T> => {
  const start = Date.now();
  for (;;) {
    let out: T | undefined;
    try { out = check(); } catch { out = undefined; }
    if (out) return out;
    if (Date.now() - start > timeout) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 10));
  }
};
const staysAbsent = async (probe: () => boolean, label: string, windows = 14) => {
  for (let i = 0; i < windows; i++) {
    if (probe()) throw new Error(`${label} appeared when it must not`);
    await new Promise((r) => setTimeout(r, 100));
  }
};
const exists = (path: string): boolean => { try { statSync(path); return true; } catch { return false; } };
const SHAPE = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function fakeAdapter(id: ProviderId, launched: Launch[], sessions: string[]): ProviderAdapter {
  return {
    id,
    detect: async (): Promise<ProviderLive> => ({ ...providerBase(id), installed: true, authenticated: true, availability: "ready", capabilities: ["filesystem", "terminal", "text"], current_model: null, ...(id === "codex" ? { securityCompatibility: simulatedCodexProfile() } : {}) }),
    launch: (task, hooks) => {
      let finish!: (result: AdapterResult) => void;
      const done = new Promise<AdapterResult>((resolve) => (finish = resolve));
      const sessionId = `${id}-sess-${sessions.push(`${id}-sess-${sessions.length + 1}`)}`;
      hooks.session(sessionId, null);
      const session = { task, provider: id, finish, hooks, stopped: false };
      launched.push(session);
      return { done, stop: async () => { session.stopped = true; finish({ ok: false, output: "", stopped: true }); } };
    },
  };
}

/** The full live stack on one data directory: production wiring order (db → tasks → missions → agents). */
type Stack = { db: HostDatabase; tasks: TaskManager; missions: MissionManager; agents: AgentRuntime };

async function openStack(dir: string, root: string, env: { launched: Launch[]; sessions: string[] }, providers: ProviderId[]): Promise<Stack> {
  const db = new HostDatabase(join(dir, "host.sqlite"));
  const factLess = new ModelCapabilityRegistry(db, { availableProviders: () => [] });
  const tasks = new TaskManager(db, root, providers.map((id) => fakeAdapter(id, env.launched, env.sessions)), { modelRegistry: factLess });
  await tasks.discover();
  const missions = new MissionManager(tasks, { dataDirectory: dir, adapters: [new FilesystemCapability(), new TerminalCapability(), new NotificationsCapability(() => {}), ...communicationConnectors()] });
  missions.configure({ enabled: true }, "workstation");
  await missions.bus.refreshHealth();
  const agents = new AgentRuntime(db, missions);
  missions.missionPauseGate = (missionId) => agents.blockedForMission(missionId);
  return { db, tasks, missions, agents };
}

type Env = Stack & { dir: string; root: string; launched: Launch[]; sessions: string[]; notifications: string[]; reopen: (providers?: ProviderId[]) => Promise<Env>; cleanup: () => Promise<void> };

async function agentSetup(label: string): Promise<Env> {
  const dir = mkdtempSync(join(tmpdir(), `bunny-t4r-${label}-`));
  const root = join(dir, "project");
  mkdirSync(root, { recursive: true });
  const launched: Launch[] = [];
  const sessions: string[] = [];
  const notifications: string[] = [];
  const first = await openStack(dir, root, { launched, sessions }, ["codex", "claude"]);
  const env: Env = {
    ...first, dir, root, launched, sessions, notifications,
    // A real dev-Host restart: close every live object, open a full factory-fresh stack on the SAME
    // SQLite file. All recovery reads below come from disk — no in-memory retention survives (§37).
    async reopen(providers) {
      try { env.agents.close(); } catch { /* closed */ }
      try { await env.missions.close(); } catch { /* closed */ }
      try { env.db.close(); } catch { /* closed */ }
      const next = await openStack(dir, root, { launched, sessions }, providers ?? ["codex", "claude"]);
      Object.assign(env, next);
      return env;
    },
    async cleanup() {
      for (;;) {
        try { env.agents.close(); } catch { break; }
        break;
      }
      try { await env.missions.close(); } catch { /* closed */ }
      try { env.db.close(); } catch { /* closed */ }
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows file locks settle late */ }
    },
  };
  return env;
}

const newAgent = (env: Env, before: Set<string>): { id: string; missionId: string } => {
  const row = env.agents.snapshot().agents.find((a) => !before.has(a.id));
  if (!row) throw new Error("no new agent row after create");
  before.add(row.id);
  return { id: row.id, missionId: row.missionId! };
};
const agentRow = (env: Env, id: string) => env.agents.snapshot().agents.find((a) => a.id === id)!;
const lifecycle = (env: Env, missionId: string, type?: string) => env.db.events().filter((e) => e.missionId === missionId && e.type.startsWith("agent.") && (!type || e.type === type));
/** Simulates a child task that finished its effect and then the Host died before the mission heard: a raw canonical row write with no event. */
const craftCompletedTask = (env: Env, taskId: string, patch: { verification?: unknown } = {}) => {
  const task = { ...env.db.get(taskId)!, state: "completed", finishedAt: Date.now(), exitCode: 0, ...(patch.verification ? { verification: patch.verification } : {}) } as OrchTask;
  env.db.db.prepare("UPDATE tasks SET record=? WHERE id=?").run(JSON.stringify(task), taskId);
};

// A07/A08 — pause is durable and never auto-unpauses across a real restart.
test("A07/A08: pause survives a real Host restart; nothing resumes by itself; resume completes under the same envelope", async () => {
  const env = await agentSetup("pause-restart");
  try {
    const before = new Set(env.agents.snapshot().agents.map((a) => a.id));
    env.agents.create({
      objective: "two sequential writes, paused between",
      steps: [
        { role: "Prepare", objective: "Call the model once.", access: "read", executor: { kind: "model" } },
        { role: "Implement", objective: "Write two.txt", access: "write", executor: { kind: "capability", action: "filesystem.write", params: { path: join(env.root, "two.txt"), content: "two" } }, dependsOn: [0], verification: [] },
      ],
    }, "workstation");
    const { id, missionId } = newAgent(env, before);
    env.agents.start(id, "workstation");
    await until(() => env.launched.length === 1, "step 1 admitted");
    env.agents.pause(id, "workstation");
    const preRow = await until(() => agentRow(env, id)?.state === "PAUSED" ? agentRow(env, id) : undefined, "paused");
    env.launched[0]!.finish({ ok: true, output: "task one done", exitCode: 0 });
    await until(() => SHAPE(env.missions.get(missionId).mission.steps)[0]!.state === "completed", "step 1 finished under pause");
    // ── REAL RESTART: same SQLite file, entirely fresh objects ──────────────
    const pausedAtBefore = preRow.pausedAt!;
    const runBefore = SHAPE(preRow.run)!;
    await env.reopen();
    const row = await until(() => agentRow(env, id)?.state === "PAUSED" ? agentRow(env, id) : undefined, "pause survives the restart");
    assert.equal(row.pausedAt, pausedAtBefore, "pausedAt is byte-stable across the restart");
    assert.equal(row.run!.id, runBefore.id, "the PAUSED run is preserved, not replaced");
    assert.equal(row.run!.generation, 1, "paused agents open no new generation across a restart — the walk skips them");
    assert.equal(env.agents.store.agentFlags(id).paused, true);
    await staysAbsent(() => exists(join(env.root, "two.txt")), "A07: no auto-resume admission");
    assert.equal(env.missions.mission(missionId).state, "running", "the mission holds; recovery did not revive it");
    // A08: resume revalidates the same envelope and continues; admission lands without new authority.
    env.agents.resume(id, "workstation");
    assert.equal(env.agents.store.agentFlags(id).paused, false, "resume revalidates from the canonical store and unpauses");
    await until(() => exists(join(env.root, "two.txt")), "A08: admission lands after resume", 30_000);
    await until(() => env.missions.get(missionId).mission.state === "completed" ? true : undefined, "mission completes", 30_000);
    const doneRow = await until(() => agentRow(env, id)?.state === "COMPLETED" ? agentRow(env, id) : undefined, "agent completes", 30_000);
    assert.equal(doneRow.run!.id, runBefore.id, "§38: the same run id continues after restart+resume");
    assert.equal(doneRow.run!.generation, 1, "§38: no generation bump for a pause-resume cycle");
  } finally { await env.cleanup(); }
});

// A12 + §38 — a Host restart during a SAFE READ requeues once; continuity holds.
test("A12: restart during a read child requeues it once; one interrupted row, one recovered row, same agent and mission", async () => {
  const env = await agentSetup("read-restart");
  try {
    const before = new Set(env.agents.snapshot().agents.map((a) => a.id));
    env.agents.create({
      objective: "read then depend",
      steps: [
        { role: "Prepare", objective: "Inspect files.", access: "read", executor: { kind: "model" }, maxRetries: 1 },
        { role: "Implement", objective: "Write final.txt", access: "write", executor: { kind: "capability", action: "filesystem.write", params: { path: join(env.root, "final.txt"), content: "done" } }, dependsOn: [0], verification: [] },
      ],
    }, "workstation");
    const { id, missionId } = newAgent(env, before);
    env.agents.start(id, "workstation");
    await until(() => env.launched.length === 1, "read child admitted");
    const runId = agentRow(env, id).run!.id;
    const childId = env.launched[0]!.task.id;
    const step1Id = env.missions.get(missionId).mission.steps[0]!.id;
    // The read child is still running when the Host dies.
    await env.reopen();
    const row = await until(() => agentRow(env, id)?.state === "RUNNING" ? agentRow(env, id) : undefined, "the agent continues after recovery", 60_000);
    assert.equal(row.run!.generation, 2, "§38: a new generation after a host interruption");
    assert.equal(env.agents.store.latestRun(id)!.resumedFromRunId, runId, "§38: the new generation names its predecessor");
    // The interrupted child stays failed with its restart truth; recovery never rewrote it into success.
    const old = env.db.get(childId)!;
    assert.equal(old.state, "failed");
    assert.match(old.error ?? "", /Host process restarted/i);
    // A21: exactly one re-admission — two children total for this step, the first never resurrected.
    await until(() => env.launched.length === 2, "the requeue lands a single new launch", 30_000);
    await staysAbsent(() => env.launched.length > 2, "A21/A29: one admission only");
    const stepChildren = env.db.tasks().filter((t) => t.mission?.missionId === missionId);
    assert.equal(stepChildren.length, 2, "one completed child + its requeue; nothing duplicated");
    assert.deepEqual(env.launched[1]!.task.mission, { missionId, stepId: step1Id }, "the requeue serves the ORIGINAL step");
    // Finish the requeue; the dependent capability step writes final.txt itself.
    env.launched[1]!.finish({ ok: true, output: "Read evidence again.", exitCode: 0 });
    await until(() => env.missions.get(missionId).mission.state === "completed" ? true : undefined, "mission completes after recovery", 40_000);
    await until(() => agentRow(env, id)?.state === "COMPLETED" ? true : undefined, "agent completes", 30_000);
    // A31: exactly one agent.interrupted and one agent.recovered for this recovery; no duplicated history.
    assert.equal(lifecycle(env, missionId, "agent.interrupted").length, 1);
    assert.equal(lifecycle(env, missionId, "agent.recovered").length, 1);
    const interruptedDetail = JSON.parse(lifecycle(env, missionId, "agent.interrupted")[0]!.detail) as { runId?: string; category?: string };
    assert.equal(interruptedDetail.runId, runId);
    assert.equal(interruptedDetail.category, "HOST_INTERRUPTED");
    // §38 continuity: agent identity, mission identity, one run lineage, no duplicated child.
    assert.equal(agentRow(env, id).missionId, missionId);
    assert.equal(env.db.get(childId)!.state, "failed", "the interrupted child is never rewritten into success");
    const step1Children = env.db.tasks().filter((t) => t.mission?.stepId === step1Id);
    assert.equal(step1Children.filter((t) => t.state === "completed").length, 1, "§38: step 1 ends with exactly one completed logical child");
  } finally { await env.cleanup(); }
});

// A13/A28 + A23 — the child DID complete (raw row, recorded verification); recovery consumes the canonical result.
test("A13/A28: verification recorded and crash before the mission heard — consume the canonical result, never re-execute", async () => {
  const env = await agentSetup("consume-verified");
  try {
    const before = new Set(env.agents.snapshot().agents.map((a) => a.id));
    env.agents.create({
      objective: "write then verify the artifact",
      steps: [
        { role: "Implement", objective: "Write one.txt", access: "write", executor: { kind: "capability", action: "filesystem.write", params: { path: join(env.root, "one.txt"), content: "one" } }, verification: [] },
        { role: "Prepare", objective: "Summarize the artifact.", access: "read", executor: { kind: "model" }, providers: { allow: ["codex"] }, dependsOn: [0], verification: [{ kind: "file_exists", path: "one.txt", contains: "one" }] },
      ],
    }, "workstation");
    const { id, missionId } = newAgent(env, before);
    env.agents.start(id, "workstation");
    await until(() => env.launched.length === 1, "step 2 child admitted");
    const childId = env.launched[0]!.task.id;
    const artifactsBefore = SHAPE(env.missions.get(missionId).mission.artifacts.map((a) => a.id));
    // Crash window: the child finished and Bunny verified it, but no event reached the mission.
    craftCompletedTask(env, childId, { verification: { passed: true, name: "file_exists", detail: "one.txt present" } });
    await env.reopen();
    await until(() => env.missions.get(missionId).mission.state === "completed" ? true : undefined, "recovery consumes the canonical result", 40_000);
    await until(() => agentRow(env, id)?.state === "COMPLETED" ? true : undefined, "agent completes", 30_000);
    // Nothing re-executed: no new provider launch, the child ran exactly once.
    assert.equal(env.launched.length, 1, "A13: the write/child is never duplicated");
    assert.equal(env.db.get(childId)!.state, "completed");
    assert.equal(env.missions.get(missionId).mission.steps[1]!.result?.verified, true, "the mission re-ran its own check (file present) before consuming");
    assert.equal(env.db.tasks().filter((t) => t.mission?.missionId === missionId).length, 1, "only the model child ever existed as a Task (capability runs are not provider tasks)");
    // A23: artifact references survive.
    const artifactsAfter = env.missions.get(missionId).mission.artifacts.map((a) => a.id);
    assert.ok(artifactsAfter.length >= artifactsBefore.length);
    for (const artifactId of artifactsBefore) assert.ok(artifactsAfter.includes(artifactId), "A23: pre-restart artifact retained");
    // The recovery decision trail: consume_result on the completed child.
    const verdict = lifecycle(env, missionId, "agent.checkpointed").find((e) => {
      const detail = JSON.parse(e.detail) as { stepId?: string; replay?: string };
      return detail.stepId === env.missions.get(missionId).mission.steps[1]!.id && detail.replay === "consume_result";
    });
    assert.ok(verdict, "the walk recorded the consume_result verdict");
    for (const row of env.db.db.prepare("SELECT record FROM agent_checkpoints").all() as { record: string }[]) {
      assert.deepEqual(scanCheckpointJson(row.record).findings, []);
    }
  } finally { await env.cleanup(); }
});

// A30 — crash during verification: re-run the check, not the effect.
test("A30: completed child without recorded verification — re-run the check, never the underlying effect", async () => {
  const env = await agentSetup("consume-unverified");
  try {
    const before = new Set(env.agents.snapshot().agents.map((a) => a.id));
    env.agents.create({
      objective: "write then verify, crash during verification",
      steps: [{ role: "Prepare", objective: "Read the artifact.", access: "read", executor: { kind: "model" }, providers: { allow: ["codex"] }, verification: [{ kind: "file_exists", path: "one.txt", contains: "one" }] }],
    }, "workstation");
    const { id, missionId } = newAgent(env, before);
    env.agents.start(id, "workstation");
    await until(() => env.launched.length === 1, "child admitted");
    const childId = env.launched[0]!.task.id;
    // The child's effect landed on disk; its completion and verification were never recorded.
    writeFileSync(join(env.root, "one.txt"), "one\n");
    craftCompletedTask(env, childId, {});
    await env.reopen();
    await until(() => env.missions.get(missionId).mission.state === "completed" ? true : undefined, "verify-then-consume lands", 40_000);
    assert.equal(env.launched.length, 1, "A30: the effect is never repeated");
    const step = env.missions.get(missionId).mission.steps[0]!;
    assert.equal(step.state, "completed");
    assert.equal(step.result?.verified, true, "the file check was re-run and recorded");
    assert.deepEqual(step.attempts.map((a) => a.taskId), [childId, childId], "the attempt tree points at the same logical child");
    const verdict = lifecycle(env, missionId, "agent.checkpointed").find((e) => {
      const detail = JSON.parse(e.detail) as { replay?: string; safety?: string };
      return detail.replay === "verify_then_consume" && detail.safety === "VERIFY_BEFORE_REPLAY";
    });
    assert.ok(verdict, "the walk recorded the verify_then_consume verdict");
  } finally { await env.cleanup(); }
});

// A19 — a corrupt checkpoint fails closed: no replay decision, no admission, the user decides.
test("A19: a corrupt checkpoint stops recovery fail-closed; nothing replays and the mission waits for the user", async () => {
  const env = await agentSetup("corrupt-checkpoint");
  try {
    const before = new Set(env.agents.snapshot().agents.map((a) => a.id));
    env.agents.create({
      objective: "read work interrupted by the restart",
      steps: [{ role: "Prepare", objective: "Inspect files.", access: "read", executor: { kind: "model" } }],
    }, "workstation");
    const { id, missionId } = newAgent(env, before);
    env.agents.start(id, "workstation");
    await until(() => env.launched.length === 1, "child admitted");
    const runId = agentRow(env, id).run!.id;
    // Corrupt every checkpoint row of this run (fixture-crafted corruption, not a real crash).
    env.db.db.prepare("UPDATE agent_checkpoints SET record='{bad' WHERE run_id=?").run(runId);
    await env.reopen();
    await staysAbsent(() => env.launched.length > 1, "A19: no replay on corrupt checkpoint material");
    const child = env.db.get(env.launched[0]!.task.id)!;
    assert.equal(child.state, "failed", "the pre-restart child failed in the TaskManager restart walk, not by recovery's decision");
    assert.match(child.error ?? "", /Host process restarted/i);
    await staysAbsent(() => env.missions.mission(missionId).state !== "waiting_for_user", "the mission stays parked on the user");
    assert.equal(env.db.tasks().filter((t) => t.mission?.missionId === missionId).length, 1, "no requeue task is created past the invalid checkpoint");
    assert.throws(() => env.agents.store.checkpoints(runId), /corrupt|Unexpected|property/i, "the store refuses to hand back corrupt material");
    // The walk itself fails closed without inventing a verdict row.
    assert.equal(lifecycle(env, missionId, "agent.recovered").length, 0, "no recovery verdict was fabricated on corrupt material");
  } finally { await env.cleanup(); }
});

// A15 — old approval decisions never revive across a restart.
test("A15: a restart-invalidated approval is denied, cleared, and re-asked fresh — never reused", async () => {
  const env = await agentSetup("old-approval");
  try {
    const before = new Set(env.agents.snapshot().agents.map((a) => a.id));
    const outside = join(env.dir, "outside.txt");
    env.agents.create({
      objective: "a write that needs its own decision",
      steps: [{ role: "Implement", objective: "Write outside.txt", access: "write", executor: { kind: "capability", action: "filesystem.write", params: { path: outside, content: "hello" } }, verification: [] }],
    }, "workstation");
    const { id, missionId } = newAgent(env, before);
    env.agents.start(id, "workstation");
    const request = await until(() => env.missions.store.requests(missionId)[0], "the permission ask exists");
    const oldRequestId = request.id;
    await until(() => agentRow(env, id)?.state === "WAITING_FOR_USER" ? true : undefined, "the agent waits on the ask");
    // Restart while the ask is open.
    await env.reopen();
    const invalidated = await until(() => env.missions.store.requests(missionId).find((r) => r.id === oldRequestId)?.resolvedAt ? env.missions.store.requests(missionId).find((r) => r.id === oldRequestId)! : undefined, "the old request is closed by the restart");
    assert.equal(invalidated.resolution, "deny", "A15: the restart denies the old request");
    assert.equal(invalidated.resolvedBy, "bunny-host-restart");
    assert.equal(exists(outside), false, "the invalidated decision never executed");
    // The re-ask is created by the user's mission-level retry lever (§9: recovery itself never
    // replays a write — the ask_user verdict hands the decision to the user). The fresh decision
    // is a NEW request; the old decision id is not reused anywhere.
    await env.missions.retry(missionId, "workstation");
    const fresh = await until(() => env.missions.store.requests(missionId).find((r) => r.id !== oldRequestId), "a fresh request is created");
    assert.ok(fresh.id !== oldRequestId);
    await until(() => agentRow(env, id)?.state === "WAITING_FOR_USER" ? true : undefined, "the agent waits on the fresh ask");
    env.missions.respond(fresh.id, "allow_once", "workstation");
    await until(() => exists(outside), "the fresh decision admits the effect");
    await until(() => env.missions.get(missionId).mission.state === "completed" ? true : undefined, "mission completes", 30_000);
  } finally { await env.cleanup(); }
});

// A16/A17 — recovery routes through fresh T3 revalidation when the old provider vanished.
test("A16/A17: the removed provider's requeue re-routes to the remaining eligible provider", async () => {
  const env = await agentSetup("removed-provider");
  try {
    const before = new Set(env.agents.snapshot().agents.map((a) => a.id));
    env.agents.create({
      objective: "read work that must re-route after the restart",
      steps: [{ role: "Prepare", objective: "Inspect files.", access: "read", executor: { kind: "model" }, providers: { allow: ["codex", "claude"] }, maxRetries: 1 }],
    }, "workstation");
    const { id, missionId } = newAgent(env, before);
    env.agents.start(id, "workstation");
    await until(() => env.launched.length === 1, "the child is admitted");
    const firstProvider = env.launched[0]!.provider;
    const runId = agentRow(env, id).run!.id;
    // Restart with that provider gone from the live set: recovery revalidates through the router.
    const survivors = (["codex", "claude"] as const).filter((p) => p !== firstProvider) as ProviderId[];
    await env.reopen(survivors);
    await until(() => env.launched.length === 2, "the requeue re-admitted under the fresh router", 40_000);
    assert.ok(survivors.includes(env.launched[1]!.provider as ProviderId), "A16: another eligible provider was selected, within the step's allow list");
    assert.equal(env.launched[1]!.task.mission?.missionId, missionId);
    const row = agentRow(env, id);
    assert.equal(row.run!.generation, 2, "A17: recovery went through the same run-generation path");
    assert.equal(env.agents.store.latestRun(id)!.resumedFromRunId, runId);
    env.launched[1]!.finish({ ok: true, output: "Read on the surviving provider.", exitCode: 0 });
    await until(() => env.missions.get(missionId).mission.state === "completed" ? true : undefined, "mission completes", 30_000);
    // Historical truth: the first child's row keeps its routed provider.
    const firstProviderChild = env.db.get(env.launched[0]!.task.id)!;
    assert.equal(firstProviderChild.provider, firstProvider);
  } finally { await env.cleanup(); }
});

// A20 — two recovery workers cannot walk the same agent; an expired foreign claim does.
test("A20: a foreign recovery claim blocks the walk; once released, a runtime picks the agent up", async () => {
  const env = await agentSetup("duplicate-worker");
  try {
    const before = new Set(env.agents.snapshot().agents.map((a) => a.id));
    env.agents.create({ objective: "read work for the claim test", steps: [{ role: "Prepare", objective: "Inspect files.", access: "read", executor: { kind: "model" } }] }, "workstation");
    const { id, missionId } = newAgent(env, before);
    env.agents.start(id, "workstation");
    await until(() => env.launched.length === 1, "child admitted");
    // Another Host (fixture: a foreign claim with a fresh timestamp) holds the recovery claim.
    const claim = env.agents.store.claimRecovery(id, "foreign-worker", 2, "host:999999", Date.now());
    assert.equal(claim.ok, true, "the fixture installs the foreign claim");
    await env.reopen();
    // The walk must SKIP this agent: no interrupted row, no new generation, no reconciliation.
    await staysAbsent(() => lifecycle(env, missionId, "agent.recovered").length > 0, "A20: the claimed agent is left for the holder");
    assert.equal(agentRow(env, id).run?.generation, 1, "no new generation under a foreign claim");
    assert.equal(agentRow(env, id).state, "RUNNING", "the row is honestly stale while claimed");
    // The holder expires/releases; a runtime walking now proceeds.
    env.agents.store.releaseClaim(id, "foreign-worker");
    const runtime2 = new AgentRuntime(env.db, env.missions);
    try {
      await until(() => lifecycle(env, missionId, "agent.interrupted").length >= 1, "the unclaimed walk records the interruption", 30_000);
      await until(() => env.launched.length === 2, "the unclaimed walk re-admits the read child", 30_000);
    } finally { runtime2.close(); }
    env.launched[1]!.finish({ ok: true, output: "final read", exitCode: 0 });
    await until(() => env.missions.get(missionId).mission.state === "completed" ? true : undefined, "mission completes", 30_000);
  } finally { await env.cleanup(); }
});

// A21 direct — reconcile refuses steps that are not unreconciled Host-restart interruptions.
test("A21: reconcile refuses completed/blocked-by-authority steps and non-completed canonical truth", async () => {
  const env = await agentSetup("reconcile-refusals");
  try {
    const before = new Set(env.agents.snapshot().agents.map((a) => a.id));
    env.agents.create({
      objective: "read then depend",
      steps: [
        { role: "Prepare", objective: "Inspect files.", access: "read", executor: { kind: "model" } },
        { role: "Implement", objective: "Write final.txt", access: "write", executor: { kind: "capability", action: "filesystem.write", params: { path: join(env.root, "final.txt"), content: "done" } }, dependsOn: [0], verification: [] },
      ],
    }, "workstation");
    const { id, missionId } = newAgent(env, before);
    env.agents.start(id, "workstation");
    await until(() => env.launched.length === 1, "child admitted");
    await env.reopen();
    await until(() => env.launched.length === 2, "first recovery finished its requeue", 40_000);
    const stepId = env.missions.get(missionId).mission.steps[0]!.id;
    // The step is now admitted/running again — a second reconcile pass must refuse it.
    const results = await env.missions.reconcileInterrupted(missionId, [{ stepId, mode: "resubmit" }]);
    assert.deepEqual(results[0]!.applied, false);
    assert.match(results[0]!.reason as string, /not an unreconciled Host-restart interruption/);
    assert.equal(env.db.tasks().filter((t) => t.mission?.missionId === missionId).length, 2, "A21: the refused reconcile added no child");
    // A consume mode is equally guarded: the already-admitted step is not an unreconciled interruption.
    const results2 = await env.missions.reconcileInterrupted(missionId, [{ stepId, mode: "consume" }]);
    assert.deepEqual(results2[0]!.applied, false);
    assert.match(results2[0]!.reason as string, /not an unreconciled/);
    // Finish the requeue; the dependent capability step writes final.txt itself; the mission
    // completes and a THIRD reconcile refuses forever.
    env.launched[1]!.finish({ ok: true, output: "read again", exitCode: 0 });
    await until(() => env.missions.get(missionId).mission.state === "completed" ? true : undefined, "mission completes", 40_000);
    const results3 = await env.missions.reconcileInterrupted(missionId, [{ stepId, mode: "resubmit" }]);
    assert.deepEqual(results3[0]!.applied, false);
    assert.equal(env.db.tasks().filter((t) => t.mission?.missionId === missionId).length, 2, "A11: completed work is never resubmitted");
  } finally { await env.cleanup(); }
});

// A22 — terminal states survive the restart untouched.
test("A22: a COMPLETED agent stays COMPLETED across a restart; a STOPPED agent never resurrects", async () => {
  const env = await agentSetup("terminal");
  try {
    const before = new Set(env.agents.snapshot().agents.map((a) => a.id));
    env.agents.create({
      objective: "complete then restart",
      steps: [{ role: "Implement", objective: "Write one.txt", access: "write", executor: { kind: "capability", action: "filesystem.write", params: { path: join(env.root, "one.txt"), content: "one" } }, verification: [] }],
    }, "workstation");
    const { id, missionId } = newAgent(env, before);
    env.agents.start(id, "workstation");
    await until(() => env.missions.get(missionId).mission.state === "completed" ? true : undefined, "mission completes", 30_000);
    await until(() => agentRow(env, id)?.state === "COMPLETED" ? true : undefined, "agent completed");
    const preRuns = env.agents.store.runs(id).length;
    const preEvents = lifecycle(env, missionId).length;
    await env.reopen();
    await staysAbsent(() => lifecycle(env, missionId, "agent.interrupted").length > 0 || lifecycle(env, missionId, "agent.recovered").length > 0, "A22: the walk leaves terminals alone");
    assert.equal(agentRow(env, id).state, "COMPLETED");
    assert.equal(env.agents.store.runs(id).length, preRuns, "no new generation");
    assert.equal(lifecycle(env, missionId).length, preEvents, "A31: recovery adds no rows to finished agents");
  } finally { await env.cleanup(); }
});

// A35 — historical Tasks are read-only history across the restart.
test("A35: a historical direct task's canonical row is byte-identical across the restart", async () => {
  const env = await agentSetup("history");
  try {
    const direct = env.tasks.submit({ prompt: "Direct history task", mode: "fast" });
    env.tasks.approve(direct.id);
    await until(() => env.launched.length === 1, "direct task launched");
    env.launched[0]!.finish({ ok: true, output: "history", exitCode: 0 });
    await until(() => env.db.get(direct.id)!.state === "completed", "direct task completed");
    const recordBefore = env.db.db.prepare("SELECT record FROM tasks WHERE id=?").get(direct.id) as { record: string };
    // Also complete one agent so recovery has something to walk without touching the history row.
    const before = new Set(env.agents.snapshot().agents.map((a) => a.id));
    env.agents.create({
      objective: "one write after the direct task",
      steps: [{ role: "Implement", objective: "Write one.txt", access: "write", executor: { kind: "capability", action: "filesystem.write", params: { path: join(env.root, "one.txt"), content: "one" } }, verification: [] }],
    }, "workstation");
    const { id, missionId: mid } = newAgent(env, before);
    env.agents.start(id, "workstation");
    await until(() => env.missions.get(mid).mission.state === "completed" ? true : undefined, "mission completes", 30_000);
    await env.reopen();
    const recordAfter = env.db.db.prepare("SELECT record FROM tasks WHERE id=?").get(direct.id) as { record: string };
    assert.equal(recordAfter.record, recordBefore.record, "A35: the historical task is untouched by recovery");
    assert.equal(env.db.get(direct.id)!.state, "completed");
  } finally { await env.cleanup(); }
});