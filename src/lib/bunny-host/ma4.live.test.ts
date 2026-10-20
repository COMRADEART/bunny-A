import test from "node:test";
import assert from "node:assert/strict";

/** Explicit opt-in ONLY: an already configured, separately approved local Host and free model. No API keys read here. */
test("MA4 live free-model Host contract (opt-in; never paid)", { skip: process.env.BUNNY_MA4_LIVE !== "1", timeout: 90000 }, async () => {
  const endpoint = new URL(process.env.BUNNY_MA4_HOST_URL ?? "http://127.0.0.1:43119");
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname));
  assert.ok(endpoint.protocol === "http:" || endpoint.protocol === "https:");
  const token = process.env.BUNNY_MA4_HOST_TOKEN; assert.ok(token, "Explicit local Host authorization required.");
  const model = process.env.BUNNY_MA4_FREE_MODEL; assert.ok(model?.endsWith(":free"), "Only explicitly selected :free models may be exercised.");
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const command = async (action: string, data: unknown) => {
    const r = await fetch(new URL("/command", endpoint), { method: "POST", headers, body: JSON.stringify({ action, data }), signal: AbortSignal.timeout(8000) });
    assert.equal(r.status, 200, "Host refused the command; no diagnostic body is logged.");
    return await r.json() as { task?: { id: string } };
  };
  const created = await command("submit", { prompt: 'Return one JSON object {"ok":true}.', mode: "fast", override: "openrouter", modelOverride: model, constraints: { outputTokens: 64, maxRuntimeMs: 30000, responseFormat: "json" } });
  assert.ok(created.task?.id); const id = created.task.id;
  try {
    await command("approve", { id });
    const end = Date.now() + 40000;
    while (Date.now() < end) {
      const r = await fetch(new URL("/state", endpoint), { headers, signal: AbortSignal.timeout(8000) }); assert.equal(r.status, 200);
      const state = await r.json() as { tasks: { id: string; state: string; output: string; provider: string; model: string }[] };
      const task = state.tasks.find(t => t.id === id);
      if (task && ["completed", "failed", "stopped"].includes(task.state)) {
        assert.equal(task.state, "completed"); assert.equal(task.provider, "openrouter"); assert.equal(task.model, model);
        assert.deepEqual(JSON.parse(task.output), { ok: true }); return;
      }
      await new Promise(r => setTimeout(r, 100));
    }
    throw new Error("Live inference deadline reached.");
  } finally { await command("stop", { id }).catch(() => undefined); }
});
