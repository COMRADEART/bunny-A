import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { HostDatabase } from "../bunny-host/persistence.server.ts";
import { TaskManager } from "../bunny-host/manager.server.ts";
import { providerBase, codexLaunchArgs, claudeLaunchArgs } from "../bunny-host/adapters.server.ts";
import type { AdapterHooks, AdapterResult, ProviderAdapter } from "../bunny-host/contracts.ts";
import type { OrchTask, ProviderId, ProviderLive } from "../orch/types.ts";
import { MissionManager } from "./manager.server.ts";
import { MissionStore } from "./store.server.ts";
import { blockedBy, canMissionTransition, canStepTransition, assertMissionTransition, missionProgress, readySteps, retryVerdict, validateGraph, classifyTaskFailure } from "./machine.ts";
import { decide, envelopeFrom, scopeFor, scopeViolation, taskViolation } from "./authorization.server.ts";
import { deterministicPlan, explicitPlan, planMission } from "./planner.server.ts";
import { DEFAULT_CONFIG, redact } from "./store.server.ts";
import { WorkspaceCoordinator } from "./workspace.server.ts";
import { agentPrompt } from "./context.ts";
import { missionCommand } from "./commands.server.ts";
import { BUILTIN_SKILLS } from "./skills.server.ts";
import type { CapabilityAdapter } from "./capabilities/bus.server.ts";
import { FilesystemCapability, NotificationsCapability, TerminalCapability } from "./capabilities/local.server.ts";
import { communicationConnectors } from "./capabilities/connectors.server.ts";
import type { ActionManifest, MissionStep } from "./types.ts";

function ready(id: ProviderId): ProviderLive {
  return { ...providerBase(id), installed: true, authenticated: true, availability: "ready", capabilities: id === "ollama" ? ["text"] : ["filesystem", "terminal", "text"], current_model: id === "ollama" ? "test-local" : null };
}
type Launched = { task: OrchTask; finish: (result: AdapterResult) => void; hooks: AdapterHooks; stopped: boolean };
function fakeAdapter(id: ProviderId, launched: Launched[]): ProviderAdapter {
  return { id, detect: async () => ready(id), launch: (task, hooks) => {
    let finish!: (result: AdapterResult) => void; const done = new Promise<AdapterResult>((resolve) => (finish = resolve));
    const session: Launched = { task, finish, hooks, stopped: false }; launched.push(session);
    return { done, stop: async () => { session.stopped = true; finish({ ok: false, output: "", stopped: true }); } };
  } };
}
const until = async (check: () => boolean, label: string, timeout = 4000) => {
  const start = Date.now();
  while (!check()) { if (Date.now() - start > timeout) throw new Error(`Timed out waiting for ${label}`); await new Promise((r) => setTimeout(r, 10)); }
};
async function setup(options: { providers?: ProviderId[]; adapters?: (dir: string) => CapabilityAdapter[]; enabled?: boolean; dir?: string; root?: string } = {}) {
  const dir = options.dir ?? mkdtempSync(join(tmpdir(), "bunny-missions-"));
  const root = options.root ?? join(dir, "project"); mkdirSync(root, { recursive: true });
  const db = new HostDatabase(join(dir, "host.sqlite"));
  const launched: Launched[] = [];
  const tasks = new TaskManager(db, root, (options.providers ?? ["claude"]).map((id) => fakeAdapter(id, launched)));
  await tasks.discover();
  const notifications: string[] = [];
  const adapters = options.adapters?.(dir) ?? [new FilesystemCapability(), new TerminalCapability(), new NotificationsCapability((title) => notifications.push(title)), ...communicationConnectors()];
  const missions = new MissionManager(tasks, { dataDirectory: dir, adapters });
  if (options.enabled !== false) missions.configure({ enabled: true }, "test");
  await missions.bus.refreshHealth();
  const cleanup = async () => { await missions.close(); try { db.close(); } catch { /* already closed */ } rmSync(dir, { recursive: true, force: true }); };
  return { dir, root, db, tasks, missions, launched, notifications, cleanup };
}
const model = (role: string, objective: string, dependsOn: number[] = [], extra: Record<string, unknown> = {}) => ({ role, objective, dependsOn, executor: { kind: "model" }, ...extra });

// ── state machine / DAG ──────────────────────────────────────────────────────
test("mission and step state machines reject impossible transitions", () => {
  assert.ok(canMissionTransition("draft", "planning"));
  assert.ok(canMissionTransition("waiting_for_approval", "ready"));
  assert.ok(!canMissionTransition("draft", "running"), "a draft cannot run without planning and approval");
  assert.ok(!canMissionTransition("waiting_for_approval", "running"), "approval must pass through ready");
  assert.ok(!canMissionTransition("completed", "running"));
  assert.ok(!canMissionTransition("stopped", "ready"));
  assert.throws(() => assertMissionTransition("planning", "completed"), /Invalid mission transition/);
  assert.ok(canStepTransition("pending", "ready"));
  assert.ok(!canStepTransition("pending", "running"), "a step cannot skip readiness");
  assert.ok(!canStepTransition("completed", "ready"));
  assert.ok(canStepTransition("failed", "ready"), "explicit retry re-arms a failed step");
});
test("graph validation rejects cycles, unknown dependencies and oversize plans", () => {
  const limits = { maxSteps: 3 };
  assert.equal(validateGraph([{ id: "a", dependsOn: [] }, { id: "b", dependsOn: ["a"] }], limits), null);
  assert.match(validateGraph([{ id: "a", dependsOn: ["b"] }, { id: "b", dependsOn: ["a"] }], limits)!, /cycle/);
  assert.match(validateGraph([{ id: "a", dependsOn: ["zz"] }], limits)!, /unknown/);
  assert.match(validateGraph([{ id: "a", dependsOn: ["a"] }], limits)!, /itself/);
  assert.match(validateGraph(["a", "b", "c", "d"].map((id) => ({ id, dependsOn: [] })), limits)!, /limit is 3/);
  assert.match(validateGraph([], limits)!, /at least one/);
});
const step = (id: string, state: MissionStep["state"], dependsOn: string[] = [], weight: number | null = null) => ({ id, state, dependsOn, weight }) as MissionStep;
test("dependency scheduling: only steps whose dependencies completed are ready; independent steps are ready together", () => {
  const steps = [step("a", "pending"), step("b", "pending"), step("c", "pending", ["a", "b"])];
  assert.deepEqual(readySteps(steps).map((s) => s.id), ["a", "b"], "independent steps are ready in parallel");
  assert.deepEqual(readySteps([step("a", "completed"), step("b", "running"), step("c", "pending", ["a", "b"])]).map((s) => s.id), []);
  assert.deepEqual(readySteps([step("a", "completed"), step("b", "skipped"), step("c", "pending", ["a", "b"])]).map((s) => s.id), ["c"]);
  assert.deepEqual(blockedBy([step("a", "failed"), step("b", "pending", ["a"]), step("c", "pending", ["b"]), step("d", "pending")], "a").sort(), ["b", "c"]);
});
test("progress is derived from graph state only, weighted only when every step has a weight", () => {
  const plain = missionProgress([step("a", "completed"), step("b", "running"), step("c", "pending"), step("d", "failed")]);
  assert.deepEqual(plain, { kind: "steps", completed: 1, total: 4, failed: 1, running: 1 });
  const again = missionProgress([step("a", "completed"), step("b", "running"), step("c", "pending"), step("d", "failed")]);
  assert.deepEqual(again, plain, "the same graph state yields the same progress regardless of elapsed time");
  assert.equal(missionProgress([step("a", "completed", [], 3), step("b", "pending", [], 1)]).kind, "weighted");
  assert.equal(missionProgress([step("a", "completed", [], 3), step("b", "pending", [], null)]).kind, "steps", "partial weights are not invented");
  const weighted = missionProgress([step("a", "completed", [], 3), step("b", "running", [], 1)]);
  assert.ok(weighted.kind === "weighted" && weighted.completedWeight === 3 && weighted.totalWeight === 4);
});
test("retry policy is category-specific and bounded", () => {
  assert.equal(retryVerdict("user_stopped", 1, 5, 0, 10).retry, false);
  assert.equal(retryVerdict("permission_required", 1, 5, 0, 10).waitForUser, true);
  assert.equal(retryVerdict("host_restart", 1, 5, 0, 10).retry, false, "a dead stream is never auto-resumed");
  assert.deepEqual([retryVerdict("provider_rate_limited", 1, 2, 0, 10).retry, retryVerdict("provider_rate_limited", 1, 2, 0, 10).reroute], [true, true]);
  assert.equal(retryVerdict("verification_failed", 2, 2, 0, 10).retry, true);
  assert.equal(retryVerdict("verification_failed", 3, 2, 0, 10).retry, false, "per-step limit");
  assert.equal(retryVerdict("provider_failed", 1, 2, 10, 10).retry, false, "mission-wide limit");
  assert.equal(retryVerdict("dependency_failed", 1, 5, 0, 10).retry, false);
  assert.equal(classifyTaskFailure("Host process restarted; this adapter cannot reattach", "failed"), "host_restart");
  assert.equal(classifyTaskFailure("Runtime limit reached.", "stopped"), "timeout");
  assert.equal(classifyTaskFailure("HTTP 429 rate limit", "failed"), "provider_rate_limited");
});

