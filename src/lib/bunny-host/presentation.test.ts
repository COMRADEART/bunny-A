import test from "node:test";
import assert from "node:assert/strict";
import {
  artifactStatus,
  hostHealthMessage,
  capabilityState,
  dashboardSnapshot,
  dashboardCommand,
  projectCapabilities,
  projectEvents,
  projectHostActivity,
  publicEventDetail,
  taskStatus,
  UNCERTAIN_LABEL,
} from "./presentation.ts";
import type { HostEvent, HostSnapshot } from "./contracts.ts";
import type { OrchTask } from "../orch/types.ts";
import type { CapabilityRun, MissionStep, MissionView } from "../bunny-missions/types.ts";

const task = (fields: Partial<OrchTask> = {}) =>
  ({
    id: "task",
    state: "running",
    provider: "codex",
    model: "model",
    logs: [],
    verification: null,
    ...fields,
  }) as OrchTask;
const event = (
  sequence: number,
  type: string,
  detail = "",
  fields: Partial<HostEvent> = {},
): HostEvent => ({ sequence, at: sequence, taskId: "task", type, detail, ...fields });
const run = (fields: Partial<CapabilityRun> = {}) =>
  ({
    id: "run",
    action: "terminal.exec",
    missionId: "mission",
    stepId: "step",
    status: "running",
    startedAt: 1,
    finishedAt: null,
    params: {},
    ...fields,
  }) as CapabilityRun;
const step = (fields: Partial<MissionStep> = {}) =>
  ({
    id: "step",
    state: "pending",
    executor: { kind: "capability", action: "terminal.exec", params: {} },
    capabilityRunId: null,
    attempts: [],
    ...fields,
  }) as MissionStep;
const mission = (fields: Partial<MissionView> = {}) =>
  ({ id: "mission", updatedAt: 1, requests: [], steps: [step()], ...fields }) as MissionView;

