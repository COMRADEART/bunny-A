import test from "node:test";
import assert from "node:assert/strict";
import type { OrchTask, RouteDecision } from "../../lib/orch/types.ts";
import type { HostEvent } from "../../lib/bunny-host/contracts.ts";
import {
  activityDetail,
  orbState,
  publicTaskLogs,
  replayFrame,
  replayRecords,
  routeStrengths,
  routingGraphIds,
  taskJourney,
} from "./motion-model.ts";
test("S1R routing graph handles an Ollama-only or empty Host snapshot without phantom provider nodes", () => {
  assert.deepEqual(routingGraphIds([{ id: "ollama" }]), ["ollama"]);
  assert.deepEqual(routingGraphIds([]), []);
  assert.deepEqual(routingGraphIds([{ id: "ollama" }, { id: "claude" }, { id: "codex" }]), ["codex", "claude", "ollama"]);
  const decision = { scores: [{ provider: "openrouter", score: 1 }] } as RouteDecision;
  assert.deepEqual(routingGraphIds([{ id: "ollama" }], decision), ["ollama"], "stale score entries do not assert current provider availability");
});
const task = (fields: Partial<OrchTask> = {}) =>
  ({
    id: "test",
    provider: "codex",
    state: "running",
    createdAt: 1000,
    startedAt: 2000,
    finishedAt: null,
    prompt: "Test the project",
    output: "FINAL OUTPUT",
    logs: [],
    decision: { recommended_provider: "codex", scores: [] },
    ...fields,
  }) as OrchTask;
test("orb motion is semantic and offline takes precedence", () => {
  assert.equal(orbState("offline", task(), true), "offline");
  assert.equal(orbState("online", null), "idle");
  assert.equal(orbState("online", task(), true), "routing");
  assert.equal(orbState("online", task({ state: "waiting_for_agent_approval" })), "waiting");
  assert.equal(orbState("online", task({ state: "verifying" })), "working");
  assert.equal(orbState("online", task({ state: "failed" })), "failed");
});
test("journey never claims unreported independent verification", () => {
  const steps = taskJourney(task({ state: "completed", finishedAt: 5000 }));
  assert.equal(steps[4].status, "unavailable");
  assert.equal(steps[5].status, "done");
  assert.equal(
    taskJourney(
      task({ state: "failed", verification: { passed: false, detail: "Failed check" } }),
    )[4].status,
    "failed",
  );
  const pending = taskJourney(task({ state: "waiting_for_approval", startedAt: null }));
  assert.equal(pending[2].status, "current");
  assert.equal(pending[3].status, "next");
});
test("path weights are normalized only from finite real routing scores", () => {
  assert.deepEqual(routeStrengths(null), []);
  const strengths = routeStrengths({
    scores: [
      { provider: "codex", score: 4 },
      { provider: "claude", score: 2 },
      { provider: "ollama", score: NaN },
    ],
  } as RouteDecision);
  assert.equal(strengths.length, 2);
  assert.equal(strengths[0].strength, 1);
  assert.equal(strengths[1].strength, 0);
  assert.equal(
    routeStrengths({ scores: [{ provider: "codex", score: 0 }] } as RouteDecision)[0].score,
    0,
  );
});
test("replay cannot leak future output, verification or artifacts while scrubbing", () => {
  const finished = task({
    state: "completed",
    finishedAt: 5000,
    verification: { passed: true, detail: "Checked file" },
  });
  const events: HostEvent[] = [
    { sequence: 1, at: 3000, taskId: "test", type: "agent.command", detail: "npm test" },
    {
      sequence: 2,
      at: 4500,
      taskId: "test",
      type: "verification.completed",
      detail: "Checked file",
    },
  ];
  const records = replayRecords(finished, events);
  const submitted = replayFrame(finished, records, 1000);
  assert.equal(submitted.routeAvailable, false);
  assert.equal(submitted.agentStarted, false);
  assert.equal(submitted.task.decision, null);
  const before = replayFrame(finished, records, 2500);
  assert.equal(before.task.output, "");
  assert.equal(before.task.verification, null);
  assert.equal(before.command, null);
  assert.equal(before.artifactAvailable, false);
  const working = replayFrame(finished, records, 3500);
  assert.equal(working.command, "npm test");
  assert.equal(working.artifactAvailable, false);
  const end = replayFrame(finished, records, 5000);
  assert.equal(end.task.output, "FINAL OUTPUT");
  assert.equal(end.artifactAvailable, true);
});
test("private reasoning and ambiguous untyped logs are not exposed", () => {
  const secret = "Private reasoning text without an identifying prefix";
  const t = task({
    logs: [
      { at: 3000, line: secret },
      {
        at: 4000,
        line: "Execution active. Progress indeterminate until the provider publishes a plan.",
      },
    ],
  });
  const events: HostEvent[] = [
    { sequence: 1, at: 3000, taskId: "test", type: "agent.thinking", detail: secret },
  ];
  assert.equal(activityDetail("agent.thinking", secret), "Provider is working.");
  assert.ok(!JSON.stringify(replayRecords(t, events)).includes(secret));
  assert.ok(!JSON.stringify(publicTaskLogs(t, [])).includes(secret));
  assert.match(publicTaskLogs(t, [])[1].line, /Execution active/);
});
test("Ollama cloud activity never claims the model executes locally", () => {
  const t = task({ provider: "ollama", model: "deepseek:cloud" });
  const detail = "Stays on this machine. Provider is ready.";
  assert.equal(activityDetail("approval.required", detail, t), "Provider is ready.");
  assert.equal(activityDetail("approval.required", detail, task()), detail);
});
