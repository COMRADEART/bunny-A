import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { startHost } from "../bunny-host/http.server.ts";
import { providerBase } from "../bunny-host/adapters.server.ts";
import type { AdapterResult, ProviderAdapter } from "../bunny-host/contracts.ts";
import type { ProviderId, ProviderLive } from "../orch/types.ts";
import { authorizeBridge } from "../orch/host-bridge.server.ts";
import { FilesystemCapability, TerminalCapability } from "./capabilities/local.server.ts";

/**
 * M-A-3 T9R-F02: identity and sign-out boundaries at the real Host HTTP surface. Paired devices hold real device
 * credentials on disposable state; the workstation holds the real Host token. Staging and promotion are driven
 * through the same /command boundary the gateway uses. Only the SQLite / event-log reads below use Host internals,
 * and they read what the Host persisted.
 */

const FORGED_IDENTITY = { actor: "workstation", by: "workstation", grantedBy: "workstation", resolvedBy: "workstation", principal: "workstation" };
const TERMINAL_STATES = ["completed", "failed", "stopped"];
const AUTHORITY_KEYS = new Set(["grantedBy", "resolvedBy", "approvedBy", "principal"]);

type Json = Record<string, any>;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor<T>(check: () => T | Promise<T>, label: string, ms = 15_000): Promise<NonNullable<T>> {
  const started = Date.now();
  for (;;) {
    const value = await check();
    if (value) return value as NonNullable<T>;
    if (Date.now() - started > ms) throw new Error(`Timed out waiting for ${label}`);
    await sleep(25);
  }
}

/** Every string under an AUTHORITY key that names the workstation, anywhere in a persisted record. */
function workstationAuthority(value: unknown, path = "$", out: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((item, index) => workstationAuthority(item, `${path}[${index}]`, out));
  else if (value && typeof value === "object")
    for (const [key, item] of Object.entries(value as Json)) {
      if (AUTHORITY_KEYS.has(key) && item === "workstation") out.push(`${path}.${key}`);
      workstationAuthority(item, `${path}.${key}`, out);
    }
  return out;
}

async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

function ready(id: ProviderId): ProviderLive {
  return { ...providerBase(id), installed: true, authenticated: true, availability: "ready", capabilities: ["filesystem", "terminal", "text"], current_model: "claude-test" } as ProviderLive;
}

const claude: ProviderAdapter = {
  id: "claude",
  detect: async () => ready("claude"),
  launch: () => {
    let finish!: (result: AdapterResult) => void;
    const done = new Promise<AdapterResult>((resolve) => (finish = resolve));
    setTimeout(() => finish({ ok: true, output: "done", exitCode: 0 }), 5);
    return { done, stop: async () => finish({ ok: false, output: "", stopped: true }) };
  },
};

async function openHost(directory: string, root: string) {
  const port = await freePort();
  const host = await startHost({
    dataDirectory: directory,
    root,
    port,
    adapters: [claude],
    missions: { adapters: [new FilesystemCapability(), new TerminalCapability()] },
    sample: async () => ({ at: Date.now(), cpu: { utilization: null, clockMhz: null, temperatureC: null }, memory: { usedBytes: 0, availableBytes: 1, totalBytes: 1 }, gpus: [], notes: ["F02 disposable telemetry"] }),
  });
  const base = `http://127.0.0.1:${port}`;
  const configured = await fetch(`${base}/command`, { method: "POST", headers: { authorization: `Bearer ${host.token}`, "content-type": "application/json" }, body: JSON.stringify({ action: "mission.configure", data: { enabled: true } }) });
  assert.equal(configured.status, 200);
  return { host, base };
}

