import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startHost } from "./http.server.ts";
import { FilesystemCapability } from "../bunny-missions/capabilities/local.server.ts";
import type { AgentSnapshot } from "./agent-types.ts";
import type { ExecutionContext } from "../bunny-missions/capabilities/bus.server.ts";
type Agent = AgentSnapshot["agents"][number];

function record(name: string, value: unknown) {
  const directory = resolve("test-results/ma3/t9r/remote-canonical");
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, `${name}.json`), JSON.stringify(value, null, 2) + "\n");
}
async function until<T>(check: () => Promise<T | false | undefined>, label: string): Promise<T> {
  const deadline = Date.now() + 15000;
  do { const result = await check(); if (result) return result; await new Promise(resolve => setTimeout(resolve, 25)); } while (Date.now() < deadline);
  throw new Error(`Timed out: ${label}`);
}
async function fixture(filesystem = new FilesystemCapability()) {
  const directory = mkdtempSync(join(tmpdir(), "bunny-t9r-remote-"));
  const root = join(directory, "project-a"), otherRoot = join(directory, "project-b");
  for (const path of [root, otherRoot]) { mkdirSync(path); writeFileSync(join(path, "seed.txt"), "seed"); }
  const boot = async () => {
    const socket = createServer();
    await new Promise<void>(resolve => socket.listen(0, "127.0.0.1", resolve));
    const port = (socket.address() as { port: number }).port;
    await new Promise<void>(resolve => socket.close(() => resolve()));
    const started = await startHost({ dataDirectory: directory, root, workspaceRoot: root, port, adapters: [], missions: { adapters: [filesystem] }, sample: async () => ({ at: Date.now(), cpu: { utilization: null, clockMhz: null, temperatureC: null }, memory: { usedBytes: 0, availableBytes: 1, totalBytes: 1 }, gpus: [], notes: ["T9R disposable"] }) });
    await started.missions.bus.refreshHealth();
    return { started, base: `http://127.0.0.1:${port}` };
  };
  let { started: host, base } = await boot();
  const api = async (action: string, data: unknown = {}, token = host.token, extra: Record<string, unknown> = {}) => {
    const response = await fetch(`${base}/command`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ action, data, ...extra }) });
    // Credentials stay in memory; evidence never serializes the response to pairing.create or /pair.
    return { status: response.status, body: await response.json() };
  };
  const state = async (token = host.token) => {
    const response = await fetch(`${base}/state`, { headers: { authorization: `Bearer ${token}` } });
    return { status: response.status, body: await response.json() };
  };
  const pair = async (name = "T9R disposable client") => {
    const code = (await api("pairing.create")).body.pairCode;
    const paired = await fetch(`${base}/pair`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, name }) });
    assert.equal(paired.status, 200);
    return await paired.json() as { token: string; deviceId: string };
  };
  const device = await pair();
  assert.equal((await api("mission.configure", { enabled: true })).status, 200);
  const projectA: string = (await api("project.add", { name: "Project A", path: root })).body.data.id;
  const projectB: string = (await api("project.add", { name: "Project B", path: otherRoot })).body.data.id;
  const make = async (name: string, projectId = projectA) => {
    const step = (action: string, params: Record<string, unknown>, dependsOn: number[] = []) => ({ role: action === "filesystem.read" ? "Inspect" : "Write", objective: "Verify the bounded receipt", access: action === "filesystem.read" ? "read" : "write", executor: { kind: "capability", action, params }, crossApp: true, dependsOn, verification: [{ kind: "capability", action: "filesystem.compare", params: { path: action === "filesystem.read" ? "seed.txt" : "receipt.txt", content: action === "filesystem.read" ? "seed" : name }, expect: { field: "matches", equals: true } }] });
    const created = await api("agent.create", { projectId, name, objective: "Read and verify a bounded receipt", steps: [step("filesystem.read", { path: "seed.txt" }), step("filesystem.write", { path: "receipt.txt", content: name }, [0])] });
    assert.equal(created.status, 200, created.body.error);
    const agent: Agent = created.body.agents.agents.find((a: Agent) => a.name === name);
    const proposed = await api("agent.authorization.propose", { id: agent.id });
    if (proposed.status !== 200) { record("fixture-diagnostic", host.missions.get(agent.missionId!)); host.missions.proposeAgentAuthorization(agent.id); }
    assert.equal(proposed.status, 200, proposed.body.error);
    let offer = proposed.body.agents.agents.find((a: Agent) => a.id === agent.id).authorization;
    const adjusted = await api("agent.authorization.adjust", { id: agent.id, revision: offer.revision, patch: { capabilities: offer.capabilities.filter((c: string) => c !== "filesystem.write") } });
    assert.equal(adjusted.status, 200, adjusted.body.error);
    offer = adjusted.body.agents.agents.find((a: Agent) => a.id === agent.id).authorization;
    assert.equal((await api("agent.authorization.approve", { id: agent.id, revision: offer.revision })).status, 200);
    const waiting: Agent = await until(async () => (await state()).body.agents.agents.find((a: Agent) => a.id === agent.id && a.authorization?.pending.length), "canonical write request");
    return { agent: waiting, request: waiting.authorization!.pending[0] };
  };
  // A real Host shutdown and fresh Host instance over the same SQLite state (new epoch, same Host UUID).
  const restart = async () => { await host.close(); ({ started: host, base } = await boot()); };
  const close = async () => { await host.close(); rmSync(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 }); };
  return { directory, root, otherRoot, get host() { return host; }, get base() { return base; }, device, projectA, projectB, api, state, make, pair, restart, close };
}

