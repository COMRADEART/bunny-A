/**
 * M-A-3 T13.1: official TypeSafe Jev adapter (hosted structured decisions).
 *
 * Contract read from https://docs.typesafe.ai/api and /models on 2026-10-12:
 * POST https://api.typesafe.ai/v1/systemone with {state, model, questions}
 * (choice / score / noul) and Bearer auth; answers return under the same ids
 * with provider-reported usage. GET /v1/models lists model cards. Documented
 * errors: 401, 422, 429, 529. This is a small audited HTTP adapter; no SDK.
 * Jev output is advisory only — BunnyRouter validates every recommendation.
 */
import type { HostDatabase } from "./persistence.server.ts";
import {
  TYPESAFE_API_BASE, TYPESAFE_API_HOST, TYPESAFE_MODELS_PATH, TYPESAFE_SYSTEM_ONE_PATH,
  adviceFromAnswers, budgetCheck, parseJevPolicy, parseModelList, requestCostUsd, routingQuestions, validateSystemOneRequest, validateSystemOneResponse,
  type DecisionAdvice, type JevConnectionState, type JevPolicy, type JevUsage, type SystemOneRequest, type SystemOneResponse,
} from "./intelligence.ts";
import type { JevSecretStore } from "./jev-secrets.server.ts";

type BodyReader = { read(): Promise<{ done: boolean; value?: Uint8Array }>; cancel(): Promise<void> };
export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; redirect: "manual"; signal: AbortSignal }) => Promise<{ status: number; headers: { get(name: string): string | null }; text(): Promise<string>; body?: { getReader(): BodyReader } | null }>;
const realFetch: FetchLike = (url, init) => fetch(url, init) as unknown as ReturnType<FetchLike>;
const MAX_BODY = 256 * 1024;
const MAX_RECORDED_CALLS = 200;

export class JevProviderError extends Error {
  state: JevConnectionState;
  status: number | null;
  retryAfterMs: number | null;
  /** False only when nothing left this computer; anything else may have reached (and been billed by) TypeSafe. */
  sent: boolean;
  constructor(state: JevConnectionState, message: string, status: number | null = null, retryAfterMs: number | null = null, sent = true) {
    super(message);
    this.name = "JevProviderError";
    this.state = state;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    this.sent = sent;
  }
}
const notSent = (state: JevConnectionState, message: string) => new JevProviderError(state, message, null, null, false);

/** Reads at most MAX_BODY bytes; a larger or unbounded (chunked) body is cut off instead of buffered. */
async function readCapped(response: Awaited<ReturnType<FetchLike>>): Promise<string | null> {
  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text();
    return Buffer.byteLength(text) > MAX_BODY ? null : text;
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    bytes += value.byteLength;
    if (bytes > MAX_BODY) { await reader.cancel().catch(() => undefined); return null; }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString("utf8");
}

const abortedBy = (signal: AbortSignal) => new Promise<never>((_, reject) => {
  if (signal.aborted) reject(signal.reason);
  else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
});

/** The answer arrived after the policy or credential changed; it is discarded, and is not a provider failure. */
export class StaleDecisionError extends JevProviderError {
  constructor() {
    super("PROVIDER_ERROR", "Hosted decision settings changed while the request was in flight; the answer was discarded.");
    this.name = "StaleDecisionError";
  }
}

/** Only the documented origin, over verified TLS, receives the credential. */
export function assertApprovedEndpoint(baseUrl: string): string {
  const url = new URL(baseUrl);
  if (url.protocol !== "https:" || url.hostname !== TYPESAFE_API_HOST || url.port || url.username || url.password || (url.pathname !== "/" && url.pathname !== "")) throw new Error("The TypeSafe endpoint must be https://api.typesafe.ai.");
  return url.origin;
}

export class TypeSafeJevClient {
  private readonly apiKey: () => Promise<string | null>;
  private readonly fetchFn: FetchLike;
  private readonly baseUrl: string;
  /** Recent outbound attempts that reached the transport, for tests and evidence (no content); bounded. */
  readonly calls: { path: string; at: number }[] = [];
  /** Total outbound attempts since start (the `calls` list keeps only the most recent). */
  sentCount = 0;
  constructor(options: { apiKey: () => Promise<string | null>; fetchFn?: FetchLike; baseUrl?: string }) {
    this.apiKey = options.apiKey;
    this.fetchFn = options.fetchFn ?? realFetch;
    this.baseUrl = assertApprovedEndpoint(options.baseUrl ?? TYPESAFE_API_BASE);
  }

