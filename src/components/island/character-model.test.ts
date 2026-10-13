import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { PRESENTATION_STATES, WEAPONS, type PresentationBasis, type PresentationState } from "../../lib/bunny-host/personal-agents.ts";
import { COMPANION_STATES } from "../../lib/bunny-host/voice/voice-companion.ts";
import {
  allCharacterArtIds,
  basisText,
  BUNNY_IDENTITY_ART,
  characterLabel,
  characterMotion,
  characterOverlay,
  companionArtId,
  companionArtUrl,
  COMPANION_ART,
  displayState,
  hostLive,
  MOTION_TOKENS,
  STATE_POSE,
  TASK_LOOP_MS,
  transitionCue,
  WAITING_SPEED,
  weaponArtId,
  weaponArtUrl,
  weaponName,
  WEAPON_BASE,
  type CharacterSize,
} from "./character-model.ts";

const SIZES: CharacterSize[] = ["compact", "pose", "hero"];
const CHARACTER_DIR = new URL("../../../public/bunny-a/characters/", import.meta.url);
const MANIFEST = new URL("../../../assets/t13/derived/manifest.json", import.meta.url);
const NOW = 1_000_000;

test("C01 every weapon, every presentation state and every size resolves to a real PNG in public/bunny-a/characters", () => {
  for (const weapon of WEAPONS) {
    for (const state of PRESENTATION_STATES) {
      for (const size of SIZES) {
        const id = weaponArtId(weapon, state, size);
        if (state === "OFFLINE" && size === "pose") assert.equal(id, `${weapon}.pose1`, "offline holds the idle pose");
        assert.ok(id, `${weapon} ${state} ${size} has an asset`);
        assert.ok(existsSync(new URL(`${id}.png`, CHARACTER_DIR)), `${id}.png exists on disk`);
        assert.equal(weaponArtUrl(weapon, state, size), `/bunny-a/characters/${id}.png`);
      }
    }
  }
});

test("C02 every companion state resolves to a real PNG, and the hero identity image exists", () => {
  for (const state of COMPANION_STATES) {
    for (const size of SIZES) {
      const id = companionArtId(state, size);
      assert.ok(id, `${state} ${size} has an asset`);
      assert.ok(existsSync(new URL(`${id}.png`, CHARACTER_DIR)), `${id}.png exists`);
      assert.equal(companionArtUrl(state, size), `/bunny-a/characters/${id}.png`);
    }
  }
  assert.ok(existsSync(new URL(`${BUNNY_IDENTITY_ART}.png`, CHARACTER_DIR)));
});

test("C03 the referenced art set is exactly the 39 manifest assets: nothing unreferenced, nothing invented", () => {
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as { assets: { id: string }[] };
  const manifestIds = manifest.assets.map((asset) => asset.id).sort();
  assert.equal(manifestIds.length, 39);
  assert.deepEqual(allCharacterArtIds(), manifestIds);
});

test("C04 pose mapping: research, coding, testing and complete tiles per weapon, with complete = hero for Chakra and Sword", () => {
  assert.equal(STATE_POSE.RESEARCHING, "research");
  assert.equal(STATE_POSE.CODING, "coding");
  assert.equal(STATE_POSE.FILE_WORK, "coding");
  assert.equal(STATE_POSE.TESTING, "testing");
  assert.equal(STATE_POSE.VERIFYING, "testing", "checking work is shown on the testing tile, never the complete tile");
  assert.equal(weaponArtId("gada", "RESEARCHING", "pose"), "gada.pose2");
  assert.equal(weaponArtId("spear", "CODING", "pose"), "spear.pose3");
  assert.equal(weaponArtId("gada", "TESTING", "pose"), "gada.pose4");
  assert.equal(weaponArtId("spear", "COMPLETED", "pose"), "spear.pose5");
  assert.equal(weaponArtId("gada", "VERIFIED", "pose"), "gada.pose5");
  assert.equal(weaponArtId("chakra", "VERIFIED", "pose"), "chakra.hero", "Vishnu Chakra completes into its hero tile");
  assert.equal(weaponArtId("sword", "COMPLETED", "pose"), "sword.hero", "Sword completes into its hero tile");
  assert.equal(weaponArtId("chakra", "RESEARCHING", "pose"), "chakra.pose2");
  assert.equal(weaponArtId("sword", "TESTING", "pose"), "sword.pose4");
  for (const failing of ["FAILED", "WAITING_FOR_USER", "PAUSED", "UNKNOWN", "OFFLINE"] as const) {
    assert.equal(weaponArtId("gada", failing, "pose"), "gada.pose1", `${failing} never shows a result pose`);
  }
});

