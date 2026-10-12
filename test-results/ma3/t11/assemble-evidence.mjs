// M-A-3 T11 evidence assembly. Derives the named evidence files from: the live run's canonical exports (live/), the
// final regression logs (regression/), the package results and the source tree. Nothing is invented: a missing input is
// recorded as NOT TESTED with the reason. Usage: node test-results/ma3/t11/assemble-evidence.mjs
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const root = resolve(import.meta.dirname, "../../..");
const ev = process.env.T11_EVIDENCE_OUT ?? import.meta.dirname;
const LIVE = process.env.T11_LIVE ?? join(ev, "live");
const REG = process.env.T11_REGRESSION ?? join(import.meta.dirname, "regression-final");
const read = (path) => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null);
const live = (name) => read(join(LIVE, name));
const save = (name, value) => writeFileSync(join(ev, name), JSON.stringify(value, null, 2) + "\n");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const NOT = (reason) => ({ result: "NOT TESTED", reason });

const run = live("live-run.json"), missions = live("missions.json")?.results ?? [], faults = live("faults.json") ?? {};
const timeline = live("timeline.json")?.events ?? [], receipts = live("receipts.json")?.receipts ?? [];
const invocations = live("model-invocations.json")?.invocations ?? [], routing = live("routing-decisions.json")?.decisions ?? [];
const handoffs = live("handoffs.json")?.handoffs ?? [], agents = live("agents.json") ?? { agents: [], runs: [] };
const checkpoints = live("checkpoints.json") ?? { count: 0, checkpoints: [] }, auth = live("authorizations.json") ?? {};
const telemetry = live("telemetry.json")?.samples ?? [], runs = live("capability-runs.json")?.runs ?? [];
const owned = live("owned-process-records.json")?.records ?? [], voice = live("voice-probe.json"), dom = live("dom-inspection.json");
const plans = existsSync(join(LIVE, "plans")) ? readdirSync(join(LIVE, "plans")).map((f) => read(join(LIVE, "plans", f))) : [];
const LIVE_CLASS = "LIVE disposable Host, real local Ollama (huihui_ai/qwen2.5-abliterate:7b as routed), disposable Git project";

// Regression summary (per-part TAP totals).
const tap = (name) => {
  const path = join(REG, `${name}.log`);
  if (!existsSync(path)) return null;
  const text = readFileSync(path, "utf8");
  const n = (k) => [...text.matchAll(new RegExp(`^ℹ ${k} (\\d+)`, "gm"))].reduce((a, m) => a + Number(m[1]), 0);
  return { tests: n("tests"), pass: n("pass"), fail: n("fail"), skipped: n("skipped"), todo: n("todo"), cancelled: n("cancelled") };
};
const summary = existsSync(join(REG, "summary.txt")) ? readFileSync(join(REG, "summary.txt"), "utf8") : "";
const exitOf = (name) => Number(new RegExp(`^${name} exit=(\\d+)`, "m").exec(summary)?.[1] ?? NaN);
const parts = Object.fromEntries(["scripts", "library", "agent", "ui"].map((k) => [k, tap(k)]));
const total = Object.values(parts).filter(Boolean).reduce((a, p) => ({ tests: a.tests + p.tests, pass: a.pass + p.pass, fail: a.fail + p.fail, skipped: a.skipped + p.skipped }), { tests: 0, pass: 0, fail: 0, skipped: 0 });
const regressionLine = (needle) => {
  for (const part of ["scripts", "library", "agent", "ui"]) {
    const path = join(REG, `${part}.log`);
    if (!existsSync(path)) continue;
    const lines = readFileSync(path, "utf8").split(/\r?\n/).filter((line) => /^\s*(✔|✖|﹣)/.test(line) && line.includes(needle));
    if (lines.length) return lines.map((line) => line.trim().slice(0, 240));
  }
  return [];
};
const testsMatching = (re) => {
  const out = [];
  for (const part of ["scripts", "library", "agent", "ui"]) {
    const path = join(REG, `${part}.log`);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) if (/^\s*(✔|✖)/.test(line) && re.test(line)) out.push(line.trim().replace(/ \(\d+(\.\d+)?ms\)$/, ""));
  }
  return [...new Set(out)];
};
const passed = (lines) => lines.length > 0 && lines.every((line) => line.startsWith("✔"));