  /** The whole call, including reading the encrypted key, runs inside one `timeoutMs` deadline and the caller's signal. */
  private async request(path: string, method: "GET" | "POST", body: string | undefined, timeoutMs: number, signal?: AbortSignal): Promise<{ status: number; body: string; retryAfterMs: number | null }> {
    if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") throw notSent("PROVIDER_ERROR", "TLS certificate verification is disabled in this process; the credential was not sent.");
    const deadline = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]);
    let key: string | null;
    try {
      key = await Promise.race([this.apiKey(), abortedBy(deadline)]);
    } catch (error) {
      if (deadline.aborted) throw notSent("PROVIDER_ERROR", signal?.aborted ? "The decision request was cancelled before it was sent." : "Reading the saved API key took too long; nothing was sent.");
      throw notSent("NO_CREDENTIAL", error instanceof Error ? error.message : "The saved API key could not be read; replace it.");
    }
    if (!key) throw notSent("NO_CREDENTIAL", "No API key is saved.");
    if (deadline.aborted) throw notSent("PROVIDER_ERROR", "The decision request was cancelled before it was sent.");
    let response: Awaited<ReturnType<FetchLike>>;
    this.calls.push({ path, at: Date.now() });
    if (this.calls.length > MAX_RECORDED_CALLS) this.calls.splice(0, this.calls.length - MAX_RECORDED_CALLS);
    this.sentCount++;
    try {
      response = await this.fetchFn(`${this.baseUrl}${path}`, {
        method,
        redirect: "manual",
        signal: deadline,
        headers: { authorization: `Bearer ${key}`, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
        ...(body ? { body } : {}),
      });
    } catch (error) {
      if (signal?.aborted) throw new JevProviderError("PROVIDER_ERROR", "The decision request was cancelled.");
      const name = error instanceof Error ? error.name : "";
      throw new JevProviderError("NETWORK_UNAVAILABLE", name === "TimeoutError" || name === "AbortError" ? `TypeSafe did not answer within ${Math.round(timeoutMs / 1000)}s.` : "TypeSafe is unreachable from this computer.");
    }
    if (response.status >= 300 && response.status < 400) throw new JevProviderError("PROVIDER_ERROR", "TypeSafe answered with a redirect; redirects are refused and the credential was not forwarded.", response.status);
    const declared = Number(response.headers.get("content-length") ?? "");
    if (Number.isFinite(declared) && declared > MAX_BODY) throw new JevProviderError("PROVIDER_ERROR", "TypeSafe response exceeded the size limit.", response.status);
    let text: string | null;
    try {
      text = await readCapped(response);
    } catch {
      throw new JevProviderError("NETWORK_UNAVAILABLE", deadline.aborted ? `TypeSafe did not finish answering within ${Math.round(timeoutMs / 1000)}s.` : "The TypeSafe response was interrupted.", response.status);
    }
    if (text === null) throw new JevProviderError("PROVIDER_ERROR", "TypeSafe response exceeded the size limit.", response.status);
    const retryAfter = response.headers.get("retry-after");
    const retryAfterMs = retryAfter && /^\d{1,5}$/.test(retryAfter.trim()) ? Math.min(Number(retryAfter) * 1000, 300_000) : null;
    return { status: response.status, body: text, retryAfterMs };
  }

  private fail(status: number, retryAfterMs: number | null): never {
    if (status === 401 || status === 403) throw new JevProviderError("AUTH_FAILED", "TypeSafe refused the saved API key. Replace or remove it.", status);
    if (status === 429) throw new JevProviderError("RATE_LIMITED", `TypeSafe rate limit reached${retryAfterMs ? `; try again after ${Math.ceil(retryAfterMs / 1000)}s` : ""}.`, status, retryAfterMs);
    if (status === 422) throw new JevProviderError("PROVIDER_ERROR", "TypeSafe rejected the request format (HTTP 422).", status);
    if (status === 529) throw new JevProviderError("PROVIDER_ERROR", "TypeSafe is temporarily overloaded (HTTP 529).", status, retryAfterMs);
    if (status >= 500) throw new JevProviderError("PROVIDER_ERROR", `TypeSafe provider error (HTTP ${status}).`, status);
    throw new JevProviderError("PROVIDER_ERROR", `TypeSafe request failed (HTTP ${status}).`, status);
  }

  /** Non-billable discovery. One bounded retry on 429/529/5xx; never more. */
  async listModels(timeoutMs: number): Promise<{ models: string[]; latencyMs: number }> {
    const started = performance.now();
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await this.request(TYPESAFE_MODELS_PATH, "GET", undefined, timeoutMs);
      if (result.status === 200) {
        let parsed: unknown;
        try { parsed = JSON.parse(result.body); } catch { throw new JevProviderError("PROVIDER_ERROR", "TypeSafe model list was not valid JSON."); }
        const models = parseModelList(parsed);
        if (!models) throw new JevProviderError("PROVIDER_ERROR", "TypeSafe model list had an unexpected shape.");
        return { models, latencyMs: Math.round(performance.now() - started) };
      }
      const retryable = result.status === 429 || result.status === 529 || (result.status >= 500 && result.status < 600);
      if (retryable && attempt === 0 && (result.retryAfterMs ?? 0) <= 2_000) { await new Promise((done) => setTimeout(done, Math.max(250, result.retryAfterMs ?? 500))); continue; }
      this.fail(result.status, result.retryAfterMs);
    }
    throw new JevProviderError("PROVIDER_ERROR", "TypeSafe model discovery failed.");
  }

  /** One billable decision call. Never retried: an unknown remote outcome is not a free retry. */
  async systemOne(request: SystemOneRequest, timeoutMs: number, signal?: AbortSignal): Promise<{ response: SystemOneResponse; latencyMs: number }> {
    try {
      validateSystemOneRequest(request);
    } catch (error) {
      throw notSent("PROVIDER_ERROR", error instanceof Error ? error.message : "The decision request was invalid; nothing was sent.");
    }
    const started = performance.now();
    const result = await this.request(TYPESAFE_SYSTEM_ONE_PATH, "POST", JSON.stringify(request), timeoutMs, signal);
    if (result.status !== 200) this.fail(result.status, result.retryAfterMs);
    let parsed: unknown;
    try { parsed = JSON.parse(result.body); } catch { throw new JevProviderError("PROVIDER_ERROR", "TypeSafe decision response was not valid JSON."); }
    try {
      return { response: validateSystemOneResponse(parsed, request.questions), latencyMs: Math.round(performance.now() - started) };
    } catch (error) {
      throw new JevProviderError("PROVIDER_ERROR", error instanceof Error ? error.message : "TypeSafe decision response was invalid.");
    }
  }
}