test("T5: a provider turn ending never establishes task completion or independent verification", () => {
  const rows = projectEvents([event(1, "agent.completed")], [task()]);
  assert.equal(rows[0].title, "Provider turn finished");
  assert.equal(rows[0].state, "Completed");
  assert.match(rows[0].detail, /separate Host decisions/);
  assert.doesNotMatch(rows[0].title, /Verified|Task completed/);
  assert.equal(taskStatus(task()).label, "Provider turn running");
});
test("T13.3 N-C: a task with an uncertain outcome says so instead of plain failure or retry available", () => {
  const t = task({ state: "failed", reconciliation: { required: true, reason: "OUTCOME_UNCERTAIN: x", at: 1 } });
  assert.equal(taskStatus(t).label, UNCERTAIN_LABEL);
  assert.equal(UNCERTAIN_LABEL, "Outcome uncertain — reconciliation required");
  assert.equal(taskStatus(task({ state: "failed", reconciliation: { required: false, reason: "x", at: 1, resolution: "close" } })).label, "Task failed", "a reconciled task is an ordinary failure");
});
test("MA4-S1R: a Host runtime deadline is shown as such, not as a generic user Stop", () => {
  assert.equal(taskStatus(task({ state: "stopped", stopReason: "Runtime limit reached." })).label, "Stopped · runtime limit reached");
  assert.equal(taskStatus(task({ state: "stopped", stopReason: "Stopped by user." })).label, "Task stopped");
  assert.equal(taskStatus(task({ state: "failed", stopReason: "Runtime limit reached." })).label, "Task failed", "only a stopped task carries the deadline label");
});
test("T5: completed tasks without independent evidence remain unverified", () => {
  const t = task({ state: "completed" });
  assert.equal(taskStatus(t).verification, "Not independently verified");
  assert.match(publicEventDetail("task.completed", "verified!", t), /was not established/);
});
test("T5: canonical terminal state wins over stale provider planning and execution signals", () => {
  for (const type of [
    "agent.reasoning",
    "agent.thinking",
    "agent.verifying",
    "agent.started",
    "agent.completed",
  ]) {
    for (const state of ["completed", "failed", "stopped"] as const) {
      const t = task({
        state,
        stopReason: state === "stopped" ? "Host restarted; old session was not resumed" : null,
        latestEvent: { type, label: "private", detail: "private", at: 1 },
      });
      const snapshot = { tasks: [t], events: [], cursor: 0 } as unknown as HostSnapshot;
      const row = projectHostActivity(snapshot, [], 0, 1).tasks![0];
      assert.equal(row.activity, taskStatus(t).label);
      assert.doesNotMatch(row.detail, /Provider is working|private/);
      if (state === "stopped") assert.match(row.detail, /old session was not resumed/);
      if (state === "completed") assert.equal(row.verification, "Not independently verified");
    }
  }
  const finished = task({
    latestEvent: { type: "agent.completed", label: "private", detail: "private", at: 1 },
  });
  assert.equal(taskStatus(finished).label, "Provider turn finished");
  assert.equal(taskStatus(finished).verification, "Not independently verified");
});
test("T5: approval acceptance no longer looks like a pending approval", () => {
  const rows = projectEvents(
    [event(1, "approval.required"), event(2, "approval.accepted"), event(3, "task.approved")],
    [task()],
  );
  assert.deepEqual(
    rows.map((row) => row.state),
    ["Waiting for approval", "Completed", "Completed"],
  );
});
test("T5: independent verification failure after provider completion stays failed", () => {
  const t = task({
    state: "failed",
    verification: { passed: false, detail: "private file contents" },
  });
  const rows = projectEvents(
    [event(1, "agent.completed"), event(2, "verification.completed")],
    [t],
  );
  assert.equal(rows[0].title, "Provider turn finished");
  assert.equal(rows[1].state, "Failed");
  assert.equal(taskStatus(t).verification, "Verification failed");
});
test("T5: capability request, execution and result keep one step-operation identity", () => {
  const pending = projectCapabilities([], [mission()])[0];
  const waiting = projectCapabilities(
    [],
    [mission({ steps: [step({ state: "waiting_for_approval" })] })],
  )[0];
  const m = mission({
    steps: [step({ state: "running", capabilityRunId: "run", attempts: [{} as never] })],
  });
  const executing = projectCapabilities([run()], [m])[0];
  const succeeded = projectCapabilities([run({ status: "succeeded", finishedAt: 4 })], [m])[0];
  assert.deepEqual(
    [pending.state, waiting.state, executing.state, succeeded.state],
    ["Requested", "Waiting for approval", "Running", "Succeeded"],
  );
  assert.equal(pending.id, waiting.id);
  assert.equal(pending.id, executing.id);
  assert.equal(executing.id, succeeded.id);
  assert.notEqual(succeeded.state, "Verified");
  assert.equal(succeeded.runId, "run");
});
test("T5: denied capability is never running or successful", () => {
  assert.equal(projectCapabilities([run({ status: "denied" })], [])[0].state, "Denied");
});
test("T5: a denied request with no execution record retains its requested activity identity", () => {
  const waiting = mission({
    steps: [step({ state: "waiting_for_approval", pendingRequestId: "request" })],
  });
  const denied = mission({
    steps: [step({ state: "failed", pendingRequestId: "request" })],
    requests: [{ id: "request", resolution: "deny", resolvedAt: 4 } as never],
  });
  const before = projectCapabilities([], [waiting])[0],
    after = projectCapabilities([], [denied])[0];
  assert.equal(after.state, "Denied");
  assert.equal(before.id, after.id);
  assert.equal(after.runId, null);
});
test("T5: concurrent identical actions stay separate without guessed correlation", () => {
  const rows = projectCapabilities(
    [run(), run({ id: "other-run", stepId: "other-step" }), run()],
    [],
  );
  assert.equal(rows.length, 2);
  assert.notEqual(rows[0].id, rows[1].id);
});
test("T5: interrupted and uncertain cleanup have explicit presentation", () => {
  assert.equal(capabilityState(run({ status: "interrupted" })), "Interrupted");
  assert.equal(
    capabilityState(
      run({ status: "failed", cleanup: { attempted: true, ok: false, detail: "secret" } }),
    ),
    "Unknown effect",
  );
  assert.equal(capabilityState(run({ status: "timeout" })), "Failed");
});
test("T5: restart evidence shows interruption and fresh retry, never resumed", () => {
  const t = task({
    state: "stopped",
    stopReason: "Host restarted; stream cannot be reattached and was not resumed.",
  });
  assert.match(taskStatus(t).label, /Interrupted/);
  assert.equal(projectEvents([event(1, "task.stopped")], [t])[0].state, "Interrupted");
  assert.match(publicEventDetail("task.stopped", "", t), /old session was not resumed/);
});
const secrets = [
  "correct-horse-battery-secret",
  "Bearer qa-secret-token-1234",
  "Cookie: session=qa-cookie-5678",
  "QA_ENV_SECRET=qa-env-9012",
  "typed-credential-3456",
  "Private reasoning heading: qa-private-thought-7890",
  "--credential qa-command-1234",
];
for (const secret of secrets)
  test(`T5: public activity excludes sensitive fixture ${secrets.indexOf(secret) + 1}`, () => {
    const t = task({
      output: secret,
      error: secret,
      stopReason: secret,
      verification: { passed: false, detail: secret },
      latestEvent: { at: 1, type: "agent.command", detail: secret, label: secret },
      logs: [{ at: 1, line: "Execution active. " + secret }],
    });
    const r = run({
      params: { ordinary: secret },
      summary: secret,
      evidence: [secret],
      decisionReason: secret,
    });
    const snapshot = {
      health: {
        operationalState: "degraded",
        reason: secret,
        unavailableSubsystems: ["browser"],
        lastFatal: { at: 1, instanceId: "old", reason: secret },
      },
      instanceId: "host",
      cursor: 3,
      tasks: [t],
      events: [
        event(1, "agent.command", secret),
        event(2, "agent.reasoning", secret),
        event(3, "unrecognized.event", secret),
      ],
    } as HostSnapshot;
    const output = JSON.stringify({
      projection: projectHostActivity(snapshot, [r], 1, 1),
      dashboard: dashboardSnapshot(snapshot),
      label: publicEventDetail("agent.command", secret, t),
    });
    assert.ok(!output.includes(secret));
    assert.ok(!output.includes("ordinary"));
  });
