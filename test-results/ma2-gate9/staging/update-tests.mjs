import { readFileSync, writeFileSync } from 'node:fs';
const path = 'src/lib/bunny-missions/approval-batches.test.ts';
let source = readFileSync(path, 'utf8');
source = source.replace('rotateBatchEpochForTest, riskAtMost', 'rotateBatchEpochForTest, riskAtMost, operationDigest');
source = source.replace(/"computer\.type", \{ title: "Calculator", name: "num(\d)Button", text: "\d" \}/g, '"computer.invoke_control", { title: "Calculator", automationId: "num$1Button" }');
source = source.replace('actionManifest("computer.list_windows", "READ"),', 'actionManifest("computer.list_windows", "READ"),\n  actionManifest("computer.read_calculator", "READ"),');
source = source.replace('health: async () => ({ availability: "available", detail: "" }),\n    execute:', `health: async () => ({ availability: "available", detail: "" }),
    prepareBatchAction: async (action, params, batch) => {
      if (action === "computer.open_app") return null;
      const owner = params.pid !== undefined ? Number(params.pid) : world.owner.get(String(params.title).toLowerCase());
      if (owner !== 4242) throw new Error("Foreign application");
      const identity = { handle: "123", processId: owner, processStartedAt: "123456789" };
      if (batch.windowIdentity && JSON.stringify(batch.windowIdentity) !== JSON.stringify(identity)) throw new Error("Window drift");
      return identity;
    },
    execute:`);