for (const binding of ["agentId", "missionId", "projectId"] as const) {
  test(`T9R remote approval cannot substitute ${binding} across canonical offers`, async () => {
    const f = await fixture();
    try {
      const a = await f.make("Agent A"), b = await f.make("Agent B", f.projectB);
      const substituted = binding === "agentId" ? b.agent.id : binding === "missionId" ? b.agent.missionId : f.projectB;
      const forged = await f.api("mission.respond", { requestId: a.request.id, decision: "allow_once", [binding]: substituted }, f.device.token);
      assert.equal(forged.status, 400);
      assert.match(forged.body.error, /exact Host request/);
      for (const offer of [a, b]) assert.equal(f.host.missions.store.request(offer.request.id)!.resolvedAt, null, "neither canonical request was resolved");
      assert.equal(existsSync(join(f.root, "receipt.txt")), false);
      assert.equal(existsSync(join(f.otherRoot, "receipt.txt")), false);
      // Also attempt to replay A's genuine envelope at B's Capability Bus admission boundary.
      const step = f.host.missions.store.steps(b.agent.missionId!).find(step => step.executor.kind === "capability" && step.executor.action === "filesystem.write")!;
      const before = f.host.missions.agentic.rows(f.host.missions.agentic.forMission(a.agent.missionId!)!.id).length;
      const wrong = await f.host.missions.bus.request({ action: "filesystem.write", params: { path: "receipt.txt", content: "forged" }, missionId: b.agent.missionId!, stepId: step.id, envelope: f.host.missions.currentAgenticCanonical(a.agent.missionId!), cwd: f.otherRoot, roots: [f.otherRoot], origin: "t9r-adversarial" });
      assert.notEqual(wrong.decision.decision, "allow");
      assert.equal(f.host.missions.agentic.rows(f.host.missions.agentic.forMission(a.agent.missionId!)!.id).length, before);
      assert.equal(existsSync(join(f.otherRoot, "receipt.txt")), false);
      assert.equal((await f.api("mission.respond", { requestId: a.request.id, decision: "allow_once" }, f.device.token)).status, 200);
      await until(async () => existsSync(join(f.root, "receipt.txt")), "authorized A effect");
      assert.equal(readFileSync(join(f.root, "receipt.txt"), "utf8"), "Agent A");
      assert.equal(existsSync(join(f.otherRoot, "receipt.txt")), false, "A consent does not authorize B's resource");
      record(`cross-${binding}`, { classification: "LIVE disposable Host HTTP and Capability Bus", forgedStatus: forged.status, code: forged.body.code, busDecision: wrong.decision, requestA: a.request.id, requestB: b.request.id, authorizedAReceipt: true, projectBUnchanged: true });
    } finally { await f.close(); }
  });
}