export type JevPublicState = {
  state: JevConnectionState;
  enabled: boolean;
  hasCredential: boolean;
  credentialUpdatedAt: number | null;
  credentialProtection: "Windows DPAPI (current user)" | "test protector";
  model: string;
  /** Model ids from the last successful discovery, never invented. */
  models: string[];
  lastTest: { at: number; ok: boolean; latencyMs: number | null; inferenceVerified: boolean; answeredBy: string | null; detail: string } | null;
  lastError: string | null;
  privacy: JevPolicy["privacy"];
  limits: JevPolicy["limits"];
  thresholds: JevPolicy["thresholds"];
  usage: JevUsage & { lastRequestAt: number | null; lastLatencyMs: number | null };
  usable: boolean;
  detail: string;
};

const POLICY_KEY = "jev_policy_v1";
const LAST_TEST_KEY = "jev_last_test_v1";
/** Cooldown, refused-key block and breaker count survive a Host restart, so a restart is never a free retry. */
const GUARD_KEY = "jev_guard_v1";
type UsageKind = "decision" | "decision_test" | "discovery";

export class JevService {
  readonly client: TypeSafeJevClient;
  private readonly db: HostDatabase;
  private readonly secrets: JevSecretStore;
  private readonly sessionId: string;
  private readonly now: () => number;
  private state: JevConnectionState;
  private failures = 0;
  private cooldownUntil = 0;
  private authBlocked = false;
  private inFlight = 0;
  private lastError: string | null = null;
  /** Bumped on every policy or credential change; advice from an older generation is discarded. */
  generation = 0;
  policy: JevPolicy;

