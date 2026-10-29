import test from "node:test";
import assert from "node:assert/strict";
import { VoiceChunker, chunkAnswer, speakable, splitWords, MAX_CHUNK } from "./voice-chunker.ts";
import { VOICE_LIMITS } from "./voice-protocol.ts";

function feed(deltas: string[]) {
  const chunker = new VoiceChunker();
  const chunks = [];
  for (const delta of deltas) chunks.push(...chunker.push(delta));
  chunks.push(...chunker.end());
  return { chunks, truncated: chunker.truncated };
}

test("V18 TTS chunks are ordered with strictly increasing seq from 0", () => {
  const text = "The first sentence is long enough to speak. The second one follows right after it. And a third closes the answer.";
  const { chunks } = feed(text.split(" ").map((word) => word + " "));
  assert.deepEqual(chunks.map((chunk) => chunk.seq), chunks.map((_, index) => index));
  assert.equal(chunks.map((chunk) => chunk.text).join(" "), text);
});

test("V18 chunks split at sentence boundaries once at least 40 chars are speakable", () => {
  const { chunks } = chunkAnswer("Short. This sentence is definitely longer than forty characters in total. Tail.");
  assert.equal(chunks[0].text, "Short. This sentence is definitely longer than forty characters in total.");
  assert.equal(chunks.at(-1)!.text, "Tail.");
});

test("V18 a delta stream split inside words yields the same ordered text as the whole answer", () => {
  const text = "Bunny reads answers aloud as they arrive, one short chunk at a time.";
  const whole = chunkAnswer(text).chunks.map((chunk) => chunk.text).join(" ");
  const streamed = feed([...text]).chunks.map((chunk) => chunk.text).join(" ");
  assert.equal(streamed, whole);
});

