import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexAdapter, ClaudeAdapter, codexLaunchArgs, providerBase } from "./adapters.server.ts";
import { systemContext } from "./discovery.server.ts";
import { HostDatabase } from "./persistence.server.ts";
import { TaskManager } from "./manager.server.ts";
import { MissionManager } from "../bunny-missions/manager.server.ts";
import type { AdapterHooks, ProviderAdapter } from "./contracts.ts";
import type { OrchTask, ProviderExecutionScope } from "../orch/types.ts";

function assertReadIsolation(args: string[], platform = process.platform) {
  assert.equal(args[args.indexOf("--sandbox") + 1], "read-only");
  assert.ok(args.includes("--ignore-user-config"), "all user-configured MCP/plugin/integration definitions are omitted");
  assert.ok(args.includes("--ignore-rules"), "user/project execpolicy cannot expand execution authority");
  const overrides = args.flatMap((arg, index) => arg === "-c" || arg === "--config" ? [args[index + 1]] : []);
  assert.deepEqual(overrides, [...(platform === "win32" ? ['windows.sandbox="elevated"'] : []), 'web_search="disabled"'], "only trusted platform sandbox configuration is restored; web search is off");
  // Literal list, independent of the production constant: features whose tools ignore config.toml (M-A-1 live evidence).
  const disabled = args.flatMap((arg, index) => arg === "--disable" ? [args[index + 1]] : []);
  assert.deepEqual(disabled, ["apps", "plugins", "remote_plugin", "multi_agent", "multi_agent_v2", "image_generation", "browser_use", "browser_use_external", "computer_use", "tool_suggest", "hooks", "skill_mcp_dependency_install"], "account apps, plugins and tool-adding defaults are switched off");
  assert.ok(!args.includes("--profile") && !args.includes("-p") && !args.includes("--enable"), "no user profile or extension is re-enabled");
  assert.ok(!args.includes("--approve-for-me") && !args.includes("--dangerously-bypass-approvals-and-sandbox"));
}

function assertLegacyCodexArgs(args: string[], task: OrchTask) {
  // Exact pre-R1 argv, independent of the production helper.
  assert.deepEqual(args, ["exec", "--json", "--sandbox", "workspace-write", "--skip-git-repo-check", "--cd", task.cwd, "--model", task.model, "-"]);
}