// ── authorization ────────────────────────────────────────────────────────────
const manifest = (id: string, risk: ActionManifest["risk"], extra: Partial<ActionManifest> = {}): ActionManifest => ({ id, description: "", risk, inputs: [], outputs: "", evidence: "", timeoutMs: 1000, implemented: true, ...extra });
test("permission decisions: envelope scope, always-ask classes, grants and hard approvals", () => {
  const root = mkdtempSync(join(tmpdir(), "bunny-auth-"));
  try {
    const request = scopeFor([{ executor: { kind: "capability", action: "terminal.exec", params: { command: "npm", args: ["test"] } }, requiredCapabilities: ["filesystem.write"], verification: [], scope: { root, access: "write", isolation: "shared" }, providerConstraints: {} }], root, "balanced");
    const envelope = envelopeFrom(request, "m1", "workstation", 3_600_000);
    const ctx = { envelope, missionId: "m1", grants: [] };
    assert.equal(decide(manifest("filesystem.write", "WRITE"), { path: join(root, "a.txt") }, ctx).decision, "allow");
    assert.equal(decide(manifest("filesystem.write", "WRITE"), { path: join(tmpdir(), "outside.txt") }, ctx).decision, "ask", "outside the approved root asks");
    assert.equal(decide(manifest("terminal.exec", "EXECUTE"), { command: "npm", args: ["test"], cwd: root }, ctx).decision, "allow");
    assert.equal(decide(manifest("terminal.exec", "EXECUTE"), { command: "python", args: [] }, ctx).decision, "ask", "command not in the approved list");
    assert.equal(decide(manifest("filesystem.delete", "DESTRUCTIVE"), { path: join(root, "a.txt") }, ctx).decision, "ask", "destructive always asks");
    assert.equal(decide(manifest("browser.navigate", "READ"), { url: "https://example.com" }, ctx).decision, "ask", "browser was not part of the approved scope");
    assert.equal(decide(manifest("phone.start_call", "EXTERNAL_SIDE_EFFECT", { hardApproval: true }), {}, { ...ctx, grants: [{ action: "phone.*", scope: "global", policy: "always_allow" }] }).decision, "ask", "hard approval survives an always-allow grant");
    assert.equal(decide(manifest("filesystem.write", "WRITE"), { path: join(root, "a.txt") }, { ...ctx, grants: [{ action: "filesystem.*", scope: "global", policy: "never_allow" }] }).decision, "deny");
    assert.equal(decide(manifest("filesystem.write", "WRITE"), { path: join(root, "a.txt") }, { ...ctx, grants: [{ action: "filesystem.write", scope: "mission:m1", policy: "read_only" }] }).decision, "deny");
    assert.equal(decide(manifest("filesystem.write", "WRITE"), { path: join(root, "a.txt") }, { ...ctx, grants: [{ action: "filesystem.write", scope: "global", policy: "ask_every_time" }] }).decision, "ask");
    assert.equal(decide(manifest("x.y", "READ", { implemented: false }), {}, ctx).decision, "deny", "contract-only actions never run");
    assert.equal(decide(manifest("filesystem.write", "WRITE"), { path: join(root, "a.txt") }, { ...ctx, envelope: { ...envelope, revokedAt: Date.now() } }).decision, "deny");
    assert.equal(decide(manifest("filesystem.write", "WRITE"), { path: join(root, "a.txt") }, { ...ctx, envelope: { ...envelope, expiresAt: Date.now() - 1 } }).decision, "ask");
    assert.equal(decide(manifest("filesystem.write", "WRITE"), { path: "x" }, { envelope: null, missionId: null, grants: [] }).decision, "ask", "no envelope, no silent execution");
    assert.equal(decide(manifest("computer.capture", "READ", { sensitive: true }), {}, { envelope: null, missionId: null, grants: [], direct: { confirmed: false } }).decision, "ask", "privacy-sensitive direct actions need confirmation");
    assert.match(scopeViolation("git.merge", {}, envelope)!, /merge was not approved/);
    assert.match(taskViolation({ provider: "claude", cwd: root, decision: { recommended_provider: "claude" } }, envelope, false, 0)!, /provider execution was not approved/, "a capability-only mission cannot launch agents");
    const agents = { ...envelope, providers: { ...envelope.providers, execution: true } };
    assert.equal(taskViolation({ provider: "claude", cwd: root, decision: { recommended_provider: "claude" } }, agents, false, 0), null);
    assert.match(taskViolation({ provider: "claude", cwd: root, decision: { recommended_provider: "claude" } }, { ...agents, providers: { ...agents.providers, localOnly: true } }, false, 0)!, /local-only/);
    assert.match(taskViolation({ provider: "claude", cwd: root, decision: { recommended_provider: "claude" } }, agents, false, envelope.budget.maxExternalModelCalls)!, /budget/);
    assert.match(taskViolation({ provider: "claude", cwd: tmpdir(), decision: { recommended_provider: "claude" } }, agents, false, 0)!, /outside the approved project roots/);
    assert.equal(decide(manifest("filesystem.write", "WRITE"), { path: "relative.txt" }, { ...ctx, base: root }).decision, "allow", "relative paths resolve in the step's folder");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test("records redact secrets and private typed text", () => {
  assert.deepEqual(redact({ apiKey: "sk-123", nested: { password: "p", ok: 1 }, list: [{ token: "t" }] }), { apiKey: "[redacted]", nested: { password: "[redacted]", ok: 1 }, list: [{ token: "[redacted]" }] });
});

// ── planner ──────────────────────────────────────────────────────────────────
test("planner chooses the smallest competent graph and stays bounded", () => {
  const root = mkdtempSync(join(tmpdir(), "bunny-plan-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }));
  const base = { root, localOnly: false, available: () => true, limits: DEFAULT_CONFIG.limits };
  try {
    const tests = planMission({ ...base, objective: "Run the tests", mode: "balanced" });
    assert.equal(tests.steps.length, 1); assert.equal(tests.steps[0].executor.kind, "skill", "a known command needs no model");
    assert.equal(deterministicPlan("run tests and then build the project")!.length, 2);
    assert.deepEqual(deterministicPlan("run tests and then build the project")![1].dependsOn, ["s1"]);
    assert.equal(planMission({ ...base, objective: "Rename a variable in utils.ts", mode: "fast" }).steps.length, 1, "simple request: one step");
    assert.equal(planMission({ ...base, objective: "Draft a CONTRIBUTING guide for this project", mode: "fast" }).steps[0].access, "write", "a named file is a write");
    assert.equal(planMission({ ...base, objective: "Explain how the router scores providers", mode: "fast" }).steps[0].access, "read");
    const medium = planMission({ ...base, objective: "Implement input validation for the signup API handler and update the related form code, error messages and request helpers", mode: "balanced" });
    assert.ok(medium.steps.length >= 2 && medium.steps.length <= 3);
    assert.equal(medium.steps.filter((s) => s.access === "write").length, 1, "one writer");
    const complex = planMission({ ...base, objective: "Refactor the repository architecture for the distributed test harness migration across the codebase", mode: "deep" });
    assert.equal(complex.complexity, "complex");
    assert.ok(complex.steps.length <= DEFAULT_CONFIG.limits.maxSteps);
    assert.ok(complex.steps.some((s) => s.role === "Reviewer" && s.preferences.independentOf?.length), "deep coding gets an independent reviewer");
    const parallel = complex.steps.filter((s) => !s.dependsOn.length);
    assert.ok(parallel.length >= 2 && parallel.every((s) => s.access === "read"), "parallel steps are read-only");
    assert.ok(planMission({ ...base, available: (a) => !a.startsWith("terminal"), objective: "Run the tests", mode: "fast" }).steps.every((s) => s.executor.kind === "model"), "unavailable capability falls back to an agent");
    assert.throws(() => explicitPlan([model("A", "x", [1]), model("B", "y", [0])], { mode: "fast", limits: DEFAULT_CONFIG.limits }), /cycle/);
    assert.throws(() => explicitPlan(Array.from({ length: 13 }, (_, i) => model(`R${i}`, "x")), { mode: "fast", limits: DEFAULT_CONFIG.limits }), /limit is 12/);
    assert.throws(() => explicitPlan([{ role: "A; rm -rf", objective: "x" }], { mode: "fast", limits: DEFAULT_CONFIG.limits }), /plain role/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test("agent context carries only dependency summaries and references, never another agent's transcript", () => {
  const prompt = agentPrompt({ mission: { objective: "Ship docs", mode: "balanced" }, step: { role: "Writer", objective: "Write README", scope: { root: "C:/p", access: "read", isolation: "shared" }, expectedArtifacts: [] }, cwd: "C:/p", dependencies: [{ role: "Research", objective: "r", summary: "x".repeat(5000), artifacts: ["[artifact abc · research_note · 10 bytes]"], verified: null }], facts: ["Tests: passed (verified by Bunny)"] });
  assert.ok(prompt.length < 4000, "bounded context");
  assert.match(prompt, /read-only/); assert.match(prompt, /not independently verified/); assert.match(prompt, /artifact abc/);
});

// ── workspace ────────────────────────────────────────────────────────────────
test("workspace locks: readers share, writers are exclusive, nested folders conflict", () => {
  const db = new HostDatabase(":memory:"); const store = new MissionStore(db); const locks = new WorkspaceCoordinator(store);
  const root = mkdtempSync(join(tmpdir(), "bunny-lock-")); mkdirSync(join(root, "sub"));
  try {
    assert.ok(locks.acquire("m", "r1", root, "shared").ok);
    assert.ok(locks.acquire("m", "r2", root, "shared").ok, "two readers");
    assert.equal(locks.acquire("m", "w1", join(root, "sub"), "exclusive").ok, false, "writer inside a read-locked folder waits");
    locks.release("r1"); locks.release("r2");
    assert.ok(locks.acquire("m", "w1", join(root, "sub"), "exclusive").ok);
    assert.equal(locks.acquire("m2", "w2", root, "exclusive").ok, false, "parent folder conflicts with a locked child");
    assert.ok(locks.acquire("m", "w1", join(root, "sub"), "exclusive").ok, "re-acquire by the owner is idempotent");
  } finally { db.close(); rmSync(root, { recursive: true, force: true }); }
});

// ── integration through the real TaskManager ────────────────────────────────
test("model steps flow through TaskManager with delegated approval; direct approval is unchanged", async () => {
  const env = await setup();
  try {
    const direct = env.tasks.submit({ prompt: "Direct task", mode: "balanced" });
    assert.equal(direct.state, "waiting_for_approval");
    const view = env.missions.create({ objective: "Explain the module", mode: "fast", origin: "workstation", steps: [model("Research", "Explain the module")] });
    assert.equal(view.state, "waiting_for_approval");
    assert.equal(env.launched.length, 0, "nothing launches before mission approval");
    env.missions.approve(view.id, "workstation");
    await until(() => env.launched.length === 1, "child launch");
    const child = env.launched[0].task;
    assert.deepEqual(child.mission, { missionId: view.id, stepId: view.steps[0].id });
    const record = env.db.get(child.id);
    assert.equal(record.approval?.kind, "mission");
    assert.ok(env.db.taskEvents(child.id).some((e) => e.type === "approval.delegated" && /not this individual child task/.test(e.detail)));
    assert.ok(!env.db.taskEvents(child.id).some((e) => e.type === "approval.accepted"), "no fake user click");
    env.tasks.approve(direct.id);
    assert.ok(env.db.taskEvents(direct.id).some((e) => e.type === "approval.accepted"));
    assert.equal(env.db.get(direct.id).approval, undefined, "direct task records keep their original shape");
    assert.equal(env.db.get(direct.id).mission, undefined);
    env.launched[0].finish({ ok: true, output: "The module routes tasks.", exitCode: 0 });
    await until(() => env.missions.mission(view.id).state === "completed", "mission completion");
    const done = env.missions.get(view.id);
    assert.equal(done.mission.result?.verifiedSteps, 0);
    assert.match(done.mission.result!.summary, /without independent verification/, "provider prose is not verification");
    assert.equal(done.mission.artifacts.length, 1);
    assert.equal(done.mission.artifacts[0].location.kind, "inline");
    assert.ok(done.events.some((e) => e.type === "mission.completed"));
    assert.ok(done.events.some((e) => e.taskId === child.id), "mission timeline includes its child task events");
    env.launched[1].finish({ ok: true, output: "direct done" });
  } finally { await env.cleanup(); }
});

for (const provider of ["codex", "claude"] as const) test(`MA0R: custom read scope reaches ${provider} launch restrictions; role names grant nothing`, async () => {
  const env = await setup({ providers: [provider] });
  try {
    const view = env.missions.create({ objective: "Inspect", mode: "fast", origin: "workstation", steps: [model("Custom auditor", "Inspect files", [], { access: "read" })] });
    const approved = env.missions.approve(view.id, "workstation");
    await until(() => env.launched.length === 1, "read child");
    const child = env.launched[0].task;
    assert.deepEqual(child.executionScope, { access: "read" });
    const envelope = env.missions.store.authorization(approved.authorizationId!)!;
    assert.deepEqual(envelope.providers.sessions?.steps, [{ stepId: view.steps[0].id, scope: { access: "read" } }]);
    assert.equal(envelope.filesystem.write.length, 0);
    if (provider === "codex") assert.equal(codexLaunchArgs(child)[3], "read-only");
    else {
      const args = claudeLaunchArgs(child, "test-session");
      assert.equal(args[args.indexOf("--tools") + 1], "Read");
      assert.equal(args[args.indexOf("--allowedTools") + 1], "Read");
      assert.equal(args[args.indexOf("--permission-mode") + 1], "dontAsk");
      assert.ok(args.includes("--restricted"));
      assert.ok(!args.includes("acceptEdits"));
    }
    assert.throws(() => { child.executionScope!.access = "write"; }, TypeError, "provider cannot mutate its scope snapshot");
    assert.throws(() => { child.executionScope = { access: "write" }; }, TypeError);
    assert.throws(() => env.tasks.update(env.db.get(child.id), { executionScope: { access: "write" } }, "agent.output", "upgrade"), /immutable/);
    assert.throws(() => env.tasks.update(env.db.get(child.id), { executionScope: undefined }, "agent.output", "remove"), /immutable/);
    assert.deepEqual(env.db.get(child.id).executionScope, { access: "read" });
    env.launched[0].finish({ ok: true, output: "Read evidence" });
    await until(() => env.missions.mission(view.id).state === "completed", "done");
  } finally { await env.cleanup(); }
});

test("MA0R: explicit Research write scope has write/shell authority; unscoped direct tasks retain launch defaults", async () => {
  const env = await setup({ providers: ["codex"] });
  try {
    const view = env.missions.create({ objective: "Edit", mode: "fast", origin: "workstation", steps: [model("Research", "Edit file", [], { access: "write" })] });
    env.missions.approve(view.id, "workstation");
    await until(() => env.launched.length === 1, "writer");
    const child = env.launched[0].task;
    assert.deepEqual(child.executionScope, { access: "write" });
    assert.equal(codexLaunchArgs(child)[3], "workspace-write");
    assert.ok(claudeLaunchArgs(child, "session").includes("acceptEdits"));
    const direct = env.tasks.submit({ prompt: "Direct", mode: "fast" });
    assert.equal(direct.executionScope, undefined);
    assert.equal(codexLaunchArgs(direct)[3], "workspace-write");
    const directArgs = claudeLaunchArgs(direct, "session", "win32");
    assert.equal(directArgs[directArgs.indexOf("--allowedTools") + 1], "Read,Write,Edit,Bash,PowerShell");
    assert.ok(!directArgs.includes("--restricted"));
    env.launched[0].finish({ ok: true, output: "Done" });
    await until(() => env.missions.mission(view.id).state === "completed", "done");
  } finally { await env.cleanup(); }
});

test("MA0R: Codex to Claude reroute and explicit retry retain read authority", async () => {
  const env = await setup({ providers: ["codex", "claude"] });
  try {
    // Route to Codex first; changing provider never changes the stored scope.
    const view = env.missions.create({ objective: "Inspect", mode: "balanced", origin: "workstation", steps: [model("Auditor", "Inspect TypeScript source", [], { access: "read", maxRetries: 1 })] });
    const approved = env.missions.approve(view.id, "workstation", false);
    const envelope = env.missions.store.authorization(approved.authorizationId!)!;
    env.missions.store.saveAuthorization({ ...envelope, expiresAt: Date.now() - 1 });
    env.missions.start(env.missions.mission(view.id));
    await until(() => env.missions.store.requests(view.id).length === 1, "pending provider approval");
    const pending = env.db.get(env.missions.store.steps(view.id)[0].taskId!);
    env.tasks.retarget(pending.id, "codex");
    env.tasks.retarget(pending.id, "claude");
    assert.deepEqual(env.db.get(pending.id).executionScope, { access: "read" });
    env.missions.store.saveAuthorization(envelope);
    await env.missions.respond(env.missions.store.requests(view.id)[0].id, "allow_once", "workstation");
    await until(() => env.launched.length === 1, "Claude reroute");
    assert.equal(env.launched[0].task.provider, "claude");
    assert.equal(claudeLaunchArgs(env.launched[0].task, "session")[claudeLaunchArgs(env.launched[0].task, "session").indexOf("--tools") + 1], "Read");
    env.launched[0].finish({ ok: false, output: "", error: "provider crashed" });
    await until(() => env.launched.length === 2, "automatic retry");
    assert.deepEqual(env.launched[1].task.executionScope, { access: "read" });
    env.launched[1].finish({ ok: false, output: "", error: "provider crashed again" });
    await until(() => env.missions.mission(view.id).state === "failed", "failure");
    env.missions.retry(view.id, "workstation");
    await until(() => env.launched.length === 3, "explicit retry");
    assert.deepEqual(env.launched[2].task.executionScope, { access: "read" });
    env.launched[2].finish({ ok: true, output: "Read" });
    await until(() => env.missions.mission(view.id).state === "completed", "done");
  } finally { await env.cleanup(); }
});

test("MA0R: replan with write authority revokes read approval and cannot run until new approval", async () => {
  const env = await setup();
  try {
    const view = env.missions.create({ objective: "Inspect", mode: "fast", origin: "workstation", steps: [model("A", "Inspect", [], { access: "read", maxRetries: 0 })] });
    const approved = env.missions.approve(view.id, "workstation");
    await until(() => env.launched.length === 1, "reader");
    env.launched[0].finish({ ok: false, output: "", error: "failed" });
    await until(() => env.missions.mission(view.id).state === "failed", "failed");
    const next = await env.missions.replan(view.id, "workstation", [model("A", "Edit", [], { access: "write" })]);
    assert.equal(next.state, "waiting_for_approval");
    assert.equal(next.authorizationId, null);
    assert.ok(env.missions.store.authorization(approved.authorizationId!)?.revokedAt);
    await env.missions.tick(view.id);
    assert.equal(env.launched.length, 1, "new write step cannot use the old read approval");
    assert.throws(() => env.missions.retry(view.id, "workstation"));
    env.missions.approve(view.id, "workstation");
    await until(() => env.launched.length === 2, "newly approved writer");
    assert.deepEqual(env.launched[1].task.executionScope, { access: "write" });
    env.launched[1].finish({ ok: true, output: "Done" });
    await until(() => env.missions.mission(view.id).state === "completed", "done");
  } finally { await env.cleanup(); }
});

test("MA0R: child <= step <= envelope is enforced even on direct child approval", async () => {
  const env = await setup();
  try {
    const view = env.missions.create({ objective: "Inspect", mode: "fast", origin: "workstation", steps: [model("A", "Inspect", [], { access: "read" })] });
    const approved = env.missions.approve(view.id, "workstation", false);
    const delegation = { missionId: view.id, stepId: view.steps[0].id, cwd: env.root, executionScope: { access: "write" as const } };
    const excessive = env.tasks.submit({ prompt: "Forged write child", mode: "fast" }, delegation);
    assert.throws(() => env.tasks.approve(excessive.id), /child exceeds/);
    env.missions.setStep(view.steps[0], { scope: { ...view.steps[0].scope, access: "write" } });
    const read = env.tasks.submit({ prompt: "Read child", mode: "fast" }, { ...delegation, executionScope: { access: "read" } });
    assert.throws(() => env.tasks.approve(read.id), /step exceeds/);
    assert.equal(env.launched.length, 0);
    const persisted = env.missions.store.authorization(approved.authorizationId!)!;
    assert.equal(persisted.providers.sessions!.steps[0].scope.access, "read");
  } finally { await env.cleanup(); }
});

test("MA0R: phone approval serializes exactly the desktop authority and ignores client scope overrides", async () => {
  const env = await setup();
  try {
    const view = env.missions.create({ objective: "Inspect then edit", mode: "fast", origin: "workstation", steps: [model("A", "Inspect", [], { access: "read" }), model("B", "Edit", [0], { access: "write" })] });
    const before = JSON.parse(JSON.stringify(view.requestedScope));
    await missionCommand(env.missions, "mission.approve", { id: view.id, start: false, scope: { projectRoots: ["C:/"], providers: { execution: true } } }, { local: false, actor: "device:paired-phone" });
    const envelope = JSON.parse(JSON.stringify(env.missions.get(view.id).authorization)) as Record<string, unknown>;
    for (const key of ["id", "missionId", "grantedAt", "grantedBy", "expiresAt", "revokedAt"]) delete envelope[key];
    assert.deepEqual(envelope, before, "remote command uses Host-owned requested scope only");
    assert.ok(env.missions.get(view.id).events.some((event) => event.type === "approval.mission_envelope"));
    assert.ok(env.missions.get(view.id).events.some((event) => event.type === "approval.remote_device" && /paired-phone/.test(event.detail)));
  } finally { await env.cleanup(); }
});

test("MA0R: Allow this skill run covers matching actions in that run, within approved roots, and clears on completion", async () => {
  const env = await setup();
  try {
    const skill = { ...structuredClone(BUILTIN_SKILLS[0]), id: "test.two-writes", name: "Two writes", requirements: ["filesystem.write"], preconditions: [],
      steps: [{ action: "filesystem.write", label: "write a", params: { path: "a.txt", content: "A" } }, { action: "filesystem.write", label: "write b", params: { path: "b.txt", content: "B" } }],
      validations: [{ kind: "status_succeeded" as const, step: 0 }, { kind: "status_succeeded" as const, step: 1 }], cleanup: [] };
    env.missions.store.saveSkill(skill, true);
    const view = env.missions.create({ objective: "Skill", mode: "fast", origin: "workstation", steps: [{ role: "Skill", objective: "Run two writes", executor: { kind: "skill", skillId: skill.id, params: {} } }] });
    const approved = env.missions.approve(view.id, "workstation", false);
    const envelope = env.missions.store.authorization(approved.authorizationId!)!;
    env.missions.store.saveAuthorization({ ...envelope, capabilities: envelope.capabilities.filter((action) => action !== "filesystem.write") });
    env.missions.start(env.missions.mission(view.id));
    await until(() => env.missions.store.requests(view.id).length === 1, "skill permission");
    const request = env.missions.store.requests(view.id)[0];
    assert.equal(env.missions.store.runs({ missionId: view.id }).length, 0, "no write before consent");
    await env.missions.respond(request.id, "allow_once", "workstation");
    await until(() => env.missions.mission(view.id).state === "completed", "skill finished");
    assert.equal(readFileSync(join(env.root, "a.txt"), "utf8"), "A");
    assert.equal(readFileSync(join(env.root, "b.txt"), "utf8"), "B");
    assert.equal(env.missions.store.runs({ missionId: view.id }).filter((run) => run.action === "filesystem.write").length, 2);
    assert.equal(env.missions.store.steps(view.id)[0].approvedOnce, null);
    assert.ok(env.missions.get(view.id).events.some((event) => event.type === "approval.additional_capability" && /this skill run/.test(event.detail)));
    assert.equal(env.missions.bus.decision({ action: "filesystem.write", params: { path: "c.txt", content: "C" }, missionId: view.id, stepId: view.steps[0].id, envelope: env.missions.store.authorization(approved.authorizationId!)!, origin: "test", cwd: env.root, roots: [env.root] }).decision, "ask", "consent does not persist to later runs");
    const outside = await env.missions.skills.run(skill.id, {}, { missionId: view.id, stepId: view.steps[0].id, envelope, origin: "test", cwd: env.dir, roots: [env.root], oneTimeAction: "filesystem.write" });
    assert.equal(outside.ok, false, "a skill-run allowance never widens path roots");
    assert.ok(!existsSync(join(env.dir, "a.txt")));
  } finally { await env.cleanup(); }
});

test("MA0R: direct capability/skill cwd is validated before adapter execution; no directories are created", async () => {
  const env = await setup();
  try {
    writeFileSync(join(env.root, "file.txt"), "text");
    const missing = join(env.root, "does-not-exist");
    const invalid: unknown[] = ["", " ", "relative", missing, join(env.root, "file.txt"), env.dir, join(env.root, ".."), "https://example.com", `${env.root}\u0000bad`, null, 12];
    if (process.platform === "win32") invalid.push("\\\\localhost\\C$\\Windows", "C:relative", `${env.root}:stream`);
    for (const action of ["capability.run", "skill.run", "skill.verify"]) for (const cwd of invalid) await assert.rejects(missionCommand(env.missions, action, { cwd, action: "filesystem.list", id: "project.test", version: 1 }, { local: true, actor: "workstation" }));
    assert.equal(env.missions.store.runs().length, 0, "invalid cwd never reaches a capability");
    assert.ok(!existsSync(missing));
    const escaped = join(env.root, "escape");
    symlinkSync(env.dir, escaped, process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(missionCommand(env.missions, "capability.run", { cwd: escaped, action: "filesystem.list" }, { local: true, actor: "workstation" }), /outside/);
    mkdirSync(join(env.root, "sub"));
    const accepted = await missionCommand(env.missions, "capability.run", { cwd: join(env.root, "sub"), action: "filesystem.list" }, { local: true, actor: "workstation" });
    assert.ok(accepted.data, "existing approved subfolders stay compatible");
  } finally { await env.cleanup(); }
});
test("parallel-ready steps run concurrently; a dependent waits; results pass by reference", async () => {
  const env = await setup();
  try {
    const view = env.missions.create({ objective: "Parallel", mode: "balanced", origin: "workstation", steps: [model("Research", "A"), model("Architect", "B"), model("Writer", "C", [0, 1])] });
    env.missions.approve(view.id, "workstation");
    await until(() => env.launched.length === 2, "two parallel launches");
    assert.deepEqual(env.launched.map((l) => l.task.mission?.stepId).sort(), [view.steps[0].id, view.steps[1].id].sort());
    env.launched[0].finish({ ok: true, output: "Research finding: use SQLite." });
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(env.launched.length, 2, "the dependent waits for both");
    env.launched[1].finish({ ok: true, output: "Architecture: one table." });
    await until(() => env.launched.length === 3, "dependent launch");
    assert.match(env.launched[2].task.prompt, /Research finding: use SQLite/);
    assert.match(env.launched[2].task.prompt, /\[artifact [0-9a-f-]{36} ·/);
    const consumed = env.missions.store.artifacts(view.id).filter((a) => a.consumers.includes(view.steps[2].id));
    assert.equal(consumed.length, 2, "consumers recorded on the referenced artifacts");
    env.launched[2].finish({ ok: true, output: "Done" });
    await until(() => env.missions.mission(view.id).state === "completed", "completion");
    assert.deepEqual(env.missions.view(env.missions.mission(view.id)).progress, { kind: "steps", completed: 3, total: 3, failed: 0, running: 0 });
  } finally { await env.cleanup(); }
});
test("concurrency limit holds parallel agents to the configured maximum", async () => {
  const env = await setup();
  try {
    env.missions.configure({ limits: { maxConcurrentAgents: 1 } }, "test");
    const view = env.missions.create({ objective: "Two", mode: "fast", origin: "workstation", steps: [model("A", "a"), model("B", "b")] });
    env.missions.approve(view.id, "workstation");
    await until(() => env.launched.length === 1, "first");
    await new Promise((r) => setTimeout(r, 50)); assert.equal(env.launched.length, 1);
    env.launched[0].finish({ ok: true, output: "ok" });
    await until(() => env.launched.length === 2, "second after the first finishes");
    env.launched[1].finish({ ok: true, output: "ok" });
    await until(() => env.missions.mission(view.id).state === "completed", "done");
  } finally { await env.cleanup(); }
});
test("parallel writers on one workspace are serialized by the exclusive lock", async () => {
  const env = await setup();
  try {
    const view = env.missions.create({ objective: "Two writers", mode: "fast", origin: "workstation", steps: [model("A", "edit a", [], { access: "write" }), model("B", "edit b", [], { access: "write" })] });
    env.missions.approve(view.id, "workstation");
    await until(() => env.launched.length === 1, "one writer");
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(env.launched.length, 1, "the second writer waits for the workspace");
    assert.ok(env.missions.get(view.id).events.some((e) => e.type === "mission.step.waiting_workspace"));
    env.launched[0].finish({ ok: true, output: "a" });
    await until(() => env.launched.length === 2, "second writer after release");
    env.launched[1].finish({ ok: true, output: "b" });
    await until(() => env.missions.mission(view.id).state === "completed", "done");
  } finally { await env.cleanup(); }
});
test("dependency failure blocks dependents and fails the mission after bounded retries", async () => {
  const env = await setup();
  try {
    env.missions.configure({ limits: { maxRetriesPerStep: 1 } }, "test");
    const view = env.missions.create({ objective: "Fail", mode: "balanced", origin: "workstation", steps: [model("A", "a"), model("B", "b", [0]), model("C", "c")] });
    env.missions.approve(view.id, "workstation");
    await until(() => env.launched.length === 2, "A and C");
    const a = env.launched.find((l) => l.task.mission?.stepId === view.steps[0].id)!;
    const c = env.launched.find((l) => l.task.mission?.stepId === view.steps[2].id)!;
    a.finish({ ok: false, output: "", error: "provider crashed" });
    await until(() => env.launched.length === 3, "one bounded retry of A");
    assert.ok(env.launched[2].task.constraints?.providerDenylist === undefined || env.launched[2].task.provider === "claude");
    env.launched[2].finish({ ok: false, output: "", error: "provider crashed again" });
    c.finish({ ok: true, output: "independent branch fine" });
    await until(() => env.missions.mission(view.id).state === "failed", "mission failure");
    const steps = env.missions.store.steps(view.id);
    assert.equal(steps[0].state, "failed"); assert.equal(steps[0].attempts.length, 2, "retry history stored");
    assert.equal(steps[1].state, "blocked"); assert.equal(steps[1].failure?.category, "dependency_failed");
    assert.equal(steps[2].state, "completed", "the independent branch still completed");
    assert.equal(env.launched.length, 3, "no infinite retry loop");
    assert.ok(env.missions.inbox.recent().some((e) => e.kind === "failure" && e.missionId === view.id));
  } finally { await env.cleanup(); }
});
test("mission stop cancels only its own children and never auto-retries", async () => {
  const env = await setup();
  try {
    const unrelated = env.tasks.submit({ prompt: "Unrelated direct work", mode: "fast" }); env.tasks.approve(unrelated.id);
    const view = env.missions.create({ objective: "Long", mode: "fast", origin: "workstation", steps: [model("A", "a"), model("B", "b")] });
    env.missions.approve(view.id, "workstation");
    await until(() => env.launched.length === 3, "children");
    const stopped = await env.missions.stop(view.id, "workstation");
    assert.equal(stopped.state, "stopped");
    assert.deepEqual(env.launched.filter((l) => l.task.mission).map((l) => l.stopped), [true, true]);
    assert.equal(env.launched[0].stopped, false, "unrelated task untouched");
    assert.equal(env.db.get(unrelated.id).state, "running");
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(env.launched.length, 3, "user stop is not retried");
    assert.ok(env.missions.store.steps(view.id).every((s) => s.state === "stopped"));
    await assert.rejects(env.missions.stop(view.id, "workstation"), /already ended/);
    env.launched[0].finish({ ok: true, output: "unrelated done" });
  } finally { await env.cleanup(); }
});
test("out-of-envelope capability asks; deny fails the step; allow-once runs only that action", async () => {
  const env = await setup();
  try {
    const outside = join(tmpdir(), `bunny-outside-${Date.now()}.txt`);
    const view = env.missions.create({ objective: "Write", mode: "fast", origin: "workstation", steps: [{ role: "Writer", objective: "write", executor: { kind: "capability", action: "filesystem.write", params: { path: outside, content: "x" } } }, { role: "Notifier", objective: "notify", executor: { kind: "capability", action: "notifications.send", params: { title: "after" } } }] });
    env.missions.approve(view.id, "workstation");
    await until(() => env.missions.mission(view.id).state === "waiting_for_user", "permission wait");
    const request = env.missions.store.requests(view.id)[0];
    assert.equal(request.action, "filesystem.write"); assert.match(request.reason, /outside the approved write scope/);
    assert.ok(env.missions.inbox.recent().some((e) => e.kind === "requires_approval" && e.requestId === request.id));
    await env.missions.respond(request.id, "deny", "workstation");
    assert.ok(env.missions.inbox.recent().filter((e) => e.requestId === request.id).every((e) => e.acknowledgedAt), "answered requests leave the inbox");
    await until(() => ["failed"].includes(env.missions.mission(view.id).state), "failure after deny");
    assert.equal(env.missions.store.steps(view.id)[0].failure?.category, "permission_denied");
    assert.equal(env.missions.store.runs({ missionId: view.id }).filter((r) => r.action === "filesystem.write").length, 0, "nothing was written");
    // A fresh mission: allow once.
    const second = env.missions.create({ objective: "Write2", mode: "fast", origin: "workstation", steps: [{ role: "Writer", objective: "write", executor: { kind: "capability", action: "filesystem.write", params: { path: outside, content: "allowed once" } } }] });
    env.missions.approve(second.id, "workstation");
    await until(() => env.missions.store.requests(second.id).length === 1, "request");
    await env.missions.respond(env.missions.store.requests(second.id)[0].id, "allow_once", "device:phone");
    await until(() => env.missions.mission(second.id).state === "completed", "completion after allow once");
    assert.ok(env.missions.memory.entries(second.id).some((m) => m.kind === "user_decision" && m.verified && /allowed once/.test(m.key)));
    rmSync(outside, { force: true });
  } finally { await env.cleanup(); }
});
test("a child outside the envelope waits for the user; approving it launches it as a user approval", async () => {
  const env = await setup();
  try {
    const view = env.missions.create({ objective: "Child", mode: "fast", origin: "workstation", steps: [model("A", "a")] });
    const approved = env.missions.approve(view.id, "workstation", false);
    const envelope = env.missions.store.authorization(approved.authorizationId!)!;
    // An authorization that expired before launch: the child is routed but must not launch on the old approval.
    env.missions.store.saveAuthorization({ ...envelope, expiresAt: Date.now() - 1 });
    env.missions.start(env.missions.mission(view.id));
    await until(() => env.missions.store.requests(view.id).length === 1, "provider request");
    const request = env.missions.store.requests(view.id)[0];
    assert.equal(request.action, "provider.execute"); assert.match(request.reason, /authorization expired/);
    assert.equal(env.launched.length, 0, "nothing launched outside the envelope");
    await env.missions.respond(request.id, "allow_once", "workstation");
    await until(() => env.launched.length === 1, "launch after explicit approval");
    const child = env.db.get(env.launched[0].task.id);
    assert.equal(child.approval, undefined, "recorded as the user's own approval, not a delegated one");
    assert.ok(env.db.taskEvents(child.id).some((e) => e.type === "approval.accepted"));
    env.launched[0].finish({ ok: true, output: "done" });
    await until(() => env.missions.mission(view.id).state === "completed", "completion");
  } finally { await env.cleanup(); }
});
test("deterministic steps use zero model calls and verification is Bunny's own", async () => {
  const env = await setup();
  try {
    writeFileSync(join(env.root, "package.json"), JSON.stringify({ scripts: { test: "node -e \"process.exit(0)\"" } }));
    const view = env.missions.create({ objective: "Write and check", mode: "fast", origin: "workstation", steps: [
      { role: "Writer", objective: "write file", executor: { kind: "capability", action: "filesystem.write", params: { path: "out.txt", content: "BUNNY" } }, verification: [{ kind: "file_exists", path: "out.txt", contains: "BUNNY" }] },
      { role: "Checker", objective: "run node", dependsOn: [0], executor: { kind: "capability", action: "terminal.exec", params: { command: "node", args: ["-e", "console.log('ok')"] } }, verification: [{ kind: "command", command: "node", args: ["-e", "process.exit(3)"], expectExit: 3 }] },
    ] });
    env.missions.approve(view.id, "workstation");
    await until(() => ["completed", "failed", "waiting_for_user"].includes(env.missions.mission(view.id).state), "deterministic mission", 20_000);
    const done = env.missions.get(view.id);
    assert.equal(done.mission.state, "completed", JSON.stringify(done.mission.steps.map((s) => s.failure)));
    assert.equal(env.launched.length, 0, "no provider was used");
    assert.equal(done.mission.result?.verifiedSteps, 2);
    assert.equal(done.mission.accounting.externalModelCalls, 0);
    assert.ok(done.memory.some((m) => m.kind === "verified_fact" && m.verified));
    assert.ok(done.mission.steps.every((s) => s.accounting.deterministic));
  } finally { await env.cleanup(); }
});
test("a deterministic skill mission carries its own commands in the envelope and runs without extra prompts", async () => {
  const env = await setup();
  try {
    writeFileSync(join(env.root, "package.json"), JSON.stringify({ scripts: { test: "node -e \"console.log('demo ok')\"" } }));
    const view = env.missions.create({ objective: "Run the tests", mode: "fast", origin: "workstation" });
    assert.equal(view.requestedScope?.terminal.enabled, true);
    assert.deepEqual(view.requestedScope?.terminal.commands, ["npm"]);
    assert.ok(view.requestedScope?.terminal.executables?.length, "approval pins npm's real executable and CLI prefix");
    env.missions.approve(view.id, "workstation");
    await until(() => ["completed", "failed", "waiting_for_user"].includes(env.missions.mission(view.id).state), "skill mission", 30_000);
    assert.equal(env.missions.mission(view.id).state, "completed", JSON.stringify(env.missions.store.steps(view.id)[0].failure));
    assert.equal(env.missions.store.requests(view.id).length, 0, "no permission prompt for what was approved");
    assert.equal(env.launched.length, 0);
    assert.throws(() => env.missions.create({ objective: "x", mode: "fast", origin: "workstation", steps: [{ role: "A", objective: "a", executor: { kind: "skill", skillId: "no.such.skill" } }] }).state === "failed" ? (() => { throw new Error("planning failed"); })() : null, /planning failed/);
  } finally { await env.cleanup(); }
});
test("verification failure triggers a bounded repair attempt with the failure in context", async () => {
  const env = await setup();
  try {
    env.missions.configure({ limits: { maxRetriesPerStep: 1 } }, "test");
    const view = env.missions.create({ objective: "Make file", mode: "fast", origin: "workstation", steps: [model("Coding", "create done.txt", [], { access: "write", verification: [{ kind: "file_exists", path: "done.txt" }] })] });
    env.missions.approve(view.id, "workstation");
    await until(() => env.launched.length === 1, "first attempt");
    env.launched[0].finish({ ok: true, output: "I created done.txt and it works." });
    await until(() => env.launched.length === 2, "repair attempt");
    assert.match(env.launched[1].task.prompt, /did not pass Bunny's checks/);
    writeFileSync(join(env.root, "done.txt"), "ok");
    env.launched[1].finish({ ok: true, output: "fixed" });
    await until(() => env.missions.mission(view.id).state === "completed", "completion");
    const s = env.missions.store.steps(view.id)[0];
    assert.equal(s.attempts[0].category, "verification_failed"); assert.equal(s.result?.verified, true);
  } finally { await env.cleanup(); }
});
test("unconfigured connectors report unconfigured, never success", async () => {
  const env = await setup();
  try {
    const sms = env.missions.bus.list().find((c) => c.id === "sms")!;
    assert.equal(sms.availability, "unconfigured");
    assert.ok(sms.actions.every((a) => !a.implemented));
    const outcome = await env.missions.bus.request({ action: "phone.start_call", params: { to: "+10000000000" }, missionId: null, stepId: null, envelope: null, origin: "workstation", cwd: env.root, roots: [env.root], direct: { confirmed: true } });
    assert.notEqual(outcome.run?.status, "succeeded");
    assert.equal(outcome.decision.decision, "deny");
    const view = env.missions.create({ objective: "Text", mode: "fast", origin: "workstation", steps: [{ role: "Messenger", objective: "sms", executor: { kind: "capability", action: "sms.receive_message", params: {} } }] });
    env.missions.approve(view.id, "workstation");
    await until(() => ["failed", "waiting_for_user"].includes(env.missions.mission(view.id).state), "unconfigured outcome");
    const s = env.missions.store.steps(view.id)[0];
    assert.notEqual(s.state, "completed");
  } finally { await env.cleanup(); }
});
test("capability registry enforces namespacing and unique ids", async () => {
  const env = await setup();
  try {
    assert.throws(() => env.missions.bus.register(new FilesystemCapability()), /already registered/);
    const bad: CapabilityAdapter = { manifest: { id: "zzz", version: "1", description: "", locality: "local", platforms: "any", events: [], cost: { kind: "unknown", note: "" }, adapter: "", actions: [manifest("other.act", "READ")] }, health: async () => ({ availability: "available", detail: "" }), execute: async () => ({ ok: true, status: "succeeded", summary: "", output: null, evidence: [] }) };
    assert.throws(() => env.missions.bus.register(bad), /namespaced/);
    assert.equal(env.missions.bus.availability("nothing.here"), "unsupported");
  } finally { await env.cleanup(); }
});
test("feature flag off: mission commands refused, snapshot reports disabled, direct tasks unchanged", async () => {
  const env = await setup({ enabled: false });
  try {
    assert.throws(() => env.missions.create({ objective: "x", mode: "fast", origin: "workstation" }), /Missions are disabled/);
    assert.deepEqual(env.missions.snapshot().missions, []);
    assert.equal(env.missions.snapshot().enabled, false);
    const before = env.db.events().length;
    const task = env.tasks.submit({ prompt: "Direct", mode: "fast" }); env.tasks.approve(task.id);
    env.launched[0].finish({ ok: true, output: "done" });
    await until(() => env.db.get(task.id).state === "completed", "direct completion");
    assert.deepEqual(env.db.events().slice(before).map((e) => e.type).filter((t) => !t.startsWith("agent.") && t !== "session.recorded"), ["task.created", "routing.started", "approval.required", "approval.accepted", "executor.starting", "task.completed"]);
    assert.equal(env.missions.inbox.recent().length, 0, "no inbox writes while disabled");
  } finally { await env.cleanup(); }
});
test("budget: external model calls beyond the envelope fall back to local or fail as budget_exceeded", async () => {
  const env = await setup({ providers: ["claude"] });
  try {
    const view = env.missions.create({ objective: "Budget", mode: "fast", origin: "workstation", steps: [model("A", "a"), model("B", "b"), model("C", "c")] });
    const authorized = env.missions.approve(view.id, "workstation", false);
    const envelope = env.missions.store.authorization(authorized.authorizationId!)!;
    env.missions.store.saveAuthorization({ ...envelope, budget: { ...envelope.budget, maxExternalModelCalls: 2 } });
    env.missions.start(env.missions.mission(view.id));
    await until(() => env.missions.store.steps(view.id).some((s) => s.failure?.category === "budget_exceeded"), "budget failure");
    assert.equal(env.launched.length, 2, "only two cloud calls launched");
    for (const l of env.launched) l.finish({ ok: true, output: "ok" });
    await until(() => env.missions.store.steps(view.id).filter((s) => s.state === "completed").length === 2, "both launched steps recorded");
    assert.equal(env.missions.mission(view.id).state, "waiting_for_user", "budget exhaustion waits for the user instead of spending more");
    assert.equal(env.missions.mission(view.id).accounting.externalModelCalls, 2);
  } finally { await env.cleanup(); }
});
test("MA1: mission children are routed on the step objective, not on Bunny's agent-prompt boilerplate", async () => {
  // Before: "read-only: do not modify any files … approved working folder" inferred requiresFilesystem for every
  // mission model step, so text-only (local) providers were never eligible and local-only missions could not run.
  const env = await setup({ providers: ["claude", "ollama"] });
  try {
    const view = env.missions.create({ objective: "Text and file steps", mode: "fast", origin: "workstation", steps: [model("Writer", "Write two sentences about unit tests"), model("Reader", "Read the README file and list its headings")] });
    env.missions.approve(view.id, "workstation");
    await until(() => env.launched.length === 2, "both launches");
    const writer = env.launched.find((l) => l.task.routingPrompt === "Write two sentences about unit tests")!;
    const reader = env.launched.find((l) => l.task.routingPrompt === "Read the README file and list its headings")!;
    assert.match(writer.task.prompt, /do not modify any files/, "the provider still receives the full agent prompt");
    assert.equal(writer.task.constraints?.requiresFilesystem, false);
    assert.ok(writer.task.decision.eligible_providers?.includes("ollama"), "a text step may use a local text-only provider");
    assert.equal(reader.task.constraints?.requiresFilesystem, true, "file work in the objective still requires a filesystem-capable agent");
    assert.equal(reader.task.provider, "claude");
    for (const l of env.launched) l.finish({ ok: true, output: "done" });
    await until(() => env.missions.mission(view.id).state === "completed", "completion");
    // Retargeting keeps routing on the objective too.
    const direct = env.tasks.submit({ prompt: "Write two sentences about unit tests", mode: "fast" });
    assert.equal(direct.routingPrompt, undefined, "direct tasks are unchanged");
  } finally { await env.cleanup(); }
});
test("MA1: Ollama locality is per model: local-only missions get a local model; cloud-hosted tags count as external", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bunny-ma1-ollama-"));
  const root = join(dir, "project"); mkdirSync(root);
  const db = new HostDatabase(join(dir, "host.sqlite"));
  const launched: Launched[] = [];
  const base = fakeAdapter("ollama", launched);
  // As observed on the M-A-1 workstation: the first installed tag proxies to ollama.com.
  const ollama: ProviderAdapter = { ...base, detect: async () => ({ ...ready("ollama"), current_model: "deepseek-v4.1-flash:cloud", models: ["deepseek-v4.1-flash:cloud", "qwen2.5-coder:7b"], remoteModels: ["deepseek-v4.1-flash:cloud"] }) };
  const tasks = new TaskManager(db, root, [ollama]);
  await tasks.discover();
  const missions = new MissionManager(tasks, { dataDirectory: dir, adapters: [] });
  missions.configure({ enabled: true }, "test");
  try {
    const local = missions.create({ objective: "Summarize", mode: "fast", origin: "workstation", localOnly: true, steps: [model("Writer", "Summarize hello")] });
    missions.approve(local.id, "workstation");
    await until(() => launched.length === 1, "local launch");
    assert.equal(launched[0].task.model, "qwen2.5-coder:7b", "a local-only envelope never launches a cloud-hosted tag");
    launched[0].finish({ ok: true, output: "hello" });
    await until(() => missions.mission(local.id).state === "completed", "local completion");
    assert.equal(missions.mission(local.id).accounting.localModelCalls, 1);
    assert.equal(missions.mission(local.id).accounting.externalModelCalls, 0);

    const open = missions.create({ objective: "Summarize", mode: "fast", origin: "workstation", providers: ["ollama"], steps: [model("Writer", "Summarize hello")] });
    missions.approve(open.id, "workstation");
    await until(() => launched.length === 2, "open launch");
    assert.equal(launched[1].task.model, "deepseek-v4.1-flash:cloud", "unconstrained routing keeps the legacy default");
    launched[1].finish({ ok: true, output: "hello" });
    await until(() => missions.mission(open.id).state === "completed", "open completion");
    assert.equal(missions.mission(open.id).accounting.externalModelCalls, 1, "a cloud-hosted Ollama tag is an external model call");
    assert.equal(missions.mission(open.id).accounting.localModelCalls, 0);
  } finally { await missions.close(); db.close(); rmSync(dir, { recursive: true, force: true }); }
});
test("recovery after a Host restart: interrupted steps are reported, never resumed; retry starts a fresh child", async () => {
  const first = await setup();
  const dir = mkdtempSync(join(tmpdir(), "bunny-recover-"));
  let missionId = "";
  try {
    const view = first.missions.create({ objective: "Interrupted", mode: "fast", origin: "workstation", steps: [model("A", "a")] });
    missionId = view.id;
    first.missions.approve(view.id, "workstation");
    await until(() => first.launched.length === 1, "launch");
    // A crash leaves exactly the durable state at this instant: snapshot it and open it as a new Host.
    first.db.db.exec(`VACUUM INTO '${join(dir, "host.sqlite").replaceAll("'", "''")}'`);
  } catch (error) { await first.cleanup(); rmSync(dir, { recursive: true, force: true }); throw error; }
  const second = await setup({ dir, root: first.root });
  try {
    const mission = second.missions.mission(missionId);
    assert.equal(mission.state, "waiting_for_user");
    assert.ok(mission.recovery && /not resumed/.test(mission.recovery.detail));
    const s = second.missions.store.steps(missionId)[0];
    assert.equal(s.failure?.category, "host_restart"); assert.equal(s.attempts[0].outcome, "interrupted");
    const oldChild = second.db.get(s.attempts[0].taskId!);
    assert.equal(oldChild.state, "failed"); assert.match(oldChild.error!, /cannot reattach/);
    assert.ok(second.missions.get(missionId).events.some((e) => e.type === "mission.recovered"));
    assert.equal(second.launched.length, 0, "nothing was relaunched automatically");
    second.missions.retry(missionId, "workstation");
    await until(() => second.launched.length === 1, "fresh retry");
    assert.notEqual(second.launched[0].task.id, oldChild.id, "a new child task, not a resumed one");
    second.launched[0].finish({ ok: true, output: "fresh" });
    await until(() => second.missions.mission(missionId).state === "completed", "completion");
  } finally {
    await second.cleanup();
    // The old Host's mission layer is gone too, so ending its orphaned session schedules nothing.
    await first.missions.close();
    first.launched[0].finish({ ok: false, output: "", error: "old process gone" });
    await new Promise((r) => setTimeout(r, 30)); await first.cleanup();
  }
});
test("migration: a pre-M-A-0 database keeps every row and gains the additive schema idempotently", () => {
  const dir = mkdtempSync(join(tmpdir(), "bunny-migrate-"));
  const path = join(dir, "host.sqlite");
  try {
    // The v2 schema exactly as the previous Host created it, with data.
    const old = new DatabaseSync(path);
    old.exec(`CREATE TABLE tasks(id TEXT PRIMARY KEY, record TEXT NOT NULL); CREATE TABLE projects(id TEXT PRIMARY KEY, record TEXT NOT NULL);
      CREATE TABLE events(sequence INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, type TEXT NOT NULL, task_id TEXT, detail TEXT NOT NULL);
      CREATE TABLE outcomes(task_id TEXT PRIMARY KEY, provider TEXT NOT NULL, task_type TEXT NOT NULL, completed INTEGER NOT NULL, verified INTEGER NOT NULL, duration_ms INTEGER NOT NULL);
      CREATE TABLE devices(id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT NOT NULL, created_at INTEGER NOT NULL, revoked_at INTEGER);
      CREATE TABLE migrations(key TEXT PRIMARY KEY); PRAGMA user_version=2;`);
    const oldTask = JSON.stringify({ id: "old-1", title: "Old", prompt: "Old", projectId: null, mode: "fast", state: "completed", provider: "codex", model: "m", decision: { task_type: "general" }, manual: false, createdAt: 1, startedAt: 1, finishedAt: 2, output: "x", error: null, logs: [], pauseSupported: false });
    old.prepare("INSERT INTO tasks VALUES(?,?)").run("old-1", oldTask);
    old.prepare("INSERT INTO events(at,type,task_id,detail) VALUES(?,?,?,?)").run(5, "task.completed", "old-1", "done");
    old.prepare("INSERT INTO devices VALUES(?,?,?,?,NULL)").run("d1", "Phone", "hash", 3);
    old.close();
    for (let open = 0; open < 2; open++) {
      const db = new HostDatabase(path); const store = new MissionStore(db);
      assert.equal(db.db.prepare("SELECT record FROM tasks WHERE id='old-1'").get()!.record, oldTask, "task record byte-identical");
      assert.deepEqual(db.events().map((e) => [e.type, e.taskId, e.detail, e.missionId]), [["task.completed", "old-1", "done", null]]);
      assert.equal((db.db.prepare("SELECT COUNT(*) n FROM devices").get() as { n: number }).n, 1);
      assert.equal((db.db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version, 3);
      assert.equal(db.db.prepare("SELECT key FROM migrations WHERE key='ma0.missions.v1'").get()!.key, "ma0.missions.v1");
      assert.deepEqual(store.missions(), []);
      assert.equal(db.get("old-1").state, "completed");
      db.close();
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("MA0R migration: old mission JSON stays byte-identical and missing provider authority fails closed", async () => {
  const env = await setup();
  try {
    const view = env.missions.create({ objective: "Old approval", mode: "fast", origin: "workstation", steps: [model("Research", "inspect", [], { access: "read" })] });
    const mission = env.missions.mission(view.id);
    delete mission.requestedScope!.providers.sessions;
    env.missions.store.saveMission(mission);
    const envelope = envelopeFrom(mission.requestedScope!, view.id, "workstation", 60_000);
    env.missions.store.saveAuthorization(envelope);
    const direct = env.tasks.submit({ prompt: "Legacy direct", mode: "fast" });
    const tables = ["tasks", "missions", "mission_steps", "mission_authorizations"];
    const records = (db: HostDatabase) => tables.map((table) => db.db.prepare(`SELECT record FROM ${table} ORDER BY id`).all());
    const before = records(env.db);
    await env.missions.close(); env.db.close();
    for (let reopen = 0; reopen < 2; reopen++) {
      const db = new HostDatabase(join(env.dir, "host.sqlite")); const store = new MissionStore(db);
      try {
        assert.deepEqual(records(db), before, "no JSON records rewritten or upgraded");
        assert.equal(db.get(direct.id).executionScope, undefined, "legacy direct tasks remain unscoped");
        assert.equal(store.mission(view.id).requestedScope!.providers.sessions, undefined);
        assert.match(taskViolation({ ...direct, cwd: env.root, mission: { missionId: view.id, stepId: view.steps[0].id }, executionScope: { access: "read" } }, store.authorization(envelope.id)!, false, 0, Date.now(), view.steps[0])!, /authority is missing/);
      } finally { db.close(); }
    }
    assert.equal(env.launched.length, 0, "migration starts no provider");
  } finally { await env.cleanup(); }
});
