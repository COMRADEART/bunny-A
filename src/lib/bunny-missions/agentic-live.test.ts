import test from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { createServer } from "node:net";
import { basename, join, resolve } from "node:path";
import { evidenceDir } from "../bunny-host/test-evidence.ts";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { canonical, within } from "./paths.server.ts";
import type { AgentSnapshot } from "../bunny-host/agent-types.ts";

const evidenceRoot = evidenceDir("ma3/t5");
const save = (name: string, value: unknown) => writeFileSync(join(evidenceRoot, name), JSON.stringify(value, null, 2));
async function until<T>(check: () => Promise<T | null>, label: string): Promise<T> {
  const started = Date.now();
  for (;;) { const result = await check(); if (result) return result; if (Date.now() - started > 20_000) throw new Error(`Timed out: ${label}`); await new Promise(r => setTimeout(r, 25)); }
}
async function start(dir: string, root: string) {
  const allocator = createServer(); await new Promise<void>(r => allocator.listen(0, "127.0.0.1", r));
  const port = (allocator.address() as { port: number }).port; await new Promise<void>(r => allocator.close(() => r()));
  const child = fork(resolve("scripts/fixtures/agentic-host-worker.mjs"), [dir, root, String(port)], { execArgv: ["--experimental-strip-types"], stdio: ["ignore", "pipe", "pipe", "ipc"], windowsHide: true });
  let output = ""; child.stdout?.on("data", data => { output += String(data); }); child.stderr?.on("data", data => { output += String(data); });
  const ready = await new Promise<{ token: string; generation: string; pid: number }>((resolveReady, reject) => {
    const timer = setTimeout(() => reject(new Error(`Host ready timeout: ${output}`)), 20_000);
    child.once("message", message => { clearTimeout(timer); resolveReady(message as { token: string; generation: string; pid: number }); });
    child.once("exit", code => { clearTimeout(timer); reject(new Error(`Disposable Host exit ${code}: ${output}`)); });
  });
  const api = async (action: string, data: unknown = {}, token = ready.token) => {
    const response = await fetch(`http://127.0.0.1:${port}/command`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ action, data }) });
    return { status: response.status, body: await response.json() as { error?: string; agents?: AgentSnapshot; snapshot?: { agents: AgentSnapshot }; pairCode?: string; [key: string]: unknown } };
  };
  const state = async () => { const response = await fetch(`http://127.0.0.1:${port}/state`, { headers: { authorization: `Bearer ${ready.token}` } }); return await response.json() as { agents: AgentSnapshot }; };
  const stop = async () => { if (child.exitCode !== null) return; const exited = new Promise<void>((r, reject) => { const timeout = setTimeout(() => { child.kill(); reject(new Error("Disposable Host did not close")); }, 15_000); child.once("exit", () => { clearTimeout(timeout); r(); }); }); child.send("close"); await exited; };
  return { child, port, generation: ready.generation, pid: ready.pid, api, state, stop, output: () => output };
}
function workspace() { const parent = canonical(tmpdir()); const dir = mkdtempSync(join(parent, "bunny-t5-live-")); const root = join(dir, "project"); mkdirSync(root); writeFileSync(join(root, "seed.txt"), "seed"); writeFileSync(join(root, "check.mjs"), "import {readFileSync} from 'node:fs'; process.exit(readFileSync('result.txt','utf8') === 'right' ? 0 : 1);"); return { dir, root, cleanup: () => { if (!within(parent, dir) || !basename(dir).startsWith("bunny-t5-live-")) throw new Error("Unsafe cleanup"); rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } }; }
const op = (role: string, action: string, params: Record<string, unknown>, dependsOn: number[] = [], verification: unknown[] = []) => ({ role, objective: role, access: action === "filesystem.write" ? "write" : "read", executor: { kind: "capability", action, params }, dependsOn, verification });