test("C05 compact and hero sizes ignore the state; compact is always the compact tile and hero always the hero tile", () => {
  for (const weapon of WEAPONS) {
    for (const state of PRESENTATION_STATES) {
      assert.equal(weaponArtId(weapon, state, "compact"), `${weapon}.compact`);
      assert.equal(weaponArtId(weapon, state, "hero"), `${weapon}.hero`);
    }
  }
});

test("C06 refusal: internal team members, providers and any other id are never drawn as a weapon", () => {
  for (const refused of ["planner", "researcher", "implementer", "documenter", "reviewer", "tester", "claude", "codex", "ollama", "cursor", "bunny", "", "GADA", "gada ", undefined, null, 7]) {
    assert.equal(weaponArtId(refused, "RESEARCHING", "pose"), null, `${String(refused)} has no weapon art`);
    assert.equal(weaponArtId(refused, "RESEARCHING", "compact"), null);
    assert.equal(weaponArtUrl(refused, "IDLE", "hero"), null);
    assert.equal(characterMotion(refused, "RESEARCHING", false).base, null, "an unknown id gets no motion");
  }
  assert.equal(weaponArtId("gada", "NOT_A_STATE" as PresentationState, "pose"), null, "an unknown state has no pose");
});

test("C07 companion states map to the board's states, with the identity image only at hero size for READY", () => {
  assert.equal(COMPANION_ART.READY, "bunny.idle");
  assert.equal(COMPANION_ART.MUTED, "bunny.idle", "muted reuses idle with a badge");
  assert.equal(COMPANION_ART.SPEAKING, "bunny.speaking");
  assert.equal(COMPANION_ART.LISTENING_WHILE_SPEAKING, "bunny.speaking");
  assert.equal(COMPANION_ART.HELD, "bunny.listening");
  assert.equal(COMPANION_ART.TRANSCRIBING, "bunny.processing");
  assert.equal(COMPANION_ART.WAITING_FOR_RESPONSE, "bunny.processing");
  assert.equal(COMPANION_ART.INTERRUPTED, "bunny.interrupted");
  assert.equal(COMPANION_ART.ERROR, "bunny.interrupted");
  assert.equal(COMPANION_ART.DISCONNECTED, "bunny.sleeping");
  assert.equal(COMPANION_ART.HAPPY, "bunny.happy");
  assert.equal(companionArtId("READY", "hero"), BUNNY_IDENTITY_ART);
  assert.equal(companionArtId("SPEAKING", "hero"), "bunny.speaking", "expressive states keep their board tile at hero size");
});

test("C08 motion tokens: base periods are the spec's, WAITING runs slower, Chakra counter-rotates", () => {
  assert.equal(WEAPON_BASE.gada.ms, 4200);
  assert.equal(WEAPON_BASE.spear.ms, 3000);
  assert.equal(WEAPON_BASE.chakra.ms, 12000);
  assert.equal(WEAPON_BASE.chakra.counterMs, 18000);
  assert.equal(WEAPON_BASE.sword.ms, 3600);
  assert.equal(TASK_LOOP_MS, 2400);
  assert.equal(MOTION_TOKENS.oneshot, 900);
  assert.equal(WAITING_SPEED.chakra, 0.3);
  assert.equal(characterMotion("gada", "IDLE", false).base?.ms, 4200);
  assert.equal(characterMotion("gada", "WAITING", false).base?.ms, 7000, "0.6x speed: the period is 1 / 0.6 of the base");
  assert.equal(characterMotion("chakra", "WAITING", false).base?.ms, 40000, "0.3x speed for Chakra");
  assert.equal(characterMotion("chakra", "IDLE", false).base?.counterMs, 18000);
  assert.equal(characterMotion("gada", "IDLE", false).base?.counterMs, null);
});