async function f02Host() {
  const directory = mkdtempSync(join(tmpdir(), "bunny-t9r-f02-"));
  const root = join(directory, "project");
  mkdirSync(root);
  writeFileSync(join(root, "seed.txt"), "seed");
  let current = await openHost(directory, root);
  const streams: AbortController[] = [];

  const raw = (action: string, data: unknown = {}, token: string | null = current.host.token, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
    fetch(`${current.base}/command`, {
      method: "POST",
      headers: { ...(token === null ? {} : { authorization: `Bearer ${token}` }), "content-type": "application/json", ...headers },
      body: JSON.stringify({ action, data, ...extra }),
    });
  const api = async (action: string, data: unknown = {}, token: string | null = current.host.token, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) => {
    const response = await raw(action, data, token, extra, headers);
    const body = (await response.json().catch(() => ({}))) as Json;
    return { status: response.status, body, headers: response.headers };
  };
  const state = async (token: string | null = current.host.token, headers: Record<string, string> = {}) => {
    const response = await fetch(`${current.base}/state`, { headers: { ...(token === null ? {} : { authorization: `Bearer ${token}` }), ...headers } });
    return { status: response.status, text: await response.text() };
  };
  const pair = async (name = "F02 phone") => {
    const code = (await api("pairing.create")).body.pairCode;
    const response = await fetch(`${current.base}/pair`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, name }) });
    assert.equal(response.status, 200);
    return (await response.json()) as { token: string; deviceId: string; hostId: string };
  };
  const stream = async (token: string) => {
    const abort = new AbortController();
    streams.push(abort);
    return fetch(`${current.base}/events`, { headers: { authorization: `Bearer ${token}` }, signal: abort.signal });
  };
  const sql = <T = Json>(query: string, ...params: (string | number)[]): T[] => {
    const db = new DatabaseSync(join(directory, "host.sqlite"), { readOnly: true });
    try {
      return db.prepare(query).all(...params) as T[];
    } finally {
      db.close();
    }
  };
  const restart = async () => {
    for (const abort of streams.splice(0)) abort.abort();
    await current.host.close();
    current = await openHost(directory, root);
  };
  const close = async () => {
    for (const abort of streams) abort.abort();
    await current.host.close();
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  };
  const store = () => current.host.missions.store;
  return {
    directory, root, get host() { return current.host; }, get base() { return current.base; },
    api, raw, state, pair, stream, sql, restart, close, store,
    requests: (missionId: string): Json[] => store().requests(missionId) as Json[],
    promotionAsk: (missionId: string): Json | undefined => (store().requests(missionId) as Json[]).find((r) => r.promotion && !r.resolvedAt),
    staged: (missionId: string): Json[] => current.host.missions.staging.forMission(missionId) as Json[],
    stagedState: (missionId: string): string | undefined => (current.host.missions.staging.forMission(missionId) as Json[])[0]?.promotionState,
    missionState: (missionId: string): string => store().mission(missionId).state,
    envelope: (missionId: string): Json => store().authorization(store().mission(missionId).authorizationId ?? "") as Json,
    file: (name: string) => join(root, name),
  };
}
type F02 = Awaited<ReturnType<typeof f02Host>>;

/** Workstation creates a single-step filesystem.write Mission; the write is staged when a paired device runs it. */
async function writeMission(f: F02, path: string, content: string) {
  const created = await f.api("mission.create", {
    objective: `F02 write ${path}`,
    mode: "fast",
    steps: [{ role: "Write", objective: "w", dependsOn: [], executor: { kind: "capability", action: "filesystem.write", params: { path, content, overwrite: true } }, verification: [{ kind: "file_exists", path, contains: content }] }],
  });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  return created.body.mission.id as string;
}

async function phoneApprovedPromotion(f: F02, phone: { token: string }, path: string, content: string) {
  const id = await writeMission(f, path, content);
  const approved = await f.api("mission.approve", { id }, phone.token);
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  const ask = await waitFor(() => f.promotionAsk(id), "promotion ask");
  return { id, ask };
}

/** Workstation answers every ordinary (non-promotion) ask until the Mission reaches a terminal state. */
async function settleOnWorkstation(f: F02, id: string) {
  await waitFor(async () => {
    if (TERMINAL_STATES.includes(f.missionState(id))) return true;
    const pending = f.requests(id).find((r) => !r.resolvedAt && !r.promotion);
    if (pending) await f.api("mission.respond", { requestId: pending.id, decision: "allow_once" });
    return false;
  }, `settle ${id}`);
}

/** Reads a streamed body until it closes or the window elapses; reports whether the stream ended itself. */
async function drain(response: Response, windowMs = 3000) {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let ended = false;
  const deadline = Date.now() + windowMs;
  while (Date.now() < deadline) {
    const next = await Promise.race([reader.read().catch(() => ({ done: true, value: undefined })), sleep(Math.max(1, deadline - Date.now())).then(() => null)]);
    if (next === null) break;
    if (next.done) {
      ended = true;
      break;
    }
    text += decoder.decode(next.value, { stream: true });
  }
  if (!ended) await reader.cancel().catch(() => {});
  return { ended, text };
}

