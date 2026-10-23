import test from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { LoopbackPkce, PKCE_TRANSACTION_MS, pkceChallenge, type PkceFetch } from "./oauth-pkce.server.ts";

const PROVIDER = { authorizeUrl: "https://openrouter.ai/auth", exchangeUrl: "https://openrouter.ai/api/v1/auth/keys" };
const FIXTURE_KEY = "sk-or-FIXTURE-pkce-issued-key-0001";

function body(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(text)); controller.close(); } });
}

function harness(options: { status?: number; clock?: { now: number } } = {}) {
  const opened: string[] = [];
  const exchanges: { url: string; body: Record<string, string>; redirect: string }[] = [];
  const keys: { id: string; key: string; epoch: number }[] = [];
  const states: { id: string; state: string; detail: string }[] = [];
  const fetch: PkceFetch = async (url, init) => {
    exchanges.push({ url, body: JSON.parse(init.body), redirect: init.redirect });
    return { status: options.status ?? 200, body: body(JSON.stringify({ key: FIXTURE_KEY, user_id: "u" })) };
  };
  const pkce = new LoopbackPkce({
    now: options.clock ? () => options.clock!.now : undefined,
    fetch,
    open: (url) => opened.push(url),
    onKey: async (id, key, epoch) => { keys.push({ id, key, epoch }); },
    onState: (id, state, detail) => states.push({ id, state, detail }),
  });
  return { pkce, opened, exchanges, keys, states };
}

function get(port: number, path: string, headers: Record<string, string> = {}, method = "GET"): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => { res.resume(); res.on("end", () => resolve(res.statusCode ?? 0)); });
    req.on("error", reject);
    req.end();
  });
}

function callback(authorizeUrl: string) {
  const url = new URL(authorizeUrl);
  const redirect = new URL(url.searchParams.get("callback_url")!);
  return { port: Number(redirect.port), path: redirect.pathname, state: redirect.searchParams.get("state")!, challenge: url.searchParams.get("code_challenge")!, method: url.searchParams.get("code_challenge_method"), redirect };
}

test("T13.2 A03 [SIMULATED] PKCE S256: challenge in the authorize URL matches the verifier sent only to the exchange", async () => {
  const h = harness();
  const started = await h.pkce.start({ connectionId: "openrouter:api_key:default", provider: PROVIDER, epoch: 3 });
  const cb = callback(h.opened[0]);
  assert.equal(h.opened[0], started.authorizeUrl);
  assert.ok(started.authorizeUrl.startsWith("https://openrouter.ai/auth?"));
  assert.equal(cb.method, "S256");
  assert.equal(cb.redirect.hostname, "127.0.0.1", "loopback IP literal, never localhost");
  assert.match(cb.path, /^\/bunny\/oauth\/[A-Za-z0-9_-]+\/callback$/);
  assert.ok(cb.state.length >= 43, "32 random bytes of state");
  assert.equal(await get(cb.port, `${cb.path}?state=${cb.state}&code=authcode-FIXTURE-123`), 200);
  assert.equal(h.exchanges.length, 1);
  assert.equal(h.exchanges[0].url, PROVIDER.exchangeUrl);
  assert.equal(h.exchanges[0].redirect, "error");
  assert.equal(h.exchanges[0].body.code_challenge_method, "S256");
  assert.equal(pkceChallenge(h.exchanges[0].body.code_verifier), cb.challenge);
  assert.ok(!started.authorizeUrl.includes(h.exchanges[0].body.code_verifier), "the verifier never appears in the browser URL");
  assert.deepEqual(h.keys, [{ id: "openrouter:api_key:default", key: FIXTURE_KEY, epoch: 3 }]);
  assert.deepEqual(h.states.map((s) => s.state), ["opened", "waiting", "verifying", "connected"]);
  for (const s of h.states) assert.ok(!s.detail.includes(FIXTURE_KEY) && !s.detail.includes(cb.state) && !s.detail.includes(h.exchanges[0].body.code_verifier));
  h.pkce.close();
});

test("T13.2 A03 [SIMULATED] mismatched state (CSRF) is refused, spends the transaction and saves nothing", async () => {
  const h = harness();
  await h.pkce.start({ connectionId: "openrouter:api_key:default", provider: PROVIDER, epoch: 1 });
  const cb = callback(h.opened[0]);
  assert.equal(await get(cb.port, `${cb.path}?state=${"x".repeat(cb.state.length)}&code=authcode-FIXTURE-123`), 400);
  assert.equal(h.exchanges.length, 0);
  assert.equal(h.keys.length, 0);
  assert.equal(h.states.at(-1)?.state, "failed");
  assert.equal(h.pkce.pending().length, 0, "a guessing loop cannot continue against the same transaction");
  h.pkce.close();
});

