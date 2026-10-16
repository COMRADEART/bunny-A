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
import { AGENT_FAILURES, AGENT_LIFECYCLE_EVENTS, mapFailure, type AgentSnapshot } from "./agent-types.ts";
import { AgentRuntime, agentCommand } from "./agent-runtime.server.ts";
import { scanCheckpointJson } from "./agent-checkpoint.server.ts";
import { simulatedCodexProfile } from "./testing/codex.test.ts";

type Launch = { task: OrchTask; provider: ProviderId; finish: (result: AdapterResult) => void; hooks: AdapterHooks; stopped: boolean };

const until = async <T,>(check: () => T | undefined, label: string, timeout = 20_000): Promise<T> => {
  const start = Date.now();
  for (;;) {
    let out: T | undefined;
    try { out = check(); } catch { out = undefined; }
    if (out) return out;
    if (Date.now() - start > timeout) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 10));
  }
};
/** A negative outcome: probe stays false across settle windows, or the assert fails. */
const staysAbsent = async (probe: () => boolean, label: string, windows = 14) => {
  for (let i = 0; i < windows; i++) {
    if (probe()) throw new Error(`${label} appeared when it must not`);
    await new Promise((r) => setTimeout(r, 100));
  }
};
const exists = (path: string): boolean => { try { statSync(path); return true; } catch { return false; } };

