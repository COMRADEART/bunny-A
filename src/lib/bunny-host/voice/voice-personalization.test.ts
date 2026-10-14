import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostDatabase } from "../persistence.server.ts";
import { startHost } from "../http.server.ts";
import { SPOKEN_CHAT_INSTRUCTION } from "./voice-session.server.ts";
import { FEEDBACK_MAX, VoicePersonalizationStore } from "./voice-personalization.server.ts";
import {
  ADVICE_MIN_SAMPLES, DEFAULT_VOICE_PREFERENCES, notificationAllowed, parseVoicePreferences, personalizedInstruction, speakerFor, validateVoicePreferences, voiceAdvice,
  type FeedbackRow, type RecentAnswer, type SpeakerId,
} from "./voice-personalization.ts";

/**
 * M-A-3 T13.3 Gate G (§21): voice personalization rules, the rating store's privacy, and the real Host command surface.
 * The Host test opens the real voice worker with its output disabled to read the voices installed on this PC; no audio
 * is played or recorded and no model is called.
 */

type Body = Record<string, any>;
const RULES = SPOKEN_CHAT_INSTRUCTION.slice(SPOKEN_CHAT_INSTRUCTION.indexOf("You cannot take any action."));

test("T13.3 G §21 rules: Bunny's default instruction is unchanged; a Personal Agent speaks as itself with every rule kept", () => {
  assert.equal(personalizedInstruction(SPOKEN_CHAT_INSTRUCTION, { kind: "bunny" }, DEFAULT_VOICE_PREFERENCES), SPOKEN_CHAT_INSTRUCTION);
  const sword = { kind: "agent" as const, slot: 4 as const, name: "Sword", personality: "Direct.\nNo small talk.", style: "detailed" as const };
  const spoken = personalizedInstruction(SPOKEN_CHAT_INSTRUCTION, sword, { ...DEFAULT_VOICE_PREFERENCES, replyLanguage: "es", verbosity: "brief" });
  assert.equal(
    spoken,
    `You are Sword, one of the user's Personal Agents, speaking through Bunny. Your owner describes your personality as: Direct. No small talk. Answer in up to six spoken sentences without markdown. Answer in Spanish. ${RULES}`,
    "an Agent answers in its own style; Bunny's own length preference does not apply to it",
  );
  assert.ok(spoken.endsWith(RULES));
  assert.equal(
    personalizedInstruction(SPOKEN_CHAT_INSTRUCTION, { kind: "bunny" }, { ...DEFAULT_VOICE_PREFERENCES, verbosity: "brief" }),
    `You are Bunny, a voice assistant. Answer in one or two short spoken sentences without markdown. ${RULES}`,
  );
  assert.throws(() => personalizedInstruction("Something else entirely.", { kind: "bunny" }, DEFAULT_VOICE_PREFERENCES), /no longer starts/);

  const slots = [{ slot: 1 as const, name: "Gada", style: "concise" as const }];
  assert.deepEqual(speakerFor("bunny", slots, () => "x"), { kind: "bunny" });
  assert.deepEqual(speakerFor(1, slots, () => "Calm."), { kind: "agent", slot: 1, name: "Gada", personality: "Calm.", style: "concise" });
  assert.deepEqual(speakerFor(3, slots, () => "x"), { kind: "bunny" }, "an unconfigured slot never invents a speaker");
});

test("T13.3 G §21 rules: preferences are validated, never coerced", () => {
  const current = DEFAULT_VOICE_PREFERENCES;
  assert.deepEqual(validateVoicePreferences({ verbosity: "detailed", voices: { "2": "Microsoft Zira Desktop", bunny: null } }, current).voices, { "2": "Microsoft Zira Desktop", bunny: null });
  for (const bad of [{ verbosity: "long" }, { replyLanguage: "xx" }, { voices: { "5": "A" } }, { voices: { bunny: "<script>" } }, { rememberFeedback: "yes" }, { notificationFrequency: "hourly" }, { transcripts: true }, []])
    assert.throws(() => validateVoicePreferences(bad, current), JSON.stringify(bad));
  assert.deepEqual(parseVoicePreferences("{not json"), DEFAULT_VOICE_PREFERENCES);
  assert.deepEqual(parseVoicePreferences(JSON.stringify({ verbosity: "nonsense" })), DEFAULT_VOICE_PREFERENCES, "a damaged setting falls back to the defaults");
  assert.equal(notificationAllowed("task.completed", "all"), true);
  assert.equal(notificationAllowed("task.completed", "important"), false);
  assert.equal(notificationAllowed("approval.required", "important"), true);
  assert.equal(notificationAllowed("approval.required", "none"), false);
});