test("T13.2 A03 [SIMULATED] a replayed callback is refused after one successful exchange", async () => {
  const h = harness();
  await h.pkce.start({ connectionId: "openrouter:api_key:default", provider: PROVIDER, epoch: 1 });
  const cb = callback(h.opened[0]);
  const path = `${cb.path}?state=${cb.state}&code=authcode-FIXTURE-123`;
  assert.equal(await get(cb.port, path), 200);
  const replay = await get(cb.port, path).catch(() => 0);
  assert.ok(replay === 0 || replay === 404, `replay refused (got ${replay})`);
  assert.equal(h.exchanges.length, 1);
  assert.equal(h.keys.length, 1);
  h.pkce.close();
});

test("T13.2 A03 [SIMULATED] wrong method, path, Host header (DNS rebinding) or cross-site Origin never reach the exchange", async () => {
  const h = harness();
  await h.pkce.start({ connectionId: "openrouter:api_key:default", provider: PROVIDER, epoch: 1 });
  const cb = callback(h.opened[0]);
  const good = `${cb.path}?state=${cb.state}&code=authcode-FIXTURE-123`;
  assert.equal(await get(cb.port, good, {}, "POST"), 404);
  assert.equal(await get(cb.port, `/bunny/oauth/other/callback?state=${cb.state}&code=authcode-FIXTURE-123`), 404, "unsolicited path");
  assert.equal(await get(cb.port, good, { host: `evil.example:${cb.port}` }), 400, "rebinding Host");
  assert.equal(await get(cb.port, good, { origin: "https://evil.example" }), 400, "cross-site Origin");
  assert.equal(h.exchanges.length, 0);
  assert.equal(h.keys.length, 0);
  assert.equal(h.pkce.pending().length, 1, "refusals that cannot carry the real state do not burn the owner's transaction");
  h.pkce.close();
});

test("T13.2 A03 [SIMULATED] an expired transaction cannot complete", async () => {
  const clock = { now: 1_000_000 };
  const h = harness({ clock });
  await h.pkce.start({ connectionId: "openrouter:api_key:default", provider: PROVIDER, epoch: 1 });
  const cb = callback(h.opened[0]);
  clock.now += PKCE_TRANSACTION_MS + 1;
  assert.equal(await get(cb.port, `${cb.path}?state=${cb.state}&code=authcode-FIXTURE-123`), 400);
  assert.equal(h.exchanges.length, 0);
  assert.equal(h.states.at(-1)?.state, "expired");
  h.pkce.close();
});

test("T13.2 A03/R08 [SIMULATED] a Disconnect cancels a pending sign-in, and a newer sign-in replaces an older one", async () => {
  const h = harness();
  await h.pkce.start({ connectionId: "openrouter:api_key:default", provider: PROVIDER, epoch: 1 });
  const first = callback(h.opened[0]);
  await h.pkce.start({ connectionId: "openrouter:api_key:default", provider: PROVIDER, epoch: 2 });
  const second = callback(h.opened[1]);
  const late = await get(first.port, `${first.path}?state=${first.state}&code=authcode-FIXTURE-123`).catch(() => 0);
  assert.ok(late === 0 || late === 404, "the replaced transaction is closed");
  h.pkce.cancelFor("openrouter:api_key:default");
  const afterDisconnect = await get(second.port, `${second.path}?state=${second.state}&code=authcode-FIXTURE-123`).catch(() => 0);
  assert.ok(afterDisconnect === 0 || afterDisconnect === 404, "a stale callback cannot reconnect a disconnected account");
  assert.equal(h.exchanges.length, 0);
  assert.equal(h.keys.length, 0);
  h.pkce.close();
});

test("T13.2 A03/A05 [SIMULATED] a refused code exchange stores nothing and reports failure without provider text", async () => {
  const h = harness({ status: 401 });
  await h.pkce.start({ connectionId: "openrouter:api_key:default", provider: PROVIDER, epoch: 1 });
  const cb = callback(h.opened[0]);
  assert.equal(await get(cb.port, `${cb.path}?state=${cb.state}&code=authcode-FIXTURE-123`), 400);
  assert.equal(h.exchanges.length, 1);
  assert.equal(h.keys.length, 0);
  assert.equal(h.states.at(-1)?.state, "failed");
  h.pkce.close();
});

test("T13.2 A03 [STATIC VERIFIED] only plain https provider URLs are accepted", async () => {
  const h = harness();
  await assert.rejects(h.pkce.start({ connectionId: "openrouter:api_key:default", provider: { ...PROVIDER, authorizeUrl: "http://openrouter.ai/auth" }, epoch: 1 }));
  await assert.rejects(h.pkce.start({ connectionId: "openrouter:api_key:default", provider: { ...PROVIDER, exchangeUrl: "https://user:pw@openrouter.ai/api/v1/auth/keys" }, epoch: 1 }));
  assert.equal(h.opened.length, 0);
  h.pkce.close();
});
