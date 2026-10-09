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
import { providerBase } from "./adapters.server.ts";
import { ModelCapabilityRegistry } from "./model-capability.server.ts";
import { HostDatabase } from "./persistence.server.ts";
import { TaskManager } from "./manager.server.ts";
import type { AdapterResult, ProviderAdapter } from "./contracts.ts";
import type { ProviderId, ProviderLive } from "../orch/types.ts";
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

type MissionRow = { id: string; state: string; planReference?: string; remote?: { answerable: boolean; reason: string | null }; artifacts: { id: string }[] };
type Fixture = Awaited<ReturnType<typeof fixture>>;
const readStep = (role: string, path = "seed.txt") => ({ role, objective: role, access: "read", executor: { kind: "capability", action: "filesystem.read", params: { path } }, dependsOn: [], verification: [] });
async function plainMission(f: Fixture, objective: string, steps: unknown[]) {
  const created = await f.api("mission.create", { objective, mode: "fast", steps });
  assert.equal(created.status, 200, created.body.error);
  return created.body.mission.id as string;
}
async function missionRow(f: Fixture, id: string, token?: string): Promise<MissionRow> {
  return (await f.state(token)).body.missions.missions.find((m: MissionRow) => m.id === id);
}

test("T9R F-03: after a replan, a device approval must name the reviewed plan; an unrevised plan keeps MA0R semantics", async () => {
  const f = await fixture();
  try {
    const unrevised = await plainMission(f, "Read the seed once", [readStep("Inspect")]);
    assert.equal((await f.api("mission.approve", { id: unrevised, start: false }, f.device.token)).status, 200, "MA0R: the only plan ever offered");
    const id = await plainMission(f, "Read the seed", [readStep("Inspect")]);
    const reviewed = await missionRow(f, id, f.device.token);
    const replanned = await f.api("mission.replan", { id, steps: [readStep("Inspect"), { ...readStep("Inspect again"), dependsOn: [0] }] });
    assert.equal(replanned.status, 200, replanned.body.error);
    const current = await missionRow(f, id, f.device.token);
    assert.notEqual(current.planReference, reviewed.planReference);
    const unbound = await f.api("mission.approve", { id, start: false }, f.device.token);
    assert.equal(unbound.status, 400);
    assert.equal(unbound.body.code, "REFUSED");
    assert.match(unbound.body.error, /plan was revised/);
    const stale = await f.api("mission.approve", { id, start: false, plan: reviewed.planReference }, f.device.token);
    assert.equal(stale.status, 400);
    assert.match(stale.body.error, /plan changed/);
    const mission = f.host.missions.store.mission(id);
    assert.equal(mission.state, "waiting_for_approval");
    assert.ok(!mission.authorizationId, "no envelope from an unbound or stale approval");
    const fresh = await f.api("mission.approve", { id, start: false, plan: current.planReference }, f.device.token);
    assert.equal(fresh.status, 200, fresh.body.error);
    record("f03-plan-binding", { classification: "LIVE disposable Host HTTP and MissionManager", unrevisedUnboundStatus: 200, unboundCode: unbound.body.code, unboundError: unbound.body.error, staleError: stale.body.error, freshStatus: fresh.status });
  } finally { await f.close(); }
});

