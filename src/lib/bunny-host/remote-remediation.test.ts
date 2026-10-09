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
  const socket = createServer();
  await new Promise<void>(resolve => socket.listen(0, "127.0.0.1", resolve));
  const port = (socket.address() as { port: number }).port;
  await new Promise<void>(resolve => socket.close(() => resolve()));
  const host = await startHost({ dataDirectory: directory, root, workspaceRoot: root, port, adapters: [], missions: { adapters: [filesystem] }, sample: async () => ({ at: Date.now(), cpu: { utilization: null, clockMhz: null, temperatureC: null }, memory: { usedBytes: 0, availableBytes: 1, totalBytes: 1 }, gpus: [], notes: ["T9R disposable"] }) });
  await host.missions.bus.refreshHealth();
  const base = `http://127.0.0.1:${port}`;
  const api = async (action: string, data: unknown = {}, token = host.token, extra: Record<string, unknown> = {}) => {
    const response = await fetch(`${base}/command`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ action, data, ...extra }) });
    // Credentials stay in memory; evidence never serializes the response to pairing.create or /pair.
    return { status: response.status, body: await response.json() };
  };
  const state = async (token = host.token) => {
    const response = await fetch(`${base}/state`, { headers: { authorization: `Bearer ${token}` } });
    return { status: response.status, body: await response.json() };
  };
  const code = (await api("pairing.create")).body.pairCode;
  const paired = await fetch(`${base}/pair`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, name: "T9R disposable client" }) });
  assert.equal(paired.status, 200);
  const device: { token: string; deviceId: string } = await paired.json();
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
  const close = async () => { await host.close(); rmSync(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 }); };
  return { directory, root, otherRoot, host, base, device, projectA, projectB, api, state, make, close };
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