// ── E26: phone-supplied identity fields never become workstation authority ─────────────────────────────────────────
test("F02-E26: phone body identity fields never become workstation authority in SQLite", { timeout: 120_000 }, async () => {
  const f = await f02Host();
  try {
    const phone = await f.pair();
    const { id, ask } = await phoneApprovedPromotion(f, phone, "e26.md", "phone body");
    // Every device-allowed action, carrying forged identity fields, is either accepted as the device or refused.
    const approveForged = await f.api("mission.approve", { id: await writeMission(f, "e26-second.md", "second"), ...FORGED_IDENTITY }, phone.token);
    assert.equal(approveForged.status, 200, JSON.stringify(approveForged.body));
    const respondForged = await f.api("mission.respond", { requestId: ask.id, decision: "allow_once", ...FORGED_IDENTITY }, phone.token);
    assert.notEqual(respondForged.status, 200, "a respond with extra identity fields is refused");
    const respondClean = await f.api("mission.respond", { requestId: ask.id, decision: "allow_once" }, phone.token);
    assert.notEqual(respondClean.status, 200, "a desktop-required promotion ask stays refused for a device");
    const agentForged = await f.api("agent.authorization.approve", { id: "no-such-agent", revision: 1, ...FORGED_IDENTITY }, phone.token);
    assert.notEqual(agentForged.status, 200, "agent approval with forged identity is refused");
    const deviceForged = await f.api("device.revoke", { id: "no-such-device", ...FORGED_IDENTITY }, phone.token);
    assert.notEqual(deviceForged.status, 200, "a device cannot revoke another device with forged identity");

    assert.equal(f.file("e26.md") && existsSync(f.file("e26.md")), false, "no refused answer wrote the file");
    const stillOpen = f.requests(id).find((r) => r.id === ask.id);
    assert.equal(stillOpen?.resolvedAt ?? null, null, "the promotion ask is still unresolved");

    const records = [
      ...f.sql<{ record: string }>("SELECT record FROM mission_authorizations"),
      ...f.sql<{ record: string }>("SELECT record FROM permission_requests"),
      ...f.sql<{ record: string }>("SELECT record FROM missions"),
    ].map((row) => JSON.parse(row.record) as unknown);
    const claims = records.flatMap((record) => workstationAuthority(record));
    assert.deepEqual(claims, [], "no persisted grantedBy/resolvedBy names the workstation for device-driven rows");
    const envelope = f.envelope(id);
    assert.ok(String(envelope.grantedBy).startsWith("device:"), `envelope granted by the device, got ${String(envelope.grantedBy)}`);
    assert.ok(String(envelope.grantedBy).includes(phone.deviceId));
  } finally {
    await f.close();
  }
});