test("T9R F-02: workstation revocation ends Mission approvals the lost device granted, including a failed Mission's Retry", async () => {
  const f = await fixture();
  try {
    const approveAs = async (token: string | undefined, objective: string, steps: unknown[] = [readStep("Inspect")], start = false) => {
      const id = await plainMission(f, objective, steps);
      const view = await missionRow(f, id, token);
      const approved = await f.api("mission.approve", { id, start, ...(token ? { plan: view.planReference } : {}) }, token);
      assert.equal(approved.status, 200, approved.body.error);
      return id;
    };
    const configured = await f.api("mission.configure", { limits: { maxActiveMissions: 10 } });
    assert.equal(configured.status, 200, configured.body.error);
    const lost = await approveAs(f.device.token, "Approved by the lost phone");
    const failed = await approveAs(f.device.token, "Fails after the lost phone approved it", [readStep("Inspect", "missing.txt")], true);
    const failedState = await until(async () => { const state = f.host.missions.store.mission(failed).state; return ["failed", "waiting_for_user"].includes(state) && state; }, "device-approved Mission fails");
    // SIMULATED terminal failure of a device-approved Mission (state only); Retry and revocation logic stay real.
    const parked = await approveAs(f.device.token, "Failed after the lost phone approved it");
    f.host.missions.store.saveMission({ ...f.host.missions.store.mission(parked), state: "failed", finishedAt: Date.now(), failure: { category: "invalid_plan", detail: "T9R simulated failure", stepId: null } });
    const owner = await approveAs(undefined, "Approved on the workstation");
    const other = await f.pair("Second phone");
    const signedOut = await approveAs(other.token, "Approved by a phone that signs itself out");
    const envelope = (id: string) => f.host.missions.store.authorization(f.host.missions.store.mission(id).authorizationId!)!;
    assert.equal(envelope(lost).grantedBy, `device:${f.device.deviceId}`);
    const runsBefore = f.host.missions.store.runs({ missionId: failed }).length;
    const revoked = await f.api("device.revoke", { id: f.device.deviceId });
    assert.equal(revoked.status, 200, revoked.body.error);
    assert.ok(envelope(lost).revokedAt, "the lost device's Mission approval is revoked");
    assert.equal(f.host.missions.store.mission(lost).state, "stopped");
    assert.equal((await f.api("mission.start", { id: lost })).status, 400, "a revoked approval never starts");
    assert.ok(envelope(failed).revokedAt, "a failed Mission's device approval is revoked too");
    const retry = await f.api("mission.retry", { id: failed });
    assert.equal(retry.status, 400, "Retry cannot revive the lost device's approval");
    assert.notEqual(f.host.missions.store.mission(failed).state, "running");
    assert.equal(f.host.missions.store.runs({ missionId: failed }).length, runsBefore, "nothing ran after revocation");
    assert.ok(envelope(parked).revokedAt, "a failed Mission's device approval is revoked");
    const parkedRetry = await f.api("mission.retry", { id: parked });
    assert.equal(parkedRetry.status, 400);
    // The HTTP body is the generic failure text, so the reason is asserted at the canonical manager boundary.
    assert.throws(() => f.host.missions.retry(parked, "workstation"), /authorization expired or was revoked/);
    assert.equal(f.host.missions.store.mission(parked).state, "failed", "Retry could not revive the lost device's approval");
    assert.equal(envelope(owner).revokedAt, null);
    assert.equal(f.host.missions.store.mission(owner).state, "ready");
    assert.equal((await f.api("device.revoke", {}, other.token)).status, 200, "self sign-out");
    assert.equal(envelope(signedOut).revokedAt, null, "self sign-out keeps the approvals the user gave (documented design)");
    assert.equal(f.host.missions.store.mission(signedOut).state, "ready");
    assert.equal((await f.state(f.device.token)).status, 401);
    record("f02-revocation-ends-approvals", { classification: "LIVE disposable Host HTTP, SQLite and MissionManager; SIMULATED failed state for the parked Mission (state write only)", lostDeviceMission: f.host.missions.store.mission(lost).state, failedMissionStateBefore: failedState, failedMissionStateAfter: f.host.missions.store.mission(failed).state, retryStatus: retry.status, retryCode: retry.body.code, simulatedFailedMission: { state: f.host.missions.store.mission(parked).state, envelopeRevoked: !!envelope(parked).revokedAt, retryStatus: parkedRetry.status }, workstationMission: f.host.missions.store.mission(owner).state, selfSignOutMission: f.host.missions.store.mission(signedOut).state });
  } finally { await f.close(); }
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
    const writes = f.host.missions.store.runs({ missionId: a.agent.missionId! }).filter(run => run.action === "filesystem.write" && run.status === "succeeded").length;
    assert.equal(writes, 1);
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
    assert.equal(f.host.missions.store.runs({ missionId: b.agent.missionId! }).filter(run => run.action === "filesystem.write").length, 0, "the stopped Agent wrote nothing");
    assert.equal(readFileSync(join(f.root, "receipt.txt"), "utf8"), "Lost acknowledgment receipt");
    record("lost-ack-reconciliation", { classification: "LIVE disposable Host HTTP; SIMULATED discarded client receipt", respond: { first: first.body.operation, replay: replay.body.operation, status: status.state, writes }, pause: { replay: pauseReplay.body.operation, pausedAtUnchanged: true }, stop: { replay: stopReplay.body.operation, stoppedAtUnchanged: true } });
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
    const missionBefore = f.host.missions.store.mission(a.agent.missionId!).state;
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
    assert.equal(f.host.missions.store.mission(a.agent.missionId!).state, missionBefore, "Mission state unchanged");
    assert.equal(existsSync(join(f.root, "receipt.txt")), false);
    record("host-replacement", { classification: "LIVE disposable Host HTTP; the other Host is represented by a foreign Host UUID pin", codes, missionState: missionBefore, unchanged: true });
  } finally { await f.close(); }
});