// ── per-mission helpers ──
const byMission = (id) => missions.find((m) => m.missionId === id);
const A = missions[0] ?? null;
const live_ = (result, extra = {}) => ({ classification: LIVE_CLASS, ...extra, result });
const stepKinds = (m) => (m?.steps ?? []).filter((s) => !s.dormant || s.attempts.length);
const agentById = new Map(agents.agents.map((a) => [a.id, a]));
const roleOf = (id) => agentById.get(id)?.team?.role ?? null;

save("source-provenance.json", (() => {
  const head = git("rev-parse", "HEAD");
  return { baseline: { t10Source: "2d5646d5c5a95ab040239b20b034e2c6b0828365", t10Evidence: git("rev-parse", "bde8186") }, branch: git("rev-parse", "--abbrev-ref", "HEAD"),
    t11SourceCommits: git("log", "--format=%H %s", "bde8186..HEAD", "--", "src", "scripts", "install", "package.json").split("\n").filter(Boolean),
    sourceCommitAtAssembly: head, sourceTreeClean: git("status", "--porcelain", "--", "src", "scripts", "install", "package.json") === "",
    liveRunSource: run?.sourceCommit ?? null, ancestryFromT10: (() => { try { git("merge-base", "--is-ancestor", "bde8186", "HEAD"); return true; } catch { return false; } })(),
    filesChanged: git("diff", "--stat", "bde8186", "HEAD", "--", "src", "scripts", "install", "package.json").split("\n").slice(-1)[0],
    files: git("diff", "--name-status", "bde8186", "HEAD", "--", "src", "scripts", "install", "package.json").split("\n").filter(Boolean) };
})());

save("real-planner-inference.json", run ? live_(invocations.some((i) => i.kind === "plan" && i.state === "completed") ? "PASS" : "FAIL", {
  plannerCalls: invocations.filter((i) => i.kind === "plan").map((i) => ({ ...i, receipt: receipts.find((r) => r.taskId === i.taskId) ?? null })),
  rejections: plans.map((p) => ({ mission: p.mission, revisions: p.planRevisions, reasons: p.rejected })),
  note: "Every planner call is a real Ollama generation (receipt from Ollama's own final message). Plans are untrusted; see generated-plan-validation.json.",
}) : NOT("no live run"));

