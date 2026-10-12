import test from "node:test";
import assert from "node:assert/strict";
import { modelActivity, personalAgentRows, reviewsLabel, telemetryView, TELEMETRY_FRESH_MS } from "./context-model.ts";

const sample = (at: number, extra: Record<string, unknown> = {}) =>
  ({
    at,
    cpu: { utilization: 37.4, clockMhz: null, temperatureC: null },
    memory: { usedBytes: 6, availableBytes: 4, totalBytes: 10 },
    gpus: [],
    notes: [],
    ...extra,
  }) as never;

test("T13 context: no Host sample means no telemetry at all, and the label says so", () => {
  assert.deepEqual(telemetryView([], 1_000), { available: false, label: "Sensor unavailable" });
  assert.deepEqual(telemetryView([{ at: Number.NaN } as never], 1_000), { available: false, label: "Sensor unavailable" });
});

test("T13 context: telemetry is the newest real sample's own figures, never the board's placeholders", () => {
  const view = telemetryView([sample(100), sample(900, { cpu: { utilization: 12.2 }, memory: { usedBytes: 3, totalBytes: 4 } })] as never, 1_000);
  assert.equal(view.available, true);
  if (!view.available) return;
  assert.equal(view.at, 900);
  assert.equal(view.cpuPercent, 12);
  assert.equal(view.memoryUsedPercent, 75);
  assert.equal(view.gpuPercent, null, "no GPU sample means no GPU figure");
  assert.notEqual(view.cpuPercent, 24, "the board's CPU 24 % is never shipped");
});

test("T13 context: an unreported CPU stays unknown rather than zero", () => {
  const view = telemetryView([sample(500, { cpu: { utilization: null } })] as never, 1_000);
  assert.equal(view.available && view.cpuPercent, null);
});

test("T13 context: an old sample is shown with its time, never as the present", () => {
  const fresh = telemetryView([sample(1_000)] as never, 1_000 + TELEMETRY_FRESH_MS);
  const stale = telemetryView([sample(1_000)] as never, 1_000 + TELEMETRY_FRESH_MS + 1);
  assert.equal(fresh.available && fresh.fresh, true);
  assert.equal(stale.available && stale.fresh, false);
  assert.equal(stale.available && stale.at, 1_000, "the time the sample was taken is kept");
});

test("T13 context: GPU load is the highest real GPU reading, and absent readings are ignored", () => {
  const view = telemetryView([sample(10, { gpus: [{ name: "a", utilization: 40 }, { name: "b", utilization: null }, { name: "c", utilization: 71.6 }] })] as never, 20);
  assert.equal(view.available && view.gpuPercent, 72);
});

test("T13 context: model activity lists only running Tasks, with the provider and the reported model", () => {
  const rows = modelActivity([
    { id: "t1", title: "Research", provider: "codex", model: "gpt-x", state: "running" },
    { id: "t2", title: "Done", provider: "claude", model: "auto", state: "completed" },
    { id: "t3", title: "Review", provider: "ollama", model: "", state: "verifying" },
    { id: "t4", title: "Asks", provider: "cline", model: "x", state: "waiting_for_approval" },
  ] as never);
  assert.deepEqual(rows.map((row) => row.taskId), ["t1", "t3", "t4"]);
  assert.equal(rows[0].model, "gpt-x");
  assert.equal(rows[1].model, "Provider Default — Exact model unknown", "an empty model is never guessed");
});

test("T13 context: personal agent rows show the slot's state, and an unassigned slot points at the Studio", () => {
  const rows = personalAgentRows({
    slots: [
      { slot: 1, weapon: "gada", displayName: "Ledger", agentId: "a1", agent: { name: "Researcher" }, presentation: { label: "Researching" } },
      { slot: 2, weapon: "spear", displayName: "Spear", agentId: null, agent: null, presentation: { label: "Not assigned" } },
    ],
  } as never);
  assert.deepEqual(rows.map((row) => [row.name, row.bound, row.stateLabel]), [
    ["Ledger", true, "Researching"],
    ["Spear", false, "Set up in Studio"],
  ]);
  assert.deepEqual(personalAgentRows(null), []);
});

test("T13 context: the reviews line counts real asks and never invents one", () => {
  assert.equal(reviewsLabel(0), "Nothing waiting for you");
  assert.equal(reviewsLabel(1), "1 review waiting for you");
  assert.equal(reviewsLabel(3), "3 reviews waiting for you");
  assert.equal(reviewsLabel(Number.NaN), "Nothing waiting for you");
});

test("T13 context: when the Host is not live, agent rows, running work, reviews and telemetry say last known", () => {
  const snapshot = {
    slots: [{ slot: 1, weapon: "gada", displayName: "Ledger", agentId: "a1", agent: { name: "Researcher" }, presentation: { label: "Researching" } }],
  } as never;
  assert.equal(personalAgentRows(snapshot, false)[0].stateLabel, "Last known: Researching");
  assert.equal(personalAgentRows(snapshot, true)[0].stateLabel, "Researching");
  const tasks = [{ id: "t1", title: "Research", provider: "codex", model: "gpt-x", state: "running" }] as never;
  assert.deepEqual(modelActivity(tasks, false), [], "retained running work is not shown while the Host is not live");
  assert.equal(modelActivity(tasks, true).length, 1);
  assert.equal(reviewsLabel(2, false), "Last known: 2 reviews waiting for you");
  assert.equal(reviewsLabel(0, false), "Last known: nothing waiting for you");
  const old = telemetryView([sample(1_000)] as never, 1_000, false);
  assert.equal(old.available && old.fresh, false, "a sample is never live when the Host is not");
  const live = telemetryView([sample(1_000)] as never, 1_000, true);
  assert.equal(live.available && live.fresh, true);
});
