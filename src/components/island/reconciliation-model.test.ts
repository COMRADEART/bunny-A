import test from "node:test";
import assert from "node:assert/strict";
import { mayReconcile, reconcileItems, RECONCILE_HEADLINE } from "./reconciliation-model.ts";
import type { OrchTask } from "../../lib/orch/types.ts";
import type { MissionView } from "../../lib/bunny-missions/types.ts";
import type { PersonalAgentsSnapshot } from "../../lib/bunny-host/personal-agents.ts";

const reason = "WRITE_PAUSE: the connection failed during work that may write files. Outcome uncertain — reconciliation required.";
const task = (patch: Partial<OrchTask>): OrchTask =>
  ({ id: "t1", title: "Update README", prompt: "x", projectId: "p1", mode: "balanced", state: "failed", provider: "claude", model: "m", startedAt: 1_000, logs: [], ...patch }) as unknown as OrchTask;

test("an uncertain direct task becomes one owner review with Host facts, retry/close choices and the exact command", () => {
  const items = reconcileItems({
    tasks: [
      task({ reconciliation: { required: true, reason, at: 5 }, dispatch: "may_have_started", error: "stream reset: socket hang up" }),
      task({ id: "t2", reconciliation: { required: false, reason, at: 1, resolution: "close" } }),
      task({ id: "t3" }),
      task({ id: "t4", reconciliation: { required: true, reason, at: 2 }, mission: { missionId: "m1", stepId: "s1" } }),
    ],
    missions: [],
    personalAgents: null,
    projects: [{ id: "p1", name: "Website" }],
  });
  assert.equal(items.length, 1, "resolved, ordinary and Mission-owned children are not listed as direct reviews");
  const [item] = items;
  assert.deepEqual(item.command, { action: "task.reconcile", data: { id: "t1" } });
  assert.deepEqual(item.choices.map((choice) => choice.resolution), ["retry", "close"]);
  assert.equal(item.project, "Website");
  assert.match(item.reason, /^the connection failed/, "the taxonomy prefix is stripped; the Host's words stay");
  assert.ok(item.evidence.some((line) => /may have started/.test(line)));
  assert.ok(item.sideEffects.some((line) => /Nothing is replayed automatically/.test(line)));
  // Never claims the operation failed: a disconnection is not proof of failure.
  for (const line of [item.reason, item.checkpoint, ...item.sideEffects]) assert.doesNotMatch(line, /\bfailed to (write|run)\b|did not (write|run)/i);
});

test("an uncertain Mission step names its owning Personal Agent, last verified checkpoint and last attempt; choices are retry/stop", () => {
  const mission = {
    id: "m1", title: "Ship docs", projectId: "p1", state: "failed",
    steps: [
      { id: "s0", role: "Plan", state: "completed", taskId: null, attempts: [], result: { summary: "", artifactIds: [], verified: true, verification: [] }, executor: { kind: "model" }, scope: { root: null, access: "read", isolation: "shared" } },
      { id: "s1", role: "Write docs", state: "failed", taskId: "t9", attempts: [{ attempt: 2, startedAt: 1, finishedAt: 2, taskId: "t9", capabilityRunId: null, provider: "codex", outcome: "failed", category: null, detail: "connection reset" }], result: null, executor: { kind: "capability", action: "filesystem.write", params: {} }, scope: { root: "C:/proj", access: "write", isolation: "shared" }, reconciliation: { required: true, reason, at: 9 } },
    ],
  } as unknown as MissionView;
  const personalAgents = { slots: [{ slot: 2, displayName: "Review Spear", weapon: "spear", agent: { missionId: "m1" } }] } as unknown as PersonalAgentsSnapshot;
  const [item] = reconcileItems({ tasks: [], missions: [mission], personalAgents, projects: [{ id: "p1", name: "Docs" }] });
  assert.deepEqual(item.command, { action: "mission.reconcile", data: { id: "m1", stepId: "s1" } });
  assert.deepEqual(item.owner, { slot: 2, name: "Review Spear", weapon: "spear" });
  assert.equal(item.checkpoint, "Last verified step: Plan.");
  assert.equal(item.lastAttempt, "Attempt 2 · codex · failed");
  assert.deepEqual(item.choices.map((choice) => choice.resolution), ["retry", "stop"]);
  assert.ok(item.sideEffects.some((line) => /filesystem\.write/.test(line)));
  assert.ok(item.sideEffects.some((line) => /write access in C:\/proj/.test(line)));
});

test("only the workstation may decide; a paired device sees the review without controls", () => {
  assert.equal(mayReconcile({ kind: "workstation" }), true);
  assert.equal(mayReconcile({ kind: "device" }), false);
  // M-A-3 T14: no viewer yet (loading) or an unknown kind never shows the controls.
  assert.equal(mayReconcile(null), false);
  assert.equal(mayReconcile(undefined), false);
  assert.equal(mayReconcile({ kind: "guest" }), false);
  assert.equal(RECONCILE_HEADLINE, "Outcome uncertain — reconciliation required");
});
