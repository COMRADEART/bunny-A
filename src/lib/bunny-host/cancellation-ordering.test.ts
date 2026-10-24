import test from "node:test";
import assert from "node:assert/strict";
import { HostDatabase } from "./persistence.server.ts";
import { PersistentTaskRuntime } from "./ma4/task-runtime.server.ts";
import { TaskStore } from "./ma4/task-store.server.ts";
import type { Executor, StepContext } from "./ma4/task-runtime.server.ts";
import type { Envelope, TaskSpec, TaskView } from "./ma4/task-runtime.ts";

function createRuntime(opts: { onStep1?: () => void; blockStep1?: Promise<void> } = {}) {
  const hostDb = new HostDatabase(":memory:");
  const store = new TaskStore(hostDb);
  let nowMs = 1_000_000;

  const slowStep: Executor = {
    kind: "test.slow",
    category: "read_only",
    gpu: false,
    sideEffect: false,
    timeoutMs: 60_000,
    async run(input, ctx: StepContext) {
      opts.onStep1?.();
      if (opts.blockStep1) {
        await Promise.race([
          opts.blockStep1,
          new Promise<void>((_, reject) => {
            ctx.signal.addEventListener("abort", () => reject(new Error("aborted")));
          }),
        ]);
      }
      return { ok: true, output: "slow done" };
    },
  };

  let step2Ran = false;
  const secondStep: Executor = {
    kind: "test.second",
    category: "read_only",
    gpu: false,
    sideEffect: false,
    timeoutMs: 60_000,
    async run() {
      step2Ran = true;
      return { ok: true, output: "second done" };
    },
  };

  const fastStep: Executor = {
    kind: "test.fast",
    category: "read_only",
    gpu: false,
    sideEffect: false,
    timeoutMs: 60_000,
    async run() {
      return { ok: true, output: "fast done" };
    },
  };

  const rt = new PersistentTaskRuntime({
    store,
    executors: [slowStep, secondStep, fastStep],
    call: async () => ({ ok: false, error: "no model", durationMs: 0 }),
    modelAvailable: async () => true,
    uiAttached: () => true,
    now: () => nowMs,
    instanceId: "test-host",
    exclusive: true,
  });

  return {
    rt,
    db: hostDb.db,
    advance: (ms: number) => { nowMs += ms; },
    didStep2Run: () => step2Ran,
  };
}

const envelope: Envelope = {
  capabilities: ["test.slow", "test.second", "test.fast"],
  providers: ["ollama"],
  localOnly: true,
  models: [],
  projectScopes: ["p1"],
  sideEffects: false,
  background: true,
  budgets: { maxModelCalls: 5, maxWallMs: 60_000 },
  expiresAt: 2_000_000,
};

const makeStep = (id: string, kind: string): TaskSpec["steps"][number] => ({
  id,
  kind,
  input: {},
  model: null,
  maxAttempts: 1,
});

test("MA4-S2-FIX-E: cancellation of active task terminates in-flight step and strictly prevents subsequent steps", async () => {
  let resolveBlock!: () => void;
  const block = new Promise<void>(res => { resolveBlock = res; });
  let step1Started = false;

  const { rt, db, didStep2Run } = createRuntime({
    onStep1: () => { step1Started = true; },
    blockStep1: block,
  });

  const spec: TaskSpec = {
    title: "Multi-step cancellation test",
    projectId: "p1",
    steps: [makeStep("step1", "test.slow"), makeStep("step2", "test.second")],
    acceptance: { requiredSteps: ["step1", "step2"], description: "Both steps succeed" },
    dependsOn: [],
    deadlineAt: null,
  };

  const task = rt.create({ spec, envelope }, "workstation");
  assert.equal(task.state, "AWAITING_APPROVAL");
  rt.approve(task.id, "workstation");
  const queued = rt.view(task.id) as TaskView;
  assert.equal(queued.state, "QUEUED");

  // Allow step 1 to start
  rt.tick();
  assert.ok(step1Started, "step 1 should have dispatched");
  const running = rt.view(task.id) as TaskView;
  assert.equal(running.state, "RUNNING");

  // Cancel while step 1 is active
  const cancelView = rt.cancel(task.id, "workstation");
  assert.equal(cancelView.id, task.id);

  // Let event loop process abort
  resolveBlock();
  await new Promise(r => setTimeout(r, 20));
  rt.tick();

  const finalView = rt.view(task.id) as TaskView;
  assert.equal(finalView.state, "CANCELLED", "task must settle in CANCELLED state");
  assert.equal(didStep2Run(), false, "step 2 must NEVER run after task is cancelled");

  // Operations audit: step 2 must have 0 operations
  const ops = db.prepare("SELECT step_id, state FROM ma4_task_operations WHERE task_id=?").all(task.id) as { step_id: string; state: string }[];
  assert.ok(!ops.some(o => o.step_id === "step2"), "step 2 must have no operations");
});

test("MA4-S2-FIX-E: cancellation of an already COMPLETED task throws TaskConflictError and preserves COMPLETED state", async () => {
  const { rt } = createRuntime();

  const spec: TaskSpec = {
    title: "Fast completed task",
    projectId: "p1",
    steps: [makeStep("fast", "test.fast")],
    acceptance: { requiredSteps: ["fast"], description: "Fast step succeeds" },
    dependsOn: [],
    deadlineAt: null,
  };

  const task = rt.create({ spec, envelope }, "workstation");
  rt.approve(task.id, "workstation");
  rt.tick();
  await new Promise(r => setTimeout(r, 20));
  rt.tick();

  const completed = rt.view(task.id) as TaskView;
  assert.equal(completed.state, "COMPLETED");

  // Attempting to cancel an already completed task must fail closed
  assert.throws(
    () => rt.cancel(task.id, "workstation"),
    (err: Error) => {
      assert.match(err.message, /already COMPLETED/i);
      return true;
    },
    "cancellation of completed task must fail closed"
  );

  const after = rt.view(task.id) as TaskView;
  assert.equal(after.state, "COMPLETED", "state must remain COMPLETED");
});

test("MA4-S2-FIX-E: once a task is CANCELLED, resume or reactivation is rejected", async () => {
  const { rt } = createRuntime();

  const spec: TaskSpec = {
    title: "Cancelled task rejection",
    projectId: "p1",
    steps: [makeStep("fast", "test.fast")],
    acceptance: { requiredSteps: ["fast"], description: "Fast step" },
    dependsOn: [],
    deadlineAt: null,
  };

  const task = rt.create({ spec, envelope }, "workstation");
  rt.cancel(task.id, "workstation");
  const cancelled = rt.view(task.id) as TaskView;
  assert.equal(cancelled.state, "CANCELLED");

  // Attempt to resume must fail
  assert.throws(
    () => rt.resume(task.id, "workstation"),
    (err: Error) => {
      assert.ok(err.message.includes("CANCELLED") || err.message.includes("conflict") || err.message.includes("state"));
      return true;
    }
  );

  // Attempt to cancel again must fail closed
  assert.throws(
    () => rt.cancel(task.id, "workstation"),
    (err: Error) => {
      assert.match(err.message, /already CANCELLED/i);
      return true;
    }
  );
});
