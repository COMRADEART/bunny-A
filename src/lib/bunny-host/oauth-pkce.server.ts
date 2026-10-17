/**
 * M-A-3 T13.2: Authorization Code + PKCE (S256) to a one-time loopback listener, for providers that document an
 * unregistered-client loopback flow (OpenRouter: https://openrouter.ai/docs/guides/overview/auth/oauth). The
 * provider's own site handles the password, passkey, SSO and MFA; Bunny only receives the authorization code on
 * 127.0.0.1 and exchanges it with the PKCE verifier for a key the user controls on the provider site.
 *
 * Safety rules enforced here:
 *  - verifier 32 random bytes (base64url), challenge = BASE64URL(SHA-256(verifier)), method S256;
 *  - state 32 random bytes, embedded in the exact callback URL and compared in constant time;
 *  - listener bound to 127.0.0.1 on an ephemeral port, one exact path per transaction, GET only, Host header must be
 *    the exact loopback authority (DNS-rebinding guard), Origin/Referer from another site refused;
 *  - single use: a transaction is consumed before the code exchange, so a replayed callback is refused;
 *  - 10-minute expiry; every transaction lives in memory only, so a Host restart invalidates it;
 *  - exchange is an origin-pinned POST with redirects refused, an 8 s timeout and a 64 KiB response cap;
 *  - the verifier, code and issued key never enter logs, events, snapshots or error text.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
import { spawn } from "node:child_process";
import type { SignInState } from "./connections.ts";

export const PKCE_TRANSACTION_MS = 10 * 60_000;
const EXCHANGE_TIMEOUT_MS = 8_000;
const EXCHANGE_MAX_BYTES = 64 * 1024;
const KEY_SHAPE = /^[\x21-\x7e]{8,512}$/;

export type PkceFetch = (url: string, init: { method: "POST"; headers: Record<string, string>; body: string; redirect: "error"; signal: AbortSignal }) => Promise<{ status: number; body: ReadableStream<Uint8Array> | null }>;

export type PkceProvider = {
  /** Exact https origin + path of the provider's authorize page, e.g. https://openrouter.ai/auth */
  authorizeUrl: string;
  /** Exact https URL of the code exchange endpoint. */
  exchangeUrl: string;
};

export type PkceOptions = {
  now?: () => number;
  fetch?: PkceFetch;
  /** Opens the system browser. Default: Windows explorer.exe with the validated https URL (no shell). */
  open?: (url: string) => void;
  /** Receives the issued key exactly once per transaction. Throwing marks the transaction failed. */
  onKey: (connectionId: string, key: string, epoch: number) => Promise<void>;
  /** Progress for the owner's UI and the audit journal. `detail` is secret-free. */
  onState: (connectionId: string, state: SignInState, detail: string) => void;
};

type Transaction = {
  id: string;
  connectionId: string;
  provider: PkceProvider;
  epoch: number;
  state: string;
  verifier: string;
  path: string;
  createdAt: number;
  expiresAt: number;
  used: boolean;
  /** finish() ran: the outcome was reported exactly once. */
  done: boolean;
  server: Server;
  port: number;
  timer: ReturnType<typeof setTimeout>;
};

const base64url = (buffer: Buffer) => buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function pkceChallenge(verifier: string): string {
  return base64url(createHash("sha256").update(verifier, "ascii").digest());
}

function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

function assertHttps(url: string, label: string): URL {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port || parsed.hash) throw new Error(`${label} must be a plain https URL.`);
  return parsed;
}

function defaultOpen(url: string) {
  if (process.platform !== "win32") throw new Error("Browser sign-in opens on the Windows workstation only.");
  const explorer = join(process.env.SystemRoot ?? "C:\\Windows", "explorer.exe");
  const child = spawn(explorer, [url], { detached: true, stdio: "ignore", windowsHide: false, shell: false });
  child.on("error", () => undefined);
  child.unref();
}