test("C09 every loop and effect period is a real token value, and no decorative loop runs faster than 3 Hz", () => {
  for (const weapon of WEAPONS) {
    for (const state of PRESENTATION_STATES) {
      const motion = characterMotion(weapon, state, false);
      for (const ms of [motion.base?.ms, motion.effect?.ms, motion.halo?.ms]) {
        if (ms === undefined) continue;
        assert.ok(ms >= 1000, `${weapon} ${state} period ${ms}ms is not above 3 Hz`);
      }
    }
  }
  assert.equal(characterMotion("spear", "TESTING", false).effect?.ms, TASK_LOOP_MS);
});

test("C10 effect layers: task states have an effect per weapon, WAITING has none, ACTIVE breathes the halo except on Chakra", () => {
  for (const weapon of WEAPONS) {
    for (const state of ["PLANNING", "RESEARCHING", "CODING", "TESTING", "FILE_WORK", "VERIFYING"] as const) {
      assert.ok(characterMotion(weapon, state, false).effect, `${weapon} ${state} has an effect layer`);
      assert.ok(characterMotion(weapon, state, false).base, `${weapon} ${state} keeps the base loop under the effect`);
    }
    assert.equal(characterMotion(weapon, "WAITING", false).effect, null, "WAITING draws no effects");
    assert.equal(characterMotion(weapon, "ACTIVE", false).effect, null, "ACTIVE is neutral: no category effect");
  }
  assert.equal(characterMotion("gada", "ACTIVE", false).halo?.ms, MOTION_TOKENS.breathing);
  assert.equal(characterMotion("sword", "ACTIVE", false).halo !== null, true);
  assert.equal(characterMotion("chakra", "ACTIVE", false).halo, null, "Chakra's motion is its rotation");
});

test("C11 waiting, attention, pause, failure and recovery states stop or hold the right loops", () => {
  for (const weapon of WEAPONS) {
    assert.equal(characterMotion(weapon, "WAITING_FOR_USER", false).base, null, "motion stops on the idle pose for a user ask");
    assert.equal(characterMotion(weapon, "WAITING_FOR_USER", false).ringPulse, true, "amber ring pulses");
    assert.equal(characterMotion(weapon, "PAUSED", false).base, null, "paused is static");
    assert.equal(characterMotion(weapon, "FAILED", false).base, null, "failed holds its final frame");
    assert.equal(characterMotion(weapon, "VERIFIED", false).base, null, "verified is static after its acknowledgment");
    assert.equal(characterMotion(weapon, "RECOVERING", false).ringSpin, true, "recovering rotates a dashed ring");
    assert.equal(characterMotion(weapon, "RECOVERING", false).base, null);
    assert.equal(characterMotion(weapon, "UNKNOWN", false).base, null, "unknown never animates a claim");
    assert.equal(characterMotion(weapon, "OFFLINE", false).base, null, "offline holds still");
  }
});

test("C12 reduced motion removes every loop and one-shot for every weapon and state, keeping the pose, ring and badge", () => {
  for (const weapon of WEAPONS) {
    for (const state of PRESENTATION_STATES) {
      const motion = characterMotion(weapon, state, true);
      assert.equal(motion.base, null, `${weapon} ${state}: no base loop`);
      assert.equal(motion.effect, null, `${weapon} ${state}: no effect loop`);
      assert.equal(motion.halo, null, `${weapon} ${state}: no halo loop`);
      assert.equal(motion.ringPulse, false, `${weapon} ${state}: no ring pulse`);
      assert.equal(motion.ringSpin, false, `${weapon} ${state}: no ring spin`);
      assert.equal(motion.oneShots, false, `${weapon} ${state}: no one-shot`);
      // Pose, ring and badge are not motion: they stay.
      assert.ok(weaponArtId(weapon, state, "pose"));
    }
  }
  assert.equal(characterOverlay("WAITING_FOR_USER").ring, "amber", "the static amber ring stays under reduced motion");
  assert.equal(characterOverlay("WAITING_FOR_USER").badge, "attention", "the amber badge stays under reduced motion");
});