test("T9R cross-Project artifact: a device reads a verified artifact only through its own Project", async () => {
  const f = await fixture();
  try {
    const a = await f.make("Artifact receipt");
    assert.equal((await f.api("mission.respond", { requestId: a.request.id, decision: "allow_once" }, f.device.token)).status, 200);
    await until(async () => (await f.state()).body.agents.agents.find((agent: Agent) => agent.id === a.agent.id && agent.state === "COMPLETED"), "artifact Agent completes");
    const artifact = (await missionRow(f, a.agent.missionId!)).artifacts[0];
    assert.ok(artifact, "the completed Mission produced a verified artifact");
    const cross = await f.api("project.artifact", { projectId: f.projectB, artifactId: artifact.id }, f.device.token);
    assert.equal(cross.status, 400);
    assert.equal(cross.body.code, "REFUSED");
    assert.equal(cross.body.data, undefined, "no artifact body crosses Projects");
    const own = await f.api("project.artifact", { projectId: f.projectA, artifactId: artifact.id }, f.device.token);
    assert.equal(own.status, 200, own.body.error);
    assert.equal(own.body.data.artifact.id, artifact.id);
    assert.equal(own.body.data.artifact.location.path, undefined, "device reads never carry the Host file location");
    const projectB = JSON.stringify((await f.api("project.get", { id: f.projectB }, f.device.token)).body.data);
    assert.equal(projectB.includes(artifact.id), false, "Project B does not list Project A's artifact");
    record("cross-project-artifact", { classification: "LIVE disposable Host HTTP and Project service", crossStatus: cross.status, crossCode: cross.body.code, crossError: cross.body.error, ownStatus: own.status, artifact: artifact.id });
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
    assert.equal(unpinned.body.code, "REFUSED");
    assert.equal(existsSync(join(f.root, "receipt.txt")), false);
    assert.equal((await f.state()).body.tasks.length, tasksBefore, "no duplicate Task");
    assert.equal(f.host.missions.store.runs({ missionId: a.agent.missionId! }).filter(run => run.action === "filesystem.write").length, 0, "no side effect");
    record("host-restart-continuity", { classification: "LIVE Host shutdown and fresh in-process Host over the same SQLite; OS-process restart is in test-results/ma3/t9r/protocol/host-restart-recovery.json", hostId: after.body.hostIdentity.hostId === before.hostId, epochBefore: before.epoch, epochAfter: after.body.hostIdentity.epoch, agentId: agent.id, missionId: agent.missionId, agentState: agent.state, heldCode: held.body.code, unpinnedCode: unpinned.body.code, unpinnedError: unpinned.body.error });
  } finally { await f.close(); }
});

test("T9R four-way phone/desktop race resolves one request exactly once", async () => {
  const f = await fixture();
  try {
    const a = await f.make("Four-way receipt");
    const expect = (await f.state(f.device.token)).body.hostIdentity;
    const actors = [`device:${f.device.deviceId}`, "workstation", `device:${f.device.deviceId}`, "workstation"];
    const responses = await Promise.all([
      f.api("mission.respond", { requestId: a.request.id, decision: "allow_batch" }, f.device.token, { operationId: randomUUID(), expect }),
      f.api("mission.respond", { requestId: a.request.id, decision: "allow_once" }),
      f.api("mission.respond", { requestId: a.request.id, decision: "allow_once" }, f.device.token, { operationId: randomUUID(), expect }),
      f.api("mission.respond", { requestId: a.request.id, decision: "deny" }),
    ]);
    const winners = responses.map((r, index) => r.status === 200 ? index : -1).filter(index => index >= 0);
    assert.equal(winners.length, 1, JSON.stringify(responses.map(r => [r.status, r.body.code, r.body.error])));
    for (const r of responses.filter(r => r.status !== 200)) assert.equal(r.body.code, "REFUSED");
    const request = f.host.missions.store.request(a.request.id)!;
    assert.equal(request.resolvedBy, actors[winners[0]], "the canonical resolution belongs to the single winner");
    await until(async () => { const agent: Agent = (await f.state()).body.agents.agents.find((agent: Agent) => agent.id === a.agent.id); return ["COMPLETED", "FAILED", "STOPPED"].includes(agent.state) && agent; }, "four-way race settles");
    const writes = f.host.missions.store.runs({ missionId: a.agent.missionId! }).filter(run => run.action === "filesystem.write" && run.status === "succeeded");
    assert.equal(writes.length, request.resolution === "deny" ? 0 : 1);
    record("concurrent-four-way", { classification: "LIVE concurrent real Host commands (arrival order decides the winner)", statuses: responses.map(r => r.status), codes: responses.map(r => r.body.code ?? null), winner: winners[0], resolution: request.resolution, resolvedBy: request.resolvedBy, successfulWrites: writes.length });
  } finally { await f.close(); }
});

