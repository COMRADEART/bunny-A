/**
 * Spoken-phrase authorization boundary (masterplan backlog row #7, §17 C4).
 *
 * A spoken phrase is never an approval. The ONE place a phrase alone authorizes execution is
 * the voice auto-admission predicate (TaskManager.approveVoiceTurn, manager.server.ts): a
 * local, tool-free, concrete-model generation with the device/approval pinning. These locks
 * make that boundary test evidence instead of a comment: hosted or remote-tagged models are
 * never voice-admitted, non-waiting tasks are never admitted, and the voice action set can
 * never intersect the mission-approval command set.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HostDatabase } from "../../bunny-host/persistence.server.ts";
import { TaskManager } from "../../bunny-host/manager.server.ts";
import { HostContainment } from "../../bunny-host/failure.server.ts";
import { VOICE_ACTIONS } from "./voice-protocol.ts";
import { MISSION_ACTIONS } from "../../bunny-missions/commands.server.ts";
import type { ProviderAdapter } from "../../orch/types.ts";

const VOICE_CONSTRAINTS = { localOnly: true, offlineOnly: true } as const;

function localOllamaAdapter(): ProviderAdapter {
  return {
    id: "ollama",
    detect: async () => ({
      id: "ollama",
      installed: true,
      authenticated: true,
      authenticatedState: "not_required",
      availability: "ready",
      capabilities: ["text"] as string[],
      models: ["qwen2.5-coder:7b"],
      current_model: "qwen2.5-coder:7b",
      local_or_cloud: "local",
      remoteModels: [],
    } as never),
    launch: () => ({ done: new Promise(() => {}).then() as never, stop: async () => ({ ok: false, output: "", stopped: true }) as never }),
  };
}

function cloudOllamaAdapter(): ProviderAdapter {
  return {
    id: "ollama",
    detect: async () => ({
      id: "ollama",
      installed: true,
      authenticated: true,
      authenticatedState: "not_required",
      availability: "ready",
      capabilities: ["text"] as string[],
      models: ["deepseek-v4.1-flash:cloud"],
      current_model: "deepseek-v4.1-flash:cloud",
      local_or_cloud: "cloud",
      remoteModels: ["deepseek-v4.1-flash:cloud"],
    } as never),
    launch: () => ({ done: undefined as never, stop: async () => ({ ok: false, output: "", stopped: true }) as never }),
  };
}

async function voiceStack(adapter: ProviderAdapter) {
  const dir = mkdtempSync(join(tmpdir(), "bunny-voice-admission-"));
  mkdirSync(join(dir, "workspace"), { recursive: true });
  const db = new HostDatabase(":memory:");
  const containment = new HostContainment({
    diagnosticDirectory: join(dir, "logs"),
    runtimeDirectory: join(dir, "runtime"),
    exit: () => assert.fail("voice admission test must never hit the fatal path"),
  });
  const tasks = new TaskManager(db, join(dir, "workspace"), [adapter], { containment });
  containment.options.persist = (type, detail, owner) => tasks.emit(db.event(type, owner.taskId ?? null, detail, owner.missionId ?? null));
  await tasks.discover();
  return { dir, db, tasks, cleanup: () => { try { tasks.close?.(); } catch { /* noop */ } db.close(); rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } };
}

test("A spoken question admits only a local, probed, tool-free model (approval.voice_tool_free)", async () => {
  const stack = await voiceStack(localOllamaAdapter());
  try {
    // The probe-consistent preference mirrors the real Host, where routing candidates come
    // from the same probed list the voice gate re-checks. `preferredLocalModel` keeps the
    // fixture deterministic; the admission guards themselves are what is under test.
    const task = stack.tasks.submit({ prompt: "What is a haiku?", mode: "fast", override: "auto", constraints: { ...VOICE_CONSTRAINTS, preferredLocalModel: "qwen2.5-coder:7b" } });
    assert.equal(task.state, "waiting_for_approval", "the spoken turn waits until the voice gate admits it");
    assert.ok(task.model, "routing pinned a concrete model before admission");
    assert.doesNotMatch(task.model ?? "", /:cloud$/i, "routing pinned the local model only");
    const admitted = stack.tasks.approveVoiceTurn(task.id);
    assert.equal(admitted.provider, "ollama");
    assert.equal(admitted.id, task.id);
  } finally {
    stack.cleanup();
  }
});

test("A cloud-only provider satisfies no voice turn at all: the route refuses before anything waits", async () => {
  const stack = await voiceStack(cloudOllamaAdapter());
  try {
    // With offlineOnly/localOnly hard constraints a cloud-only probe is unrouteable, so no
    // waiting task ever exists for voice to admit - the boundary never even opens.
    assert.throws(() => stack.tasks.submit({ prompt: "Big question", mode: "fast", override: "auto", constraints: { ...VOICE_CONSTRAINTS, preferredLocalModel: "deepseek-v4.1-flash:cloud" } }), /No ready executor|hard constraints/);
  } finally {
    stack.cleanup();
  }
});

test("Voice admission refuses anything whose state has left waiting_for_approval", async () => {
  const stack = await voiceStack(localOllamaAdapter());
  try {
    const task = stack.tasks.submit({ prompt: "Twice", mode: "fast", override: "auto", constraints: { ...VOICE_CONSTRAINTS } });
    stack.tasks.approve(task.id, "workstation");
    const seated = stack.db.get(task.id);
    assert.notEqual(seated.state, "waiting_for_approval", "a launcher approval moved the task past the voice gate");
    assert.throws(() => stack.tasks.approveVoiceTurn(task.id), /Voice turn is not waiting for approval/, "a second authority must not slide in through the voice gate");
  } finally {
    stack.cleanup();
  }
});

test("The voice action set never intersects mission-approval commands (structural §17)", () => {
  assert.equal([...MISSION_ACTIONS].filter((action) => VOICE_ACTIONS.has(action)).length, 0, "no voice HTTP action is a mission approval path");
  for (const action of VOICE_ACTIONS) {
    assert.match(action, /^voice\./, `voice action ${action} stays in its own namespace`);
  }
});