  constructor(db: HostDatabase, secrets: JevSecretStore, options: { sessionId: string; fetchFn?: FetchLike; now?: () => number }) {
    this.db = db;
    this.secrets = secrets;
    this.sessionId = options.sessionId;
    this.now = options.now ?? Date.now;
    this.db.db.exec("CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL)");
    this.db.db.exec("CREATE TABLE IF NOT EXISTS jev_usage(id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, session_id TEXT NOT NULL, kind TEXT NOT NULL, answered_by TEXT, input_tokens INTEGER, output_tokens INTEGER, latency_ms INTEGER, outcome TEXT NOT NULL)");
    this.db.db.exec("CREATE INDEX IF NOT EXISTS jev_usage_at ON jev_usage(at)");
    // A request still pending when the Host stopped may have been billed: it stays counted, with unknown usage.
    this.db.db.prepare("UPDATE jev_usage SET outcome='unknown_restart' WHERE outcome='pending'").run();
    const saved = this.db.db.prepare("SELECT value FROM settings WHERE key=?").get(POLICY_KEY) as { value: string } | undefined;
    let raw: unknown = null;
    try { raw = JSON.parse(saved?.value ?? "null"); } catch { raw = null; }
    this.policy = parseJevPolicy(raw);
    this.loadGuard();
    this.client = new TypeSafeJevClient({ apiKey: () => this.secrets.retrieve(), fetchFn: options.fetchFn });
    // A restart never resurrects a Connected claim: a saved key is only "saved" until tested again.
    this.state = this.restingState();
  }

  /** The service clock (injectable in tests); advice freshness is judged against it. */
  clock(): number {
    return this.now();
  }

  private loadGuard() {
    const row = this.db.db.prepare("SELECT value FROM settings WHERE key=?").get(GUARD_KEY) as { value: string } | undefined;
    try {
      const guard = JSON.parse(row?.value ?? "null") as { failures?: unknown; cooldownUntil?: unknown; authBlocked?: unknown } | null;
      this.failures = typeof guard?.failures === "number" && Number.isFinite(guard.failures) ? Math.max(0, Math.floor(guard.failures)) : 0;
      this.cooldownUntil = typeof guard?.cooldownUntil === "number" && Number.isFinite(guard.cooldownUntil) ? guard.cooldownUntil : 0;
      this.authBlocked = guard?.authBlocked === true;
    } catch { /* a corrupt guard row reads as no guard */ }
  }
  private saveGuard() {
    this.db.db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .run(GUARD_KEY, JSON.stringify({ failures: this.failures, cooldownUntil: this.cooldownUntil, authBlocked: this.authBlocked }));
  }

  private restingState(): JevConnectionState {
    if (!this.policy.enabled) return "DISABLED";
    if (!this.secrets.hasCredential()) return "NO_CREDENTIAL";
    return this.authBlocked ? "AUTH_FAILED" : "SAVED_NOT_VERIFIED";
  }

  configure(raw: unknown) {
    this.policy = parseJevPolicy(raw);
    this.db.db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(POLICY_KEY, JSON.stringify(this.policy));
    this.generation++;
    if (!this.policy.enabled || !["CONNECTED", "AUTH_FAILED"].includes(this.state)) this.state = this.restingState();
    return this.snapshot();
  }

  async saveKey(apiKey: string) {
    await this.secrets.save(apiKey);
    this.generation++;
    this.authBlocked = false;
    this.failures = 0;
    this.cooldownUntil = 0;
    this.saveGuard();
    this.lastError = null;
    this.clearLastTest();
    this.state = this.restingState();
    return this.snapshot();
  }

  removeKey() {
    this.secrets.remove();
    this.generation++;
    this.authBlocked = false;
    this.saveGuard();
    this.lastError = null;
    this.clearLastTest();
    this.state = this.restingState();
    return this.snapshot();
  }

