import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClineAdapter, clineLaunchArgs, clineRunResult } from "./adapters.server.ts";
import { ClineNormalizer } from "./events.ts";
import { systemContext } from "./discovery.server.ts";
import type { AdapterHooks, AdapterResult } from "./contracts.ts";
import type { OrchTask, ProviderLive } from "../orch/types.ts";

// The transcripts below are the REAL cline 3.0.74 --json line shapes, captured live on 2026-11-03.
const LINE_START = `{"ts":"2026-11-03T04:21:54.731Z","type":"hook_event","hookEventName":"agent_start","agentId":"agent_8173f620-6316-458a-ad3f-d60a8817ced5","taskId":"conv_1793679714724_75h73mp","parentAgentId":null}`;
const LINE_ITERATION = `{"ts":"2026-11-03T04:21:54.732Z","type":"agent_event","event":{"type":"iteration_start","iteration":1}}`;
const LINE_ERROR = (message: string) => `{"ts":"2026-11-03T04:21:56.284Z","type":"error","message":${JSON.stringify(message)}}`;
const SUBSCRIPTION = "No access to ClinePass subscription models yet. Subscribe to ClinePass: https://app.cline.example/dashboard/subscription";
const RUN_ERROR = (message: string) => `{"ts":"2026-11-03T04:21:55.903Z","type":"agent_event","event":{"type":"error","error":{"name":"Error","message":${JSON.stringify(message)}},"errorClass":"unknown","recoverable":false,"iteration":1}}`;
const RUN_COMPLETED = `{"ts":"2026-11-03T05:00:00.000Z","type":"run_result","finishReason":"completed","iterations":1,"usage":{"inputTokens":12,"outputTokens":34,"cacheReadTokens":7,"cacheWriteTokens":0,"totalCost":0},"durationMs":1500,"text":"ready","model":{"id":"cline-pass/qwen3.8-max","provider":"cline-pass","info":{"name":"Qwen 3.8 Max","id":"cline-pass/qwen3.8-max","contextWindow":262144,"maxInputTokens":262144,"maxTokens":128000,"capabilities":["images","tools","reasoning","temperature","prompt-cache"]}}}`;
const RUN_ERROR_RESULT = (message: string) => `{"ts":"2026-11-03T04:21:56.284Z","type":"run_result","finishReason":"error","iterations":1,"usage":{"inputTokens":0,"outputTokens":0,"cacheReadTokens":0,"cacheWriteTokens":0,"totalCost":0},"durationMs":1177,"text":${JSON.stringify(message)},"model":{"id":"cline-pass/qwen3.8-max","provider":"cline-pass"}}`;

/** npm's real cmd-shim text (the m2.test fixture pattern): "%dp0%\node.exe" + the target, which parseNpmShim reads. */
const SHIM = (relative: string) => `@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n\r\nIF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n) ELSE (\r\n  SET "_prog=node"\r\n  SET PATHEXT=%PATHEXT:;.JS;=;%\r\n)\r\n\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\${relative}" %*\r\n`;