test("C13 overlays: verified check, completed check, red and amber marks, pause, stop, unknown and offline badges", () => {
  assert.equal(characterOverlay("VERIFIED").badge, "verified");
  assert.equal(characterOverlay("COMPLETED").badge, "completed");
  assert.equal(characterOverlay("COMPLETED").ring, "none", "completed is settled, not a ring");
  assert.equal(characterOverlay("WAITING_FOR_USER").badge, "attention");
  assert.equal(characterOverlay("FAILED").badge, "failed");
  assert.equal(characterOverlay("FAILED").tone, "muted", "a failed agent is desaturated");
  assert.equal(characterOverlay("PAUSED").badge, "paused");
  assert.equal(characterOverlay("PAUSED").tone, "muted");
  assert.equal(characterOverlay("STOPPED").badge, "stopped");
  assert.equal(characterOverlay("UNKNOWN").badge, "unknown", "unknown stays unknown");
  assert.equal(characterOverlay("OFFLINE").badge, "offline");
  assert.equal(characterOverlay("OFFLINE").tone, "grey");
  assert.equal(characterOverlay("RECOVERING").ring, "dashed");
  assert.equal(characterOverlay("RECOVERING").opacity, 0.6);
  assert.equal(characterOverlay("WAITING").opacity, 0.8);
  assert.equal(characterOverlay("RESEARCHING").badge, null, "an active category never gets a claim badge");
  assert.equal(characterOverlay("VERIFYING").badge, null, "verifying is work, not a verified claim");
});

test("C14 transitionCue: no cue on first observation, none for no change, verified only from the Host VERIFIED state", () => {
  for (const next of PRESENTATION_STATES) {
    assert.equal(transitionCue("COMPLETED", next, true), null, `first observation of ${next} never cues`);
    assert.equal(transitionCue(next, next, false), null, `${next} to itself never cues`);
  }
  assert.equal(transitionCue(null, "VERIFIED", false), null, "no previous state, no cue");
  assert.equal(transitionCue(undefined, "VERIFIED", false), null);
  assert.equal(transitionCue("COMPLETED", "VERIFIED", false), "verified");
  assert.equal(transitionCue("RESEARCHING", "VERIFIED", false), "verified", "the Host state VERIFIED is the only source of the verified cue");
  assert.equal(transitionCue("COMPLETED", "FAILED", false), "failed");
  assert.equal(transitionCue("RESEARCHING", "FAILED", false), "failed");
  assert.equal(transitionCue("ACTIVE", "COMPLETED", false), "completed");
  assert.equal(transitionCue("CODING", "COMPLETED", false), "completed");
  assert.equal(transitionCue("VERIFIED", "COMPLETED", false), null, "a downgrade from verified is not an acknowledgment");
  assert.equal(transitionCue("CODING", "VERIFYING", false), null, "verifying is not a verified claim");
  assert.equal(transitionCue("CODING", "RESEARCHING", false), null);
});

test("C15 transitionCue: exhaustive over every state pair, verified only when the Host state is VERIFIED", () => {
  for (const prev of PRESENTATION_STATES) {
    for (const next of PRESENTATION_STATES) {
      const cue = transitionCue(prev, next, false);
      if (cue === "verified") assert.equal(next, "VERIFIED", `${prev}->${next}`);
      if (next === "VERIFIED" && prev !== next && prev !== "OFFLINE") assert.equal(cue, "verified", `${prev}->VERIFIED`);
      if (prev === "OFFLINE" || prev === next) assert.equal(cue, null, `${prev}->${next} is not an observed transition`);
    }
  }
});

test("C16 a return from OFFLINE is not an observed Host transition: reconnecting into VERIFIED or FAILED cues nothing", () => {
  assert.equal(transitionCue("OFFLINE", "VERIFIED", false), null);
  assert.equal(transitionCue("OFFLINE", "FAILED", false), null);
  assert.equal(transitionCue("OFFLINE", "COMPLETED", false), null);
});