test("T9R offline approval is refused after reconnect; only the new Host offer can execute", async () => {
  const f = await fixture();
  try {
    const a = await f.make("Offline receipt");
    const reviewed = (await f.state(f.device.token)).body;
    const operationId = randomUUID();
    assert.equal((await f.api("agent.pause", { id: a.agent.id })).status, 200);
    const paused: Agent = (await f.state()).body.agents.agents.find((agent: Agent) => agent.id === a.agent.id);
    assert.equal((await f.api("agent.resume", { id: a.agent.id, revision: paused.authorization!.revision })).status, 200);
    const fresh: Agent = await until(async () => (await f.state(f.device.token)).body.agents.agents.find((agent: Agent) => agent.id === a.agent.id && agent.authorization?.pending[0]?.id !== a.request.id && agent.authorization?.pending.length), "reissued offer on reconnect");
    assert.equal(existsSync(join(f.root, "receipt.txt")), false, "reconnection/read never auto-applies saved approval");
    const stale = await f.api("mission.respond", { requestId: a.request.id, decision: "allow_once" }, f.device.token, { operationId, expect: reviewed.hostIdentity });
    assert.equal(stale.status, 400); assert.equal(stale.body.code, "REFUSED");
    const replay = await f.api("mission.respond", { requestId: a.request.id, decision: "allow_once" }, f.device.token, { operationId, expect: reviewed.hostIdentity });
    assert.equal(replay.status, 400); assert.equal(replay.body.operation.replayed, true);
    assert.equal(existsSync(join(f.root, "receipt.txt")), false);
    assert.equal((await f.api("mission.respond", { requestId: fresh.authorization!.pending[0].id, decision: "allow_once" }, f.device.token)).status, 200);
    await until(async () => existsSync(join(f.root, "receipt.txt")), "fresh reviewed approval executes");
    record("offline-replay", { classification: "LIVE canonical admission; SIMULATED offline holding of a client payload", staleCode: stale.body.code, duplicateRejected: replay.body.operation.replayed, oldRequest: a.request.id, newRequest: fresh.authorization!.pending[0].id, automaticReplay: false, verifiedReceipt: readFileSync(join(f.root, "receipt.txt"), "utf8") });
  } finally { await f.close(); }
});

test("T9R concurrent desktop and phone approval has one canonical winner and one effect", async () => {
  const f = await fixture();
  try {
    const a = await f.make("Single effect");
    const responses = await Promise.all([f.api("mission.respond", { requestId: a.request.id, decision: "allow_once" }), f.api("mission.respond", { requestId: a.request.id, decision: "deny" }, f.device.token)]);
    assert.equal(responses.filter(r => r.status === 200).length, 1);
    assert.equal(responses.filter(r => r.status === 400).length, 1);
    const request = f.host.missions.store.request(a.request.id)!;
    await until(async () => { const agent: Agent = (await f.state()).body.agents.agents.find((agent: Agent) => agent.id === a.agent.id); return ["COMPLETED", "FAILED", "STOPPED"].includes(agent.state) && agent; }, "canonical race settles");
    const writes = f.host.missions.store.runs({ missionId: a.agent.missionId! }).filter(run => run.action === "filesystem.write" && run.status === "succeeded");
    assert.equal(writes.length, request.resolution === "allow_once" ? 1 : 0);
    record("concurrent-resolution", { classification: "LIVE concurrent real Host commands", statuses: responses.map(r => r.status), resolution: request.resolution, resolvedBy: request.resolvedBy, successfulWrites: writes.length });
  } finally { await f.close(); }
});

class HeldFilesystem extends FilesystemCapability {
  release!: () => void;
  entered: Promise<void>;
  private mark!: () => void;
  private barrier: Promise<void>;
  constructor() { super(); this.entered = new Promise(resolve => { this.mark = resolve; }); this.barrier = new Promise(resolve => { this.release = resolve; }); }
  override async execute(action: string, params: Record<string, unknown>, context: ExecutionContext) {
    if (action === "filesystem.write") { this.mark(); await this.barrier; context.signal.throwIfAborted(); }
    return super.execute(action, params, context);
  }
}

