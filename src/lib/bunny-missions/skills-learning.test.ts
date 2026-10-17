import test from "node:test";
import assert from "node:assert/strict";
import { HostDatabase } from "../bunny-host/persistence.server.ts";
import { MissionStore } from "./store.server.ts";
import { SkillLibrary, USE_CASE_MIN_MISSIONS } from "./skills.server.ts";
import type { CapabilityBus } from "./capabilities/bus.server.ts";
import type { CapabilityRun } from "./types.ts";

/**
 * Self-evolving skills: a routine the owner repeats across Missions becomes a candidate skill. Only succeeded,
 * non-private runs count; the longest routine wins; nothing already covered is duplicated; a learned skill never
 * runs before a verified run promotes it.
 */

let clock = 1_700_000_000_000;
let serial = 0;
type Step = { action: string; params: Record<string, unknown>; status?: CapabilityRun["status"] };
function mission(store: MissionStore, missionId: string, steps: Step[]) {
  for (const step of steps) {
    const at = (clock += 1000);
    store.saveRun({
      id: `run-${++serial}`, action: step.action, capability: step.action.split(".")[0], missionId, stepId: null, risk: "read",
      decision: "allow", decisionReason: "fixture", params: step.params, status: step.status ?? "succeeded", summary: "ok", evidence: [],
      artifactIds: [], startedAt: at, finishedAt: at + 10, durationMs: 10, origin: "workstation",
    } as unknown as CapabilityRun);
  }
}
const notify: Step = { action: "notifications.send", params: { title: "Build done" } };
const read: Step = { action: "filesystem.read", params: { path: "report.md" } };
const capture: Step = { action: "browser.screenshot", params: { fullPage: false } };

function library() {
  const db = new HostDatabase(":memory:");
  const store = new MissionStore(db);
  const events: string[] = [];
  const skills = new SkillLibrary(store, {} as CapabilityBus, (type, detail) => events.push(`${type}: ${detail}`));
  return { db, store, skills, events };
}

test("a routine repeated in enough Missions becomes one candidate skill; the longest wins; nothing repeats", async () => {
  const { db, store, skills, events } = library();
  try {
    for (let n = 1; n < USE_CASE_MIN_MISSIONS; n++) mission(store, `m${n}`, [read, notify, capture]);
    assert.deepEqual(skills.learnUseCases(), [], "below the threshold nothing is learned");

    mission(store, `m${USE_CASE_MIN_MISSIONS}`, [read, notify, capture]);
    mission(store, "noise", [capture, read]);
    const learned = skills.learnUseCases();
    assert.equal(learned.length, 1, "read → notify and notify → capture sit inside the longer routine");
    assert.deepEqual(learned[0].steps.map((step) => step.action), ["filesystem.read", "notifications.send", "browser.screenshot"]);
    assert.equal(learned[0].status, "candidate");
    assert.equal(learned[0].provenance, "recorded");
    assert.ok(events.some((event) => event.startsWith("skill.learned") && /in 3 Missions/.test(event)));

    assert.deepEqual(skills.learnUseCases(), [], "a learned routine is not learned twice");
    await assert.rejects(skills.run(learned[0].id, {}, { missionId: null, stepId: null, envelope: null, origin: "workstation", cwd: ".", roots: ["."], direct: { confirmed: true } }), /unverified candidate/);
  } finally { db.close(); }
});

test("failed, private, single-Mission and already-covered routines are never learned", () => {
  const { db, store, skills } = library();
  try {
    const secret: Step = { action: "filesystem.write", params: { path: "x", content: "[12 characters]" } };
    const failed: Step = { ...notify, status: "failed" };
    for (let n = 0; n < USE_CASE_MIN_MISSIONS; n++) {
      mission(store, `private-${n}`, [read, secret, read]);
      mission(store, `failed-${n}`, [failed, capture]);
      // The built-in git.snapshot skill already does exactly this.
      mission(store, `git-${n}`, [{ action: "git.status", params: {} }, { action: "git.diff", params: {} }]);
    }
    mission(store, "solo", [read, notify, read, notify, read, notify]);
    assert.deepEqual(skills.learnUseCases(), []);
  } finally { db.close(); }
});
