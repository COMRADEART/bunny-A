/**
 * M-A-3 T12: the host turn-taking controller. One instance per input turn; a pure state machine with no timers, no clocks
 * and no I/O. The session owns every timer (held-reply resume and max, recognition deadlines) and every output action; this
 * module only says what the evidence means.
 *
 * Authority rules:
 *  - Level and energy evidence never interrupts. Room noise, the user's breath or Bunny's own bleed would otherwise cancel
 *    speech. Level evidence only measures how long the user has been audibly speaking.
 *  - Interruption needs transcript-grade evidence: an explicit interrupt phrase, a sustained non-echo partial, or a
 *    non-echo final that is not purely backchannel or hesitation.
 *  - Echo of Bunny's own recent speech is never user speech; the session computes the echo flag before it gets here.
 */
import { VOICE_LIMITS } from "./voice-protocol.ts";

export type TurnAction = "pause" | "resume" | "interrupt" | "accept" | "drop";
export type TurnDecision = { action: TurnAction; reason: string; speechMs: number };

export type TurnEvidence =
  | { kind: "speech_start"; outputActive: boolean }
  | { kind: "speech_end"; short: boolean; outputActive: boolean }
  | { kind: "level"; speechMs: number }
  | { kind: "partial"; text: string; echo: boolean; outputActive: boolean }
  | { kind: "final"; text: string; confidence: number; echo: boolean; outputActive: boolean }
  | { kind: "none"; outputActive: boolean };

/** Speech shorter than this, even with an interrupt phrase at its start, is a cough or a click, not a barge-in. */
export const INTERRUPT_PHRASE_MIN_MS = 180;
/** A non-echo partial with at least two content words interrupts only after this much speech. */
export const SUSTAINED_PARTIAL_MS = 500;

/** Multi-word lexicon entries, merged into one token before classification ("mm-hmm" -> "mm hmm" -> "mm_hmm"). */
const MERGE: [string, string][] = [["mm", "hmm"], ["mm", "hm"], ["uh", "huh"], ["got", "it"], ["i", "see"]];
const BACKCHANNEL = new Set(["mm_hmm", "mm_hm", "uh_huh", "got_it", "i_see", "mm", "mhm", "mmhmm", "hm", "hmm", "yeah", "yep", "yup", "yes", "ok", "okay", "right", "sure", "alright", "gotcha", "cool"]);
const HESITATION = new Set(["um", "uh", "er", "ah", "oh"]);
/** Wordless acknowledgments. Unlike "yes" or "okay" they can never answer a pending confirmation, so alone they are not a turn. */
const NONVERBAL = new Set(["mm_hmm", "mm_hm", "uh_huh", "mm", "mhm", "mmhmm", "hm", "hmm"]);
/** Start-of-utterance phrases that mean "stop talking, I am taking the turn". Apostrophes are removed, so "that's" is "thats". */
const INTERRUPT_PHRASES: string[][] = [["stop"], ["wait"], ["hold", "on"], ["hang", "on"], ["actually"], ["no"], ["excuse", "me"], ["be", "quiet"], ["quiet"], ["thats", "enough"], ["sorry"]];

export class VoiceTurnTaking {
  private heard = 0;
  private interrupted = false;

  /** True once an interrupt decision has been made for this input turn. */
  get decided(): boolean {
    return this.interrupted;
  }

  /** The longest user speech reported for this input turn, in milliseconds. */
  get speechMs(): number {
    return this.heard;
  }

  decide(evidence: TurnEvidence): TurnDecision | null {
    switch (evidence.kind) {
      case "speech_start":
        return evidence.outputActive ? this.result("pause", "speech_onset_during_output") : this.result("accept", "speech_onset");
      case "speech_end":
        // A burst too short to be speech ends with nothing to decide: the held reply simply goes on.
        return evidence.short && evidence.outputActive && !this.interrupted ? this.result("resume", "short_burst") : null;
      case "level":
        this.heard = Math.max(this.heard, clampMs(evidence.speechMs));
        return null;
      case "partial":
        return this.partial(evidence);
      case "final":
        return this.final(evidence);
      case "none":
        return this.none(evidence.outputActive);
    }
  }