test("C17 hostLive: only live or polling with a fresh snapshot counts; every other connection state is not live", () => {
  const fresh = NOW - 1000;
  assert.equal(hostLive({ state: "live", snapshotAt: fresh }, NOW), true);
  assert.equal(hostLive({ state: "polling", snapshotAt: fresh }, NOW), true);
  assert.equal(hostLive({ state: "live", snapshotAt: NOW - 20_000 }, NOW), true, "exactly the freshness limit is still live");
  assert.equal(hostLive({ state: "live", snapshotAt: NOW - 20_001 }, NOW), false, "a live connection with an aged snapshot is not live");
  assert.equal(hostLive({ state: "polling", snapshotAt: NOW - 60_000 }, NOW), false);
  assert.equal(hostLive({ state: "live", snapshotAt: null }, NOW), false);
  for (const state of ["connecting", "reconnecting", "offline", "pairing", "host-changed"] as const) {
    assert.equal(hostLive({ state, snapshotAt: fresh }, NOW), false, `${state} is never live`);
  }
});

test("C18 displayState shows OFFLINE whenever the Host is not live, and the Host's own state otherwise", () => {
  assert.equal(displayState("RESEARCHING", true), "RESEARCHING");
  assert.equal(displayState("VERIFIED", false), "OFFLINE", "a stale VERIFIED never keeps its celebration or check");
  assert.equal(characterOverlay(displayState("VERIFIED", false)).badge, "offline");
});

test("C19 weaponName: the weapon identifies the slot, a custom name identifies the Agent", () => {
  assert.equal(weaponName("gada", "Research Bot"), "Gada — Research Bot");
  assert.equal(weaponName("gada", "Gada"), "Gada");
  assert.equal(weaponName("gada", ""), "Gada");
  assert.equal(weaponName("gada", null), "Gada");
  assert.equal(weaponName("chakra", "  Reviewer  "), "Vishnu Chakra — Reviewer");
});

test("C20 accessible labels: name, presentation label and the basis text, with the offline note", () => {
  const basis: PresentationBasis = { kind: "provider-event", event: "agent.reading", at: NOW, taskId: "t1" };
  assert.equal(
    characterLabel({ weapon: "gada", displayName: "Research Bot", state: "RESEARCHING", basis }),
    "Gada — Research Bot, Researching (Provider reported: reading)",
  );
  assert.equal(characterLabel({ weapon: "spear", state: "IDLE", basis: { kind: "agent-state", agentState: "CREATED" } }), "Spear, Ready to start (Host state: created)");
  assert.equal(characterLabel({ weapon: "sword", state: "OFFLINE", note: "Host connection not live" }), "Sword, Offline (Host connection not live)");
  assert.equal(characterLabel({ weapon: "gada", state: "UNASSIGNED", basis: { kind: "unassigned" } }), "Gada, Not assigned (No Agent assigned)");
});

test("C21 basisText covers every PresentationBasis kind with its real facts", () => {
  const cases: [PresentationBasis, string][] = [
    [{ kind: "unassigned" }, "No Agent assigned"],
    [{ kind: "agent-missing" }, "Bound Agent not found"],
    [{ kind: "agent-state", agentState: "WAITING_FOR_USER" }, "Host state: waiting for user"],
    [{ kind: "mission-result", verifiedSteps: 3, unverifiedSteps: 1 }, "Mission result: 3 verified, 1 unverified"],
    [{ kind: "capability", action: "filesystem.read", stepId: "s1" }, "Host step: filesystem.read"],
    [{ kind: "command", classified: "agent.testing", stepId: "s2" }, "Host command: testing"],
    [{ kind: "command", classified: "agent.building", stepId: "s2" }, "Host command: building"],
    [{ kind: "team-step", teamKind: "review", role: "reviewer", stepId: "s3" }, "Team step: review"],
    [{ kind: "provider-event", event: "agent.testing", at: NOW, taskId: "t" }, "Provider reported: testing"],
    [{ kind: "step-state", stepState: "verifying", stepId: "s4" }, "Host step: verifying"],
    [{ kind: "no-category", reason: "x" }, "No category reported, shown neutral"],
  ];
  for (const [basis, text] of cases) assert.equal(basisText(basis), text);
});

test("C22 characterLabel never leaks an unknown weapon: the label is built from the four weapon names only", () => {
  for (const weapon of WEAPONS) {
    assert.match(characterLabel({ weapon, state: "IDLE" }), /^(Gada|Spear|Vishnu Chakra|Sword), /);
  }
});
