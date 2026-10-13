import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { request as httpRequest } from "node:http";
import { startHost } from "./http.server.ts";
import { providerBase } from "./adapters.server.ts";
import type { AdapterResult, ProviderAdapter } from "./contracts.ts";
import type { OrchTask, ProviderId, ProviderLive } from "../orch/types.ts";
import { probeOllama } from "../orch/exec.server.ts";
import type { AgentSnapshot } from "./agent-types.ts";
import { FilesystemCapability, GitCapability, TerminalCapability } from "../bunny-missions/capabilities/local.server.ts";
import { DEVICE_IDLE_MS, DEVICE_SESSION_MS, hidePaths, OperationLedger, WindowLimiter } from "./device-authority.server.ts";

/**
 * M-A-3 T9: the paired-device boundary at the real Host HTTP surface, with real paired device credentials on
 * disposable state. Every request below crosses the same /command, /state and /events boundary the gateway uses.
 */
type Body = Record<string, unknown> & { error?: string; code?: string; agents?: AgentSnapshot; snapshot?: Snapshot; task?: OrchTask; pairCode?: string; operation?: { id: string; state: string; replayed: boolean }; data?: Record<string, unknown> };
type Snapshot = { agents: AgentSnapshot; tasks: OrchTask[]; devices: { id: string; name: string }[]; hostIdentity: { hostId: string; epoch: string }; viewer: { kind: string; deviceId?: string; role?: string; rights?: string[] }; providers: ProviderLive[] };

