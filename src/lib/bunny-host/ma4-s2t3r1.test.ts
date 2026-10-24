// MA4-S2-T3R1: the Planner's structured-output contract carries the Host's pins (docs/ma4-s2-t3r1/PLANNER_MODEL_PIN_ANALYSIS.md).
// The schema steers the model; validation stays the authority, so a missing or substituted pin is refused, never repaired.
import test from "node:test";
import assert from "node:assert/strict";
import { MODEL, rig } from "./ma4-s2t2-fixtures.ts";
import { planConnectedTask, planSchema } from "./ma4/connected-workflow.server.ts";
import type { ModelCall } from "./ma4/coding-workflow.server.ts";
import { DAY, envelope as penvelope, HOUR, prig, schedule, WS } from "./ma4-s2t3-fixtures.ts";

const envelope = (over: Record<string, unknown> = {}) => ({ capabilities: ["file.read", "local.generate", "local.review"], providers: ["ollama"] as ["ollama"], localOnly: true as const, models: [MODEL], projectScopes: ["p1"], sideEffects: false, background: false,
  budgets: { maxModelCalls: 5, maxWallMs: 60_000 }, expiresAt: Date.now() + 3_600_000, grants: { files: [{ root: "proj", access: "read" as const }], origins: [], services: [] }, ...over });
type Branch = { properties: { kind: { enum: string[] }; model: { enum?: string[]; type?: string }; input: { properties?: Record<string, { type?: string }>; required?: string[]; additionalProperties?: boolean } }; required: string[] };
const branches = (s: Record<string, any>): Branch[] => s.properties.steps.items.anyOf ?? [s.properties.steps.items];
const byKind = (s: Record<string, any>) => Object.fromEntries(branches(s).map(b => [b.properties.kind.enum[0], b]));

test("T3R1-P1 the Planner's format allows only granted actions with their own inputs, and only the envelope's pins on model steps", async () => {
  const r = await rig();
  try {
    const facts = r.rt.executorFacts(), catalog = r.connected.catalog;
    const k = byKind(planSchema(catalog, facts, envelope())!);
    assert.deepEqual(Object.keys(k).sort(), ["file.read", "local.generate", "local.review"]);
    assert.equal(k["file.read"].properties.model.type, "null");
    for (const kind of ["local.generate", "local.review"]) assert.deepEqual(k[kind].properties.model.enum, [MODEL]);
    for (const b of Object.values(k)) assert.ok(b.required.includes("model"), "model is always stated, never left out");
    // The connector's own contract: maxChars is an optional integer (left out, never null); unknown fields are not allowed.
    const read = k["file.read"].properties.input;
    assert.equal(read.properties!.maxChars.type, "integer"); assert.deepEqual(read.required, ["root", "path"]); assert.equal(read.additionalProperties, false);
    assert.deepEqual(k["local.review"].properties.input.required, ["criteria", "subjectFrom"]);
    assert.deepEqual(Object.keys(byKind(planSchema(catalog, facts, envelope({ capabilities: ["file.read"] }))!)), ["file.read"], "an ungranted action is not offered");
    const noModels = branches(planSchema(catalog, facts, envelope({ models: [] }))!);
    assert.deepEqual(noModels.flatMap(b => b.properties.kind.enum), ["file.read"], "no pin, no model step offered");
    assert.equal(planSchema(catalog, facts, envelope({ capabilities: ["bank.transfer"] })), null);
  } finally { await r.close(); }
});

test("T3R1-P2 the format is sent with the call; missing, wrong or unauthorized pins in the answer are still refused", async () => {
  const r = await rig();
  try {
    r.root("proj", { "notes.md": "x" });
    let sent: Record<string, unknown> | null | undefined;
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

test("T3R1-R1 retention holds while the Host keeps running: settled tasks and schedules are pruned without a restart", async () => {
  const p = await prig();
  try {
    p.root("atlas", { "STATUS.md": "Atlas status.\n" });
    const t = p.rt.create({ spec: { title: "Old check", projectId: "p1", steps: [{ id: "read", kind: "file.read", input: { root: "atlas", path: "STATUS.md" } }], acceptance: { requiredSteps: ["read"] } },
      envelope: penvelope(["file.read"], { files: [{ root: "atlas", access: "read" }] }) }, WS);
    await p.drain();
    assert.equal(p.rt.view(t.id).display, "Completed");
    const s = p.engine.scheduleCreate({ spec: schedule() }, WS);
    p.engine.scheduleControl(s.id, "cancel", WS);
    p.clock.t += 31 * DAY;
    await p.rt.maintain(); await p.engine.tick();
    assert.equal(p.rt.views().some(v => v.id === t.id), false, "a 31-day-old completed task is gone without a restart");
    assert.equal(p.engine.store.list("schedule").some(r => r.ok && r.record.id === s.id), false, "a 31-day-old cancelled schedule is gone without a restart");
    // A recent task is kept: the second pass within the hour does nothing.
    const fresh = p.rt.create({ spec: { title: "New check", projectId: "p1", steps: [{ id: "read", kind: "file.read", input: { root: "atlas", path: "STATUS.md" } }], acceptance: { requiredSteps: ["read"] } },
      envelope: penvelope(["file.read"], { files: [{ root: "atlas", access: "read" }] }, { expiresAt: p.clock.t + DAY }) }, WS);
    await p.drain();
    p.clock.t += HOUR; await p.rt.maintain();
    assert.equal(p.rt.views().some(v => v.id === fresh.id), true);
    for (let i = 0; i < 1_200; i++) (p.engine as unknown as { late(ms: number): void }).late(i);
    assert.equal(p.engine.lateness.length, 1_000, "lateness keeps only the most recent slots");
  } finally { await p.close(); }
});
