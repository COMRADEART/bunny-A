import test from "node:test";
import assert from "node:assert/strict";
import {
  agentControls,
  attentionRequired,
  currentAgentTask,
  currentStepLabel,
  filteredActivities,
  selectedTaskModel,
  type AgentView,
  type ActivityFilters,
} from "./workspace-model.ts";
import { eventSignal, signalStream } from "../../lib/bunny-host/event-signal.ts";
import { reconcileSnapshot } from "./activity-model.ts";
import type { OrchTask } from "../../lib/orch/types.ts";
import type { MissionView } from "../../lib/bunny-missions/types.ts";
import type { HostSnapshot } from "../../lib/bunny-host/contracts.ts";
import type { PublicActivity } from "../../lib/bunny-host/presentation.ts";
const agent = (state: AgentView["state"]): AgentView => ({
  id: "a",
  name: "Agent",
  state,
  missionId: "m",
  createdAt: 1,
  updatedAt: 1,
  failure: null,
  run: null,
  checkpoints: 0,
  lastCheckpoint: null,
  pausedAt: null,
  stoppedAt: null,
  note: null,
});
const task = {
  id: "t",
  title: "Task",
  model: "auto",
  provider: "claude",
  projectId: "p",
  state: "running",
  mission: { missionId: "m", stepId: "s" },
} as OrchTask;
const mission = {
  id: "m",
  projectId: "p",
  steps: [{ id: "s", taskId: "t", state: "running" }],
} as MissionView;
const activity = {
  id: "e",
  at: 100,
  sequence: 1,
  source: "journal",
  taskId: "t",
  missionId: "m",
  stepId: "s",
  runId: null,
  title: "Task admitted",
  state: "Running",
  detail: "Canonical operation.",
} as PublicActivity;
const filters: ActivityFilters = {
  project: "",
  agent: "",
  mission: "",
  task: "",
  status: "",
  provider: "",
  date: "",
};
test("T8: a terminal Agent never advertises mutable controls", () => {
  for (const state of ["COMPLETED", "FAILED", "STOPPED"] as const)
    assert.deepEqual(agentControls(agent(state), true), {
      pause: false,
      resume: false,
      stop: false,
    });
});
test("T8: offline controls remain disabled even for a running Agent", () =>
  assert.deepEqual(agentControls(agent("RUNNING"), false), {
    pause: false,
    resume: false,
    stop: false,
  }));
test("T8: paused controls match T4 admission semantics", () =>
  assert.deepEqual(agentControls(agent("PAUSED"), true), {
    pause: false,
    resume: true,
    stop: true,
  }));
test("T8: interrupted Agents do not invent a Resume or Pause command", () =>
  assert.deepEqual(agentControls(agent("INTERRUPTED"), true), {
    pause: false,
    resume: false,
    stop: true,
  }));
test("T8: authorization attention is distinct from CREATED execution state", () => {
  const row = agent("CREATED");
  row.authorization = {
    state: "WAITING_FOR_USER",
    pending: [],
  } as unknown as AgentView["authorization"];
  assert.equal(attentionRequired(row), true);
  assert.equal(row.state, "CREATED");
  assert.equal(agentControls(row, true).pause, false);
});
test("T8: failed verification is attention, never successful completion", () => {
  assert.equal(attentionRequired(agent("FAILED")), true);
  assert.equal(attentionRequired(agent("COMPLETED")), false);
});
test("T8: current Task requires a canonical active step link", () => {
  assert.equal(currentAgentTask(agent("RUNNING"), mission, [task])?.id, "t");
  assert.equal(
    currentAgentTask(agent("RUNNING"), mission, [{ ...task, id: "unrelated" }]),
    undefined,
  );
});
test("T8: retained completed Task is not current work", () =>
  assert.equal(
    currentAgentTask(agent("RUNNING"), mission, [{ ...task, state: "completed" }]),
    undefined,
  ));