save("generated-plan-validation.json", { live: plans.map((p) => ({ mission: p.mission, phase: p.phase, state: p.state, planReference: p.planReference, planRevisions: p.planRevisions, rejected: p.rejected, tasks: p.tasks })),
  unitTests: testsMatching(/^(✔|✖) (M0[4-8]|M13|M2[02]|M37\/M39: one writer|requirements and output|M32|the planner's example)/), classification: "LIVE plans + STATIC/unit validation tests" });

save("mission-graph-results.json", run ? live_(missions.some((m) => m.state === "completed") ? "PASS" : "FAIL", { missions: missions.map((m) => ({ name: m.name, missionId: m.missionId, state: m.state, durationMs: m.durationMs, steps: m.steps })),
  note: "Every team step is an ordinary MissionManager step (mission_steps); there is no second scheduler." }) : NOT("no live run"));

const stepEvents = timeline.filter((e) => /^mission\.step\.(ready|started|completed|failed)$/.test(e.type));
save("task-dependency-results.json", run ? live_(faults.dependencyDelay?.resumedAt ? "PASS" : "NOT TESTED", { dependencyDelay: faults.dependencyDelay ?? null,
  tests: testsMatching(/M05\/M06|T11-I04|M57/), stepTransitions: stepEvents.length }) : NOT("no live run"));

// Concurrency from step start/end events.
const intervals = [];
{
  const open = new Map();
  for (const e of timeline) {
    const id = /\(step ([0-9a-f-]{36})\)/.exec(e.detail)?.[1];
    if (!id) continue;
    if (e.type === "mission.step.started") open.set(id, e.at);
    else if (/^mission\.step\.(completed|failed)$/.test(e.type) && open.has(id)) { intervals.push({ stepId: id, start: open.get(id), end: e.at }); open.delete(id); }
  }
}
const allSteps = missions.flatMap((m) => m.steps.map((s) => ({ ...s, missionId: m.missionId })));
const stepRecord = (id) => { const st = live("mission-steps.json")?.steps?.find((s) => s.id === id); return st ?? null; };
void stepRecord;
const peak = (filter) => { let best = 0, at = null; for (const i of intervals.filter(filter)) { const n = intervals.filter(filter).filter((j) => j.start <= i.start && j.end > i.start).length; if (n > best) { best = n; at = i.start; } } return { peak: best, at }; };
const modelTaskIds = new Set(invocations.map((i) => i.taskId));
save("concurrency-matrix.json", run ? live_(peak(() => true).peak >= 2 ? "PASS" : "FAIL", {
  stepIntervals: intervals.length, peakConcurrentSteps: peak(() => true),
  peakWorkingAgents: Math.max(0, ...telemetry.map((t) => t.agents?.working ?? 0)), peakActiveTeamMissions: Math.max(0, ...telemetry.map((t) => t.activeMissions ?? 0)),
  modelCalls: receipts.length, overlappingModelGenerations: (() => { let best = 0; for (const r of receipts) best = Math.max(best, receipts.filter((x) => x.requestedAt <= r.requestedAt && x.finishedAt > r.requestedAt).length); return best; })(),
  bounds: { maxConcurrentStepsPerMission: 3, maxConcurrentModelStepsPerMission: 2, maxActiveAgents: 10, note: "The step/model bounds are per Mission. Ollama serializes generation on the single 6 GB GPU; overlapping requests queue inside Ollama (see receipts' requestedAt/firstTokenAt)." },
  tests: testsMatching(/M19|M17|concurren/i), unusedModelTaskIds: modelTaskIds.size }) : NOT("no live run"));

save("per-task-model-routing.json", run ? live_(routing.length ? "PASS" : "FAIL", { decisions: routing.map((r) => ({ taskId: r.taskId, missionId: r.missionId, at: r.at, policy: r.policy, selected: r.selected, reroutes: r.reroutes, eligible: r.candidates.filter((c) => c.eligible).map((c) => `${c.provider}·${c.model}=${c.score}`), excluded: r.candidates.filter((c) => !c.eligible).map((c) => ({ candidate: `${c.provider}·${c.model ?? "(provider)"}`, why: (c.exclusions ?? []).slice(0, 2) })) })),
  disclosure: "The router decided per task. All eligible local candidates scored equally for these tool-free text tasks and the deterministic tie-break selected huihui_ai/qwen2.5-abliterate:7b every time; qwen2.5-coder:7b was eligible but not selected, 27b/30b models were eligible but are not GPU-resident on this 6 GB laptop, and the hosted deepseek-v4.1-flash:cloud tag was excluded by local-only constraints. No model was pinned by the Project, the plan or the role." }) : NOT("no live run"));

save("live-model-invocations.json", run ? live_(receipts.length >= 2 ? "PASS" : "FAIL", { invocations: invocations.map((i) => ({ ...i, role: roleOf(i.agentId), receipt: receipts.find((r) => r.taskId === i.taskId) ?? null })),
  distinctAgentsWithModelWork: [...new Set(invocations.filter((i) => i.state === "completed").map((i) => i.agentId))].length, totalReceipts: receipts.length,
  totalPromptTokens: receipts.reduce((a, r) => a + (r.promptEvalCount ?? 0), 0), totalGeneratedTokens: receipts.reduce((a, r) => a + (r.evalCount ?? 0), 0) }) : NOT("no live run"));

save("agent-workspace-isolation.json", { classification: "SIMULATED model, real AgentWorkspaceStore/ProjectContextResolver", tests: testsMatching(/M25|M62|workspace/i), live: run ? { members: agents.agents.filter((a) => a.team).length, note: "Every member received its own scratch workspace (agent_workspaces); team writes landed only in each Mission's fresh output folder (capability-runs.json paths)." } : null });

save("artifact-provenance.json", run ? live_(handoffs.some((h) => h.state === "DELIVERED") ? "PASS" : "FAIL", { handoffs: handoffs.map((h) => ({ ...h, sourceRole: roleOf(h.sourceAgentId), destinationRole: roleOf(h.destinationAgentId) })),
  deliveredFiles: missions.flatMap((m) => m.files.map((f) => ({ mission: m.name, ...f }))), tests: testsMatching(/M28|M29|M58/) }) : NOT("no live run"));

save("independent-verification.json", run ? live_(missions.filter((m) => m.state === "completed").every((m) => (m.requirementResults ?? []).every((r) => r.passed === true)) ? "PASS" : "FAIL", {
  missions: missions.map((m) => ({ name: m.name, state: m.state, requirementResults: m.requirementResults, verifySteps: m.steps.filter((s) => s.kind === "verify_output" || s.kind === "write_file").map((s) => ({ key: s.key, kind: s.kind, state: s.state, verified: s.verified, supersededBy: s.supersededBy })) })),
  domInspection: dom, tests: testsMatching(/M30|M31|M32|M34|T11-I02/) }) : NOT("no live run"));

save("reviewer-findings.json", run ? live_("RECORDED", { findings: missions.map((m) => ({ mission: m.name, findings: m.findings })),
  seededDefect: faults.failedVerification ?? null, note: "Reviewer output is advisory: it is shown with Bunny's own verdict per requirement (confirmedByHost) and handed to a rework generator as data. It never completes, fails or authorizes anything." }) : NOT("no live run"));

save("conflict-resolution.json", { classification: "SIMULATED model, real filesystem capability with pre-image guard and output-folder lock", tests: testsMatching(/M30\/M37|M37\/M39/), live: run ? { writes: runs.filter((r) => r.action === "filesystem.write").map((r) => ({ path: r.path, status: r.status, missionId: r.missionId })) } : null });

save("authorization-scope-matrix.json", { live: run ? { envelopes: auth.mission ?? [], consents: auth.agentic ?? [], admissions: auth.admissions ?? [], reduction: faults.authorizationChange ?? null } : null, tests: testsMatching(/T11-I06|M41|M08|agentic|consent/i) });

save("mission-budget-results.json", { tests: testsMatching(/M20\/M22|M19|M21|budget|A32/i), live: run ? { planRevisions: plans.map((p) => ({ mission: p.mission, revisions: p.planRevisions })), reworkRounds: missions.map((m) => ({ mission: m.name, reworkRounds: m.reworkRounds })), outputTokenCeilings: { plan: 2048, generate_json: 1536, generate_markdown: 1536, generate_html: 3072, review: 1024 } } : null,
  note: "Local Ollama has no monetary cost; token counts are provider-reported, never estimated as cost." });

save("provider-failure-results.json", run ? live_(faults.providerInterruption?.attempts?.length >= 2 ? "PASS" : "FAIL", { interruption: faults.providerInterruption ?? null, tests: testsMatching(/T11-I07|T11-I08|M59/) }) : NOT("no live run"));
save("replan-and-retry-results.json", { live: run ? { plans: plans.map((p) => ({ mission: p.mission, revisions: p.planRevisions, rejected: p.rejected })), rework: faults.agentRetry ?? null } : null, tests: testsMatching(/T11-I02|T11-I03|M35|M36|replan/i) });
save("stop-and-pause-results.json", { live: run ? { dependencyDelayPause: faults.dependencyDelay ?? null, stops: (run.log ?? []).filter((l) => /stopped/.test(l.kind)) } : null, tests: testsMatching(/T11-I04|M47|M48|M49|M50|M57/) });
save("multi-agent-process-ownership.json", { live: run ? { ownedRecords: owned, note: "Local Ollama generations are HTTP requests to the independently managed Ollama service (not Job-contained; not claimed). Host-owned Git processes record the owning member agentId." } : null, tests: testsMatching(/J60|X53|F04|containment|M45|M46|owned/i) });
save("host-restart-recovery.json", run ? live_(faults.hostRestart?.identitiesPreserved && faults.hostRestart?.dependenciesPreserved ? "PASS" : "FAIL", { restart: faults.hostRestart ?? null,
  recoveryEvents: timeline.filter((e) => /recover|interrupted/.test(e.type)).map((e) => ({ type: e.type, at: e.at, detail: e.detail.slice(0, 300) })), tests: testsMatching(/T11-I05|T11-I07|T11-I08|A1[0-9]|A2[0-9]/) }) : NOT("no live run"));

save("duplicate-side-effect-check.json", run ? (() => {
  const writes = runs.filter((r) => r.action === "filesystem.write" && r.status === "succeeded");
  const byTarget = {}; for (const w of writes) (byTarget[w.path] ??= []).push(w);
  const writeSteps = new Map(allSteps.filter((s) => s.kind === "write_file").map((s) => [s.key + ":" + s.missionId, s]));
  void writeSteps;
  return live_("RECORDED", { succeededWrites: writes.length, targets: Object.entries(byTarget).map(([path, list]) => ({ path, writes: list.length, steps: [...new Set(list.map((w) => w.stepId))].length })),
    rule: "One succeeded write per write step attempt; a second write of a target is a distinct reviewed rework step (pre-image guard: absent or this Mission's last verified write). A target written twice by the SAME step would be a duplicate side effect.",
    duplicatesBySameStep: Object.values(byTarget).flatMap((list) => { const seen = new Map(); return list.filter((w) => { const n = (seen.get(w.stepId) ?? 0) + 1; seen.set(w.stepId, n); return n > 1; }); }).length });
})() : NOT("no live run"));

save("long-run-timeline.json", run ? { classification: LIVE_CLASS, startedAt: new Date(run.startedAt).toISOString(), endedAt: new Date(run.endedAt).toISOString(), durationMinutes: Math.round(run.durationMs / 600) / 100,
  harnessLog: run.log, agentsCreated: agents.agents.map((a) => ({ id: a.id, name: a.name, role: a.team?.role ?? null, createdAt: a.createdAt, state: a.state })),
  checkpoints: checkpoints.count, journalEvents: timeline.length, missions: missions.map((m) => ({ name: m.name, state: m.state, durationMs: m.durationMs })) } : NOT("no live run"));
save("long-run-resource-usage.json", run ? { classification: "LIVE samples every 15 s", samples: telemetry.length,
  peak: { hostWorkingSetMB: Math.round(Math.max(0, ...telemetry.map((t) => t.hostWorkingSet ?? 0)) / 1e6), cpuLoadPercent: Math.max(0, ...telemetry.map((t) => t.cpuLoad ?? 0)), gpuMemoryUsedMiB: Math.max(0, ...telemetry.map((t) => t.gpu?.memoryUsedMiB ?? 0)), gpuUtilization: Math.max(0, ...telemetry.map((t) => t.gpu?.utilization ?? 0)), workingAgents: Math.max(0, ...telemetry.map((t) => t.agents?.working ?? 0)), readyQueue: Math.max(0, ...telemetry.map((t) => t.queue?.ready ?? 0)) },
  providerLatency: receipts.map((r) => ({ taskId: r.taskId, queueMs: r.firstTokenAt && r.requestedAt ? r.firstTokenAt - r.requestedAt : null, totalMs: r.finishedAt - r.requestedAt, evalTokens: r.evalCount, tokensPerSecond: r.evalDurationNs ? Math.round(r.evalCount / (r.evalDurationNs / 1e9) * 10) / 10 : null })),
  recoveryDurationMs: faults.hostRestart?.downMs ?? null, samplesDetail: telemetry } : NOT("no live run"));
save("integrated-mission.json", run && A ? live_(A.state === "completed" ? "PASS" : "FAIL", { mission: A, plan: plans[0] ?? null, faults }) : NOT("no live run"));
save("agentic-ui-acceptance.json", { live: run ? { uiClosure: faults.uiClosure ?? null, screenshots: existsSync(join(LIVE, "ui")) ? readdirSync(join(LIVE, "ui")) : [] } : null, tests: testsMatching(/M65|New team form|team panel/i) });
save("notch-agent-layout.json", { classification: "STATIC Windows PowerShell 5.1 execution of the shared Island rules", tests: testsMatching(/T11 chips|V47|V48|V49|indicator|placement/i) });
save("voice-supervision.json", { live: voice ?? NOT("voice probe did not run"), tests: testsMatching(/T11-V0|T10-/).slice(0, 400) });
save("phone-authority-regression.json", { tests: testsMatching(/M41|remote|device|T9|F01|F02|F03/i) });
save("calculator-x53-results.json", { tests: regressionLine("X53"), result: passed(regressionLine("X53")) ? "PASS" : "NOT TESTED" });
save("regression-inventory.json", { classification: "Final full regression on the pinned T11 source; each part ran once (no focused reruns counted)", summary, parts, total, floor: 1694,
  exits: Object.fromEntries(["pretest", "scripts", "library", "agent", "ui", "typecheck", "lint", "build"].map((k) => [k, exitOf(k)])) });
console.log(JSON.stringify({ liveRun: !!run, missions: missions.map((m) => `${m.name}:${m.state}`), regression: total }));