// ── E27: forged transport headers and missing or non-bearer credentials grant nothing ──────────────────────────────
test("F02-E27: forged headers and unpaired or non-bearer credentials never gain workstation authority", { timeout: 120_000 }, async () => {
  const f = await f02Host();
  try {
    const phone = await f.pair();
    const id = await writeMission(f, "e27.md", "headers");
    const forged: Record<string, string>[] = [
      { "x-owner": "workstation" },
      { "x-bunny-actor": "workstation" },
      { "x-forwarded-for": "127.0.0.1" },
      { forwarded: "for=127.0.0.1;proto=http" },
      { cookie: "bunny_device=" + phone.token },
    ];
    for (const headers of forged) {
      const viewer = await f.state(phone.token, headers);
      assert.equal(viewer.status, 200, JSON.stringify(headers));
      assert.equal(JSON.parse(viewer.text).viewer.kind, "device", `state viewer stays a device for ${JSON.stringify(headers)}`);
      const staging = await f.api("mission.staging.list", { missionId: id }, phone.token, {}, headers);
      assert.equal(staging.body.code, "WORKSTATION_REQUIRED", JSON.stringify(headers));
      const respond = await f.api("mission.respond", { requestId: "none", decision: "allow_once" }, phone.token, {}, headers);
      assert.notEqual(respond.status, 200, JSON.stringify(headers));
    }
    // Non-bearer and unpaired credentials are refused before any action is dispatched.
    const bogus = await f.api("mission.get", { id }, "not-a-paired-token");
    assert.equal(bogus.status, 401);
    const anonymous = await f.api("mission.get", { id }, null);
    assert.equal(anonymous.status, 401);
    const tokenScheme = await f.raw("mission.get", { id }, null, {}, { authorization: `Token ${phone.token}` });
    assert.equal(tokenScheme.status, 401, "a non-Bearer scheme carrying a device token is refused");
    const basic = await f.raw("mission.get", { id }, null, {}, { authorization: `Basic ${Buffer.from(`x:${phone.token}`).toString("base64")}` });
    assert.equal(basic.status, 401);
    const cookieOnly = await f.raw("mission.staging.list", { missionId: id }, null, {}, { cookie: `bunny_device=${phone.token}`, "x-owner": "workstation" });
    assert.equal(cookieOnly.status, 401, "a device cookie without a bearer is not a credential on the Host");
    assert.equal((await f.state(null)).status, 401);
    // D4 hardening: only an exact "Bearer <credential>" header authenticates. A bare credential (no scheme) is no
    // credential, whoever holds it, and a padded or doubled scheme is refused too.
    for (const header of [phone.token, f.host.token, `Bearer  ${f.host.token}`, `Bearer ${f.host.token} extra`, `bearer ${f.host.token}`])
      assert.equal((await f.raw("mission.get", { id }, null, {}, { authorization: header })).status, 401, "malformed authorization header is refused");
    assert.equal(f.file("e27.md") && existsSync(f.file("e27.md")), false);
  } finally {
    await f.close();
  }
});

test("F02-E27: the gateway refuses local classification with relay headers or a device cookie", () => {
  const req = (headers: Record<string, string>) => new Request("http://127.0.0.1:8080/command", { headers });
  // Independent review round 1 (F02-R1-7): an unknown relay family fails closed; this app's own local x- headers do not.
  for (const header of ["x-some-relay-client", "x-proxy-id", "x-tunnel-origin", "x-grok-identity"])
    assert.throws(() => authorizeBridge(req({ [header]: "1" }), "127.0.0.1"), /workstation authentication/, header);
  for (const header of ["x-tss-serialized", "x-requested-with", "x-bunny-pair-client"])
    assert.deepEqual(authorizeBridge(req({ [header]: "1" }), "127.0.0.1"), { local: true, token: null }, header);
  assert.deepEqual(authorizeBridge(req({}), "127.0.0.1"), { local: true, token: null }, "a plain loopback request is local");
  assert.throws(() => authorizeBridge(req({ cookie: "bunny_device=stolen" }), "127.0.0.1"), /workstation authentication/);
  assert.throws(() => authorizeBridge(req({ cookie: "theme=dark; bunny_device=stolen" }), "127.0.0.1"), /workstation authentication/);
  for (const header of ["x-forwarded-for", "forwarded", "via", "cf-connecting-ip", "x-real-ip", "x-forwarded-host", "x-forwarded-proto", "cdn-loop", "true-client-ip", "x-client-ip"])
    assert.throws(() => authorizeBridge(req({ [header]: "1" }), "127.0.0.1"), /workstation authentication|Untrusted|Remote/, header);
});

// ── E28: a paired phone cannot forge a local-owner approval ────────────────────────────────────────────────────────
test("F02-E28: a paired phone cannot answer a promotion or read staged changes", { timeout: 120_000 }, async () => {
  const f = await f02Host();
  try {
    const phone = await f.pair();
    const { id, ask } = await phoneApprovedPromotion(f, phone, "e28.md", "phone staged");
    const staged = await waitFor(() => f.staged(id)[0], "staged record");
    assert.equal(staged.promotionState, "STAGED");
    for (const decision of ["allow_once", "allow_batch"]) {
      const answer = await f.api("mission.respond", { requestId: ask.id, decision }, phone.token);
      assert.notEqual(answer.status, 200, `phone ${decision} on a promotion is refused`);
    }
    assert.equal(f.stagedState(id), "STAGED", "the staged change is untouched by refused answers");
    assert.equal(existsSync(f.file("e28.md")), false, "the project is untouched");
    // A device may still fail a promotion closed with deny; that never promotes anything.
    const denied = await f.api("mission.respond", { requestId: ask.id, decision: "deny" }, phone.token);
    assert.equal(denied.status, 200, "a device deny is a fail-closed answer");
    assert.notEqual(f.stagedState(id), "PROMOTED");
    assert.equal(existsSync(f.file("e28.md")), false, "a device deny writes nothing");
    const list = await f.api("mission.staging.list", { missionId: id }, phone.token);
    assert.equal(list.status === 200 ? "allowed" : list.body.code, "WORKSTATION_REQUIRED");
    const inspect = await f.api("mission.staging.inspect", { stagingId: staged.id }, phone.token);
    assert.equal(inspect.status === 200 ? "allowed" : inspect.body.code, "WORKSTATION_REQUIRED");
    const reason = JSON.stringify(await f.api("mission.get", { id }, phone.token));
    assert.ok(!reason.includes('"promotion"'), "the device view does not carry the promotion payload");
  } finally {
    await f.close();
  }
});