test("T8: missing model remains explicitly unknown", () => {
  assert.match(selectedTaskModel(task), /Exact model unknown/);
  assert.equal(selectedTaskModel({ ...task, model: "genuine-record" }), "genuine-record");
  assert.equal(selectedTaskModel(undefined), "No model Task admitted");
});
test("T8: activity Project filter follows canonical links", () => {
  assert.equal(
    filteredActivities(
      [activity],
      { ...filters, project: "p" },
      [task],
      [mission],
      [agent("RUNNING")],
    ).length,
    1,
  );
  assert.equal(
    filteredActivities(
      [activity],
      { ...filters, project: "other" },
      [task],
      [mission],
      [agent("RUNNING")],
    ).length,
    0,
  );
});
test("T8: activity Agent filter refuses unrelated Mission rows", () => {
  assert.equal(
    filteredActivities(
      [activity],
      { ...filters, agent: "a" },
      [task],
      [mission],
      [agent("RUNNING")],
    ).length,
    1,
  );
  assert.equal(
    filteredActivities(
      [activity],
      { ...filters, agent: "b" },
      [task],
      [mission],
      [agent("RUNNING")],
    ).length,
    0,
  );
});
test("T8: provider/status filters do not infer a model provider for capabilities", () => {
  assert.equal(
    filteredActivities(
      [{ ...activity, taskId: null }],
      { ...filters, provider: "claude" },
      [task],
      [mission],
      [],
    ).length,
    0,
  );
  assert.equal(
    filteredActivities([activity], { ...filters, status: "Verified" }, [task], [mission], [])
      .length,
    0,
  );
});
test("T8: SSE signal redacts prompt, tokens, cookies and raw details", () => {
  const result = eventSignal(
    "data: " +
      JSON.stringify({
        sequence: 41,
        detail: "private prompt",
        token: "secret",
        cookie: "private cookie",
      }),
  );
  assert.equal(result, 'id: 41\ndata: {"sequence":41}\n\n');
  assert.ok(!/private|secret/.test(result));
});
test("T8: invalid SSE cursors never become replay identifiers", () => {
  assert.equal(eventSignal('data: {"sequence":-1}'), "");
  assert.equal(eventSignal('data: {"sequence":"41"}'), "");
  assert.equal(eventSignal("id: secret"), "");
});
test("T8: chunked SSE signal survives multibyte private text and closes exactly once", async () => {
  const encoder = new TextEncoder();
  const bytes = encoder.encode('data: {"sequence":9,"detail":"privé"}\n\n');
  let cleaned = 0;
  const stream = signalStream(
    new ReadableStream({
      start(output) {
        output.enqueue(bytes.slice(0, 40));
        output.enqueue(bytes.slice(40));
        output.close();
      },
    }),
    () => cleaned++,
  );
  const text = await new Response(stream).text();
  assert.equal(text, 'id: 9\ndata: {"sequence":9}\n\n');
  assert.equal(cleaned, 1);
});
test("T8: client cancellation cancels upstream and releases bridge ownership", async () => {
  let cleaned = 0,
    cancelled = 0;
  const source = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled++;
    },
  });
  const stream = signalStream(source, () => cleaned++);
  await stream.cancel();
  assert.equal(cleaned, 1);
  await new Promise((done) => setTimeout(done, 0));
  assert.equal(cancelled, 1);
});
test("T8: overlong event refuses without retaining an unbounded buffer", async () => {
  let cleaned = 0;
  const source = new ReadableStream<Uint8Array>({
    start(output) {
      output.enqueue(new TextEncoder().encode("x".repeat(262145)));
      output.close();
    },
  });
  await assert.rejects(
    new Response(signalStream(source, () => cleaned++)).text(),
    /exceeded bridge bound/,
  );
  assert.equal(cleaned, 1);
});
test("T8: replay and out-of-order snapshots cannot duplicate event identities", () => {
  const snapshot = {
    instanceId: "host-a",
    cursor: 2,
    events: [
      { sequence: 2, at: 2, type: "task.completed", taskId: null, detail: "" },
      { sequence: 1, at: 1, type: "task.started", taskId: null, detail: "" },
    ],
    tasks: [],
  } as unknown as HostSnapshot;
  const first = reconcileSnapshot(
    { instanceId: null, revision: 0, cursor: 0, events: [], activities: [] },
    snapshot,
    0,
  )!;
  const replay = reconcileSnapshot(first, snapshot, 1)!;
  assert.deepEqual(
    replay.events.map((row) => row.sequence),
    [1, 2],
  );
  assert.equal(reconcileSnapshot(replay, { ...snapshot, cursor: 1 }, 1), null);
});
test("T8: new Host epoch reconciles independently of an old larger cursor", () => {
  const first = { instanceId: "host-a", revision: 900, cursor: 900, events: [], activities: [] };
  const snapshot = {
    instanceId: "host-b",
    cursor: 1,
    events: [],
    tasks: [],
  } as unknown as HostSnapshot;
  const next = reconcileSnapshot(first, snapshot, 900)!;
  assert.equal(next.restarted, true);
  assert.equal(next.cursor, 1);
  assert.equal(next.instanceId, "host-b");
});

test("T13 agent row: 'Working on a step now' needs a live Host and a running or verifying step", () => {
  assert.equal(currentStepLabel({ state: "running" }, true), "Working on a step now");
  assert.equal(currentStepLabel({ state: "verifying" }, true), "Working on a step now");
  assert.equal(currentStepLabel({ state: "waiting_for_approval" }, true), "Waiting for approval");
  assert.equal(currentStepLabel({ state: "running" }, false), "Last known step", "an offline Host never shows work as happening now");
});
