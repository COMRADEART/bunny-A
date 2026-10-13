import test from "node:test";
import assert from "node:assert/strict";
import { needsCanonicalResync, reconcileSnapshot, type SnapshotPosition } from "./activity-model.ts";
import { agentRows, progressFraction } from "./mission-model.ts";
import type { HostEvent, HostSnapshot } from "../../lib/bunny-host/contracts.ts";
import type { MissionStep, MissionView } from "../../lib/bunny-missions/types.ts";
import type { OrchTask, ProviderLive } from "../../lib/orch/types.ts";
import { codexMissionStatus } from "../../lib/orch/compatibility.ts";
import { projectEvents } from "../../lib/bunny-host/presentation.ts";

const event = (sequence: number): HostEvent => ({
  sequence,
  at: sequence,
  taskId: "task",
  type: "agent.command",
  detail: "safe",
});
const empty: SnapshotPosition = {
  instanceId: null,
  revision: 0,
  cursor: 0,
  events: [],
  activities: [],
};
const snapshot = (cursor: number, events: HostEvent[], extra: Partial<HostSnapshot> = {}) =>
  ({
    instanceId: "host",
    cursor,
    events,
    tasks: [],
    presentation: {
      version: 1,
      revision: cursor,
      retainedFrom: 1,
      activities: projectEvents(events, []),
    },
    ...extra,
  }) as HostSnapshot;