/** Real adapters and owned process launch, with an argv-echo executable rather than a model CLI. */
for (const provider of ["codex", "claude"] as const) for (const access of [undefined, "read", "write"] as const) test(`MA0R: actual ${provider} adapter spawn carries ${access ?? "legacy"} authority`, async () => {
  const directory = mkdtempSync(join(tmpdir(), "bunny-authority-"));
  const script = join(directory, "argv.mjs");
  writeFileSync(script, "process.stdin.resume(); process.stdin.on('end',()=>console.log(JSON.stringify({argv:process.argv.slice(2)})));\n");
  const adapter = provider === "codex" ? new CodexAdapter(() => systemContext()) : new ClaudeAdapter(() => systemContext());
  adapter.launchTarget = { command: process.execPath, args: [script], path: script, kind: "node-script", source: "disposable fixture" };
  adapter.detected = { ...providerBase(provider), installed: true, authenticated: true, availability: "ready" };
  const lines: string[] = [];
  const hooks: AdapterHooks = { event: () => {}, session: () => {}, output: () => {}, raw: (stream, line) => { if (stream === "stdout") lines.push(line); } };
  const task = { id: "fixture", provider, model: "fixture-model", prompt: "Echo arguments only", cwd: directory, ...(access ? { executionScope: { access } as ProviderExecutionScope, mission: { missionId: "fixture-mission", stepId: "fixture-step" } } : {}) } as OrchTask;
  try {
    const result = await adapter.launch(task, hooks).done;
    assert.equal(result.ok, true);
    const args = (JSON.parse(lines.find((line) => line.includes('"argv"'))!) as { argv: string[] }).argv;
    if (provider === "codex") {
      if (access === "read") assertReadIsolation(args);
      else assertLegacyCodexArgs(args, task);
    }
    else {
      assert.equal(args[args.indexOf("--permission-mode") + 1], access === "read" ? "dontAsk" : "acceptEdits");
      if (access === "read") {
        assert.equal(args[args.indexOf("--tools") + 1], "Read");
        assert.equal(args[args.indexOf("--allowedTools") + 1], "Read");
        assert.equal(args[args.indexOf("--disallowedTools") + 1], "Write,Edit,Bash,PowerShell");
      } else assert.match(args[args.indexOf("--allowedTools") + 1], /Read,Write,Edit,Bash/);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

for (const platform of ["win32", "linux", "darwin"] as const) test(`MA0R2: Codex read isolation restores only the ${platform} sandbox policy`, () => {
  const read = { cwd: "/fixture", model: "fixture-model", executionScope: { access: "read" } } as OrchTask;
  assertReadIsolation(codexLaunchArgs(read, platform), platform);
  for (const access of [undefined, "write"] as const) {
    const task = { ...read, executionScope: access ? { access } : undefined } as OrchTask;
    assertLegacyCodexArgs(codexLaunchArgs(task, platform), task);
  }
});

test("MA1: Codex read argv is the exact contract verified against live codex-cli 0.153.4 sessions", () => {
  // A live read Mission with only the R1 flags registered 228 ChatGPT connector tools (codex_apps) and a
  // remote-plugin MCP server; this exact argv registered none (test-results/ma1/codex-read).
  const read = { cwd: "C:\\fixture", model: "fixture-model", executionScope: { access: "read" } } as OrchTask;
  assert.deepEqual(codexLaunchArgs(read, "win32"), [
    "exec", "--json", "--sandbox", "read-only", "--ignore-user-config", "--ignore-rules", "-c", 'windows.sandbox="elevated"',
    "--disable", "apps", "--disable", "plugins", "--disable", "remote_plugin", "--disable", "multi_agent", "--disable", "multi_agent_v2",
    "--disable", "image_generation", "--disable", "browser_use", "--disable", "browser_use_external", "--disable", "computer_use",
    "--disable", "tool_suggest", "--disable", "hooks", "--disable", "skill_mcp_dependency_install", "-c", 'web_search="disabled"',
    "--skip-git-repo-check", "--cd", "C:\\fixture", "--model", "fixture-model", "-",
  ]);
  const write = { ...read, executionScope: { access: "write" } } as OrchTask;
  assert.ok(!codexLaunchArgs(write, "win32").includes("--disable"), "write sessions keep their exact pre-R1 argv");
});

const until = async (check: () => boolean, label: string, detail?: () => unknown) => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > 8000) throw new Error(`Timed out waiting for ${label}${detail ? `: ${JSON.stringify(detail())}` : ""}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};
const readStep = (role: string, maxRetries = 0) => ({ role, objective: "Inspect local source", access: "read", maxRetries, executor: { kind: "model" } });

/** Real MissionManager → TaskManager → CodexAdapter → spawnSession; only CLI IO is a disposable Node stand-in. */
async function missionFixture(failures = 0, withClaude = false) {
  const directory = mkdtempSync(join(tmpdir(), "bunny-r1-launch-"));
  const root = join(directory, "project"); mkdirSync(root);
  const script = join(directory, "argv.mjs");
  const counter = join(directory, "attempt.txt");
  writeFileSync(script, `import {existsSync,readFileSync,writeFileSync} from 'node:fs';
process.stdin.resume(); process.stdin.on('end',()=>{
  const counter=${JSON.stringify(counter)};
  const attempt=existsSync(counter)?Number(readFileSync(counter,'utf8'))+1:1;
  writeFileSync(counter,String(attempt));
  console.log(JSON.stringify({argv:process.argv.slice(2)}));
  if(attempt<=${failures}) {console.error('fixture provider crashed');process.exitCode=1;}
});\n`);
  const db = new HostDatabase(join(directory, "host.sqlite"));
  const codex = new CodexAdapter(() => systemContext());
  const live = { ...providerBase("codex"), installed: true, authenticated: true, availability: "ready" as const, capabilities: ["text", "filesystem", "terminal"], models: ["fixture-model"], current_model: "fixture-model" };
  codex.detected = live;
  codex.launchTarget = { command: process.execPath, args: [script], path: script, kind: "node-script", source: "disposable fixture" };
  codex.detect = async () => live;
  codex.health = async () => live;
  codex.usage = async () => null; // Never probe the installed CLI, account or any model service.
  const launches: { task: OrchTask; args: string[] }[] = [];
  const actualLaunch = codex.launch.bind(codex);
  codex.launch = (task, hooks) => actualLaunch(task, { ...hooks, raw: (stream, line) => {
    hooks.raw?.(stream, line);
    if (stream === "stdout") launches.push({ task, args: (JSON.parse(line) as { argv: string[] }).argv });
  } });
  let claudeAvailable = true;
  const claude: ProviderAdapter = { id: "claude", detect: async () => ({ ...live, id: "claude", name: "Claude fixture", availability: claudeAvailable ? "ready" : "offline" }), launch: () => { throw new Error("Claude stand-in must be retargeted before launch"); } };
  const tasks = new TaskManager(db, root, withClaude ? [codex, claude] : [codex]);
  await tasks.discover();
  const missions = new MissionManager(tasks, { dataDirectory: directory, adapters: [] });
  missions.configure({ enabled: true }, "test");
  const cleanup = async () => { await missions.close(); db.close(); rmSync(directory, { recursive: true, force: true }); };
  return { db, tasks, missions, launches, cleanup, disableClaude: async () => { claudeAvailable = false; await tasks.discover(); } };
}

for (const role of ["Research", "CustomAgent"]) test(`MA0R2: ${role} read scope reaches the actual isolated Codex spawn`, async () => {
  const env = await missionFixture();
  try {
    const mission = env.missions.create({ objective: "Read local source", mode: "fast", origin: "workstation", steps: [readStep(role)] });
    env.missions.approve(mission.id, "workstation");
    await until(() => env.missions.mission(mission.id).state === "completed", "read completion", () => ({ state: env.missions.mission(mission.id).state, events: env.missions.get(mission.id).events.slice(-6) }));
    assert.equal(env.launches.length, 1);
    const { task, args } = env.launches[0];
    assertReadIsolation(args);
    assert.deepEqual(task.executionScope, { access: "read" });
    assert.equal(task.mission?.stepId, mission.steps[0].id);
    assert.throws(() => { task.executionScope!.access = "write"; }, TypeError);
    assert.throws(() => env.tasks.update(env.db.get(task.id), { executionScope: undefined }, "agent.output", "drop authority"), /immutable/);
  } finally { await env.cleanup(); }
});

test("MA0R2: Claude → Codex retarget, automatic retry and explicit retry spawn isolated read sessions", async () => {
  const env = await missionFixture(2, true);
  try {
    const mission = env.missions.create({ objective: "Read local source", mode: "balanced", origin: "workstation", steps: [readStep("Research", 1)] });
    const approved = env.missions.approve(mission.id, "workstation", false);
    const envelope = env.missions.store.authorization(approved.authorizationId!)!;
    env.missions.store.saveAuthorization({ ...envelope, expiresAt: Date.now() - 1 });
    env.missions.start(env.missions.mission(mission.id));
    await until(() => env.missions.store.requests(mission.id).length === 1, "pending child");
    const pending = env.db.get(env.missions.store.steps(mission.id)[0].taskId!);
    env.tasks.retarget(pending.id, "claude");
    assert.equal(env.db.get(pending.id).provider, "claude");
    env.tasks.retarget(pending.id, "codex");
    assert.deepEqual(env.db.get(pending.id).executionScope, { access: "read" });
    await env.disableClaude(); // Subsequent retry routing has one available executor: Codex.
    env.missions.store.saveAuthorization(envelope);
    await env.missions.respond(env.missions.store.requests(mission.id)[0].id, "allow_once", "workstation");
    await until(() => env.missions.mission(mission.id).state === "failed", "both attempts failed");
    assert.equal(env.launches.length, 2);
    env.missions.retry(mission.id, "workstation");
    await until(() => env.missions.mission(mission.id).state === "completed", "explicit retry completion");
    assert.equal(env.launches.length, 3);
    assert.equal(new Set(env.launches.map(({ task }) => task.id)).size, 3, "each retry constructs a fresh child");
    for (const { task, args } of env.launches) { assert.equal(task.provider, "codex"); assertReadIsolation(args); }
  } finally { await env.cleanup(); }
});

test("MA0R2: read replan revokes old approval and new approval spawns the same Codex isolation", async () => {
  const env = await missionFixture(1);
  try {
    const mission = env.missions.create({ objective: "Inspect", mode: "fast", origin: "workstation", steps: [readStep("Research")] });
    const approved = env.missions.approve(mission.id, "workstation");
    await until(() => env.missions.mission(mission.id).state === "failed", "initial failure");
    const replanned = await env.missions.replan(mission.id, "workstation", [readStep("CustomAgent")]);
    assert.equal(replanned.authorizationId, null);
    assert.equal(replanned.state, "waiting_for_approval");
    assert.ok(env.missions.store.authorization(approved.authorizationId!)?.revokedAt);
    await env.missions.tick(mission.id);
    assert.equal(env.launches.length, 1, "replan cannot reuse the old approval");
    env.missions.approve(mission.id, "workstation");
    await until(() => env.missions.mission(mission.id).state === "completed", "replanned read completion");
    assert.equal(env.launches.length, 2);
    assert.notEqual(env.launches[0].task.mission?.stepId, env.launches[1].task.mission?.stepId);
    for (const { args } of env.launches) assertReadIsolation(args);
  } finally { await env.cleanup(); }
});

test("MA0R2: missing legacy child or envelope authority fails before the Codex spawn", async () => {
  const env = await missionFixture();
  try {
    const mission = env.missions.create({ objective: "Inspect", mode: "fast", origin: "workstation", steps: [readStep("Research")] });
    const approved = env.missions.approve(mission.id, "workstation", false);
    const child = env.tasks.submit({ prompt: "Read local source", mode: "fast", override: "codex" }, { missionId: mission.id, stepId: mission.steps[0].id, executionScope: { access: "read" } });
    const legacy = { ...child }; delete legacy.executionScope;
    env.db.write(legacy, "fixture.legacy", "old persisted child");
    assert.throws(() => env.tasks.approve(child.id), /Legacy mission child/);
    env.db.write(child, "fixture.restore", "restore child scope");
    const envelope = env.missions.store.authorization(approved.authorizationId!)!;
    delete envelope.providers.sessions;
    env.missions.store.saveAuthorization(envelope);
    assert.throws(() => env.tasks.approve(child.id), /authority is missing/);
    assert.equal(env.launches.length, 0);
    assert.equal(env.db.get(child.id).state, "waiting_for_approval");
  } finally { await env.cleanup(); }
});