test("T9R client-only connection loss during admitted work leaves the same Host Agent completing once", async () => {
  const fs = new HeldFilesystem(), f = await fixture(fs);
  const controller = new AbortController();
  try {
    const a = await f.make("Client disconnect receipt");
    const stream = await fetch(`${f.base}/events`, { headers: { authorization: `Bearer ${f.device.token}` }, signal: controller.signal });
    assert.equal(stream.status, 200);
    assert.equal((await f.api("mission.respond", { requestId: a.request.id, decision: "allow_once" }, f.device.token)).status, 200);
    await fs.entered;
    const epoch = (await f.state()).body.hostIdentity.epoch;
    controller.abort(); // Only this paired client's transport is closed; Host stays up.
    fs.release();
    const done: Agent = await until(async () => (await f.state()).body.agents.agents.find((agent: Agent) => agent.id === a.agent.id && agent.state === "COMPLETED"), "Host completion after client connection loss");
    assert.equal(done.missionId, a.agent.missionId);
    assert.equal(readFileSync(join(f.root, "receipt.txt"), "utf8"), "Client disconnect receipt");
    const reconnected = (await f.state(f.device.token)).body;
    assert.equal(reconnected.hostIdentity.epoch, epoch, "no Host restart substituted for client loss");
    assert.equal(reconnected.agents.agents.filter((agent: Agent) => agent.id === a.agent.id).length, 1);
    assert.equal(f.host.missions.store.runs({ missionId: a.agent.missionId! }).filter(run => run.action === "filesystem.write" && run.status === "succeeded").length, 1);
    record("client-only-disconnect", { classification: "LIVE client SSE socket closure and real Host filesystem; SIMULATED deterministic scheduling barrier", sameHostEpoch: true, agentId: done.id, missionId: done.missionId, state: done.state, writes: 1, reconnected: true, physicalPhone: "NOT TESTED" });
  } finally { controller.abort(); fs.release(); await f.close(); }
});

type MissionRow = { id: string; state: string; planReference?: string; remote?: { answerable: boolean; reason: string | null }; requestedScope?: { providers: { sessions?: { writeIncludesShell: boolean } } }; artifacts: { id: string }[] };
type Fixture = Awaited<ReturnType<typeof fixture>>;
const modelStep = (role: string, access: "read" | "write") => ({ role, objective: role, access, executor: { kind: "model" }, dependsOn: [], verification: [] });
const readStep = (role: string) => ({ role, objective: role, access: "read", executor: { kind: "capability", action: "filesystem.read", params: { path: "seed.txt" } }, dependsOn: [], verification: [] });
async function plainMission(f: Fixture, objective: string, steps: unknown[]) {
  const created = await f.api("mission.create", { objective, mode: "fast", steps });
  assert.equal(created.status, 200, created.body.error);
  return created.body.mission.id as string;
}
async function missionRow(f: Fixture, id: string, token?: string): Promise<MissionRow> {
  return (await f.state(token)).body.missions.missions.find((m: MissionRow) => m.id === id);
}
const HOST_PATH = /(?<![A-Za-z0-9])[A-Za-z]:(?:\\\\|\/)/;

test("T9R F-01: a paired device cannot approve a Mission that launches a write-scoped (shell) provider session", async () => {
  const f = await fixture();
  try {
    const write = await plainMission(f, "Edit with a provider session", [modelStep("Edit", "write")]);
    const read = await plainMission(f, "Read with a provider session", [modelStep("Inspect", "read")]);
    const writeView = await missionRow(f, write, f.device.token), readView = await missionRow(f, read, f.device.token);
    assert.equal(writeView.requestedScope!.providers.sessions!.writeIncludesShell, true);
    assert.equal(writeView.remote!.answerable, false, "the Host verdict tells the phone before it tries");
    assert.equal(readView.remote!.answerable, true, "a read-only provider session stays answerable remotely");
    const refused = await f.api("mission.approve", { id: write, start: false, plan: writeView.planReference }, f.device.token);
    assert.equal(refused.status, 400);
    assert.equal(refused.body.code, "WORKSTATION_REQUIRED");
    const after = f.host.missions.store.mission(write);
    assert.equal(after.state, "waiting_for_approval");
    assert.ok(!after.authorizationId, "no envelope was granted");
    assert.equal((await f.api("mission.approve", { id: read, start: false, plan: readView.planReference }, f.device.token)).status, 200);
    const owner = await f.api("mission.approve", { id: write, start: false });
    assert.equal(owner.status, 200, owner.body.error);
    assert.equal(f.host.missions.store.authorization(f.host.missions.store.mission(write).authorizationId!)!.grantedBy, "workstation");
    record("f01-write-session-approval", { classification: "LIVE disposable Host HTTP and MissionManager", deviceCode: refused.body.code, remoteVerdict: writeView.remote, readOnlyVerdict: readView.remote, workstationApproved: true });
  } finally { await f.close(); }
});

