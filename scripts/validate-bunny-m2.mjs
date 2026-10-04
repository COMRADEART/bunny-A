// M2 acceptance runner: drives a Bunny-A Host exactly as a UI does (project.add → submit → approve)
// and records evidence from the Host's own live event stream plus an independent disk check.
// Usage: node --experimental-strip-types scripts/validate-bunny-m2.mjs <codex|claude|route> [--credentials path] [--workspaces dir] [--out file]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const option = (name, fallback) => { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] : fallback; };
const test = args[0];
if (!["codex", "claude", "route"].includes(test)) throw new Error("First argument must be codex, claude or route.");
const credentialPath=option("credentials",process.env.BUNNY_VALIDATION_CREDENTIALS);
if(!credentialPath) throw new Error("Validation requires an explicit disposable Host credential path.");
const credentials = JSON.parse(readFileSync(credentialPath, "utf8"));
const base = `http://127.0.0.1:${credentials.port}`;
const headers = { authorization: `Bearer ${credentials.token}`, "content-type": "application/json" };
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const workspaces = resolve(option("workspaces", join(process.env.LOCALAPPDATA ?? ".", "Bunny-A", "validation", "m2")));
const out = option("out", `test-results/m2/${test}-${stamp}.json`);

async function state() { const response = await fetch(`${base}/state`, { headers }); if (!response.ok) throw new Error(`state ${response.status}`); return response.json(); }
async function command(action, data) { const response = await fetch(`${base}/command`, { method: "POST", headers, body: JSON.stringify({ action, data }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error); return result; }

const SPEC = {
  codex: { file: "bunny_codex_test.txt", expected: "BUNNY_A_CODEX_OK", provider: "codex" },
  claude: { file: "bunny_claude_test.txt", expected: "BUNNY_A_CLAUDE_OK", provider: "claude" },
  route: { file: "hello.py", expected: "BUNNY_ROUTE_OK", provider: null },
}[test];
const prompt = test === "route"
  ? 'Create hello.py containing:\n\nprint("BUNNY_ROUTE_OK")\n\nRun the script and verify stdout.'
  : `Create a file named ${SPEC.file} in the current working directory. Its contents must be exactly ${SPEC.expected} with no trailing newline and nothing else.\n` +
    "Then read the file back from disk and finish with exactly these lines:\n" +
    "PROVIDER=<which coding agent you are>\nSESSION_ID=<your session id, or unknown>\nWORKING_DIRECTORY=<absolute path of the current working directory>\n" +
    `ABSOLUTE_PATH=<absolute path of ${SPEC.file}>\nCONTENT=<the exact contents you read back>\nEXIT_STATUS=<exit status of the read-back command, or n/a>\nRESULT=<PASS if the read-back content is exactly ${SPEC.expected}, otherwise FAIL>`;

/** Follows /events?task=<id> (the Host's per-task stream) until a terminal task event arrives. */
async function follow(taskId, onEvent) {
  const response = await fetch(`${base}/events?task=${encodeURIComponent(taskId)}&after=0`, { headers: { authorization: headers.authorization } });
  if (!response.ok || !response.body) throw new Error(`event stream ${response.status}`);
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
  const deadline = Date.now() + 15 * 60_000;
  try {
    while (Date.now() < deadline) {
      const chunk = await reader.read(); if (chunk.done) return;
      buffer += decoder.decode(chunk.value, { stream: true }); let index;
      while ((index = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, index); buffer = buffer.slice(index + 2);
        const data = frame.split("\n").find((line) => line.startsWith("data: "));
        if (!data) continue;
        const event = JSON.parse(data.slice(6)); onEvent(event);
        if (["task.completed", "task.failed", "task.stopped"].includes(event.type)) return;
      }
    }
  } finally { await reader.cancel().catch(() => {}); }
}

const directory = join(workspaces, `${test}-${stamp}`);
mkdirSync(directory, { recursive: true });
await command("project.add", { name: `Bunny-A M2 ${test} (disposable)`, path: directory });
const project = (await state()).projects.find((p) => p.path.toLowerCase() === directory.toLowerCase());
if (!project) throw new Error("Disposable workspace was not registered.");
const before = await state();
const providers = before.providers.map((p) => ({ id: p.id, availability: p.availability, version: p.version, executable: p.executable, authenticatedState: p.authenticatedState }));
const submitted = await command("submit", {
  prompt, mode: "balanced", projectId: project.id,
  ...(SPEC.provider ? { override: SPEC.provider, constraints: { requiresFilesystem: true, requiresTerminal: true, maxRuntimeMs: 300000 } } : { constraints: { maxRuntimeMs: 300000 } }),
  verify: test === "route" ? { kind: "python", name: SPEC.file, expected: SPEC.expected } : { kind: "file", name: SPEC.file, expected: SPEC.expected },
});
const taskId = submitted.task.id;
const atSubmit = submitted.task;
const events = [];
const streaming = follow(taskId, (event) => { events.push(event); process.stdout.write(`  [${event.type}] ${event.detail.slice(0, 160).replace(/\s+/g, " ")}\n`); });
await new Promise((r) => setTimeout(r, 500));
const preApprovalSession = events.some((event) => event.type === "agent.started");
await command("approve", { id: taskId });
await streaming;
const task = (await state()).tasks.find((t) => t.id === taskId);
const session = (await command("session.get", { id: taskId })).session;
const path = join(task.cwd, SPEC.file);
const exists = existsSync(path);
const content = exists ? readFileSync(path, "utf8") : null;
let independent = null;
if (test === "route" && exists) {
  try { const stdout = execFileSync("python", [path], { cwd: task.cwd, windowsHide: true, timeout: 15000 }).toString(); independent = { stdout: stdout.trim(), exitCode: 0 }; }
  catch (error) { independent = { stdout: String(error.stdout ?? "").trim(), exitCode: error.status ?? null }; }
}
const agentLines = Object.fromEntries((task.output ?? "").split(/\r?\n/).map((line) => /^(PROVIDER|SESSION_ID|WORKING_DIRECTORY|ABSOLUTE_PATH|CONTENT|EXIT_STATUS|RESULT)=(.*)$/.exec(line.trim().replace(/^[`*-]+\s*/, "").replace(/`$/, ""))).filter(Boolean).map((m) => [m[1], m[2]]));
const order = (type) => events.findIndex((event) => event.type === type);
const checks = {
  approvalBeforeLaunch: atSubmit.state === "waiting_for_approval" && !preApprovalSession && order("approval.required") >= 0 && order("approval.required") < order("approval.accepted") && order("approval.accepted") < order("agent.started"),
  realProviderSession: !!task.sessionId && (task.provider === "ollama" || !!task.pid) && events.some((event) => event.type === "agent.started"),
  expectedProvider: SPEC.provider ? task.provider === SPEC.provider : ["codex", "claude", "ollama"].includes(task.provider),
  fileExistsOnHost: exists,
  exactContent: test === "route" ? content?.trim() === `print("${SPEC.expected}")` : content === SPEC.expected,
  bunnyVerification: task.verification?.passed === true,
  agentReadBack: test === "route" ? true : agentLines.CONTENT === SPEC.expected,
  independentRun: test === "route" ? independent?.stdout === SPEC.expected && independent?.exitCode === 0 : true,
  completed: task.state === "completed",
};
const pass = Object.values(checks).every(Boolean);
const providerLive = before.providers.find((p) => p.id === task.provider);
const evidence = {
  test, pass, checks, taskId, stamp,
  report: {
    PROVIDER: `${providerLive?.name ?? task.provider} (${providerLive?.version ?? "unknown version"}; ${providerLive?.executable ?? "no executable"})`,
    SESSION_ID: task.sessionId ?? "none", WORKING_DIRECTORY: task.cwd, ABSOLUTE_PATH: path,
    CONTENT: content, EXIT_STATUS: task.exitCode, RESULT: pass ? "PASS" : "FAIL",
  },
  agentReport: agentLines,
  decision: { manual: task.manual, recommended: task.decision.recommended_provider, model: task.model, mode: task.decision.mode, requirements: task.decision.requirements, eligible: task.decision.eligible_providers, excluded: task.decision.excluded, scores: task.decision.scores, reasons: task.decision.reasons, alternatives: task.decision.alternatives, confidence: task.decision.confidence, confidenceKind: task.decision.confidence_kind },
  providersAtSubmit: providers,
  session, independentPythonRun: independent,
  task: { state: task.state, provider: task.provider, model: task.model, sessionId: task.sessionId, pid: task.pid, exitCode: task.exitCode, cwd: task.cwd, startedAt: task.startedAt, finishedAt: task.finishedAt, verification: task.verification, latestEvent: task.latestEvent, progress: task.progress, usage: task.usage, processTree: task.processTree, error: task.error, output: task.output },
  events,
};
mkdirSync(join(out, ".."), { recursive: true });
writeFileSync(out, JSON.stringify(evidence, null, 2));
console.log(`\n${Object.entries(evidence.report).map(([key, value]) => `${key}=${value}`).join("\n")}\nchecks=${JSON.stringify(checks)}\nevidence=${out}`);
process.exitCode = pass ? 0 : 1;
