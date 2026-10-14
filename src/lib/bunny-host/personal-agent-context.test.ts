import test from "node:test";
import assert from "node:assert/strict";
import { HostDatabase } from "./persistence.server.ts";
import { PersonalAgentContextStore } from "./personal-agent-context.server.ts";
import { CONTEXT_LIMITS, answerFromOwnFacts, cleanTurn, emptyProfile, parseIdentity, parseSlot, validateProfile } from "./personal-agent-context.ts";

/** M-A-3 T13.3 Gate B: pure context rules and the additive store, on an in-memory Host database. */

const step = (state: string, verified = false) => ({ state, result: verified ? { verified: true } : null }) as never;
const mission = (id: string, title: string, steps: never[] = [], requests: { resolution: unknown }[] = []) =>
  ({ id, title, objective: title, state: "running", steps, requests }) as never;
const agent = (id: string, state: string, missionId: string | null, updatedAt = 1) => ({ id, state, missionId, updatedAt }) as never;

test("T13.3 B profile accepts only user-authored fields and refuses credentials, extra keys and oversize input", () => {
  const first = validateProfile(1, { personality: "Calm and thorough", goals: ["Ship the website"], preferences: [{ key: "tone", value: "brief" }] }, 10, emptyProfile(1));
  assert.equal(first.revision, 1);
  assert.deepEqual(first.goals, ["Ship the website"]);
  assert.deepEqual(first.preferences, [{ key: "tone", value: "brief", at: 10 }]);
  const kept = validateProfile(1, { preferences: [{ key: "tone", value: "brief" }, { key: "language", value: "English" }] }, 20, first);
  assert.equal(kept.preferences[0].at, 10, "an unchanged preference keeps the time the user stated it");
  assert.equal(kept.personality, "Calm and thorough", "an omitted field is kept");
  assert.throws(() => validateProfile(1, { permissions: "all" }, 0, emptyProfile(1)), /Unsupported Personal Agent profile field: permissions/);
  assert.throws(() => validateProfile(1, { preferences: [{ key: "k", value: "v", verified: true }] }, 0, emptyProfile(1)), /only a key and a value/);
  assert.throws(() => validateProfile(1, { personality: "my api_key: abc123" }, 0, emptyProfile(1)), /credential/);
  assert.throws(() => validateProfile(1, { goals: ["use sk-abcdefghijklmnop"] }, 0, emptyProfile(1)), /credential/);
  assert.throws(() => validateProfile(1, { goals: Array(CONTEXT_LIMITS.goals + 1).fill("x") }, 0, emptyProfile(1)), /At most/);
  assert.throws(() => validateProfile(1, { preferences: [{ key: "a", value: "1" }, { key: "a", value: "2" }] }, 0, emptyProfile(1)), /twice/);
});

test("T13.3 B identities and turns are validated; credential-shaped messages are never stored", () => {
  assert.equal(parseIdentity("bunny"), "bunny");
  assert.equal(parseIdentity(3), 3);
  assert.throws(() => parseIdentity(5), /Bunny or one of the four/);
  assert.throws(() => parseIdentity("gada"), /Bunny or one of the four/);
  assert.throws(() => parseSlot(0), /slot 1 to 4/);
  assert.equal(cleanTurn("  what happened to   the website? "), "what happened to the website?");
  assert.throws(() => cleanTurn("   "), /Say something/);
  assert.throws(() => cleanTurn("token= ghp_abcdefghijklmnopqrstuvwxyz"), /credential/);
});

test("T13.3 B answers come only from the Agent's own facts and narrow to the Mission the question names", () => {
  assert.equal(answerFromOwnFacts({ name: "Gada", question: "status?", owned: [], missions: [] }), "Gada has no Missions yet.");
  const owned = [agent("a1", "RUNNING", "m1", 5), agent("a2", "COMPLETED", "m2", 9)];
  const missions = [
    mission("m1", "Website redesign", [step("completed", true), step("completed"), step("running")], [{ resolution: null }]),
    mission("m2", "Research notes", [step("completed", true)]),
  ];
  const narrowed = answerFromOwnFacts({ name: "Gada", question: "Gada, what happened to the website?", owned, missions });
  assert.equal(narrowed, "Website redesign: working, 2 of 3 steps done, 1 verified by the Host, 1 question needs your answer.");
  const all = answerFromOwnFacts({ name: "Gada", question: "how are you doing", owned, missions });
  assert.match(all, /^Gada owns 2 Missions, 1 unfinished\. Website redesign: working.* Research notes: completed, 1 of 1 steps done, 1 verified/);
  assert.doesNotMatch(all, /%/, "never a percentage");
  const pruned = answerFromOwnFacts({ name: "Spear", question: "status", owned: [agent("a3", "INTERRUPTED", "gone")], missions: [] });
  assert.match(pruned, /no longer retained: recovering after a restart/, "a missing Mission is not invented");
});

test("T13.3 B store: one owner per Agent, explicit transfer, per-slot turns, bounded retention, persisted foreground", () => {
  const db = new HostDatabase(":memory:");
  try {
    const store = new PersonalAgentContextStore(db);
    new PersonalAgentContextStore(db);
    assert.equal(store.assign("agent-1", 1, "workstation", 1), null);
    assert.equal(store.assign("agent-1", 1, "workstation", 2), 1, "re-assigning to the same slot is a no-op");
    assert.equal(store.assign("agent-2", 1, "workstation", 3), null);
    assert.deepEqual(store.owned(1), ["agent-1", "agent-2"]);
    assert.equal(store.assign("agent-1", 2, "workstation", 4), 1, "a transfer reports the previous owner");
    assert.deepEqual(store.owned(1), ["agent-2"]);
    assert.deepEqual(store.owned(2), ["agent-1"]);

    store.appendTurn(1, "user", "Gada private", "user", 1);
    store.appendTurn(2, "user", "Spear private", "user", 1);
    assert.deepEqual(store.turns(1).map((turn) => turn.text), ["Gada private"], "a slot reads only its own turns");
    for (let index = 0; index < CONTEXT_LIMITS.retainedTurns + 5; index++) store.appendTurn(1, "agent", `t${index}`, "host-facts", index);
    const retained = db.db.prepare("SELECT COUNT(*) AS n FROM personal_agent_turns WHERE slot=1").get() as { n: number };
    assert.equal(Number(retained.n), CONTEXT_LIMITS.retainedTurns);
    assert.equal(store.turns(1).length, CONTEXT_LIMITS.projectedTurns);
    assert.equal(store.turns(1).at(-1)!.text, `t${CONTEXT_LIMITS.retainedTurns + 4}`, "newest last");
    assert.deepEqual(store.turns(2).map((turn) => turn.text), ["Spear private"], "trimming one slot never touches another");

    assert.equal(store.foreground(), "bunny");
    store.setForeground(3);
    assert.equal(store.foreground(), 3);
    db.db.prepare("UPDATE settings SET value='\"sword\"' WHERE key='personal_agent_foreground'").run();
    assert.equal(store.foreground(), "bunny", "a corrupt foreground falls back to Bunny, never to another Agent");

    store.saveProfile({ ...emptyProfile(4), revision: 2, personality: "Sharp" });
    assert.equal(store.profile(4).personality, "Sharp");
    db.db.prepare("UPDATE personal_agent_profiles SET record='{' WHERE slot=4").run();
    assert.deepEqual(store.profile(4), emptyProfile(4), "a corrupt profile reads as empty");
  } finally {
    db.close();
  }
});