// ── E29: a real workstation approval promotes end to end; a revoked token replays as DEVICE_REVOKED ────────────────
test("F02-E29: a workstation approval promotes the exact staged bytes; a revoked device token is refused", { timeout: 120_000 }, async () => {
  const f = await f02Host();
  try {
    const phone = await f.pair();
    const { id, ask } = await phoneApprovedPromotion(f, phone, "promoted.md", "phone content");
    const answer = await f.api("mission.respond", { requestId: ask.id, decision: "allow_once" });
    assert.equal(answer.status, 200, JSON.stringify(answer.body));
    await waitFor(() => f.missionState(id) === "completed", "completed");
    assert.equal(readFileSync(f.file("promoted.md"), "utf8"), "phone content");
    assert.equal(f.stagedState(id), "PROMOTED");
    const revoked = await f.api("device.revoke", { id: phone.deviceId });
    assert.equal(revoked.status, 200, JSON.stringify(revoked.body));
    const replay = await f.api("mission.get", { id }, phone.token);
    assert.equal(replay.status, 401);
    assert.equal(replay.body.code, "DEVICE_REVOKED");
  } finally {
    await f.close();
  }
});

// ── E30: self sign-out invalidates unused one-time answers and staged changes ──────────────────────────────────────
test("F02-E30: phone self sign-out invalidates its staged changes and never lets a late answer write", { timeout: 120_000 }, async () => {
  const f = await f02Host();
  try {
    const phone = await f.pair();
    const { id, ask } = await phoneApprovedPromotion(f, phone, "e30.md", "signed out");
    await waitFor(() => f.stagedState(id) === "STAGED", "staged");
    const signOut = await f.api("device.revoke", {}, phone.token);
    assert.equal(signOut.status, 200, JSON.stringify(signOut.body));
    assert.equal(f.stagedState(id), "INVALIDATED_BY_SIGNOUT");
    const late = await f.api("mission.respond", { requestId: ask.id, decision: "allow_once" });
    assert.notEqual(late.status, 200, "the workstation's late answer cannot promote an invalidated change");
    assert.equal(existsSync(f.file("e30.md")), false, "nothing was written");
    assert.equal(f.stagedState(id), "INVALIDATED_BY_SIGNOUT");
    for (const request of f.requests(id).filter((r) => r.lifecycle))
      assert.ok(["CONSUMED", "INVALIDATED_BY_SIGNOUT", "EXPIRED"].includes(request.lifecycle.state), `lifecycle ${request.lifecycle.state}`);
    const after = await f.api("mission.get", { id }, phone.token);
    assert.equal(after.status, 401);
    assert.equal(after.body.code, "DEVICE_REVOKED");
  } finally {
    await f.close();
  }
});

