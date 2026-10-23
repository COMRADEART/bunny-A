import test from "node:test";
import assert from "node:assert/strict";
import { execute, stopTask } from "../orch/exec.server.ts";
import { HostDatabase } from "./persistence.server.ts";
import { ModelCapabilityRegistry } from "./model-capability.server.ts";
import { agentPrompt } from "../bunny-missions/context.ts";

test("S1R: incomplete streams and served-model substitutions cannot certify success", async () => {
  const original = globalThis.fetch;
  try {
    for (const body of ['{"model":"pinned","response":"partial"}\n', '{"model":"other","response":"wrong","done":true}\n']) {
      globalThis.fetch = async (_url, init) => init?.method
        ? new Response(body) : Response.json({ models: [{ name: "pinned" }] });
      const result = await execute({ taskId: "s1r-receipt", provider: "ollama", model: "pinned", prompt: "Synthetic" }, { stream: () => {} });
      assert.equal(result.ok, false, body);
      assert.deepEqual(await stopTask("s1r-receipt"), { stopped: false });
    }
  } finally { globalThis.fetch = original; }
});

test("S1R: nonstream substitutions, missing completion and malformed JSON fail validation", async () => {
  const original = globalThis.fetch;
  try {
    for (const body of [{ model: "other", response: "{}", done: true }, { model: "pinned", response: "{}" }, { model: "pinned", response: "not JSON", done: true }]) {
      globalThis.fetch = async (_url, init) => init?.method ? Response.json(body) : Response.json({ models: [{ name: "pinned" }] });
      assert.equal((await execute({ taskId: "s1r-json", provider: "ollama", model: "pinned", prompt: "Synthetic", format: { type: "object" } })).ok, false);
    }
  } finally { globalThis.fetch = original; }
});

test("S1R: actual architecture-qualified Ollama context metadata is discovered", async () => {
  const db = new HostDatabase(":memory:");
  try {
    const registry = new ModelCapabilityRegistry(db, { availableProviders: () => ["ollama"],
      ollamaProbe: async () => ({ up: true, models: ["pinned"] }), ollamaPs: async () => ({ models: [] }),
      ollamaShow: async () => ({ capabilities: ["completion"], model_info: { "general.architecture": "qwen2", "qwen2.context_length": 32768, "irrelevant.context_length": 999999 } }) });
    await registry.refresh();
    assert.equal(registry.get("ollama", "pinned")?.contextWindow, 32768);
  } finally { db.close(); }
});

test("S1R: read-only agent formatting is not contradicted by a mandatory prose summary", () => {
  const prompt = agentPrompt({ mission: { objective: "Synthetic pipeline", mode: "fast" },
    step: { role: "Worker", objective: "Reply only one JSON object.", scope: { access: "read" } as never, expectedArtifacts: [] },
    cwd: "<isolated-workspace>", dependencies: [], facts: [] });
  assert.doesNotMatch(prompt, /Output contract: end with a short summary/);
  assert.match(prompt, /do not push, publish or send anything outside this machine/);
});