  private lastTest(): JevPublicState["lastTest"] {
    const row = this.db.db.prepare("SELECT value FROM settings WHERE key=?").get(LAST_TEST_KEY) as { value: string } | undefined;
    try {
      const parsed = JSON.parse(row?.value ?? "null") as (JevPublicState["lastTest"] & { models?: string[] }) | null;
      if (parsed && typeof parsed.at === "number") return { at: parsed.at, ok: parsed.ok === true, latencyMs: parsed.latencyMs ?? null, inferenceVerified: parsed.inferenceVerified === true, answeredBy: parsed.answeredBy ?? null, detail: String(parsed.detail ?? "") };
    } catch { /* corrupt row reads as untested */ }
    return null;
  }
  private lastModels(): string[] {
    const row = this.db.db.prepare("SELECT value FROM settings WHERE key=?").get(LAST_TEST_KEY) as { value: string } | undefined;
    try { return parseModelList((JSON.parse(row?.value ?? "null") as { models?: unknown } | null)?.models ?? []) ?? []; } catch { return []; }
  }
  private saveLastTest(value: NonNullable<JevPublicState["lastTest"]> & { models: string[] }) {
    this.db.db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(LAST_TEST_KEY, JSON.stringify(value));
  }
  private clearLastTest() {
    this.db.db.prepare("DELETE FROM settings WHERE key=?").run(LAST_TEST_KEY);
  }

  usage(): JevUsage & { lastRequestAt: number | null; lastLatencyMs: number | null } {
    const dayStart = new Date(this.now());
    dayStart.setHours(0, 0, 0, 0);
    const billable = "kind IN ('decision','decision_test')";
    const session = this.db.db.prepare(`SELECT COUNT(*) AS n FROM jev_usage WHERE session_id=? AND ${billable}`).get(this.sessionId) as { n: number };
    const rows = this.db.db.prepare(`SELECT answered_by AS answeredBy, input_tokens AS tokens, outcome FROM jev_usage WHERE at>=? AND ${billable}`).all(dayStart.getTime()) as { answeredBy: string | null; tokens: number | null; outcome: string }[];
    const last = this.db.db.prepare(`SELECT at, latency_ms AS latency FROM jev_usage WHERE ${billable} ORDER BY id DESC LIMIT 1`).get() as { at: number; latency: number | null } | undefined;
    // A request whose outcome is unknown (timeout, network loss after sending) may have been billed.
    const unknownUsageRows = rows.filter((row) => row.tokens === null).length;
    const tokens = unknownUsageRows ? null : rows.reduce((sum, row) => sum + Number(row.tokens ?? 0), 0);
    let cost: number | null = 0;
    for (const row of rows) {
      const one = requestCostUsd(row.answeredBy, row.tokens === null ? null : Number(row.tokens));
      if (one === null) { cost = null; break; }
      cost += one;
    }
    return { sessionRequests: Number(session.n), dayRequests: rows.length, dayInputTokens: tokens, dayCostUsd: cost, unknownUsageRows, lastRequestAt: last?.at ?? null, lastLatencyMs: last?.latency ?? null };
  }

  /** True when a hosted decision could be requested right now. Makes no network call. */
  usable(usage = this.usage()): boolean {
    return this.policy.enabled && this.policy.privacy.allowDecisionMetadata && this.secrets.hasCredential() && !this.authBlocked && this.now() >= this.cooldownUntil && budgetCheck(this.policy, usage).ok;
  }

  snapshot(): JevPublicState {
    const usage = this.usage();
    return {
      state: this.state,
      enabled: this.policy.enabled,
      hasCredential: this.secrets.hasCredential(),
      credentialUpdatedAt: this.secrets.updatedAt(),
      credentialProtection: this.secrets.protectorKind === "dpapi" ? "Windows DPAPI (current user)" : "test protector",
      model: this.policy.model,
      models: this.lastModels(),
      lastTest: this.lastTest(),
      lastError: this.lastError,
      privacy: this.policy.privacy,
      limits: this.policy.limits,
      thresholds: this.policy.thresholds,
      usage,
      usable: this.usable(usage),
      detail: stateDetail(this.state),
    };
  }