test("T13.3 G §21 rules: advice needs enough explicit ratings or measured interruptions and is only a suggestion", () => {
  const rated = (speaker: SpeakerId, ratings: FeedbackRow["rating"][]) => ratings.map((rating, at) => ({ speaker, rating, at }));
  const answer = (speaker: SpeakerId, interrupted: boolean, n: number): RecentAnswer => ({ turnId: `${speaker}-${n}`, speaker, chars: 200, interrupted, at: n });
  const current = (speaker: SpeakerId) => (speaker === "bunny" ? "normal" : "detailed");
  assert.deepEqual(voiceAdvice(rated("bunny", ["too_long", "too_long", "too_long", "too_long"]), [], current), [], `fewer than ${ADVICE_MIN_SAMPLES} ratings say nothing`);
  assert.deepEqual(voiceAdvice(rated("bunny", ["too_long", "too_long", "too_long", "good", "good"]), [], current), [{ speaker: "bunny", current: "normal", suggested: "brief", reason: "You rated 60% of 5 answers too long." }]);
  assert.deepEqual(voiceAdvice(rated("2", ["too_short", "too_short", "too_short", "too_short", "good"]), [], current), [], "already detailed: nothing longer to suggest");
  assert.deepEqual(voiceAdvice(rated("bunny", ["too_short", "too_long", "good", "too_short", "too_long"]), [], current), [], "mixed ratings suggest nothing");
  const interrupts = [0, 1, 2, 3, 4].map((n) => answer("3", n < 3, n));
  assert.deepEqual(voiceAdvice([], interrupts, current), [{ speaker: "3", current: "detailed", suggested: "normal", reason: "You interrupted 3 of the last 5 answers." }]);
});

test("T13.3 G §21 store: ratings reach disk only while remembered, hold no text, and forget deletes them", () => {
  const db = new HostDatabase(":memory:");
  const store = new VoicePersonalizationStore(db);
  try {
    const columns = (db.db.prepare("PRAGMA table_info(voice_feedback)").all() as { name: string }[]).map((row) => row.name);
    assert.deepEqual(columns, ["id", "at", "speaker", "rating"], "no column can hold a question, an answer or audio");
    store.record("bunny", "too_long", 1);
    assert.equal(store.stored().length, 0, "off by default: nothing is written");
    assert.equal(store.rows().length, 1, "but this Host run still uses it");
    store.setPreferences({ rememberFeedback: true });
    store.record("1", "good", 2);
    assert.deepEqual(store.stored(), [{ speaker: "1", rating: "good", at: 2 }]);
    assert.equal(store.rows().length, 2);
    for (let n = 0; n < FEEDBACK_MAX + 5; n++) store.record("2", "too_short", 10 + n);
    assert.equal(store.stored().length, FEEDBACK_MAX, "bounded");
    store.setPreferences({ rememberFeedback: false });
    assert.equal(store.stored().length, 0, "turning remembering off deletes what was kept");
    store.record("bunny", "good", 3);
    store.forget();
    assert.deepEqual([store.stored().length, store.rows().length], [0, 0]);
    assert.throws(() => store.record("9" as SpeakerId, "good", 4), /Unsupported feedback/);
    assert.equal(new VoicePersonalizationStore(db).preferences().rememberFeedback, false, "preferences persist in Host settings");
  } finally { db.close(); }
});

