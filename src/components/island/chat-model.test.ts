import test from "node:test";
import assert from "node:assert/strict";
import {
  composerChips,
  CHAT_QUESTION,
  greetingFor,
  missionStepCounts,
  QUICK_ACTIONS,
  recentMissionRows,
  stepLabel,
} from "./chat-model.ts";
import { NAV_VIEWS } from "./nav-model.ts";

const step = (id: string, state: string, verified: boolean | null = null) => ({ id, state, result: verified === null ? null : { verified } });
const mission = (id: string, updatedAt: number, steps: unknown[] = [], title = `Mission ${id}`) => ({ id, title, state: "running", updatedAt, steps });
const slot = (n: number, weapon: string, missionId: string | null, displayName = "") =>
  ({ slot: n, weapon, displayName, agentId: missionId ? `agent-${n}` : null, agent: missionId ? { missionId } : null, presentation: { label: "Working" } }) as never;

test("T13 chat: the greeting follows the hour and never carries a user name", () => {
  assert.equal(greetingFor(4), "Good evening", "small hours read as evening, as the board does");
  assert.equal(greetingFor(5), "Good morning");
  assert.equal(greetingFor(11), "Good morning");
  assert.equal(greetingFor(12), "Good afternoon");
  assert.equal(greetingFor(17), "Good afternoon");
  assert.equal(greetingFor(18), "Good evening");
  assert.equal(greetingFor(24), "Good evening", "24 wraps to midnight");
  assert.equal(greetingFor(Number.NaN), "Good morning", "a bad clock still greets without a name");
  assert.equal(CHAT_QUESTION, "What would you like to do today?");
});

test("T13 chat: quick actions either prefill a prompt or open an existing surface, and every target exists", () => {
  assert.equal(QUICK_ACTIONS.length, 5);
  assert.deepEqual(
    QUICK_ACTIONS.map((action) => action.label),
    ["Create a project", "Analyze code", "Fix errors", "Research anything", "Manage files"],
  );
  for (const action of QUICK_ACTIONS) {
    if (action.kind === "navigate") assert.ok((NAV_VIEWS as readonly string[]).includes(action.view), `${action.label} opens a real view`);
    else assert.ok(action.prompt.length > 10, `${action.label} carries a real prompt`);
  }
});

test("T13 chat: the composer shows Voice only where voice is available for this viewer", () => {
  assert.deepEqual(composerChips(false).map((chip) => chip.id), ["web", "files", "code"]);
  assert.deepEqual(composerChips(true).map((chip) => chip.id), ["web", "files", "code", "voice"]);
});

test("T13 chat: step counts are real and never a percentage", () => {
  const counts = missionStepCounts({
    steps: [step("1", "completed", true), step("2", "completed", false), step("3", "running"), step("4", "pending"), step("5", "completed", true), step("6", "failed"), step("7", "pending")] as never,
  });
  assert.deepEqual(counts, { completed: 3, total: 7, verified: 2 });
  assert.equal(stepLabel(counts), "3 of 7 steps · 2 verified");
  assert.equal(stepLabel({ completed: 0, total: 0, verified: 0 }), "No steps yet");
  assert.equal(stepLabel({ completed: 0, total: 2, verified: 0 }), "0 of 2 steps · 0 verified");
  assert.equal(stepLabel({ completed: 0, total: 1, verified: 0 }), "0 of 1 step · 0 verified");
});

test("T13 chat: a step that claims verification but is not completed still counts only as verified", () => {
  const counts = missionStepCounts({ steps: [step("1", "running", true)] as never });
  assert.deepEqual(counts, { completed: 0, total: 1, verified: 1 });
});

test("T13 chat: recent Missions are newest first, capped, and carry real state and counts", () => {
  const rows = recentMissionRows(
    [mission("m1", 10, [step("a", "completed", true)], "Alpha"), mission("m2", 30, [], "Beta"), mission("m3", 20, [], "Gamma")] as never,
    null,
    2,
  );
  assert.deepEqual(rows.map((row) => row.title), ["Beta", "Gamma"]);
  assert.equal(rows[0].stepLabel, "No steps yet");
  assert.equal(rows[0].stateLabel, "Running");
  assert.equal(rows[0].weapon, null, "no slotted Agent owns it, so the row shows a neutral icon");
});

test("T13 chat: a Mission owned by a slotted Agent carries that Agent's weapon and name; others carry none", () => {
  const personal = {
    slots: [slot(1, "gada", "m2", "Ledger"), slot(2, "spear", null), slot(3, "chakra", null), slot(4, "sword", null)],
  } as never;
  const rows = recentMissionRows([mission("m1", 1), mission("m2", 2)] as never, personal);
  const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
  assert.equal(byId.m2.weapon, "gada");
  assert.equal(byId.m2.weaponName, "Ledger");
  assert.equal(byId.m1.weapon, null);
});

test("T13 chat: an unnamed slot falls back to its weapon's name, not a placeholder", () => {
  const personal = { slots: [slot(1, "sword", "m1", "")] } as never;
  assert.equal(recentMissionRows([mission("m1", 1)] as never, personal)[0].weaponName, "Sword");
});

test("T13 chat: an empty Host has no Missions to show", () => {
  assert.deepEqual(recentMissionRows([], null), []);
});
