import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostDatabase } from "../bunny-host/persistence.server.ts";
import { ModelCapabilityRegistry } from "../bunny-host/model-capability.server.ts";
import { TaskManager } from "../bunny-host/manager.server.ts";
import { startHost } from "../bunny-host/http.server.ts";
import { providerBase, claudeLaunchArgs, codexLaunchArgs } from "../bunny-host/adapters.server.ts";
import type { AdapterHooks, AdapterResult, ProviderAdapter } from "../bunny-host/contracts.ts";
import { AgentRuntime } from "../bunny-host/agent-runtime.server.ts";
import { authorizeBridge } from "../orch/host-bridge.server.ts";
import type { OrchTask, ProviderId, ProviderLive } from "../orch/types.ts";
import { MissionManager } from "./manager.server.ts";
import { missionCommand } from "./commands.server.ts";
import { FilesystemCapability, GitCapability, NotificationsCapability, TerminalCapability } from "./capabilities/local.server.ts";
import type { CapabilityAdapter } from "./capabilities/bus.server.ts";
import {
  capabilityOperation, decide, DESKTOP_GRANT_TTL_MS, desktopGrantViolation, envelopeFrom, isRemoteEnvelope, providerSessionAuthority,
  executionConfigPath, redactReviewListing, remoteExecutionRefusal, scopeFor, sessionOperation, taskViolation, touchesGitMetadata, type DesktopGrantContext,
  classifyDeviceWrite,
} from "./authorization.server.ts";
import type { ActionManifest, DesktopGrant, MissionStep } from "./types.ts";
import { simulatedCodexProfile } from "../bunny-host/testing/codex.test.ts";

/**
 * M-A-3 T9R-F01: a paired device never authorizes command or code execution, directly or indirectly, through any
 * provider. Every case drives the actual MissionManager / TaskManager / CapabilityBus / Host HTTP boundary.
 */
const PHONE = "device:t9r-f01-phone";
const DESKTOP_ONLY = /Approval required on Windows Host/;

function ready(id: ProviderId): ProviderLive {
  return { ...providerBase(id), installed: true, authenticated: true, availability: "ready", capabilities: id === "ollama" ? ["text"] : ["filesystem", "terminal", "text"], current_model: id === "ollama" ? "test-local" : null, ...(id === "codex" ? { securityCompatibility: simulatedCodexProfile() } : {}) };
}
type Launched = { task: OrchTask; finish: (result: AdapterResult) => void; hooks: AdapterHooks };
function fakeAdapter(id: ProviderId, launched: Launched[]): ProviderAdapter {
  return { id, detect: async () => ready(id), launch: (task, hooks) => {
    let finish!: (result: AdapterResult) => void; const done = new Promise<AdapterResult>((resolve) => (finish = resolve));
    launched.push({ task, finish, hooks });
    return { done, stop: async () => finish({ ok: false, output: "", stopped: true }) };
  } };
}
const until = async (check: () => boolean, label: string, timeout = 5000) => {
  const start = Date.now();
  while (!check()) { if (Date.now() - start > timeout) throw new Error(`Timed out waiting for ${label}`); await new Promise((r) => setTimeout(r, 10)); }
};
const settle = () => new Promise((r) => setTimeout(r, 60));
async function open(dir: string, root: string, providers: ProviderId[], launched: Launched[], adapters?: CapabilityAdapter[]) {
  const db = new HostDatabase(join(dir, "host.sqlite"));
  const tasks = new TaskManager(db, root, providers.map((id) => fakeAdapter(id, launched)), { modelRegistry: new ModelCapabilityRegistry(db, { availableProviders: () => [] }) });
  await tasks.discover();
  const missions = new MissionManager(tasks, { dataDirectory: dir, adapters: adapters ?? [new FilesystemCapability(), new TerminalCapability(), new NotificationsCapability(() => {})] });
  missions.configure({ enabled: true }, "workstation");
  await missions.bus.refreshHealth();
  return { db, tasks, missions };
}
async function setup(options: { providers?: ProviderId[]; adapters?: CapabilityAdapter[] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "bunny-t9r-f01-"));
  const root = join(dir, "project"); mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "seed.txt"), "seed");
  writeFileSync(join(root, "probe.mjs"), "import { writeFileSync } from 'node:fs'; writeFileSync('ran.txt', 'ran');");
  writeFileSync(join(root, "other.mjs"), "import { writeFileSync } from 'node:fs'; writeFileSync('other.txt', 'other');");
  const launched: Launched[] = [];
  const providers = options.providers ?? ["claude"];
  let current = await open(dir, root, providers, launched, options.adapters);
  const env = {
    dir, root, launched, providers,
    get db() { return current.db; }, get tasks() { return current.tasks; }, get missions() { return current.missions; },
    /** A real Host restart over the same SQLite state: new TaskManager/MissionManager, new epoch. */
    restart: async () => { await current.missions.close(); current.db.close(); current = await open(dir, root, providers, launched, options.adapters); },
    // Unfinished fake sessions would keep the Task runtime timers alive; end them like a Stop would.
    cleanup: async () => { for (const session of launched) session.finish({ ok: false, output: "", stopped: true }); await settle(); await current.missions.close(); try { current.db.close(); } catch { /* closed */ } rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); },
  };
  return env;
}
type Env = Awaited<ReturnType<typeof setup>>;
const model = (role: string, objective: string, extra: Record<string, unknown> = {}) => ({ role, objective, dependsOn: [], executor: { kind: "model" }, ...extra });
const capability = (role: string, action: string, params: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ role, objective: `${role} step`, dependsOn: [], executor: { kind: "capability", action, params }, ...extra });
const phoneApprove = (env: Env, id: string, start = true, plan?: string) =>
  missionCommand(env.missions, "mission.approve", { id, start, ...(plan ? { plan } : {}) }, { local: false, actor: PHONE });
const phoneRespond = (env: Env, requestId: string, decision: "allow_once" | "allow_batch" | "deny") =>
  missionCommand(env.missions, "mission.respond", { requestId, decision }, { local: false, actor: PHONE });
const pending = (env: Env, missionId: string) => env.missions.store.requests(missionId).find((request) => !request.resolvedAt);
async function waitAsk(env: Env, missionId: string, action: string) {
  await until(() => !!pending(env, missionId) && pending(env, missionId)!.action === action, `${action} ask`);
  return pending(env, missionId)!;
}
const claudeTools = (task: OrchTask) => { const args = claudeLaunchArgs(task, "s", "win32"); return args[args.indexOf("--allowedTools") + 1]; };
/**
 * M-A-3 T9R-F02: a paired-device write is staged in Host-owned inert storage and reaches the project only when the
 * workstation promotes the exact staged bytes. A device can never answer that promotion.
 */
async function promoteStaged(env: Env, missionId: string) {
  const ask = await waitAsk(env, missionId, "filesystem.promote");
  assert.equal(ask.desktopRequired, true, "the promotion is workstation-only");
  await env.missions.respond(ask.id, "allow_once", "workstation");
  return ask;
}
/**
 * F02 staging means device writes no longer land unreviewed, so the review gate (Host-wide: code waits for unreviewed
 * paired-device changes) is exercised as defense in depth: this seeds an UNREVIEWED paired-device change on disk and
 * records it exactly as a device write used to be recorded.
 */
const seedUnreviewed = (env: Env, path: string, content: string, missionId: string | null = null) => {
  const absolute = join(env.root, path);
  writeFileSync(absolute, content);
  return env.missions.store.recordRemoteChange({ runId: "seed", missionId, path: absolute, root: env.root, actor: PHONE });
};

// ── 1. bounded file operation ────────────────────────────────────────────────
test("F01-1: a phone-approved bounded file operation runs without any extra prompt", async () => {
  const env = await setup();
  try {
    const view = env.missions.create({ objective: "Write a note", mode: "fast", origin: "workstation", steps: [capability("Write", "filesystem.write", { path: "note.txt", content: "from phone", overwrite: true })] });
    await phoneApprove(env, view.id);
    // F02: the phone's bounded write is staged; the only prompt is the workstation promotion, never a write prompt.
    const promotion = await waitAsk(env, view.id, "filesystem.promote");
    assert.equal(env.missions.store.requests(view.id).length, 1, "no write prompt for bounded non-sensitive work");
    assert.equal(existsSync(join(env.root, "note.txt")), false, "staged, not written to the project");
    await assert.rejects(phoneRespond(env, promotion.id, "allow_once"), DESKTOP_ONLY, "a device cannot promote its own staged write");
    await env.missions.respond(promotion.id, "allow_once", "workstation");
    await until(() => env.missions.mission(view.id).state === "completed", "bounded write completed");
    assert.equal(readFileSync(join(env.root, "note.txt"), "utf8"), "from phone");
    assert.equal(env.missions.get(view.id).authorization!.authority?.kind, "remote");
    assert.equal(env.launched.length, 0);
  } finally { await env.cleanup(); }
});

// ── 2/3. unrestricted Claude shell and equivalent Codex execution ─────────────
for (const [provider, access] of [["claude", "write"], ["codex", "write"], ["codex", "read"]] as const)
  test(`F01-${provider === "claude" ? 2 : 3}: a phone cannot authorize a ${provider} ${access} session (shell); it stays a workstation-only ask`, async () => {
    const env = await setup({ providers: [provider] });
    try {
      const view = env.missions.create({ objective: "Edit code", mode: "fast", origin: "workstation", steps: [model("Coder", "Change the code", { access, maxRetries: 0 })] });
      await phoneApprove(env, view.id);
      const ask = await waitAsk(env, view.id, "provider.execute");
      assert.equal(ask.desktopRequired, true);
      assert.equal(ask.desktopOperation?.kind, "provider_session");
      assert.match(ask.reason, DESKTOP_ONLY);
      for (const decision of ["allow_once", "allow_batch"] as const)
        await assert.rejects(phoneRespond(env, ask.id, decision), DESKTOP_ONLY, `phone ${decision} is refused`);
      // Neither another remote actor string nor a direct child approval launches it.
      await assert.rejects(env.missions.respond(ask.id, "allow_once", "agent:helper"), DESKTOP_ONLY);
      const child = env.missions.store.step(ask.stepId).taskId!;
      assert.throws(() => env.tasks.approve(child, "workstation"), DESKTOP_ONLY, "a bare approve has no desktop grant");
      await settle();
      assert.equal(env.launched.length, 0, `no ${provider} session started`);
      assert.equal(pending(env, view.id)?.id, ask.id, "the ask stays open for the workstation");
      assert.equal(env.missions.mission(view.id).state, "waiting_for_user");
      const persisted = env.missions.get(view.id).authorization!;
      assert.match(taskViolation({ ...env.tasks.db.get(child) }, persisted, false, 0) ?? "", DESKTOP_ONLY);
    } finally { await env.cleanup(); }
  });

test("F01-2b: the trusted workstation answer launches exactly that session once, with its exact argv", async () => {
  const env = await setup({ providers: ["claude"] });
  try {
    const view = env.missions.create({ objective: "Edit code", mode: "fast", origin: "workstation", steps: [model("Coder", "Change the code", { access: "write", maxRetries: 0 })] });
    await phoneApprove(env, view.id);
    const ask = await waitAsk(env, view.id, "provider.execute");
    await env.missions.respond(ask.id, "allow_once", "workstation");
    await until(() => env.launched.length === 1, "desktop-approved launch");
    const grant = env.missions.store.request(ask.id).desktopGrant!;
    assert.equal(grant.grantedBy, "workstation");
    assert.equal(grant.uses, 1, "the final launch check spent the single use");
    assert.equal(grant.epoch, env.tasks.instanceId);
    assert.equal(grant.operation.kind === "provider_session" && grant.operation.sessionAuthority, "shell");
    assert.match(claudeTools(env.launched[0].task), /Bash/, "the workstation explicitly authorized this shell session");
    assert.ok(env.missions.get(view.id).events.some((event) => event.type === "approval.desktop_grant"));
    assert.ok(env.missions.get(view.id).events.some((event) => event.type === "approval.desktop_grant_used"));
    assert.match(env.tasks.missionScopeCheck!(env.launched[0].task) ?? "", DESKTOP_ONLY, "a used grant never covers a relaunch");
  } finally { await env.cleanup(); }
});

// ── 4. reroute / fallback / model switch ─────────────────────────────────────
test("F01-4: a phone-approved Ollama session cannot reroute or fall back to Claude/Codex tool execution", async () => {
  const env = await setup({ providers: ["ollama", "claude", "codex"] });
  try {
    const view = env.missions.create({ objective: "Summarize", mode: "fast", origin: "workstation", localOnly: true, steps: [model("Writer", "Summarize locally", { access: "read", maxRetries: 0 })] });
    await phoneApprove(env, view.id);
    await until(() => env.launched.length === 1, "ollama launch");
    const child = env.launched[0].task;
    assert.equal(child.provider, "ollama");
    assert.equal(env.tasks.missionScopeCheck!(child), null, "tool-free inference is inside remote authority");
    // The exact check used by launch-time reroute and by every relaunch (retry, escalate, reroute, larger context).
    for (const phase of ["check", "launch"] as const) {
      assert.match(env.tasks.missionScopeCheck!({ ...child, provider: "codex", model: "gpt-test" }, phase) ?? "", DESKTOP_ONLY);
      assert.equal(env.tasks.missionScopeCheck!({ ...child, provider: "claude", model: "auto" }, phase), null, "Claude read keeps only the Read tool");
    }
    env.launched[0].finish({ ok: true, output: "Summary." });
    await until(() => env.missions.mission(view.id).state === "completed", "local read completed");
    // A write step under the same remote envelope: Ollama is fine, Claude/Codex write is shell.
    const write = env.missions.create({ objective: "Edit", mode: "fast", origin: "workstation", steps: [model("Coder", "Edit", { access: "write", maxRetries: 0 })] });
    await phoneApprove(env, write.id);
    const ask = await waitAsk(env, write.id, "provider.execute");
    const writeChild = env.tasks.db.get(env.missions.store.step(ask.stepId).taskId!);
    assert.equal(env.tasks.missionScopeCheck!({ ...writeChild, provider: "ollama", model: "test-local" }), null);
    for (const provider of ["claude", "codex", "opencode", "cline", "cursor"] as ProviderId[])
      assert.match(env.tasks.missionScopeCheck!({ ...writeChild, provider }) ?? "", DESKTOP_ONLY, `${provider} write is refused`);
    await settle();
    assert.deepEqual(env.launched.map((l) => l.task.provider), ["ollama"]);
  } finally { await env.cleanup(); }
});

test("F01-4b: remote routing prefers in-ceiling providers so benign reads need no prompt", async () => {
  const env = await setup({ providers: ["codex", "claude"] });
  try {
    const view = env.missions.create({ objective: "Inspect", mode: "fast", origin: "workstation", steps: [model("Reader", "Inspect files", { access: "read" })] });
    await phoneApprove(env, view.id);
    await until(() => env.launched.length === 1, "read launch");
    assert.equal(env.launched[0].task.provider, "claude", "codex (runs commands) is avoided under remote authority");
    assert.deepEqual(claudeLaunchArgs(env.launched[0].task, "s", "win32").slice(claudeLaunchArgs(env.launched[0].task, "s", "win32").indexOf("--tools"), claudeLaunchArgs(env.launched[0].task, "s", "win32").indexOf("--tools") + 2), ["--tools", "Read"]);
    assert.doesNotMatch(claudeTools(env.launched[0].task), /Bash|PowerShell|Write|Edit/);
    assert.equal(env.missions.store.requests(view.id).length, 0);
  } finally { await env.cleanup(); }
});

// ── 5. Retry cannot reuse a denied or spent approval ─────────────────────────
test("F01-5: Retry never reuses a denied shell approval, and a spent grant never covers the retried session", async () => {
  const env = await setup({ providers: ["claude"] });
  try {
    const denied = env.missions.create({ objective: "Edit", mode: "fast", origin: "workstation", steps: [model("Coder", "Edit", { access: "write", maxRetries: 0 })] });
    await phoneApprove(env, denied.id);
    const first = await waitAsk(env, denied.id, "provider.execute");
    await env.missions.respond(first.id, "deny", "workstation");
    await until(() => env.missions.mission(denied.id).state === "failed", "denied step failed");
    env.missions.retry(denied.id, "workstation");
    const again = await waitAsk(env, denied.id, "provider.execute");
    assert.notEqual(again.id, first.id);
    assert.equal(again.desktopRequired, true, "Retry asks again; the denial is never converted into authority");
    await assert.rejects(phoneRespond(env, again.id, "allow_once"), DESKTOP_ONLY);
    assert.equal(env.launched.length, 0);
    await assert.rejects(missionCommand(env.missions, "mission.retry", { id: denied.id }, { local: false, actor: PHONE }), /workstation/);

    const spent = env.missions.create({ objective: "Edit", mode: "fast", origin: "workstation", steps: [model("Coder", "Edit", { access: "write", maxRetries: 1 })] });
    await phoneApprove(env, spent.id);
    const ask = await waitAsk(env, spent.id, "provider.execute");
    await env.missions.respond(ask.id, "allow_once", "workstation");
    await until(() => env.launched.length === 1, "single desktop-approved session");
    env.launched[0].finish({ ok: false, output: "", error: "provider crashed" });
    // T13.3 N-C (owner decision 2026-10-14): a write session that crashed after dispatch is no longer retried
    // automatically; it waits for reconciliation. The F01 property is kept on the reconciled retry instead.
    await until(() => env.missions.store.steps(spent.id)[0].reconciliation?.required === true, "uncertain outcome recorded");
    await settle();
    assert.equal(env.launched.length, 1, "no automatic replay");
    await env.missions.reconcile(spent.id, env.missions.store.steps(spent.id)[0].id, "retry", "workstation");
    const retry = await waitAsk(env, spent.id, "provider.execute");
    assert.notEqual(retry.id, ask.id, "the reconciled retry asks for fresh desktop authority");
    await settle();
    assert.equal(env.launched.length, 1, "no second shell session from the spent grant");
  } finally { await env.cleanup(); }
});