/** A fake cline in npm's real layout. Any RUN records a marker, so a "discovery never executes cline" test can prove it. */
function clineFixture(transcript: string, exit = 0) {
  const dir = mkdtempSync(join(tmpdir(), "bunny-cline-"));
  const packDir = join(dir, "node_modules", "cline");
  const binDir = join(packDir, "bin"); mkdirSync(binDir, { recursive: true });
  const script = join(binDir, "cline-fixture.mjs");
  const marker = join(dir, "runs.txt");
  const shim = (join(dir, "cline.cmd"));
  writeFileSync(script, `import {appendFileSync} from 'node:fs';
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log("version probes never run; the manifest carries the version"); process.exit(1); }
appendFileSync(${JSON.stringify(marker)}, "run:" + args.join(" ") + "\\n");
process.stdout.write(${JSON.stringify(transcript)} + "\\n");
process.stderr.write(${JSON.stringify(LINE_ERROR("error from stderr"))} + "\\n");
process.exitCode = ${exit};
`);
  writeFileSync(shim, SHIM("node_modules\\cline\\bin\\cline-fixture.mjs"));
  // Discovery reads the npm manifest for the version and never runs the CLI (cline self-updates on launch).
  writeFileSync(join(packDir, "package.json"), JSON.stringify({ name: "cline", version: "3.0.74" }) + "\n");
  const adapter = new ClineAdapter(() => systemContext({ cline: shim }));
  const events: { type: string; detail: string }[] = [];
  const output: string[] = [];
  let usage: unknown = null;
  let model: unknown = null;
  const hooks: AdapterHooks = {
    ...( {
      usage: (value) => { usage = value; },
      model: (value) => { model = value; },
    } as AdapterHooks ),
    event: (type, detail) => events.push({ type, detail }),
    output: (text) => output.push(text),
    session: () => {},
  };
  const task = { id: "cline-fixture", provider: "cline", model: null, prompt: "Say ready", cwd: dir } as unknown as OrchTask;
  return { dir, adapter, hooks, events, output, get usage() { return usage; }, get model() { return model; }, marker, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("cline detect: discovery never executes cline and never spends — the verdict waits for an explicit run", async () => {
  const env = clineFixture([LINE_START, LINE_ITERATION, RUN_COMPLETED].join("\n") + "\n");
  try {
    const live = await env.adapter.detect();
    assert.equal(live.installed, true);
    assert.equal(live.version, "3.0.74");
    assert.equal(existsSync(env.marker), false, "detection must never run the CLI: cline self-updates, and an unattended spend is refused by design");
    assert.equal(live.authenticated, false);
    assert.equal(live.authenticatedState, "not_authenticated");
    assert.equal(live.availability, "authentication_required");
    assert.match(live.detail, /validated only during an explicit user-initiated run/);
    assert.equal(live.features?.launch.supported, true);
  } finally { env.cleanup(); }
});

test("cline launch: with an owner-verified detected state, act-mode argv runs and the transcript's receipt lands", async () => {
  const env = clineFixture([LINE_START, LINE_ITERATION, RUN_COMPLETED].join("\n") + "\n");
  try {
    await env.adapter.detect();
    // The explicit user-initiated path stores the verified verdict on the adapter (the follow-up slice's contract);
    // launch mechanics are testable against it, exactly like the codex fixture's injected detected state.
    env.adapter.detected = { ...env.adapter.detected!, authenticated: true, authenticatedState: "authenticated", models: ["cline-pass/qwen3.8-max"], current_model: "cline-pass/qwen3.8-max", availability: "ready" } as ProviderLive;
    const result = await env.adapter.launch({ id: "cline-fixture", provider: "cline", prompt: "Say ready", cwd: env.dir } as OrchTask, env.hooks).done as AdapterResult;
    assert.equal(result.ok, true, result.error);
    assert.match(result.output, /ready/);
    const usageRun = env.usage as { inputTokens?: number; outputTokens?: number; cachedInputTokens?: number; source?: string } | null;
    assert.equal(usageRun?.inputTokens, 12);
    assert.equal(usageRun?.outputTokens, 34);
    assert.equal(usageRun?.cachedInputTokens, 7);
    assert.match(usageRun?.source ?? "", /cline run_result/);
    assert.equal(env.model, "cline-pass/qwen3.8-max");
    assert.ok(env.events.some((event) => event.type === "agent.started"));
    assert.ok(env.events.some((event) => event.type === "agent.completed" && /finished \(completed/.test(event.detail)));
    assert.match(readFileSync(env.marker, "utf8"), /run:/, "the launch path executed the fixture exactly once");
  } finally { env.cleanup(); }
});

test("cline launch: a read-scoped task is refused before any process exists", async () => {
  const env = clineFixture([RUN_COMPLETED].join("\n") + "\n");
  try {
    await env.adapter.detect();
    assert.throws(
      () => env.adapter.launch({ id: "cline-fixture", provider: "cline", prompt: "Look around", cwd: env.dir, executionScope: { access: "read" } } as unknown as OrchTask, env.hooks),
      /no read-only mode/,
    );
  } finally { env.cleanup(); }
});

test("cline launch: without a verified provider the launch refuses honestly", async () => {
  const env = clineFixture([LINE_START, LINE_ITERATION, RUN_ERROR_RESULT(SUBSCRIPTION), LINE_ERROR(SUBSCRIPTION)].join("\n") + "\n", 1);
  try {
    await env.adapter.detect();
    assert.throws(() => env.adapter.launch({ id: "cline-fixture", provider: "cline", prompt: "Say ready", cwd: env.dir } as OrchTask, env.hooks), /not ready for execution/);
  } finally { env.cleanup(); }
});

test("cline: launch argv is act-mode JSON with the cwd, a bounded retry loop and the prompt last; run_result parses off a transcript", () => {
  const task = { id: "t", provider: "cline", prompt: "Do the work", cwd: "C:/project" } as OrchTask;
  assert.deepEqual(clineLaunchArgs(task), ["--json", "-c", "C:/project", "--retries", "2", "Do the work"]);
  const run = clineRunResult([LINE_START, RUN_COMPLETED, LINE_ERROR("late")].join("\n"));
  assert.equal(run?.finishReason, "completed");
  assert.equal(run?.text, "ready");
  assert.equal(run?.modelId, "cline-pass/qwen3.8-max");
});

test("cline normalizer: the real lines map to started/thinking/error-warning without inventing completions", () => {
  const normalizer = new ClineNormalizer();
  assert.deepEqual(
    normalizer.normalize(JSON.parse(LINE_START) as Record<string, unknown>).map((event) => event.type),
    ["agent.started"],
  );
  assert.deepEqual(
    normalizer.normalize(JSON.parse(LINE_ITERATION) as Record<string, unknown>).map((event) => event.type),
    ["agent.thinking"],
  );
  const failure = normalizer.normalize(JSON.parse(RUN_ERROR_RESULT(SUBSCRIPTION)) as Record<string, unknown>);
  assert.deepEqual(failure.filter((event) => event.type).map((event) => event.type), []);
  // A finished error run reports usage with the provider's finishReason in its source line, and never agent.completed.
  assert.match((failure.find((event) => event.usage)?.usage?.source) ?? "", /finishReason error/);
  // The typed top-level error line stays a warning: the agent_event shape is the failing verdict.
  const typed = normalizer.normalize(JSON.parse(LINE_ERROR(SUBSCRIPTION)) as Record<string, unknown>);
  assert.deepEqual(typed.map((event) => event.type), ["agent.warning"]);
  const failing = normalizer.normalize(JSON.parse(`{"ts":"t","type":"agent_event","event":{"type":"error","error":{"name":"Error","message":"boom"},"iteration":2}}`) as Record<string, unknown>);
  assert.deepEqual(failing.filter((event) => event.type !== "").map((event) => [event.type, event.detail]), [["agent.error", "boom"]]);
});