function fakeAdapter(id: ProviderId, launched: Launch[], sessions: string[], options: { failLaunch?: boolean } = {}): ProviderAdapter {
  return {
    id,
    detect: async (): Promise<ProviderLive> => ({ ...providerBase(id), installed: true, authenticated: true, availability: "ready", capabilities: ["filesystem", "terminal", "text"], current_model: null, ...(id === "codex" ? { securityCompatibility: simulatedCodexProfile() } : {}) }),
    launch: (task, hooks) => {
      if (options.failLaunch) {
        // A failing provider crashes every session it accepts: launch succeeds, the session
        // immediately dies, so the Host's real retry/reroute machinery runs and eventually
        // exhausts. (A synchronous launch throw would classify provider_unavailable and the
        // mission would wait for the user instead of failing.)
        hooks.session(`${id}-sess-crash-${sessions.push(`${id}-sess-crash-${sessions.length + 1}`)}`, null);
        return {
          done: Promise.resolve({ ok: false, output: "child process exited with code 1", exitCode: 1 } satisfies AdapterResult),
          stop: async () => { /* the session already died */ },
        };
      }
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

type AgentRow = ReturnType<AgentRuntime["snapshot"]>["agents"][number];
type Env = {
  dir: string; root: string; db: HostDatabase; tasks: TaskManager; missions: MissionManager; agents: AgentRuntime;
  launched: Launch[]; sessions: string[]; notifications: string[];
  cleanup: () => Promise<void>;
};

/** Mirror of the missions.test.ts fixture plus the T4 runtime and its admission gate (http.server.ts:103 wiring). */
async function agentSetup(label: string, options: { providers?: ProviderId[]; failCodex?: boolean } = {}): Promise<Env> {
  const dir = mkdtempSync(join(tmpdir(), `bunny-t4-${label}-`));
  const root = join(dir, "project");
  mkdirSync(root, { recursive: true });
  const db = new HostDatabase(join(dir, "host.sqlite"));
  const launched: Launch[] = [];
  const sessions: string[] = [];
  const notifications: string[] = [];
  // T3 legacy parity, as in every mission fixture: no probes, provider-level behavior unchanged.
  const factLess = new ModelCapabilityRegistry(db, { availableProviders: () => [] });
  const ids = options.providers ?? ["codex", "claude"];
  const tasks = new TaskManager(db, root, ids.map((id) => fakeAdapter(id, launched, sessions, { failLaunch: options.failCodex === true && id === "codex" })), { modelRegistry: factLess });
  await tasks.discover();
  const adapters = [new FilesystemCapability(), new TerminalCapability(), new NotificationsCapability((title) => notifications.push(title)), ...communicationConnectors()];
  const missions = new MissionManager(tasks, { dataDirectory: dir, adapters });
  missions.configure({ enabled: true }, "test");
  await missions.bus.refreshHealth();
  const agents = new AgentRuntime(db, missions);
  missions.missionPauseGate = (missionId) => agents.blockedForMission(missionId);
  const cleanup = async () => {
    try { agents.close(); } catch { /* closed */ }
    try { await missions.close(); } catch { /* closed */ }
    try { db.close(); } catch { /* closed */ }
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows file locks settle late */ }
  };
  return { dir, root, db, tasks, missions, agents, launched, sessions, notifications, cleanup };
}

/** create() returns a snapshot; the new agent is the id that did not exist before. */
const newAgent = (env: Env, before: Set<string>): { id: string; missionId: string; row: AgentRow } => {
  const row = env.agents.snapshot().agents.find((a) => !before.has(a.id));
  if (!row) throw new Error("no new agent row after create");
  before.add(row.id);
  return { id: row.id, missionId: row.missionId!, row };
};
const lifecycle = (env: Env, missionId: string) => env.db.events().filter((e) => e.type.startsWith("agent.") && e.missionId === missionId);
const checkpoints = (env: Env) => (env.db.db.prepare("SELECT id, record FROM agent_checkpoints ORDER BY created_at ASC").all() as { id: string; record: string }[]);

// A01 — identity persists; refusals shape the input.
test("A01: create persists a profile with a stable id; bad input never persists", async () => {
  const env = await agentSetup("a01");
  try {
    const before = new Set(env.agents.snapshot().agents.map((a) => a.id));
    env.agents.create({ name: "Ledger", objective: "write a ledger module and run its tests" }, "test");
    const { row, missionId } = newAgent(env, before);
    assert.equal(row.name, "Ledger");
    assert.equal(row.state, "CREATED");
    assert.equal(row.failure, null);
    assert.equal(env.missions.get(missionId).mission.origin, "agent:test", "A02 lineage: the mission was created by the agent runtime");
    assert.equal(env.launched.length, 0, "nothing launches before start");
    const second = env.agents.create({ objective: "write a ledger module and run its tests" }, "test");
    assert.notEqual(second.agents.find((a) => !before.has(a.id))!.id, row.id, "a same-name create is never an alias");
    assert.throws(() => env.agents.create({ objective: "  " }, "test"), /objective/);
    assert.throws(() => env.agents.create({ objective: "x".repeat(4001) }, "test"), /objective/);
    const rows = env.agents.snapshot().agents.map((a) => a.id);
    assert.equal(new Set(rows).size, rows.length, "A01: ids are stable and unique");
    assert.equal(rows.length, 2, "only the two successful creates persisted; refused creates never write rows");
  } finally { await env.cleanup(); }
});

// A32 — bounded active agents; the slot frees on a terminal state.
test("A32: the active bound refuses the 11th agent and frees the slot on stop", async () => {
  const env = await agentSetup("a32");
  try {
    for (let i = 0; i < 10; i++) env.agents.create({ objective: `bound filler ${i}` }, "test");
    assert.equal(env.agents.snapshot().agents.length, 10);
    assert.throws(() => env.agents.create({ objective: "over the bound" }, "test"), /active/, "A32: the bound is a refusal, not a queue");
    assert.equal(env.launched.length, 0, "bounded creation never opens provider sessions");
    const stopped = env.agents.snapshot().agents[0]!.id;
    await env.agents.stop(stopped, "test");
    env.agents.create({ objective: "slot freed" }, "test");
    assert.equal(env.agents.snapshot().agents.length, 11, "the freed slot admits one more");
    assert.equal(env.launched.length, 0);
  } finally { await env.cleanup(); }
});

// A02/A03/A04/A11/A25/A26/A33/A34 — one agent, one mission, two Tasks, two providers.
test("A02/A03/A04: two Tasks route to different providers under one agent, same mission, distinct sessions", async () => {
  const env = await agentSetup("multi");
  try {
    const before = new Set(env.agents.snapshot().agents.map((a) => a.id));
    env.agents.create({
      name: "Router Probe",
      objective: "read the notes then write the plan",
      steps: [
        { role: "Prepare", objective: "Inspect the existing notes.", access: "read", executor: { kind: "model" }, providers: { allow: ["codex"] } },
        { role: "Implement", objective: "Write the plan file.", access: "write", executor: { kind: "model" }, providers: { allow: ["claude"] }, dependsOn: [0], verification: [{ kind: "file_exists", path: "plan.md", contains: "Plan" }] },
      ],
    }, "workstation");
    const { id, missionId } = newAgent(env, before);
    await until(() => env.missions.mission(missionId).state === "waiting_for_approval", "mission planned");
    env.agents.start(id, "workstation");
    await until(() => env.launched.length === 1, "task 1 admitted");
    assert.equal(env.launched[0]!.provider, "codex", "A03: task 1 routes per its step constraint");
    const authAtTask1 = env.missions.get(missionId).authorization;
    assert.ok(authAtTask1, "an envelope exists after start");
    env.launched[0]!.finish({ ok: true, output: "Task one completed its read.", exitCode: 0 });
    await until(() => env.launched.length === 2, "task 2 admitted after task 1 finished");
    assert.equal(env.launched[1]!.provider, "claude", "A03: task 2 routes differently under the same agent identity");
    const authAtTask2 = env.missions.get(missionId).authorization;
    assert.deepEqual(authAtTask2!.providers, authAtTask1!.providers, "A25: the provider switch never alters the authority envelope");
    assert.deepEqual(authAtTask2!.filesystem, authAtTask1!.filesystem, "A25: filesystem scope is untouched by routing");
    assert.equal(authAtTask2!.id, authAtTask1!.id);
    // A26: distinct provider session ids, recorded synchronously by the Host per Task.
    const childIds = [env.launched[0]!.task.id, env.launched[1]!.task.id];
    const session1 = env.db.get(childIds[0]!)!.sessionId;
    const session2 = env.db.get(childIds[1]!)!.sessionId;
    assert.ok(session1!.startsWith("codex-sess-"), "a session id is recorded for the codex child");
    assert.ok(session2!.startsWith("claude-sess-"), "a session id is recorded for the claude child");
    assert.notEqual(session1, session2, "A26: two distinct provider sessions across one agent");
    // The fake provider performs no I/O; the fixture materializes the step's artifact so the
    // mission's independent verification can pass (the effect happened here, not in the child).
    writeFileSync(join(env.root, "plan.md"), "Plan\nwritten by the fixture\n");
    env.launched[1]!.finish({ ok: true, output: "Plan\nThe plan is written here.", exitCode: 0 });
    const done = await until(() => env.missions.get(missionId).mission.state === "completed" ? env.missions.get(missionId) : undefined, "mission completes", 30_000);
    assert.equal(done.mission.steps.filter((s) => s.state === "completed").length, 2, "A02: one agent completed two Tasks");
    // A04: the second session started only after the first session ended.
    assert.deepEqual(env.db.get(childIds[1]!)!.mission, { missionId, stepId: done.mission.steps[1]!.id }, "A02 lineage on task 2");
    // A11: exactly one child Task per step, both completed, nothing resubmitted after ticks.
    await new Promise((r) => setTimeout(r, 300));
    const children = env.db.tasks().filter((t) => t.mission?.missionId === missionId);
    assert.equal(children.length, 2, "A11: one logical Task per step — no accidental resubmission");
    assert.equal(children.filter((t) => t.state === "completed").length, 2);
    // A33/A34: everything the agent persisted scans clean.
    for (const row of checkpoints(env)) {
      assert.deepEqual(scanCheckpointJson(row.record).findings, [], "checkpoints carry no forbidden material");
      assert.ok(!row.record.includes("codex-sess-") && !row.record.includes("claude-sess-"), "A34: no provider session handles in checkpoint material");
    }
  } finally { await env.cleanup(); }
});

// A05 — capability ask: WAITING_FOR_USER holds until the decision; the effect happens only after it.
test("A05: a scope-violating capability ask lands WAITING_FOR_USER and the allow_once decision releases it", async () => {
  const env = await agentSetup("a05");
  try {
    const outside = join(env.dir, "outside.txt");
    const before = new Set(env.agents.snapshot().agents.map((a) => a.id));
    env.agents.create({
      objective: "write a file outside the approved roots",
      steps: [{ role: "Implement", objective: "Write outside.txt", access: "write", executor: { kind: "capability", action: "filesystem.write", params: { path: outside, content: "hello" } }, verification: [] }],
    }, "workstation");
    const { id, missionId } = newAgent(env, before);
    env.agents.start(id, "workstation");
    const waitingRow = await until(() => env.agents.snapshot().agents.find((a) => a.id === id)?.state === "WAITING_FOR_USER" ? env.agents.snapshot().agents.find((a) => a.id === id) : undefined, "the agent lands on the ask");
    assert.equal(waitingRow.state, "WAITING_FOR_USER");
    assert.equal(exists(outside), false, "the ask happens BEFORE the effect");
    const request = await until(() => env.missions.store.requests(missionId)[0], "the approval request is persisted");
    assert.equal(request.resolvedAt ?? null, null, "the ask is open, not pre-answered");
    env.missions.respond(request.id, "allow_once", "workstation");
    await until(() => exists(outside), "the write lands only after allow");
    const answered = await until(() => env.missions.get(missionId).mission.state === "completed" ? env.missions.get(missionId) : undefined, "mission completes", 30_000);
    assert.ok(answered.events.some((e) => e.type === "approval.additional_capability"), "the ask/answer pair is in the mission timeline");
    await until(() => env.agents.snapshot().agents.find((a) => a.id === id)?.state === "COMPLETED" ? true : undefined, "agent completes");
  } finally { await env.cleanup(); }
});

// A06 — pause gate: new admissions hold, admitted work finishes.
test("A06: pause blocks the next admission while the admitted step finishes; nothing resumes by itself", async () => {
  const env = await agentSetup("pause");
  try {
    const before = new Set(env.agents.snapshot().agents.map((a) => a.id));
    env.agents.create({
      objective: "two sequential in-root writes",
      steps: [
        { role: "Prepare", objective: "Call the model once.", access: "read", executor: { kind: "model" } },
        { role: "Implement", objective: "Write two.txt", access: "write", executor: { kind: "capability", action: "filesystem.write", params: { path: join(env.root, "two.txt"), content: "two" } }, dependsOn: [0], verification: [] },
      ],
    }, "test");
    const { id, missionId } = newAgent(env, before);
    env.agents.start(id, "test");
    await until(() => env.launched.length === 1, "step 1 admitted");
    env.agents.pause(id, "test");
    const pausedRow = await until(() => env.agents.snapshot().agents.find((a) => a.id === id)?.state === "PAUSED" ? env.agents.snapshot().agents.find((a) => a.id === id) : undefined, "pause persists immediately");
    assert.ok(pausedRow.pausedAt! > 0, "pausedAt is durable");
    assert.equal(pausedRow.run!.state, "PAUSED", "the open run seals as PAUSED");
    // The admitted step 1 finishes even while paused.
    env.launched[0]!.finish({ ok: true, output: "task one done", exitCode: 0 });
    await until(() => env.missions.get(missionId).mission.steps[0]!.state === "completed", "admitted work finishes under pause", 24_000);
    // No new admission: two.txt never appears; the mission holds; no agent state churns itself out.
    await staysAbsent(() => exists(join(env.root, "two.txt")), "A06: step 2 was never admitted");
    assert.equal(env.missions.mission(missionId).state, "running", "the mission truthfully holds, not finished");
    assert.equal(env.launched.length, 1, "no second provider session");
    // The pause is durable in the store, not just the profile cache.
    assert.equal(env.agents.store.agentFlags(id).paused, true);
    assert.equal(pausedRow.run!.generation, 1, "run generation is unchanged under pause");
  } finally { await env.cleanup(); }
});

// A08 (no restart) — resume reopens the SAME run at the SAME generation and continues.
// M-A-3 T9R-F02: A08, A31 and A27 start their Agent as the authenticated workstation (as F01 did for A02-A05/A18): any other
// actor string is a remote grantor, whose file writes are staged for workstation promotion and would never complete here.
test("A08: resume without restart reuses the same run and generation, then completes", async () => {
  const env = await agentSetup("resume");
  try {
    const before = new Set(env.agents.snapshot().agents.map((a) => a.id));
    env.agents.create({
      objective: "two sequential writes",
      steps: [
        { role: "Prepare", objective: "Call the model once.", access: "read", executor: { kind: "model" } },
        { role: "Implement", objective: "Write two.txt", access: "write", executor: { kind: "capability", action: "filesystem.write", params: { path: join(env.root, "two.txt"), content: "two" } }, dependsOn: [0], verification: [] },
      ],
    }, "test");
    const { id } = newAgent(env, before);
    env.agents.start(id, "workstation");
    const runId = await until(() => env.agents.snapshot().agents.find((a) => a.id === id)?.run?.id ?? undefined, "run opened at start");
    await until(() => env.launched.length === 1, "step 1 admitted");
    env.agents.pause(id, "workstation");
    env.agents.resume(id, "workstation");
    await until(() => env.agents.snapshot().agents.find((a) => a.id === id)?.state === "RUNNING" ? true : undefined, "resumed to RUNNING");
    env.launched[0]!.finish({ ok: true, output: "task one done", exitCode: 0 });
    await until(() => exists(join(env.root, "two.txt")), "admission resumes");
    const doneRow = await until(() => env.agents.snapshot().agents.find((a) => a.id === id)?.state === "COMPLETED" ? env.agents.snapshot().agents.find((a) => a.id === id) : undefined, "agent completes", 30_000);
    assert.equal(doneRow.run!.id, runId, "A08: the same run id continues");
    assert.equal(doneRow.run!.generation, 1, "no generation bump without a restart");
    assert.equal(doneRow.run!.endedAt !== null, true, "the run sealed on completion");
  } finally { await env.cleanup(); }
});

// A08 refusal — authority is revalidated from the canonical store on every resume path.
test("A08 refusals: resume refuses a revoked, an expired, and a deleted envelope; the agent stays paused", async () => {
  const env = await agentSetup("resume-env");
  try {
    const before = new Set(env.agents.snapshot().agents.map((a) => a.id));
    env.agents.create({
      objective: "write one file, then hold",
      steps: [
        { role: "Prepare", objective: "Call the model once.", access: "read", executor: { kind: "model" } },
        { role: "Implement", objective: "Write two.txt", access: "write", executor: { kind: "capability", action: "filesystem.write", params: { path: join(env.root, "two.txt"), content: "two" } }, dependsOn: [0], verification: [] },
      ],
    }, "test");
    const { id, missionId } = newAgent(env, before);
    env.agents.start(id, "test");
    await until(() => env.launched.length === 1, "step 1 admitted");
    env.agents.pause(id, "test");
    await until(() => env.agents.snapshot().agents.find((a) => a.id === id)?.state === "PAUSED" ? true : undefined, "paused");
    const envelope = env.missions.get(missionId).authorization!;
    env.missions.store.saveAuthorization({ ...envelope, revokedAt: Date.now() });
    assert.throws(() => env.agents.resume(id, "test"), /revoked/, "a revoked envelope refuses resume");
    env.missions.store.saveAuthorization({ ...envelope, expiresAt: Date.now() - 1 });
    assert.throws(() => env.agents.resume(id, "test"), /expired/, "an expired envelope refuses resume");
    env.db.db.prepare("DELETE FROM mission_authorizations WHERE id=?").run(envelope.id);
    assert.throws(() => env.agents.resume(id, "test"), /missing/, "a missing envelope refuses resume");
    assert.equal(env.agents.snapshot().agents.find((a) => a.id === id)!.state, "PAUSED", "no refusal unpauses the agent");
    assert.equal(exists(join(env.root, "two.txt")), false, "no admission without authority");
  } finally { await env.cleanup(); }
});

// A09 + §12 — stop persists first; nothing resurrects it.
test("A09: stop persists STOPPED first, stops the mission, and refuses pause/resume/second-stop", async () => {
  const env = await agentSetup("stop");
  try {
    const before = new Set(env.agents.snapshot().agents.map((a) => a.id));
    env.agents.create({ objective: "get stopped mid-run", steps: [{ role: "Prepare", objective: "Call the model once.", access: "read", executor: { kind: "model" } }] }, "test");
    const { id, missionId } = newAgent(env, before);
    env.agents.start(id, "test");
    await until(() => env.launched.length === 1, "step 1 admitted");
    await env.agents.stop(id, "test");
    const row = env.agents.snapshot().agents.find((a) => a.id === id)!;
    assert.equal(row.state, "STOPPED", "the stop flag is authoritative immediately");
    assert.ok(row.stoppedAt! > 0, "stoppedAt is durable");
    assert.ok(!row.failure, "a stop is a user decision, not a failure");
    const stoppedRow = lifecycle(env, missionId).find((e) => e.type === "agent.stopped");
    assert.ok(stoppedRow && (JSON.parse(stoppedRow.detail) as { category?: string }).category === "STOP_REQUESTED", "the STOP_REQUESTED category is carried by the lifecycle row");
    assert.equal(env.agents.store.agentFlags(id).stopped, true, "the flag sits in the durable row");
    assert.equal(env.launched[0]!.stopped, true, "the admitted session was stopped, not orphaned");
    await until(() => env.missions.mission(missionId).state === "stopped", "the mission stops under the agent");
    assert.equal(env.missions.mission(missionId).state, "stopped");
    await assert.rejects(() => env.agents.stop(id, "test"), /already stopped/, "A09: a second stop refuses");
    assert.throws(() => env.agents.pause(id, "test"), /finished|stopped/);
    assert.throws(() => env.agents.resume(id, "test"), /not paused/);
    await until(() => env.agents.snapshot().agents.find((a) => a.id === id)?.state === "STOPPED" ? true : undefined, "still stopped after ticks");
    assert.equal(env.launched.length, 1, "stop never spawns provider work");
  } finally { await env.cleanup(); }
});

// A18 — a Task failing for its own reason fails the agent without corrupting persistence (A33).
test("A18: a failing provider fails the mission; the agent's failure row carries fixed phrases only", async () => {
  const env = await agentSetup("a18", { providers: ["codex"], failCodex: true });
  try {
    const before = new Set(env.agents.snapshot().agents.map((a) => a.id));
    env.agents.create({
      objective: "model work that will rate-limit",
      steps: [{ role: "Prepare", objective: "Call the failing model.", access: "read", executor: { kind: "model" }, providers: { allow: ["codex"] } }],
    }, "workstation");
    const { id, missionId } = newAgent(env, before);
    env.agents.start(id, "workstation");
    await until(() => env.missions.mission(missionId).state === "failed", "routing exhausts and the mission fails", 60_000);
    const row = await until(() => env.agents.snapshot().agents.find((a) => a.id === id)?.state === "FAILED" ? env.agents.snapshot().agents.find((a) => a.id === id) : undefined, "agent lands FAILED", 20_000);
    const category = row.failure!;
    const note = row.note ?? "";
    assert.ok(AGENT_FAILURES.includes(category), "the failure category is one of the nine");
    assert.ok(category === "TASK_FAILED" || category === "ROUTING_EXHAUSTED", "either the task or its routing failed");
    assert.ok(!/429|upstream/i.test(note), "A33: the detail is a fixed phrase, never the provider error");
    const expectedDetail = category === "ROUTING_EXHAUSTED"
      ? "All eligible provider routing attempts were exhausted before this failure; the trail stays with the router."
      : mapFailure(category, "raw").detail;
    assert.equal(note, expectedDetail, "details come from the fixed-phrase map, never from provider prose");
    // Persistence is uncorrupted: runs and checkpoints remain readable after the failure.
    const runs = env.agents.store.runs(id);
    assert.ok(runs.length >= 1 && runs.every((r) => r.endedAt !== null), "the failed run is sealed");
    assert.throws(() => { env.agents.pause(id, "workstation"); }, /finished/);
  } finally { await env.cleanup(); }
});

// A24 — project/context reference is retained, and the mission root is the project's.
test("A24: the agent retains its project reference; the mission runs at the project root", async () => {
  const env = await agentSetup("a24");
  try {
    env.db.project({ id: "proj-1", name: "Ledger", path: env.root, preferred: "auto" });
    const before = new Set(env.agents.snapshot().agents.map((a) => a.id));
    env.agents.create({ objective: "work inside the registered project", projectId: "proj-1" }, "test");
    const { missionId } = newAgent(env, before);
    const mission = env.missions.get(missionId).mission;
    assert.equal(mission.projectId, "proj-1");
    assert.equal(mission.root, env.root);
    // Unknown projects are refused — the reference is validated, not invented.
    assert.throws(() => env.agents.create({ objective: "x", projectId: "proj-unknown" }, "test"), /Project/);
  } finally { await env.cleanup(); }
});

// A31/§25 — lifecycle rows are exactly once per semantic moment, all in the fixed vocabulary.
test("A31/§25: lifecycle rows are the agent's own vocabulary, once each, never colliding with task rows", async () => {
  const env = await agentSetup("lifecycle");
  try {
    const before = new Set(env.agents.snapshot().agents.map((a) => a.id));
    env.agents.create({
      objective: "one verified write",
      steps: [{ role: "Implement", objective: "Write one.txt", access: "write", executor: { kind: "capability", action: "filesystem.write", params: { path: join(env.root, "one.txt"), content: "one" } }, verification: [{ kind: "file_exists", path: "one.txt", contains: "one" }] }],
    }, "test");
    const { id, missionId } = newAgent(env, before);
    env.agents.start(id, "workstation");
    await until(() => env.missions.get(missionId).mission.state === "completed", "mission completes", 30_000);
    await until(() => env.agents.snapshot().agents.find((a) => a.id === id)?.state === "COMPLETED" ? true : undefined, "agent completes");
    const rows = lifecycle(env, missionId).filter((e) => {
      const detail = JSON.parse(e.detail) as { agentId?: string };
      return detail.agentId === id;
    });
    const kinds = rows.map((e) => e.type);
    for (const kind of kinds) assert.ok(AGENT_LIFECYCLE_EVENTS.includes(kind as never), `${kind} is lifecycle vocabulary`);
    assert.equal(kinds.filter((t) => t === "agent.created").length, 1);
    assert.equal(kinds.filter((t) => t === "agent.started").length, 1);
    assert.equal(kinds.filter((t) => t === "agent.completed").length, 1);
    assert.equal(kinds.filter((t) => t === "agent.task_started").length, 1, "one admission → exactly one task_started row, capability runs included");
    assert.equal(kinds.filter((t) => t === "agent.task_completed").length, 1, "one verified task completion → one row");
    assert.equal(kinds.filter((t) => t === "agent.failed").length, 0);
    for (const row of rows) {
      const detail = JSON.parse(row.detail) as { kind?: string; agentId?: string };
      assert.equal(detail.kind, "agent-lifecycle");
      assert.equal(detail.agentId, id);
    }
    // §31: historical semantic rows are never duplicated by a later re-derivation.
    const before2 = rows.filter((e) => e.type === "agent.completed").length;
    env.agents.snapshot();
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(lifecycle(env, missionId).filter((e) => e.type === "agent.completed").length, before2, "A31: no duplicate agent.completed on re-derivation");
  } finally { await env.cleanup(); }
});

// A27 — the agent completes with no UI consumer attached (simulated at this level: no HTTP surface).
test("A27: the agent runs to COMPLETED with zero UI involvement", async () => {
  const env = await agentSetup("a27");
  try {
    const before = new Set(env.agents.snapshot().agents.map((a) => a.id));
    env.agents.create({
      objective: "no UI involved",
      steps: [{ role: "Implement", objective: "Write one.txt", access: "write", executor: { kind: "capability", action: "filesystem.write", params: { path: join(env.root, "one.txt"), content: "one" } }, verification: [] }],
    }, "test");
    const { id } = newAgent(env, before);
    env.agents.start(id, "workstation");
    // No snapshot polls, no UI: just completion observable at the store.
    const row = await until(() => {
      const snapshot = env.agents.snapshot();
      const found = snapshot.agents.find((a) => a.id === id);
      return found?.state === "COMPLETED" ? found : undefined;
    }, "agent finished completely unattended", 30_000);
    assert.equal(row.state, "COMPLETED");
    assert.equal(exists(join(env.root, "one.txt")), true);
  } finally { await env.cleanup(); }
});

// §26 command boundary — validated actions only; honest refusals.
test("agentCommand dispatch: list/get/create start; unknown agent and unknown action refuse", async () => {
  const env = await agentSetup("dispatch");
  try {
    const list = await agentCommand(env.agents, "agent.list", {}, "test");
    assert.equal((list.agents as AgentSnapshot).agents.length, 0, "an empty host lists no agents");
    const created = await agentCommand(env.agents, "agent.create", { objective: "created through the dispatch surface" }, "test");
    const row = (created.agents as AgentSnapshot).agents[0]!;
    assert.equal(row.state, "CREATED");
    const got = await agentCommand(env.agents, "agent.get", { id: row.id }, "test");
    assert.equal((got.agent as AgentSnapshot["agents"][number]).id, row.id);
    await assert.rejects(() => agentCommand(env.agents, "agent.get", { id: "ghost" }, "test"), /Unknown agent/);
    await assert.rejects(() => agentCommand(env.agents, "agent.bogus", {}, "test"), /Unknown agent action/);
    await assert.rejects(() => agentCommand(env.agents, "agent.start", { id: "ghost" }, "test"), /Unknown/);
    await assert.rejects(() => agentCommand(env.agents, "agent.resume", { id: row.id }, "test"), /not paused/, "resume is refused by the runtime, not guessed");
  } finally { await env.cleanup(); }
});