async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}
async function boot(directory: string) {
  const root = join(directory, "project");
  mkdirSync(root, { recursive: true });
  const host = await startHost({
    dataDirectory: directory, root, port: await freePort(), adapters: [], voice: { workerExtraArgs: ["--input-silence", "--output", "null"] },
    sample: async () => ({ at: Date.now(), cpu: { utilization: null, clockMhz: null, temperatureC: null }, memory: { usedBytes: 0, availableBytes: 1, totalBytes: 1 }, gpus: [], notes: ["gate g disposable telemetry"] }),
  });
  const base = `http://127.0.0.1:${host.port}`;
  const command = async (action: string, data: unknown = {}, token = host.token) => {
    const response = await fetch(`${base}/command`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ action, data }) });
    return { status: response.status, body: (await response.json()) as Body };
  };
  const state = async (token = host.token) => (await (await fetch(`${base}/state`, { headers: { authorization: `Bearer ${token}` } })).json()) as Body;
  const pair = async () => {
    const code = (await command("pairing.create")).body.pairCode;
    return ((await (await fetch(`${base}/pair`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, name: "Phone" }) })).json()) as { token: string }).token;
  };
  return { host, command, state, pair };
}

test("T13.3 G §21 Host: preferences are workstation-only, voices must be installed, ratings need a real answer, and settings persist", { skip: process.platform !== "win32" && "Windows only" }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "bunny-t13-3-voice-pref-"));
  let h = await boot(directory);
  try {
    let view = (await h.state()).voicePersonalization as Body;
    assert.deepEqual(view.preferences, DEFAULT_VOICE_PREFERENCES);
    assert.deepEqual(view.speakers.map((row: Body) => row.id), ["bunny", "1", "2", "3", "4"]);
    assert.deepEqual(view.installedVoices, [], "no voice list until the worker has started");
    assert.equal(view.lastAnswer, null);
    const early = await h.command("personalization.preferences", { preferences: { voices: { "1": "Microsoft Zira Desktop" } } });
    assert.equal(early.status, 400);
    assert.match(String(early.body.error), /Open voice once/);

    const opened = await h.command("voice.session.open", { mode: "push_to_talk" });
    assert.equal(opened.body.data?.open, true, JSON.stringify(opened.body));
    view = (await h.state()).voicePersonalization as Body;
    assert.ok(Array.isArray(view.installedVoices) && view.installedVoices.length > 0, "the real worker reports this PC's installed voices");
    const installed = view.installedVoices[0] as string;
    assert.equal((await h.command("personalization.preferences", { preferences: { voices: { "1": "Not An Installed Voice" } } })).body.error, "That voice is not installed on this PC.");
    assert.equal((await h.command("personalization.preferences", { preferences: { voices: { "1": installed }, verbosity: "brief", replyLanguage: "fr", notificationFrequency: "important" } })).status, 200);
    assert.equal((await h.command("personalization.preferences", { preferences: { verbosity: "endless" } })).status, 400);
    const rating = await h.command("personalization.feedback", { turnId: "t-not-spoken", rating: "too_long" });
    assert.equal(rating.status, 400);
    assert.match(String(rating.body.error), /no longer available to rate/);
    await h.command("voice.session.close");

    const phone = await h.pair();
    assert.equal((await h.state(phone)).voicePersonalization, undefined, "devices never see voice preferences or ratings");
    for (const action of ["personalization.preferences", "personalization.feedback", "personalization.feedback.forget"])
      assert.equal((await h.command(action, { preferences: { verbosity: "normal" }, turnId: "x", rating: "good" }, phone)).body.code, "WORKSTATION_REQUIRED", action);

    await h.host.close();
    h = await boot(directory);
    view = (await h.state()).voicePersonalization as Body;
    assert.deepEqual(
      [view.preferences.verbosity, view.preferences.replyLanguage, view.preferences.notificationFrequency, view.preferences.voices["1"]],
      ["brief", "fr", "important", installed],
      "preferences persist across a Host restart",
    );
    assert.equal(view.speakers[0].verbosity, "brief");
  } finally {
    await h.host.close();
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});