test("T5 DISPOSABLE LIVE VERIFIED: one HTTP consent, real edit/test/correct/test, exact scope denial", async () => {
  const w = workspace(); const host = await start(w.dir, w.root);
  try {
    assert.equal((await host.api("mission.configure", { enabled: true })).status, 200);
    const created = await host.api("agent.create", { name: "Live acceptance", objective: "Inspect, correct and test disposable files", steps: [
      op("Inspect", "filesystem.read", { path: "seed.txt" }),
      op("First edit", "filesystem.write", { path: "result.txt", content: "wrong", overwrite: true }, [0], [{ kind: "command", command: "node", args: ["check.mjs"], expectExit: 1 }]),
      op("Correct edit", "filesystem.write", { path: "result.txt", content: "right", overwrite: true }, [1], [{ kind: "command", command: "node", args: ["check.mjs"], expectExit: 0 }]),
      op("Verify result", "filesystem.read", { path: "result.txt" }, [2], [{ kind: "file_exists", path: "result.txt", contains: "right" }]),
      op("Scope boundary", "filesystem.delete", { path: "seed.txt" }, [3]),
    ] });
    assert.equal(created.status, 200, created.body.error); const agent = created.body.agents!.agents[0];
    const proposed = await host.api("agent.authorization.propose", { id: agent.id }); assert.equal(proposed.status, 200, proposed.body.error);
    const authorization = proposed.body.agents!.agents[0].authorization!;
    assert.equal((await host.api("agent.authorization.approve", { id: agent.id, revision: authorization.revision })).status, 200);
    const waiting = await until(async () => { const s = await host.state(); const a = s.agents.agents.find(a => a.id === agent.id); return a?.state === "WAITING_FOR_USER" && a.authorization?.pending.length ? a : null; }, "scope boundary");
    assert.equal(readFileSync(join(w.root, "result.txt"), "utf8"), "right");
    const pending = waiting.authorization!.pending;
    assert.equal(pending.length, 1); assert.equal(pending[0].action, "filesystem.delete");
    assert.equal((await host.api("mission.respond", { requestId: pending[0].id, decision: "deny" })).status, 200);
    assert.equal(readFileSync(join(w.root, "seed.txt"), "utf8"), "seed");
    const final = await until(async () => { const a = (await host.state()).agents.agents.find(a => a.id === agent.id); return a?.state === "FAILED" ? a : null; }, "denied required step ends the Mission");
    assert.equal(final.failure, "AUTHORITY_LOST"); assert.ok(final.checkpoints > 0);
    const db = new DatabaseSync(join(w.dir, "host.sqlite"), { readOnly: true });
    try {
      const rows = db.prepare("SELECT record FROM agentic_admissions").all() as { record: string }[];
      const admissions = rows.map(r => JSON.parse(r.record));
      const approvals = db.prepare("SELECT COUNT(*) n FROM events WHERE type='agent.authorization_approved'").get() as { n: number };
      const requests = db.prepare("SELECT record FROM permission_requests").all() as { record: string }[];
      assert.equal(approvals.n, 1); assert.equal(requests.length, 1); assert.ok(admissions.length >= 7); assert.equal(admissions.filter(a => a.capability === "terminal.exec").length, 2);
      assert.equal(admissions.filter(a => a.outcome === "FAILED").length, 1);
      save("disposable-live-acceptance.json", { classification: "DISPOSABLE LIVE VERIFIED", hostPid: host.pid, generation: host.generation, consentCount: approvals.n, admissions, redundantPrompts: 0, scopeRequest: pending[0], waitingBeforeDenial: waiting.state, denied: true, deniedFilePreserved: true, finalAgent: final, checkpointCount: final.checkpoints });
    } finally { db.close(); }
    await host.api("agent.stop", { id: agent.id });
  } finally { await host.stop(); save("disposable-live-host.log.json", { output: host.output() }); w.cleanup(); }
});

test("T5 DISPOSABLE LIVE VERIFIED: fresh Host process/SQLite, revoked device, old approval, reviewed restart", async () => {
  const w = workspace(); let host = await start(w.dir, w.root);
  try {
    await host.api("mission.configure", { enabled: true });
    const created = await host.api("agent.create", { name: "Restart acceptance", objective: "Inspect then request destructive scope", steps: [op("Inspect", "filesystem.read", { path: "seed.txt" }), op("Boundary", "filesystem.delete", { path: "seed.txt" }, [0])] });
    const agent = created.body.agents!.agents[0];
    const proposal = await host.api("agent.authorization.propose", { id: agent.id });
    await host.api("agent.authorization.approve", { id: agent.id, revision: proposal.body.agents!.agents[0].authorization!.revision });
    const waiting = await until(async () => { const a = (await host.state()).agents.agents.find(a => a.id === agent.id); return a?.authorization?.pending.length ? a : null; }, "restart boundary");
    const oldRequest = waiting.authorization!.pending[0].id;
    const pair = await host.api("pairing.create");
    const pairResponse = await fetch(`http://127.0.0.1:${host.port}/pair`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: pair.body.pairCode, name: "T5 disposable device" }) });
    assert.equal(pairResponse.status, 200); const device = await pairResponse.json() as { token: string; deviceId: string };
    assert.equal((await host.api("agent.authorization.adjust", { id: agent.id, revision: waiting.authorization!.revision, patch: { maximumActions: 999 } }, device.token)).status, 400);
    await host.api("device.revoke", { id: device.deviceId });
    assert.equal((await host.api("agent.list", {}, device.token)).status, 401);
    const first = { pid: host.pid, generation: host.generation }; await host.stop(); assert.ok(host.child.exitCode !== null);
    host = await start(w.dir, w.root); assert.notEqual(host.pid, first.pid); assert.notEqual(host.generation, first.generation);
    const recovered = await until(async () => { const a = (await host.state()).agents.agents.find(a => a.id === agent.id); return a?.state === "WAITING_FOR_USER" ? a : null; }, "recovered Agent");
    assert.equal(recovered.authorization!.state, "WAITING_FOR_USER"); assert.equal(recovered.authorization!.admitted, 1);
    assert.equal((await host.api("mission.respond", { requestId: oldRequest, decision: "allow_once" })).status, 400);
    const renewed = await host.api("agent.authorization.approve", { id: agent.id, revision: recovered.authorization!.revision }); assert.equal(renewed.status, 200, renewed.body.error);
    assert.equal((await host.state()).agents.agents.find(a => a.id === agent.id)!.authorization!.admitted, 1, "reviewed consent never replays effects");
    assert.equal(readFileSync(join(w.root, "seed.txt"), "utf8"), "seed");
    save("restart-authorization.json", { classification: "DISPOSABLE LIVE VERIFIED", first, fresh: { pid: host.pid, generation: host.generation }, oldProcessEnded: true, oldMemoryDiscarded: true, sqliteAgentRecovered: true, oldApprovalRejected: true, remoteExpansionRejected: true, revokedDeviceRejected: true, historicalAdmissions: 1, ambiguousEffectNotReplayed: true, freshReviewedConsent: true, recoveredAgent: recovered });
    await host.api("agent.stop", { id: agent.id });
  } finally { await host.stop(); save("restart-host.log.json", { output: host.output() }); w.cleanup(); }
});
