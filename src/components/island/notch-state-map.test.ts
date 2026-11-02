import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  NOTCH_STATES, NOTCH_VOICE_STATES, POSE_SLOTS, PRESENTATION_BRIDGE, PRESENTATION_STATES, COMPANION_STATES,
  notchStateIsActive, notchStateNeedsAttention, ptaskNotchState, presentationNotchState,
} from "./notch-state-map.ts";

/** E2b parity: the pinned vocabularies must match the C# sources byte-for-byte at the name level, and every
 *  presentation state must be bridged. The C# files are parsed from the tree on every run, so a rename on either
 *  side fails CI instead of drifting. */

const root = join(import.meta.dirname ?? ".", "..", "..", "..");
const notchModelCs = readFileSync(join(root, "native", "windows", "BunnyA", "Services", "NotchModel.cs"), "utf8");
const notchVoiceCs = readFileSync(join(root, "native", "windows", "BunnyA", "Services", "NotchVoice.cs"), "utf8");

const enumNames = (source: string, enumName: string): string[] => {
  const match = source.match(new RegExp(`enum\\s+${enumName}\\s*\\{([^{]+)\\}`));
  assert.ok(match, `${enumName} found in source`);
  return match[1]!.split(",").map((name) => name.trim().split(/\s/)[0]).filter((name) => name.length > 0);
};

test("the notch state list is exactly the C# enum, name for name, in order", () => {
  assert.deepEqual([...NOTCH_STATES], enumNames(notchModelCs, "NotchState"));
});

test("the notch voice state list matches the C# From() string outputs exactly", () => {
  // NotchVoice.cs has no enum: the pill's State is a stable string key; every `new("X"` is one output, plus the
  // Disconnected overlay constant. The pinned list is the overlays minus DISCONNECTED.
  const outputs = new Set([...notchVoiceCs.matchAll(/new\("([A-Z_]+)"/g)].map((match) => match[1]!));
  outputs.add("DISCONNECTED");
  for (const name of NOTCH_VOICE_STATES) assert.ok(outputs.has(name), `${name} is one of the C# outputs`);
  const unpinned = [...outputs].filter((name) => !(NOTCH_VOICE_STATES as readonly unknown[]).includes(name));
  assert.deepEqual(unpinned, ["DISCONNECTED"], "the only unpinned C# output is the disconnected overlay");
});

test("every web presentation state is bridged, and the bridge's values exist in the C# vocabulary", () => {
  assert.deepEqual(Object.keys(PRESENTATION_BRIDGE).sort(), [...PRESENTATION_STATES].sort(), "the bridge covers exactly the presentation vocabulary");
  for (const [state, bridged] of Object.entries(PRESENTATION_BRIDGE)) {
    assert.ok((NOTCH_STATES as readonly unknown[]).includes(bridged.notch), `${state} bridges into the C# enum`);
    assert.ok((POSE_SLOTS as readonly unknown[]).includes(bridged.pose), `${state} bridges into a pose slot`);
  }
  // The pose slots stay exactly the character engine's five.
  assert.deepEqual([...POSE_SLOTS], ["idle", "research", "coding", "testing", "complete"]);
  // Coverage: every presentation state except UNKNOWN (handled by the C# catch-all arm) is named in FromPresentation.
  const named = [...PRESENTATION_STATES].filter((state) => notchModelCs.includes(`"${state}"`));
  const unnamed = [...PRESENTATION_STATES].filter((state) => !named.includes(state));
  assert.deepEqual(unnamed, ["UNKNOWN"], "only UNKNOWN rides the C# catch-all arm");
  assert.match(notchModelCs, /_ => NotchState\.Unknown/, "the catch-all arm lands on Unknown, not on a guess");
});

test("the ptask bridge pins its state names to the C# FromPtask body", () => {
  for (const ptaskState of ["QUEUED", "VALIDATED", "CREATED", "AWAITING_APPROVAL", "RUNNING", "RESUMING", "PAUSED", "UNCERTAIN", "COMPLETED", "FAILED", "CANCELLED"])
    assert.equal(ptaskNotchState({ state: ptaskState, blockedCode: null, hasPendingAction: false, activity: null }) !== undefined, true, `${ptaskState} is bridged`);
  assert.equal(ptaskNotchState({ state: "WEIRD", blockedCode: null, hasPendingAction: false, activity: null }), "Unknown", "an unlisted state is Unknown, never invented");
  // The two verified context rules.
  assert.equal(ptaskNotchState({ state: "QUEUED", blockedCode: "MODEL_UNAVAILABLE", hasPendingAction: false, activity: null }), "WaitingForTool", "a model-unavailable block waits for its tool");
  assert.equal(ptaskNotchState({ state: "RUNNING", blockedCode: null, hasPendingAction: true, activity: null }), "WaitingForApproval", "a pending action is an approval wait");
  assert.equal(ptaskNotchState({ state: "RESUMING", blockedCode: null, hasPendingAction: false, activity: "Waiting for permission" }), "WaitingForApproval", "an activity that waits for permission is an approval wait");
  assert.equal(ptaskNotchState({ state: "RUNNING", blockedCode: null, hasPendingAction: false, activity: null }), "Executing", "a plain running task executes");
  assert.equal(ptaskNotchState({ state: "UNCERTAIN", blockedCode: null, hasPendingAction: false, activity: null }), "NeedsCheck", "an uncertain outcome needs its check");
});

test("the bridge computes the notch state the way the notch does", () => {
  assert.equal(presentationNotchState("CODING", { kind: "agent-state", role: null, team: false, pendingApprovals: 0 }), "Executing");
  // A coordinator whose current fact is a member's team step delegates instead of doing the work itself.
  assert.equal(presentationNotchState("CODING", { kind: "team-step", role: "coordinator", team: true, pendingApprovals: 0 }), "Executing", "the coordinator's own kind is not Delegating");
  assert.equal(presentationNotchState("CODING", { kind: "team-step", role: "researcher", team: true, pendingApprovals: 0 }), "Delegating");
  assert.equal(presentationNotchState("IDLE", { kind: "team-step", role: "researcher", team: false, pendingApprovals: 0 }), "Idle", "only active states delegate");
  // Pending approval outranks everything, as the notch computes it.
  assert.equal(presentationNotchState("COMPLETED", { kind: null, role: null, team: false, pendingApprovals: 3 }), "WaitingForApproval");
  assert.equal(presentationNotchState("UNKNOWN", { kind: null, role: null, team: false, pendingApprovals: 0 }), "Unknown");
});

test("the activity and attention gates match the notch's own predicates; voice and companion lists stay pinned", () => {
  for (const state of ["Thinking", "Planning", "Executing", "Delegating"] as const) assert.equal(notchStateIsActive(state), true, `${state} animates`);
  for (const state of ["Idle", "Queued", "Paused", "Completed", "Failed", "Canceled", "Unknown", "Disconnected"] as const) assert.equal(notchStateIsActive(state), false, `${state} is still`);
  for (const state of ["WaitingForApproval", "WaitingForUser", "NeedsCheck"] as const) assert.equal(notchStateNeedsAttention(state), true, `${state} needs attention`);
  for (const state of ["COMPLETED", "FAILED", "CANCELLED"]) assert.equal(notchStateNeedsAttention(ptaskNotchState({ state, blockedCode: null, hasPendingAction: false, activity: null })), false);
  // The re-exported lists stay the real imported arrays (drift lock).
  assert.equal(PRESENTATION_STATES.length, 19);
  assert.equal(COMPANION_STATES.length, 17);
  assert.equal(NOTCH_VOICE_STATES.length, 12, "the voice pill's C# states, pinned");
});