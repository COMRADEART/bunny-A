import test from "node:test";
import assert from "node:assert/strict";
import { noticeRows, proactiveHeadline, proactiveRows, type ProactiveSnapshot } from "./proactive-model.ts";

const goal = { id: "g", title: "Beta", projectId: "p1", state: "NEEDS_ATTENTION", origin: "owner", priority: "normal", version: 3, progress: { met: 1, total: 3 },
  criteria: [], deadlineAt: null, expiresAt: 9, attention: "Work for \"Release notes\" failed.", approvedUntil: 9, updatedAt: 1 };
const sched = { id: "s", title: "Evening summary", projectId: "p1", state: "ACTIVE", version: 2, trigger: "Daily 18:00 (UTC)", action: "task", nextAt: 5000, lastAttempt: null,
  approvedUntil: 9, goalId: null, missedPolicy: "skip", runningTaskId: null, expiresAt: 9, updatedAt: 1 };
const mon = { id: "m", title: "Release check", label: "Build status", projectId: "p1", state: "ACTIVE", version: 4, source: "file", lastCheckAt: 4000, lastClass: "no_change",
  nextCheckAt: 6000, errors: 0, changes: 1, checksLastHour: 3, intervalMs: 60_000, approvedUntil: 9, expiresAt: 9, updatedAt: 1 };
const snap = (o: Partial<Record<string, unknown>> = {}) => ({ schema: "ma4.proactive.snapshot.v1", at: 0, policy: {}, prefs: {}, goals: [goal], schedules: [sched], monitors: [mon], corrupt: [],
  notifications: [{ key: "source_changed:m:change:1", category: "source_changed", sourceKind: "monitor", sourceId: "m", priority: "normal", title: "Release check", reason: "Build status: now \"FAIL\".", verifiedState: "CHANGED", action: "open", at: 4000, deliverAt: 4000, delivered: true, dismissed: false, snoozedUntil: null }],
  held: 0, status: { monitoring: 1, scheduled: 1, working: 0, waiting: 0, attention: 1, nextRunAt: 5000 }, away: null, ...o }) as unknown as ProactiveSnapshot;
const live = { live: true, snapshotAt: 1000, workstation: true, format: (t: number) => `t${t}` };

test("S2-T3 proactive rows: attention first; monitoring is never shown as work; real progress", () => {
  const rows = proactiveRows(snap(), live);
  assert.deepEqual(rows.map(r => r.id), ["g", "s", "m"]);
  assert.equal(rows[0].label, "Needs attention"); assert.equal(rows[0].meta, "1 of 3 criteria met by completed work"); assert.deepEqual(rows[0].controls, ["pause", "cancel"]);
  assert.equal(rows[1].label, "Scheduled · next t5000"); assert.equal(rows[1].tone, "ok");
  assert.equal(rows[2].label, "Monitoring"); assert.equal(rows[2].tone, "neutral", "an idle monitor is not active work");
  assert.equal(rows[2].meta, "Build status · checked t4000 (no change) · no change seen yet · next check t6000"); assert.deepEqual(rows[2].controls, ["pause", "disable"]);
  // S2-T3R: last meaningful change shown; a source that keeps failing is its own state, not "Monitoring".
  const changed = proactiveRows(snap({ goals: [], schedules: [], monitors: [{ ...mon, lastChangeAt: 3000 }] }), live)[0];
  assert.match(changed.meta!, /last change t3000/);
  const broken = proactiveRows(snap({ goals: [], schedules: [], monitors: [{ ...mon, errors: 3, lastClass: "source_unavailable" }] }), live)[0];
  assert.equal(broken.label, "Cannot read source"); assert.equal(broken.tone, "danger"); assert.match(broken.detail!, /could not be read 3 times/);
  const working = proactiveRows(snap({ schedules: [{ ...sched, runningTaskId: "ptask-1" }] }), live).find(r => r.id === "s")!;
  assert.equal(working.label, "Working"); assert.equal(working.tone, "active");
});

test("S2-T3 proactive rows: approval only on the workstation; a stale view is labelled and has no controls", () => {
  const waiting = snap({ schedules: [{ ...sched, state: "AWAITING_APPROVAL" }], goals: [], monitors: [] });
  assert.deepEqual(proactiveRows(waiting, live)[0].controls, ["approve", "reject"]);
  assert.deepEqual(proactiveRows(waiting, { ...live, workstation: false })[0].controls, ["reject"], "the phone may turn it down, never approve it");
  const [stale] = proactiveRows(snap({ goals: [], monitors: [] }), { ...live, live: false });
  assert.equal(stale.label, "Last known: Scheduled · next t5000 (t1000)"); assert.deepEqual(stale.controls, []); assert.equal(stale.tone, "neutral");
  const missed = proactiveRows(snap({ goals: [], monitors: [], schedules: [{ ...sched, lastAttempt: { at: 77, outcome: "missed", reason: "Missed while Bunny-A was not running." } }] }), live)[0];
  assert.equal(missed.detail, "Missed while Bunny-A was not running."); assert.match(missed.meta!, /Last: missed t77/);
});

test("S2-T3 headline and notices: truthful, compact, last-known when offline", () => {
  assert.equal(proactiveHeadline(snap(), live), "1 needs attention · Monitoring 1 · Next run t5000");
  assert.equal(proactiveHeadline(snap({ status: { monitoring: 2, scheduled: 1, working: 1, waiting: 0, attention: 0, nextRunAt: 5 } }), { ...live, live: false }), "Last known: 1 working · Monitoring 2");
  assert.equal(proactiveHeadline(snap({ status: { monitoring: 0, scheduled: 0, working: 0, waiting: 0, attention: 0, nextRunAt: null } }), live), null);
  assert.deepEqual(noticeRows(snap()).map(n => [n.category, n.text]), [["Source changed", "Build status: now \"FAIL\"."]]);
});