const PAGE_DONE = "<!doctype html><meta charset=utf-8><title>Bunny A</title><p>Sign-in finished. You can close this window and return to Bunny A.</p>";
const PAGE_FAILED = "<!doctype html><meta charset=utf-8><title>Bunny A</title><p>Sign-in could not be completed. Return to Bunny A and start again.</p>";

export class LoopbackPkce {
  private readonly transactions = new Map<string, Transaction>();
  private readonly options: PkceOptions;
  private readonly clock: () => number;
  private closed = false;

  constructor(options: PkceOptions) {
    this.options = options;
    this.clock = options.now ?? Date.now;
  }

  /** Active transaction ids per connection (for tests and the UI "Connecting" state). No secrets. */
  pending(): { id: string; connectionId: string; expiresAt: number }[] {
    return [...this.transactions.values()].filter((tx) => !tx.used).map((tx) => ({ id: tx.id, connectionId: tx.connectionId, expiresAt: tx.expiresAt }));
  }

  /**
   * Starts one transaction (cancelling an older one for the same connection), opens the provider's authorize page
   * and returns the exact URL that was opened (for the audit test; it contains the challenge, never the verifier).
   */
  async start(input: { connectionId: string; provider: PkceProvider; epoch: number }): Promise<{ transactionId: string; authorizeUrl: string; redirectUri: string }> {
    if (this.closed) throw new Error("Sign-in is unavailable while the Host is stopping.");
    const authorize = assertHttps(input.provider.authorizeUrl, "Authorize URL");
    assertHttps(input.provider.exchangeUrl, "Exchange URL");
    for (const tx of this.transactions.values()) if (tx.connectionId === input.connectionId) this.finish(tx, "cancelled", "A newer sign-in replaced this one.");
    const id = base64url(randomBytes(12));
    const state = base64url(randomBytes(32));
    const verifier = base64url(randomBytes(32));
    const path = `/bunny/oauth/${id}/callback`;
    const server = createServer((req, res) => void this.handle(id, req, res));
    const port = await new Promise<number>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") reject(new Error("Loopback listener failed."));
        else resolve(address.port);
      });
    });
    const now = this.clock();
    const timer = setTimeout(() => { const tx = this.transactions.get(id); if (tx) this.finish(tx, "expired", "Sign-in expired after 10 minutes."); }, PKCE_TRANSACTION_MS);
    timer.unref();
    const tx: Transaction = { id, connectionId: input.connectionId, provider: input.provider, epoch: input.epoch, state, verifier, path, createdAt: now, expiresAt: now + PKCE_TRANSACTION_MS, used: false, done: false, server, port, timer };
    this.transactions.set(id, tx);
    const redirectUri = `http://127.0.0.1:${port}${path}?state=${state}`;
    authorize.searchParams.set("callback_url", redirectUri);
    authorize.searchParams.set("code_challenge", pkceChallenge(verifier));
    authorize.searchParams.set("code_challenge_method", "S256");
    const url = authorize.toString();
    this.options.onState(input.connectionId, "opened", "Opened the provider's sign-in page in your browser.");
    try { (this.options.open ?? defaultOpen)(url); }
    catch (error) { this.finish(tx, "failed", "The browser could not be opened."); throw error; }
    this.options.onState(input.connectionId, "waiting", "Waiting for you to finish signing in on the provider's site.");
    return { transactionId: id, authorizeUrl: url, redirectUri };
  }

  cancel(transactionId: string) {
    const tx = this.transactions.get(transactionId);
    if (tx) this.finish(tx, "cancelled", "You cancelled sign-in.");
  }

  /** Invalidates every transaction for a connection (Disconnect, Reconnect, epoch change). */
  cancelFor(connectionId: string, reason = "The connection changed; this sign-in can no longer complete.") {
    for (const tx of [...this.transactions.values()]) if (tx.connectionId === connectionId) this.finish(tx, "cancelled", reason);
  }

  close() {
    this.closed = true;
    for (const tx of [...this.transactions.values()]) this.finish(tx, "cancelled", "The Host stopped.");
  }

  private finish(tx: Transaction, state: SignInState, detail: string) {
    if (tx.done) return;
    tx.done = true;
    clearTimeout(tx.timer);
    this.transactions.delete(tx.id);
    tx.used = true;
    tx.server.close();
    tx.server.closeAllConnections?.();
    this.options.onState(tx.connectionId, state, detail);
  }

  private reply(res: ServerResponse, status: number, body: string) {
    res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff", connection: "close" });
    res.end(body);
  }

  /** Answers the browser first, then closes the transaction's listener once the response is flushed. */
  private conclude(tx: Transaction, res: ServerResponse, status: number, body: string, state: SignInState, detail: string) {
    tx.used = true;
    this.transactions.delete(tx.id);
    clearTimeout(tx.timer);
    res.once("finish", () => this.finish(tx, state, detail));
    this.reply(res, status, body);
  }

  private async handle(id: string, req: IncomingMessage, res: ServerResponse) {
    const tx = this.transactions.get(id);
    // Unsolicited, replayed or expired callbacks find no live transaction.
    if (!tx || tx.used) return this.reply(res, 404, PAGE_FAILED);
    let url: URL;
    try { url = new URL(req.url ?? "/", `http://127.0.0.1:${tx.port}`); }
    catch { return this.reply(res, 400, PAGE_FAILED); }
    if (req.method !== "GET" || url.pathname !== tx.path) return this.reply(res, 404, PAGE_FAILED);
    if (req.headers.host !== `127.0.0.1:${tx.port}`) return this.reply(res, 400, PAGE_FAILED);
    const origin = req.headers.origin;
    if (origin && origin !== "null") return this.reply(res, 400, PAGE_FAILED);
    const state = url.searchParams.get("state") ?? "";
    const code = url.searchParams.get("code") ?? "";
    if (this.clock() > tx.expiresAt) return this.conclude(tx, res, 400, PAGE_FAILED, "expired", "Sign-in expired after 10 minutes.");
    if (!sameSecret(state, tx.state)) {
      // CSRF/mismatched state: the transaction is spent so a guessing loop cannot continue.
      return this.conclude(tx, res, 400, PAGE_FAILED, "failed", "The sign-in response did not match the request Bunny started; nothing was saved.");
    }
    if (!/^[A-Za-z0-9._~-]{8,2048}$/.test(code)) return this.conclude(tx, res, 400, PAGE_FAILED, "failed", "The provider returned no usable authorization code.");
    // Consume BEFORE the exchange: a second delivery of the same callback is a replay.
    tx.used = true;
    this.options.onState(tx.connectionId, "verifying", "Exchanging the one-time code with the provider.");
    try {
      const key = await this.exchange(tx, code);
      await this.options.onKey(tx.connectionId, key, tx.epoch);
      return this.conclude(tx, res, 200, PAGE_DONE, "connected", "The provider issued a key; it is stored encrypted on this PC.");
    } catch {
      return this.conclude(tx, res, 400, PAGE_FAILED, "failed", "The provider did not issue a key; nothing was saved.");
    }
  }

  private async exchange(tx: Transaction, code: string): Promise<string> {
    if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") throw new Error("TLS verification is disabled.");
    const fetcher: PkceFetch = this.options.fetch ?? ((url, init) => fetch(url, init) as unknown as ReturnType<PkceFetch>);
    const response = await fetcher(tx.provider.exchangeUrl, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ code, code_verifier: tx.verifier, code_challenge_method: "S256" }),
      redirect: "error",
      signal: AbortSignal.timeout(EXCHANGE_TIMEOUT_MS),
    });
    if (response.status < 200 || response.status >= 300 || !response.body) throw new Error("Exchange refused.");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > EXCHANGE_MAX_BYTES) throw new Error("Exchange response too large.");
        chunks.push(part.value);
      }
    } finally { await reader.cancel().catch(() => undefined); }
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { key?: unknown };
    const key = typeof parsed.key === "string" ? parsed.key.trim() : "";
    if (!KEY_SHAPE.test(key)) throw new Error("Exchange returned no usable key.");
    return key;
  }
}