test("T9R DEV-01: a device-approved local tool-free task is never rerouted to a tool-capable provider", async () => {
  const run = async (by: string) => {
    const directory = mkdtempSync(join(tmpdir(), "bunny-t9r-reroute-"));
    const db = new HostDatabase(join(directory, "host.sqlite"));
    const providers: ProviderId[] = ["ollama", "claude"];
    const launched: { id: ProviderId; finish: (result: AdapterResult) => void }[] = [];
    const live = (id: ProviderId): ProviderLive => ({ ...providerBase(id), installed: true, authenticated: true, authenticatedState: id === "ollama" ? "not_required" : "authenticated", availability: "ready", capabilities: id === "ollama" ? ["text"] : ["text", "filesystem", "terminal", "git"], probedAt: Date.now(), ...(id === "ollama" ? { models: ["qwen3:8b"], current_model: "qwen3:8b" } : { current_model: "claude-default" }) });
    const adapters: ProviderAdapter[] = providers.map((id) => ({ id, detect: async () => live(id), health: async (previous) => previous, usage: async () => null,
      launch: () => { let finish!: (result: AdapterResult) => void; const done = new Promise<AdapterResult>((resolve) => { finish = resolve; }); launched.push({ id, finish }); return { done, stop: async () => finish({ ok: false, output: "", stopped: true }), pid: () => null }; } }));
    const modelRegistry = new ModelCapabilityRegistry(db, { availableProviders: () => providers, ollamaProbe: async () => ({ up: true, models: ["qwen3:8b"], remote: [] }), ollamaShow: async () => ({ capabilities: [], context_length: 8192 }), ollamaPs: async () => ({ models: [] }), now: () => Date.now() });
    const tasks = new TaskManager(db, directory, adapters, { modelRegistry });
    await tasks.discover();
    const submitted = tasks.submit({ prompt: "Say hello", mode: "fast" });
    const fallback = tasks.routingStore.decision(submitted.routingDecisionId!)!.fallback_order.map((entry) => `${entry.provider_id}:${entry.model_id}`);
    assert.deepEqual(fallback, ["claude:null", "ollama:qwen3:8b"], "the recorded AUTO order contains a tool-capable route");
    // SIMULATED AUTO outcome: the task sits on the local candidate of its own recorded order (a selection a device may launch).
    db.write({ ...db.get(submitted.id), provider: "ollama", model: "qwen3:8b" }, "routing.fixture", "T9R fixture: AUTO selected the local candidate.");
    tasks.approve(submitted.id, by);
    const deadline = Date.now() + 8000;
    while (!launched.length && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    // A refused duplicate workstation approve must not clear the device marker.
    assert.throws(() => tasks.approve(submitted.id, "workstation"), /not awaiting approval/);
    launched[0].finish({ ok: false, output: "", error: "usage limit reached (429)", exitCode: 1 });
    while (launched.length < 2 && !["failed", "completed"].includes(db.get(submitted.id).state) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    const result = { by, launches: launched.map((row) => row.id), state: db.get(submitted.id).state, events: db.taskEvents(submitted.id).map((event) => event.type) };
    for (const row of launched) row.finish({ ok: true, output: "done", exitCode: 0 });
    while (!["failed", "completed"].includes(db.get(submitted.id).state) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    db.close();
    rmSync(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
    return result;
  };
  const { deviceMayLaunch } = await import("./device-authority.server.ts");
  assert.equal(deviceMayLaunch({ provider: "ollama", model: "qwen3:8b" }), true);
  assert.equal(deviceMayLaunch({ provider: "ollama", model: "qwen3:8b" }, ["qwen3:8b"]), false, "a probe-reported hosted tag is not local, whatever its name");
  assert.equal(deviceMayLaunch({ provider: "ollama", model: "" }), false, "an empty model never launches");
  const workstation = await run("workstation");
  assert.deepEqual(workstation.launches, ["ollama", "claude"], "positive control: the recovery path reroutes a workstation-approved task");
  const device = await run("device:t9r-phone");
  assert.deepEqual(device.launches, ["ollama"], "the device-approved task never launches a tool-capable route");
  assert.equal(device.state, "failed");
  assert.ok(device.events.includes("routing.exhausted"));
  record("dev01-reroute", { classification: "LIVE TaskManager recovery routing with scripted adapters; SIMULATED AUTO selection of the recorded local candidate", workstation, device, preFixReproduction: "test-results/ma3/t9r/review/t9r-01-prefix-probe.log" });
});