// ── 6. Replan into shell execution needs separate authorization ───────────────
test("F01-6: replanning a bounded task into shell execution requires separate authorization; old grants die", async () => {
  const env = await setup({ providers: ["claude"] });
  try {
    const view = env.missions.create({ objective: "Edit", mode: "fast", origin: "workstation", steps: [model("Coder", "Edit", { access: "write", maxRetries: 0 })] });
    await phoneApprove(env, view.id);
    const ask = await waitAsk(env, view.id, "provider.execute");
    // Hold the launch so the minted grant stays unused, then replan underneath it.
    const approve = env.tasks.approve.bind(env.tasks);
    env.tasks.approve = (() => env.tasks.db.get(env.missions.store.step(ask.stepId).taskId!)) as typeof env.tasks.approve;
    await env.missions.respond(ask.id, "allow_once", "workstation");
    env.tasks.approve = approve;
    const oldChild = env.tasks.db.get(env.missions.store.step(ask.stepId).taskId!);
    await env.missions.stop(view.id, "workstation").catch(() => {});
    assert.notEqual(env.missions.store.request(ask.id).desktopGrant!.revokedAt, null, "Stop ends the unused grant");
    const bounded = env.missions.create({ objective: "Inspect", mode: "fast", origin: "workstation", steps: [model("Reader", "Inspect", { access: "read", maxRetries: 0 })] });
    await phoneApprove(env, bounded.id);
    await until(() => env.launched.length === 1, "phone-approved bounded read");
    assert.equal(env.launched[0].task.executionScope?.access, "read");
    env.launched[0].finish({ ok: false, output: "", error: "provider crashed" });
    await until(() => env.missions.mission(bounded.id).state === "failed", "bounded read failed");
    const before = env.missions.agenticPlanReference(bounded.id);
    await env.missions.replan(bounded.id, "workstation", [model("Coder", "Now edit and run the build", { access: "write", maxRetries: 0 })]);
    assert.equal(env.missions.mission(bounded.id).authorizationId, null, "the phone approval did not survive the replan");
    const after = env.missions.agenticPlanReference(bounded.id);
    assert.notEqual(after, before);
    await assert.rejects(phoneApprove(env, bounded.id, true), /revised/, "an unbound approval of a revised plan is refused");
    await assert.rejects(phoneApprove(env, bounded.id, true, before), /plan changed/, "a stale plan reference is refused");
    await phoneApprove(env, bounded.id, true, after);
    const shell = await waitAsk(env, bounded.id, "provider.execute");
    assert.equal(shell.desktopRequired, true, "the replanned shell step needs its own trusted-desktop authorization");
    assert.match(env.tasks.missionScopeCheck!(oldChild) ?? "", /revoked|Approval required/, "the old grant never covers anything");
    await settle();
    assert.equal(env.launched.length, 1, "only the original bounded read ever launched");
  } finally { await env.cleanup(); }
});

// ── terminal / scripts / task runners / Git / computer ────────────────────────
test("F01-T: terminal commands in a phone-approved Mission run only under an exact single-use workstation grant", async () => {
  const env = await setup();
  try {
    const view = env.missions.create({ objective: "Run probe", mode: "fast", origin: "workstation", steps: [capability("Run", "terminal.exec", { command: "node", args: ["probe.mjs"] })] });
    await phoneApprove(env, view.id);
    const ask = await waitAsk(env, view.id, "terminal.exec");
    assert.equal(ask.desktopRequired, true);
    assert.equal(ask.batchOffer, null, "never offered as a batch");
    assert.equal(ask.desktopOperation?.kind, "capability");
    await assert.rejects(phoneRespond(env, ask.id, "allow_once"), DESKTOP_ONLY);
    await settle();
    assert.ok(!existsSync(join(env.root, "ran.txt")), "nothing ran before the workstation answered");
    await env.missions.respond(ask.id, "allow_once", "workstation");
    await until(() => env.missions.mission(view.id).state === "completed", "terminal step completed");
    assert.equal(readFileSync(join(env.root, "ran.txt"), "utf8"), "ran");
    assert.equal(env.missions.store.request(ask.id).desktopGrant!.uses, 1);
    // Replay: the same grant cannot run a different command/arguments/folder, nor the same one again.
    const mission = env.missions.mission(view.id); const step = env.missions.store.steps(view.id)[0];
    const envelope = env.missions.store.authorization(mission.authorizationId!)!;
    for (const params of [{ command: "node", args: ["other.mjs"] }, { command: "node", args: ["probe.mjs"] }]) {
      const out = await env.missions.bus.request({ ...env.missions.capabilityRequest(mission, { ...step, approvedOnce: { requestId: ask.id, action: "terminal.exec" } }, envelope, "terminal.exec", params, env.root) });
      assert.equal(out.decision.decision, "ask"); assert.equal(out.decision.desktopRequired, true); assert.equal(out.run, null);
    }
    assert.ok(!existsSync(join(env.root, "other.txt")));
  } finally { await env.cleanup(); }
});

test("F01-T2: a device never answers code-execution asks even inside a workstation-approved Mission", async () => {
  const env = await setup();
  try {
    const view = env.missions.create({ objective: "Run probe", mode: "fast", origin: "workstation", steps: [capability("Run", "terminal.exec", { command: "node", args: ["probe.mjs"] })] });
    env.missions.approve(view.id, "workstation", false);
    const envelope = env.missions.store.authorization(env.missions.mission(view.id).authorizationId!)!;
    env.missions.store.saveAuthorization({ ...envelope, terminal: { ...envelope.terminal, commands: [], executables: [] } }); // force an out-of-envelope ask
    env.missions.start(env.missions.mission(view.id));
    const ask = await waitAsk(env, view.id, "terminal.exec");
    assert.notEqual(ask.desktopRequired, true, "workstation envelope: an ordinary ask");
    await assert.rejects(phoneRespond(env, ask.id, "allow_once"), DESKTOP_ONLY, "a phone one-time answer can never run a program");
    assert.equal(env.missions.deviceRequestRefusal(ask) !== null, true);
    assert.equal(env.missions.remoteVerdicts(env.missions.snapshot()).missions.find((m) => m.id === view.id)!.requests.find((r) => r.id === ask.id)!.remote!.answerable, false);
    await settle();
    assert.ok(!existsSync(join(env.root, "ran.txt")));
  } finally { await env.cleanup(); }
});

test("F01-T3: remote authority classifies interpreters, Git hooks, Git metadata, arbitrary windows and unknown risk as desktop-only", () => {
  const exec = (id: string): ActionManifest => ({ id, description: "", risk: "EXECUTE", inputs: [], outputs: "", evidence: "", timeoutMs: 1000, implemented: true });
  const write = (id: string): ActionManifest => ({ ...exec(id), risk: "WRITE" });
  const request = scopeFor([{ executor: { kind: "capability", action: "filesystem.write", params: {} }, requiredCapabilities: ["computer.open_app", "computer.invoke_control", "git.commit"], verification: [], scope: { access: "write", isolation: "shared" }, providerConstraints: {}, crossApp: undefined } as unknown as MissionStep], "C:/p", "fast");
  const remote = envelopeFrom({ ...request, computer: { enabled: true }, git: { actions: ["commit", "merge", "worktree", "status"] } }, "m1", PHONE, 60_000);
  const desk = { ...remote, grantedBy: "workstation", authority: { kind: "workstation" as const }, providers: { ...remote.providers, sessions: { ...remote.providers.sessions!, writeIncludesShell: true } } };
  assert.equal(isRemoteEnvelope(remote), true); assert.equal(isRemoteEnvelope(desk), false);
  assert.equal(isRemoteEnvelope({ ...desk, authority: undefined, grantedBy: "device:old" }), true, "older JSON is judged by grantedBy");
  assert.equal(isRemoteEnvelope({ ...desk, grantedBy: "workstation", providers: { ...desk.providers, sessions: { ...desk.providers.sessions, writeIncludesShell: false } } }), true, "any remote marker wins over a workstation label");
  const ctx = { envelope: remote, missionId: "m1", grants: [{ action: "*", scope: "global", policy: "always_allow" as const }], base: "C:/p", oneTime: true };
  for (const [manifest, params] of [
    [exec("terminal.exec"), { command: "node", args: ["-e", "1"] }],
    [exec("computer.open_app"), { app: "explorer" }],
    [exec("computer.open_app"), { app: "terminal" }],
    [exec("computer.type"), { title: "Calculator", text: "1" }],
    [exec("computer.invoke_control"), { title: "PowerShell", automationId: "x" }],
    [write("git.commit"), { message: "x" }],
    [write("git.merge"), { branch: "bunny/x" }],
    [write("git.worktree_add"), { name: "x" }],
    [write("filesystem.write"), { path: ".git/hooks/pre-commit", content: "calc" }],
    [write("filesystem.write"), { path: "C:/p/.GIT/config", content: "x" }],
  ] as [ActionManifest, Record<string, unknown>][]) {
    const decision = decide(manifest, params, ctx);
    assert.equal(decision.decision, "ask", `${manifest.id} ${JSON.stringify(params)}`);
    assert.equal(decision.desktopRequired, true, "neither oneTime nor a standing always_allow rule lifts remote authority");
    assert.equal(decide(manifest, params, { ...ctx, envelope: desk }).desktopRequired, undefined, "workstation envelopes keep their existing behavior");
  }
  assert.equal(remoteExecutionRefusal("computer.open_app", { app: "calculator" }, "EXECUTE"), null, "exact reviewed Calculator operations stay remote-approvable");
  assert.equal(remoteExecutionRefusal("computer.invoke_control", { title: "Calculator", automationId: "num1Button" }, "EXECUTE"), null);
  assert.equal(remoteExecutionRefusal("filesystem.write", { path: "notes.txt" }, "WRITE", "C:/p"), null);
  assert.match(remoteExecutionRefusal("filesystem.read", {}, "UNKNOWN" as never) ?? "", DESKTOP_ONLY, "unknown risk fails closed");
  assert.equal(decide(exec("terminal.exec"), { command: "node" }, { ...ctx, desktopGrant: true }).decision, "allow", "only a validated desktop grant lifts it");
});

test("F01-T4: Git reads under remote authority never run repository-configured programs (external diff)", async () => {
  const { GitCapability } = await import("./capabilities/local.server.ts");
  const { spawnSync } = await import("node:child_process");
  const dir = mkdtempSync(join(tmpdir(), "bunny-t9r-f01-git-"));
  try {
    const repo = join(dir, "repo"); mkdirSync(repo);
    const git = (...args: string[]) => assert.equal(spawnSync("git", args, { cwd: repo, windowsHide: true }).status, 0, args.join(" "));
    git("init", "-q"); git("config", "user.email", "f01@example.invalid"); git("config", "user.name", "F01");
    writeFileSync(join(repo, "a.txt"), "one"); git("add", "a.txt"); git("commit", "-q", "-m", "init");
    // A repository-configured external diff program: it records that it ran.
    writeFileSync(join(dir, "extdiff.mjs"), "import { writeFileSync } from 'node:fs'; writeFileSync(process.argv[2], 'ran'); ");
    const marker = join(dir, "extdiff-ran.txt");
    git("config", "diff.external", `"${process.execPath.replaceAll("\\", "/")}" "${join(dir, "extdiff.mjs").replaceAll("\\", "/")}" "${marker.replaceAll("\\", "/")}"`);
    writeFileSync(join(repo, "a.txt"), "two");
    const adapter = new GitCapability(dir);
    const context = { missionId: null, stepId: null, cwd: repo, roots: [repo], dataDirectory: dir, signal: new AbortController().signal, timeoutMs: 30_000 };
    const remote = await adapter.execute("git.diff", {}, { ...context, remoteAuthority: true });
    assert.equal(remote.ok, true, remote.summary);
    assert.ok(!existsSync(marker), "remote authority: the configured external diff program did not run");
    await adapter.execute("git.diff", {}, context);
    assert.ok(existsSync(marker), "control: without remote authority Git runs the owner's configured program (existing behavior)");
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});

test("F01-T5: re-consent of an Agent with bound scripts is a workstation-only answer", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bunny-t9r-f01-agent-"));
  const root = join(dir, "project"); mkdirSync(root); writeFileSync(join(root, "seed.txt"), "seed"); writeFileSync(join(root, "check.mjs"), "console.log('ok')");
  const db = new HostDatabase(join(dir, "host.sqlite"));
  const tasks = new TaskManager(db, root, [], { modelRegistry: new ModelCapabilityRegistry(db, { availableProviders: () => [] }) }); await tasks.discover();
  const missions = new MissionManager(tasks, { dataDirectory: dir, adapters: [new FilesystemCapability(), new TerminalCapability()] });
  missions.configure({ enabled: true }, "workstation"); await missions.bus.refreshHealth(); missions.schedule = () => {};
  const agents = new AgentRuntime(db, missions); missions.missionPauseGate = id => agents.blockedForMission(id);
  try {
    const step = (action: string, params: Record<string, unknown>) => ({ role: "Probe", objective: "Check", access: "read", executor: { kind: "capability", action, params } });
    const row = agents.create({ name: "F01 agent", objective: "Run the bounded check", steps: [step("filesystem.read", { path: "seed.txt" }), step("terminal.exec", { command: "node", args: ["check.mjs"] })] }, "workstation").agents[0];
    missions.proposeAgentAuthorization(row.id, { maximumActions: 5 });
    agents.start(row.id, "workstation", missions.agentic.forMission(row.missionId!)!.revision);
    assert.match(missions.deviceAgenticRefusal(row.missionId!) ?? "", DESKTOP_ONLY, "a device cannot re-consent bound script execution");
  } finally { agents.close(); await missions.close(); db.close(); rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});

// ── 7/11. HTTP: revocation and forged desktop claims ─────────────────────────
async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}
async function hostFixture() {
  const directory = mkdtempSync(join(tmpdir(), "bunny-t9r-f01-http-"));
  const root = join(directory, "project"); mkdirSync(root); writeFileSync(join(root, "seed.txt"), "seed");
  const port = await freePort();
  const launched: Launched[] = [];
  const host = await startHost({ dataDirectory: directory, root, port, adapters: [fakeAdapter("claude", launched)],
    sample: async () => ({ at: Date.now(), cpu: { utilization: null, clockMhz: null, temperatureC: null }, memory: { usedBytes: 0, availableBytes: 1, totalBytes: 1 }, gpus: [], notes: ["F01 disposable telemetry"] }) });
  const base = `http://127.0.0.1:${port}`;
  const api = async (action: string, data: unknown = {}, token = host.token, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) => {
    const response = await fetch(`${base}/command`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...headers }, body: JSON.stringify({ action, data, ...extra }) });
    return { status: response.status, body: (await response.json()) as Record<string, any> };
  };
  const pair = async () => {
    const code = (await api("pairing.create")).body.pairCode;
    return (await (await fetch(`${base}/pair`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, name: "F01 disposable phone" }) })).json()) as { token: string; deviceId: string };
  };
  assert.equal((await api("mission.configure", { enabled: true })).status, 200);
  const mission = async (steps: unknown[]) => (await api("mission.create", { objective: "F01", mode: "fast", steps })).body.mission as { id: string };
  const get = async (id: string) => { const data = (await api("mission.get", { id })).body.data as Record<string, any>; return { ...data.mission, authorization: data.authorization } as Record<string, any>; };
  const close = async () => { await host.close(); rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); };
  return { host, base, api, pair, mission, get, close, launched };
}
const pollUntil = async (check: () => Promise<boolean>, label: string) => { const start = Date.now(); while (!(await check())) { if (Date.now() - start > 15_000) throw new Error(`Timed out waiting for ${label}`); await new Promise((r) => setTimeout(r, 25)); } };