  /**
   * A billable request is counted BEFORE it is sent (a pending row), synchronously after the budget gate, so
   * concurrent requests cannot overshoot a ceiling and a crash mid-request still leaves it counted (unknown usage).
   */
  private reserve(kind: Exclude<UsageKind, "discovery">): number {
    const result = this.db.db
      .prepare("INSERT INTO jev_usage(at, session_id, kind, answered_by, input_tokens, output_tokens, latency_ms, outcome) VALUES(?,?,?,NULL,NULL,NULL,NULL,'pending')")
      .run(this.now(), this.sessionId, kind);
    return Number(result.lastInsertRowid);
  }
  private settle(id: number, outcome: string, values: { answeredBy?: string | null; inputTokens?: number | null; outputTokens?: number | null; latencyMs?: number | null } = {}) {
    this.db.db
      .prepare("UPDATE jev_usage SET outcome=?, answered_by=?, input_tokens=?, output_tokens=?, latency_ms=? WHERE id=?")
      .run(outcome.slice(0, 40), values.answeredBy ?? null, values.inputTokens ?? null, values.outputTokens ?? null, values.latencyMs ?? null, id);
  }
  /**
   * Nothing left this computer: the reservation is released. A documented HTTP refusal (401/403/422/429) was not
   * processed: zero tokens. Anything else that was sent (timeout, lost connection, 5xx, invalid body) may have been
   * billed: unknown usage, which fails strict ceilings closed.
   */
  private settleFailure(id: number, failure: JevProviderError) {
    if (!failure.sent) {
      this.db.db.prepare("DELETE FROM jev_usage WHERE id=?").run(id);
      return;
    }
    const refused = failure.status !== null && [401, 403, 422, 429].includes(failure.status);
    this.settle(id, refused ? `http_${failure.status}` : "unknown", refused ? { inputTokens: 0, outputTokens: 0 } : {});
  }
  private recordDiscovery(outcome: string, latencyMs: number | null) {
    this.db.db
      .prepare("INSERT INTO jev_usage(at, session_id, kind, answered_by, input_tokens, output_tokens, latency_ms, outcome) VALUES(?,?,'discovery',NULL,NULL,NULL,?,?)")
      .run(this.now(), this.sessionId, latencyMs, outcome.slice(0, 40));
  }

  private failWith(error: unknown): JevProviderError {
    const failure = error instanceof JevProviderError ? error : new JevProviderError("PROVIDER_ERROR", "TypeSafe request failed.");
    this.state = failure.state;
    this.lastError = failure.message;
    if (failure.state === "AUTH_FAILED") this.authBlocked = true;
    if (failure.state === "RATE_LIMITED" || failure.status === 529) this.cooldownUntil = this.now() + (failure.retryAfterMs ?? 30_000);
    this.saveGuard();
    return failure;
  }

  private untilText(): string {
    const seconds = Math.max(1, Math.ceil((this.cooldownUntil - this.now()) / 1000));
    return seconds >= 120 ? `${Math.ceil(seconds / 60)} min` : `${seconds}s`;
  }

