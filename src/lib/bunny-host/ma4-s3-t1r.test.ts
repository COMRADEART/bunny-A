import test from "node:test";
import assert from "node:assert/strict";
import { policySourceContainsHoldoutIds, runOffline } from "../../../scripts/ma4-s3-t1r/evaluate.mjs";
import { admitWork, onMemoryFailure, orderQueue } from "./ma4/s3t1.ts";

test("T1R offline tasks use evidence, and the holdout ids stay out of the policy module", async () => {
  assert.deepEqual(policySourceContainsHoldoutIds(), []);
  const report = await runOffline();
  assert.equal(report.classificationCountedAsSuccess, false);
  assert.equal(report.preferenceSelectedNothing, true);
  assert.equal(report.preferenceOfferedChoice, true);
  for (const set of ["development", "holdout"]) {
    assert.ok(report.counts[`${set}:C0`] >= 10 && report.counts[`${set}:C0`] <= 15);
    assert.ok(report.counts[`${set}:C1`] >= 10 && report.counts[`${set}:C1`] <= 15);
    assert.ok(report.counts[`${set}:C2`] >= 10 && report.counts[`${set}:C2`] <= 15);
    assert.ok(report.counts[`${set}:C3`] >= 5 && report.counts[`${set}:C3`] <= 10);
  }
  const actionable = report.rows.filter((row) => row.outcome !== "not-tested-offline");
  assert.ok(actionable.length >= 50);
  const wrong = actionable.filter((row) => {
    if (row.outcome === "uncertain") return row.verification !== "unavailable";
    if (row.outcome === "refused") return row.functionalCorrect !== true || row.approvalsClearedOnReplan !== true;
    if (row.id.endsWith("bad-exit")) return row.verification !== "failed";
    return row.outcome !== "verified" || row.functionalCorrect !== true;
  });
  assert.deepEqual(wrong.map((row) => row.id), []);
  const c0 = report.rows.filter((row) => row.complexity === "C0");
  assert.ok(c0.every((row) => row.outcome === "not-tested-offline" && row.functionalCorrect == null));
});

test("stop stays ahead of inference admission and memory failure does not swap models", () => {
  const ordered = orderQueue([
    { id: "background", priority: "P3", kind: "inference" },
    { id: "interactive", priority: "P1", kind: "inference" },
    { id: "stop", priority: "P0", kind: "control" },
  ]);
  assert.deepEqual(ordered.map((item) => item.id), ["stop", "interactive", "background"]);
  assert.equal(admitWork({ kind: "control", priority: "P0", needBytes: 9e9, budgetBytes: 1, reservedBytes: 1, activeLoads: 2 }).action, "run");
  assert.equal(admitWork({ kind: "inference", priority: "P3", needBytes: 8e9, budgetBytes: 4e9, reservedBytes: 0, activeLoads: 0 }).action, "queue");
  assert.equal(onMemoryFailure().substituteModel, false);
  assert.equal(onMemoryFailure().releaseReservation, true);
});
