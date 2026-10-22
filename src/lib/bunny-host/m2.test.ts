import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexAdapter, ClaudeAdapter, DetectOnlyAdapter, OllamaAdapter, providerBase } from "./adapters.server.ts";
import { locate, parseNpmShim, newestVersionFolder, systemContext, type DiscoveryContext } from "./discovery.server.ts";
import { ClaudeNormalizer, CodexNormalizer, classifyCommand, displayCommand } from "./events.ts";
import { bunnyRoute, eligibility, structuredDecision } from "./router.ts";
import { HostDatabase } from "./persistence.server.ts";
import { ModelCapabilityRegistry } from "./model-capability.server.ts";
import { TaskManager } from "./manager.server.ts";
import { canonical } from "../bunny-missions/paths.server.ts";
import { ProviderRegistry, applyUsage } from "./registry.server.ts";
import { codexUsageWindows } from "./codex-probe.server.ts";
import { descendants, survivors } from "./process-tree.server.ts";
import { ringPlacement } from "./usage.ts";
import type { AdapterHooks, AdapterResult, HostEvent, ProviderAdapter } from "./contracts.ts";
import type { OrchTask, ProviderId, ProviderLive } from "../orch/types.ts";

const SHIM = (relative: string) => `@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n\r\nIF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n) ELSE (\r\n  SET "_prog=node"\r\n  SET PATHEXT=%PATHEXT:;.JS;=;%\r\n)\r\n\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\${relative}" %*\r\n`;
/** A throwaway machine: one PATH folder holding npm-style shims to fake CLIs, and empty profile folders. */
function fakeMachine(scripts: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "bunny-m2-cli-"));
  const bin = join(root, "bin"); mkdirSync(bin);
  for (const [name, source] of Object.entries(scripts)) {
    mkdirSync(join(bin, "node_modules", `fake-${name}`), { recursive: true });
    writeFileSync(join(bin, "node_modules", `fake-${name}`, "cli.js"), source);
    writeFileSync(join(bin, `${name}.cmd`), SHIM(`node_modules\\fake-${name}\\cli.js`));
  }
  const ctx = (): DiscoveryContext => ({ ...systemContext(), platform: "win32", env: { PATH: bin, APPDATA: join(root, "appdata"), LOCALAPPDATA: join(root, "local") }, home: join(root, "home") });
  return { root, bin, ctx, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
const cli = (body: string) => `const args=process.argv.slice(2).join(" ");${body}`;
const windowsOnly = { skip: process.platform !== "win32" && "npm cmd shims are a Windows install shape" };

test("Codex detection: npm shim resolves to its real script; a signed-out CLI is authentication_required, never ready", windowsOnly, async () => {
  const machine = fakeMachine({ codex: cli(`if(args==="--version"){console.log("codex-cli 9.9.9");process.exit(0)}if(args==="login status"){console.error("Not logged in");process.exit(1)}process.exit(2)`) });
  try {
    const located = locate(machine.ctx(), "codex");
    assert.equal(located.launch?.kind, "node-script");
    assert.match(located.launch!.path, /fake-codex[\\/]cli\.js$/);
    const live = await new CodexAdapter(machine.ctx).detect();
    assert.equal(live.installed, true);
    assert.equal(live.version, "codex-cli 9.9.9");
    assert.equal(live.authenticatedState, "not_authenticated");
    assert.equal(live.availability, "authentication_required");
    assert.match(live.detail, /not signed in/);
    assert.ok(eligibility(live, {}), "an unauthenticated provider is never eligible");
  } finally { machine.cleanup(); }
});

test("Claude detection: loggedIn=false requires sign-in; unreadable auth stays Unknown; missing CLI is not_installed", windowsOnly, async () => {
  const signedOut = fakeMachine({ claude: cli(`if(args==="--version"){console.log("9.9.9 (Claude Code)");process.exit(0)}if(args==="auth status"){console.log(JSON.stringify({loggedIn:false}));process.exit(1)}`) });
  const garbled = fakeMachine({ claude: cli(`if(args==="--version"){console.log("9.9.9 (Claude Code)");process.exit(0)}console.log("<html>not json</html>")`) });
  const empty = fakeMachine({});
  try {
    const out = await new ClaudeAdapter(signedOut.ctx).detect();
    assert.equal(out.version, "9.9.9 (Claude Code)");
    assert.equal(out.availability, "authentication_required");
    const unknown = await new ClaudeAdapter(garbled.ctx).detect();
    assert.equal(unknown.authenticatedState, "unknown");
    assert.equal(unknown.availability, "unknown");
    const missing = await new ClaudeAdapter(empty.ctx).detect();
    assert.equal(missing.installed, false);
    assert.equal(missing.availability, "not_installed");
  } finally { signedOut.cleanup(); garbled.cleanup(); empty.cleanup(); }
});

test("Codex ready requires a real catalogue: a signed-in CLI without one is unavailable, not ready", windowsOnly, async () => {
  const machine = fakeMachine({ codex: cli(`if(args==="--version"){console.log("codex-cli 9.9.9");process.exit(0)}if(args==="login status"){console.error("Logged in using ChatGPT");process.exit(0)}process.exit(3)`) });
  try {
    const live = await new CodexAdapter(machine.ctx).detect();
    assert.equal(live.authenticatedState, "authenticated");
    assert.equal(live.availability, "unavailable");
    assert.match(live.detail, /catalogue/);
  } finally { machine.cleanup(); }
});

test("discovery parses npm shims and Cursor Agent version folders without executing anything", () => {
  assert.deepEqual(parseNpmShim(`"%dp0%\\node_modules\\opencode-ai\\bin\\opencode.exe"   %*`), { relative: "node_modules\\opencode-ai\\bin\\opencode.exe", viaNode: false });
  assert.deepEqual(parseNpmShim(SHIM("node_modules\\cline\\bin\\cline")), { relative: "node_modules\\cline\\bin\\cline", viaNode: true });
  assert.equal(parseNpmShim("@echo off\r\npowershell -File x.ps1"), null);
  assert.equal(newestVersionFolder(["2026.08.01-abc123", "2026.09.10-fd3934a", "notes", "2026.09.10-01-02-03-0a1b2c"]), "2026.09.10-01-02-03-0a1b2c");
});

test("detect-only providers are reported but never routable", windowsOnly, async () => {
  const machine = fakeMachine({ opencode: cli(`if(args==="--version"){console.log("1.2.3");process.exit(0)}console.log("3 credentials")`) });
  try {
    const live = await new DetectOnlyAdapter("opencode", machine.ctx).detect();
    assert.equal(live.installed, true);
    assert.equal(live.version, "1.2.3");
    assert.equal(live.availability, "unavailable");
    assert.match(live.detail, /no OpenCode execution adapter/);
    assert.equal(live.features?.launch.supported, false);
    assert.ok(eligibility(live, {}));
  } finally { machine.cleanup(); }
});

function ready(id: ProviderId, extra: Partial<ProviderLive> = {}): ProviderLive {
  const agent = id === "codex" || id === "claude";
  return { ...providerBase(id), installed: true, authenticated: true, authenticatedState: id === "ollama" ? "not_required" : "authenticated", availability: "ready", capabilities: agent ? ["text", "filesystem", "terminal", "tests", "git"] : ["text"], current_model: id === "ollama" ? "local-model" : "model", ...extra };
}

test("hard localOnly constraint excludes cloud providers outright, whatever their score", () => {
  const providers = [ready("codex"), ready("claude"), ready("ollama")];
  const decision = bunnyRoute({ prompt: "Rewrite this paragraph more clearly", mode: "deep", providers, constraints: { localOnly: true } });
  assert.equal(decision.recommended_provider, "ollama");
  assert.deepEqual(decision.eligible_providers, ["ollama"]);
  assert.deepEqual(decision.excluded?.map((row) => row.provider).sort(), ["claude", "codex"]);
  assert.ok(decision.excluded?.every((row) => /local execution/.test(row.reason)));
  assert.throws(() => bunnyRoute({ prompt: "Rewrite this", mode: "fast", providers: [ready("codex"), ready("claude")], constraints: { localOnly: true } }), /hard constraints/);
  assert.throws(() => bunnyRoute({ prompt: "Rewrite this", mode: "fast", providers, constraints: { localOnly: true }, override: "codex" }), /not eligible/);
});

test("MA1: local-only routing never inherits an Ollama cloud-hosted default; other routing is unchanged", () => {
  const cloudFirst = ready("ollama", { current_model: "deepseek-v4.1-flash:cloud", models: ["deepseek-v4.1-flash:cloud", "qwen2.5-coder:7b"], remoteModels: ["deepseek-v4.1-flash:cloud"] });
  const local = bunnyRoute({ prompt: "Summarize hello", mode: "fast", providers: [ready("codex"), cloudFirst], constraints: { localOnly: true } });
  assert.equal(local.recommended_provider, "ollama");
  assert.equal(local.recommended_model, "qwen2.5-coder:7b");
  assert.ok(local.reasons?.some((reason) => /not the cloud-hosted default deepseek-v4\.1-flash:cloud/.test(reason)));
  assert.equal(bunnyRoute({ prompt: "Summarize hello", mode: "fast", providers: [cloudFirst], constraints: { offlineOnly: true } }).recommended_model, "qwen2.5-coder:7b");
  // Without a locality constraint the legacy default is kept (the UI labels it as Ollama's cloud service).
  assert.equal(bunnyRoute({ prompt: "Summarize hello", mode: "fast", providers: [cloudFirst], override: "ollama" }).recommended_model, "deepseek-v4.1-flash:cloud");
  const onlyCloud = ready("ollama", { current_model: "deepseek-v4.1-flash:cloud", models: ["deepseek-v4.1-flash:cloud"], remoteModels: ["deepseek-v4.1-flash:cloud"] });
  assert.match(eligibility(onlyCloud, { localOnly: true })!, /cloud-hosted/);
  assert.throws(() => bunnyRoute({ prompt: "Summarize hello", mode: "fast", providers: [onlyCloud], constraints: { localOnly: true } }), /hard constraints/);
  // Name-only cloud tags (older Ollama without remote_host) are still never local.
  assert.match(eligibility(ready("ollama", { current_model: "x:cloud", models: ["x:cloud"] }), { localOnly: true })!, /cloud-hosted/);
});

test("MA1: a stale local-only task whose model is cloud-hosted is refused at launch", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bunny-ma1-local-"));
  const launched: string[] = [];
  const ollama: ProviderAdapter = { id: "ollama", detect: async () => ready("ollama", { current_model: "deepseek-v4.1-flash:cloud", models: ["deepseek-v4.1-flash:cloud", "qwen2.5-coder:7b"], remoteModels: ["deepseek-v4.1-flash:cloud"] }), launch: (task) => { launched.push(task.model); return { done: new Promise<AdapterResult>(() => {}), stop: async () => {} }; } };
  const db = new HostDatabase(join(dir, "host.sqlite"));
  try {
    // M-A-3 T3 legacy-parity: probe nothing, so the model registry stays fact-less and the MA1 route is pre-T3 bytes.
    const manager = new TaskManager(db, dir, [ollama], { modelRegistry: new ModelCapabilityRegistry(db, { availableProviders: () => [] }) });
    await manager.discover();
    const task = manager.submit({ prompt: "Summarize hello", mode: "fast", constraints: { localOnly: true } });
    assert.equal(task.model, "qwen2.5-coder:7b");
    // A record routed before this guard existed (or edited) still carries the cloud model.
    db.write({ ...db.get(task.id), model: "deepseek-v4.1-flash:cloud" }, "fixture.stale", "stale route");
    assert.throws(() => manager.approve(task.id), /not local inference/);
    assert.deepEqual(launched, []);
    assert.equal(db.get(task.id).state, "waiting_for_approval");
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("automatic routing for a file-and-run task: text-only Ollama is ineligible and the decision is structured", () => {
  const providers = [ready("codex"), ready("claude"), ready("ollama")];
  const decision = bunnyRoute({ prompt: 'Create hello.py containing print("BUNNY_ROUTE_OK"). Run the script and verify stdout.', mode: "balanced", providers });
  assert.deepEqual(decision.requirements, ["filesystem", "terminal"]);
  assert.ok(["codex", "claude"].includes(decision.recommended_provider));
  assert.deepEqual([...decision.eligible_providers!].sort(), ["claude", "codex"]);
  assert.match(decision.excluded!.find((row) => row.provider === "ollama")!.reason, /Filesystem/);
  const structured = structuredDecision(decision);
  for (const key of ["taskType", "complexity", "mode", "requirements", "eligibleProviders", "recommendedProvider", "confidenceScore", "reasons", "alternatives"]) assert.ok(key in structured, key);
  assert.equal(structured.confidenceKind, "uncalibrated_score");
  assert.ok(structured.reasons.some((reason) => /not a probability/.test(reason)));
  // Modes are weights: the same capability-bound task never routes to text-only Ollama in Fast mode.
  assert.notEqual(bunnyRoute({ prompt: 'Create hello.py and run it', mode: "fast", providers }).recommended_provider, "ollama");
});

test("requiresGit and a specific working directory are hard requirements", () => {
  const noGit = ready("claude", { capabilities: ["text", "filesystem", "terminal"] });
  const decision = bunnyRoute({ prompt: "Summarize the latest change", mode: "balanced", providers: [ready("codex"), noGit, ready("ollama")], constraints: { requiresGit: true } });
  assert.equal(decision.recommended_provider, "codex");
  assert.match(decision.excluded!.find((row) => row.provider === "claude")!.reason, /Git/);
  assert.match(eligibility(ready("ollama"), { requiresFilesystem: true, workingDirectory: "C:\\work" })!, /specific folder/);
});

test("usage: official windows place short inside and weekly outside; nothing exposed means Usage unavailable", () => {
  const windows = codexUsageWindows({ primary: { usedPercent: 2, windowDurationMins: 300, resetsAt: 1 }, secondary: { usedPercent: 22, windowDurationMins: 10080, resetsAt: 2 } });
  assert.deepEqual(windows.map((window) => window.kind), ["short", "weekly"]);
  assert.deepEqual(ringPlacement(windows), { inner: windows[0], outer: windows[1], label: null });
  // Order from the provider must not matter.
  assert.deepEqual(ringPlacement([windows[1], windows[0]]), { inner: windows[0], outer: windows[1], label: null });
  const single = ringPlacement([windows[1]]);
  assert.equal(single.inner, null); assert.equal(single.outer, windows[1]);
  assert.deepEqual(ringPlacement([]), { inner: null, outer: null, label: "Usage unavailable" });
  const claude = applyUsage({ ...providerBase("claude") }, null);
  assert.equal(claude.usage_note, "Usage unavailable");
  assert.deepEqual(claude.usageWindows, []);
});

test("event normalization: only evidence-backed activity, plans give determinate progress, duplicates collapse", () => {
  const codex = new CodexNormalizer();
  const run = (event: Record<string, unknown>) => codex.normalize(event).filter((item) => item.type);
  assert.equal(codex.normalize({ type: "thread.started", thread_id: "t-1" })[0].sessionId, "t-1");
  const started = run({ type: "item.started", item: { id: "c1", type: "command_execution", command: `"C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -Command 'npm test'`, status: "in_progress" } });
  assert.deepEqual(started.map((item) => [item.type, item.detail]), [["agent.testing", "npm test"]]);
  assert.deepEqual(run({ type: "item.completed", item: { id: "c1", type: "command_execution", command: "npm test", exit_code: 0, status: "completed" } }), []);
  assert.equal(run({ type: "item.completed", item: { id: "f1", type: "file_change", changes: [{ path: "src/app.ts", kind: "update" }] } })[0].type, "agent.editing");
  const planned = run({ type: "item.updated", item: { id: "p1", type: "todo_list", items: [{ text: "Write", completed: true }, { text: "Test", completed: false }, { text: "Ship", completed: false }] } })[0];
  assert.equal(planned.type, "agent.planning");
  assert.deepEqual(planned.progress, { kind: "determinate", completed: 1, total: 3, source: "Codex todo list", current: "Test" });
  assert.equal(run({ type: "item.completed", item: { id: "r1", type: "reasoning", text: "**Planning file creation**\n\nDetails" } })[0].detail, "Planning file creation");
  const done = run({ type: "turn.completed", usage: { input_tokens: 10, cached_input_tokens: 4, output_tokens: 3 } })[0];
  assert.equal(done.type, "agent.completed");
  assert.deepEqual(done.usage, { inputTokens: 10, outputTokens: 3, cachedInputTokens: 4, source: "codex turn.completed" });
  const message = codex.normalize({ type: "item.completed", item: { id: "m1", type: "agent_message", text: "Done." } });
  assert.deepEqual(message.map((item) => [item.type, item.output]), [["", "Done."]]);

  const claude = new ClaudeNormalizer();
  const init = claude.normalize({ type: "system", subtype: "init", session_id: "s-1", model: "claude-model" });
  assert.ok(init.some((item) => item.model === "claude-model") && init.some((item) => item.sessionId === "s-1"));
  assert.deepEqual(init.filter((item) => item.type), [], "the process spawn reports agent.started; init only names the model and session");
  const tools = claude.normalize({ type: "assistant", message: { content: [
    { type: "tool_use", name: "TodoWrite", input: { todos: [{ content: "Create file", status: "completed" }, { content: "Read back", status: "in_progress" }] } },
    { type: "tool_use", name: "Write", input: { file_path: "C:\\work\\a.txt", content: "secret contents are not echoed" } },
    { type: "tool_use", name: "Bash", input: { command: "npm run build" } },
    { type: "text", text: "Working on it" },
  ] } });
  assert.deepEqual(tools.filter((item) => item.type).map((item) => item.type), ["agent.planning", "agent.editing", "agent.building"]);
  assert.deepEqual(tools[0].progress, { kind: "determinate", completed: 1, total: 2, source: "Claude Code todo list", current: "Read back" });
  assert.equal(tools[1].detail, "C:\\work\\a.txt");
  assert.ok(!JSON.stringify(tools).includes("secret contents"));
  const denied = claude.normalize({ type: "result", subtype: "success", is_error: false, num_turns: 2, permission_denials: [{ tool_name: "PowerShell" }], usage: { input_tokens: 5, cache_creation_input_tokens: 1, cache_read_input_tokens: 7, output_tokens: 2 } });
  assert.deepEqual(denied.map((item) => item.type), ["agent.warning", "agent.completed"]);
  assert.ok(!denied.some((item) => item.type === "agent.waiting_for_approval"), "print mode denies immediately; nothing waits");
  // Exact shape Codex 0.153 emitted on this workstation: a POSIX-quoted PowerShell script with '"' splices.
  const real = `"C:\\\\WINDOWS\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe" -Command '$taskPath = Join-Path (Get-Location).Path '"'bunny_codex_test.txt'\n[System.IO.File]::WriteAllText("'$taskPath, '"'BUNNY_A_CODEX_OK', [System.Text.UTF8Encoding]::new("'$false))\n$taskContent = [System.IO.File]::ReadAllText($taskPath)'`;
  assert.equal(displayCommand(real), "$taskPath = Join-Path (Get-Location).Path 'bunny_codex_test.txt' (+2 more lines)");
  assert.deepEqual(new CodexNormalizer().normalize({ type: "item.started", item: { id: "x", type: "command_execution", command: `"C:\\\\powershell.exe" -Command 'cd app\nnpm test'` } }).map((item) => [item.type, item.detail]), [["agent.testing", "npm test (+1 more line)"]]);
  assert.equal(classifyCommand("python hello.py"), "agent.command");
  assert.equal(classifyCommand("node --experimental-strip-types --test a.test.ts"), "agent.testing");
  assert.equal(displayCommand(`bash -lc 'ls -la'`), "ls -la");
});

test("Claude Code usage comes from its own rate_limit_event, captured verbatim from a real session", () => {
  // Exact event Claude Code 2.1.287 emitted during the M2 validation run on this workstation.
  const event = { type: "rate_limit_event", rate_limit_info: { status: "allowed", resetsAt: 1790929200, rateLimitType: "five_hour", overageStatus: "rejected", overageDisabledReason: "org_level_disabled", isUsingOverage: false, unifiedWindows: { five_hour: { utilization: 0.62, resetsAt: 1790929200 }, seven_day: { utilization: 0.33, resetsAt: 1791291600 } } }, uuid: "d7b41315-4396-4b3e-9ff7-82f6b9c97dae", session_id: "1eeccc86-3d3b-4474-9d94-af331f2c30d0" };
  const reported = new ClaudeNormalizer().normalize(event).find((item) => item.rateLimits);
  assert.deepEqual(reported?.rateLimits, [
    { label: "5 hour window", usedPercent: 62, resetsAt: 1790929200000, kind: "short", windowMinutes: 300 },
    { label: "Weekly", usedPercent: 33, resetsAt: 1791291600000, kind: "weekly", windowMinutes: 10080 },
  ]);
  assert.equal(reported?.limitStatus, "allowed");
  const placed = ringPlacement(reported!.rateLimits);
  assert.equal(placed.inner?.usedPercent, 62); assert.equal(placed.outer?.usedPercent, 33);
  // A message without unifiedWindows carries no usage at all; nothing is guessed.
  assert.equal(new ClaudeNormalizer().normalize({ type: "rate_limit_event", rate_limit_info: { status: "allowed", rateLimitType: "five_hour" } }).some((item) => item.rateLimits), false);
});

test("session-reported usage survives re-probes with its report time; a provider refusal blocks routing until reset", async () => {
  const db = new HostDatabase(":memory:");
  const adapter: ProviderAdapter = { id: "claude", detect: async () => ready("claude"), launch: () => { throw new Error("unused"); } };
  const registry = new ProviderRegistry([adapter], db);
  await registry.refresh({ force: true });
  const windows = [{ label: "5 hour window", usedPercent: 62, resetsAt: Date.now() + 3_600_000, kind: "short" as const, windowMinutes: 300 }];
  registry.recordSessionUsage("claude", windows, "allowed");
  const observedAt = registry.get("claude")!.usageObservedAt;
  await registry.refresh({ force: true });
  assert.deepEqual(registry.get("claude")!.usageWindows, windows);
  assert.equal(registry.get("claude")!.usageObservedAt, observedAt, "a re-probe does not refresh the report time");
  registry.recordSessionUsage("claude", windows, "rejected");
  assert.equal(registry.get("claude")!.availability, "rate_limited");
  await registry.refresh({ force: true });
  assert.equal(registry.get("claude")!.availability, "rate_limited", "the refusal holds until the reported reset");
  assert.ok(eligibility(registry.get("claude")!, {}));
  db.close();
});

test("registry publishes provider.status_changed only on material change and persists state", async () => {
  const db = new HostDatabase(":memory:");
  let state: ProviderLive = ready("claude");
  const adapter: ProviderAdapter = { id: "claude", detect: async () => ({ ...state, probedAt: Date.now(), usageWindows: [{ label: "x", usedPercent: Math.random() * 100, resetsAt: null }] }), launch: () => { throw new Error("unused"); } };
  const registry = new ProviderRegistry([adapter], db);
  assert.equal((await registry.refresh({ force: true })).length, 1, "first discovery is a change");
  assert.deepEqual(await registry.refresh({ force: true }), [], "usage and timestamps alone are not material");
  state = { ...state, availability: "authentication_required", authenticatedState: "not_authenticated", authenticated: false };
  const changes = await registry.refresh({ force: true });
  assert.equal(changes.length, 1);
  assert.match(changes[0], /ready → authentication required/);
  const reopened = new ProviderRegistry([adapter], db);
  assert.equal(reopened.get("claude")?.availability, "authentication_required", "last known state survives a restart");
  assert.equal(reopened.probedThisRun("claude"), false, "but it is not trusted until re-probed");
  db.close();
});

test("periodic refresh does not re-run full probes before their interval", async () => {
  const db = new HostDatabase(":memory:");
  let detects = 0;
  const adapter: ProviderAdapter = { id: "codex", detect: async () => { detects++; return ready("codex"); }, health: async (previous) => previous, launch: () => { throw new Error("unused"); } };
  const registry = new ProviderRegistry([adapter], db, { fullMs: 60_000, detectOnlyFullMs: 60_000, usageMs: 60_000 });
  await registry.refresh({ now: 0 }); await registry.refresh({ now: 30_000 }); await registry.refresh({ now: 59_000 });
  assert.equal(detects, 1);
  await registry.refresh({ now: 61_000 });
  assert.equal(detects, 2);
  db.close();
});

function scriptedAdapter(id: ProviderId = "claude") {
  const launched: { task: OrchTask; hooks: AdapterHooks; finish: (result: AdapterResult) => void; stopped: boolean }[] = [];
  const adapter: ProviderAdapter = {
    id, detect: async () => ready(id),
    launch: (task, hooks) => {
      let finish!: (result: AdapterResult) => void; const done = new Promise<AdapterResult>((resolve) => { finish = resolve; });
      const row = { task, hooks, finish, stopped: false }; launched.push(row);
      return { done, stop: async () => { row.stopped = true; finish({ ok: false, output: "", stopped: true }); }, pid: () => null };
    },
  };
  return { adapter, launched };
}
const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

test("Host-owned sessions: state, latest activity and progress survive any client; stop affects only its task", async () => {
  const db = new HostDatabase(":memory:"); const fake = scriptedAdapter();
  const host = new TaskManager(db, process.cwd(), [fake.adapter], { processTable: async () => [] }); await host.discover();
  const a = host.submit({ prompt: "First", mode: "balanced" }), b = host.submit({ prompt: "Second", mode: "balanced" });
  host.approve(a.id); host.approve(b.id);
  const hooks = fake.launched[0].hooks;
  hooks.session("provider-session-1", 4242);
  hooks.progress?.({ kind: "determinate", completed: 1, total: 4, source: "test plan", current: "Step 2" });
  hooks.event("agent.planning", "1 / 4 steps complete");
  hooks.event("agent.testing", "npm test");
  // A brand-new client (Island reopened, dashboard refreshed, phone) reads the same session from the Host.
  const view = host.getSession(a.id);
  assert.equal(view.owned, true); assert.equal(view.providerSessionId, "provider-session-1"); assert.equal(view.pid, 4242);
  assert.equal(view.latestEvent?.type, "agent.testing"); assert.equal(view.latestEvent?.label, "Running tests"); assert.equal(view.latestEvent?.detail, "npm test");
  assert.deepEqual(view.progress, { kind: "determinate", completed: 1, total: 4, source: "test plan", current: "Step 2" });
  const stopped = await host.stop(a.id);
  assert.equal(stopped.state, "stopped"); assert.equal(fake.launched[0].stopped, true); assert.equal(fake.launched[1].stopped, false);
  assert.equal(db.get(b.id).state, "running");
  fake.launched[1].finish({ ok: true, output: "ok", exitCode: 0 }); await tick();
  assert.equal(db.get(b.id).state, "completed");
  const streamed: HostEvent[] = []; for await (const event of host.streamEvents(a.id)) streamed.push(event);
  assert.ok(streamed.some((event) => event.type === "agent.testing") && streamed.at(-1)!.type === "task.stopped");
  assert.equal(db.get(a.id).stopReason, "User stopped the selected task.");
  db.close();
});

test("real task lifecycle: running → Bunny-A verifying → completed only when Bunny-A's own disk read matches", async () => {
  const folder = mkdtempSync(join(tmpdir(), "bunny-m2-verify-"));
  const db = new HostDatabase(":memory:"); const fake = scriptedAdapter();
  const host = new TaskManager(db, process.cwd(), [fake.adapter]); await host.discover();
  try {
    const project = host.registerProject("Disposable", folder);
    const good = host.submit({ prompt: "Create bunny_test.txt", mode: "balanced", projectId: project.id, verify: { kind: "file", name: "bunny_test.txt", expected: "BUNNY_OK" } });
    host.approve(good.id);
    writeFileSync(join(folder, "bunny_test.txt"), "BUNNY_OK");
    fake.launched[0].hooks.usage?.({ inputTokens: 12, outputTokens: 3, cachedInputTokens: 0, source: "test" });
    fake.launched[0].finish({ ok: true, output: "done", exitCode: 0 }); await tick(50);
    const passed = db.get(good.id);
    assert.equal(passed.state, "completed"); assert.equal(passed.verification?.passed, true);
    assert.ok(db.taskEvents(good.id).some((event) => event.type === "agent.verifying"));
    assert.equal(passed.latestEvent?.actor, "bunny");
    const bad = host.submit({ prompt: "Create other.txt", mode: "balanced", projectId: project.id, verify: { kind: "file", name: "other.txt", expected: "EXACT" } });
    host.approve(bad.id);
    writeFileSync(join(folder, "other.txt"), "EXACT\n");
    fake.launched[1].finish({ ok: true, output: "done", exitCode: 0 }); await tick(50);
    const failed = db.get(bad.id);
    assert.equal(failed.state, "failed"); assert.match(failed.error!, /Bunny-A verification failed/);
    // MA4-S1R2 H2: both independently verified outcomes (one pass, one fail) are runtime reliability evidence.
    assert.equal(passed.model, failed.model);
    assert.deepEqual(host.ma4.reliability(passed.provider, passed.model, "tool-call"), { passes: 1, samples: 2 });
    const evidence = db.db.prepare("SELECT state,verification,input_tokens AS inputTokens,manual,mode FROM outcomes WHERE task_id=?").get(good.id) as Record<string, unknown>;
    assert.deepEqual({ ...evidence }, { state: "completed", verification: "passed", inputTokens: 12, manual: 0, mode: "balanced" });
    assert.equal(host.live().find((provider) => provider.id === "claude")!.observed!.tasks, 2);
    const profile = db.performance().find((row) => row.provider === "claude")!;
    assert.equal(profile.sufficient, false, "two outcomes are below the minimum sample size");
    assert.equal(db.learned("claude", profile.taskType), 0);
  } finally { db.close(); rmSync(folder, { recursive: true, force: true }); }
});

test("a required working directory must be an approved project folder", async () => {
  const folder = mkdtempSync(join(tmpdir(), "bunny-m2-wd-"));
  const db = new HostDatabase(":memory:"); const fake = scriptedAdapter();
  const host = new TaskManager(db, process.cwd(), [fake.adapter]); await host.discover();
  try {
    assert.throws(() => host.submit({ prompt: "Edit a file", mode: "balanced", constraints: { workingDirectory: folder } }), /not an approved project/);
    const project = host.registerProject("Approved", folder);
    const task = host.submit({ prompt: "Edit a file", mode: "balanced", constraints: { workingDirectory: folder } });
    assert.equal(task.projectId, project.id); assert.equal(task.cwd, project.path);
  } finally { db.close(); rmSync(folder, { recursive: true, force: true }); }
});

test("MA4-S1R3-CI2: the 8.3 short spelling of an approved project folder is that folder", { skip: process.platform !== "win32" && "Windows 8.3 names only" }, async (t) => {
  const folder = mkdtempSync(join(tmpdir(), "bunny-ci2-long-project-name-"));
  const db = new HostDatabase(":memory:"); const fake = scriptedAdapter();
  try {
    const short = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "(New-Object -ComObject Scripting.FileSystemObject).GetFolder($env:BUNNY_FOLDER).ShortPath"], { env: { ...process.env, BUNNY_FOLDER: folder }, encoding: "utf8", windowsHide: true }).trim();
    if (!short || short.toLowerCase() === realpathSync.native(folder).toLowerCase()) return t.skip("8.3 names are disabled on this volume");
    assert.equal(canonical(short), canonical(folder), "both spellings canonicalize to the long form");
    const host = new TaskManager(db, process.cwd(), [fake.adapter]); await host.discover();
    const project = host.registerProject("Approved", folder);
    const task = host.submit({ prompt: "Edit a file", mode: "balanced", constraints: { workingDirectory: short } });
    assert.equal(task.projectId, project.id); assert.equal(task.cwd, project.path);
  } finally { db.close(); rmSync(folder, { recursive: true, force: true }); }
});

test("MA4-S1R3-CI2: the local-only routing priority holds on a Host with no model facts (legacy fallback)", async () => {
  const boot = async (ids: ProviderId[]) => {
    const db = new HostDatabase(":memory:");
    const host = new TaskManager(db, process.cwd(), ids.map((id) => scriptedAdapter(id).adapter), { modelRegistry: new ModelCapabilityRegistry(db, { availableProviders: () => [] }) });
    await host.discover(); host.setRoutingPriority("local_only");
    return { db, host };
  };
  const both = await boot(["claude", "ollama"]);
  try {
    const task = both.host.submit({ prompt: "Summarize the tradeoffs of two approaches", mode: "balanced" });
    assert.equal(task.provider, "ollama", "a ready cloud provider is never chosen under local-only");
    assert.equal(task.constraints?.localOnly, true, "the Task records the constraint it was admitted under");
  } finally { both.db.close(); }
  const cloud = await boot(["claude"]);
  try {
    assert.throws(() => cloud.host.submit({ prompt: "Summarize the tradeoffs of two approaches", mode: "balanced" }), "no local provider: refused, not sent to the cloud");
    assert.equal(cloud.host.db.tasks().length, 0);
  } finally { cloud.db.close(); }
});

test("process tree: descendants follow parent links and reject reused PIDs; survivors need the same start time", () => {
  const rows = [
    { pid: 10, ppid: 1, name: "codex.exe", createdAt: 1000 },
    { pid: 11, ppid: 10, name: "powershell.exe", createdAt: 1100 },
    { pid: 12, ppid: 11, name: "python.exe", createdAt: 1200 },
    { pid: 13, ppid: 10, name: "stale.exe", createdAt: 500 },
    { pid: 99, ppid: 1, name: "unrelated.exe", createdAt: 1300 },
  ];
  assert.deepEqual(descendants(rows, 10).map((row) => row.pid), [10, 11, 12]);
  assert.deepEqual(survivors(descendants(rows, 10), [{ pid: 12, ppid: 11, name: "python.exe", createdAt: 1200 }, { pid: 11, ppid: 4, name: "reused.exe", createdAt: 9999 }]).map((row) => row.pid), [12]);
});

test("persisted provider state is shown after a Host restart but nothing routes until re-probed", async () => {
  const db = new HostDatabase(":memory:"); const fake = scriptedAdapter();
  const first = new TaskManager(db, process.cwd(), [fake.adapter]); await first.discover();
  const second = new TaskManager(db, process.cwd(), [fake.adapter]);
  assert.equal(second.live()[0].availability, "unknown");
  assert.throws(() => second.submit({ prompt: "Work", mode: "fast" }), /hard constraints/);
  await second.refreshProviders();
  assert.equal(second.live()[0].availability, "ready");
  db.close();
});

test("Ollama stays a routable local executor with no quota claims", async () => {
  const live = await new OllamaAdapter(() => ({ ...systemContext(), env: {}, home: tmpdir() })).detect();
  assert.equal(live.authenticatedState, "not_required");
  assert.equal(live.usageWindows?.length ?? 0, 0);
  assert.equal(live.features?.usageQuota.supported, false);
  if (live.availability === "ready") assert.ok(live.models!.length > 0);
  else assert.ok(["offline", "not_installed", "unavailable"].includes(live.availability));
});

test("the session transcript is private evidence on disk", async () => {
  const folder = mkdtempSync(join(tmpdir(), "bunny-m2-transcript-"));
  const db = new HostDatabase(":memory:"); const fake = scriptedAdapter();
  const host = new TaskManager(db, process.cwd(), [fake.adapter], { sessionDirectory: folder }); await host.discover();
  try {
    const task = host.submit({ prompt: "Work", mode: "balanced" }); host.approve(task.id);
    fake.launched[0].hooks.raw?.("stdout", '{"type":"turn.started"}');
    fake.launched[0].finish({ ok: true, output: "", exitCode: 0 }); await tick();
    const lines = readFileSync(join(folder, `${task.id}.jsonl`), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(lines[0].stream, "stdout"); assert.equal(lines[0].text, '{"type":"turn.started"}');
    assert.equal(host.getSession(task.id).transcript, join(folder, `${task.id}.jsonl`));
  } finally { db.close(); rmSync(folder, { recursive: true, force: true }); }
});