// ── E31: sign-out keeps completed action evidence intact ────────────────────────────────────────────────────────────
test("F02-E31: sign-out preserves a completed Mission, its events, runs and promoted content", { timeout: 120_000 }, async () => {
  const f = await f02Host();
  try {
    const phone = await f.pair();
    const { id, ask } = await phoneApprovedPromotion(f, phone, "e31.md", "evidence");
    assert.equal((await f.api("mission.respond", { requestId: ask.id, decision: "allow_once" })).status, 200);
    await waitFor(() => f.missionState(id) === "completed", "completed");
    const stagingId = f.staged(id)[0].id as string;
    const contentPath = f.host.missions.staging.contentPath(stagingId);
    const before = {
      mission: JSON.stringify(f.store().mission(id)),
      events: f.store().missionEvents(id).map((e: Json) => e.sequence ?? e.id ?? JSON.stringify(e)),
      runs: f.store().runs({ missionId: id }).map((r: Json) => r.id),
      staged: f.staged(id)[0].promotionState,
    };
    assert.ok(before.runs.length > 0, "capability runs exist before sign-out");
    const signOut = await f.api("device.revoke", {}, phone.token);
    assert.equal(signOut.status, 200);
    assert.equal(f.missionState(id), "completed");
    assert.equal(JSON.stringify(f.store().mission(id)), before.mission, "the completed Mission record is unchanged");
    const eventsAfter = f.store().missionEvents(id).map((e: Json) => e.sequence ?? e.id ?? JSON.stringify(e));
    for (const event of before.events) assert.ok(eventsAfter.includes(event), "every earlier event is still present");
    assert.deepEqual(f.store().runs({ missionId: id }).map((r: Json) => r.id), before.runs, "capability runs intact");
    assert.equal(f.stagedState(id), "PROMOTED", "the promoted record stays PROMOTED");
    assert.equal(existsSync(contentPath), true, "the staged content file is kept for audit");
    assert.equal(readFileSync(contentPath, "utf8"), "evidence");
    assert.equal(readFileSync(f.file("e31.md"), "utf8"), "evidence");
  } finally {
    await f.close();
  }
});

// ── E32: sign-out does not revoke independent owner approvals ───────────────────────────────────────────────────────
test("F02-E32: sign-out leaves workstation-granted envelopes and workstation Missions running", { timeout: 120_000 }, async () => {
  const f = await f02Host();
  try {
    const phone = await f.pair();
    const device = await phoneApprovedPromotion(f, phone, "e32-device.md", "device-owned");
    const owner = await writeMission(f, "owner.md", "owner wrote this");
    assert.equal((await f.api("mission.approve", { id: owner })).status, 200);
    await settleOnWorkstation(f, owner);
    assert.equal(f.missionState(owner), "completed", "the workstation Mission completes");
    const ownerEnvelope = f.envelope(owner);
    assert.equal(ownerEnvelope.revokedAt ?? null, null, "the owner envelope is not revoked before sign-out");
    const signOut = await f.api("device.revoke", {}, phone.token);
    assert.equal(signOut.status, 200);
    assert.equal(f.envelope(owner).revokedAt ?? null, null, "the owner envelope stays unrevoked by a device sign-out");
    assert.equal(f.missionState(owner), "completed");
    assert.equal(readFileSync(f.file("owner.md"), "utf8"), "owner wrote this");
    assert.ok(f.envelope(device.id).revokedAt, "the device-granted envelope is revoked by its own sign-out");
  } finally {
    await f.close();
  }
});

// ── E33: owner revocation invalidates pending device approvals ─────────────────────────────────────────────────────
test("F02-E33: workstation revocation invalidates a device's pending staged change and approvals", { timeout: 120_000 }, async () => {
  const f = await f02Host();
  try {
    const phone = await f.pair();
    const { id, ask } = await phoneApprovedPromotion(f, phone, "e33.md", "pending");
    await waitFor(() => f.stagedState(id) === "STAGED", "staged");
    const revoked = await f.api("device.revoke", { id: phone.deviceId });
    assert.equal(revoked.status, 200, JSON.stringify(revoked.body));
    assert.equal(f.stagedState(id), "INVALIDATED_BY_DEVICE_REVOCATION");
    assert.ok(f.envelope(id).revokedAt, "the device-granted envelope is revoked");
    const late = await f.api("mission.respond", { requestId: ask.id, decision: "allow_once" });
    assert.notEqual(late.status, 200, "the owner cannot promote a change from a revoked device");
    assert.equal(existsSync(f.file("e33.md")), false);
    const requestState = f.requests(id).find((r) => r.id === ask.id);
    assert.ok(requestState?.resolvedAt || requestState?.lifecycle?.state === "INVALIDATED_BY_DEVICE_REVOCATION", "the pending ask is closed or stamped");
  } finally {
    await f.close();
  }
});

