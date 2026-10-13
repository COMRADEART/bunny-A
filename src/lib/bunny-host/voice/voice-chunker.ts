/**
 * M-A-3 T10: turns a stream of model token deltas into ordered, speakable chunks. Pure.
 *
 * Markdown, code fences and URLs are removed (never read aloud). A chunk is cut at a sentence boundary once it has at
 * least MIN_CHUNK chars; text with no boundary is hard-split at a word boundary at MAX_CHUNK. Total spoken chars are
 * capped at VOICE_LIMITS.maxAnswerChars; a cut answer is marked `truncated`.
 */
import { VOICE_LIMITS } from "./voice-protocol.ts";

export const MIN_CHUNK = 40;
export const MAX_CHUNK = VOICE_LIMITS.maxSpokenChunkChars;
/** H1: the first chunk is released early so speech starts while the model is still streaming. */
export const FIRST_MIN_CHUNK = 30;
export const FIRST_WORD_MIN_CHARS = 24;
export const FIRST_WORD_IDLE_MS = 450;

export type SpokenChunk = { seq: number; text: string };

/** Removes markdown syntax, code fences and URLs from a complete piece of text. Result is plain speakable prose. */
export function speakable(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/```[\s\S]*$/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/(^|\s)_([^_\n]+)_(?=\s|$|[.,!?;:])/g, "$1$2")
    .replace(/[|#*_~<>]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasOpenFence(text: string): boolean {
  return ((text.match(/```/g) ?? []).length % 2) === 1;
}

/** Splits text at word boundaries into pieces no longer than MAX_CHUNK. */
export function splitWords(text: string, max = MAX_CHUNK): string[] {
  const out: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    let cut = rest.lastIndexOf(" ", max);
    if (cut <= 0) cut = max;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

export type VoiceChunkerOptions = {
  maxChars?: number;
  /** Optional clock (epoch ms). Only the first chunk's timed word-boundary release reads it; without it that rule is off. */
  now?: () => number;
};

export class VoiceChunker {
  private raw = "";
  private seq = 0;
  private spoken = 0;
  private done = false;
  /** True when the spoken-character cap cut the answer short. */
  truncated = false;
  /** Clock reading when the currently buffered raw text began (null when nothing is buffered). */
  private pendingSince: number | null = null;

  private readonly maxChars: number;
  private readonly now: (() => number) | null;

  constructor(maxChars: number | VoiceChunkerOptions = VOICE_LIMITS.maxAnswerChars) {
    if (typeof maxChars === "number") {
      this.maxChars = maxChars;
      this.now = null;
    } else {
      this.maxChars = maxChars.maxChars ?? VOICE_LIMITS.maxAnswerChars;
      this.now = maxChars.now ?? null;
    }
  }

  /** Feeds one token delta; returns the chunks that became speakable. */
  push(delta: string): SpokenChunk[] {
    if (this.done || !delta) return [];
    if (this.raw === "" && this.now) this.pendingSince = this.now();
    this.raw += delta;
    const out: SpokenChunk[] = [];
    for (;;) {
      const cut = this.findCut(this.raw);
      if (cut < 0) break;
      this.emit(this.raw.slice(0, cut), out);
      this.raw = this.raw.slice(cut);
      this.pendingSince = this.raw && this.now ? this.now() : null;
    }
    // H1: first chunk only, no boundary yet, enough text and idle long enough: release at the last word boundary.
    if (this.seq === 0 && this.now && this.pendingSince !== null && this.raw.length >= FIRST_WORD_MIN_CHARS && !hasOpenFence(this.raw)) {
      if (this.now() - this.pendingSince >= FIRST_WORD_IDLE_MS) {
        const space = this.raw.lastIndexOf(" ");
        if (space >= FIRST_WORD_MIN_CHARS / 2) {
          this.emit(this.raw.slice(0, space), out);
          this.raw = this.raw.slice(space);
          this.pendingSince = this.now();
        }
      }
    }
    // No boundary yet: hard-split once the pending raw text is long, but never inside an open code fence.
    while (this.raw.length > MAX_CHUNK * 2 && !hasOpenFence(this.raw)) {
      let cut = this.raw.lastIndexOf(" ", MAX_CHUNK);
      if (cut <= 0) cut = MAX_CHUNK;
      this.emit(this.raw.slice(0, cut), out);
      this.raw = this.raw.slice(cut);
    }
    return out;
  }

  /** End of answer: flushes whatever remains. Safe to call once; later calls return nothing. */
  end(): SpokenChunk[] {
    if (this.done) return [];
    this.done = true;
    const out: SpokenChunk[] = [];
    const rest = this.raw;
    this.raw = "";
    for (const piece of splitWords(speakable(rest))) this.add(piece, out);
    return out;
  }

  /**
   * Next cut. Later chunks cut at sentence ends (>= MIN_CHUNK speakable chars). The first chunk also cuts at a clause
   * boundary (, : - dash) once >= FIRST_MIN_CHUNK chars are speakable, so speech starts earlier.
   */
  private findCut(raw: string): number {
    const first = this.seq === 0;
    const re = first ? /[.!?;\n,:\-–—](?=\s)/g : /[.!?;\n](?=\s)/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(raw))) {
      const end = match.index + 1;
      const piece = raw.slice(0, end);
      if (hasOpenFence(piece)) continue;
      const min = first ? FIRST_MIN_CHUNK : MIN_CHUNK;
      if (speakable(piece).length >= min) return end;
    }
    return -1;
  }

  private emit(piece: string, out: SpokenChunk[]) {
    for (const part of splitWords(speakable(piece))) this.add(part, out);
  }

  private add(text: string, out: SpokenChunk[]) {
    if (!text) return;
    if (this.spoken >= this.maxChars) {
      this.truncated = true;
      return;
    }
    const room = this.maxChars - this.spoken;
    const clipped = text.length > room ? text.slice(0, room).replace(/\s+\S*$/, "").trim() : text;
    if (text.length > room) this.truncated = true;
    if (!clipped) return;
    this.spoken += clipped.length;
    out.push({ seq: this.seq++, text: clipped });
  }
}

/** Convenience: the full ordered chunk list for a finished answer. */
export function chunkAnswer(text: string, maxChars?: number): { chunks: SpokenChunk[]; truncated: boolean } {
  const chunker = new VoiceChunker(maxChars);
  const chunks = [...chunker.push(text), ...chunker.end()];
  return { chunks, truncated: chunker.truncated };
}