  /**
   * User-initiated connection test, only while hosted decisions are on. Discovery proves the key and network work;
   * it does not prove decision inference. The optional decision test is billable, must be explicitly confirmed and
   * obeys every guard a routing decision obeys. Never throws: the outcome is in the returned snapshot.
   */
  async testConnection(options: { decisionTest?: boolean } = {}): Promise<JevPublicState> {
    if (!this.policy.enabled) {
      this.state = this.restingState();
      this.lastError = "Turn on hosted decision assistance before testing; nothing was sent.";
      return this.snapshot();
    }
    if (!this.secrets.hasCredential()) {
      this.state = this.restingState();
      this.lastError = "No API key is saved; nothing was sent.";
      return this.snapshot();
    }
    if (this.now() < this.cooldownUntil) {
      this.state = "RATE_LIMITED";
      this.lastError = `TypeSafe asked Bunny to wait (rate limit or repeated failures); try again in ${this.untilText()}. Nothing was sent.`;
      return this.snapshot();
    }
    const decisionRefusal = (): string | null => {
      const gate = budgetCheck(this.policy, this.usage());
      if (!gate.ok) return gate.reason;
      if (this.authBlocked) return "The saved key was refused; replace it first.";
      if (this.inFlight >= this.policy.limits.maxConcurrent) return "A hosted request is already running; try again shortly.";
      return null;
    };
    if (options.decisionTest) {
      const refusal = decisionRefusal();
      if (refusal) {
        this.lastError = `Decision test not sent: ${refusal}`;
        return this.snapshot();
      }
    }
    const generation = this.generation;
    this.state = "CONNECTING";
    let listed: Awaited<ReturnType<TypeSafeJevClient["listModels"]>>;
    try {
      listed = await this.client.listModels(this.policy.limits.timeoutMs);
      this.recordDiscovery("ok", listed.latencyMs);
    } catch (error) {
      const failure = this.failWith(error);
      if (failure.sent) this.recordDiscovery(failure.status ? `http_${failure.status}` : "failed", null);
      this.saveLastTest({ at: this.now(), ok: false, latencyMs: null, inferenceVerified: false, answeredBy: null, detail: failure.message, models: [] });
      return this.snapshot();
    }
    if (generation !== this.generation) {
      this.state = this.restingState();
      this.lastError = "Settings changed during the test; run it again.";
      return this.snapshot();
    }
    this.failures = 0;
    this.authBlocked = false;
    this.saveGuard();
    let inferenceVerified = false;
    let answeredBy: string | null = null;
    let latencyMs = listed.latencyMs;
    if (options.decisionTest) {
      // Re-checked after discovery: another request may have used the allowance meanwhile.
      const refusal = decisionRefusal();
      if (refusal) {
        this.state = "CONNECTED";
        this.lastError = `Decision test not sent: ${refusal}`;
        this.saveLastTest({ at: this.now(), ok: true, latencyMs, inferenceVerified: false, answeredBy: null, detail: `Model discovery succeeded; the decision test was not sent: ${refusal}`, models: listed.models });
        return this.snapshot();
      }
      const questions = { connectivity: { type: "noul" as const, instructions: "Is the state a connectivity check?", criteria: { true: "It is a connectivity check.", false: "It is not." } } };
      const reservation = this.reserve("decision_test");
      this.inFlight++;
      try {
        const result = await this.client.systemOne({ state: { purpose: "Bunny A connection test", connectivity_check: true }, model: this.policy.model, questions }, this.policy.limits.timeoutMs);
        this.settle(reservation, "ok", { answeredBy: result.response.model, inputTokens: result.response.usage.inputTokens, outputTokens: result.response.usage.outputTokens, latencyMs: result.latencyMs });
        inferenceVerified = true;
        answeredBy = result.response.model;
        latencyMs = result.latencyMs;
      } catch (error) {
        const failure = error instanceof JevProviderError ? error : new JevProviderError("PROVIDER_ERROR", "TypeSafe request failed.");
        this.settleFailure(reservation, failure);
        this.failWith(failure);
        this.saveLastTest({ at: this.now(), ok: false, latencyMs: listed.latencyMs, inferenceVerified: false, answeredBy: null, detail: `Model discovery succeeded; the decision test failed: ${failure.message}`, models: listed.models });
        return this.snapshot();
      } finally {
        this.inFlight--;
      }
    }
    this.lastError = null;
    this.state = this.policy.enabled ? "CONNECTED" : "DISABLED";
    this.saveLastTest({
      at: this.now(), ok: true, latencyMs, inferenceVerified, answeredBy,
      detail: inferenceVerified ? "Model discovery and one decision request succeeded." : "Model discovery succeeded. Decision inference has not been tested.",
      models: listed.models,
    });
    return this.snapshot();
  }