source = source.replace('case "computer.read_controls":', 'case "computer.read_calculator": return result(true, "succeeded", "result", { windowPid: owner, result: "Display is 89" });\n        case "computer.read_controls":');
source = source.replace('desktopStep("Lister", "computer.list_windows", {}, [4])', 'desktopStep("Result", "computer.read_calculator", { title: "Calculator" }, [4])');
source = source.replace('["computer.focus_window", "computer.list_windows", "computer.open_app", "computer.type"]', '["computer.focus_window", "computer.invoke_control", "computer.open_app", "computer.read_calculator"]');
source = source.replace('["computer.list_windows"], "read-only entries', '["computer.read_calculator"], "read-only entries');
source = source.replace('offer.counts["computer.type"], 3', 'offer.counts["computer.invoke_control"], 3');
// The previous positive Notepad typing assertion was an unsafe policy assumption. Preserve the
// sensitive-input test and strengthen it: ordinary typing also asks until a trustworthy policy exists.
const first = source.indexOf('    // A password-shaped control:');
const last = source.indexOf('  } finally { await env.cleanup(); }', first);
source = source.slice(0, first) + `    const probeView = env.missions.create({ objective: "Secret target", mode: "fast", origin: "workstation", steps: [
      desktopStep("Launcher", "computer.open_app", { app: "notepad" }),
      desktopStep("Type name", "computer.type", { title: "Notepad", name: "Name box", text: "x" }, [0]),
      desktopStep("Type password", "computer.type", { title: "Notepad", name: "Password field", text: "hunter2" }, [1]),
    ] });
    env.missions.approve(probeView.id, "workstation");
    await until(() => env.missions.store.requests(probeView.id).length === 1, "the notepad ask");
    assert.equal(unresolved(env, probeView.id).batchOffer, null, "unverified apps and arbitrary typing have no batch offer");
    await assert.rejects(grantBatch(env, probeView.id), /does not offer/);
    assert.equal(env.world.executed.length, 2, "no ordinary or secret Notepad input executed");
` + source.slice(last);
const start = source.indexOf('test("T9 consult boundary:');
const end = source.indexOf('test("T9 admission guards:', start);
source = source.slice(0, start) + `test("T9 consult boundary: exact operations, own steps, pid, risk ceiling and envelope guards", () => {
  const now = Date.now();
  const action = "computer.focus_window";
  const params = { title: "Calculator" };
  const env = { id: "e1", missionId: "m1", expiresAt: now + 60_000, revokedAt: null, computer: { enabled: true }, capabilities: [action] } as AuthorizationEnvelope;
  const batch = { id: "b1", missionId: "m1", authorizationId: "e1", family: "computer", actions: [action], riskCeiling: "EXECUTE", target: { app: "calculator", processId: null, title: null }, maxActions: 5, usedCount: 1, batchEpoch: "boot", status: "active", expiresAt: now + 60_000, operations: [{ stepId: "s1", digest: operationDigest(action, params) }] } as ApprovalBatch;
  const consult = (over: Partial<ApprovalBatch> = {}, envelope: AuthorizationEnvelope = env, opts: { params?: Record<string, unknown>; risk?: RiskClass; stepId?: string; epoch?: string } = {}) => consultBatch({ ...batch, ...over }, { action, params: opts.params ?? params, manifest: COMPUTER_ACTIONS.find((m) => m.id === action)!, risk: opts.risk ?? "EXECUTE", envelope, now, stepIds: new Set(["s1", "s2"]), stepId: opts.stepId ?? "s1", epoch: opts.epoch ?? "boot" });
  assert.equal(consult()?.match, true);
  assert.equal(consult({}, env, { stepId: "s2" })?.match, false, "even another planned step cannot reuse the operation");
  assert.equal(consult({}, env, { stepId: "delegated" })?.match, false);
  assert.equal(consult({}, env, { params: { title: "Calculator help" } })?.match, false);
  assert.equal(consult({}, env, { params: { pid: 999 } })?.match, false);
  assert.equal(consult({}, env, { risk: "DESTRUCTIVE" })?.match, false);
  assert.equal(consult({ riskCeiling: "READ" })?.match, false);
  assert.equal(consult({ usedCount: 5 })?.match, false);
  assert.equal(consult({}, { ...env, missionId: "other" })?.match, false);
  assert.equal(consult({}, { ...env, revokedAt: now })?.match, false);
  assert.equal(consult({}, { ...env, expiresAt: now - 1 })?.match, false);
  assert.equal(consult({}, { ...env, capabilities: [], computer: { enabled: false } })?.match, false);
  assert.equal(consult({ status: "ended" }), null);
  assert.equal(consult({ expiresAt: now - 1 }), null);
  assert.equal(consult({}, env, { epoch: "new" }), null);
  assert.equal(consult({ operations: undefined })?.match, false, "old loose grants fail closed");
  const pidParams = { pid: 4242 };
  const pinned = consult({ observedPid: 4242, observedPidFrom: "params", operations: [{ stepId: "s1", digest: operationDigest(action, pidParams) }] }, env, { params: pidParams });
  assert.equal(pinned?.match, true);
  assert.equal(pinned?.consume, true);
});

` + source.slice(end);
// Drift cases now stop before the foreign mutation, asking on that same step.
source = source.replace(/test\("T9 window drift:[^"]+"/, 'test("T9 window drift: a title lookalike asks before any foreign mutation"');
source = source.replace(/test\("T9 UWP drift:[^"]+"/, 'test("T9 UWP drift: divergent content pids do not authorize a title lookalike"');
source = source.replace(/    await until\(\(\) => batchRow\(env, view.id\).status === "ended", "drift ended the batch"[^;]+;/g, '    await until(() => env.missions.store.requests(view.id).length === 2, "drift asks before execution");');
source = source.replace(/assert.equal\(stored.endReason, "scope_mismatch", [^;]+;/g, 'assert.equal(stored.endReason, null, "the foreign action asks without touching the window");');
source = source.replace('assert.equal(stored.usedCount, 4, "open + focus + type + the admitted lookalike; nothing after it ran under the batch")', 'assert.equal(stored.usedCount, 3, "only open, focus and the approved digit executed")');
source = source.replace(/    assert.ok\(eventTypes\(env, view.id\).includes\("approval.batch_scope_mismatch"\)\);/g, '    assert.equal(env.world.executed.filter((r) => r.params.title === "Calculator help consent").length, 0, "foreign window never touched");');
// In the existing standing-policy test, protect the newly eligible invoke operation instead of type.
source = source.replace('setGrant("computer.type", "global", "ask_every_time"', 'setGrant("computer.invoke_control", "global", "ask_every_time"');
source = source.replace('some((candidate) => candidate.action === "computer.type")', 'some((candidate) => candidate.action === "computer.invoke_control")');
source = source.replace('find((candidate) => candidate.action === "computer.type")', 'find((candidate) => candidate.action === "computer.invoke_control")');
// The typed-value privacy probe must receive its own explicit one-time approval.
source = source.replace('    await grantBatch(env, view.id);\n    await until(() => env.missions.mission(view.id).state === "completed", "done", 8000);', `    await until(() => env.missions.store.requests(view.id).length === 1, "launch ask");
    await env.missions.respond(unresolved(env, view.id).id, "allow_once", "workstation");
    await until(() => env.missions.store.requests(view.id).length === 2, "typing asks independently");
    assert.equal(unresolved(env, view.id).batchOffer, null);
    await env.missions.respond(unresolved(env, view.id).id, "allow_once", "workstation");
    await until(() => env.missions.mission(view.id).state === "completed", "done", 8000);`);
source = source.replace('assert.ok(!JSON.stringify(batchRow(env, view.id)).includes(secret), "batch records carry no typed values");', 'assert.equal(env.missions.store.batches(view.id).length, 0, "secret input created no batch authority");');
writeFileSync(path, source);