test("T9R F-03: a device approval must name the reviewed plan; a replanned scope is never approved unseen", async () => {
  const f = await fixture();
  try {
    const id = await plainMission(f, "Read the seed", [readStep("Inspect")]);
    const reviewed = await missionRow(f, id, f.device.token);
    const unbound = await f.api("mission.approve", { id, start: false }, f.device.token);
    assert.equal(unbound.status, 400);
    assert.equal(unbound.body.code, "REFUSED");
    assert.match(unbound.body.error, /reviewed plan/);
    assert.equal(f.host.missions.store.mission(id).state, "waiting_for_approval");
    const replanned = await f.api("mission.replan", { id, steps: [readStep("Inspect"), { ...readStep("Inspect again"), dependsOn: [0] }] });
    assert.equal(replanned.status, 200, replanned.body.error);
    const current = await missionRow(f, id, f.device.token);
    assert.notEqual(current.planReference, reviewed.planReference);
    const stale = await f.api("mission.approve", { id, start: false, plan: reviewed.planReference }, f.device.token);
    assert.equal(stale.status, 400);
    assert.match(stale.body.error, /plan changed/);
    assert.equal(f.host.missions.store.mission(id).state, "waiting_for_approval");
    const fresh = await f.api("mission.approve", { id, start: false, plan: current.planReference }, f.device.token);
    assert.equal(fresh.status, 200, fresh.body.error);
    record("f03-plan-binding", { classification: "LIVE disposable Host HTTP and MissionManager", unboundCode: unbound.body.code, staleRefused: true, freshApproved: true });
  } finally { await f.close(); }
});

test("T9R F-02: workstation revocation ends Mission approvals the lost device granted; other grants and self sign-out keep theirs", async () => {
  const f = await fixture();
  try {
    const approveAs = async (token: string | undefined, objective: string) => {
      const id = await plainMission(f, objective, [readStep("Inspect")]);
      const view = await missionRow(f, id, token);
      const approved = await f.api("mission.approve", { id, start: false, ...(token ? { plan: view.planReference } : {}) }, token);
      assert.equal(approved.status, 200, approved.body.error);
      assert.equal(f.host.missions.store.mission(id).state, "ready");
      return id;
    };
    const lost = await approveAs(f.device.token, "Approved by the lost phone");
    const owner = await approveAs(undefined, "Approved on the workstation");
    const other = await f.pair("Second phone");
    const signedOut = await approveAs(other.token, "Approved by a phone that signs itself out");
    const envelope = (id: string) => f.host.missions.store.authorization(f.host.missions.store.mission(id).authorizationId!)!;
    assert.equal(envelope(lost).grantedBy, `device:${f.device.deviceId}`);
    const revoked = await f.api("device.revoke", { id: f.device.deviceId });
    assert.equal(revoked.status, 200, revoked.body.error);
    assert.ok(envelope(lost).revokedAt, "the lost device's Mission approval is revoked");
    assert.equal(f.host.missions.store.mission(lost).state, "stopped");
    assert.equal((await f.api("mission.start", { id: lost })).status, 400, "a revoked approval can never start");
    assert.equal(envelope(owner).revokedAt, null);
    assert.equal(f.host.missions.store.mission(owner).state, "ready");
    assert.equal((await f.api("device.revoke", {}, other.token)).status, 200, "self sign-out");
    assert.equal(envelope(signedOut).revokedAt, null, "self sign-out keeps the approvals the user gave (documented design)");
    assert.equal(f.host.missions.store.mission(signedOut).state, "ready");
    assert.equal((await f.state(f.device.token)).status, 401);
    record("f02-revocation-ends-approvals", { classification: "LIVE disposable Host HTTP, SQLite and MissionManager", lostDeviceMission: f.host.missions.store.mission(lost).state, envelopeRevoked: true, workstationMission: "ready", selfSignOutMission: "ready" });
  } finally { await f.close(); }
});