// ── E34: re-pairing cannot revive old approvals or staged changes ───────────────────────────────────────────────────
test("F02-E34: a re-paired device with a new id cannot revive old approvals or staged changes", { timeout: 120_000 }, async () => {
  const f = await f02Host();
  try {
    const first = await f.pair("F02 first phone");
    const { id, ask } = await phoneApprovedPromotion(f, first, "e34.md", "old approval");
    assert.equal((await f.api("device.revoke", {}, first.token)).status, 200);
    assert.equal(f.stagedState(id), "INVALIDATED_BY_SIGNOUT");
    const second = await f.pair("F02 second phone");
    assert.notEqual(second.deviceId, first.deviceId, "re-pairing mints a new device id");
    assert.notEqual(second.token, first.token);
    const oldAnswer = await f.api("mission.respond", { requestId: ask.id, decision: "allow_once" }, first.token);
    assert.equal(oldAnswer.status, 401);
    assert.equal(oldAnswer.body.code, "DEVICE_REVOKED");
    const newAnswer = await f.api("mission.respond", { requestId: ask.id, decision: "allow_once" }, second.token);
    assert.notEqual(newAnswer.status, 200, "the new pairing cannot answer the old promotion");
    const owner = await f.api("mission.respond", { requestId: ask.id, decision: "allow_once" });
    assert.notEqual(owner.status, 200, "the workstation cannot revive the invalidated change");
    assert.equal(f.stagedState(id), "INVALIDATED_BY_SIGNOUT");
    assert.equal(existsSync(f.file("e34.md")), false, "nothing was written");
  } finally {
    await f.close();
  }
});

// ── E35: sign-out races admission of a device answer ───────────────────────────────────────────────────────────────
test("F02-E35: a device answer racing its own sign-out lands at most once and never writes", { timeout: 120_000 }, async () => {
  const f = await f02Host();
  try {
    const concurrent = await f.pair("F02 race phone");
    const a = await phoneApprovedPromotion(f, concurrent, "e35-concurrent.md", "race");
    const [answer, signOut] = await Promise.all([
      f.api("mission.respond", { requestId: a.ask.id, decision: "allow_once" }, concurrent.token),
      f.api("device.revoke", {}, concurrent.token),
    ]);
    assert.equal(signOut.status, 200);
    assert.notEqual(answer.status, 200, "the device's answer never completes");
    assert.ok(answer.status === 401 || answer.status >= 400, `refused (${answer.status})`);
    assert.equal(existsSync(f.file("e35-concurrent.md")), false, "concurrent answer wrote nothing");
    assert.notEqual(f.stagedState(a.id), "PROMOTED");

    const delayed = await f.pair("F02 delayed phone");
    const b = await phoneApprovedPromotion(f, delayed, "e35-delayed.md", "delayed");
    const payload = new TextEncoder().encode(JSON.stringify({ action: "mission.respond", data: { requestId: b.ask.id, decision: "allow_once" } }));
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        setTimeout(() => {
          controller.enqueue(payload);
          controller.close();
        }, 400);
      },
    });
    const pending = fetch(`${f.base}/command`, { method: "POST", headers: { authorization: `Bearer ${delayed.token}`, "content-type": "application/json" }, body, duplex: "half" } as RequestInit);
    await sleep(50);
    const revoked = await f.api("device.revoke", {}, delayed.token);
    assert.equal(revoked.status, 200);
    const late = await pending;
    assert.notEqual(late.status, 200, "an answer whose body lands after sign-out is refused");
    assert.equal(existsSync(f.file("e35-delayed.md")), false, "delayed answer wrote nothing");
    assert.notEqual(f.stagedState(b.id), "PROMOTED");
  } finally {
    await f.close();
  }
});

// ── E36: revocation races admission of a device answer ─────────────────────────────────────────────────────────────
test("F02-E36: a device answer racing a workstation revocation never writes", { timeout: 120_000 }, async () => {
  const f = await f02Host();
  try {
    const phone = await f.pair("F02 revoke race phone");
    const { id, ask } = await phoneApprovedPromotion(f, phone, "e36.md", "revoke race");
    const [answer, revoked] = await Promise.all([
      f.api("mission.respond", { requestId: ask.id, decision: "allow_once" }, phone.token),
      f.api("device.revoke", { id: phone.deviceId }),
    ]);
    assert.equal(revoked.status, 200);
    assert.notEqual(answer.status, 200, "the device's answer never completes");
    assert.equal(existsSync(f.file("e36.md")), false);
    assert.notEqual(f.stagedState(id), "PROMOTED");
    const owner = await f.api("mission.respond", { requestId: ask.id, decision: "allow_once" });
    assert.notEqual(owner.status, 200, "the workstation cannot promote after the revocation won");
    assert.equal(existsSync(f.file("e36.md")), false);
  } finally {
    await f.close();
  }
});

