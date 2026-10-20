import { registerDiagnosticSecret } from "../failure.server.ts";

export class InferenceError extends Error {
  status: number; retryAfterMs: number | null;
  constructor(status: number, retryAfterMs: number | null = null) {
    super(`Inference ${status === 429 ? "rate_limited" : status === 402 ? "quota exhausted" : status === 408 ? "timeout" : "failed"} (HTTP ${status}).`);
    this.status = status; this.retryAfterMs = retryAfterMs;
  }
}
export function retryAfter(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const n = /^\d+(\.\d+)?$/.test(value) ? Number(value) * 1000 : Date.parse(value) - now;
  return Number.isFinite(n) ? Math.max(0, n) : null;
}
/** Bounded exponential backoff with jitter; Retry-After is a floor, never shortened. */
export function retryDelay(attempt: number, serverMs: number | null, random = Math.random): number {
  return Math.max(serverMs ?? 0, Math.min(30_000, 500 * 2 ** Math.min(6, Math.max(0, attempt))) * (0.5 + random() * 0.5));
}
export function redactOutput(text: string, secrets: readonly string[]): string {
  let safe = text;
  for (const secret of secrets) if (secret) safe = safe.split(secret).join("[redacted]");
  return safe.replace(/\bBearer\s+[^\s,;"']+/gi, "Bearer [redacted]")
    .replace(/\b(?:sk-[a-zA-Z0-9_-]{8,}|gsk_[a-zA-Z0-9_-]{8,})\b/g, "[redacted]")
    .replace(/((?:api[_-]?key|password|secret|access_token)\s*[=:]\s*)[^\s,;"'}]+/gi, "$1[redacted]");
}

export async function boundedJson(response: Response, signal: AbortSignal, maxBytes = 4 * 1024 * 1024): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new InferenceError(502);
  let size = 0, text = "";
  const decoder = new TextDecoder();
  const stop = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", stop, { once: true });
  try {
    for (;;) {
      signal.throwIfAborted();
      const part = await reader.read();
      signal.throwIfAborted();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maxBytes) throw new InferenceError(502);
      text += decoder.decode(part.value, { stream: true });
    }
    text += decoder.decode();
    try { return JSON.parse(text); } catch { throw new InferenceError(502); }
  } finally { signal.removeEventListener("abort", stop); await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
export type GenerationRequest = {
  requestId: string; model: string; prompt: string; maxTokens: number; timeoutMs: number; signal?: AbortSignal;
  structured?: boolean; providerOptions?: Record<string, unknown>;
};
export type Generation = { text: string; model: string; inputTokens: number | null; outputTokens: number | null };
export interface ModelProvider {
  listModels(signal?: AbortSignal): Promise<unknown>;
  healthCheck(signal?: AbortSignal): Promise<boolean>;
  generate(request: GenerationRequest): Promise<Generation>;
  stream(request: GenerationRequest): AsyncIterable<string>;
  cancel(requestId: string): void;
}
const record = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const count = (x: unknown) => typeof x === "number" && Number.isSafeInteger(x) && x >= 0 ? x : null;

/** Compatible means wire-format only. Streaming/tool execution are NOT inferred from that label. */
export class CompatibleProvider implements ModelProvider {
  endpoint: string; private key: () => Promise<string | null>; private fetcher: typeof fetch;
  private active = new Map<string, AbortController>();
  constructor(endpoint: string, key: () => Promise<string | null>, fetcher: typeof fetch = fetch) {
    const url = new URL(endpoint);
    if (url.username || url.password || url.search || url.hash || (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)))) throw new Error("Endpoint must use HTTPS or an explicit loopback runtime, without credentials or query parameters.");
    this.endpoint = endpoint.replace(/\/$/, ""); this.key = key; this.fetcher = fetcher;
  }
  async listModels(signal = AbortSignal.timeout(8000)) {
    // Public catalogue: credentials are deliberately not attached.
    const r = await this.fetcher(`${this.endpoint}/models`, { signal, redirect: "error" });
    if (!r.ok) { await r.body?.cancel(); throw new InferenceError(r.status, retryAfter(r.headers.get("retry-after"))); }
    return boundedJson(r, signal);
  }
  async healthCheck(signal?: AbortSignal) { try { await this.listModels(signal); return true; } catch { return false; } }
  async generate(request: GenerationRequest): Promise<Generation> {
    if (this.active.has(request.requestId)) throw new Error("Duplicate active request id.");
    const controller = new AbortController(); this.active.set(request.requestId, controller);
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(Math.min(300000, Math.max(1, request.timeoutMs))), ...(request.signal ? [request.signal] : [])]);
    try {
      signal.throwIfAborted();
      const key = await this.key();
      if (key) registerDiagnosticSecret(key);
      signal.throwIfAborted();
      const response = await this.fetcher(`${this.endpoint}/chat/completions`, {
        method: "POST", signal, redirect: "error", headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
        body: JSON.stringify({ model: request.model, messages: [{ role: "user", content: request.prompt }], max_tokens: request.maxTokens,
          stream: false, ...(request.structured ? { response_format: { type: "json_object" } } : {}), ...(request.providerOptions ? { provider: request.providerOptions } : {}) }),
      });
      if (!response.ok) { await response.body?.cancel(); throw new InferenceError(response.status, retryAfter(response.headers.get("retry-after"))); }
      const raw = await boundedJson(response, signal);
      if (!record(raw) || raw.error || !Array.isArray(raw.choices) || !record(raw.choices[0])) throw new InferenceError(502);
      const choice = raw.choices[0];
      if (!record(choice.message) || typeof choice.message.content !== "string" || !choice.message.content.trim() || !["stop", "eos"].includes(String(choice.finish_reason)) || (typeof raw.model === "string" && raw.model !== request.model)) throw new InferenceError(502);
      const text = redactOutput(choice.message.content, key ? [key] : []);
      if (request.structured) { try { const j: unknown = JSON.parse(text); if (!record(j)) throw new Error(); } catch { throw new InferenceError(422); } }
      return { text, model: request.model, inputTokens: record(raw.usage) ? count(raw.usage.prompt_tokens) : null, outputTokens: record(raw.usage) ? count(raw.usage.completion_tokens) : null };
    } catch (e) {
      if (e instanceof InferenceError) throw e;
      if (signal.aborted) throw new InferenceError(408);
      throw new InferenceError(503);
    } finally { this.active.delete(request.requestId); }
  }
  async *stream(_request: GenerationRequest): AsyncIterable<string> { throw new Error("Streaming unsupported by this adapter contract; use bounded generate."); }
  cancel(requestId: string) { this.active.get(requestId)?.abort(); }
}
