/** MA4-S1R2 D3: cloud adapters tested OFFLINE only. Every fetch is a local mock; no provider is activated. */
import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { CLOUD_CANDIDATES, openAiChat } from "./ma4/cloud-candidates.ts";
import { CompatibleProvider, InferenceError, retryDelay } from "./ma4/transport.server.ts";
import { modelExclusion } from "./ma4/registry.ts";
import { runToolLoop } from "./ma4/ollama-tools.server.ts";
import { decide } from "../bunny-missions/authorization.server.ts";

const realFetch = globalThis.fetch;
test.before(() => { globalThis.fetch = (() => { throw new Error("Live network is forbidden in cloud adapter tests."); }) as typeof fetch; });
test.after(() => { globalThis.fetch = realFetch; });

const MODEL = "openai/gpt-oss-120b";
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const completion = (content: string, extra: Record<string, unknown> = {}) => json({ model: MODEL, choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 2 }, ...extra });
const provider = (fetcher: typeof fetch) => new CompatibleProvider("https://api.groq.com/openai/v1", async () => "gsk_testkey_123456789", fetcher);
const request = { requestId: "r1", model: MODEL, prompt: "synthetic fixture", maxTokens: 64, timeoutMs: 2000 };

test("candidates are documentation data only: disabled, not routable, sensitive data refused", () => {
  assert.ok(CLOUD_CANDIDATES.length >= 3);
  for (const c of CLOUD_CANDIDATES) {
    assert.equal(c.enabled, false);
    assert.match(modelExclusion(c, { contextTokens: 100, outputTokens: 10, structured: false, tools: false, input: ["text"], language: null, sensitive: false })!, /disabled/);
    assert.ok(c.sources.every(s => s.startsWith("https://")));
  }
  assert.match(modelExclusion({ ...CLOUD_CANDIDATES[0], enabled: true, contextTokens: 131072, maxOutputTokens: 8192 }, { contextTokens: 100, outputTokens: 10, structured: false, tools: false, input: ["text"], language: null, sensitive: true })!, /local inference/);
  assert.throws(() => new CompatibleProvider("http://api.groq.com/openai/v1", async () => null));
  assert.throws(() => openAiChat("http://evil.example/v1", async () => null, realFetch));
});

test("rate limit: 429 with Retry-After surfaces as rate_limited and the backoff never shortens it", async () => {
  const p = provider(async () => json({ error: "rate" }, 429, { "retry-after": "17" }));
  const e = await p.generate(request).catch(x => x) as InferenceError;
  assert.ok(e instanceof InferenceError); assert.equal(e.status, 429); assert.equal(e.retryAfterMs, 17_000);
  assert.ok(retryDelay(0, e.retryAfterMs, () => 0) >= 17_000);
});

test("quota exhaustion (402) and outage (503/network) fail closed without a result", async () => {
  assert.equal((await provider(async () => json({ error: "quota" }, 402)).generate(request).catch(x => x)).status, 402);
  assert.equal((await provider(async () => json({ error: "down" }, 503)).generate(request).catch(x => x)).status, 503);
  assert.equal((await provider(async () => { throw new TypeError("ECONNRESET"); }).generate(request).catch(x => x)).status, 503);
  assert.equal((await provider(async () => completion("hi", { model: "other/model" })).generate(request).catch(x => x)).status, 502, "served-model mismatch");
  const ok = await provider(async () => completion("Bearer gsk_testkey_123456789 leaked")).generate(request);
  assert.doesNotMatch(ok.text, /gsk_testkey/);
});

const sse = (lines: string[]) => new Response(new ReadableStream({ start(c) { for (const l of lines) c.enqueue(new TextEncoder().encode(l)); c.close(); } }), { status: 200 });
const chunk = (content: string, finish: string | null = null) => `data: ${JSON.stringify({ model: MODEL, choices: [{ delta: { content }, finish_reason: finish }] })}\n\n`;
async function collect(it: AsyncIterable<string>) { const out: string[] = []; for await (const x of it) out.push(x); return out; }

test("streaming: complete streams succeed; interrupted, malformed or mismatched streams fail", async () => {
  assert.deepEqual(await collect(provider(async () => sse([chunk("Hel"), chunk("lo", "stop"), "data: [DONE]\n\n"])).stream(request)), ["Hel", "lo"]);
  await assert.rejects(collect(provider(async () => sse([chunk("Hel")])).stream(request)), (e: InferenceError) => e.status === 502, "no finish_reason/[DONE]");
  await assert.rejects(collect(provider(async () => sse([chunk("Hel"), "data: {not json\n\n"])).stream(request)), (e: InferenceError) => e.status === 502);
  await assert.rejects(collect(provider(async () => sse([chunk("x", "length"), "data: [DONE]\n\n"])).stream(request)), (e: InferenceError) => e.status === 502, "truncated output is not success");
  const broken = new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(chunk("a"))); c.error(new Error("socket hang up")); } }));
  await assert.rejects(collect(provider(async () => broken).stream(request)), (e: InferenceError) => e.status === 502);
  await assert.rejects(collect(provider(async () => json({}, 429, { "retry-after": "3" })).stream(request)), (e: InferenceError) => e.status === 429);
});

test("OpenAI-format tool calls: ids map back, malformed arguments and unknown tools never execute", async () => {
  const bodies: { messages: { role: string; tool_call_id?: string }[] }[] = [];
  const replies = [
    { tool_calls: [{ id: "c1", type: "function", function: { name: "math.add", arguments: "{\"a\":2,\"b\":3}" } }, { id: "c2", type: "function", function: { name: "math.add", arguments: "{a:2" } }, { id: "c3", type: "function", function: { name: "shell.exec", arguments: "{}" } }] },
    { content: "5" },
  ];
  const fetcher = (async (_u: string, init: RequestInit) => { bodies.push(JSON.parse(String(init.body))); const m = replies.shift()!; return json({ model: MODEL, choices: [{ message: { content: null, ...m }, finish_reason: "stop" }] }); }) as typeof fetch;
  const add = { manifest: { id: "math.add", description: "add", risk: "READ" as const, inputs: [], outputs: "", evidence: "", timeoutMs: 1000, implemented: true }, schema: z.object({ a: z.number(), b: z.number() }).strict(), run: async ({ a, b }: { a: number; b: number }) => a + b };
  const r = await runToolLoop({ model: MODEL, prompt: "synthetic", tools: [add], chat: openAiChat("https://api.groq.com/openai/v1", async () => "k", fetcher),
    authorize: (m, p) => decide(m, p, { envelope: null, missionId: null, grants: [], direct: { confirmed: false } }) });
  assert.equal(r.ok, true); assert.equal(r.final, "5");
  assert.deepEqual(r.receipts.map(x => x.status), ["executed", "invalid_arguments", "unknown_tool"]);
  assert.deepEqual(bodies[1].messages.filter(m => m.role === "tool").map(m => m.tool_call_id), ["c1", "c2", "c3"]);
  const malformed = await runToolLoop({ model: MODEL, prompt: "x", tools: [add], authorize: () => ({ decision: "allow", reason: "", risk: "READ" }),
    chat: openAiChat("https://api.groq.com/openai/v1", async () => "k", (async () => json({ model: MODEL, choices: [{ message: { content: "", tool_calls: "nope" } }] })) as typeof fetch) });
  assert.equal(malformed.ok, false); assert.match(malformed.error!, /Malformed/);
});
