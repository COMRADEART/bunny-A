/**
 * M-A-3 T13.3 Gate G (§21): owner-controlled voice personalization. Pure rules only.
 *
 * Preferences shape what the tool-free spoken-chat model is told (who is speaking, how long to answer, which language)
 * and which installed Windows voice reads it. Explicit feedback ("too long", "too short", "good") and measured
 * interruptions produce advice the owner may apply; nothing is applied automatically. No transcript, answer text or
 * audio is kept here: an answer is remembered only as its turn id, length, speaker and whether it was interrupted.
 */
import type { InteractionStyle, SlotId } from "../personal-agents.ts";

export const VERBOSITY = ["brief", "normal", "detailed"] as const;
export type Verbosity = (typeof VERBOSITY)[number];
export const NOTIFICATION_FREQUENCY = ["all", "important", "none"] as const;
export type NotificationFrequency = (typeof NOTIFICATION_FREQUENCY)[number];
export const REPLY_LANGUAGES = { en: "English", es: "Spanish", fr: "French", de: "German", it: "Italian", pt: "Portuguese", hi: "Hindi", te: "Telugu", ta: "Tamil", ja: "Japanese", zh: "Chinese" } as const;
export type ReplyLanguage = keyof typeof REPLY_LANGUAGES;
export const FEEDBACK_RATINGS = ["too_long", "too_short", "good"] as const;
export type FeedbackRating = (typeof FEEDBACK_RATINGS)[number];
export type SpeakerId = "bunny" | `${SlotId}`;
export const SPEAKER_IDS: readonly SpeakerId[] = ["bunny", "1", "2", "3", "4"];

export type VoicePreferences = {
  /** Bunny's own answer length. A Personal Agent answers in its own interaction style. */
  verbosity: Verbosity;
  /** null: answer in the language the user speaks. */
  replyLanguage: ReplyLanguage | null;
  /** An installed Windows voice per speaker; null uses the worker's default voice. */
  voices: Partial<Record<SpeakerId, string | null>>;
  /** Off by default: feedback then lives only in this Host run's memory. */
  rememberFeedback: boolean;
  notificationFrequency: NotificationFrequency;
};
export const DEFAULT_VOICE_PREFERENCES: VoicePreferences = { verbosity: "normal", replyLanguage: null, voices: {}, rememberFeedback: false, notificationFrequency: "all" };
export const VOICE_PREFERENCES_SETTING = "voice_personalization";
/** Interruptions and feedback need this many answers from one speaker before Bunny suggests anything. */
export const ADVICE_MIN_SAMPLES = 5;
const ADVICE_SHARE = 0.6;
const VOICE_NAME = /^[\p{L}\p{N} ()._-]{1,80}$/u;

const BUNNY_OPENING = "You are Bunny, a voice assistant. Answer in one to three short spoken sentences without markdown.";
const LENGTH: Record<Verbosity, string> = {
  brief: "Answer in one or two short spoken sentences without markdown.",
  normal: "Answer in one to three short spoken sentences without markdown.",
  detailed: "Answer in up to six spoken sentences without markdown.",
};
export const STYLE_VERBOSITY: Record<InteractionStyle, Verbosity> = { concise: "brief", conversational: "normal", detailed: "detailed" };

export function parseVoicePreferences(raw: string | null | undefined): VoicePreferences {
  if (!raw) return { ...DEFAULT_VOICE_PREFERENCES, voices: {} };
  try {
    return validateVoicePreferences(JSON.parse(raw), DEFAULT_VOICE_PREFERENCES);
  } catch {
    return { ...DEFAULT_VOICE_PREFERENCES, voices: {} };
  }
}

