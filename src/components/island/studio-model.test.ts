import test from "node:test";
import assert from "node:assert/strict";
import { defaultPersonalAgentsConfig, projectPersonalAgents } from "../../lib/bunny-host/personal-agents.ts";
import {
  authorityFacts,
  bindAgent,
  draftFromSnapshot,
  isDirty,
  saveRefusalText,
  slotErrors,
  studioMode,
  swapWeapon,
  validateDraft,
  type StudioSlot,
} from "./studio-model.ts";

const bindable = new Set(["a1", "a2"]);
const base = (): StudioSlot[] => draftFromSnapshot({ slots: defaultPersonalAgentsConfig(0).slots.map((slot) => ({ ...slot, presentation: undefined, agent: null, attention: { pendingApprovals: 0 }, progress: null, result: null, technical: null })) } as never);

test("T13 studio: the draft is a content copy of the Host's four slots, in slot order", () => {
  const draft = base();
  assert.deepEqual(draft.map((slot) => slot.slot), [1, 2, 3, 4]);
  assert.deepEqual(draft.map((slot) => slot.weapon), ["gada", "spear", "chakra", "sword"]);
  assert.equal(draft[0].displayName, "Gada", "an unnamed slot keeps the weapon's own name, as the Host projects it");
  draft[0].responsibilities.push("coding");
  assert.deepEqual(base()[0].responsibilities, [], "editing a draft never edits the source");
});

test("T13 studio: a fresh default draft validates with no errors", () => {
  assert.deepEqual(validateDraft(base(), bindable), []);
});

test("T13 studio: a binding outside the bindable Agents is refused client side, naming the slot", () => {
  const draft = bindAgent(base(), 2, "internal-planner");
  const errors = validateDraft(draft, bindable);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].field, "agentId");
  assert.equal(errors[0].slot, 2);
  assert.equal(slotErrors(errors, 2).length, 1);
  assert.equal(slotErrors(errors, 1).length, 0);
});

test("T13 studio: one Agent can fill only one slot, and binding moves it rather than duplicating it", () => {
  let draft = bindAgent(base(), 1, "a1");
  draft = bindAgent(draft, 3, "a1");
  assert.equal(draft[0].agentId, null, "the Agent left its first slot");
  assert.equal(draft[2].agentId, "a1");
  assert.equal(validateDraft(draft, bindable).length, 0);
  const forced = base();
  forced[0].agentId = "a1";
  forced[1].agentId = "a1";
  assert.equal(validateDraft(forced, bindable).filter((error) => error.message.includes("only one slot")).length, 1);
});

test("T13 studio: binding a slot turns it on; unassigning keeps its active choice", () => {
  const draft = base();
  draft[1].active = false;
  assert.equal(bindAgent(draft, 2, "a2")[1].active, true);
  assert.equal(bindAgent(draft, 2, null)[1].active, false);
});

test("T13 studio: a weapon swap keeps the four weapons unique and never moves bindings", () => {
  const draft = bindAgent(base(), 1, "a1");
  const swapped = swapWeapon(draft, 1, "sword");
  assert.deepEqual(swapped.map((slot) => slot.weapon), ["sword", "spear", "chakra", "gada"]);
  assert.equal(swapped[0].agentId, "a1", "the Agent stays with its slot");
  assert.equal(validateDraft(swapped, bindable).length, 0);
  assert.deepEqual(swapWeapon(draft, 1, "gada"), draft.map((row) => ({ ...row })), "choosing the same weapon changes nothing");
});

test("T13 studio: over-long text, unknown tags and a broken weapon set are all refused", () => {
  const draft = base();
  draft[0].displayName = "x".repeat(41);
  draft[1].description = "y".repeat(281);
  draft[2].purpose = "z".repeat(281);
  draft[3].responsibilities = ["research", "launch-missiles" as never];
  const fields = validateDraft(draft, bindable).map((error) => error.field);
  assert.deepEqual(fields, ["displayName", "description", "purpose", "responsibilities"]);
  const broken = base();
  broken[1].weapon = "gada";
  assert.equal(validateDraft(broken, bindable).some((error) => error.field === "weapon"), true);
});

test("T13 studio: dirty means the content differs from the Host's last confirmed slots, in any order", () => {
  const saved = base();
  assert.equal(isDirty(saved, base()), false);
  const edited = base();
  edited[0].description = "Reads the spec";
  assert.equal(isDirty(edited, saved), true);
  const reordered = [...base()].reverse();
  assert.equal(isDirty(reordered, base()), false);
});

test("T13 studio: a refused save shows the Host's own words, and an unknown outcome is never called saved or failed", () => {
  assert.equal(saveRefusalText({ code: "COMMAND_REFUSED", message: "Personal Agents changed since this view was loaded (current revision 4). Nothing was changed; review the current slots." }), "Personal Agents changed since this view was loaded (current revision 4). Nothing was changed; review the current slots.");
  assert.equal(saveRefusalText({ code: "OUTCOME_UNKNOWN", message: "", outcome: "unknown" }), "Outcome unknown. Checking the Host before saving again.");
  assert.equal(saveRefusalText({ code: "HOST_UNREACHABLE", message: "" }), "Bunny-A Host is unreachable. Nothing was saved.");
  assert.equal(saveRefusalText({ code: "X", message: "" }), "The Host refused this change. Nothing was saved.");
});

test("T13 studio: a paired device reads the Studio and is told why it cannot edit", () => {
  assert.equal(studioMode("workstation").editable, true);
  assert.equal(studioMode("device").editable, false);
  assert.match(studioMode("device").caption, /Windows PC/);
  assert.equal(studioMode(null).editable, true);
});

test("T13 studio: execution authority is read from the projection and never invented", () => {
  assert.equal(authorityFacts(null), null);
  assert.deepEqual(
    authorityFacts({ state: "ACTIVE", remainingActions: 3, remainingMs: 15 * 60_000, pending: [] }),
    { stateLabel: "Active", remainingActions: 3, remainingMinutes: 15, pendingAsks: 0 },
  );
  assert.deepEqual(
    authorityFacts({ state: "WAITING_FOR_USER", remainingActions: Number.NaN, remainingMs: -5, pending: [{}, {}] }),
    { stateLabel: "Waiting for your consent", remainingActions: null, remainingMinutes: 0, pendingAsks: 2 },
  );
  assert.equal(authorityFacts({ state: "SOMETHING_NEW", remainingActions: 0, remainingMs: 0, pending: [] })?.stateLabel, "Status unknown");
});

test("T13 studio: the projected snapshot drafts back to the same four slots with no agent facts leaking in", () => {
  const snapshot = projectPersonalAgents({
    config: { ...defaultPersonalAgentsConfig(0), slots: defaultPersonalAgentsConfig(0).slots.map((slot) => (slot.slot === 1 ? { ...slot, agentId: "a1" } : slot)) },
    agents: [{ id: "a1", name: "Researcher", state: "RUNNING", missionId: null, createdAt: 0, updatedAt: 0, failure: null, team: null, authorization: null }] as never,
    missions: [],
    tasks: [],
    now: 0,
  });
  const draft = draftFromSnapshot(snapshot);
  assert.equal(draft[0].agentId, "a1");
  assert.equal(Object.keys(draft[0]).includes("presentation"), false);
  assert.equal(Object.keys(draft[0]).includes("agent"), false);
});