  /** Advisory decision for BunnyRouter. Throws JevProviderError; callers fall back to local routing. */
  async advise(input: { state: Record<string, unknown>; eligibleKeys: readonly string[]; signal?: AbortSignal }): Promise<{ advice: DecisionAdvice; latencyMs: number; usage: SystemOneResponse["usage"] }> {
    // Everything from the gate to the reservation is synchronous: no other request can pass the same gate in between.
    const gate = budgetCheck(this.policy, this.usage());
    if (!gate.ok) { this.state = gate.state; throw notSent(gate.state, gate.reason); }
    if (!this.policy.privacy.allowDecisionMetadata) throw notSent("DISABLED", "Cloud decision sharing is not enabled.");
    if (!this.secrets.hasCredential()) { this.state = "NO_CREDENTIAL"; throw notSent("NO_CREDENTIAL", "No API key is saved."); }
    if (this.authBlocked) throw notSent("AUTH_FAILED", "The saved API key was refused; replace it before hosted decisions resume.");
    if (this.now() < this.cooldownUntil) throw notSent("RATE_LIMITED", "TypeSafe is cooling down after a rate limit or repeated failures; local routing continues.");
    if (this.inFlight >= this.policy.limits.maxConcurrent) throw notSent("RATE_LIMITED", "The hosted decision concurrency limit is reached; local routing continues.");
    if (input.eligibleKeys.length < 2) throw notSent("PROVIDER_ERROR", "Fewer than two eligible candidates; nothing to decide.");
    const generation = this.generation;
    const issuedAt = this.now();
    const reservation = this.reserve("decision");
    this.inFlight++;
    try {
      const questions = routingQuestions(input.eligibleKeys);
      let result: Awaited<ReturnType<TypeSafeJevClient["systemOne"]>>;
      try {
        result = await this.client.systemOne({ state: input.state, model: this.policy.model, questions }, this.policy.limits.timeoutMs, input.signal);
      } catch (error) {
        const failure = error instanceof JevProviderError ? error : new JevProviderError("PROVIDER_ERROR", "TypeSafe request failed.");
        this.settleFailure(reservation, failure);
        throw failure;
      }
      this.settle(reservation, "ok", { answeredBy: result.response.model, inputTokens: result.response.usage.inputTokens, outputTokens: result.response.usage.outputTokens, latencyMs: result.latencyMs });
      if (this.failures) { this.failures = 0; this.saveGuard(); }
      if (generation !== this.generation) throw new StaleDecisionError();
      this.state = "CONNECTED";
      this.lastError = null;
      return { advice: adviceFromAnswers(result.response.answers, this.policy.thresholds, { generation, issuedAt, answeredBy: result.response.model }), latencyMs: result.latencyMs, usage: result.response.usage };
    } catch (error) {
      if (error instanceof StaleDecisionError) throw error;
      const failure = error instanceof JevProviderError ? error : new JevProviderError("PROVIDER_ERROR", "TypeSafe request failed.");
      // A request cancelled before sending says nothing about TypeSafe; it neither changes the state nor trips the breaker.
      if (!failure.sent && failure.state === "PROVIDER_ERROR") throw failure;
      // Cancelled by the caller after sending: usage stays unknown (settled above), but TypeSafe did nothing wrong.
      if (input.signal?.aborted) throw failure;
      this.failWith(failure);
      if (failure.sent && failure.state !== "AUTH_FAILED" && failure.state !== "RATE_LIMITED") {
        this.failures++;
        if (this.failures >= 3) this.cooldownUntil = this.now() + 5 * 60_000;
        this.saveGuard();
      }
      throw failure;
    } finally {
      this.inFlight--;
    }
  }
}

function stateDetail(state: JevConnectionState): string {
  switch (state) {
    case "DISABLED": return "Hosted decisions are off. Bunny routes locally.";
    case "NO_CREDENTIAL": return "Hosted decisions are on, but no API key is saved.";
    case "SAVED_NOT_VERIFIED": return "An API key is saved and encrypted on this PC. TypeSafe has not confirmed it since it was saved or since the Host started.";
    case "CONNECTING": return "Contacting TypeSafe…";
    case "CONNECTED": return "TypeSafe answered with the saved key.";
    case "AUTH_FAILED": return "TypeSafe refused the saved key. Hosted decisions are paused until you replace it.";
    case "RATE_LIMITED": return "TypeSafe rate limit or cooldown. Local routing continues.";
    case "BUDGET_EXHAUSTED": return "The hosted request allowance is used up or not set. Local routing continues.";
    case "NETWORK_UNAVAILABLE": return "TypeSafe could not be reached. Local routing continues.";
    case "PROVIDER_ERROR": return "TypeSafe returned an error. Local routing continues.";
  }
}
