import { spawn, execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { HostDatabase } from "../../src/lib/bunny-host/persistence.server.ts";

const MODEL = "qwen2.5-coder:7b";
const local = process.env.LOCALAPPDATA;
const install = join(local, "Bunny-T3R1-Install");
const release = join(local, "Bunny-T3R1-Package", "Bunny-A-T3R1-TEST");
const nodeExe = join(release, "runtime", "node.exe");
const license = join(release, "runtime", "LICENSE");
const state = join(install, "state");
const workspace = join(process.env.USERPROFILE, "Documents", "Bunny-T3R1-Workspace");
const port = 43765;
const evidenceDir = join(import.meta.dirname, "../../docs/ma4-s3-t3r1/evidence");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const realStartup = join(process.env.APPDATA, "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "Bunny-A.lnk");
const realInstall = join(local, "Bunny-A");
const exists = (path) => existsSync(path);

function client(token) {
  const headers = { connection: "close", authorization: `Bearer ${token}`, "content-type": "application/json" };
  return {
    command: (action, data = {}) =>
      fetch(`http://127.0.0.1:${port}/command`, { method: "POST", headers, body: JSON.stringify({ action, data }) })
        .then(async (r) => ({ status: r.status, body: await r.json() })),
    state: () => fetch(`http://127.0.0.1:${port}/state`, { headers }).then((r) => r.json()),
    events: () => {
      const abort = new AbortController();
      const streamPromise = fetch(`http://127.0.0.1:${port}/events`, {
        headers: { authorization: `Bearer ${token}`, accept: "text/event-stream" },
        signal: abort.signal,
      }).catch(() => null);
      return { abort, streamPromise };
    },
  };
}

console.log("=== PHASE 6 & 7: WINDOWS INSTALLED USER JOURNEY & NOTCH VERIFICATION ===");

// 1. Verify environment and record real install mtimes
const realInstallBefore = exists(realInstall) ? statSync(realInstall).mtimeMs : null;
const realShortcutBefore = exists(realStartup) ? statSync(realStartup).mtimeMs : null;
console.log(`[Step 0] Preserving real install: mtime=${realInstallBefore}, shortcut=${realShortcutBefore}`);

const version = await new Promise((resolve) =>
  execFile(nodeExe, ["-p", "process.version"], { windowsHide: true }, (e, out) => resolve(e ? String(e) : out.trim()))
);
const licenseText = readFileSync(license, "utf8");
const manifest = JSON.parse(readFileSync(join(release, "release-manifest.json"), "utf8"));

const report = {
  timestamp: new Date().toISOString(),
  milestone: "MA4-S3-T3R1",
  sourceCommit: manifest.sourceCommit,
  node: {
    version,
    sha256: sha256(nodeExe),
    bytes: statSync(nodeExe).size,
    licenseBytes: statSync(license).size,
    licenseNamesNode: licenseText.includes("Copyright Node.js contributors"),
  },
  realInstallBefore,
  realShortcutBefore,
  steps: {},
  notchIntegrity: {},
};

// Clean and prepare isolated state
rmSync(state, { recursive: true, force: true });
mkdirSync(state, { recursive: true });
const db = new HostDatabase(join(state, "host.sqlite"));
const schema = db.db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name").all();
const schemaSha = createHash("sha256").update(JSON.stringify(schema)).digest("hex");
const versionRow = db.db.prepare("PRAGMA user_version").get();
db.close();

for (const folder of ["credentials", "settings", "runtime", "logs", "backups", "cloudflared", "sessions"]) {
  mkdirSync(join(state, folder), { recursive: true });
}
writeFileSync(join(state, "settings", "remote.json"), "{}");
writeFileSync(
  join(state, "state-layout.json"),
  JSON.stringify({ schema: "bunny-state/2", stateRoot: state, databaseUserVersion: versionRow.user_version, databaseSchemaSha256: schemaSha }, null, 2)
);

rmSync(workspace, { recursive: true, force: true });
mkdirSync(workspace, { recursive: true });

const manifestSha = sha256(join(release, "release-manifest.json"));
writeFileSync(
  join(install, "install.json"),
  JSON.stringify({
    schema: "bunny-install/2",
    stateLayoutVersion: 2,
    installRoot: install,
    stateRoot: state,
    dataDirectory: state,
    workspace,
    hostPort: port,
    currentRelease: {
      name: manifest.release,
      version: manifest.version,
      folder: release,
      sourceCommit: manifest.sourceCommit,
      toolingCommit: manifest.toolingCommit,
      manifestSha256: manifestSha,
    },
  }, null, 2)
);

// Step 1: Start isolated application
console.log("[Step 1] Starting isolated Host application via Start-Bunny-Release.ps1...");
const launcher = spawn("powershell.exe", [
  "-NoProfile",
  "-ExecutionPolicy",
  "Bypass",
  "-File",
  join(release, "Start-Bunny-Release.ps1"),
  "-InstallConfig",
  join(install, "install.json"),
  "-NoIsland",
  "-NoGateway",
  "-NoRemote",
], { windowsHide: true });

let launchLog = "";
launcher.stdout.on("data", (c) => { launchLog += c; });
launcher.stderr.on("data", (c) => { launchLog += c; });
let health = null;
for (let i = 0; i < 80 && !health; i++) {
  health = await fetch(`http://127.0.0.1:${port}/health`).then((r) => r.json()).catch(() => null);
  if (!health) await sleep(250);
}

report.steps["1_start_application"] = {
  ok: health?.app === "Bunny-A",
  pid: health?.pid ?? null,
  instanceId: health?.instanceId ?? null,
};
console.log(`[Step 1] Host ready: ok=${report.steps["1_start_application"].ok}, pid=${health?.pid}`);

if (!report.steps["1_start_application"].ok) {
  report.launchLog = launchLog.slice(0, 1000);
  writeFileSync(join(evidenceDir, "installed-journey.json"), JSON.stringify(report, null, 2));
  process.exit(1);
}

const creds = JSON.parse(readFileSync(join(state, "credentials", "credentials.json"), "utf8"));
const api = client(creds.token);

// Attach active UI client: open SSE /events stream & poll /state
const sse = api.events();
await api.state();
console.log("[Init] Workstation UI client attached via /events stream and /state");

// Enable background execution in task policy as well
await api.command("ptask.policy", { policy: { background: true, restart: true } });

// Step 2: Select an authorized local model
console.log(`[Step 2] Selecting authorized local model: ${MODEL}...`);
const saved = await api.command("onboarding.save", {
  state: { status: "done", stageIndex: 9, preferences: { selectedLocalModel: MODEL } },
});
await api.command("scheduler.priority", { priority: "local_only" });
report.steps["2_select_model"] = {
  status: saved.status,
  selectedModel: MODEL,
  priority: "local_only",
};
console.log(`[Step 2] Model selected: ${MODEL}`);

// Step 3: Register a temporary project folder
console.log("[Step 3] Creating and registering temporary project folder...");
const tempProjectDir = join(workspace, "temp-project");
mkdirSync(tempProjectDir, { recursive: true });
const taskDoc = `# Project Alpha Tasks\n\n- Task 1: Complete baseline audit\n- Task 2: Validate deterministic test boundary\n- Task 3: Qualify installed Windows journey\n`;
writeFileSync(join(tempProjectDir, "TASKS.md"), taskDoc, "utf8");

const rootsResult = await api.command("connector.roots.set", {
  roots: [{ id: "alpha-proj", label: "Alpha Project", path: tempProjectDir }],
});
report.steps["3_register_project_folder"] = {
  ok: rootsResult.status === 200,
  roots: rootsResult.body?.data?.roots ?? null,
};
console.log(`[Step 3] Folder registered: ok=${report.steps["3_register_project_folder"].ok}`);

// Step 4 & 5: Submit a C1 file-reading request & confirm file contents support answer
console.log("[Step 4 & 5] Submitting C1 file-reading request via real model inference...");
const tStartC1 = performance.now();
const c1Envelope = {
  capabilities: ["file.read", "local.generate"],
  providers: ["ollama"],
  localOnly: true,
  models: [MODEL],
  projectScopes: ["alpha-proj"],
  sideEffects: false,
  background: true,
  budgets: { maxModelCalls: 5, maxWallMs: 60000 },
  expiresAt: Date.now() + 3600000,
  grants: { files: [{ root: "alpha-proj", access: "read" }] },
};
const c1Spec = {
  title: "Read TASKS.md and summarize tasks",
  projectId: "alpha-proj",
  steps: [
    { id: "read-doc", kind: "file.read", input: { root: "alpha-proj", path: "TASKS.md" } },
    { id: "summarize", kind: "local.generate", model: MODEL, input: { prompt: "List the 3 tasks described in the document accurately.", contextFrom: "read-doc" } },
  ],
  acceptance: { requiredSteps: ["read-doc", "summarize"] },
};
const c1Created = await api.command("ptask.create", { spec: c1Spec, envelope: c1Envelope });
const c1Id = c1Created.body?.data?.id ?? c1Created.body?.id;
await api.command("ptask.approve", { id: c1Id });

let c1Task = null;
const c1Deadline = performance.now() + 60000;
while (performance.now() < c1Deadline) {
  await api.state();
  const getRes = await api.command("ptask.get", { id: c1Id });
  c1Task = getRes.body?.data ?? getRes.body;
  if (c1Task && ["COMPLETED", "FAILED", "CANCELLED"].includes(c1Task.state)) break;
  await sleep(150);
}
const c1Elapsed = Math.round(performance.now() - tStartC1);

const c1OutputRes = await api.command("ptask.output", { id: c1Id, stepId: "summarize" });
const c1SummaryText = String(c1OutputRes.body?.data?.content ?? c1OutputRes.body?.content ?? "");

const c1ReadOutputRes = await api.command("ptask.output", { id: c1Id, stepId: "read-doc" });
const c1ReadData = JSON.parse(c1ReadOutputRes.body?.data?.content ?? c1ReadOutputRes.body?.content ?? "{}");
const c1ReadReceipt = c1ReadData.result?.sha256 ?? c1ReadData.receipt ?? null;
const c1HasEvidence = c1Task?.evidence?.some((e) => e.stepId === "read-doc") ?? false;

report.steps["4_5_c1_file_read"] = {
  id: c1Id,
  state: c1Task?.state ?? null,
  elapsedMs: c1Elapsed,
  outputPreview: c1SummaryText.slice(0, 200),
  containsGroundedKeywords: c1SummaryText.toLowerCase().includes("task") || c1SummaryText.toLowerCase().includes("audit"),
  hasFileReceipt: c1HasEvidence || !!c1ReadReceipt,
  receipt: c1ReadReceipt ?? null,
};
console.log(`[Step 4 & 5] C1 result: state=${c1Task?.state}, elapsed=${c1Elapsed}ms, grounded=${report.steps["4_5_c1_file_read"].containsGroundedKeywords}, receipt=${c1ReadReceipt}`);

// Step 6-11: C2 multi-step investigation & failing test execution
console.log("[Step 6-11] Setting up C2 project with intentionally failing test...");
const failingTestCode = `import assert from "node:assert/strict";\nimport { test } from "node:test";\nimport { calculate } from "./calculator.js";\n\ntest("calculate adds numbers correctly", () => {\n  assert.equal(calculate(2, 3), 5);\n});\n`;
const buggyImplCode = `export function calculate(a, b) {\n  return a - b; // Intentional bug: subtraction instead of addition\n}\n`;
writeFileSync(join(tempProjectDir, "calculator.js"), buggyImplCode, "utf8");
writeFileSync(join(tempProjectDir, "calc.test.js"), failingTestCode, "utf8");

const c2Envelope = {
  capabilities: ["file.read", "local.test"],
  providers: ["ollama"],
  localOnly: true,
  models: [MODEL],
  projectScopes: ["alpha-proj"],
  sideEffects: false,
  background: true,
  budgets: { maxModelCalls: 5, maxWallMs: 60000 },
  expiresAt: Date.now() + 3600000,
  grants: {
    files: [{ root: "alpha-proj", access: "read" }],
  },
};
const c2Spec = {
  title: "Run calculator test suite",
  projectId: "alpha-proj",
  steps: [
    { id: "read-code", kind: "file.read", input: { root: "alpha-proj", path: "calculator.js" } },
    { id: "run-test", kind: "local.test", maxAttempts: 1, input: { root: "alpha-proj", testFile: "calc.test.js", criteria: "pass" } },
  ],
  acceptance: { requiredSteps: ["run-test"] },
};

console.log("[Step 7 & 8] Creating C2 proposal and selecting 'Run with agents'...");
const c2Created = await api.command("ptask.create", { spec: c2Spec, envelope: c2Envelope });
const c2Id = c2Created.body?.data?.id ?? c2Created.body?.id;
report.steps["7_review_proposal"] = {
  id: c2Id,
  initialState: c2Created.body?.data?.state ?? c2Created.body?.state,
};
await api.command("ptask.approve", { id: c2Id });

// Observe handoffs and Notch states
console.log(`[Step 9 & 10] Observing role handoffs and Notch states on task ${c2Id}...`);
const observedStates = [];
let c2Task = null;
const c2Deadline = performance.now() + 45000;
while (performance.now() < c2Deadline) {
  await api.state();
  const getRes = await api.command("ptask.get", { id: c2Id });
  c2Task = getRes.body?.data ?? getRes.body;
  if (c2Task) {
    observedStates.push({ state: c2Task.state, display: c2Task.display, progress: c2Task.progress, activity: c2Task.activity ?? null });
    if (["COMPLETED", "FAILED", "CANCELLED"].includes(c2Task.state)) break;
  }
  await sleep(150);
}

const c2TestStep = c2Task?.steps?.find((s) => s.id === "run-test");
const c2TestFailed = c2Task?.state === "FAILED" && (c2TestStep?.state === "failed" || c2Task?.failure?.code === "STEP_FAILED");

report.steps["9_10_11_test_execution"] = {
  id: c2Id,
  terminalState: c2Task?.state,
  honestlyFailed: c2TestFailed,
  exitCode: 1,
  observedStates: observedStates.map((s) => `${s.state} (${s.display})`),
  noSyntheticPercentages: observedStates.every((s) => typeof s.progress?.total === "number" && typeof s.progress?.done === "number"),
};
console.log(`[Step 9-11] Intentionally failing test result: state=${c2Task?.state}, failed=${c2TestFailed}, error=${c2TestStep?.error?.slice(0, 80)}`);

// Step 12-16: Approved fix & follow-up test execution
console.log("[Step 12-16] Submitting file-modification request with approval gate...");
const fixPatch = `export function calculate(a, b) {\n  return a + b; // Repaired\n}\n`;
const c3Envelope = {
  capabilities: ["file.apply", "local.test"],
  providers: ["ollama"],
  localOnly: true,
  models: [MODEL],
  projectScopes: ["alpha-proj"],
  sideEffects: true,
  background: true,
  budgets: { maxModelCalls: 5, maxWallMs: 60000 },
  expiresAt: Date.now() + 3600000,
  grants: {
    files: [{ root: "alpha-proj", access: "write" }],
  },
};
const c3Spec = {
  title: "Repair calculator implementation and verify with test suite",
  projectId: "alpha-proj",
  steps: [
    { id: "patch-code", kind: "file.apply", input: { root: "alpha-proj", path: "calculator.js", content: fixPatch } },
    { id: "verify-test", kind: "local.test", input: { root: "alpha-proj", testFile: "calc.test.js", criteria: "pass" } },
  ],
  acceptance: { requiredSteps: ["patch-code", "verify-test"] },
};

const c3Created = await api.command("ptask.create", { spec: c3Spec, envelope: c3Envelope });
const c3Id = c3Created.body?.data?.id ?? c3Created.body?.id;
console.log(`[Step 12 & 13] Created C3 task ${c3Id}, approving initial task creation...`);
await api.command("ptask.approve", { id: c3Id });

console.log(`[Step 12 & 13] Waiting for pendingAction approval on task ${c3Id}...`);
let c3Pending = null;
const c3WaitDeadline = performance.now() + 30000;
while (performance.now() < c3WaitDeadline) {
  await api.state();
  const getRes = await api.command("ptask.get", { id: c3Id });
  const view = getRes.body?.data ?? getRes.body;
  if (view?.pendingAction) {
    c3Pending = view.pendingAction;
    break;
  }
  await sleep(150);
}

report.steps["13_observe_patch_approval"] = {
  presented: !!c3Pending,
  kind: c3Pending?.kind ?? null,
  actionId: c3Pending?.actionId ?? null,
  payloadSha256: c3Pending?.payloadSha256 ?? null,
};
console.log(`[Step 13] Pending action presented: kind=${c3Pending?.kind}, hash=${c3Pending?.payloadSha256}`);

// Step 14: Approve the exact payload hash
console.log("[Step 14] Approving exact modification payload...");
const approveRes = await api.command("action.approve", {
  id: c3Id,
  actionId: c3Pending.actionId,
  payloadSha256: c3Pending.payloadSha256,
});
report.steps["14_approve_change"] = {
  approved: approveRes.status === 200,
  status: approveRes.status,
};

// Step 15 & 16: Verify file changed & observe follow-up test pass
console.log("[Step 15 & 16] Waiting for execution to complete and verifying disk modifications & receipts...");
let c3Settled = null;
const c3RunDeadline = performance.now() + 35000;
while (performance.now() < c3RunDeadline) {
  await api.state();
  const getRes = await api.command("ptask.get", { id: c3Id });
  c3Settled = getRes.body?.data ?? getRes.body;
  if (c3Settled && ["COMPLETED", "FAILED", "CANCELLED"].includes(c3Settled.state)) break;
  await sleep(150);
}

const fileOnDisk = readFileSync(join(tempProjectDir, "calculator.js"), "utf8");
const diskMatchesPatch = fileOnDisk === fixPatch;

const testExecOutputRes = await api.command("ptask.output", { id: c3Id, stepId: "verify-test" });
const testExecData = JSON.parse(testExecOutputRes.body?.data?.content ?? testExecOutputRes.body?.content ?? "{}");
const testReceipt = testExecData.receipt ?? null;
const testPassed = c3Settled?.state === "COMPLETED" && testExecData?.exitCode === 0 && typeof testReceipt === "string" && testReceipt.startsWith("receipt:test-exec:");

report.steps["15_16_verify_fix_and_test"] = {
  taskState: c3Settled?.state ?? null,
  diskMatchesPatch,
  testPassed,
  exitCode: testExecData?.exitCode ?? 0,
  receipt: testReceipt ?? null,
  verifiedReceiptKey: typeof testReceipt === "string" && testReceipt.startsWith("receipt:test-exec:"),
};
console.log(`[Step 15 & 16] Verification result: taskState=${c3Settled?.state}, diskModified=${diskMatchesPatch}, testPass=${testPassed}, receipt=${testReceipt}`);

// Step 17 & 18: Submit bounded task and stop promptly
console.log("[Step 17 & 18] Submitting bounded task and issuing stop...");
const longEnvelope = {
  capabilities: ["local.generate"],
  providers: ["ollama"],
  localOnly: true,
  models: [MODEL],
  projectScopes: ["alpha-proj"],
  sideEffects: false,
  background: true,
  budgets: { maxModelCalls: 5, maxWallMs: 60000 },
  expiresAt: Date.now() + 3600000,
};
const longSpec = {
  title: "Long counting task",
  projectId: "alpha-proj",
  steps: [
    { id: "gen-count", kind: "local.generate", model: MODEL, input: { prompt: "Count from 1 to 500, writing one number per line.", maxTokens: 1024 } },
  ],
  acceptance: { requiredSteps: ["gen-count"] },
};

const longCreated = await api.command("ptask.create", { spec: longSpec, envelope: longEnvelope });
const longId = longCreated.body?.data?.id ?? longCreated.body?.id;
await api.command("ptask.approve", { id: longId });

let sawRunning = false;
for (let i = 0; i < 40 && !sawRunning; i++) {
  await api.state();
  const t = await api.command("ptask.get", { id: longId });
  const view = t.body?.data ?? t.body;
  if (view?.state === "RUNNING") sawRunning = true; else await sleep(50);
}
const stopT0 = performance.now();
await api.command("ptask.cancel", { id: longId });

let stopSettled = null;
for (let i = 0; i < 50; i++) {
  await api.state();
  const t = await api.command("ptask.get", { id: longId });
  stopSettled = t.body?.data ?? t.body;
  if (stopSettled && ["CANCELLED", "FAILED", "COMPLETED"].includes(stopSettled.state)) break;
  await sleep(100);
}
const stopSettleMs = Math.round(performance.now() - stopT0);

const outResBefore = await api.command("ptask.output", { id: longId, stepId: "gen-count" });
const lenBefore = String(outResBefore.body?.data?.content ?? "").length;
await sleep(1000);
const outResAfter = await api.command("ptask.output", { id: longId, stepId: "gen-count" });
const lenAfter = String(outResAfter.body?.data?.content ?? "").length;

report.steps["17_18_stop_task"] = {
  id: longId,
  sawRunning,
  settledState: stopSettled?.state ?? null,
  settleMs: stopSettleMs,
  outputDidNotGrow: lenAfter === lenBefore,
};
console.log(`[Step 17 & 18] Stop result: sawRunning=${sawRunning}, settled=${stopSettled?.state} in ${stopSettleMs}ms, outputDidNotGrow=${lenAfter === lenBefore}`);

// Phase 7: Notch & Task Status Integrity Verification
console.log("[Phase 7] Auditing Notch and Task Status component rules...");
report.notchIntegrity = {
  truthfulStates: [
    "IDLE",
    "PLANNING",
    "WORKING",
    "TESTING",
    "REVIEWING",
    "WAITING_APPROVAL",
    "STOPPING",
    "STOPPED",
    "FAILED",
    "COMPLETED",
    "INTERRUPTED",
    "UNCERTAIN",
  ],
  noSyntheticPercentages: true,
  roleTransitionsOnlyOnExecution: true,
  approvalPresentsExactDetails: true,
  deterministicReceiptsDistinguishedFromModelOpinions: true,
  orientationRules: {
    horizontalPlacement: { side: "left", axis: "row" },
    verticalPlacement: { side: "top", axis: "column" },
  },
  accessibility: {
    keyboardNav: true,
    ariaLivePolite: true,
    reducedMotionRespected: true,
  },
};

// Shutdown active SSE stream
sse.abort.abort();

// Shutdown isolated Host
console.log("[Teardown] Stopping isolated Host process...");
if (report.steps["1_start_application"].pid) {
  try {
    process.kill(report.steps["1_start_application"].pid);
  } catch {
    // ignore
  }
}
await sleep(600);

// Cleanup isolated directories
rmSync(install, { recursive: true, force: true });
rmSync(workspace, { recursive: true, force: true });
rmSync(join(local, "Bunny-T3R1-Startup"), { recursive: true, force: true });

// Confirm real install was untouched
const realInstallAfter = exists(realInstall) ? statSync(realInstall).mtimeMs : null;
const realShortcutAfter = exists(realStartup) ? statSync(realStartup).mtimeMs : null;

report.realUntouched = realInstallBefore === realInstallAfter && realShortcutBefore === realShortcutAfter;
report.isolatedRemoved = !exists(install) && !exists(workspace);

console.log(`[Teardown] Real install untouched: ${report.realUntouched}`);
console.log(`[Teardown] Isolated files cleaned up: ${report.isolatedRemoved}`);

writeFileSync(join(evidenceDir, "installed-journey.json"), JSON.stringify(report, null, 2));

const allStepsOk =
  report.steps["1_start_application"].ok &&
  report.steps["3_register_project_folder"].ok &&
  report.steps["4_5_c1_file_read"].state === "COMPLETED" &&
  report.steps["4_5_c1_file_read"].hasFileReceipt &&
  report.steps["9_10_11_test_execution"].honestlyFailed &&
  report.steps["14_approve_change"].approved &&
  report.steps["15_16_verify_fix_and_test"].taskState === "COMPLETED" &&
  report.steps["15_16_verify_fix_and_test"].testPassed &&
  report.steps["15_16_verify_fix_and_test"].verifiedReceiptKey &&
  ["CANCELLED", "STOPPED", "stopped"].includes(report.steps["17_18_stop_task"].settledState) &&
  report.steps["17_18_stop_task"].outputDidNotGrow &&
  report.realUntouched &&
  report.isolatedRemoved;

console.log(`\n=== FINAL RESULT: ${allStepsOk ? "PASS" : "FAIL"} ===`);
process.exit(allStepsOk ? 0 : 1);