/** Merges a partial update onto the current preferences; anything unknown or out of range is refused, never coerced. */
export function validateVoicePreferences(input: unknown, current: VoicePreferences): VoicePreferences {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Voice preferences must be an object.");
  const row = input as Record<string, unknown>;
  for (const key of Object.keys(row))
    if (!["verbosity", "replyLanguage", "voices", "rememberFeedback", "notificationFrequency"].includes(key)) throw new Error(`Unsupported voice preference: ${key.slice(0, 40)}.`);
  const next: VoicePreferences = { ...current, voices: { ...current.voices } };
  if (row.verbosity !== undefined) {
    if (!VERBOSITY.includes(row.verbosity as Verbosity)) throw new Error("Unsupported answer length.");
    next.verbosity = row.verbosity as Verbosity;
  }
  if (row.replyLanguage !== undefined) {
    if (row.replyLanguage !== null && !Object.hasOwn(REPLY_LANGUAGES, row.replyLanguage as string)) throw new Error("Unsupported reply language.");
    next.replyLanguage = row.replyLanguage as ReplyLanguage | null;
  }
  if (row.voices !== undefined) {
    if (!row.voices || typeof row.voices !== "object" || Array.isArray(row.voices)) throw new Error("Voices must be an object.");
    for (const [speaker, name] of Object.entries(row.voices as Record<string, unknown>)) {
      if (!SPEAKER_IDS.includes(speaker as SpeakerId)) throw new Error("Unsupported speaker.");
      if (name !== null && (typeof name !== "string" || !VOICE_NAME.test(name))) throw new Error("Unsupported voice name.");
      next.voices[speaker as SpeakerId] = name as string | null;
    }
  }
  if (row.rememberFeedback !== undefined) {
    if (typeof row.rememberFeedback !== "boolean") throw new Error("Remember feedback must be on or off.");
    next.rememberFeedback = row.rememberFeedback;
  }
  if (row.notificationFrequency !== undefined) {
    if (!NOTIFICATION_FREQUENCY.includes(row.notificationFrequency as NotificationFrequency)) throw new Error("Unsupported notification frequency.");
    next.notificationFrequency = row.notificationFrequency as NotificationFrequency;
  }
  return next;
}

export type Speaker = { kind: "bunny" } | { kind: "agent"; slot: SlotId; name: string; personality: string; style: InteractionStyle };
/** The foreground conversation identity as a speaker; a slot without a configuration falls back to Bunny. */
export function speakerFor(
  foreground: "bunny" | SlotId,
  slots: readonly { slot: SlotId; name: string; style: InteractionStyle }[],
  personality: (slot: SlotId) => string,
): Speaker {
  const config = foreground === "bunny" ? null : slots.find((row) => row.slot === foreground);
  return foreground === "bunny" || !config ? { kind: "bunny" } : { kind: "agent", slot: foreground, name: config.name, personality: personality(foreground), style: config.style };
}
export const speakerId = (speaker: Speaker): SpeakerId => (speaker.kind === "bunny" ? "bunny" : (`${speaker.slot}` as SpeakerId));
export const speakerVerbosity = (speaker: Speaker, preferences: VoicePreferences): Verbosity =>
  speaker.kind === "bunny" ? preferences.verbosity : STYLE_VERBOSITY[speaker.style];

/**
 * The spoken-chat instruction for one turn. Only the opening (who is speaking, how long to answer, which language) is
 * personalized; every rule after it, including that the model cannot act, is kept word for word. With Bunny speaking and
 * default preferences it is exactly `base`.
 */
export function personalizedInstruction(base: string, speaker: Speaker, preferences: VoicePreferences): string {
  if (!base.startsWith(BUNNY_OPENING)) throw new Error("The spoken-chat instruction no longer starts with Bunny's opening.");
  const rules = base.slice(BUNNY_OPENING.length).trim();
  const who =
    speaker.kind === "bunny"
      ? "You are Bunny, a voice assistant."
      : `You are ${speaker.name}, one of the user's Personal Agents, speaking through Bunny.${
          speaker.personality.trim() ? ` Your owner describes your personality as: ${speaker.personality.replace(/\s+/g, " ").trim()}` : ""
        }`;
  const language = preferences.replyLanguage ? ` Answer in ${REPLY_LANGUAGES[preferences.replyLanguage]}.` : "";
  return `${who} ${LENGTH[speakerVerbosity(speaker, preferences)]}${language} ${rules}`;
}