test("T5: duplicate and out-of-order journal events use Host sequences", () => {
  const rows = projectEvents(
    [event(5, "task.completed"), event(3, "agent.completed"), event(5, "task.completed")],
    [task()],
  );
  assert.deepEqual(
    rows.map((row) => row.sequence),
    [3, 5],
  );
  assert.equal(new Set(rows.map((row) => row.id)).size, 2);
});
test("T5: private projection does not mutate the canonical journal, task or run", () => {
  const snapshot = {
    tasks: [task()],
    events: [event(1, "agent.command", "password=private")],
    cursor: 1,
  } as HostSnapshot;
  const r = run({ params: { text: "private" } }),
    before = JSON.stringify({ snapshot, r });
  projectHostActivity(snapshot, [r], 1, 1);
  dashboardSnapshot(snapshot);
  assert.equal(JSON.stringify({ snapshot, r }), before);
});
test("T5: public command results omit private sessions and arbitrary capability payloads", () => {
  const t = task({ output: "private provider transcript" });
  const result = dashboardCommand({
    snapshot: { tasks: [t], events: [], cursor: 0 } as unknown as HostSnapshot,
    task: t,
    session: { result: "private provider transcript", logs: ["Bearer qa-private-session"] },
    data: { ordinary: "typed secret in connector payload" },
  });
  const text = JSON.stringify(result);
  for (const secret of [
    "private provider transcript",
    "qa-private-session",
    "typed secret in connector payload",
  ])
    assert.ok(!text.includes(secret));
  assert.equal(result.task?.id, t.id);
  assert.ok(!("data" in result));
  assert.ok(!("session" in result));
});
test("T5: unknown actions and private reasoning cannot supply public labels", () => {
  assert.equal(
    projectCapabilities([run({ action: "secret.action", summary: "private" })], [])[0].title,
    "Capability action",
  );
  assert.deepEqual(
    projectEvents(
      [event(1, "agent.thinking", "private"), event(2, "agent.reasoning", "private")],
      [],
    ),
    [],
  );
});
test("T5: produced artifacts need explicit Host verification to become verified", () => {
  assert.equal(artifactStatus({ verification: "unverified" }), "Produced");
  assert.equal(artifactStatus({ verification: "verified" }), "Verified");
  assert.equal(artifactStatus({ verification: "failed" }), "Verification failed");
});
test("T5: degraded Host exposes safe affected-service status, never diagnostic details", () => {
  const health = {
    operationalState: "degraded" as const,
    reason: "Stack trace + password=private",
    unavailableSubsystems: ["browser"],
    lastFatal: null,
  };
  assert.match(hostHealthMessage(health)!, /Host degraded.*Browser unavailable/);
  assert.ok(!hostHealthMessage(health)!.includes("private"));
  assert.match(hostHealthMessage({ ...health, unavailableSubsystems: ["*"] })!, /until recovery/);
  assert.equal(hostHealthMessage({ ...health, operationalState: "healthy" }), null);
});