// M-A-3 T9R-F02 (D5): self sign-out and workstation revocation both end the device's authority: the envelopes it granted
// are revoked and the Missions they drive stop. Both variants are asserted (the sign-out variant was disabled before F02).
test("F01-7: workstation revocation of a device ends every outstanding approval it granted", { timeout: 120_000 }, async () => {
  const f = await hostFixture();
  try {
    const writeStep = [{ role: "Coder", objective: "Edit", access: "write", maxRetries: 0, executor: { kind: "model" } }];
    for (const signOut of [false, true]) {
      const phone = await f.pair();
      const waiting = await f.mission(writeStep);
      const ready = await f.mission([{ role: "Reader", objective: "Read", access: "read", executor: { kind: "model" } }]);
      assert.equal((await f.api("mission.approve", { id: waiting.id }, phone.token)).status, 200);
      assert.equal((await f.api("mission.approve", { id: ready.id, start: false }, phone.token)).status, 200);
      await pollUntil(async () => (await f.get(waiting.id)).requests.some((r: { resolvedAt: number | null; desktopRequired?: boolean }) => !r.resolvedAt && r.desktopRequired), "desktop ask");
      const ask = (await f.get(waiting.id)).requests.find((r: { resolvedAt: number | null }) => !r.resolvedAt);
      const revoked = signOut ? await f.api("device.revoke", {}, phone.token) : await f.api("device.revoke", { id: phone.deviceId });
      assert.equal(revoked.status, 200, JSON.stringify(revoked.body));
      for (const id of [waiting.id, ready.id]) {
        const view = await f.get(id);
        assert.ok(view.authorization.revokedAt, `${signOut ? "sign-out" : "revoke"} revoked ${id}`);
        assert.equal(view.state, "stopped");
      }
      const late = await f.api("mission.respond", { requestId: ask.id, decision: "allow_once" });
      assert.notEqual(late.status, 200, "an outstanding ask cannot be revived after revocation");
      assert.equal((await f.api("mission.retry", { id: waiting.id })).status === 200, false);
    }
    assert.equal(f.launched.length, 0, "no provider session ever started from a revoked device's approval");
  } finally { await f.close(); }
});

test("F01-11: a forged desktop-origin claim on a remote transport is denied (Host and gateway)", { timeout: 120_000 }, async () => {
  const f = await hostFixture();
  try {
    const phone = await f.pair();
    const m = await f.mission([{ role: "Coder", objective: "Edit", access: "write", maxRetries: 0, executor: { kind: "model" } }]);
    assert.equal((await f.api("mission.approve", { id: m.id }, phone.token)).status, 200);
    await pollUntil(async () => (await f.get(m.id)).requests.some((r: { resolvedAt: number | null }) => !r.resolvedAt), "ask");
    const ask = (await f.get(m.id)).requests.find((r: { resolvedAt: number | null }) => !r.resolvedAt);
    const forged = { "x-bunny-local": "1", "x-bunny-desktop": "true", "x-forwarded-for": "127.0.0.1", "x-real-ip": "127.0.0.1", "x-actor": "workstation", origin: f.base };
    const answers = [
      await f.api("mission.respond", { requestId: ask.id, decision: "allow_once" }, phone.token, { actor: "workstation", local: true, desktop: true }, forged),
      await f.api("mission.respond", { requestId: ask.id, decision: "allow_once", actor: "workstation", by: "workstation", desktop: true }, phone.token, {}, forged),
      await f.api("approve", { id: ask.stepId }, phone.token, { local: true }, forged),
      await f.api("capability.run", { action: "terminal.exec", params: { command: "node" }, confirmed: true }, phone.token, { local: true }, forged),
      await f.api("mission.configure", { enabled: true }, phone.token, { local: true }, forged),
    ];
    for (const answer of answers) assert.notEqual(answer.status, 200, JSON.stringify(answer.body));
    const view = await f.get(m.id);
    assert.equal(view.requests.find((r: { id: string }) => r.id === ask.id).resolvedAt, null, "the forged answer changed nothing");
    assert.equal(view.authorization.authority.kind, "remote");
    assert.equal(f.launched.length, 0);
    // Gateway: a request that reaches the loopback listener with a rewritten Host but a device credential or proxy
    // marker is remote, never the workstation.
    const req = (headers: Record<string, string>) => new Request("http://localhost:8080/x", { headers });
    assert.throws(() => authorizeBridge(req({ cookie: "bunny_device=stolen" }), "127.0.0.1"), /workstation authentication/);
    for (const header of ["via", "cdn-loop", "true-client-ip", "x-client-ip", "cf-ray", "x-forwarded-for"])
      assert.throws(() => authorizeBridge(req({ [header]: "1" }), "127.0.0.1"), /workstation authentication/, header);
    assert.deepEqual(authorizeBridge(req({}), "127.0.0.1"), { local: true, token: null }, "the real local workstation is unchanged");
  } finally { await f.close(); }
});

// ── 8. Host restart ─────────────────────────────────────────────────────────
test("F01-8: a Host restart rejects stale remote approvals and trusted-desktop grants from the earlier epoch", async () => {
  const env = await setup({ providers: ["claude"] });
  try {
    const ready = env.missions.create({ objective: "Read", mode: "fast", origin: "workstation", steps: [model("Reader", "Read", { access: "read" })] });
    await phoneApprove(env, ready.id, false);
    const write = env.missions.create({ objective: "Edit", mode: "fast", origin: "workstation", steps: [model("Coder", "Edit", { access: "write", maxRetries: 0 })] });
    await phoneApprove(env, write.id);
    const ask = await waitAsk(env, write.id, "provider.execute");
    const approve = env.tasks.approve.bind(env.tasks);
    env.tasks.approve = (() => env.tasks.db.get(env.missions.store.step(ask.stepId).taskId!)) as typeof env.tasks.approve;
    await env.missions.respond(ask.id, "allow_once", "workstation"); // an unused grant, held across the restart
    env.tasks.approve = approve;
    const epoch = env.tasks.instanceId;
    const child = env.tasks.db.get(env.missions.store.step(ask.stepId).taskId!);
    await env.restart();
    assert.notEqual(env.tasks.instanceId, epoch);
    for (const id of [ready.id, write.id]) {
      const mission = env.missions.mission(id);
      assert.ok(env.missions.store.authorization(mission.authorizationId!)!.revokedAt, "remote authority ends with its epoch");
      assert.notEqual(mission.state, "running");
    }
    assert.equal(env.missions.mission(ready.id).state, "waiting_for_user", "a ready phone-approved Mission is not auto-started");
    assert.match(desktopGrantViolation(env.missions.store.request(ask.id).desktopGrant, env.missions.desktopContext(write.id, ask.stepId, sessionOperation(child))) ?? "", /earlier Host epoch/);
    assert.match(env.tasks.missionScopeCheck!(child) ?? "", /revoked/);
    assert.throws(() => env.missions.retry(write.id, "workstation"), /revoked|authorization|Retry|retry/i, "Retry cannot revive it");
    await settle();
    assert.equal(env.launched.length, 0);
  } finally { await env.cleanup(); }
});

// ── 9. Concurrent phone/desktop race ─────────────────────────────────────────
test("F01-9: concurrent phone and desktop answers never elevate remote authority", async () => {
  for (const order of ["phone-first", "desktop-first"]) {
    const env = await setup({ providers: ["claude"] });
    try {
      const view = env.missions.create({ objective: "Edit", mode: "fast", origin: "workstation", steps: [model("Coder", "Edit", { access: "write", maxRetries: 0 })] });
      // Both answers are submitted before either is applied; each runs as its own microtask in the stated order.
      const phone = () => phoneApprove(env, view.id, false);
      const desktop = () => env.missions.approve(view.id, "workstation", false);
      const approvals = order === "phone-first"
        ? [Promise.resolve().then(phone), Promise.resolve().then(desktop)]
        : [Promise.resolve().then(desktop), Promise.resolve().then(phone)];
      const results = await Promise.allSettled(approvals);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1, "exactly one approval wins");
      const envelope = env.missions.get(view.id).authorization!;
      assert.equal(envelope.authority?.kind, order === "phone-first" ? "remote" : "workstation");
      assert.equal(envelope.providers.sessions!.writeIncludesShell, order !== "phone-first");
    } finally { await env.cleanup(); }
  }
  const env = await setup({ providers: ["claude"] });
  try {
    const view = env.missions.create({ objective: "Edit", mode: "fast", origin: "workstation", steps: [model("Coder", "Edit", { access: "write", maxRetries: 0 })] });
    await phoneApprove(env, view.id);
    const ask = await waitAsk(env, view.id, "provider.execute");
    const results = await Promise.allSettled([phoneRespond(env, ask.id, "allow_once"), phoneRespond(env, ask.id, "allow_batch"), env.missions.respond(ask.id, "allow_once", "workstation"), phoneRespond(env, ask.id, "allow_once")]);
    assert.deepEqual(results.map((r) => r.status), ["rejected", "rejected", "fulfilled", "rejected"]);
    const answered = env.missions.store.request(ask.id);
    assert.equal(answered.resolvedBy, "workstation"); assert.equal(answered.desktopGrant!.grantedBy, "workstation");
    await until(() => env.launched.length === 1, "one launch");
    await settle();
    assert.equal(env.launched.length, 1, "at most one effect");
    env.launched[0].finish({ ok: true, output: "Edited." });
    await until(() => env.missions.mission(view.id).state === "completed", "first Mission completed");
    // Deny from the phone first: deny is always available and nothing launches afterwards.
    const second = env.missions.create({ objective: "Edit", mode: "fast", origin: "workstation", steps: [model("Coder", "Edit", { access: "write", maxRetries: 0 })] });
    await phoneApprove(env, second.id);
    const ask2 = await waitAsk(env, second.id, "provider.execute");
    const raced = await Promise.allSettled([phoneRespond(env, ask2.id, "deny"), env.missions.respond(ask2.id, "allow_once", "workstation")]);
    assert.deepEqual(raced.map((r) => r.status), ["fulfilled", "rejected"]);
    assert.equal(env.missions.store.request(ask2.id).desktopGrant, undefined);
    await settle();
    assert.equal(env.launched.length, 1);
  } finally { await env.cleanup(); }
});

// ── 10. exact binding of a trusted-desktop grant ─────────────────────────────
test("F01-10: a trusted-desktop grant cannot be replayed for another target, command, folder, Mission, plan, Task, Host or epoch", () => {
  const operation = capabilityOperation("terminal.exec", { command: "node", args: ["probe.mjs"] }, "C:/p", { file: "C:/node.exe", prefix: [], display: "node" });
  const context: DesktopGrantContext = { hostId: "host-a", epoch: "epoch-1", missionId: "m1", agentId: null, stepId: "s1", taskId: null, planReference: "plan-1", authorizationId: "env-1", operation, mutationSequence: 7, now: 1_000 };
  const { now: _now, ...bindings } = context;
  const grant: DesktopGrant = { id: "g", requestId: "r", ...bindings, grantedBy: "workstation", grantedAt: 900, expiresAt: 900 + DESKTOP_GRANT_TTL_MS, maxUses: 1, uses: 0, revokedAt: null };
  assert.equal(desktopGrantViolation(grant, context), null);
  const cases: [string, Partial<DesktopGrantContext>, RegExp][] = [
    ["command", { operation: capabilityOperation("terminal.exec", { command: "python", args: ["probe.mjs"] }, "C:/p", { file: "C:/node.exe", prefix: [], display: "node" }) }, /operation differs/],
    ["arguments", { operation: capabilityOperation("terminal.exec", { command: "node", args: ["-e", "x"] }, "C:/p", { file: "C:/node.exe", prefix: [], display: "node" }) }, /operation differs/],
    ["folder", { operation: capabilityOperation("terminal.exec", { command: "node", args: ["probe.mjs"] }, "C:/q", { file: "C:/node.exe", prefix: [], display: "node" }) }, /operation differs/],
    ["executable", { operation: capabilityOperation("terminal.exec", { command: "node", args: ["probe.mjs"] }, "C:/p", { file: "C:/evil/node.exe", prefix: [], display: "node" }) }, /operation differs/],
    ["target provider", { operation: sessionOperation({ provider: "claude", model: "m", cwd: "C:/p", executionScope: { access: "write" } }) }, /operation differs/],
    ["Mission", { missionId: "m2" }, /another Mission/],
    ["step", { stepId: "s2" }, /another Mission/],
    ["Task", { taskId: "t9" }, /another Mission/],
    ["Agent", { agentId: "agent-x" }, /another Mission/],
    ["plan", { planReference: "plan-2" }, /plan changed/],
    ["envelope", { authorizationId: "env-2" }, /authorization changed/],
    ["Host", { hostId: "host-b" }, /another Host/],
    ["epoch", { epoch: "epoch-2" }, /earlier Host epoch/],
    ["expiry", { now: 900 + DESKTOP_GRANT_TTL_MS }, /expired/],
    ["project files changed", { mutationSequence: 8 }, /Project files changed/],
  ];
  for (const [label, change, pattern] of cases) assert.match(desktopGrantViolation(grant, { ...context, ...change }) ?? "", pattern, label);
  assert.match(desktopGrantViolation({ ...grant, uses: 1 }, context) ?? "", /already used/);
  assert.match(desktopGrantViolation({ ...grant, maxUses: 5 }, context) ?? "", /already used/, "a widened use count is refused");
  assert.match(desktopGrantViolation({ ...grant, revokedAt: 950 }, context) ?? "", /revoked/);
  assert.match(desktopGrantViolation({ ...grant, grantedBy: "device:x" as "workstation" }, context) ?? "", /workstation/);
  assert.match(desktopGrantViolation(undefined, context) ?? "", /No trusted-desktop/);
});

// ── 12. classification matches the real launch contracts ─────────────────────
test("F01-12: session authority classification matches the exact provider launch argv; unknowns fail closed", () => {
  const task = (provider: ProviderId, access: "read" | "write") => ({ id: "t", provider, model: "m", cwd: "C:/p", executionScope: { access } }) as unknown as OrchTask;
  const readArgs = claudeLaunchArgs(task("claude", "read"), "s", "win32");
  assert.equal(readArgs[readArgs.indexOf("--allowedTools") + 1], "Read");
  assert.ok(readArgs.includes("--restricted") && readArgs.includes("--disallowedTools"));
  assert.equal(providerSessionAuthority("claude", "read"), "read_tools");
  assert.match(claudeLaunchArgs(task("claude", "write"), "s", "win32").join(" "), /Bash,PowerShell/);
  assert.equal(providerSessionAuthority("claude", "write"), "shell");
  assert.ok(codexLaunchArgs(task("codex", "read")).includes("read-only"));
  assert.equal(providerSessionAuthority("codex", "read"), "shell", "Codex runs commands even in its read-only sandbox");
  assert.equal(providerSessionAuthority("codex", "write"), "shell");
  assert.equal(providerSessionAuthority("ollama", "write"), "tool_free");
  for (const provider of ["opencode", "cline", "cursor", "unknown", "", null]) assert.equal(providerSessionAuthority(provider, "read"), null);
  assert.equal(providerSessionAuthority("claude", "admin"), null);
});

// ── Independent review findings (T9R-F01 review round 1), each pinned at the real boundary ─────────────────
test("F01-R1 (BLOCKER): Git metadata aliases (8.3 GIT~1, trailing dot/space) and execution-config files are desktop-only remotely", async () => {
  const env = await setup();
  try {
    const { spawnSync } = await import("node:child_process");
    assert.equal(spawnSync("git", ["init", "-q"], { cwd: env.root, windowsHide: true }).status, 0);
    const configBefore = readFileSync(join(env.root, ".git", "config"), "utf8");
    const alias = ["GIT~1/config", "git~1/config", "Git~1/hooks/pre-commit", ".git./config", ".git /config"];
    const config = [".gitattributes", "sub/.gitattributes", ".gitmodules", "package.json", ".npmrc", ".husky/pre-commit", ".vscode/tasks.json", "node_modules/x/index.js", "Makefile"];
    const manifest = env.missions.bus.find("filesystem.write")!.manifest;
    const view = env.missions.create({ objective: "Plant a filter", mode: "fast", origin: "workstation", steps: [capability("Plant", "filesystem.write", { path: "GIT~1/config", content: "[filter \"x\"]\n\tclean = calc\n", overwrite: true })] });
    await phoneApprove(env, view.id);
    const ask = await waitAsk(env, view.id, "filesystem.write");
    assert.equal(ask.desktopRequired, true, "the 8.3 alias of .git is Git metadata");
    await assert.rejects(phoneRespond(env, ask.id, "allow_once"), DESKTOP_ONLY);
    assert.equal(readFileSync(join(env.root, ".git", "config"), "utf8"), configBefore, "nothing was planted");
    const envelope = env.missions.store.authorization(env.missions.mission(view.id).authorizationId!)!;
    for (const path of [...alias, ...config]) {
      const decision = decide(manifest, { path, content: "x", overwrite: true }, { envelope, missionId: view.id, grants: [], base: env.root });
      assert.equal(decision.desktopRequired, true, path);
    }
    assert.equal(decide(manifest, { path: "notes/readme.txt", content: "x" }, { envelope, missionId: view.id, grants: [], base: env.root }).desktopRequired, undefined, "ordinary project files stay remote-approvable");
    if (existsSync(join(env.root, "GIT~1"))) assert.equal(touchesGitMetadata(join(env.root, "GIT~1", "config")), true, "native canonical path expands 8.3 names");
  } finally { await env.cleanup(); }
});

