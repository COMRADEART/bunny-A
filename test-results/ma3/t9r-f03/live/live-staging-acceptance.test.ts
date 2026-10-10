/**
 * M-A-3 T9R-F02 section 18: mandatory live acceptance on a disposable Host.
 *
 * Real `startHost` (HTTP on loopback, real SQLite in a disposable directory), real pairing over /pair, real bearer
 * authentication for both principals, a real Agent with Host consent, a real recursive project watcher. Nothing in the
 * authorization path is mocked. One instrumentation hook is used and recorded: the Host's own scheduling gate
 * (`missions.missionPauseGate`) is held briefly in step 15 so a phone answer is provably still unconsumed when the phone
 * signs out (otherwise the scheduler may consume it within milliseconds).
 *
 * Run from the repository root:
 *   node --experimental-strip-types --test test-results/ma3/t9r-f03/live/live-staging-acceptance.test.ts
 * Writes test-results/ma3/t9r-f03/live-staging-acceptance.json (no credentials).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, watch, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startHost } from "../../../../src/lib/bunny-host/http.server.ts";
import { FilesystemCapability } from "../../../../src/lib/bunny-missions/capabilities/local.server.ts";
import type { AgentSnapshot } from "../../../../src/lib/bunny-host/agent-types.ts";
type Agent = AgentSnapshot["agents"][number];

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
async function until<T>(check: () => Promise<T | false | undefined | null>, label: string, ms = 20000): Promise<T> {
  const deadline = Date.now() + ms;
  do { const value = await check(); if (value) return value; await new Promise((r) => setTimeout(r, 25)); } while (Date.now() < deadline);
  throw new Error(`Timed out: ${label}`);
}

test("F02 §18 live acceptance: phone document change is staged, reviewed and promoted; config, narrowed scope and sign-out are enforced", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bunny-f02-live-"));
  const root = join(directory, "project");
  mkdirSync(join(root, "notes"), { recursive: true });
  mkdirSync(join(directory, "agent-workspaces"));
  writeFileSync(join(root, "seed.txt"), "seed");
  const socket = createServer();
  await new Promise<void>((r) => socket.listen(0, "127.0.0.1", r));
  const port = (socket.address() as { port: number }).port;
  await new Promise<void>((r) => socket.close(() => r()));
  const host = await startHost({ dataDirectory: directory, root, workspaceRoot: join(directory, "agent-workspaces"), port, adapters: [], missions: { adapters: [new FilesystemCapability()] }, sample: async () => ({ at: Date.now(), cpu: { utilization: null, clockMhz: null, temperatureC: null }, memory: { usedBytes: 0, availableBytes: 1, totalBytes: 1 }, gpus: [], notes: ["F02 disposable"] }) });
  await host.missions.bus.refreshHealth();
  const base = `http://127.0.0.1:${port}`;
  const api = async (action: string, data: unknown = {}, token = host.token) => {
    const response = await fetch(`${base}/command`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ action, data }) });
    return { status: response.status, body: await response.json() };
  };
  const state = async (token = host.token) => (await (await fetch(`${base}/state`, { headers: { authorization: `Bearer ${token}` } })).json());
  const events: { at: number; file: string }[] = [];
  const watcher = watch(root, { recursive: true }, (_kind, file) => events.push({ at: Date.now(), file: String(file) }));
  const steps: Record<string, unknown>[] = [];
  const record = (n: number, title: string, observed: Record<string, unknown>) => { steps.push({ step: n, title, ...observed }); };
  try {
    // ── setup: workstation enables Missions, adds the project, pairs a disposable phone ─────────────────────────
    assert.equal((await api("mission.configure", { enabled: true })).status, 200);
    const projectId: string = (await api("project.add", { name: "F02 live project", path: root })).body.data.id;
    const code = (await api("pairing.create")).body.pairCode;
    const paired = await fetch(`${base}/pair`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, name: "F02 disposable phone" }) });
    assert.equal(paired.status, 200);
    const phone = await paired.json() as { token: string; deviceId: string };
    const phoneActor = `device:${phone.deviceId}`;
    // The owner keeps file writes in the Agent's consent but asks for each one: the phone's narrow authority.
    assert.equal((await api("capability.grant", { action: "filesystem.write", scope: "global", policy: "ask_every_time" })).status, 200);
    const makeAgent = async (name: string, writes: { path: string; content: string }[]) => {
      const step = (path: string, content: string) => ({ role: "Write", objective: `Write ${path}`, access: "write", executor: { kind: "capability", action: "filesystem.write", params: { path, content, overwrite: true } }, dependsOn: [], verification: [{ kind: "capability", action: "filesystem.compare", params: { path, content }, expect: { field: "matches", equals: true } }] });
      const created = await api("agent.create", { projectId, name, objective: `F02 live ${name}`, steps: writes.map((w) => step(w.path, w.content)) });
      assert.equal(created.status, 200, created.body.error);
      const agent: Agent = created.body.agents.agents.find((a: Agent) => a.name === name);
      const proposed = await api("agent.authorization.propose", { id: agent.id });
      assert.equal(proposed.status, 200, proposed.body.error);
      const offer = proposed.body.agents.agents.find((a: Agent) => a.id === agent.id).authorization;
      assert.ok(offer.capabilities.includes("filesystem.write"));
      assert.equal((await api("agent.authorization.approve", { id: agent.id, revision: offer.revision })).status, 200);
      return agent;
    };
    const pendingFor = (missionId: string, action: string) => host.missions.store.requests(missionId).find((r) => !r.resolvedAt && r.action === action);

    // 1-2. Phone receives valid narrow authority and submits a permitted document change.
    const content = "# Plan\n\nReviewed on the Windows Host before it reaches the project.\n";
    const docAgent = await makeAgent("Doc agent", [{ path: "notes/plan.md", content }]);
    const ask = await until(async () => pendingFor(docAgent.missionId!, "filesystem.write"), "document write ask");
    const phoneView = await state(phone.token);
    const phoneAsk = phoneView.missions.missions.find((m: { id: string }) => m.id === docAgent.missionId).requests.find((r: { id: string }) => r.id === ask.id);
    record(1, "Phone receives valid narrow authority", { requestId: ask.id, action: ask.action, phoneAnswerable: phoneAsk.remote?.answerable === true, desktopRequired: !!ask.desktopRequired });
    assert.equal(phoneAsk.remote?.answerable, true, "the in-scope document write is answerable by the phone");
    const answered = await api("mission.respond", { requestId: ask.id, decision: "allow_once" }, phone.token);
    assert.equal(answered.status, 200, answered.body.error);
    record(2, "Phone submits a permitted document change", { status: answered.status, resolvedBy: host.missions.store.request(ask.id).resolvedBy === phoneActor ? "the paired phone" : "UNEXPECTED" });

    // 3. Host stores it in owned inert staging.
    const promotion = await until(async () => host.missions.store.requests(docAgent.missionId!).find((r) => r.promotion && !r.resolvedAt), "promotion request");
    const staged = host.missions.staging.get(promotion.promotion!.stagingId)!;
    const stagedPath = host.missions.staging.contentPath(staged.id);
    assert.equal(staged.promotionState, "STAGED");
    assert.equal(readFileSync(stagedPath, "utf8"), content);
    assert.equal(staged.classification, "PHONE_SAFE_DOCUMENT");
    record(3, "Host stores it in owned inert staging", { stagingId: staged.id, state: staged.promotionState, classification: staged.classification, contentHash: staged.contentHash, stagedUnderHostState: stagedPath.startsWith(directory) && !stagedPath.startsWith(root), deviceId: staged.deviceId === phoneActor ? "the paired phone" : "UNEXPECTED" });

    // 4. The project watcher observes no premature change.
    await new Promise((r) => setTimeout(r, 750));
    const beforePromotion = events.length;
    assert.equal(existsSync(join(root, "notes", "plan.md")), false);
    assert.equal(beforePromotion, 0, `watcher events before promotion: ${JSON.stringify(events)}`);
    record(4, "Project watcher observes no premature change", { watcherEventsWhileStaged: beforePromotion, destinationExists: false });

    // 5. Windows Host reviews exact staged bytes (workstation view), the phone sees no listing.
    const desk = (await api("mission.get", { id: docAgent.missionId })).body.data;
    const deskRequest = desk.mission.requests.find((r: { id: string }) => r.id === promotion.id);
    const phoneMission = (await api("mission.get", { id: docAgent.missionId }, phone.token)).body.data;
    const phoneRequest = phoneMission.mission.requests.find((r: { id: string }) => r.id === promotion.id);
    assert.ok(deskRequest.reason.includes(staged.contentHash) && deskRequest.reason.includes(JSON.stringify(content)), "workstation sees full SHA-256 and exact content");
    assert.ok(!JSON.stringify(phoneRequest).includes(staged.contentHash) && phoneRequest.promotion === undefined, "phone sees neither digest nor promotion binding");
    const phonePromote = await api("mission.respond", { requestId: promotion.id, decision: "allow_once" }, phone.token);
    assert.equal(phonePromote.body.code, "WORKSTATION_REQUIRED", JSON.stringify(phonePromote.body));
    record(5, "Windows Host reviews exact staged bytes", { workstationSeesSha256: true, workstationSeesFullContent: true, phoneSeesListing: false, phonePromotionAttempt: { status: phonePromote.status, code: phonePromote.body.code } });

    // 6-9. Current authorization allows promotion; identities verified; promotion succeeds; independent verification.
    const promoted = await api("mission.respond", { requestId: promotion.id, decision: "allow_once" });
    assert.equal(promoted.status, 200, promoted.body.error);
    await until(async () => existsSync(join(root, "notes", "plan.md")), "promoted file");
    const after = host.missions.staging.get(staged.id)!;
    const onDisk = readFileSync(join(root, "notes", "plan.md"), "utf8");
    assert.equal(after.promotionState, "PROMOTED");
    assert.equal(sha(onDisk), staged.contentHash);
    await until(async () => events.some((e) => e.file.includes("plan.md")), "watcher sees promotion");
    record(6, "Current authorization allows promotion", { workstationStatus: promoted.status, decidedBy: after.decidedBy });
    record(7, "Host verifies source/destination identity", { stagedIdentityRecorded: !!after.fileIdentity.ino, destinationBefore: after.destinationBefore });
    record(8, "Promotion succeeds", { state: after.promotionState, decisionReason: after.decisionReason });
    record(9, "Independent verification confirms the result", { destinationSha256: sha(onDisk), matchesReviewed: sha(onDisk) === staged.contentHash, watcherSawChangeOnlyAfterPromotion: events.filter((e) => e.file.includes("plan.md")).every((e) => e.at >= (after.decidedAt ?? 0) - 50) });

    // 10. Agent checkpoint records completion.
    await until(async () => host.missions.mission(docAgent.missionId!).state === "completed", "doc Mission completed");
    const run = host.agents.store.latestRun(docAgent.id);
    const checkpoints = run ? host.agents.store.checkpoints(run.id).map((c) => c.boundary) : [];
    const agentState = (await state()).agents.agents.find((a: Agent) => a.id === docAgent.id);
    record(10, "Agent checkpoint records completion", { missionState: host.missions.mission(docAgent.missionId!).state, agentState: agentState?.state, checkpointBoundaries: checkpoints });

    // 11-12. Phone attempts an out-of-scope configuration modification; refused before mutation.
    const configAgent = await makeAgent("Config agent", [{ path: ".vscode/settings.json", content: "{\"task.autoDetect\":\"on\"}" }]);
    const configAsk = await until(async () => pendingFor(configAgent.missionId!, "filesystem.write"), "config ask");
    const configTry = await api("mission.respond", { requestId: configAsk.id, decision: "allow_once" }, phone.token);
    assert.equal(configTry.body.code, "WORKSTATION_REQUIRED", JSON.stringify(configTry.body));
    assert.equal(existsSync(join(root, ".vscode", "settings.json")), false);
    assert.equal(host.missions.staging.forMission(configAgent.missionId!).length, 0);
    record(11, "Phone attempts an out-of-scope configuration modification", { requestId: configAsk.id, status: configTry.status, code: configTry.body.code });
    record(12, "Modification is refused before mutation", { destinationExists: false, stagedRecords: 0, requestStillOpen: host.missions.store.request(configAsk.id).resolvedAt === null });

    // 13-14. The user narrows the Agent's file permissions; the previously offered write is refused.
    const narrowAgent = await makeAgent("Narrowed agent", [{ path: "notes/later.md", content: "later" }]);
    const offered = await until(async () => pendingFor(narrowAgent.missionId!, "filesystem.write"), "offered write");
    const projection = (await state()).agents.agents.find((a: Agent) => a.id === narrowAgent.id).authorization;
    const narrowed = await api("agent.authorization.adjust", { id: narrowAgent.id, revision: projection.revision, patch: { capabilities: projection.capabilities.filter((c: string) => c !== "filesystem.write") } });
    assert.equal(narrowed.status, 200, narrowed.body.error);
    record(13, "User narrows Agent file permissions", { status: narrowed.status, capabilitiesNow: narrowed.body.agents.agents.find((a: Agent) => a.id === narrowAgent.id).authorization.capabilities });
    const oldTry = await api("mission.respond", { requestId: offered.id, decision: "allow_once" }, phone.token);
    const reissued = await until(async () => pendingFor(narrowAgent.missionId!, "filesystem.write"), "reissued ask");
    const newTry = await api("mission.respond", { requestId: reissued.id, decision: "allow_once" }, phone.token);
    assert.notEqual(oldTry.status, 200);
    assert.equal(newTry.body.code, "WORKSTATION_REQUIRED", JSON.stringify(newTry.body));
    assert.equal(existsSync(join(root, "notes", "later.md")), false);
    assert.equal(host.missions.staging.forMission(narrowAgent.missionId!).length, 0);
    record(14, "Previously offered write is refused", { previouslyOffered: { requestId: offered.id, status: oldTry.status, code: oldTry.body.code }, reissuedAtNewRevision: { requestId: reissued.id, status: newTry.status, code: newTry.body.code }, written: false, staged: 0 });

    // 15-16. Phone signs out; its unconsumed approvals become invalid.
    const pendingAgent = await makeAgent("Unconsumed agent", [{ path: "notes/unused.md", content: "unused" }]);
    const unusedAsk = await until(async () => pendingFor(pendingAgent.missionId!, "filesystem.write"), "unconsumed ask");
    const gate = host.missions.missionPauseGate;
    host.missions.missionPauseGate = (missionId) => missionId === pendingAgent.missionId || (gate?.(missionId) ?? false); // instrumentation: hold scheduling
    const unusedAnswer = await api("mission.respond", { requestId: unusedAsk.id, decision: "allow_once" }, phone.token);
    assert.equal(unusedAnswer.status, 200, unusedAnswer.body.error);
    const unusedStep = host.missions.store.step(unusedAsk.stepId);
    assert.equal(unusedStep.approvedOnce?.requestId, unusedAsk.id, "answer recorded and not yet used");
    const signOut = await api("device.revoke", {}, phone.token);
    assert.equal(signOut.status, 200);
    host.missions.missionPauseGate = gate;
    host.missions.schedule(pendingAgent.missionId!);
    const invalidated = host.missions.store.request(unusedAsk.id);
    assert.equal(invalidated.lifecycle?.state, "INVALIDATED_BY_SIGNOUT");
    await new Promise((r) => setTimeout(r, 750));
    assert.equal(existsSync(join(root, "notes", "unused.md")), false);
    const afterSignOut = await fetch(`${base}/state`, { headers: { authorization: `Bearer ${phone.token}` } });
    record(15, "Phone signs out", { status: signOut.status, signedOut: signOut.body.signedOut === true, laterPhoneRequest: afterSignOut.status });
    record(16, "Unconsumed phone approvals become invalid", { requestId: unusedAsk.id, lifecycle: invalidated.lifecycle?.state, stepApprovedOnce: host.missions.store.step(unusedAsk.stepId).approvedOnce, written: existsSync(join(root, "notes", "unused.md")), staged: host.missions.staging.forMission(pendingAgent.missionId!).filter((r) => r.promotionState === "STAGED").length });

    // 17. Independent owner-approved history remains intact.
    const historyEnvelope = host.missions.store.authorization(host.missions.mission(docAgent.missionId!).authorizationId!);
    assert.equal(readFileSync(join(root, "notes", "plan.md"), "utf8"), content);
    assert.equal(host.missions.staging.get(staged.id)!.promotionState, "PROMOTED");
    assert.ok(existsSync(stagedPath), "staged content kept for audit");
    assert.equal(host.missions.mission(docAgent.missionId!).state, "completed");
    record(17, "Independent owner-approved history remains intact", {
      promotedFileSha256: sha(readFileSync(join(root, "notes", "plan.md"), "utf8")), promotedRecord: host.missions.staging.get(staged.id)!.promotionState, stagedContentKept: true,
      completedMissionState: host.missions.mission(docAgent.missionId!).state, workstationEnvelopeGrantedBy: historyEnvelope?.grantedBy, workstationEnvelopeRevoked: !!historyEnvelope?.revokedAt,
      promotionRequestLifecycle: host.missions.store.request(promotion.id).lifecycle?.state, auditEvents: host.missions.tasks.db.events(0).filter((e) => /staging\.|approval\.lifecycle|device\.revoked/.test(e.type)).map((e) => e.type),
    });
    const evidence = resolve("test-results/ma3/t9r-f03/live-staging-acceptance.json");
    writeFileSync(evidence, JSON.stringify({ gate: "M-A-3 T9R-F03 (re-run of F02 §18)", classification: "LIVE disposable Host: real HTTP loopback, real pairing, real SQLite, real Agent consent, real fs.watch; no mocked authorization", instrumentation: "missions.missionPauseGate held only in step 15 to keep one phone answer provably unconsumed at sign-out", hostEpoch: host.manager.instanceId, result: "PASS", steps }, null, 2) + "\n");
  } finally {
    watcher.close();
    await host.close();
    rmSync(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
  }
});