test("T9R T-01: every device response is free of Host folder paths; the workstation keeps them", async () => {
  const { hostPathFree } = await import("./device-authority.server.ts");
  assert.equal(hostPathFree("C:\\Program Files\\Owner Projects\\x"), "[Host path]", "a whole path with spaces leaves nothing");
  assert.equal(hostPathFree("result.txt in C:\\Users\\owner\\project-a"), "result.txt in [Host path]");
  assert.equal(hostPathFree("http://127.0.0.1:51622/page"), "http://127.0.0.1:51622/page", "origins survive");
  assert.deepEqual(hostPathFree({ roots: ["/home/owner/x"], n: 3, ok: true, none: null }), { roots: ["[Host path]"], n: 3, ok: true, none: null });
  const f = await fixture();
  const controller = new AbortController();
  try {
    const a = await f.make("Path free receipt");
    await plainMission(f, "Read the seed", [readStep("Inspect")]);
    const workstation = JSON.stringify((await f.state()).body);
    assert.match(workstation, HOST_PATH, "positive control: the workstation view carries folder paths");
    const responses: Record<string, unknown> = {
      state: (await f.state(f.device.token)).body,
      projectList: (await f.api("project.list", {}, f.device.token)).body,
      projectGet: (await f.api("project.get", { id: f.projectA }, f.device.token)).body,
      missionGet: (await f.api("mission.get", { id: a.agent.missionId }, f.device.token)).body,
      agentGet: (await f.api("agent.get", { id: a.agent.id }, f.device.token)).body,
      refusal: (await f.api("project.get", { id: "missing-project" }, f.device.token)).body,
    };
    for (const [name, body] of Object.entries(responses)) assert.doesNotMatch(JSON.stringify(body), HOST_PATH, name);
    const stream = await fetch(`${f.base}/events?after=0`, { headers: { authorization: `Bearer ${f.device.token}` }, signal: controller.signal });
    const reader = stream.body!.getReader();
    let events = "";
    const deadline = Date.now() + 1500;
    while (Date.now() < deadline && events.length < 200_000) {
      const chunk = await Promise.race([reader.read(), new Promise<null>(resolve => setTimeout(() => resolve(null), 300))]);
      if (!chunk || chunk.done) break;
      events += new TextDecoder().decode(chunk.value);
    }
    assert.match(events, /^id: \d+/m, "the stream delivered events");
    assert.doesNotMatch(events, HOST_PATH, "events");
    record("t01-device-path-free", { classification: "LIVE disposable Host HTTP and SSE", checked: [...Object.keys(responses), "events"], workstationHasPaths: true, deviceHasPaths: false });
  } finally { controller.abort(); await f.close(); }
});

test("T9R lost command acknowledgment: applied phone approval and Pause/Stop replay by operation id with one effect", async () => {
  const f = await fixture();
  try {
    const a = await f.make("Lost acknowledgment receipt");
    const expect = (await f.state(f.device.token)).body.hostIdentity;
    const operationId = randomUUID();
    const first = await f.api("mission.respond", { requestId: a.request.id, decision: "allow_once" }, f.device.token, { operationId, expect });
    assert.equal(first.status, 200, first.body.error);
    assert.deepEqual(first.body.operation, { id: operationId, state: "applied", replayed: false });
    // The phone lost that receipt: it reconciles by operation id, then resends the same operation.
    const status = (await f.api("operation.status", { operationId }, f.device.token)).body.data;
    assert.equal(status.state, "applied");
    assert.equal(status.action, "mission.respond");
    const replay = await f.api("mission.respond", { requestId: a.request.id, decision: "allow_once" }, f.device.token, { operationId, expect });
    assert.equal(replay.status, 200);
    assert.deepEqual(replay.body.operation, { id: operationId, state: "applied", replayed: true });
    await until(async () => (await f.state()).body.agents.agents.find((agent: Agent) => agent.id === a.agent.id && agent.state === "COMPLETED"), "approved Agent completes");
    assert.equal(f.host.missions.store.runs({ missionId: a.agent.missionId! }).filter(run => run.action === "filesystem.write" && run.status === "succeeded").length, 1);
    const b = await f.make("Supervised receipt");
    const pauseId = randomUUID();
    const paused = await f.api("agent.pause", { id: b.agent.id }, f.device.token, { operationId: pauseId, expect });
    assert.equal(paused.status, 200, paused.body.error);
    const pausedAt = f.host.agents.store.agent(b.agent.id)!.pausedAt;
    assert.ok(pausedAt);
    const pauseReplay = await f.api("agent.pause", { id: b.agent.id }, f.device.token, { operationId: pauseId, expect });
    assert.equal(pauseReplay.body.operation.replayed, true);
    assert.equal(f.host.agents.store.agent(b.agent.id)!.pausedAt, pausedAt, "the replay did not pause again");
    const stopId = randomUUID();
    assert.equal((await f.api("agent.stop", { id: b.agent.id }, f.device.token, { operationId: stopId, expect })).status, 200);
    const stoppedAt = f.host.agents.store.agent(b.agent.id)!.stoppedAt;
    assert.ok(stoppedAt);
    const stopReplay = await f.api("agent.stop", { id: b.agent.id }, f.device.token, { operationId: stopId, expect });
    assert.equal(stopReplay.status, 200);
    assert.equal(stopReplay.body.operation.replayed, true);
    assert.equal(f.host.agents.store.agent(b.agent.id)!.stoppedAt, stoppedAt);
    assert.equal(readFileSync(join(f.root, "receipt.txt"), "utf8"), "Lost acknowledgment receipt", "the stopped Agent wrote nothing");
    record("lost-ack-reconciliation", { classification: "LIVE disposable Host HTTP; SIMULATED discarded client receipt", respond: { first: first.body.operation, replay: replay.body.operation, status: status.state, writes: 1 }, pause: pauseReplay.body.operation, stop: stopReplay.body.operation });
  } finally { await f.close(); }
});