// ── E38: a Host restart cannot revive an old approval ──────────────────────────────────────────────────────────────
test("F02-E38: a Host restart invalidates staged changes and the old approval stays dead", { timeout: 120_000 }, async () => {
  const f = await f02Host();
  try {
    const phone = await f.pair();
    const { id, ask } = await phoneApprovedPromotion(f, phone, "e38.md", "before restart");
    await waitFor(() => f.stagedState(id) === "STAGED", "staged");
    await f.restart();
    assert.equal(f.stagedState(id), "INVALIDATED_BY_HOST_RESTART");
    const workstation = await f.api("mission.respond", { requestId: ask.id, decision: "allow_once" });
    assert.notEqual(workstation.status, 200, "the old approval cannot be answered after restart");
    const device = await f.api("mission.respond", { requestId: ask.id, decision: "allow_once" }, phone.token);
    assert.notEqual(device.status, 200);
    assert.equal(existsSync(f.file("e38.md")), false, "nothing was written across the restart");
    assert.notEqual(f.stagedState(id), "PROMOTED");
  } finally {
    await f.close();
  }
});

// ── E49: device event streams stop after self sign-out and after revocation ────────────────────────────────────────
test("F02-E49: device SSE streams close and deliver nothing after sign-out or revocation", { timeout: 120_000 }, async () => {
  const f = await f02Host();
  try {
    const selfOut = await f.pair("F02 stream sign-out");
    const revokedByOwner = await f.pair("F02 stream revoked");
    const streamA = await f.stream(selfOut.token);
    const streamB = await f.stream(revokedByOwner.token);
    assert.equal(streamA.status, 200);
    assert.equal(streamB.status, 200);
    const drainA = drain(streamA, 5000);
    const drainB = drain(streamB, 5000);
    await sleep(100);
    assert.equal((await f.api("device.revoke", {}, selfOut.token)).status, 200);
    assert.equal((await f.api("device.revoke", { id: revokedByOwner.deviceId })).status, 200);
    await f.api("mission.create", { objective: "F02-E49-LATE", mode: "fast", steps: [] });
    const [a, b] = await Promise.all([drainA, drainB]);
    assert.equal(a.ended, true, "the self sign-out stream closed promptly");
    assert.equal(b.ended, true, "the revoked device's stream closed promptly");
    assert.ok(!a.text.includes("F02-E49-LATE"), "no later event reached the signed-out device");
    assert.ok(!b.text.includes("F02-E49-LATE"), "no later event reached the revoked device");
  } finally {
    await f.close();
  }
});

// ── E50: no credentials or Host token appear in device-facing output ───────────────────────────────────────────────
test("F02-E50: /state, /events and command results never disclose the Host or device tokens", { timeout: 120_000 }, async () => {
  const f = await f02Host();
  try {
    const phone = await f.pair("F02 disclosure phone");
    const other = await f.pair("F02 other phone");
    const id = await writeMission(f, "e50.md", "disclosure");
    assert.equal((await f.api("mission.approve", { id }, phone.token)).status, 200);
    const secrets = [f.host.token, phone.token, other.token];
    const state = await f.state(phone.token);
    assert.equal(state.status, 200);
    const eventsStream = await f.stream(phone.token);
    const reading = drain(eventsStream, 2500);
    await f.api("mission.create", { objective: "F02-E50 event", mode: "fast", steps: [] });
    const events = await reading;
    const results = [
      await f.api("mission.get", { id }, phone.token),
      await f.api("mission.respond", { requestId: "none", decision: "allow_once" }, phone.token),
      await f.api("device.revoke", {}, other.token),
    ];
    const device = [state.text, events.text, ...results.map((r) => JSON.stringify(r.body))].join("\n");
    for (const secret of secrets) assert.ok(!device.includes(secret), "no token appears in device-facing output");
    const details = f.sql<{ detail: string }>("SELECT detail FROM events");
    for (const row of details) for (const secret of secrets) assert.ok(!row.detail.includes(secret), "no token appears in an event detail");
  } finally {
    await f.close();
  }
});