/** One spoken answer as Bunny remembers it for feedback and interruption measurement: never its text. */
export type RecentAnswer = { turnId: string; speaker: SpeakerId; chars: number; interrupted: boolean; at: number };
export const RECENT_ANSWERS_MAX = 20;
export type FeedbackRow = { speaker: SpeakerId; rating: FeedbackRating; at: number };
export type VoiceAdvice = { speaker: SpeakerId; current: Verbosity; suggested: Verbosity; reason: string };

const shorter = (value: Verbosity): Verbosity => (value === "detailed" ? "normal" : "brief");
const longer = (value: Verbosity): Verbosity => (value === "brief" ? "normal" : "detailed");

/** Suggestions from explicit ratings first, then from how often the owner interrupted a speaker's answers. Never applied here. */
export function voiceAdvice(feedback: readonly FeedbackRow[], answers: readonly RecentAnswer[], current: (speaker: SpeakerId) => Verbosity): VoiceAdvice[] {
  const advice: VoiceAdvice[] = [];
  for (const speaker of SPEAKER_IDS) {
    const verbosity = current(speaker);
    const ratings = feedback.filter((row) => row.speaker === speaker);
    const share = (rating: FeedbackRating) => ratings.filter((row) => row.rating === rating).length / ratings.length;
    if (ratings.length >= ADVICE_MIN_SAMPLES) {
      if (share("too_long") >= ADVICE_SHARE && verbosity !== "brief") {
        advice.push({ speaker, current: verbosity, suggested: shorter(verbosity), reason: `You rated ${Math.round(share("too_long") * 100)}% of ${ratings.length} answers too long.` });
        continue;
      }
      if (share("too_short") >= ADVICE_SHARE && verbosity !== "detailed") {
        advice.push({ speaker, current: verbosity, suggested: longer(verbosity), reason: `You rated ${Math.round(share("too_short") * 100)}% of ${ratings.length} answers too short.` });
        continue;
      }
    }
    const spoken = answers.filter((row) => row.speaker === speaker);
    const interrupted = spoken.filter((row) => row.interrupted).length;
    if (spoken.length >= ADVICE_MIN_SAMPLES && interrupted / spoken.length >= ADVICE_SHARE && verbosity !== "brief")
      advice.push({ speaker, current: verbosity, suggested: shorter(verbosity), reason: `You interrupted ${interrupted} of the last ${spoken.length} answers.` });
  }
  return advice;
}

/** Which Host events may raise a browser notification at each frequency. In-app attention is unaffected. */
const IMPORTANT = new Set(["thermal.warning", "approval.required", "agent.waiting_for_input", "agent.waiting_for_approval", "mission.approval_required", "mission.permission_required", "task.failed", "mission.failed"]);
export function notificationAllowed(type: string, frequency: NotificationFrequency): boolean {
  return frequency === "all" ? true : frequency === "important" ? IMPORTANT.has(type) : false;
}

/** The workstation's personalization view (never projected to a paired device). */
export type VoicePersonalizationView = {
  preferences: VoicePreferences;
  speakers: { id: SpeakerId; name: string; verbosity: Verbosity; source: "preference" | "agent style"; voice: string | null }[];
  /** Installed Windows voices reported by the voice worker; empty until voice has been opened once in this Host run. */
  installedVoices: string[];
  /** The newest spoken answer that may be rated. */
  lastAnswer: Omit<RecentAnswer, "at"> | null;
  feedback: { speaker: SpeakerId; tooLong: number; tooShort: number; good: number }[];
  /** Ratings kept on disk; the rest live only in this Host run. */
  storedFeedback: number;
  interruptions: { speaker: SpeakerId; answers: number; interrupted: number }[];
  advice: VoiceAdvice[];
};
