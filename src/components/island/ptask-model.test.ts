import test from "node:test";
import assert from "node:assert/strict";
import { ptaskRows, type PtaskSnapshot } from "./ptask-model.ts";
import type { TaskView } from "../../lib/bunny-host/ma4/task-runtime.ts";

const base: TaskView = { id: "t", title: "Digest", projectId: "p", state: "RUNNING", display: "Working", version: 4, createdAt: 1, updatedAt: 10, deadlineAt: null,
  progress: { done: 1, total: 3, current: "b" }, approval: { required: false, approvedUntil: null }, background: false, blocked: null, failure: null,
  uncertainOperation: null, models: [], dependsOn: [], evidence: [] };
const snap = (tasks: PtaskSnapshot["tasks"]) => ({ schema: "ma4.ptask.snapshot.v1", hostInstance: "h", at: 0, readOnly: null, policy: { background: false, resumeOnStart: false, notifications: { enabled: true, kinds: [] } }, uiAttached: true, tasks, notifications: [] }) as PtaskSnapshot;
const live = { live: true, snapshotAt: 1000, workstation: true, format: () => "14:05" };

test("S2-T1 task rows: Host facts only, urgent first, real step counts and evidence receipts", () => {
  const rows = ptaskRows(snap([base, { ...base, id: "u", state: "UNCERTAIN", display: "Needs attention", uncertainOperation: "u:s" },
    { ...base, id: "c", state: "COMPLETED", display: "Completed", progress: { done: 3, total: 3, current: null }, evidence: [{ stepId: "a", outputSha256: "abcdef0123456789" }] }]), live);
  assert.deepEqual(rows.map(r => r.id), ["u", "t", "c"]);
  assert.equal(rows[1].progress, "Step 2 of 3"); assert.equal(rows[1].tone, "active"); assert.deepEqual(rows[1].controls, ["pause", "cancel"]);
  assert.deepEqual(rows[0].controls, ["reconcile", "cancel"]); assert.match(rows[0].detail!, /may or may not have happened/);
  assert.equal(rows[2].progress, "All 3 steps completed"); assert.equal(rows[2].evidence, "1 step receipt · abcdef01"); assert.deepEqual(rows[2].controls, []);
});

test("S2-T1 task rows: a stale view never reads as running now and offers no controls", () => {
  const [row] = ptaskRows(snap([base]), { ...live, live: false });
  assert.equal(row.label, "Last known: Working (14:05)"); assert.equal(row.tone, "neutral");
  assert.deepEqual(row.controls, []); assert.equal(row.note, "Controls are paused until the Host answers.");
});

test("S2-T1 task rows: a phone supervises but approves and resolves on the PC; corrupt rows never offer controls", () => {
  const rows = ptaskRows(snap([{ ...base, id: "w", state: "AWAITING_APPROVAL", display: "Waiting for approval" }, { ...base, id: "p", state: "PAUSED", display: "Paused" }, { id: "x", corrupt: true, display: "Needs attention", detail: "hash mismatch" }]), { ...live, workstation: false });
  const by = Object.fromEntries(rows.map(r => [r.id, r]));
  assert.deepEqual(by.w.controls, ["cancel"]); assert.equal(by.w.note, "Approve or resolve this on your PC.");
  assert.deepEqual(by.p.controls, ["resume", "cancel"]);
  assert.deepEqual(by.x.controls, []); assert.equal(by.x.title, "Unreadable task");
});