test("T9R Host replacement: mission and Agent commands pinned to another Host or epoch change nothing", async () => {
  const f = await fixture();
  try {
    const a = await f.make("Pinned Host receipt");
    const identity = (await f.state(f.device.token)).body.hostIdentity;
    const other = { hostId: "00000000-0000-0000-0000-000000000000", epoch: identity.epoch };
    const old = { hostId: identity.hostId, epoch: randomUUID() };
    const commands: [string, Record<string, unknown>][] = [
      ["mission.respond", { requestId: a.request.id, decision: "allow_once" }],
      ["agent.pause", { id: a.agent.id }],
      ["agent.stop", { id: a.agent.id }],
      ["mission.stop", { id: a.agent.missionId }],
    ];
    const codes: Record<string, string[]> = {};
    for (const [action, data] of commands) {
      const wrong = await f.api(action, data, f.device.token, { operationId: randomUUID(), expect: other });
      const stale = await f.api(action, data, f.device.token, { operationId: randomUUID(), expect: old });
      assert.equal(wrong.status, 409); assert.equal(wrong.body.code, "HOST_IDENTITY_CHANGED", action);
      assert.equal(stale.status, 409); assert.equal(stale.body.code, "HOST_EPOCH_CHANGED", action);
      codes[action] = [wrong.body.code, stale.body.code];
    }
    assert.equal(f.host.missions.store.request(a.request.id)!.resolvedAt, null);
    const agent = f.host.agents.store.agent(a.agent.id)!;
    assert.equal(agent.pausedAt, null); assert.equal(agent.stoppedAt, null);
    assert.equal(existsSync(join(f.root, "receipt.txt")), false);
    record("host-replacement", { classification: "LIVE disposable Host HTTP", codes, unchanged: true });
  } finally { await f.close(); }
});

test("T9R cross-Project artifact: a device reads a verified artifact only through its own Project", async () => {
  const f = await fixture();
  try {
    const a = await f.make("Artifact receipt");
    assert.equal((await f.api("mission.respond", { requestId: a.request.id, decision: "allow_once" }, f.device.token)).status, 200);
    await until(async () => (await f.state()).body.agents.agents.find((agent: Agent) => agent.id === a.agent.id && agent.state === "COMPLETED"), "artifact Agent completes");
    const artifact = (await missionRow(f, a.agent.missionId!)).artifacts[0];
    assert.ok(artifact);
    const cross = await f.api("project.artifact", { projectId: f.projectB, artifactId: artifact.id }, f.device.token);
    assert.equal(cross.status, 400);
    assert.doesNotMatch(JSON.stringify(cross.body), HOST_PATH);
    const own = await f.api("project.artifact", { projectId: f.projectA, artifactId: artifact.id }, f.device.token);
    assert.equal(own.status, 200, own.body.error);
    assert.equal(own.body.data.artifact.id, artifact.id);
    assert.equal(own.body.data.artifact.location.path, undefined);
    const projectB = JSON.stringify((await f.api("project.get", { id: f.projectB }, f.device.token)).body.data);
    assert.equal(projectB.includes(artifact.id), false, "Project B does not list Project A's artifact");
    record("cross-project-artifact", { classification: "LIVE disposable Host HTTP and Project service", crossStatus: cross.status, ownStatus: own.status, artifact: artifact.id });
  } finally { await f.close(); }
});