  private partial(evidence: { text: string; echo: boolean; outputActive: boolean }): TurnDecision | null {
    if (evidence.echo || !evidence.outputActive || this.interrupted) return null;
    const tokens = tokenize(evidence.text);
    if (startsWithInterrupt(tokens) && this.heard >= INTERRUPT_PHRASE_MIN_MS) return this.interruptNow("interrupt_phrase");
    if (contentTokens(tokens).length >= 2 && this.heard >= SUSTAINED_PARTIAL_MS) return this.interruptNow("sustained_speech");
    return null;
  }

  private final(evidence: { text: string; confidence: number; echo: boolean; outputActive: boolean }): TurnDecision {
    if (evidence.echo) return this.result("drop", "echo_of_own_speech");
    const tokens = tokenize(evidence.text);
    if (tokens.length === 0) return this.none(evidence.outputActive);
    // T12: with nothing playing, a bare hesitation or wordless "mm-hmm" is not a request; it is never sent to the model.
    if (!evidence.outputActive) return isHesitationOnly(tokens) ? this.result("drop", "hesitation_only") : isNonverbalOnly(tokens) ? this.result("drop", "acknowledgment_only") : this.result("accept", "finalized_user_turn");
    // Output is active: the turn is routed only as an interrupt. Everything else resumes the held reply.
    if (this.interrupted) return this.result("interrupt", "interrupt_already_decided");
    const reliable = evidence.confidence >= VOICE_LIMITS.minFinalConfidence;
    if (reliable && startsWithInterrupt(tokens) && this.heard >= INTERRUPT_PHRASE_MIN_MS) return this.interruptNow("interrupt_phrase_final");
    if (reliable && !isPureBackchannel(tokens)) return this.interruptNow("finalized_new_user_turn");
    return this.result("resume", isPureBackchannel(tokens) ? "backchannel" : "not_heard");
  }

  private none(outputActive: boolean): TurnDecision {
    if (this.interrupted) return this.result("accept", "no_reliable_transcript");
    return this.result(outputActive ? "resume" : "accept", "no_reliable_transcript");
  }

  private interruptNow(reason: string): TurnDecision {
    this.interrupted = true;
    return this.result("interrupt", reason);
  }

  private result(action: TurnAction, reason: string): TurnDecision {
    return { action, reason, speechMs: Math.round(this.heard) };
  }
}

/** Lowercases, drops apostrophes, splits on anything that is not a letter or digit, and merges lexicon phrases. */
export function tokenize(text: string): string[] {
  const words = text.toLowerCase().replace(/['’]/g, "").split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < words.length; i += 1) {
    const pair = MERGE.find(([a, b]) => words[i] === a && words[i + 1] === b);
    if (pair) {
      out.push(`${pair[0]}_${pair[1]}`);
      i += 1;
    } else out.push(words[i]);
  }
  return out;
}

/** Tokens that carry meaning: not backchannel, not hesitation. */
export function contentTokens(tokens: string[]): string[] {
  return tokens.filter((token) => !BACKCHANNEL.has(token) && !HESITATION.has(token));
}

export function isPureBackchannel(tokens: string[]): boolean {
  return tokens.length > 0 && tokens.every((token) => BACKCHANNEL.has(token) || HESITATION.has(token));
}

export function isHesitationOnly(tokens: string[]): boolean {
  return tokens.length > 0 && tokens.every((token) => HESITATION.has(token));
}

export function isNonverbalOnly(tokens: string[]): boolean {
  return tokens.length > 0 && tokens.every((token) => NONVERBAL.has(token) || HESITATION.has(token));
}

function startsWithInterrupt(tokens: string[]): boolean {
  return INTERRUPT_PHRASES.some((phrase) => phrase.every((word, index) => tokens[index] === word));
}

/**
 * Share of a transcript's comparable tokens that occur in Bunny's own recent spoken tokens (0..1). Filler words are dropped
 * on both sides by the caller passing `spoken` built with `echoTokens`. Zero when the transcript has no comparable token.
 */
export function echoOverlap(text: string, spoken: ReadonlySet<string>): number {
  const tokens = echoTokens(text);
  if (tokens.length === 0) return 0;
  const found = tokens.filter((token) => spoken.has(token)).length;
  return found / tokens.length;
}

/** Comparable tokens for echo matching: normalized words with hesitation fillers removed. */
export function echoTokens(text: string): string[] {
  return tokenize(text).filter((token) => !HESITATION.has(token));
}

function clampMs(value: number): number {
  return Number.isFinite(value) ? Math.min(30_000, Math.max(0, value)) : 0;
}