test("T5: duplicate replay keeps stable activity IDs and does not notify twice", () => {
  const first = reconcileSnapshot(empty, snapshot(2, [event(1), event(2)]), 0)!;
  const duplicate = reconcileSnapshot(first, snapshot(2, [event(1), event(2), event(2)]), 2)!;
  assert.equal(duplicate.events.length, 2);
  assert.equal(duplicate.activities.length, 2);
  assert.deepEqual(duplicate.fresh, []);
});
test("T5: late snapshot cannot overwrite a newer canonical view", () => {
  const current = reconcileSnapshot(empty, snapshot(10, [event(10)]), 0)!;
  assert.equal(reconcileSnapshot(current, snapshot(9, [event(9)]), 9), null);
  assert.equal(
    reconcileSnapshot({ ...current, revision: 20 }, snapshot(10, [event(10)]), 10),
    null,
  );
});
test("T5: late already-known event does not replace its sequence identity", () => {
  const current = reconcileSnapshot(empty, snapshot(10, [event(10)]), 0)!;
  const next = reconcileSnapshot(
    current,
    snapshot(11, [{ ...event(10), detail: "stale" }, event(11)]),
    10,
  )!;
  assert.equal(next.events[0].detail, "safe");
  assert.deepEqual(
    next.fresh.map((item) => item.sequence),
    [11],
  );
});
test("T5: retention gap discards UI history and marks canonical resync", () => {
  const current = reconcileSnapshot(empty, snapshot(2, [event(1), event(2)]), 0)!;
  const next = reconcileSnapshot(
    current,
    snapshot(90, [event(80)], {
      presentation: {
        version: 1,
        revision: 90,
        retainedFrom: 80,
        activities: projectEvents([event(80)], []),
      },
    }),
    2,
  )!;
  assert.equal(next.gap, true);
  assert.deepEqual(
    next.events.map((item) => item.sequence),
    [80],
  );
  assert.equal(next.activities.length, 1);
});
test("T5: a new Host instance accepts reset cursor without reconstructing old work", () => {
  const current = reconcileSnapshot(empty, snapshot(10, [event(10)]), 0)!;
  const next = reconcileSnapshot(current, snapshot(1, [event(1)], { instanceId: "new-host" }), 0)!;
  assert.equal(next.restarted, true);
  assert.equal(next.cursor, 1);
  assert.deepEqual(
    next.events.map((item) => item.sequence),
    [1],
  );
  assert.deepEqual(next.fresh, []);
});
test("T5: a fast restart requests full canonical history even without connection loss",()=>{
  assert.equal(needsCanonicalResync("old-host",snapshot(10,[event(10)],{instanceId:"new-host"}),90),true);
  assert.equal(needsCanonicalResync("host",snapshot(10,[event(10)]),0),false);
});
test("T5: full reconnect still detects a gap from the last known cursor", () => {
  const current = reconcileSnapshot(empty, snapshot(2, [event(1), event(2)]), 0)!;
  const next = reconcileSnapshot(
    current,
    snapshot(90, [event(80)], {
      presentation: {
        version: 1,
        revision: 90,
        retainedFrom: 80,
        activities: projectEvents([event(80)], []),
      },
    }),
    0,
  )!;
  assert.equal(next.gap, true);
  assert.deepEqual(
    next.events.map((item) => item.sequence),
    [80],
  );
});
test("T5: a 500-event backlog resumes the delivered cursor instead of skipping history", () => {
  const current = reconcileSnapshot(empty, snapshot(1, [event(1)]), 0)!;
  const next = reconcileSnapshot(
    current,
    snapshot(
      900,
      Array.from({ length: 500 }, (_, i) => event(i + 2)),
    ),
    1,
  )!;
  assert.equal(next.cursor, 501);
  assert.equal(next.events.length, 200);
});
test("T5: obsolete pending capability rows are replaced by canonical records", () => {
  const row = {
    id: "capability:pending",
    at: 1,
    sequence: null,
    source: "request" as const,
    taskId: null,
    missionId: "m",
    stepId: "s",
    runId: null,
    title: "Run command",
    state: "Requested" as const,
    detail: "",
  };
  const current = reconcileSnapshot(
    empty,
    snapshot(1, [], {
      presentation: { version: 1, revision: 1, retainedFrom: 1, activities: [row] },
    }),
    0,
  )!;
  const next = reconcileSnapshot(
    current,
    snapshot(2, [], {
      presentation: {
        version: 1,
        revision: 2,
        retainedFrom: 1,
        activities: [{ ...row, state: "Succeeded", source: "capability", runId: "r" }],
      },
    }),
    1,
  )!;
  assert.equal(next.activities.length, 1);
  assert.equal(next.activities[0].state, "Succeeded");
});
test("T5: agent role survives provider reroute", () => {
  const step = {
    id: "s",
    role: "Code",
    state: "running",
    taskId: "t",
    executor: { kind: "model" },
    accounting: { provider: "codex" },
  } as MissionStep;
  const m = { steps: [step] } as MissionView;
  const before = agentRows(m, [{ id: "t", provider: "codex" } as OrchTask]).rows[0];
  const after = agentRows(m, [{ id: "t", provider: "claude" } as OrchTask]).rows[0];
  assert.equal(before.role, "Code");
  assert.equal(after.role, "Code");
  assert.equal(after.provider, "claude");
});
test("T5: compact worker strip defaults to three and keeps attention visible", () => {
  const steps = Array.from(
    { length: 6 },
    (_, i) =>
      ({
        id: String(i),
        role: `Worker ${i}`,
        state: i === 5 ? "waiting_for_approval" : "pending",
        executor: { kind: "model" },
        accounting: { provider: null },
        evidence: [],
      }) as unknown as MissionStep,
  );
  const rows = agentRows({ steps } as MissionView, []);
  assert.equal(rows.rows.length, 3);
  assert.equal(rows.more, 3);
  assert.ok(rows.rows.some((row) => row.role === "Worker 5"));
});
test("T5: invalid or invented Mission progress stays indeterminate", () => {
  for (const total of [NaN, Infinity, 0, -1])
    assert.equal(
      progressFraction({ kind: "steps", completed: 1, total, failed: 0, running: 1 }),
      null,
    );
  assert.equal(
    progressFraction({ kind: "steps", completed: 11, total: 10, failed: 0, running: 1 }),
    null,
  );
});
test("T5: unknown Codex version is visibly Mission restricted", () => {
  const provider = {
    id: "codex",
    installed: true,
    authenticated: true,
    availability: "ready",
    securityCompatibility: { compatibilityClass: "UNVALIDATED", reason: "Unknown future version" },
  } as ProviderLive;
  assert.equal(codexMissionStatus(provider), "Restricted");
  assert.equal(provider.availability, "ready");
});