test("F01-R2 (MEDIUM): a git.diff ref can never be an option that re-enables textconv or external diff", async () => {
  const { GitCapability } = await import("./capabilities/local.server.ts");
  const dir = mkdtempSync(join(tmpdir(), "bunny-t9r-f01-ref-"));
  try {
    const { spawnSync } = await import("node:child_process");
    const repo = join(dir, "repo"); mkdirSync(repo);
    assert.equal(spawnSync("git", ["init", "-q"], { cwd: repo, windowsHide: true }).status, 0);
    const adapter = new GitCapability(dir);
    const context = { missionId: null, stepId: null, cwd: repo, roots: [repo], dataDirectory: dir, signal: new AbortController().signal, timeoutMs: 10_000 };
    for (const against of ["--textconv", "--ext-diff", "-p", "--output=x"]) {
      const out = await adapter.execute("git.diff", { against }, { ...context, remoteAuthority: true });
      assert.equal(out.ok, false); assert.match(out.summary, /Invalid ref/);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("F01-R3 (MEDIUM): remote Calculator operations must name the Calculator window; a pid alone is not an identity", () => {
  assert.match(remoteExecutionRefusal("computer.invoke_control", { pid: 4242, automationId: "equalButton" }, "EXECUTE") ?? "", DESKTOP_ONLY);
  assert.match(remoteExecutionRefusal("computer.focus_window", { pid: 4242 }, "EXECUTE") ?? "", DESKTOP_ONLY);
  assert.equal(remoteExecutionRefusal("computer.invoke_control", { title: "Calculator", pid: 4242, automationId: "equalButton" }, "EXECUTE"), null);
  assert.equal(remoteExecutionRefusal("computer.focus_window", { title: "Calculator" }, "EXECUTE"), null);
});

test("F01-R4 (HIGH/MEDIUM): a grant is spent only at the last refusal point, every session start spends it, and a refused launch does not burn it", async () => {
  const env = await setup({ providers: ["claude"] });
  try {
    const view = env.missions.create({ objective: "Edit", mode: "fast", origin: "workstation", steps: [model("Coder", "Edit", { access: "write", maxRetries: 0 })] });
    await phoneApprove(env, view.id);
    const ask = await waitAsk(env, view.id, "provider.execute");
    // A later gate refuses once (as the Agentic admission can); the grant must survive that refusal.
    let refuseOnce = true;
    const admission = env.tasks.missionAttemptAdmission;
    env.tasks.missionAttemptAdmission = (task, kind) => refuseOnce ? (refuseOnce = false, "simulated later refusal") : admission?.(task, kind) ?? null;
    const approve = env.tasks.approve.bind(env.tasks);
    const child = env.missions.store.step(ask.stepId).taskId!;
    env.tasks.approve = (() => env.tasks.db.get(child)) as typeof env.tasks.approve;
    await env.missions.respond(ask.id, "allow_once", "workstation");
    env.tasks.approve = approve;
    assert.throws(() => env.tasks.approve(child, "workstation"), /simulated later refusal/);
    assert.equal(env.missions.store.request(ask.id).desktopGrant!.uses, 0, "a refused launch does not burn the grant");
    const task = env.tasks.db.get(child);
    assert.equal(env.tasks.missionScopeCheck!(task, "check"), null);
    assert.equal(env.tasks.missionScopeCheck!(task, "check"), null);
    assert.equal(env.missions.store.request(ask.id).desktopGrant!.uses, 0, "checks never spend");
    env.tasks.approve(child, "workstation");
    await until(() => env.launched.length === 1, "single session");
    assert.equal(env.missions.store.request(ask.id).desktopGrant!.uses, 1);
    for (const phase of ["check", "launch"] as const) assert.match(env.tasks.missionScopeCheck!(task, phase) ?? "", DESKTOP_ONLY, `a relaunch (${phase}) needs fresh authority`);
    const source = readFileSync(new URL("../bunny-host/manager.server.ts", import.meta.url), "utf8");
    assert.match(source, /this\.missionAttemptAdmission\?\.\(targetTask, rerouting \? "reroute" : "retry"\) \?\?\s*this\.missionScopeCheck\?\.\(targetTask, "launch"\)/, "every relaunch spends like a launch");
  } finally { await env.cleanup(); }
});

test("F01-R5 (MEDIUM): a phone cannot start a workstation-approved Mission that can run code; remote-approved ones it may", async () => {
  const env = await setup({ providers: ["claude"] });
  try {
    const held = env.missions.create({ objective: "Edit", mode: "fast", origin: "workstation", steps: [model("Coder", "Edit", { access: "write" })] });
    env.missions.approve(held.id, "workstation", false);
    await assert.rejects(missionCommand(env.missions, "mission.start", { id: held.id }, { local: false, actor: PHONE }), DESKTOP_ONLY);
    const term = env.missions.create({ objective: "Run", mode: "fast", origin: "workstation", steps: [capability("Run", "terminal.exec", { command: "node", args: ["probe.mjs"] })] });
    env.missions.approve(term.id, "workstation", false);
    await assert.rejects(missionCommand(env.missions, "mission.start", { id: term.id }, { local: false, actor: PHONE }), DESKTOP_ONLY);
    const benign = env.missions.create({ objective: "Note", mode: "fast", origin: "workstation", steps: [capability("Write", "filesystem.write", { path: "n.txt", content: "x" })] });
    env.missions.approve(benign.id, "workstation", false);
    await missionCommand(env.missions, "mission.start", { id: benign.id }, { local: false, actor: PHONE });
    await promoteStaged(env, benign.id); // F02: the device's write is staged until the workstation promotes it
    await until(() => env.missions.mission(benign.id).state === "completed", "benign start");
    const remote = env.missions.create({ objective: "Edit", mode: "fast", origin: "workstation", steps: [model("Coder", "Edit", { access: "write" })] });
    await phoneApprove(env, remote.id, false);
    await missionCommand(env.missions, "mission.start", { id: remote.id }, { local: false, actor: PHONE });
    await waitAsk(env, remote.id, "provider.execute");
    await settle();
    assert.equal(env.launched.length, 0);
  } finally { await env.cleanup(); }
});

test("F01-R6 (LOW): grants are attempt-bound, bound to the Task/plan in force when asked, and never projected to a phone", async () => {
  const env = await setup({ providers: ["claude"] });
  try {
    const view = env.missions.create({ objective: "Edit", mode: "fast", origin: "workstation", steps: [model("Coder", "Edit", { access: "write", maxRetries: 0 })] });
    await phoneApprove(env, view.id);
    const ask = await waitAsk(env, view.id, "provider.execute");
    assert.ok(ask.desktopBinding?.taskId && ask.desktopBinding.authorizationId && ask.desktopBinding.planReference);
    const projected = env.missions.remoteVerdicts(env.missions.snapshot()).missions.find((m) => m.id === view.id)!.requests.find((r) => r.id === ask.id)!;
    assert.equal(projected.desktopRequired, true);
    assert.equal(projected.desktopOperation, undefined); assert.equal(projected.desktopBinding, undefined); assert.equal(projected.remote?.answerable, false);
    // The Task changed while the ask was open: the workstation answer cannot bind the old review to the new Task.
    const step = env.missions.store.step(ask.stepId);
    env.missions.setStep(step, { taskId: "f01-substituted-task" });
    await assert.rejects(env.missions.respond(ask.id, "allow_once", "workstation"), /changed after this request/);
    env.missions.setStep(env.missions.store.step(ask.stepId), { taskId: step.taskId });
    const approve = env.tasks.approve.bind(env.tasks);
    env.tasks.approve = (() => env.tasks.db.get(step.taskId!)) as typeof env.tasks.approve;
    await env.missions.respond(ask.id, "allow_once", "workstation");
    env.tasks.approve = approve;
    env.missions.setMission(env.missions.mission(view.id), { state: "failed" });
    // M-A-3 T9R-F03: a refused Retry changes nothing, so the grant survives it; a Retry that proceeds ends the unspent grant.
    assert.throws(() => env.missions.retry(view.id, "workstation"), /No failed step/);
    assert.equal(env.missions.store.request(ask.id).desktopGrant!.revokedAt, null, "a refused Retry leaves the grant untouched");
    env.missions.setStep(env.missions.store.step(ask.stepId), { state: "failed", failure: { category: "provider_failed", detail: "F03 retry fixture" } });
    env.missions.retry(view.id, "workstation");
    assert.notEqual(env.missions.store.request(ask.id).desktopGrant!.revokedAt, null, "Retry ends the unspent grant");
  } finally { await env.cleanup(); }
});

test("F01-R7 (LOW): any forwarded-proto marker is remote; unmarked non-workstation envelopes are remote; scripts are content-bound", () => {
  const req = (headers: Record<string, string>) => new Request("http://127.0.0.1:8080/x", { headers });
  for (const value of ["HTTPS", "https, https", "http"]) assert.throws(() => authorizeBridge(req({ "x-forwarded-proto": value }), "127.0.0.1"), /workstation authentication/, value);
  const request = scopeFor([], "C:/p", "fast");
  const legacy = { ...envelopeFrom(request, "m", "workstation", 1000), authority: undefined };
  assert.equal(isRemoteEnvelope({ ...legacy, grantedBy: "workstation" }), false);
  for (const grantedBy of ["trigger:x", "agent:y", "", "WORKSTATION"]) assert.equal(isRemoteEnvelope({ ...legacy, grantedBy }), true, grantedBy);
  const dir = mkdtempSync(join(tmpdir(), "bunny-t9r-f01-script-"));
  try {
    writeFileSync(join(dir, "probe.mjs"), "console.log(1)");
    const before = capabilityOperation("terminal.exec", { command: "node", args: ["probe.mjs"] }, dir, null);
    writeFileSync(join(dir, "probe.mjs"), "console.log(2)");
    const after = capabilityOperation("terminal.exec", { command: "node", args: ["probe.mjs"] }, dir, null);
    assert.notDeepEqual(before, after, "a script changed after desktop approval no longer matches the grant");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── Independent review round 2 findings ─────────────────────────────────────────────────────────────────────
test("F01-R8 (HIGH): execution-config files are desktop-only under every name: 8.3 aliases, NTFS streams, trailing dots", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bunny-t9r-f01-alias-"));
  try {
    writeFileSync(join(dir, "package.json"), "{}"); writeFileSync(join(dir, ".gitattributes"), ""); mkdirSync(join(dir, ".husky")); mkdirSync(join(dir, "node_modules"));
    const names = ["package.json::$DATA", "package.json:evil", "package.json.", "package.json ", ".gitattributes::$DATA", ".husky/pre-commit", "node_modules/x.js"];
    const { spawnSync } = await import("node:child_process");
    const listing = spawnSync("cmd.exe", ["/c", "dir", "/x", "/a"], { cwd: dir, encoding: "utf8", windowsHide: true }).stdout ?? "";
    for (const alias of listing.match(/\b(PACKAG~\d\.JSO|GITATT~\d|HUSKY~\d|NODE_M~\d)\b/g) ?? []) names.push(alias.startsWith("HUSKY") || alias.startsWith("NODE_M") ? `${alias}/x` : alias);
    if (process.platform === "win32") assert.ok(names.some((name) => /~\d/.test(name)), `8.3 aliases were exercised: ${names.join(", ")}`);
    for (const name of names) {
      assert.equal(executionConfigPath(join(dir, name)), true, name);
      assert.match(remoteExecutionRefusal("filesystem.write", { path: name }, "WRITE", dir) ?? "", DESKTOP_ONLY, name);
    }
    assert.equal(executionConfigPath(join(dir, "src", "index.ts")), false, "ordinary files stay bounded");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("F01-R9 (HIGH/MEDIUM): a terminal grant binds option-named files and is voided by any later project change", async () => {
  const env = await setup();
  try {
    writeFileSync(join(env.root, "payload.js"), "1");
    const op = capabilityOperation("terminal.exec", { command: "node", args: ["--require=./payload.js", "--import=./payload.js", "-e", "1"] }, env.root, null);
    assert.ok(op.kind === "capability" && op.files && Object.keys(op.files).includes("./payload.js"), "--opt=file is content-bound");
    const view = env.missions.create({ objective: "Run probe", mode: "fast", origin: "workstation", steps: [capability("Run", "terminal.exec", { command: "node", args: ["probe.mjs"] })] });
    await phoneApprove(env, view.id);
    const ask = await waitAsk(env, view.id, "terminal.exec");
    const before = env.missions.desktopContext(view.id, ask.stepId, ask.desktopOperation!);
    // Any file-changing capability run (here an ordinary direct write of an imported module) moves the sequence.
    const write = await env.missions.bus.request({ action: "filesystem.write", params: { path: "lib.mjs", content: "export default 2", overwrite: true }, missionId: null, stepId: null, envelope: null, origin: "workstation", cwd: env.root, roots: [env.root], direct: { confirmed: true } });
    assert.equal(write.run?.status, "succeeded");
    const after = env.missions.desktopContext(view.id, ask.stepId, ask.desktopOperation!);
    assert.equal(after.mutationSequence, before.mutationSequence + 1);
    const { now: _n, ...bindings } = before;
    const grant: DesktopGrant = { id: "g", requestId: ask.id, ...bindings, grantedBy: "workstation", grantedAt: Date.now(), expiresAt: Date.now() + 60_000, maxUses: 1, uses: 0, revokedAt: null };
    assert.equal(desktopGrantViolation(grant, before), null);
    assert.match(desktopGrantViolation(grant, after) ?? "", /Project files changed/, "imported modules and entry points cannot change under a desktop approval");
  } finally { await env.cleanup(); }
});

test("F01-R10 (MEDIUM/LOW): device answers never extend an expired envelope; device views carry no grant records; start judges real providers", async () => {
  const env = await setup({ providers: ["ollama"] });
  try {
    const view = env.missions.create({ objective: "Summarize", mode: "fast", origin: "workstation", localOnly: true, steps: [model("Writer", "Summarize", { access: "read", maxRetries: 0 })] });
    env.missions.approve(view.id, "workstation", false);
    await missionCommand(env.missions, "mission.start", { id: view.id }, { local: false, actor: PHONE }); // tool-free only: a phone may start it
    await until(() => env.launched.length === 1, "ollama started by phone");
    env.launched[0].finish({ ok: true, output: "ok" });
    await until(() => env.missions.mission(view.id).state === "completed", "done");
    const expired = env.missions.create({ objective: "Summarize", mode: "fast", origin: "workstation", localOnly: true, steps: [model("Writer", "Summarize", { access: "read", maxRetries: 0 })] });
    env.missions.approve(expired.id, "workstation", false);
    const envelope = env.missions.store.authorization(env.missions.mission(expired.id).authorizationId!)!;
    env.missions.store.saveAuthorization({ ...envelope, expiresAt: Date.now() - 1 });
    env.missions.start(env.missions.mission(expired.id));
    const ask = await waitAsk(env, expired.id, "provider.execute");
    await assert.rejects(phoneRespond(env, ask.id, "allow_once"), /Windows Host/, "a phone cannot extend an expired envelope");
    const data = (await missionCommand(env.missions, "mission.get", { id: expired.id }, { local: false, actor: PHONE })).data as { mission: { requests: Record<string, unknown>[] } };
    for (const request of data.mission.requests) for (const key of ["desktopGrant", "desktopOperation", "desktopBinding"]) assert.equal(key in request, false, key);
    await settle();
    assert.equal(env.launched.length, 1);
  } finally { await env.cleanup(); }
});

test("F01-R11 (MEDIUM): a phone cannot resume an Agent whose consent includes bound scripts; Pause stays available", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bunny-t9r-f01-resume-"));
  const root = join(dir, "project"); mkdirSync(root); writeFileSync(join(root, "seed.txt"), "seed"); writeFileSync(join(root, "check.mjs"), "console.log('ok')");
  const db = new HostDatabase(join(dir, "host.sqlite"));
  const tasks = new TaskManager(db, root, [], { modelRegistry: new ModelCapabilityRegistry(db, { availableProviders: () => [] }) }); await tasks.discover();
  const missions = new MissionManager(tasks, { dataDirectory: dir, adapters: [new FilesystemCapability(), new TerminalCapability()] });
  missions.configure({ enabled: true }, "workstation"); await missions.bus.refreshHealth(); missions.schedule = () => {};
  const agents = new AgentRuntime(db, missions); missions.missionPauseGate = id => agents.blockedForMission(id);
  try {
    const step = (action: string, params: Record<string, unknown>) => ({ role: "Probe", objective: "Check", access: "read", executor: { kind: "capability", action, params } });
    const row = agents.create({ name: "F01 resume", objective: "Run the bounded check", steps: [step("filesystem.read", { path: "seed.txt" }), step("terminal.exec", { command: "node", args: ["check.mjs"] })] }, "workstation").agents[0];
    missions.proposeAgentAuthorization(row.id, { maximumActions: 5 });
    agents.start(row.id, "workstation", missions.agentic.forMission(row.missionId!)!.revision);
    agents.pause(row.id, PHONE);
    const revision = missions.agentic.forMission(row.missionId!)!.revision;
    assert.throws(() => agents.resume(row.id, PHONE, revision), DESKTOP_ONLY);
    agents.resume(row.id, "workstation", revision);
  } finally { agents.close(); await missions.close(); db.close(); rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});

// ── Independent review round 2 closure ───────────────────────────────────────────────────────────────────────
test("F01-R12 (MEDIUM): while a trusted-desktop execution runs, Mission changes in its folder wait (no rewrite under the approval)", async () => {
  const env = await setup();
  try {
    const view = env.missions.create({ objective: "Edit lib", mode: "fast", origin: "workstation", steps: [capability("Write", "filesystem.write", { path: "lib.mjs", content: "export default 2", overwrite: true })] });
    env.missions.approve(view.id, "workstation", false);
    const mission = env.missions.mission(view.id); const step = env.missions.store.steps(view.id)[0];
    const envelope = env.missions.store.authorization(mission.authorizationId!)!;
    let running = true;
    env.missions.desktopExecutions.set("run:test", { root: env.root, live: () => running });
    const blocked = env.missions.bus.decision({ ...env.missions.capabilityRequest(mission, { ...step, approvedOnce: { requestId: "x", action: "filesystem.write" } }, envelope, "filesystem.write", { path: "lib.mjs", content: "x" }, env.root) });
    assert.equal(blocked.decision, "ask"); assert.match(blocked.reason, /trusted-desktop execution is running/, "even a one-time allowance waits");
    running = false;
    assert.equal(env.missions.bus.decision(env.missions.capabilityRequest(mission, step, envelope, "filesystem.write", { path: "lib.mjs", content: "x" }, env.root)).decision, "allow");
    assert.equal(env.missions.desktopExecutions.size, 0, "ended executions are forgotten");
  } finally { await env.cleanup(); }
});

test("F01-R13 (LOW): a one-time allowance never outlives revocation; Retry and restart drop old one-time allowances", async () => {
  const manifest: ActionManifest = { id: "filesystem.write", description: "", risk: "WRITE", inputs: [], outputs: "", evidence: "", timeoutMs: 1000, implemented: true };
  const envelope = { ...envelopeFrom(scopeFor([], "C:/p", "fast"), "m1", PHONE, 60_000), revokedAt: Date.now() };
  assert.equal(decide(manifest, { path: "a.txt" }, { envelope, missionId: "m1", grants: [], oneTime: true, base: "C:/p" }).decision, "deny");
  const env = await setup();
  try {
    const view = env.missions.create({ objective: "Write", mode: "fast", origin: "workstation", steps: [capability("A", "filesystem.write", { path: "a.txt", content: "a" }), capability("B", "filesystem.write", { path: "b.txt", content: "b" })] });
    env.missions.approve(view.id, "workstation", false);
    const [a, b] = env.missions.store.steps(view.id);
    // Synthesized persisted state (a failed Mission with a ready sibling holding a one-time allowance).
    env.missions.store.saveStep({ ...a, state: "failed" }); env.missions.store.saveStep({ ...b, state: "ready", approvedOnce: { requestId: "old", action: "filesystem.write" } });
    env.missions.store.saveMission({ ...env.missions.mission(view.id), state: "failed" });
    await env.restart();
    assert.equal(env.missions.store.step(b.id).approvedOnce, null, "restart clears it on failed Missions");
    env.missions.store.saveStep({ ...env.missions.store.step(b.id), approvedOnce: { requestId: "old", action: "filesystem.write" } });
    try { env.missions.retry(view.id, "workstation"); } catch { /* the reset happens first */ }
    assert.equal(env.missions.store.step(b.id).approvedOnce, null, "Retry clears it");
  } finally { await env.cleanup(); }
});

test("F01-R14 (LOW): gateway refuses workstation authentication for any relay marker or device cookie spelling", () => {
  const req = (headers: Record<string, string>) => new Request("http://localhost:8080/x", { headers });
  for (const headers of ([{ "x-forwarded-port": "443" }, { "x-forwarded-host": "localhost:8080" }, { "x-original-url": "/x" }, { "cf-visitor": "{}" }, { "front-end-https": "on" }, { "x-url-scheme": "https" }, { cookie: "a=1; bunny_device =tok" }, { cookie: "BUNNY_DEVICE\t=tok" }] as Record<string, string>[]))
    assert.throws(() => authorizeBridge(req(headers), "127.0.0.1"), /workstation authentication/, JSON.stringify(headers));
  assert.deepEqual(authorizeBridge(req({ cookie: "theme=dark" }), "127.0.0.1"), { local: true, token: null });
});

test("F01-R15 (MEDIUM): the workstation prompt for code execution lists files paired-device authority changed in the Mission", async () => {
  const env = await setup();
  try {
    // F02: a root .json is CONFIGURATION (refused for a device), so the data example lives in data/ (PHONE_SAFE_DATA).
    const view = env.missions.create({ objective: "Edit then run", mode: "fast", origin: "workstation", steps: [capability("Write", "filesystem.write", { path: "data/lib.json", content: "{\"v\":1}", overwrite: true }), { ...capability("Run", "terminal.exec", { command: "node", args: ["probe.mjs"] }), dependsOn: [0] }] });
    await phoneApprove(env, view.id);
    // F02: the device's write is staged; the workstation promotes it before the dependent code step is asked.
    await promoteStaged(env, view.id);
    const ask = await waitAsk(env, view.id, "terminal.exec");
    // The prompt lists the mission's changed files as absolute, JSON-escaped paths.
    assert.match(ask.reason, /paired-device authority: "[^"]*lib\.json"/);
  } finally { await env.cleanup(); }
});

// ── Independent review round 3 findings ─────────────────────────────────────────────────────────────────────
test("F01-R16 (HIGH): a project change between the desktop ask and the workstation answer supersedes the ask (re-asked, never executed)", async () => {
  const env = await setup();
  try {
    const view = env.missions.create({ objective: "Run probe", mode: "fast", origin: "workstation", steps: [capability("Run", "terminal.exec", { command: "node", args: ["probe.mjs"] })] });
    await phoneApprove(env, view.id);
    const ask = await waitAsk(env, view.id, "terminal.exec");
    assert.equal(typeof ask.desktopBinding?.mutationSequence, "number");
    // A file-changing capability run lands after the ask was shown (here a direct write of an imported helper).
    const write = await env.missions.bus.request({ action: "filesystem.write", params: { path: "helper.mjs", content: "export const v = 'changed';", overwrite: true }, missionId: null, stepId: null, envelope: null, origin: "workstation", cwd: env.root, roots: [env.root], direct: { confirmed: true } });
    assert.equal(write.run?.status, "succeeded");
    await assert.rejects(env.missions.respond(ask.id, "allow_once", "workstation"), /Project files changed/);
    const old = env.missions.store.request(ask.id);
    assert.match(old.resolvedBy ?? "", /superseded/); assert.equal(old.desktopGrant, undefined);
    const fresh = pending(env, view.id)!;
    assert.notEqual(fresh.id, ask.id); assert.equal(fresh.desktopRequired, true);
    await settle();
    assert.ok(!existsSync(join(env.root, "ran.txt")), "nothing ran on the stale approval");
    await env.missions.respond(fresh.id, "allow_once", "workstation");
    await until(() => env.missions.mission(view.id).state === "completed", "fresh approval runs");
  } finally { await env.cleanup(); }
});

test("F01-R17 (MEDIUM/LOW): script hashes resolve in the command's own folder; more relay families are remote", () => {
  const dir = mkdtempSync(join(tmpdir(), "bunny-t9r-f01-cwd-"));
  try {
    mkdirSync(join(dir, "sub")); writeFileSync(join(dir, "sub", "probe.mjs"), "1");
    const before = capabilityOperation("terminal.exec", { command: "node", args: ["probe.mjs"], cwd: "sub" }, dir, null);
    assert.ok(before.kind === "capability" && before.files?.["probe.mjs"], "sub/probe.mjs is hashed");
    writeFileSync(join(dir, "sub", "probe.mjs"), "2");
    assert.notDeepEqual(capabilityOperation("terminal.exec", { command: "node", args: ["probe.mjs"], cwd: "sub" }, dir, null), before);
  } finally { rmSync(dir, { recursive: true, force: true }); }
  const req = (name: string) => new Request("http://localhost:8080/x", { headers: { [name]: "1" } });
  for (const name of ["x-rewrite-url", "tailscale-user-login", "x-envoy-external-address", "fastly-client-ip", "x-vercel-forwarded-for", "x-amzn-trace-id", "x-azure-ref", "x-arr-ssl", "ngrok-skip-browser-warning"])
    assert.throws(() => authorizeBridge(req(name), "127.0.0.1"), /workstation authentication/, name);
});

test("F01-R18 (HIGH): a phone's one-time answer never reaches outside the reviewed envelope; only the workstation's extends roots", async () => {
  const env = await setup();
  const outsideDir = mkdtempSync(join(tmpdir(), "bunny-t9r-f01-outside-"));
  const outside = join(outsideDir, "notes.txt");
  try {
    const view = env.missions.create({ objective: "Write outside", mode: "fast", origin: "workstation", steps: [capability("Write", "filesystem.write", { path: outside, content: "calc" })] });
    await phoneApprove(env, view.id);
    const ask = await waitAsk(env, view.id, "filesystem.write");
    // F02: out-of-root writes are refused with their classification first (UNKNOWN: outside the step's working folder).
    assert.match(ask.reason, /classified UNKNOWN \(outside the step's working folder\)/);
    for (const decision of ["allow_once", "allow_batch"] as const) await assert.rejects(phoneRespond(env, ask.id, decision), /Windows Host/, decision);
    await settle();
    assert.ok(!existsSync(outside), "nothing written on the phone's answer");
    // Even a recorded device answer (e.g. from an older build) never extends the request roots. The device answer is a
    // separate record: judging it against the live ask would stamp that ask's lifecycle (first stamp wins).
    const mission = env.missions.mission(view.id); const step = env.missions.store.steps(view.id)[0];
    const envelope = env.missions.store.authorization(mission.authorizationId!)!;
    const deviceAnswerId = "f01-r18-device-answer";
    env.missions.store.saveRequest({ ...env.missions.store.request(ask.id), id: deviceAnswerId, resolvedAt: Date.now(), resolution: "allow_once", resolvedBy: PHONE });
    const byPhone = env.missions.capabilityRequest(mission, { ...step, approvedOnce: { requestId: deviceAnswerId, action: "filesystem.write" } }, envelope, "filesystem.write", { path: outside, content: "calc" }, env.root);
    assert.ok(!byPhone.roots.some((root) => outside.startsWith(root)), "a device answer adds no root");
    await env.missions.respond(ask.id, "allow_once", "workstation");
    await promoteStaged(env, view.id); // F02: the workstation's answer stages the device's write; its promotion lands it
    await until(() => env.missions.mission(view.id).state === "completed", "workstation allow-once completes");
    assert.equal(readFileSync(outside, "utf8"), "calc");
  } finally { await env.cleanup(); rmSync(outsideDir, { recursive: true, force: true }); }
});

test("F01-R19 (MEDIUM): an expired remote envelope is never extended by a one-time answer", () => {
  const write: ActionManifest = { id: "filesystem.write", description: "", risk: "WRITE", inputs: [], outputs: "", evidence: "", timeoutMs: 1000, implemented: true };
  const request = scopeFor([{ executor: { kind: "capability", action: "filesystem.write", params: {} }, requiredCapabilities: [], verification: [], scope: { access: "write", isolation: "shared" }, providerConstraints: {}, crossApp: undefined } as unknown as MissionStep], "C:/p", "fast");
  const remote = envelopeFrom(request, "m1", PHONE, 60_000);
  const ctx = { missionId: "m1", grants: [], base: "C:/p", oneTime: true };
  assert.equal(decide(write, { path: "n.txt" }, { ...ctx, envelope: remote }).decision, "allow");
  const expired = decide(write, { path: "n.txt" }, { ...ctx, envelope: { ...remote, expiresAt: Date.now() - 1 } });
  assert.equal(expired.decision, "ask"); assert.match(expired.reason, /expired/);
});

test("F01-R20 (HIGH): code never runs over unreviewed paired-device changes from another Mission, under any envelope or provider", async () => {
  const env = await setup({ providers: ["claude"] });
  try {
    // Mission A: a phone's unreviewed edit of a module the project's script imports (seeded: F02 stages device writes,
    // so this is the review gate as defense in depth).
    seedUnreviewed(env, "helper.json", "{\"v\":\"phone\"}");
    assert.equal(env.missions.store.pendingRemoteChanges().length, 1);
    // Mission B: workstation-approved terminal command in the same project asks the workstation with the list.
    const b = env.missions.create({ objective: "Run", mode: "fast", origin: "workstation", steps: [capability("Run", "terminal.exec", { command: "node", args: ["probe.mjs"] })] });
    env.missions.approve(b.id, "workstation");
    const ask = await waitAsk(env, b.id, "terminal.exec");
    assert.equal(ask.desktopRequired, true); assert.equal(ask.remoteReview?.length, 1); assert.match(ask.reason, /helper\.json/);
    await assert.rejects(phoneRespond(env, ask.id, "allow_once"), DESKTOP_ONLY, "a phone cannot review its own changes");
    await settle();
    assert.ok(!existsSync(join(env.root, "ran.txt")));
    await env.missions.respond(ask.id, "allow_once", "workstation");
    await until(() => env.missions.mission(b.id).state === "completed", "reviewed run");
    assert.equal(env.missions.store.pendingRemoteChanges().length, 0, "the workstation answer acknowledged them");
    // Once reviewed, workstation-approved work runs without another prompt.
    const c = env.missions.create({ objective: "Run other", mode: "fast", origin: "workstation", steps: [capability("Run", "terminal.exec", { command: "node", args: ["other.mjs"] })] });
    env.missions.approve(c.id, "workstation");
    await until(() => env.missions.mission(c.id).state === "completed", "no extra prompt");
    assert.equal(env.missions.store.requests(c.id).length, 0);
    // A shell-capable provider session over a fresh phone change also waits for the workstation.
    seedUnreviewed(env, "helper.json", "{\"v\":\"again\"}");
    const e = env.missions.create({ objective: "Code", mode: "fast", origin: "workstation", steps: [model("Coder", "Change code", { access: "write", maxRetries: 0 })] });
    env.missions.approve(e.id, "workstation");
    const session = await waitAsk(env, e.id, "provider.execute");
    assert.equal(session.desktopRequired, true); assert.equal(session.remoteReview?.length, 1); assert.match(session.reason, /paired-device authority/);
    await settle();
    assert.equal(env.launched.length, 0, "no shell session over unreviewed changes");
    await assert.rejects(phoneRespond(env, session.id, "allow_once"), DESKTOP_ONLY);
    await env.missions.respond(session.id, "allow_once", "workstation");
    await until(() => env.launched.length === 1, "reviewed session launches");
    env.launched[0].finish({ ok: true, output: "done" });
  } finally { await env.cleanup(); }
});

test("F01-R21 (HIGH): a phone cannot start or resume workstation-held program launches or UI automation", async () => {
  const opened: string[] = [];
  const computer: CapabilityAdapter = {
    manifest: { id: "computer", version: "1", description: "", locality: "local", platforms: "any", events: [], cost: { kind: "local_compute", note: "" }, adapter: "test",
      actions: [{ id: "computer.open_app", description: "", risk: "EXECUTE", inputs: [], outputs: "", evidence: "", timeoutMs: 1000, implemented: true }] },
    health: async () => ({ availability: "available", detail: "test" }),
    execute: async (_action, params) => { opened.push(String(params.app)); return { ok: true, status: "succeeded", summary: "opened", output: {}, evidence: [] }; },
  };
  const env = await setup({ adapters: [new FilesystemCapability(), new TerminalCapability(), new NotificationsCapability(() => {}), computer] });
  try {
    // A workstation envelope with EXECUTE (as cross-app plans get) would run the launch without another answer.
    const view = env.missions.create({ objective: "Open terminal", mode: "fast", origin: "workstation", steps: [capability("Open", "computer.open_app", { app: "terminal" })] });
    const approved = env.missions.approve(view.id, "workstation", false);
    const held = env.missions.store.authorization(approved.authorizationId!)!;
    env.missions.store.saveAuthorization({ ...held, riskClasses: [...new Set([...held.riskClasses, "EXECUTE" as const])] });
    await assert.rejects(missionCommand(env.missions, "mission.start", { id: view.id }, { local: false, actor: PHONE }), DESKTOP_ONLY);
    await settle();
    assert.deepEqual(opened, [], "nothing launched on the phone's start");
    // Without EXECUTE in the envelope the launch asks anyway; a phone may start the Mission but never answer that ask.
    const asking = env.missions.create({ objective: "Open terminal", mode: "fast", origin: "workstation", steps: [capability("Open", "computer.open_app", { app: "terminal" })] });
    env.missions.approve(asking.id, "workstation", false);
    await missionCommand(env.missions, "mission.start", { id: asking.id }, { local: false, actor: PHONE });
    const ask = await waitAsk(env, asking.id, "computer.open_app");
    await assert.rejects(phoneRespond(env, ask.id, "allow_once"), DESKTOP_ONLY);
    await settle();
    assert.deepEqual(opened, [], "still nothing launched");
    const unknown = env.missions.create({ objective: "Note", mode: "fast", origin: "workstation", steps: [capability("Note", "notifications.send", { title: "x" }, { verification: [{ kind: "capability", action: "unknown.thing", params: {}, expect: { field: "x" } }] })] });
    assert.equal(env.missions.mission(unknown.id).state, "failed", "an unknown capability fails closed at planning; nothing to start");
    await assert.rejects(missionCommand(env.missions, "mission.start", { id: unknown.id }, { local: false, actor: PHONE }));
    // Agent resume: EXECUTE capabilities other than cross-app Calculator actions stay on the workstation.
    const resume = (capabilities: string[], crossApp: boolean) => MissionManager.prototype.deviceResumeRefusal.call(
      { agentic: { forMission: () => ({ permitted_capabilities: capabilities, ...(crossApp ? { cross_app: {} } : {}) }) }, bus: env.missions.bus, store: { mission: () => ({}) }, deviceStartRefusal: () => null } as never, "m");
    assert.match(resume(["computer.open_app"], false) ?? "", DESKTOP_ONLY);
    assert.equal(resume(["computer.open_app"], true), null, "cross-app computer actions are Calculator-confined by the agentic scope check");
    assert.equal(resume(["filesystem.read", "notifications.send"], false), null);
  } finally { await env.cleanup(); }
});

test("F01-R22 (LOW): task-runner and hook configs are execution config; network paths fail closed without probing", () => {
  for (const name of ["Taskfile.yml", "justfile", "lefthook.yml", ".pre-commit-config.yaml", "pyproject.toml", "setup.py", "conftest.py", "build.rs", "Rakefile", "Gemfile", "tox.ini", "noxfile.py", "vite.config.ts", "eslint.config.mjs"])
    assert.equal(executionConfigPath(join("C:/p", name)), true, name);
  assert.equal(executionConfigPath("C:/p/notes.md"), false);
  const started = Date.now();
  assert.match(remoteExecutionRefusal("filesystem.write", { path: "\\\\unreachable-host-t9r\\share\\a.txt" }, "WRITE", "C:/p") ?? "", DESKTOP_ONLY);
  assert.ok(Date.now() - started < 1000, "no network probe");
});

test("F01-R23 (LOW): relaunching under an expired remote envelope is refused", async () => {
  const env = await setup({ providers: ["ollama"] });
  try {
    const view = env.missions.create({ objective: "Summarize", mode: "fast", origin: "workstation", localOnly: true, steps: [model("Writer", "Summarize", { access: "read", maxRetries: 0 })] });
    await phoneApprove(env, view.id);
    await until(() => env.launched.length === 1, "ollama launch");
    const task = env.tasks.db.get(env.launched[0].task.id);
    assert.equal(env.tasks.missionScopeCheck!(task, "check"), null);
    const envelope = env.missions.store.authorization(env.missions.mission(view.id).authorizationId!)!;
    env.missions.store.saveAuthorization({ ...envelope, expiresAt: Date.now() - 1 });
    assert.match(env.tasks.missionScopeCheck!(task, "check") ?? "", /expired/);
    env.launched[0].finish({ ok: true, output: "ok" });
  } finally { await env.cleanup(); }
});

// ── Independent review round 4 closure ───────────────────────────────────────────────────────────────────────
test("F01-R24 (BLOCKER): a phone cannot lift a workstation hold on code execution for an Agent without a consent record", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bunny-t9r-f01-noconsent-"));
  const root = join(dir, "project"); mkdirSync(root); writeFileSync(join(root, "probe.mjs"), "import { writeFileSync } from 'node:fs'; writeFileSync('ran.txt', 'ran');");
  const db = new HostDatabase(join(dir, "host.sqlite"));
  const tasks = new TaskManager(db, root, [], { modelRegistry: new ModelCapabilityRegistry(db, { availableProviders: () => [] }) }); await tasks.discover();
  const missions = new MissionManager(tasks, { dataDirectory: dir, adapters: [new FilesystemCapability(), new TerminalCapability()] });
  missions.configure({ enabled: true }, "workstation"); await missions.bus.refreshHealth();
  const agents = new AgentRuntime(db, missions); missions.missionPauseGate = id => agents.blockedForMission(id);
  try {
    const row = agents.create({ name: "F01 no consent", objective: "Run", steps: [{ role: "Run", objective: "Run", access: "read", executor: { kind: "capability", action: "terminal.exec", params: { command: "node", args: ["probe.mjs"], cwd: root } } }] }, "workstation").agents[0];
    agents.pause(row.id, "workstation");
    agents.start(row.id, "workstation");
    assert.equal(missions.agentic.forMission(row.missionId!), null, "no Agentic consent record");
    assert.throws(() => agents.resume(row.id, PHONE), DESKTOP_ONLY);
    await settle();
    assert.ok(!existsSync(join(root, "ran.txt")), "nothing ran on the phone's resume");
  } finally { agents.close(); await missions.close(); db.close(); rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});

test("F01-R25 (HIGH): a phone batch never covers Agent computer actions outside the Agent's consent", () => {
  const fake = (consent: Record<string, unknown> | null) => ({
    store: { mission: () => ({ authorizationId: "a", root: "C:/p" }), authorization: () => ({ revokedAt: null, expiresAt: Date.now() + 60_000 }), step: () => ({ executor: { kind: "capability", action: "computer.focus_window", params: { title: "Calculator" } }, verification: [] }), steps: () => [{ executor: { kind: "capability", action: "computer.focus_window", params: { title: "Calculator" } }, verification: [] }] },
    bus: { find: () => ({ manifest: { id: "computer.focus_window", risk: "EXECUTE" } }) },
    agentic: { forMission: () => consent }, deviceResumeRefusal: () => null,
    // F02 (D3): a device batch for an Agent Mission also needs a CURRENT consent (ACTIVE, this Host generation, unexpired).
    tasks: { instanceId: "gen-1" },
  });
  const live = { current_state: "ACTIVE", host_generation: "gen-1", expires_at: Date.now() + 60_000 };
  const request = { missionId: "m", stepId: "s", action: "computer.focus_window", risk: "EXECUTE", batchOffer: { actions: ["computer.focus_window", "computer.invoke_control"] } };
  const refusal = (consent: Record<string, unknown> | null) => MissionManager.prototype.deviceRequestRefusal.call(fake(consent) as never, request as never, "allow_batch");
  assert.match(refusal({ permitted_capabilities: ["filesystem.read"] }) ?? "", /Windows Host/, "no cross-app consent: no phone batch");
  assert.match(refusal({ cross_app: {}, permitted_capabilities: ["computer.focus_window"] }) ?? "", /Windows Host/, "every batch action must be consented");
  assert.equal(refusal({ ...live, cross_app: {}, permitted_capabilities: ["computer.focus_window", "computer.invoke_control"] }), null, "a consented Calculator batch stays phone-approvable");
  for (const stale of [{ current_state: "PAUSED" }, { host_generation: "gen-0" }, { expires_at: Date.now() - 1 }])
    assert.match(refusal({ ...live, ...stale, cross_app: {}, permitted_capabilities: ["computer.focus_window", "computer.invoke_control"] }) ?? "", /Windows Host/, `F02: no phone batch under a non-current consent ${JSON.stringify(stale)}`);
  assert.equal(refusal(null), null, "non-Agent Missions keep the T9 Calculator batch");
});

test("F01-R26 (HIGH): the review gate is Host-wide: code in any folder waits for unreviewed paired-device changes", async () => {
  const env = await setup();
  const elsewhere = mkdtempSync(join(tmpdir(), "bunny-t9r-f01-elsewhere-"));
  try {
    seedUnreviewed(env, "helper.json", "{\"v\":\"phone\"}"); // F02: seeded unreviewed change (see promoteStaged/seedUnreviewed)
    const b = env.missions.create({ objective: "Run", mode: "fast", origin: "workstation", steps: [capability("Run", "terminal.exec", { command: "node", args: ["probe.mjs"] })] });
    const approved = env.missions.approve(b.id, "workstation", false);
    const envelope = env.missions.store.authorization(approved.authorizationId!)!;
    const step = env.missions.store.steps(b.id)[0];
    for (const [cwd, params] of [[elsewhere, { command: "node", args: [join(env.root, "probe.mjs"), join(env.root, "helper.json")] }], [env.root, { command: "node", args: ["probe.mjs"], cwd: elsewhere }]] as const) {
      const decision = env.missions.bus.decision({ action: "terminal.exec", params, missionId: b.id, stepId: step.id, envelope, origin: "workstation", cwd, roots: [env.root, elsewhere] });
      assert.equal(decision.decision, "ask"); assert.equal(decision.desktopRequired, true); assert.equal(decision.remoteReview?.length, 1);
    }
  } finally { await env.cleanup(); rmSync(elsewhere, { recursive: true, force: true }); }
});

test("F01-R27 (HIGH): a paired-device change never lands under workstation-approved code that is already running", async () => {
  const env = await setup();
  try {
    // F02: the helper lives in data/ (PHONE_SAFE_DATA); a root .json is CONFIGURATION and never a device write.
    mkdirSync(join(env.root, "data"));
    writeFileSync(join(env.root, "data", "helper.json"), JSON.stringify({ v: "host" }));
    // M-A-3 T9R-F03: the running program lives OUTSIDE the project, where the D1 consumer scan cannot see that it reads
    // data/helper.json; that unseen-consumer case is exactly what the hold protects. (Inside the project the scan now
    // refuses the promotion outright; asserted at the end.)
    const slow = "import { readFileSync, writeFileSync } from 'node:fs'; await new Promise((r) => setTimeout(r, 1500)); writeFileSync('ran.txt', JSON.parse(readFileSync('data/helper.json', 'utf8')).v);";
    writeFileSync(join(env.dir, "slow.mjs"), slow);
    const run = env.missions.create({ objective: "Run slow", mode: "fast", origin: "workstation", steps: [capability("Run", "terminal.exec", { command: "node", args: [join(env.dir, "slow.mjs")] })] });
    env.missions.approve(run.id, "workstation");
    await until(() => env.missions.bus.liveCode.size === 1, "workstation run in flight");
    const edit = env.missions.create({ objective: "Edit helper", mode: "fast", origin: "workstation", steps: [capability("Write", "filesystem.write", { path: "data/helper.json", content: "{\"v\":\"phone\"}", overwrite: true })] });
    await phoneApprove(env, edit.id);
    const held = await waitAsk(env, edit.id, "filesystem.write");
    assert.equal(held.desktopRequired, true); assert.match(held.reason, /is running/);
    await assert.rejects(phoneRespond(env, held.id, "allow_once"), DESKTOP_ONLY);
    await until(() => env.missions.mission(run.id).state === "completed", "workstation run completes");
    assert.equal(readFileSync(join(env.root, "ran.txt"), "utf8"), "host", "the running program loaded only Host-reviewed content");
    await env.missions.respond(held.id, "allow_once", "workstation");
    await promoteStaged(env, edit.id); // F02: the held change is staged; the workstation promotes the exact bytes
    await until(() => env.missions.mission(edit.id).state === "completed", "held change lands after the workstation allows it");
    assert.equal(readFileSync(join(env.root, "data", "helper.json"), "utf8"), "{\"v\":\"phone\"}");
    writeFileSync(join(env.root, "slow.mjs"), slow);
    assert.equal(classifyDeviceWrite("data/helper.json", { base: env.root, operation: "write", content: "{}" }).classification, "EXECUTION_RELEVANT", "a project program that reads the file makes it non-phone-safe (F03)");
  } finally { await env.cleanup(); }
});

test("F01-R28 (MEDIUM): a device write onto a non-file destination never starts, so no unrecorded change can exist", async () => {
  const env = await setup();
  try {
    mkdirSync(join(env.root, "folder.txt"));
    const view = env.missions.create({ objective: "Write onto a folder", mode: "fast", origin: "workstation", steps: [capability("Write", "filesystem.write", { path: "folder.txt", content: "x", overwrite: true }, { maxRetries: 0 })] });
    await phoneApprove(env, view.id);
    // M-A-3 T9R-F02: the destination is classified before anything starts. A directory is UNKNOWN, so the device write
    // becomes a workstation-only ask and never runs. The old "failed after starting" case therefore leaves nothing
    // changed and nothing that needs recording; the new negative regression pins that instead.
    const ask = await waitAsk(env, view.id, "filesystem.write");
    assert.equal(ask.desktopRequired, true);
    assert.match(ask.reason, /classified UNKNOWN \(destination exists and is not a regular file\)/);
    await assert.rejects(phoneRespond(env, ask.id, "allow_once"), DESKTOP_ONLY);
    assert.equal(env.missions.store.runs({ missionId: view.id }).filter((run) => run.action === "filesystem.write").length, 0, "nothing started, so nothing changed");
    assert.ok(existsSync(join(env.root, "folder.txt")), "the destination folder is untouched");
    assert.ok(!env.missions.store.pendingRemoteChanges().some((change) => change.path === join(env.root, "folder.txt")), "no unrecorded change exists");
  } finally { await env.cleanup(); }
});

test("F01-R29 (MEDIUM): build, test and container tool configs are execution config for remote writes", () => {
  for (const name of [".cargo/config.toml", "Directory.Build.props", "app.csproj", "gulpfile.js", ".eslintrc.cjs", "karma.conf.js", "build.gradle.kts", "CMakeLists.txt", "docker-compose.yml", "Dockerfile", "deno.json", "composer.json", "Cargo.toml", ".yarn/plugins/p.cjs", "nodemon.json", ".mise.toml", "pom.xml"])
    assert.equal(executionConfigPath(join("C:/p", name)), true, name);
  for (const name of ["notes.md", "src/app.ts", "data/table.csv"]) assert.equal(executionConfigPath(join("C:/p", name)), false, name);
});

// ── Independent review round 5 closure ───────────────────────────────────────────────────────────────────────
test("F01-R30 (HIGH): a phone batch covers only operations a phone could approve alone (exact Calculator identity)", () => {
  const plan = (params: Record<string, unknown>) => [{ executor: { kind: "capability", action: "computer.focus_window", params }, verification: [] }, { executor: { kind: "capability", action: "computer.invoke_control", params: { ...params, automationId: "num8Button" } }, verification: [] }];
  const fake = (params: Record<string, unknown>) => ({
    store: { mission: () => ({ authorizationId: "a", root: "C:/p" }), authorization: () => ({ revokedAt: null, expiresAt: Date.now() + 60_000 }), step: () => plan(params)[0], steps: () => plan(params) },
    bus: { find: (action: string) => ({ manifest: { id: action, risk: "EXECUTE" } }) },
    agentic: { forMission: () => null }, deviceResumeRefusal: () => null,
  });
  const request = { missionId: "m", stepId: "s", action: "computer.focus_window", risk: "EXECUTE", batchOffer: { actions: ["computer.focus_window", "computer.invoke_control"] } };
  const refusal = (params: Record<string, unknown>) => MissionManager.prototype.deviceRequestRefusal.call(fake(params) as never, request as never, "allow_batch");
  assert.match(refusal({ pid: 5151 }) ?? "", DESKTOP_ONLY, "pid-only targets are not an exact Calculator identity");
  assert.match(refusal({ title: "Windows PowerShell" }) ?? "", DESKTOP_ONLY);
  assert.equal(refusal({ title: "Calculator" }), null, "the T9 Calculator batch stays phone-approvable");
});

test("F01-R31 (HIGH): a workstation review acknowledges only the paired-device changes its prompt shows", async () => {
  const env = await setup();
  try {
    // F02: device writes are staged, so 13 unreviewed paired-device changes are seeded directly (see seedUnreviewed).
    for (let i = 0; i < 13; i++) seedUnreviewed(env, `f-${String(i).padStart(2, "0")}.txt`, "x");
    assert.equal(env.missions.store.pendingRemoteChanges().length, 13);
    const b = env.missions.create({ objective: "Run", mode: "fast", origin: "workstation", steps: [capability("Run", "terminal.exec", { command: "node", args: ["probe.mjs"] })] });
    env.missions.approve(b.id, "workstation");
    const first = await waitAsk(env, b.id, "terminal.exec");
    assert.equal(first.remoteReview?.length, 12); assert.match(first.reason, /1 more changed file/);
    assert.doesNotMatch(first.reason, /f-12\.txt/, "the 13th change is not shown...");
    await env.missions.respond(first.id, "allow_once", "workstation");
    await until(() => !!pending(env, b.id) && pending(env, b.id)!.id !== first.id, "second review page");
    const second = pending(env, b.id);
    assert.equal(env.missions.store.pendingRemoteChanges().length, 1, "...so it is not acknowledged by the first answer");
    assert.match(second!.reason, /f-12\.txt/);
    assert.ok(!existsSync(join(env.root, "ran.txt")), "nothing ran before every change was shown");
    await env.missions.respond(second!.id, "allow_once", "workstation");
    await until(() => env.missions.mission(b.id).state === "completed", "runs after full review");
  } finally { await env.cleanup(); }
});

test("F01-R32 (MEDIUM): a phone's one-time answer is judged on every same-action verification check it would cover", () => {
  const step = (verifyPath: string) => ({ executor: { kind: "capability", action: "filesystem.read", params: { path: "seed.txt" } }, verification: [{ kind: "capability", action: "filesystem.read", params: { path: verifyPath }, expect: { field: "x" } }], requiredCapabilities: [], scope: { access: "read", isolation: "shared" }, providerConstraints: {} });
  const envelope = envelopeFrom(scopeFor([step("seed.txt") as unknown as MissionStep], "C:/p", "fast"), "m", "workstation", 60_000);
  const fake = (verifyPath: string) => ({
    store: { mission: () => ({ authorizationId: "a", root: "C:/p" }), authorization: () => envelope, step: () => step(verifyPath) },
    bus: { find: () => ({ manifest: { id: "filesystem.read", risk: "READ" } }) },
    agentic: { forMission: () => null }, deviceResumeRefusal: () => null,
  });
  const request = { missionId: "m", stepId: "s", action: "filesystem.read", risk: "READ", batchOffer: null };
  const refusal = (verifyPath: string) => MissionManager.prototype.deviceRequestRefusal.call(fake(verifyPath) as never, request as never, "allow_once");
  assert.equal(refusal("C:/p/other.txt"), null);
  assert.match(refusal("C:/Windows/win.ini") ?? "", /Windows Host/, "an out-of-envelope verification read is not covered by a phone");
});

test("F01-R33 (MEDIUM): a phone never answers a provider ask that would exceed the Mission's session budget", async () => {
  const env = await setup({ providers: ["ollama"] });
  try {
    const view = env.missions.create({ objective: "Summarize", mode: "fast", origin: "workstation", localOnly: true, steps: [model("Writer", "Summarize", { access: "read", maxRetries: 0 })] });
    await phoneApprove(env, view.id, false);
    const envelope = env.missions.store.authorization(env.missions.mission(view.id).authorizationId!)!;
    env.missions.store.saveAuthorization({ ...envelope, providers: { ...envelope.providers, sessions: { ...envelope.providers.sessions!, maxSessions: 0 } } });
    await missionCommand(env.missions, "mission.start", { id: view.id }, { local: false, actor: PHONE });
    const ask = await waitAsk(env, view.id, "provider.execute");
    assert.match(ask.reason, /budget exhausted/);
    await assert.rejects(phoneRespond(env, ask.id, "allow_once"), /Windows Host/);
    await settle();
    assert.equal(env.launched.length, 0);
  } finally { await env.cleanup(); }
});

test("F01-R34 (LOW): classifier precision: MSBuild entry points and dotenv are config, ordinary props/gradle folders are not", () => {
  for (const name of ["Directory.Build.props", "Directory.Build.targets", "Directory.Packages.props", "app.csproj", ".env", ".env.local"]) assert.equal(executionConfigPath(join("C:/p", name)), true, name);
  for (const name of ["src/theme.props", "src/app.targets", "src/gradle/x.ts", "docs/gradle/readme.md"]) assert.equal(executionConfigPath(join("C:/p", name)), false, name);
});

// ── Independent review round 6 closure ───────────────────────────────────────────────────────────────────────
test("F01-R35 (HIGH): a phone answer never resumes a workstation Mission whose remaining code would run unasked", async () => {
  const env = await setup();
  try {
    const view = env.missions.create({ objective: "Write then run", mode: "fast", origin: "workstation", steps: [capability("Write", "filesystem.write", { path: "n.txt", content: "x" }), { ...capability("Run", "terminal.exec", { command: "node", args: ["probe.mjs"] }), dependsOn: [0] }] });
    env.missions.approve(view.id, "workstation", false);
    const write = env.missions.store.steps(view.id).find((step) => step.role === "Write")!;
    const ask = { id: "f01-r35", missionId: view.id, stepId: write.id, action: "filesystem.write", risk: "WRITE" as const, reason: "ask", createdAt: Date.now(), resolvedAt: null, resolution: null, resolvedBy: null, batchOffer: null };
    assert.match(env.missions.deviceRequestRefusal(ask) ?? "", DESKTOP_ONLY, "answering would let the workstation-approved terminal step run");
    const benign = env.missions.create({ objective: "Write", mode: "fast", origin: "workstation", steps: [capability("Write", "filesystem.write", { path: "m.txt", content: "x" })] });
    env.missions.approve(benign.id, "workstation", false);
    const only = env.missions.store.steps(benign.id)[0];
    assert.equal(env.missions.deviceRequestRefusal({ ...ask, missionId: benign.id, stepId: only.id }), null, "a benign workstation Mission stays phone-answerable");
  } finally { await env.cleanup(); }
});

test("F01-R36 (HIGH): descendants of a finished workstation session keep paired-device changes held until none survives", async () => {
  const env = await setup();
  try {
    const writeHelper = () => env.missions.create({ objective: "Edit helper", mode: "fast", origin: "workstation", steps: [capability("Write", "filesystem.write", { path: "helper.json", content: "{\"v\":\"phone\"}", overwrite: true })] });
    // No descendant survives: the session stops counting as live once the process table says so.
    env.tasks.readProcesses = async () => [];
    const watch = (id: string) => [...env.tasks.lingering.keys()].find((key) => key.startsWith(`${id}#`));
    env.tasks.watchSurvivors("ended-session", 4242);
    assert.equal(env.tasks.lingering.get(watch("ended-session")!), "checking", "fail-closed until the first process-table read");
    await until(() => !watch("ended-session"), "no survivors");
    // A detached child of the ended root survives: phone changes wait for the workstation.
    env.tasks.readProcesses = async () => [{ pid: 4343, ppid: 4242, name: "node.exe", createdAt: 1 }];
    env.tasks.watchSurvivors("survivor-session", 4242);
    await until(() => Array.isArray(env.tasks.lingering.get(watch("survivor-session") ?? "")), "survivor recorded");
    assert.ok(env.missions.liveCodeExecutions().length >= 1);
    const edit = writeHelper();
    await phoneApprove(env, edit.id);
    const held = await waitAsk(env, edit.id, "filesystem.write");
    assert.equal(held.desktopRequired, true); assert.match(held.reason, /is running/);
    await assert.rejects(phoneRespond(env, held.id, "allow_once"), DESKTOP_ONLY);
    assert.ok(!existsSync(join(env.root, "helper.json")));
    env.tasks.lingering.clear();
  } finally { env.tasks.lingering.clear(); await env.cleanup(); }
});

test("F01-R37 (MEDIUM): Git reads wait for review of paired-device changes (owner-configured textconv or filters can run them)", async () => {
  const env = await setup({ adapters: [new FilesystemCapability(), new TerminalCapability(), new NotificationsCapability(() => {}), new GitCapability(tmpdir())] });
  try {
    seedUnreviewed(env, "conv.json", "1"); // F02: seeded unreviewed paired-device change (device writes are staged)
    const b = env.missions.create({ objective: "Status", mode: "fast", origin: "workstation", steps: [capability("Status", "git.status", {})] });
    const approved = env.missions.approve(b.id, "workstation", false);
    const envelope = env.missions.store.authorization(approved.authorizationId!)!;
    const step = env.missions.store.steps(b.id)[0];
    for (const action of ["git.status", "git.diff", "git.log"]) {
      const decision = env.missions.bus.decision({ action, params: {}, missionId: b.id, stepId: step.id, envelope, origin: "workstation", cwd: env.root, roots: [env.root] });
      assert.equal(decision.decision, "ask", action); assert.equal(decision.desktopRequired, true); assert.equal(decision.remoteReview?.length, 1);
    }
  } finally { await env.cleanup(); }
});

test("F01-R38 (LOW): a provider review with more changes than one prompt lists asks the next page instead of failing", async () => {
  const env = await setup({ providers: ["claude"] });
  try {
    // F02: 13 unreviewed paired-device changes are seeded directly (device writes are staged, see seedUnreviewed).
    for (let i = 0; i < 13; i++) seedUnreviewed(env, `g-${String(i).padStart(2, "0")}.txt`, "x");
    const view = env.missions.create({ objective: "Code", mode: "fast", origin: "workstation", steps: [model("Coder", "Change code", { access: "write", maxRetries: 0 })] });
    env.missions.approve(view.id, "workstation");
    const first = await waitAsk(env, view.id, "provider.execute");
    assert.equal(first.remoteReview?.length, 12);
    await env.missions.respond(first.id, "allow_once", "workstation");
    await until(() => !!pending(env, view.id) && pending(env, view.id)!.id !== first.id, "next review page");
    const second = pending(env, view.id)!;
    assert.equal(second.action, "provider.execute"); assert.equal(second.remoteReview?.length, 1);
    assert.equal(env.missions.store.step(second.stepId).failure, null, "not failed as provider_unavailable");
    assert.equal(env.launched.length, 0);
    await env.missions.respond(second.id, "allow_once", "workstation");
    await until(() => env.launched.length === 1, "launch after full review");
    env.launched[0].finish({ ok: true, output: "done" });
  } finally { await env.cleanup(); }
});

// ── Independent review round 7 closure ───────────────────────────────────────────────────────────────────────
test("F01-R39 (HIGH): a paired device writes only inert data and documents; code, agent configuration and downloads stay on the workstation", () => {
  // F02: JSON/YAML is data only inside a recognized data folder; out/result.json is now CONFIGURATION (safer), so the
  // safe-data example moved to exports/, and conf/ (a configuration folder) is refused below.
  for (const path of ["notes.txt", "README.md", "data/table.csv", "exports/result.json", "a/b.log"])
    assert.equal(remoteExecutionRefusal("filesystem.write", { path }, "WRITE", "C:/p"), null, path);
  for (const path of ["helper.mjs", "probe.js", "run.ps1", "start.cmd", "tool.py", "app.ts", "page.html", "image.svg", "noextension", "lib.dll", "x.txt.mjs", "x.txt:evil.mjs", "out/result.json", "conf/values.yaml", ".claude/settings.json", ".mcp.json", "CLAUDE.md", "AGENTS.md", ".cursor/rules.md"])
    assert.match(remoteExecutionRefusal("filesystem.write", { path }, "WRITE", "C:/p") ?? "", DESKTOP_ONLY, path);
  assert.match(remoteExecutionRefusal("browser.download", { url: "https://example.com/x.exe" }, "WRITE", "C:/p") ?? "", DESKTOP_ONLY);
  assert.equal(remoteExecutionRefusal("filesystem.delete", { path: "old.txt" }, "DESTRUCTIVE", "C:/p"), null, "removing an ordinary document adds no code");
  // F02: a device delete is classified like a write. Removing a document stays bounded; removing an execution-relevant
  // file is workstation-only (it can change what runs), so the old "any delete is bounded" premise is narrowed.
  assert.match(remoteExecutionRefusal("filesystem.delete", { path: "old.mjs" }, "DESTRUCTIVE", "C:/p") ?? "", DESKTOP_ONLY, "deleting code is refused for a device");
});

test("F01-R40 (HIGH): survivor tracking follows the whole lineage of a finished session, across launcher exits and retries", async () => {
  const env = await setup();
  try {
    let table: { pid: number; ppid: number; name: string; createdAt: number | null }[] = [{ pid: 4343, ppid: 4242, name: "cmd.exe", createdAt: 10 }, { pid: 4444, ppid: 4343, name: "node.exe", createdAt: 11 }, { pid: 4146, ppid: 4141, name: "node.exe", createdAt: 12 }];
    env.tasks.readProcesses = async () => table;
    env.tasks.watchSurvivors("attempt", 4242);
    env.tasks.watchSurvivors("attempt", 4141); // a retry (new root) never hides the first attempt's survivors
    await until(() => [...env.tasks.lingering.values()].filter(Array.isArray).length === 2, "both attempts tracked");
    const [first, second] = [...env.tasks.lingering.keys()];
    // The first launcher exits; the server it started keeps running and spawns a worker after the last check.
    table = [{ pid: 4444, ppid: 4343, name: "node.exe", createdAt: 11 }, { pid: 4545, ppid: 4444, name: "node.exe", createdAt: 20 }];
    await new Promise((r) => setTimeout(r, 10_500));
    assert.deepEqual((env.tasks.lingering.get(first) as { pid: number }[]).map((row) => row.pid).sort(), [4444, 4545]);
    assert.ok(!env.tasks.lingering.has(second), "the second attempt left nothing alive");
    table = [];
    await until(() => !env.tasks.lingering.has(first), "released when nothing survives", 15_000);
  } finally { env.tasks.lingering.clear(); await env.cleanup(); }
});

// ── Independent review round 8 closure ───────────────────────────────────────────────────────────────────────
test("F01-R41 (HIGH): the workstation reviews the content of paired-device changes, not only their names", async () => {
  const env = await setup();
  try {
    const body = "require('fs').writeFileSync('ran.flag','x')";
    seedUnreviewed(env, "notes.txt", body); // F02: seeded unreviewed paired-device change (device writes are staged)
    const b = env.missions.create({ objective: "Run", mode: "fast", origin: "workstation", steps: [capability("Run", "terminal.exec", { command: "node", args: ["notes.txt"] })] });
    env.missions.approve(b.id, "workstation");
    const ask = await waitAsk(env, b.id, "terminal.exec");
    assert.match(ask.reason, /review their content/i);
    assert.ok(ask.reason.includes(body), "the prompt shows what the file contains");
    assert.match(ask.reason, /sha256 [0-9a-f]{16}/);
    await settle();
    assert.ok(!existsSync(join(env.root, "ran.flag")), "nothing ran before the workstation reviewed the content");
    // Git reads in flight count as live code for the mid-run hold.
    const gitRun = (env.missions.bus as unknown as { liveCode: Map<string, string> }).liveCode;
    gitRun.set("probe-git-read", "git.status");
    const edit = env.missions.create({ objective: "Edit", mode: "fast", origin: "workstation", steps: [capability("Write", "filesystem.write", { path: "more.txt", content: "x", overwrite: true })] });
    await phoneApprove(env, edit.id);
    const held = await waitAsk(env, edit.id, "filesystem.write");
    assert.match(held.reason, /git\.status/);
    gitRun.delete("probe-git-read");
  } finally { await env.cleanup(); }
});

// ── Independent review round 9 closure ───────────────────────────────────────────────────────────────────────
test("F01-R42 (HIGH): a review prompt shows the whole changed file, or says plainly that it cannot", async () => {
  const env = await setup();
  try {
    const padded = `${"benign note line\n".repeat(60)}require('fs').writeFileSync('ran.flag','x')`;
    const huge = "x".repeat(9000) + "require('fs').writeFileSync('ran2.flag','x')";
    // F02: seeded unreviewed paired-device changes (device writes are staged, see seedUnreviewed).
    seedUnreviewed(env, "padded.txt", padded);
    seedUnreviewed(env, "huge.txt", huge);
    const b = env.missions.create({ objective: "Run", mode: "fast", origin: "workstation", steps: [capability("Run", "terminal.exec", { command: "node", args: ["padded.txt"] })] });
    env.missions.approve(b.id, "workstation");
    const ask = await waitAsk(env, b.id, "terminal.exec");
    assert.ok(ask.reason.includes("writeFileSync('ran.flag'"), "a payload past the old 600-byte preview is shown");
    assert.match(ask.reason, /padded\.txt": \d+ bytes, sha256 [0-9a-f]{64}, full content/);
    assert.match(ask.reason, /huge\.txt": 9\d{3} bytes, sha256 [0-9a-f]{64}\. TOO LARGE TO SHOW HERE/);
    // A paired device never sees the Host-wide listing (paths and content of other changes).
    const projected = env.missions.remoteVerdicts(env.missions.snapshot()).missions.find((m) => m.id === b.id)!.requests.find((r) => r.id === ask.id)!;
    assert.doesNotMatch(projected.reason, /sha256|padded\.txt|ran\.flag/);
  } finally { await env.cleanup(); }
});

test("F01-R43 (MEDIUM): a workstation Mission a phone started is a paired-device actor for the hold and the review", async () => {
  const env = await setup();
  try {
    writeFileSync(join(env.root, "slow.mjs"), "await new Promise((r) => setTimeout(r, 1500));");
    const run = env.missions.create({ objective: "Run slow", mode: "fast", origin: "workstation", steps: [capability("Run", "terminal.exec", { command: "node", args: ["slow.mjs"] })] });
    env.missions.approve(run.id, "workstation");
    await until(() => env.missions.bus.liveCode.size === 1, "workstation run in flight");
    const write = env.missions.create({ objective: "Write", mode: "fast", origin: "workstation", steps: [capability("Write", "filesystem.write", { path: "w.txt", content: "x", overwrite: true })] });
    env.missions.approve(write.id, "workstation", false);
    await missionCommand(env.missions, "mission.start", { id: write.id }, { local: false, actor: PHONE });
    assert.equal(env.missions.mission(write.id).deviceDriven, PHONE);
    const held = await waitAsk(env, write.id, "filesystem.write");
    assert.match(held.reason, /is running/);
    await until(() => env.missions.mission(run.id).state === "completed", "run completes");
    await env.missions.respond(held.id, "allow_once", "workstation");
    await promoteStaged(env, write.id); // F02: the device-started write is staged, then promoted by the workstation
    await until(() => env.missions.mission(write.id).state === "completed", "write completes");
    // The change is recorded for review when it is promoted (the workstation's acknowledgement is the review).
    assert.ok(env.missions.staging.forMission(write.id).some((record) => record.destination === join(env.root, "w.txt") && record.promotionState === "PROMOTED"), "recorded and promoted");
  } finally { await env.cleanup(); }
});

test("F01-R44 (MEDIUM): survivors are judged by the attempt that left them, not by a later reroute", async () => {
  const env = await setup();
  try {
    env.tasks.readProcesses = async () => [{ pid: 7001, ppid: 7000, name: "node.exe", createdAt: 5 }];
    env.tasks.lingering.set("rerouted#1", [{ pid: 7001, ppid: 7000, name: "node.exe", createdAt: 5 }]);
    env.tasks.lingeringAttempt.set("rerouted#1", { provider: "codex", access: "write", mission: true });
    assert.ok(env.missions.liveCodeExecutions().some((entry) => entry.includes("codex survivors")));
    env.tasks.lingeringAttempt.set("ollama#1", { provider: "ollama", access: "read", mission: true });
    env.tasks.lingering.set("ollama#1", "checking");
    assert.ok(!env.missions.liveCodeExecutions().some((entry) => entry.includes("ollama")), "tool-free attempts never hold");
  } finally { env.tasks.lingering.clear(); env.tasks.lingeringAttempt.clear(); await env.cleanup(); }
});

test("F01-R45 (LOW): revoking a device ends its unexecuted one-time answers", async () => {
  const env = await setup();
  try {
    const view = env.missions.create({ objective: "Write", mode: "fast", origin: "workstation", steps: [capability("Write", "filesystem.write", { path: "r.txt", content: "x" })] });
    env.missions.approve(view.id, "workstation", false);
    const step = env.missions.store.steps(view.id)[0];
    const request = { id: "f01-r45", missionId: view.id, stepId: step.id, action: "filesystem.write", risk: "WRITE" as const, reason: "ask", createdAt: Date.now(), resolvedAt: Date.now(), resolution: "allow_once" as const, resolvedBy: PHONE, batchOffer: null };
    env.missions.store.saveRequest(request);
    env.missions.store.saveStep({ ...step, approvedOnce: { requestId: request.id, action: "filesystem.write" } });
    assert.equal(env.missions.endDeviceAnswers(PHONE), 1);
    assert.equal(env.missions.store.step(step.id).approvedOnce, null);
    assert.equal(env.missions.endDeviceAnswers("device:other"), 0);
  } finally { await env.cleanup(); }
});

// ── Independent review round 10 closure ──────────────────────────────────────────────────────────────────────
test("F01-R46 (BLOCKER): a superseded review re-ask shows every change it acknowledges", async () => {
  const env = await setup();
  try {
    seedUnreviewed(env, "a.txt", "first change"); // F02: seeded unreviewed paired-device change (device writes are staged)
    const run = env.missions.create({ objective: "Run", mode: "fast", origin: "workstation", steps: [capability("Run", "terminal.exec", { command: "node", args: ["probe.mjs"] })] });
    env.missions.approve(run.id, "workstation");
    const first = await waitAsk(env, run.id, "terminal.exec");
    assert.match(first.reason, /a\.txt/); assert.doesNotMatch(first.reason, /b\.txt/);
    seedUnreviewed(env, "b.txt", "SECOND-CHANGE-CONTENT");
    // Seeding records a change without a capability run; one real project mutation moves the mutation sequence, as any
    // file-changing run does (a workstation-direct write here, so it adds no paired-device change of its own).
    const bump = await env.missions.bus.request({ action: "filesystem.write", params: { path: "bump.txt", content: "bump", overwrite: true }, missionId: null, stepId: null, envelope: null, origin: "workstation", cwd: env.root, roots: [env.root], direct: { confirmed: true } });
    assert.equal(bump.run?.status, "succeeded");
    await assert.rejects(env.missions.respond(first.id, "allow_once", "workstation"), /Project files changed/);
    const second = pending(env, run.id)!;
    assert.equal(second.remoteReview?.length, 2);
    assert.match(second.reason, /b\.txt/); assert.ok(second.reason.includes("SECOND-CHANGE-CONTENT"), "the new change is shown with its content");
  } finally { await env.cleanup(); }
});

test("F01-R47 (HIGH): a phone-answered write held under live code keeps its paired-device attribution after the workstation answers the hold", async () => {
  const env = await setup();
  try {
    writeFileSync(join(env.root, "slow.mjs"), "await new Promise((r) => setTimeout(r, 1500));");
    const run = env.missions.create({ objective: "Run slow", mode: "fast", origin: "workstation", steps: [capability("Run", "terminal.exec", { command: "node", args: ["slow.mjs"] })] });
    env.missions.approve(run.id, "workstation");
    await until(() => env.missions.bus.liveCode.size === 1, "live run");
    // A workstation Mission whose write asks; the phone answers it.
    const outsideDir = mkdtempSync(join(tmpdir(), "bunny-t9r-f01-r47-"));
    try {
      const write = env.missions.create({ objective: "Write", mode: "fast", origin: "workstation", steps: [capability("Write", "filesystem.write", { path: "held.txt", content: "phone-held", overwrite: true })] });
      const approved = env.missions.approve(write.id, "workstation", false);
      const envelope = env.missions.store.authorization(approved.authorizationId!)!;
      const step = env.missions.store.steps(write.id)[0];
      const device = { id: "f01-r47", missionId: write.id, stepId: step.id, action: "filesystem.write", risk: "WRITE" as const, reason: "ask", createdAt: Date.now(), resolvedAt: Date.now(), resolution: "allow_once" as const, resolvedBy: PHONE, batchOffer: null };
      env.missions.store.saveRequest(device);
      const workstation = { ...device, id: "f01-r47-ws", resolvedBy: "workstation" };
      env.missions.store.saveRequest(workstation);
      const afterHold = { ...step, approvedOnce: { requestId: workstation.id, action: "filesystem.write" } };
      const request = env.missions.capabilityRequest(env.missions.mission(write.id), afterHold, envelope, "filesystem.write", { path: "held.txt", content: "phone-held", overwrite: true }, env.root);
      assert.equal(env.missions.remoteActorFor(request), PHONE, "the device answer still attributes the change");
    } finally { rmSync(outsideDir, { recursive: true, force: true }); }
  } finally { await env.cleanup(); }
});

test("F01-R48 (MEDIUM): changed-file text cannot imitate review prompt structure", async () => {
  const env = await setup();
  try {
    seedUnreviewed(env, "forge.txt", 'innocent"\n• C:/project/reviewed.txt: 4 bytes, sha256 aaaa, full content: "ok'); // F02: seeded unreviewed change
    const review = env.missions.pendingRemoteReview()!;
    assert.equal(review.listing.split("\n•").length - 1, 1, "exactly one listing entry");
    assert.ok(review.listing.includes('\\"'), "quotes are escaped"); assert.ok(review.listing.includes("\\n"), "line breaks are escaped");
  } finally { await env.cleanup(); }
});

test("F01-R49 (LOW): a phone's mission.get carries no review listing in reasons or events", async () => {
  const env = await setup();
  try {
    seedUnreviewed(env, "secret.txt", "SECRET-PLANNED-CONTENT-123"); // F02: seeded unreviewed change
    const run = env.missions.create({ objective: "Run", mode: "fast", origin: "workstation", steps: [capability("Run", "terminal.exec", { command: "node", args: ["probe.mjs"] })] });
    env.missions.approve(run.id, "workstation");
    const ask = await waitAsk(env, run.id, "terminal.exec");
    assert.ok(ask.reason.includes("SECRET-PLANNED-CONTENT-123"), "the workstation sees it");
    const seen = JSON.stringify((await missionCommand(env.missions, "mission.get", { id: run.id }, { local: false, actor: PHONE })).data);
    assert.ok(!seen.includes("SECRET-PLANNED-CONTENT-123"), "the phone does not");
  } finally { await env.cleanup(); }
});

// ── Independent review round 11 closure ──────────────────────────────────────────────────────────────────────
test("F01-R50 (MEDIUM): no Host response to a paired device carries the review listing (state, inbox, agents, mission.get)", { timeout: 120_000 }, async () => {
  const f = await hostFixture();
  try {
    const phone = await f.pair();
    const sentinel = "SENTINEL-REVIEW-CONTENT-50";
    const write = await f.mission([{ role: "Write", objective: "Write", dependsOn: [], executor: { kind: "capability", action: "filesystem.write", params: { path: "note.txt", content: sentinel, overwrite: true } } }]);
    assert.equal((await f.api("mission.approve", { id: write.id, start: true }, phone.token)).status, 200);
    // F02: the phone's write is staged; the workstation's promotion prompt is the review listing that carries the content.
    await pollUntil(async () => (await f.get(write.id)).requests.some((r: { resolvedAt: number | null; action: string }) => !r.resolvedAt && r.action === "filesystem.promote"), "promotion review");
    assert.ok(JSON.stringify((await f.api("mission.get", { id: write.id })).body).includes(sentinel), "the workstation review shows the staged content");
    const state = await (await fetch(`${f.base}/state`, { headers: { authorization: `Bearer ${phone.token}` } })).text();
    assert.ok(!state.includes(sentinel), "device /state (missions, inbox, agents) carries no listing");
    // The device's own plan (its step parameters) legitimately names its content; the review listing must not reach it.
    const device = (await f.api("mission.get", { id: write.id }, phone.token)).body.data as { mission: { requests: Record<string, unknown>[] } };
    assert.ok(!JSON.stringify(device.mission.requests).includes(sentinel), "device mission.get carries no review listing");
    assert.ok(device.mission.requests.every((request) => !("promotion" in request)), "device mission.get carries no promotion record");
  } finally { await f.close(); }
});

test("F01-R51 (MEDIUM): a device answer anywhere in a Mission attributes every later change in it", async () => {
  const env = await setup();
  try {
    const view = env.missions.create({ objective: "Read then write", mode: "fast", origin: "workstation", steps: [capability("Read", "filesystem.read", { path: "seed.txt" }), { ...capability("Write", "filesystem.write", { path: "w.txt", content: "x" }), dependsOn: [0] }] });
    const approved = env.missions.approve(view.id, "workstation", false);
    const envelope = env.missions.store.authorization(approved.authorizationId!)!;
    const [read, write] = env.missions.store.steps(view.id);
    env.missions.store.saveRequest({ id: "f01-r51", missionId: view.id, stepId: read.id, action: "filesystem.read", risk: "READ", reason: "ask", createdAt: Date.now(), resolvedAt: Date.now(), resolution: "allow_once", resolvedBy: PHONE, batchOffer: null });
    const request = env.missions.capabilityRequest(env.missions.mission(view.id), write, envelope, "filesystem.write", { path: "w.txt", content: "x" }, env.root);
    assert.equal(env.missions.remoteActorFor(request), PHONE);
  } finally { await env.cleanup(); }
});

test("F01-R52 (MEDIUM): revoking a device stops the Missions it started or resumed", async () => {
  const env = await setup({ providers: ["claude"] });
  try {
    const view = env.missions.create({ objective: "Edit", mode: "fast", origin: "workstation", steps: [model("Coder", "Edit", { access: "write", maxRetries: 0 })] });
    env.missions.approve(view.id, "workstation");
    await until(() => env.launched.length === 1, "workstation session");
    env.missions.markDeviceDriven(view.id, PHONE);
    assert.equal(await env.missions.endDeviceDriven("device:other"), 0);
    assert.equal(await env.missions.endDeviceDriven(PHONE), 1);
    await until(() => env.missions.mission(view.id).state === "stopped", "stopped on revocation");
  } finally { await env.cleanup(); }
});

// ── Independent review round 12 closure ──────────────────────────────────────────────────────────────────────
test("F01-R53 (BLOCKER): Python task checks never run on a device's timing or over unreviewed paired-device changes", async () => {
  const env = await setup({ providers: ["ollama"] });
  try {
    const view = env.missions.create({ objective: "Write and check", mode: "fast", origin: "workstation", localOnly: true, steps: [
      capability("Write", "filesystem.write", { path: "hello.py", content: 'print("BUNNY_A_OK")', overwrite: true }),
      model("Check", "Summarize", { access: "read", maxRetries: 0, dependsOn: [0], verification: [{ kind: "task_spec", spec: { kind: "python", name: "hello.py", expected: "BUNNY_A_OK" } }] }),
    ] });
    env.missions.approve(view.id, "workstation", false);
    await assert.rejects(missionCommand(env.missions, "mission.start", { id: view.id }, { local: false, actor: PHONE }), DESKTOP_ONLY);
    // Even on the workstation's timing, a Python check waits while paired-device changes are unreviewed.
    seedUnreviewed(env, "phone.txt", "phone note"); // F02: seeded unreviewed paired-device change (device writes are staged)
    assert.match(env.tasks.codeRunGate?.() ?? "", DESKTOP_ONLY);
  } finally { await env.cleanup(); }
});

test("F01-R54 (HIGH): Git and GitHub CLI reads in a workstation plan are never started or resumed by a device", async () => {
  const env = await setup({ adapters: [new FilesystemCapability(), new TerminalCapability(), new NotificationsCapability(() => {}), new GitCapability(tmpdir())] });
  try {
    const view = env.missions.create({ objective: "Diff", mode: "fast", origin: "workstation", steps: [capability("Diff", "git.diff", {})] });
    env.missions.approve(view.id, "workstation", false);
    await assert.rejects(missionCommand(env.missions, "mission.start", { id: view.id }, { local: false, actor: PHONE }), DESKTOP_ONLY);
    assert.match(env.missions.deviceResumeRefusal(view.id) ?? "", DESKTOP_ONLY);
  } finally { await env.cleanup(); }
});

test("F01-R55 (BLOCKER): a shell-session prompt always shows the review listing, even when another violation also applies", async () => {
  const env = await setup({ providers: ["claude"] });
  try {
    seedUnreviewed(env, "cross-mission.md", "CROSS-MISSION-CONTENT-55"); // F02: seeded unreviewed paired-device change
    const view = env.missions.create({ objective: "Edit code", mode: "fast", origin: "workstation", steps: [model("Coder", "Change the code", { access: "write", maxRetries: 0 })] });
    await phoneApprove(env, view.id); // remote envelope: the shell session is also outside the remote ceiling
    const ask = await waitAsk(env, view.id, "provider.execute");
    assert.ok(ask.remoteReview?.length, "the answer would acknowledge paired-device changes...");
    assert.ok(ask.reason.includes("CROSS-MISSION-CONTENT-55"), "...so the prompt shows their content");
    assert.match(ask.reason, /sha256 [0-9a-f]{64}/);
  } finally { await env.cleanup(); }
});

test("F01-R56 (LOW): revoking a device stops a Mission it resumed by answering", async () => {
  const env = await setup({ providers: ["claude"] });
  try {
    const view = env.missions.create({ objective: "Edit", mode: "fast", origin: "workstation", steps: [model("Coder", "Edit", { access: "write", maxRetries: 0 })] });
    env.missions.approve(view.id, "workstation");
    await until(() => env.launched.length === 1, "workstation session");
    const step = env.missions.store.steps(view.id)[0];
    env.missions.store.saveRequest({ id: "f01-r56", missionId: view.id, stepId: step.id, action: "filesystem.read", risk: "READ", reason: "ask", createdAt: Date.now(), resolvedAt: Date.now(), resolution: "allow_once", resolvedBy: PHONE, batchOffer: null });
    assert.equal(await env.missions.endDeviceDriven(PHONE), 1);
    await until(() => env.missions.mission(view.id).state === "stopped", "stopped on revocation");
  } finally { await env.cleanup(); }
});

// ── Independent review round 13 closure ──────────────────────────────────────────────────────────────────────
test("F01-R57 (MEDIUM): every device response drops trusted-desktop grant, operation and binding records", () => {
  const view = { mission: { requests: [{ id: "r", desktopRequired: true, desktopOperation: { cwd: "C:/p" }, desktopBinding: { mutationSequence: 1 }, desktopGrant: { id: "g" } }] }, events: [{ detail: "Trusted-desktop grant g for terminal.exec (epoch e)." }] };
  const seen = redactReviewListing(view);
  assert.deepEqual(Object.keys(seen.mission.requests[0]).sort(), ["desktopRequired", "id"]);
  assert.doesNotMatch(JSON.stringify(seen), /epoch e|"g"/);
});

test("T13.3 N-C review F5: a step running under a one-time approval at restart is uncertain only when it could write", async () => {
  const env = await setup();
  try {
    const view = env.missions.create({ objective: "Mixed", mode: "fast", origin: "workstation", steps: [
      capability("Writer", "filesystem.write", { path: "w.txt", content: "w" }),
      capability("Reader", "filesystem.read", { path: "w.txt" }),
      capability("Guarded", "filesystem.write", { path: "g.txt", content: "g", expectBeforeSha256: "absent" }),
    ] });
    env.missions.approve(view.id, "workstation", false);
    // Synthesized persisted state: all three were running under a one-time allowance when the Host stopped.
    for (const step of env.missions.store.steps(view.id))
      env.missions.store.saveStep({ ...step, state: "running", approvedOnce: { requestId: `once-${step.role}`, action: step.executor.kind === "capability" ? step.executor.action : "x" } });
    env.missions.store.saveMission({ ...env.missions.mission(view.id), state: "running" });
    await env.restart();
    const [writer, reader, guarded] = env.missions.store.steps(view.id);
    assert.deepEqual([writer.state, writer.approvedOnce, writer.reconciliation?.required], ["failed", null, true], "a write under a one-time approval may have landed");
    assert.match(writer.reconciliation?.reason ?? "", /one-time approval/);
    assert.equal(reader.reconciliation, undefined, "a read needs a fresh decision, not reconciliation");
    assert.equal(guarded.reconciliation, undefined, "a Host-guarded write can be replayed safely");
    assert.throws(() => env.missions.retry(view.id, "workstation"), /OUTCOME_UNCERTAIN/);
    // Review F6/F13: restart recovery cannot re-admit it either; only the owner's reconciliation can.
    const [resubmit] = await env.missions.reconcileInterrupted(view.id, [{ stepId: writer.id, mode: "resubmit" }]);
    assert.deepEqual([resubmit.applied, env.missions.store.step(writer.id).state], [false, "failed"]);
    assert.match(String(resubmit.reason), /reconciliation required/);
  } finally { await env.cleanup(); }
});
