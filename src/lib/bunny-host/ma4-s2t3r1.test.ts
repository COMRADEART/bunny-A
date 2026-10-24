// MA4-S2-T3R1: the Planner's structured-output contract carries the Host's pins (docs/ma4-s2-t3r1/PLANNER_MODEL_PIN_ANALYSIS.md).
// The schema steers the model; validation stays the authority, so a missing or substituted pin is refused, never repaired.
import test from "node:test";
import assert from "node:assert/strict";
import { MODEL, rig } from "./ma4-s2t2-fixtures.ts";
import { planConnectedTask, planSchema } from "./ma4/connected-workflow.server.ts";
import type { ModelCall } from "./ma4/coding-workflow.server.ts";

const envelope = (over: Record<string, unknown> = {}) => ({ capabilities: ["file.read", "local.generate", "local.review"], providers: ["ollama"] as ["ollama"], localOnly: true as const, models: [MODEL], projectScopes: ["p1"], sideEffects: false, background: false,
  budgets: { maxModelCalls: 5, maxWallMs: 60_000 }, expiresAt: Date.now() + 3_600_000, grants: { files: [{ root: "proj", access: "read" as const }], origins: [], services: [] }, ...over });
type Branch = { properties: { kind: { enum: string[] }; model: { enum?: string[]; type?: string } }; required: string[] };
const branches = (s: Record<string, any>): Branch[] => s.properties.steps.items.anyOf ?? [s.properties.steps.items];

test("T3R1-P1 the Planner's format allows only granted actions, and only the envelope's pins on model steps", async () => {
  const r = await rig();
  try {
    const facts = r.rt.executorFacts(), catalog = r.connected.catalog;
    const [plain, model] = branches(planSchema(catalog, facts, envelope())!);
    assert.deepEqual(plain.properties.kind.enum, ["file.read"]); assert.equal(plain.properties.model.type, "null");
    assert.deepEqual(model.properties.kind.enum.sort(), ["local.generate", "local.review"]); assert.deepEqual(model.properties.model.enum, [MODEL]);
    for (const b of [plain, model]) assert.ok(b.required.includes("model"), "model is always stated, never left out");
    assert.deepEqual(branches(planSchema(catalog, facts, envelope({ capabilities: ["file.read"] }))!).flatMap(b => b.properties.kind.enum), ["file.read"], "an ungranted action is not offered");
    const noModels = branches(planSchema(catalog, facts, envelope({ models: [] }))!);
    assert.deepEqual(noModels.flatMap(b => b.properties.kind.enum), ["file.read"], "no pin, no model step offered");
    assert.equal(planSchema(catalog, facts, envelope({ capabilities: ["bank.transfer"] })), null);
  } finally { await r.close(); }
});

test("T3R1-P2 the format is sent with the call; missing, wrong or unauthorized pins in the answer are still refused", async () => {
  const r = await rig();
  try {
    r.root("proj", { "notes.md": "x" });
    let sent: Record<string, unknown> | undefined;
    const plan = async (steps: unknown[]) => planConnectedTask({ request: "Summarize notes.md and check it.", projectId: "p1", envelope: envelope(), model: MODEL, catalog: r.connected.catalog, facts: r.rt.executorFacts(), signal: AbortSignal.timeout(5_000), now: Date.now(),
      call: (async ({ model, schema }) => { sent = schema; return { ok: true, text: JSON.stringify({ title: "Plan", steps }), servedModel: model, durationMs: 1 }; }) as ModelCall });
    const read = { id: "rd", kind: "file.read", input: { root: "proj", path: "notes.md" }, model: null };
    const gen = (model: unknown) => ({ id: "sum", kind: "local.generate", input: { prompt: "Summarize.", contextFrom: "rd" }, model });
    const ok = await plan([read, gen(MODEL)]);
    assert.equal(ok.ok, true, JSON.stringify(ok.problems)); assert.equal(ok.spec!.steps[1].model, MODEL);
    assert.deepEqual(sent, planSchema(r.connected.catalog, r.rt.executorFacts(), envelope()));
    for (const [model, why] of [[null, /needs a pinned local model/], ["llama3:70b", /not in the envelope/], ["deepseek-v4.1-flash:cloud", /not in the envelope/]] as const) {
      const bad = await plan([read, gen(model)]);
      assert.equal(bad.ok, false, String(model)); assert.match(bad.problems.join(" "), why);
      assert.notEqual(bad.spec?.steps[1].model, MODEL, "never silently re-pinned");
    }
    assert.equal(r.rt.views().length, 0, "planning never creates a task");
  } finally { await r.close(); }
});