test("markdown, links and URLs are never spoken as syntax", () => {
  const out = speakable("## Heading\n- **bold** item with `code` and [a link](https://example.com/x) plus https://evil.example/y");
  assert.doesNotMatch(out, /https?:|#|\*|`|\[|\]|\(/);
  assert.match(out, /bold item with code and a link/);
});

test("code fences are removed from the spoken text", () => {
  const spoken = chunkAnswer("Here is the result of the check. ```ts\nconst secret = 1;\n``` Done with it all now.").chunks.map((c) => c.text).join(" ");
  assert.doesNotMatch(spoken, /secret|```/);
  assert.match(spoken, /Done with it all now/);
});

test("V18 an unclosed code fence at the end of the answer is dropped, not read", () => {
  const { chunks } = feed(["The answer follows. ", "```python\nprint('x')", "\nmore code"]);
  const spoken = chunks.map((chunk) => chunk.text).join(" ");
  assert.doesNotMatch(spoken, /print|more code/);
});

test("V06 V18 hard split keeps every chunk at or under the 400 char limit on word boundaries", () => {
  const long = Array.from({ length: 200 }, (_, i) => `word${i}`).join(" ");
  const { chunks } = chunkAnswer(long);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) assert.ok(chunk.text.length <= MAX_CHUNK, `chunk ${chunk.text.length}`);
  assert.equal(chunks.map((chunk) => chunk.text).join(" "), long);
});

test("V06 a single token longer than the limit is hard-cut, never dropped", () => {
  const token = "x".repeat(1000);
  const parts = splitWords(token);
  assert.ok(parts.every((part) => part.length <= MAX_CHUNK));
  assert.equal(parts.join(""), token);
});

test("the spoken character cap truncates and marks the answer", () => {
  const sentence = "This is a sentence of moderate length that will be spoken. ";
  const { chunks, truncated } = chunkAnswer(sentence.repeat(200));
  const total = chunks.reduce((sum, chunk) => sum + chunk.text.length, 0);
  assert.ok(total <= VOICE_LIMITS.maxAnswerChars);
  assert.equal(truncated, true);
});

test("end() is idempotent and push after end is ignored", () => {
  const chunker = new VoiceChunker();
  const streamed = chunker.push("Hello there, this is the complete answer to the question.");
  assert.equal(streamed.length, 0, "a sentence without following whitespace waits for end()");
  assert.ok(chunker.end().length >= 1);
  assert.deepEqual(chunker.end(), []);
  assert.deepEqual(chunker.push("more"), []);
});

// M-A-3 T10 round 2 (H1): the first chunk is released early so speech starts while the model still streams.

test("T10 H1 the first chunk is released at a clause boundary once it has at least 30 speakable chars", () => {
  const chunker = new VoiceChunker();
  const first = chunker.push("The model is streaming a long reply, and the rest of it follows later. ");
  assert.equal(first.length, 1, "released before the sentence ends");
  assert.equal(first[0].seq, 0);
  assert.equal(first[0].text, "The model is streaming a long reply,");
});

test("T10 H1 a short clause before the 30 char minimum is not released as the first chunk", () => {
  const chunker = new VoiceChunker();
  assert.deepEqual(chunker.push("Yes, sure, "), []);
  const out = [...chunker.push("here is the whole answer that continues. "), ...chunker.end()];
  assert.equal(out[0].seq, 0);
  assert.ok(out[0].text.length >= 30, out[0].text);
});

test("T10 H1 later chunks keep the sentence boundary: a comma inside a later sentence is not a cut", () => {
  const { chunks } = chunkAnswer("Alpha beta, gamma delta epsilon zeta. Second part, still the same sentence, and it ends here. Tail.");
  assert.equal(chunks[0].text, "Alpha beta, gamma delta epsilon zeta.");
  assert.equal(chunks[1].text, "Second part, still the same sentence, and it ends here.");
  assert.equal(chunks.map((chunk) => chunk.text).join(" "), "Alpha beta, gamma delta epsilon zeta. Second part, still the same sentence, and it ends here. Tail.");
});

test("T10 H1 with a clock, a first chunk with no boundary is released at a word boundary after 450 ms idle", () => {
  let clock = 1_000;
  const chunker = new VoiceChunker({ now: () => clock });
  assert.deepEqual(chunker.push("Hello there friend and welcome to"), [], "no release before the idle window");
  clock += 500;
  const out = chunker.push(" the show");
  assert.equal(out.length, 1);
  assert.equal(out[0].text, "Hello there friend and welcome to the");
  assert.equal(out[0].seq, 0);
});

test("T10 H1 without a clock the word-boundary release stays off: nothing is cut before a boundary", () => {
  const chunker = new VoiceChunker();
  assert.deepEqual(chunker.push("Hello there friend and welcome to the show"), []);
});

test("T10 H1 the timed release never cuts inside an open code fence", () => {
  let clock = 0;
  const chunker = new VoiceChunker({ now: () => clock });
  chunker.push("Here is the code now: ```ts const value = 1");
  clock += 1_000;
  const out = chunker.push(" + 2 + 3");
  assert.ok(out.every((chunk) => !/const value/.test(chunk.text) || !chunk.text.includes("```")), "no fragment carries a dangling fence");
  assert.equal(out.length, 0, "nothing is released while the fence is open");
});

test("T10 H1 the total spoken cap and ordering still hold with early release", () => {
  const sentence = "A moderately long clause, followed by a second clause that continues the thought. ";
  const { chunks, truncated } = chunkAnswer(sentence.repeat(200));
  assert.equal(truncated, true);
  assert.ok(chunks.reduce((sum, chunk) => sum + chunk.text.length, 0) <= VOICE_LIMITS.maxAnswerChars);
  assert.deepEqual(chunks.map((chunk) => chunk.seq), chunks.map((_, index) => index));
});

test("P4-2 a reserved Host line takes seq 0; the model's first chunk still gets the first-chunk clause cut, on seq 1", () => {
  const chunker = new VoiceChunker();
  assert.equal(chunker.reserve(), 0);
  const chunks = chunker.push("Rabbits mostly eat hay and fresh grass, with some leafy greens ");
  assert.deepEqual(chunks, [{ seq: 1, text: "Rabbits mostly eat hay and fresh grass," }]);
  assert.equal(chunker.reserve(), null, "no Host line once model text was chunked");
  const pending = new VoiceChunker();
  pending.push("Rabbits");
  assert.equal(pending.reserve(), null, "nor while model text is buffered");
});