test("T9R Host restart: same Host UUID, Agent and Mission; new epoch; pre-restart approval refused; paired device survives", async () => {
  const f = await fixture();
  try {
    const a = await f.make("Restart receipt");
    const before = (await f.state(f.device.token)).body.hostIdentity;
    const tasksBefore = (await f.state()).body.tasks.length;
    await f.restart();
    const after = await f.state(f.device.token);
    assert.equal(after.status, 200, "the paired device credential survives a Host restart");
    assert.equal(after.body.hostIdentity.hostId, before.hostId);
    assert.notEqual(after.body.hostIdentity.epoch, before.epoch);
    const agent: Agent = after.body.agents.agents.find((row: Agent) => row.id === a.agent.id);
    assert.ok(agent, "same Agent identity");
    assert.equal(agent.missionId, a.agent.missionId, "same Mission identity");
    const held = await f.api("mission.respond", { requestId: a.request.id, decision: "allow_once" }, f.device.token, { operationId: randomUUID(), expect: before });
    assert.equal(held.status, 409);
    assert.equal(held.body.code, "HOST_EPOCH_CHANGED");
    const unpinned = await f.api("mission.respond", { requestId: a.request.id, decision: "allow_once" }, f.device.token);
    assert.equal(unpinned.status, 400, "the pre-restart request is no longer answerable");
    assert.equal(existsSync(join(f.root, "receipt.txt")), false);
    assert.equal((await f.state()).body.tasks.length, tasksBefore, "no duplicate Task");
    assert.equal(f.host.missions.store.runs({ missionId: a.agent.missionId! }).filter(run => run.action === "filesystem.write").length, 0, "no side effect");
    record("host-restart-continuity", { classification: "LIVE Host shutdown and fresh in-process Host over the same SQLite (OS process restart is covered by the T9R live fixture)", hostIdStable: true, epochChanged: true, agentId: agent.id, missionId: agent.missionId, agentState: agent.state, heldCode: held.body.code, unpinnedCode: unpinned.body.code });
  } finally { await f.close(); }
});

test("T9R four-way phone/desktop race resolves one request exactly once", async () => {
  const f = await fixture();
  try {
    const a = await f.make("Four-way receipt");
    const expect = (await f.state(f.device.token)).body.hostIdentity;
    const responses = await Promise.all([
      f.api("mission.respond", { requestId: a.request.id, decision: "allow_batch" }, f.device.token, { operationId: randomUUID(), expect }),
      f.api("mission.respond", { requestId: a.request.id, decision: "allow_once" }),
      f.api("mission.respond", { requestId: a.request.id, decision: "allow_once" }, f.device.token, { operationId: randomUUID(), expect }),
      f.api("mission.respond", { requestId: a.request.id, decision: "deny" }),
    ]);
    assert.equal(responses.filter(r => r.status === 200).length, 1, JSON.stringify(responses.map(r => [r.status, r.body.code, r.body.error])));
    for (const r of responses.filter(r => r.status !== 200)) assert.equal(r.body.code, "REFUSED");
    const request = f.host.missions.store.request(a.request.id)!;
    await until(async () => { const agent: Agent = (await f.state()).body.agents.agents.find((agent: Agent) => agent.id === a.agent.id); return ["COMPLETED", "FAILED", "STOPPED"].includes(agent.state) && agent; }, "four-way race settles");
    const writes = f.host.missions.store.runs({ missionId: a.agent.missionId! }).filter(run => run.action === "filesystem.write" && run.status === "succeeded");
    assert.equal(writes.length, request.resolution === "deny" ? 0 : 1);
    record("concurrent-four-way", { classification: "LIVE concurrent real Host commands", statuses: responses.map(r => r.status), resolution: request.resolution, resolvedBy: request.resolvedBy, successfulWrites: writes.length });
  } finally { await f.close(); }
});