async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}
function fakeAdapter(id: ProviderId, model: string) {
  const launched: OrchTask[] = [];
  const adapter: ProviderAdapter = {
    id,
    // The Host model registry probes the real local Ollama listing; the fake lists the same models so routing
    // revalidation sees a consistent provider, while every launch stays inside this fake.
    detect: async () => {
      const listed = id === "ollama" ? (await probeOllama()).models : [];
      return { ...providerBase(id), installed: true, authenticated: true, availability: "ready", capabilities: id === "ollama" ? ["text"] : ["filesystem", "terminal", "text"], current_model: listed[0] ?? model, models: listed.length ? listed : [model] };
    },
    launch: (task) => {
      launched.push(task);
      let finish!: (result: AdapterResult) => void;
      const done = new Promise<AdapterResult>((resolve) => (finish = resolve));
      setTimeout(() => finish({ ok: true, output: "done", exitCode: 0 }), 5);
      return { done, stop: async () => finish({ ok: false, output: "", stopped: true }) };
    },
  };
  return { adapter, launched };
}
async function fixture(options: { agentic?: boolean } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "bunny-t9-remote-"));
  const root = join(directory, "project");
  mkdirSync(root);
  writeFileSync(join(root, "seed.txt"), "seed");
  const port = await freePort();
  const claude = fakeAdapter("claude", "claude-test");
  const ollama = fakeAdapter("ollama", "llama-test");
  const host = await startHost({
    dataDirectory: directory,
    root,
    port,
    adapters: [claude.adapter, ollama.adapter],
    ...(options.agentic ? { missions: { adapters: [new FilesystemCapability(), new TerminalCapability(), new GitCapability(directory)] } } : {}),
    sample: async () => ({ at: Date.now(), cpu: { utilization: null, clockMhz: null, temperatureC: null }, memory: { usedBytes: 0, availableBytes: 1, totalBytes: 1 }, gpus: [], notes: ["T9 disposable telemetry"] }),
  });
  const base = `http://127.0.0.1:${port}`;
  const raw = (action: string, data: unknown = {}, token = host.token, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
    fetch(`${base}/command`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...headers }, body: JSON.stringify({ action, data, ...extra }) });
  const api = async (action: string, data: unknown = {}, token = host.token, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) => {
    const response = await raw(action, data, token, extra, headers);
    return { status: response.status, body: (await response.json()) as Body, headers: response.headers };
  };
  const state = async (token = host.token) => {
    const response = await fetch(`${base}/state`, { headers: { authorization: `Bearer ${token}` } });
    return { status: response.status, body: (await response.json()) as Snapshot & Body };
  };
  const pair = async (name = "T9 disposable phone") => {
    const code = (await api("pairing.create")).body.pairCode;
    const response = await fetch(`${base}/pair`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, name }) });
    assert.equal(response.status, 200);
    return (await response.json()) as { token: string; deviceId: string; hostId: string };
  };
  const streams: AbortController[] = [];
  const stream = async (token: string) => {
    const abort = new AbortController();
    streams.push(abort);
    return fetch(`${base}/events`, { headers: { authorization: `Bearer ${token}` }, signal: abort.signal });
  };
  const close = async () => {
    for (const abort of streams) abort.abort();
    await host.close();
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  };
  return { host, directory, root, base, api, raw, state, pair, stream, close, claude, ollama };
}
async function until<T>(check: () => Promise<T | null | undefined | false>, label: string, ms = 20_000): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() - started > ms) throw new Error(`Timed out: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
const op = (role: string, action: string, params: Record<string, unknown>, dependsOn: number[] = []) => ({
  role,
  objective: role,
  access: action === "filesystem.read" ? "read" : "write",
  executor: { kind: "capability", action, params },
  dependsOn,
  verification: [],
});

test("T9 F01/F02/F05/F11: device identity is per credential, projected, and never the owner", async () => {
  const f = await fixture();
  try {
    const a = await f.pair("Phone A"), b = await f.pair("Phone B");
    assert.match(a.hostId, /^[0-9a-f-]{36}$/);
    assert.equal(a.hostId, b.hostId, "one stable Host identity");
    const view = await f.state(a.token);
    assert.equal(view.status, 200);
    assert.equal(view.body.viewer.kind, "device");
    assert.equal(view.body.viewer.deviceId, a.deviceId);
    assert.equal(view.body.viewer.role, "paired-device");
    assert.equal(view.body.hostIdentity.hostId, a.hostId);
    assert.deepEqual(view.body.devices.map((d) => d.id), [a.deviceId], "a device sees only its own row");
    const serialized = JSON.stringify(view.body);
    assert.ok(!serialized.includes(a.token) && !serialized.includes(b.token) && !serialized.includes(f.host.token), "no credential in a projection");
    assert.ok(!/token_hash|tokenHash/.test(serialized));
    const owner = await f.state();
    assert.equal(owner.body.viewer.kind, "workstation");
    assert.equal(owner.body.devices.length, 2);
    // F02: unknown, empty and malformed credentials.
    for (const token of ["not-a-device", "", a.token + "x"]) {
      const response = await f.state(token);
      assert.equal(response.status, 401);
      assert.equal(response.body.code, "AUTH_REQUIRED");
    }
    // F05/F11: headers never create identity or owner authority; the bearer alone decides.
    const forged = await f.api("pairing.create", {}, a.token, {}, { "x-bunny-actor": "workstation", "x-forwarded-for": "127.0.0.1", "x-device-id": b.deviceId });
    assert.equal(forged.status, 400);
    assert.equal(forged.body.code, "WORKSTATION_REQUIRED");
    assert.match(forged.body.error!, /workstation/);
    const noBearer = await fetch(`${f.base}/state`, { headers: { "x-bunny-actor": "workstation" } });
    assert.equal(noBearer.status, 401);
    assert.equal((await f.state(a.token)).status, 200);
    // A device may sign itself out, never another device.
    const other = await f.api("device.revoke", { id: b.deviceId }, a.token);
    assert.equal(other.body.code, "WORKSTATION_REQUIRED");
    assert.equal((await f.state(b.token)).status, 200);
    const signedOut = await f.api("device.revoke", {}, a.token);
    assert.equal(signedOut.status, 200);
    assert.equal(signedOut.body.snapshot, undefined, "self sign-out acknowledges without disclosing protected state after revocation");
    const revoked = await f.state(a.token);
    assert.equal(revoked.status, 401);
    assert.equal(revoked.body.code, "DEVICE_REVOKED");
    assert.equal((await f.api("device.revoke", { id: a.deviceId })).status, 400, "re-revocation is refused, not silently repeated");
    assert.equal((await f.api("device.revoke", { id: "unknown-device" })).status, 400);
  } finally {
    await f.close();
  }
});

test("T9 F04: absolute lifetime and idle bound are enforced by the Host; presence never extends the lifetime", async () => {
  const f = await fixture();
  try {
    const device = await f.pair();
    const db = new DatabaseSync(join(f.directory, "host.sqlite"));
    try {
      const now = Date.now();
      db.prepare("UPDATE devices SET created_at=? WHERE id=?").run(now - DEVICE_SESSION_MS - 1000, device.deviceId);
      db.prepare("INSERT OR REPLACE INTO device_presence(device_id,last_seen_at,last_action) VALUES(?,?,?)").run(device.deviceId, now, "/state");
      const expired = await f.state(device.token);
      assert.equal(expired.status, 401);
      assert.equal(expired.body.code, "DEVICE_EXPIRED", "recent use never extends the absolute lifetime");
      db.prepare("UPDATE devices SET created_at=? WHERE id=?").run(now - 40 * 86_400_000, device.deviceId);
      db.prepare("UPDATE device_presence SET last_seen_at=? WHERE device_id=?").run(now - DEVICE_IDLE_MS - 1000, device.deviceId);
      assert.equal((await f.state(device.token)).body.code, "DEVICE_EXPIRED", "idle beyond the bound");
      db.prepare("UPDATE device_presence SET last_seen_at=? WHERE device_id=?").run(now - 1000, device.deviceId);
      const active = await f.state(device.token);
      assert.equal(active.status, 200);
      const viewer = active.body.viewer as unknown as { expiresAt: number };
      assert.ok(viewer.expiresAt > now && viewer.expiresAt <= now + DEVICE_IDLE_MS);
      const row = db.prepare("SELECT revoked_at FROM devices WHERE id=?").get(device.deviceId) as { revoked_at: number | null };
      assert.equal(row.revoked_at, null, "expiry never rewrites the protected device row");
    } finally {
      db.close();
    }
  } finally {
    await f.close();
  }
});

test("T9 F06/F35/F40: Host identity and epoch expectations refuse stale views; operation ids never execute twice", async () => {
  const f = await fixture();
  try {
    const device = await f.pair();
    const identity = (await f.state(device.token)).body.hostIdentity;
    const before = (await f.state()).body.tasks.length;
    const wrongHost = await f.api("submit", { prompt: "Hello", mode: "fast" }, device.token, { expect: { hostId: "00000000-0000-0000-0000-000000000000", epoch: identity.epoch } });
    assert.equal(wrongHost.status, 409);
    assert.equal(wrongHost.body.code, "HOST_IDENTITY_CHANGED");
    const oldEpoch = await f.api("submit", { prompt: "Hello", mode: "fast" }, device.token, { expect: { hostId: identity.hostId, epoch: "previous-epoch" } });
    assert.equal(oldEpoch.body.code, "HOST_EPOCH_CHANGED");
    assert.equal((await f.state()).body.tasks.length, before, "nothing executed on a stale view");
    const operationId = "t9-op-0001-submit";
    const first = await f.api("submit", { prompt: "Hello from the phone", mode: "fast", override: "ollama" }, device.token, { operationId, expect: identity });
    assert.equal(first.status, 200, first.body.error);
    assert.deepEqual(first.body.operation, { id: operationId, state: "applied", replayed: false });
    const replay = await f.api("submit", { prompt: "Hello from the phone", mode: "fast", override: "ollama" }, device.token, { operationId, expect: identity });
    assert.equal(replay.status, 200);
    assert.deepEqual(replay.body.operation, { id: operationId, state: "applied", replayed: true });
    assert.equal((await f.state()).body.tasks.length, before + 1, "a replayed operation created no second task");
    const conflict = await f.api("task.feedback", { id: first.body.task!.id, value: "positive" }, device.token, { operationId });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.code, "OPERATION_CONFLICT");
    const status = await f.api("operation.status", { operationId }, device.token);
    assert.equal(status.body.data!.state, "applied");
    assert.equal(status.body.data!.action, "submit");
    assert.equal((await f.api("operation.status", { operationId: "t9-never-sent" }, device.token)).body.data!.state, "unknown");
    // Another principal cannot read or replay this device's operation.
    const second = await f.pair("Second phone");
    assert.equal((await f.api("operation.status", { operationId }, second.token)).body.data!.state, "unknown");
    assert.equal((await f.api("operation.status", { operationId })).body.data!.state, "unknown");
    // A refused operation is recorded as refused and replays as refused.
    const claudeTask = (await f.api("submit", { prompt: "Edit files", mode: "fast", override: "claude" })).body.task!;
    const refusedId = "t9-op-0002-approve";
    const refused = await f.api("approve", { id: claudeTask.id }, device.token, { operationId: refusedId, expect: identity });
    assert.equal(refused.body.code, "WORKSTATION_REQUIRED");
    assert.equal(refused.body.operation!.state, "refused");
    const refusedReplay = await f.api("approve", { id: claudeTask.id }, device.token, { operationId: refusedId, expect: identity });
    assert.equal(refusedReplay.body.code, "WORKSTATION_REQUIRED");
    assert.equal(refusedReplay.body.operation!.replayed, true);
    assert.equal((await f.api("operation.status", { operationId: refusedId }, device.token)).body.data!.state, "refused");
    assert.equal((await f.api("approve", { id: claudeTask.id }, device.token, { operationId: "bad id!" })).body.error, "Invalid operation id.");
  } finally {
    await f.close();
  }
});

test("T9 F26-F29 (DEV-01): a paired device never launches a tool-capable or hosted provider, a shell or an app", async () => {
  const f = await fixture();
  try {
    const device = await f.pair();
    const claudeTask = (await f.api("submit", { prompt: "Run Bash on the workstation", mode: "fast", override: "claude" }, device.token)).body.task!;
    assert.equal(claudeTask.state, "waiting_for_approval", "a phone may only queue chat for review");
    const refused = await f.api("approve", { id: claudeTask.id }, device.token);
    assert.equal(refused.status, 400);
    assert.equal(refused.body.code, "WORKSTATION_REQUIRED");
    assert.match(refused.body.error!, /Approval required on Windows Host/);
    assert.equal(f.claude.launched.length, 0, "the tool-capable adapter never launched");
    const ollamaTask = (await f.api("submit", { prompt: "Summarize this", mode: "fast", override: "ollama" }, device.token)).body.task!;
    const approved = await f.api("approve", { id: ollamaTask.id }, device.token);
    assert.equal(approved.status, 200, approved.body.error);
    assert.equal(f.ollama.launched.length, 1, "local tool-free inference may be launched remotely");
    assert.equal(approved.body.task!.cwd, undefined, "a device never receives the task folder");
    const verifyRefused = await f.api("submit", { prompt: "x", mode: "fast", verify: { kind: "python", name: "check.py", expected: "ok" } }, device.token);
    assert.equal(verifyRefused.body.code, "WORKSTATION_REQUIRED");
    const folderRefused = await f.api("submit", { prompt: "x", mode: "fast", constraints: { workingDirectory: "C:\\" } }, device.token);
    assert.equal(folderRefused.body.code, "WORKSTATION_REQUIRED");
    for (const [action, data] of [
      ["capability.run", { action: "terminal.exec", params: { command: "node", args: ["-e", "1"] } }],
      ["capability.run", { action: "computer.open_app", params: { app: "calc" } }],
      ["terminal", { id: claudeTask.id }],
      ["session.input", { id: claudeTask.id, input: "rm -rf" }],
      ["input", { id: claudeTask.id, input: "rm -rf" }],
      ["session.get", { id: claudeTask.id }],
      ["retarget", { id: claudeTask.id, provider: "ollama" }],
      ["discover", {}],
      ["agent.create", { objective: "New autonomous work" }],
      ["agent.start", { id: "any" }],
      ["agent.authorization.propose", { id: "any" }],
      ["agent.authorization.adjust", { id: "any", revision: 1, patch: { maximumActions: 999 } }],
      ["mission.create", { objective: "x", mode: "fast" }],
      ["mission.configure", { enabled: true }],
      ["project.add", { name: "Forbidden", path: f.root }],
      ["provider.configure_path", { provider: "claude", path: "C:\\evil.exe" }],
      ["remote.configure", { enabled: true, url: "https://evil.example" }],
      ["pairing.create", {}],
      ["unknown.action", {}],
    ] as const) {
      const response = await f.api(action, data, device.token);
      assert.equal(response.status, 400, action);
      assert.equal(response.body.code, "WORKSTATION_REQUIRED", action);
      assert.match(response.body.error!, /workstation/, action);
    }
    assert.equal(f.claude.launched.length, 0);
    const refusals = (await f.state()).body as unknown as { events: { type: string; detail: string }[] };
    assert.ok(refusals.events.some((event) => event.type === "audit.device_refused" && event.detail.includes("capability.run")), "refused device commands are audited");
  } finally {
    await f.close();
  }
});

test("T9 F43-limits: paired-device load is bounded per device; the workstation is unchanged", async () => {
  const f = await fixture();
  try {
    const device = await f.pair();
    let limited: Awaited<ReturnType<typeof f.api>> | null = null;
    for (let i = 0; i < 61; i++) {
      const response = await f.api("operation.status", { operationId: `t9-limit-${String(i).padStart(4, "0")}` }, device.token);
      if (response.status === 429) {
        limited = response;
        break;
      }
    }
    assert.ok(limited, "the 61st command in one window is refused");
    assert.equal(limited!.body.code, "RATE_LIMITED");
    assert.ok(Number(limited!.headers.get("retry-after")) >= 1);
    assert.equal((await f.api("operation.status", { operationId: "t9-workstation-0001" })).status, 200, "the workstation is not limited");
    const second = await f.pair();
    assert.equal((await f.api("operation.status", { operationId: "t9-other-0001" }, second.token)).status, 200, "limits are per device");
    // Concurrent device streams are bounded.
    const opened = [] as Response[];
    for (let i = 0; i < 3; i++) opened.push(await f.stream(second.token));
    assert.deepEqual(opened.map((r) => r.status), [200, 200, 200]);
    const fourth = await f.stream(second.token);
    assert.equal(fourth.status, 429);
    // Self sign-out closes the device's open streams immediately.
    assert.equal((await f.api("device.revoke", {}, second.token)).status, 200);
    for (const response of opened) {
      const reader = response.body!.getReader();
      const ended = await Promise.race([
        (async () => {
          try {
            for (;;) if ((await reader.read()).done) return true;
          } catch {
            return true;
          }
        })(),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 3000)),
      ]);
      assert.equal(ended, true, "a revoked device's stream is closed at once");
    }
  } finally {
    await f.close();
  }
});

test("T9 G6: holding and stopping an Agent still work while the Host is degraded", async () => {
  const f = await fixture();
  try {
    const device = await f.pair();
    f.host.containment.degrade("*", "T9 degraded fixture");
    const submit = await f.api("submit", { prompt: "x", mode: "fast" }, device.token);
    assert.equal(submit.status, 503);
    assert.equal(submit.body.code, "HOST_UNAVAILABLE");
    for (const action of ["agent.stop", "agent.pause", "agent.authorization.deny", "agent.authorization.revoke"]) {
      const response = await f.api(action, { id: "unknown-agent", revision: 1 }, device.token);
      assert.notEqual(response.status, 503, `${action} reaches its canonical path while degraded`);
    }
  } finally {
    await f.close();
  }
});

test("T9 F12-F15/F19-F22/F50 (G2): device answers only exact Host offers; Pause/Resume reissue asks at the current revision", async () => {
  const f = await fixture({ agentic: true });
  try {
    assert.equal((await f.api("mission.configure", { enabled: true })).status, 200);
    const device = await f.pair();
    // Workstation creates the Agent. Its write stays inside consent; a standing ask_every_time grant makes that write an ask.
    const projectId = (await f.api("project.add", { name: "Phone supervised Project", path: f.root })).body.data!.id;
    const created = await f.api("agent.create", { projectId, name: "Phone supervised", objective: "Read then write", steps: [{ ...op("Inspect", "filesystem.read", { path: "seed.txt" }), verification: [{ kind: "capability", action: "filesystem.compare", params: { path: "seed.txt", content: "seed" }, expect: { field: "matches", equals: true } }] }, { ...op("Write", "filesystem.write", { path: "result.txt", content: "phone", overwrite: true }, [0]), verification: [{ kind: "capability", action: "filesystem.compare", params: { path: "result.txt", content: "phone" }, expect: { field: "matches", equals: true } }] }].map((step) => ({ ...step, crossApp: true })) });
    assert.equal(created.status, 200, created.body.error);
    const agentId = created.body.agents!.agents.find((a) => a.name === "Phone supervised")!.id;
    const proposed = (await f.api("agent.authorization.propose", { id: agentId })).body.agents!.agents.find((a) => a.id === agentId)!.authorization!;
    // Initial delegation stays on the workstation, and the Host says so in the device projection.
    const offerView = (await f.state(device.token)).body.agents.agents.find((a) => a.id === agentId)!;
    assert.equal(offerView.authorization!.remoteOffer?.answerable, false);
    const initial = await f.api("agent.authorization.approve", { id: agentId, revision: proposed.revision }, device.token);
    assert.equal(initial.body.code, "WORKSTATION_REQUIRED");
    // F12/F13/F14: the device can neither invent nor widen, nor smuggle fields into an approval.
    const widened = await f.api("agent.authorization.approve", { id: agentId, revision: proposed.revision, maximumActions: 999 }, device.token);
    assert.match(widened.body.error!, /exact Host offer/);
    // F02 D3: consent keeps filesystem.write; the standing grant (not a narrowed consent) makes the write ask a device may answer.
    assert.equal((await f.api("capability.grant", { action: "filesystem.write", scope: "global", policy: "ask_every_time" })).status, 200);
    // A non-narrowing revision bump (a reduced action ceiling) makes the proposed revision stale.
    const adjusted = (await f.api("agent.authorization.adjust", { id: agentId, revision: proposed.revision, patch: { maximumActions: 10 } })).body.agents!.agents.find((a) => a.id === agentId)!.authorization!;
    assert.equal((await f.api("agent.authorization.approve", { id: agentId, revision: proposed.revision })).status, 400, "F15: a stale revision is refused");
    assert.equal((await f.api("agent.authorization.approve", { id: agentId, revision: adjusted.revision })).status, 200);
    const waiting = await until(async () => (await f.state(device.token)).body.agents.agents.find((a) => a.id === agentId && a.authorization?.pending.length), "write ask");
    const ask = waiting.authorization!.pending[0];
    assert.equal(ask.action, "filesystem.write");
    assert.equal(ask.risk, "WRITE");
    assert.equal(ask.remote?.answerable, true, "an in-scope write ask is answerable remotely");
    // F21: Pause through the canonical Host command; answering while paused is refused with a reason.
    assert.equal((await f.api("agent.pause", { id: agentId }, device.token)).status, 200);
    const paused = (await f.state()).body.agents.agents.find((a) => a.id === agentId)!;
    assert.equal(paused.state, "PAUSED");
    const whilePaused = await f.api("mission.respond", { requestId: ask.id, decision: "allow_once" }, device.token);
    // F02 D3: the device consent check runs before the pause message, so a paused Agent's answer is refused as WORKSTATION_REQUIRED.
    assert.equal(whilePaused.status, 400);
    assert.equal(whilePaused.body.code, "WORKSTATION_REQUIRED");
    assert.ok(whilePaused.body.error, "the refusal carries a reason");
    // F22/F50: Resume revalidates and is bound to the revision the device reviewed.
    assert.match((await f.api("agent.resume", { id: agentId }, device.token)).body.error!, /revision/);
    assert.match((await f.api("agent.resume", { id: agentId, revision: waiting.authorization!.revision }, device.token)).body.error!, /revision/);
    const resumed = await f.api("agent.resume", { id: agentId, revision: paused.authorization!.revision }, device.token);
    assert.equal(resumed.status, 200, resumed.body.error);
    const reissued = await until(async () => (await f.state(device.token)).body.agents.agents.find((a) => a.id === agentId && a.authorization?.pending.length && a.authorization.pending[0].id !== ask.id), "reissued ask");
    const fresh = reissued.authorization!.pending[0];
    assert.equal(fresh.action, "filesystem.write");
    assert.equal((await f.api("mission.respond", { requestId: ask.id, decision: "allow_once" }, device.token)).body.code, "REFUSED", "the superseded ask can never be answered");
    assert.equal((await f.api("mission.respond", { requestId: fresh.id, decision: "allow_once" }, device.token)).status, 200);
    // F02 D2: the device's answer stages the bytes; the workstation promotes them, and a device cannot promote.
    const promotion = await until(async () => { const agent = (await f.state()).body.agents.agents.find((a) => a.id === agentId); return agent?.authorization?.pending.find((p) => p.action === "filesystem.promote") ?? false; }, "staged promotion ask");
    assert.equal((await f.api("mission.respond", { requestId: promotion.id, decision: "allow_once" }, device.token)).body.code, "WORKSTATION_REQUIRED", "a device cannot promote its own staged change");
    assert.equal(existsSync(join(f.root, "result.txt")), false, "project untouched while staged");
    assert.equal((await f.api("mission.respond", { requestId: promotion.id, decision: "allow_once" })).status, 200);
    await until(async () => { try { return readFileSync(join(f.root, "result.txt"), "utf8") === "phone"; } catch { return false; } }, "phone-approved write");
    const done = await until(async () => { const agent = (await f.state()).body.agents.agents.find((a) => a.id === agentId); if (agent?.state === "FAILED") { const mission = await f.api("mission.get", { id: agent.missionId }); throw new Error(JSON.stringify(mission.body)); } return agent?.state === "COMPLETED" ? agent : null; }, "Agent completes on the Host");
    assert.equal(done.id, agentId, "F24: the same Agent identity throughout");
    assert.equal(created.body.agents!.agents.find((a) => a.id === agentId)!.missionId, done.missionId, "F25: the same Mission identity throughout");
  } finally {
    await f.close();
  }
});

test("T9 F02 D3 (negative regression): a device cannot answer a write that the owner's narrowed Agent consent no longer covers", async () => {
  const f = await fixture({ agentic: true });
  try {
    assert.equal((await f.api("mission.configure", { enabled: true })).status, 200);
    const device = await f.pair();
    const projectId = (await f.api("project.add", { name: "Narrowed Project", path: f.root })).body.data!.id;
    const created = await f.api("agent.create", { projectId, name: "Narrowed phone", objective: "Read then write", steps: [op("Inspect", "filesystem.read", { path: "seed.txt" }), op("Write", "filesystem.write", { path: "result.txt", content: "phone", overwrite: true }, [0])] });
    assert.equal(created.status, 200, created.body.error);
    const agentId = created.body.agents!.agents.find((a) => a.name === "Narrowed phone")!.id;
    const proposed = (await f.api("agent.authorization.propose", { id: agentId })).body.agents!.agents.find((a) => a.id === agentId)!.authorization!;
    // The owner narrows consent so filesystem.write is no longer in scope; the write then asks, and only the workstation may answer it.
    const narrowed = (await f.api("agent.authorization.adjust", { id: agentId, revision: proposed.revision, patch: { capabilities: proposed.capabilities.filter((c) => c !== "filesystem.write") } })).body.agents!.agents.find((a) => a.id === agentId)!.authorization!;
    assert.equal((await f.api("agent.authorization.approve", { id: agentId, revision: narrowed.revision })).status, 200);
    const waiting = await until(async () => (await f.state(device.token)).body.agents.agents.find((a) => a.id === agentId && a.authorization?.pending.length), "out-of-scope write ask");
    const ask = waiting.authorization!.pending[0];
    assert.equal(ask.action, "filesystem.write");
    assert.equal(ask.remote?.answerable, false, "an out-of-scope write is not answerable by a device");
    const answered = await f.api("mission.respond", { requestId: ask.id, decision: "allow_once" }, device.token);
    assert.equal(answered.status, 400);
    assert.equal(answered.body.code, "WORKSTATION_REQUIRED");
    assert.match(answered.body.error!, /outside the Agent's current permissions/);
    const missionId = waiting.missionId!;
    assert.equal(f.host.missions.staging.forMission(missionId).length, 0, "nothing was staged");
    assert.equal(existsSync(join(f.root, "result.txt")), false, "the project file never landed");
  } finally {
    await f.close();
  }
});

test("T9 F19/F20/F23: always-ask risks stay on the Windows Host; remote Deny persists; remote Stop blocks admissions", async () => {
  const f = await fixture({ agentic: true });
  try {
    await f.api("mission.configure", { enabled: true });
    const device = await f.pair();
    const created = await f.api("agent.create", { name: "Destructive boundary", objective: "Read then delete", steps: [op("Inspect", "filesystem.read", { path: "seed.txt" }), op("Delete", "filesystem.delete", { path: "seed.txt" }, [0])] });
    const agentId = created.body.agents!.agents.find((a) => a.name === "Destructive boundary")!.id;
    const proposed = (await f.api("agent.authorization.propose", { id: agentId })).body.agents!.agents.find((a) => a.id === agentId)!.authorization!;
    assert.equal((await f.api("agent.authorization.approve", { id: agentId, revision: proposed.revision })).status, 200);
    const waiting = await until(async () => (await f.state(device.token)).body.agents.agents.find((a) => a.id === agentId && a.authorization?.pending.length), "delete ask");
    const ask = waiting.authorization!.pending[0];
    assert.equal(ask.risk, "DESTRUCTIVE");
    assert.equal(ask.remote?.answerable, false);
    assert.equal(ask.remote?.reason, "Approval required on Windows Host.");
    const allow = await f.api("mission.respond", { requestId: ask.id, decision: "allow_once" }, device.token);
    assert.equal(allow.body.code, "WORKSTATION_REQUIRED");
    assert.equal(allow.body.error, "Approval required on Windows Host.");
    const batch = await f.api("mission.respond", { requestId: ask.id, decision: "allow_batch" }, device.token);
    assert.equal(batch.body.code, "WORKSTATION_REQUIRED");
    assert.equal(readFileSync(join(f.root, "seed.txt"), "utf8"), "seed");
    assert.equal((await f.api("mission.respond", { requestId: ask.id, decision: "deny" }, device.token)).status, 200, "Deny is never limited");
    const denied = await until(async () => (await f.state()).body.agents.agents.find((a) => a.id === agentId && ["FAILED", "STOPPED", "COMPLETED"].includes(a.state)), "denial ends the step");
    assert.ok(denied);
    assert.equal(readFileSync(join(f.root, "seed.txt"), "utf8"), "seed", "F20: the denied effect never happened");
    // F23: Stop from the device on a second, running Agent blocks every later admission.
    const second = await f.api("agent.create", { name: "Stop me", objective: "Read twice", steps: [op("One", "filesystem.read", { path: "seed.txt" }), op("Two", "filesystem.read", { path: "seed.txt" }, [0])] });
    assert.equal(second.status, 200, second.body.error);
    const secondId = second.body.agents!.agents.find((a) => a.name === "Stop me")!.id;
    const offer = (await f.api("agent.authorization.propose", { id: secondId })).body.agents!.agents.find((a) => a.id === secondId)!.authorization!;
    assert.equal((await f.api("agent.authorization.approve", { id: secondId, revision: offer.revision })).status, 200);
    const stop = await f.api("agent.stop", { id: secondId }, device.token);
    assert.equal(stop.status, 200, stop.body.error);
    const stopped = (await f.state()).body.agents.agents.find((a) => a.id === secondId)!;
    assert.equal(stopped.state, "STOPPED");
    const resumeAfterStop = await f.api("agent.resume", { id: secondId, revision: stopped.authorization?.revision ?? 0 }, device.token);
    assert.equal(resumeAfterStop.status, 400, "a stopped Agent is never resurrected");
  } finally {
    await f.close();
  }
});

test("T9 device projection: bounded, path-free and transcript-free", async () => {
  const f = await fixture();
  try {
    const device = await f.pair();
    for (let i = 0; i < 3; i++) await f.api("submit", { prompt: `Task ${i}`, mode: "fast", override: "ollama" });
    const task = f.host.manager.snapshot(0).tasks[0];
    f.host.manager.update(task, { output: "T9_PRIVATE_TRANSCRIPT_SENTINEL" }, "agent.output", "T9_PRIVATE_TRANSCRIPT_SENTINEL");
    const view = (await f.state(device.token)).body;
    assert.ok(!JSON.stringify(view).includes("T9_PRIVATE_TRANSCRIPT_SENTINEL"), "redaction is enforced at the Host, before the gateway");
    const stopped = await f.api("stop", { id: task.id }, device.token);
    assert.ok(!JSON.stringify(stopped.body).includes("T9_PRIVATE_TRANSCRIPT_SENTINEL"), "command extras cannot bypass snapshot redaction");
    const stream = await f.stream(device.token);
    const replay = await stream.body!.getReader().read();
    assert.ok(!new TextDecoder().decode(replay.value).includes("T9_PRIVATE_TRANSCRIPT_SENTINEL"), "direct device SSE contains no private transcript");
    for (const task of view.tasks) {
      assert.equal(task.cwd, undefined);
      assert.equal(task.pid ?? null, null);
      assert.equal(task.processTree ?? null, null);
    }
    for (const provider of view.providers) {
      assert.equal(provider.executable ?? null, null);
      assert.deepEqual(provider.evidence ?? [], []);
    }
    assert.equal(hidePaths("stat 'C:\\Users\\owner\\secret.txt' failed"), "stat '[Host path]' failed");
    assert.equal(hidePaths("open /home/owner/x failed"), "open [Host path] failed");
  } finally {
    await f.close();
  }
});

test("T9 ledger and limiter units: bounded, per-principal, expiring", () => {
  const ledger = new OperationLedger(1000, 3, 2);
  ledger.begin("device:a", "op-00000001", "agent.stop", 0);
  ledger.finish("device:a", "op-00000001", { state: "applied", status: 200 }, 0);
  assert.equal(ledger.get("device:a", "op-00000001", 10)?.state, "applied");
  assert.equal(ledger.get("device:b", "op-00000001", 10), null, "outcomes are per principal");
  assert.equal(ledger.get("device:a", "op-00000001", 2000), null, "outcomes expire");
  ledger.begin("device:a", "op-00000002", "agent.stop", 3000);
  ledger.finish("device:a", "op-00000002", { state: "applied" }, 3000);
  ledger.begin("device:a", "op-00000003", "agent.stop", 3001);
  ledger.finish("device:a", "op-00000003", { state: "applied" }, 3001);
  ledger.begin("device:a", "op-00000004", "agent.stop", 3002);
  assert.equal(ledger.get("device:a", "op-00000002", 3003), null, "the per-principal bound evicts the oldest finished entry");
  assert.equal(ledger.get("device:a", "op-00000004", 3003)?.state, "in_progress", "an in-progress entry is never evicted");
  const limiter = new WindowLimiter(2, 1000);
  assert.equal(limiter.take("a", 0), null);
  assert.equal(limiter.take("a", 1), null);
  assert.equal(limiter.take("a", 2), 998);
  assert.equal(limiter.take("a", 1001), null, "a new window admits again");
});

test("T9 F17/G7: Mission approvals bind to the reviewed plan; Agent Missions never start as bare Missions remotely", async () => {
  const f = await fixture({ agentic: true });
  try {
    await f.api("mission.configure", { enabled: true });
    const device = await f.pair();
    const readPlan = [op("Inspect", "filesystem.read", { path: "seed.txt" })];
    const first = (await f.api("mission.create", { objective: "Read only", mode: "fast", steps: readPlan })).body.mission as unknown as { id: string };
    const second = (await f.api("mission.create", { objective: "Read only again", mode: "fast", steps: [op("Inspect again", "filesystem.read", { path: "seed.txt" })] })).body.mission as unknown as { id: string };
    const view = (await f.state(device.token)).body as unknown as { missions: { missions: { id: string; planReference?: string; remote?: { answerable: boolean } }[] } };
    const firstView = view.missions.missions.find((m) => m.id === first.id)!;
    const secondView = view.missions.missions.find((m) => m.id === second.id)!;
    assert.ok(firstView.planReference && firstView.remote?.answerable, "a read-only plan is answerable remotely");
    const substituted = await f.api("mission.approve", { id: second.id, start: false, plan: firstView.planReference }, device.token);
    assert.equal(substituted.status, 400);
    assert.match(substituted.body.error!, /plan changed/, "another Mission's reviewed plan never approves this one");
    const approved = await f.api("mission.approve", { id: second.id, start: false, plan: secondView.planReference }, device.token);
    assert.equal(approved.status, 200, approved.body.error);
    // A plan containing an always-ask capability needs the Windows Host.
    const destructive = (await f.api("mission.create", { objective: "Delete", mode: "fast", steps: [op("Delete", "filesystem.delete", { path: "seed.txt" })] })).body.mission as unknown as { id: string };
    const refused = await f.api("mission.approve", { id: destructive.id, start: false }, device.token);
    assert.equal(refused.body.code, "WORKSTATION_REQUIRED");
    const destructiveView = ((await f.state(device.token)).body as unknown as typeof view).missions.missions.find((m) => m.id === destructive.id)!;
    assert.equal(destructiveView.remote?.answerable, false);
    // G7: an Agent's Mission cannot be approved or started through mission.* from a device.
    const agent = (await f.api("agent.create", { name: "Owned", objective: "Read", steps: readPlan })).body.agents!.agents.find((a) => a.name === "Owned")!;
    assert.equal((await f.api("mission.approve", { id: agent.missionId, start: false }, device.token)).body.code, "WORKSTATION_REQUIRED");
    assert.equal((await f.api("mission.start", { id: agent.missionId }, device.token)).status, 400);
  } finally {
    await f.close();
  }
});

test("T9 launch rule: only local tool-free inference may be launched by a paired device", async () => {
  const { deviceMayLaunch } = await import("./device-authority.server.ts");
  assert.equal(deviceMayLaunch({ provider: "ollama", model: "llama3.2:3b" }), true);
  assert.equal(deviceMayLaunch({ provider: "ollama", model: "gpt-oss:120b-cloud" }), false);
  assert.equal(deviceMayLaunch({ provider: "ollama", model: "qwen3-coder:480b-cloud" }), false);
  for (const provider of ["claude", "codex", "opencode", "cline", "cursor"] as const)
    assert.equal(deviceMayLaunch({ provider, model: "any" }), false, provider);
});

test("T9 revocation race: a delayed body cannot retain the authority authenticated before revocation", async () => {
  const f = await fixture();
  try {
    const device = await f.pair();
    const body = JSON.stringify({ action: "submit", data: { prompt: "Never admitted", mode: "fast" } });
    const result = new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = httpRequest(`${f.base}/command`, { method: "POST", headers: { authorization: `Bearer ${device.token}`, "content-type": "application/json", "content-length": Buffer.byteLength(body) } }, (res) => {
        let text = "";
        res.on("data", (chunk) => text += chunk);
        res.on("end", () => resolve({ status: res.statusCode!, body: text }));
      });
      req.on("error", reject);
      req.write(body.slice(0, 10));
      setTimeout(async () => {
        try {
          assert.equal((await f.api("device.revoke", { id: device.deviceId })).status, 200);
          req.end(body.slice(10));
        } catch (error) { req.destroy(); reject(error); }
      }, 50);
    });
    const response = await result;
    assert.equal(response.status, 401);
    assert.equal(JSON.parse(response.body).code, "DEVICE_REVOKED");
    assert.equal((await f.state()).body.tasks.length, 0);
  } finally { await f.close(); }
});

test("T9 operation ledger bounds include in-progress commands without evicting them", () => {
  const ledger = new OperationLedger(1000, 2, 1);
  ledger.begin("device:a", "op-active-a", "agent.stop", 0);
  assert.throws(() => ledger.begin("device:a", "op-active-b", "agent.stop", 1), /still being confirmed/);
  ledger.begin("device:b", "op-active-b", "agent.stop", 1);
  assert.throws(() => ledger.begin("device:c", "op-active-c", "agent.stop", 2), /still being confirmed/);
  assert.equal(ledger.entries.size, 2);
});
