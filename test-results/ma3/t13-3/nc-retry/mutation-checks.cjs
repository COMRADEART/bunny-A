// M-A-3 T13.3 N-C mutation checks: each mutation removes or weakens one part of the write-safety retry boundary and must
// make its targeted test fail. Files are restored after every run.
// Run from the repository root: node test-results/ma3/t13-3/nc-retry/mutation-checks.cjs <out.json> [ids,comma,separated]
const fs = require("fs");
const { spawnSync } = require("child_process");
const H = "src/lib/bunny-host/";
const M = "src/lib/bunny-missions/";
const t3 = H + "t3-manager.test.ts";
const sched = M + "scheduler.test.ts";
const mutations = [
  { id: "NC-M1", what: "unscoped work is treated as read (only declared write is protected)", file: H + "manager.server.ts",
    from: 'const writeWork = current.executionScope?.access !== "read" &&', to: 'const writeWork = current.executionScope?.access === "write" &&', test: t3 },
  { id: "NC-M2", what: "every attempt counts as pre-dispatch (a connection failure taken as proof nothing landed)", file: H + "manager.server.ts",
    from: "const mayHaveStarted = result.dispatched !== false;", to: "const mayHaveStarted = false;", test: t3 },
  { id: "NC-M3", what: "write work with an uncertain outcome is retried (same candidate or rerouted)", file: H + "manager.server.ts",
    from: "if (uncertain) exhaustNow(uncertain);\n            else if", to: "if (false) exhaustNow(uncertain);\n            else if", test: t3 },
  { id: "NC-M4", what: "pre-dispatch retries of write work are unbounded", file: H + "manager.server.ts",
    from: "preDispatchRetries++ >= 1", to: "preDispatchRetries++ >= 99", test: t3 },
  { id: "NC-M5", what: "the uncertain outcome is not recorded on the failed task", file: H + "manager.server.ts",
    from: '...(state !== "completed" && uncertain ? { reconciliation: { required: true, reason: uncertain, at: Date.now() } } : {}),', to: "", test: t3 },
  { id: "NC-M6", what: "a Host restart does not mark an interrupted write task uncertain", file: H + "manager.server.ts",
    from: '...(task.executionScope?.access !== "read" && ADAPTER_TOOL_CONTRACTS[task.provider] !== false\n              ? { dispatch:', to: '...(false\n              ? { dispatch:', test: t3 },
  { id: "NC-M7", what: "the linked retry is not pinned to the original provider", file: H + "manager.server.ts",
    from: "override: task.provider, modelOverride:", to: 'override: "auto", modelOverride:', test: t3 },
  { id: "NC-M8", what: "the adapter certifies dispatched:false on a refused authority check no more (fail-closed regression of the pre-dispatch path)", file: H + "adapters.server.ts",
    from: 'error:"Provider dispatch refused: connection authority changed or could not be freshly verified.",dispatched:false});', to: 'error:"Provider dispatch refused: connection authority changed or could not be freshly verified."});', test: H + "failure.test.ts" },
  { id: "NC-M9", what: "a spawn error after the process started is certified as pre-dispatch", file: H + "adapters.server.ts",
    from: "...(spawned ? {} : { dispatched: false as const })", to: "dispatched: false as const", test: H + "failure.test.ts" },
  { id: "NC-M10", what: "the Mission ignores the child task's uncertain outcome", file: M + "manager.server.ts",
    from: "task.reconciliation?.required ? task.reconciliation.reason : null,", to: "null,", test: sched },
  { id: "NC-M11", what: "an uncertain step still gets the automatic retry verdict", file: M + "manager.server.ts",
    from: "const verdict = uncertain\n      ? { retry: false, reroute: false, waitForUser: true,", to: "const verdict = false\n      ? { retry: false, reroute: false, waitForUser: true,", test: sched },
  { id: "NC-M12", what: "mission.retry replays an unreconciled uncertain step", file: M + "manager.server.ts",
    from: "    if (unreconciled.length)\n      throw new CommandRefusedError(`OUTCOME_UNCERTAIN:", to: "    if (false)\n      throw new CommandRefusedError(`OUTCOME_UNCERTAIN:", test: sched },
  { id: "NC-M13", what: "a paired device may reconcile (mission.reconcile added to REMOTE)", file: M + "commands.server.ts",
    from: 'const REMOTE = new Set(["mission.approve",', to: 'const REMOTE = new Set(["mission.reconcile", "mission.approve",', test: sched },
  { id: "NC-M14", what: "a claim of idempotency on the step is honoured", file: M + "machine.ts",
    from: 'return action === "filesystem.write" && typeof params.expectBeforeSha256 === "string";', to: 'return params.idempotent === true || (action === "filesystem.write" && typeof params.expectBeforeSha256 === "string");', test: sched },
  { id: "NC-M15", what: "the bus does not mark a run that threw after starting as uncertain", file: M + "capabilities/bus.server.ts",
    from: 'errorCategory: timedOut ? "timeout" : "capability_failed", ...(started ? { uncertain: true as const } : {}) };', to: 'errorCategory: timedOut ? "timeout" : "capability_failed" };', test: sched },
  { id: "NC-M16", what: "the guarded write writes again instead of detecting the landed write", file: M + "capabilities/local.server.ts",
    from: "        if (current === sha256(content))\n", to: "        if (false)\n", test: sched },
  { id: "NC-M17", what: "a Host restart does not mark an interrupted write-capable Mission step uncertain", file: M + "manager.server.ts",
    from: "...(mayHaveWritten ? { reconciliation:", to: "...(false ? { reconciliation:", test: H + "workers-host.test.ts" },
  { id: "NC-M18", what: "the owner sees plain failure instead of the uncertain state", file: H + "presentation.ts",
    from: "label: task.reconciliation?.required ? UNCERTAIN_LABEL : taskInterrupted(task)", to: "label: taskInterrupted(task)", test: H + "presentation.test.ts" },
  // Round 2 (after the independent review): each review fix is pinned by a mutation of its own.
  { id: "NC-M19", what: "review F4: a direct write task that failed verification is re-executed again (carve-out restored)", file: H + "manager.server.ts",
    from: "if (writeWork && mayHaveStarted) uncertain = writePause(taxonomy);", to: 'if (writeWork && mayHaveStarted && taxonomy !== "VERIFICATION_FAILED") uncertain = writePause(taxonomy);', test: t3, pattern: "review F4" },
  { id: "NC-M20", what: "review F1: a started capability that returns an ordinary failure is not marked uncertain", file: M + "capabilities/bus.server.ts",
    from: "if (started && !result.ok && !result.noEffect &&", to: "if (false && !result.ok && !result.noEffect &&", test: sched, pattern: "review F1" },
  { id: "NC-M21", what: "review F3: an adapter's certified no-effect refusal is treated as uncertain", file: M + "capabilities/bus.server.ts",
    from: "if (started && !result.ok && !result.noEffect &&", to: "if (started && !result.ok &&", test: sched, pattern: "review F1" },
  { id: "NC-M22", what: "review F2/F9: a Host fault or stop outside the attempt loop leaves launched write work settled", file: H + "manager.server.ts",
    from: '(patch.state === "stopped" || patch.state === "failed") &&', to: "false &&", test: t3, pattern: "review F2" },
  { id: "NC-M23", what: "review F9: the attempt loop records a stopped launched write as settled", file: H + "manager.server.ts",
    from: 'if (state === "stopped" && writeWork && mayHaveStarted) uncertain = STOP_WRITE_PAUSE;', to: "", test: t3, pattern: "review F2|N-C 10" },
  { id: "NC-M24", what: "review F7: a reconcile retry starts beside a process of the original that may be alive", file: H + "manager.server.ts",
    from: 'if (resolution === "retry" && survivor)', to: "if (false)", test: t3, pattern: "review F7" },
  { id: "NC-M25", what: "review F11: a tool-free provider's failure is treated as an uncertain write", file: H + "manager.server.ts",
    from: 'const writeWork = current.executionScope?.access !== "read" && ADAPTER_TOOL_CONTRACTS[current.provider] !== false;', to: 'const writeWork = current.executionScope?.access !== "read";', test: t3, pattern: "review F11" },
  { id: "NC-M26", what: "review F4 (Mission): a write step that failed verification is repaired automatically", file: M + "manager.server.ts",
    from: 'this.writeCapable(step) ? "VERIFY_PAUSE:', to: 'false ? "VERIFY_PAUSE:', test: M + "missions.test.ts", pattern: "bounded repair attempt" },
  { id: "NC-M27", what: "review F5: a write running under a one-time approval at restart is not marked uncertain", file: M + "manager.server.ts",
    from: '...(["running", "verifying"].includes(step.state) && this.writeCapable(step)', to: "...(false", test: M + "remote-authority.test.ts", pattern: "review F5" },
  { id: "NC-M28", what: "review F6/F13: restart recovery resubmits an uncertain step", file: M + "manager.server.ts",
    from: "if (step.reconciliation?.required) { results.push({ stepId: instruction.stepId,", to: "if (false) { results.push({ stepId: instruction.stepId,", test: M + "remote-authority.test.ts", pattern: "review F5" },
  { id: "NC-M29", what: "replan discards an uncertain outcome", file: M + "manager.server.ts",
    from: "    if (uncertain.length)\n      throw new CommandRefusedError(`OUTCOME_UNCERTAIN:", to: "    if (false)\n      throw new CommandRefusedError(`OUTCOME_UNCERTAIN:", test: sched, pattern: "review F12" },
  { id: "NC-M30", what: "review F12: a refused reconcile leaves the step marked as resolved", file: M + "manager.server.ts",
    from: "this.setStep(this.store.step(stepId), { reconciliation: before });", to: "", test: sched, pattern: "review F12" },
  { id: "NC-M31", what: "a proven pre-dispatch failure of write work follows the normal planner (reroutes / retries unbounded)", file: H + "manager.server.ts",
    from: "if (writeWork && !mayHaveStarted)\n", to: "if (false)\n", test: t3, pattern: "N-C 6" },
  // Round 3 (after the confirmation pass N1-N8): each repair is pinned by a mutation of its own.
  { id: "NC-M32", what: "round 2 N1: a failed skill is judged by its last run only", file: M + "manager.server.ts",
    from: "uncertain: run.ok ? null : uncertainSkillRuns([...run.runs, ...(run.cleanupRuns ?? [])]),", to: "uncertain: run.ok ? null : uncertainRun(run.runs.at(-1) ?? null),", test: sched, pattern: "round 2 N1" },
  { id: "NC-M33", what: "round 2 N1: a write that succeeded earlier in a failed skill is not counted", file: M + "machine.ts",
    from: 'if (run?.status === "succeeded" && run.risk !== "READ"', to: 'if (false && run.risk !== "READ"', test: sched, pattern: "round 2 N1" },
  { id: "NC-M34", what: "round 2 N4: a synchronous launch failure is recorded as may-have-started", file: H + "manager.server.ts",
    from: '          dispatch: "not_started",\n', to: "", test: t3, pattern: "round 2 N4" },
  { id: "NC-M35", what: "round 2 N6: a Mission model step on a tool-free provider counts as write-capable", file: M + "manager.server.ts",
    from: "if (step.taskId && ADAPTER_TOOL_CONTRACTS[this.tasks.db.get(step.taskId).provider] === false) return false;", to: "", test: sched, pattern: "round 2 N6" },
  { id: "NC-M36", what: "round 2 N2/N3: a guarded team write counts as an unguarded write", file: M + "manager.server.ts",
    from: 'if (step.team?.kind === "write_file") return false;', to: "", test: sched, pattern: "round 2 N6" },
  { id: "NC-M37", what: "round 2 N8: a failed Bunny-A check is labelled a verified terminal outcome", file: H + "manager.server.ts",
    from: 'state === "completed" ? "verified_terminal"', to: 'verification ? "verified_terminal"', test: t3, pattern: "review F4" },
  { id: "NC-M38", what: "round 2 F7: an unreadable provider-session record does not hold a reconcile retry", file: H + "manager.server.ts",
    from: ' || key.startsWith("unreadable:")', to: "", test: t3, pattern: "review F7" },
  // Round 4 (after the second confirmation pass P1, P2 and the Mission F7 note).
  { id: "NC-M39", what: "round 3 P1: a skill runs its steps before settling a later step's permission", file: M + "skills.server.ts",
    from: "if (ask) return { ...base, runs: [], outputs,", to: "if (false) return { ...base, runs: [], outputs,", test: sched, pattern: "round 3" },
  { id: "NC-M40", what: "round 3 P2: a failing skill's cleanup runs are not counted", file: M + "skills.server.ts",
    from: "if (done?.run) cleanupRuns.push(done.run);", to: "", test: sched, pattern: "round 3" },
  { id: "NC-M41", what: "round 3 F7: a Mission reconcile retry ignores an unreadable provider-session record", file: M + "manager.server.ts",
    from: 'key.startsWith("unreadable:") || children.some(', to: 'false || children.some(', test: sched, pattern: "review F12" },
  // Round 5 (after the third confirmation pass).
  { id: "NC-M42", what: "round 4: a Mission reconcile retry ignores a live process of the uncertain child task", file: M + "manager.server.ts",
    from: "children.some((child) => key.startsWith(`${child}#`)) || ", to: "", test: sched, pattern: "review F12" },
  { id: "NC-M43", what: "round 4 Q2: a throw after an earlier write landed is retried as an ordinary failure", file: M + "manager.server.ts",
    from: "uncertainSkillRuns(this.store.runs({ missionId, stepId, limit: 500 }).filter(", to: "null && uncertainSkillRuns(this.store.runs({ missionId, stepId, limit: 500 }).filter(", test: sched, pattern: "round 4" },
  // Round 6 (after the fourth confirmation pass).
  { id: "NC-M44", what: "round 5: a delegated launch that threw after the child started is rerouted beside it", file: M + "manager.server.ts",
    from: "started && this.writeCapable(running) ?", to: "false ?", test: sched, pattern: "round 5" },
  { id: "NC-M45", what: "round 5: a Mission reconcile retry starts while a child task of the step is still running", file: M + "manager.server.ts",
    from: "if (unfinished || [", to: "if ([", test: sched, pattern: "round 5" },
  { id: "NC-M46", what: "post-confirmation narrowing: a child that never launched blocks the owner's reconcile retry", file: M + "manager.server.ts",
    from: "return CHILD_LAUNCHED.includes(this.tasks.db.get(child).state);", to: 'return !["completed", "failed", "stopped"].includes(this.tasks.db.get(child).state);', test: sched, pattern: "review F12" },
  { id: "NC-M47", what: "final check: a stale child of an uncertain step launches on a direct approve", file: M + "manager.server.ts",
    from: "if (owner.reconciliation?.required)\n        return", to: "if (false)\n        return", test: sched, pattern: "review F12" },
  { id: "NC-M48", what: "final check: a child from an earlier attempt launches beside a later one", file: M + "manager.server.ts",
    from: "AND rowid>(SELECT rowid FROM tasks WHERE id=?) LIMIT 1\").get(task.id, owner.id, task.id))", to: "AND 0 LIMIT 1\").get(task.id, owner.id))", test: sched, pattern: "final check" },
  { id: "NC-M49", what: "final check: re-arming a failed step leaves its never-launched children approvable", file: M + "manager.server.ts",
    from: 'if (step.state === "failed" && next.state === "ready")', to: "if (false)", test: sched, pattern: "final check" },
  { id: "NC-M50", what: "final check: the newest child is judged by clock time (same-millisecond siblings both launch)", file: M + "manager.server.ts",
    from: "AND rowid>(SELECT rowid FROM tasks WHERE id=?) LIMIT 1\").get(task.id, owner.id, task.id))", to: "AND json_extract(record,'$.createdAt')>(SELECT json_extract(record,'$.createdAt') FROM tasks WHERE id=?) LIMIT 1\").get(task.id, owner.id, task.id))", test: sched, pattern: "final check" },
  { id: "NC-M51", what: "package e2e finding: a skill's preflight ask is not recorded as authorization.required", file: M + "capabilities/bus.server.ts",
    from: "    this.emit(\"authorization.required\", `${request.action}: ${decision.reason}`, request.missionId);\n    return decision;", to: "    return decision;", test: sched, pattern: "round 3" },
];
// Windows can briefly refuse a write while another process (indexer, antivirus) holds the file; retry before failing.
const write = (file, text) => {
  for (let i = 0; ; i++) {
    try { return fs.writeFileSync(file, text); } catch (error) { if (i >= 20) throw error; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250); }
  }
};
const only = process.argv[3] ? process.argv[3].split(",") : null;
const results = [];
for (const m of mutations.filter((item) => !only || only.includes(item.id))) {
  const original = fs.readFileSync(m.file, "utf8");
  // Multi-line anchors follow the file's own line endings (git may check files out with CRLF on Windows).
  const eol = original.includes("\r\n") ? "\r\n" : "\n";
  const from = m.from.replace(/\n/g, eol);
  if (!original.includes(from)) { results.push({ id: m.id, what: m.what, applied: false, killed: null }); continue; }
  write(m.file, original.replace(from, m.to.replace(/\n/g, eol)));
  try {
    const args = ["--experimental-strip-types", "--test", "--test-concurrency=1", "--test-timeout=120000", ...(m.pattern ? [`--test-name-pattern=${m.pattern}`] : []), m.test];
    const run = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 900000 });
    const out = `${run.stdout}${run.stderr}`;
    const failing = [...out.matchAll(/^✖ (.+?) \(\d/gm)].map((match) => match[1]).filter((name, index, all) => all.indexOf(name) === index && name !== "failing tests:");
    results.push({ id: m.id, what: m.what, file: m.file, test: m.test, pattern: m.pattern ?? null, applied: true, exit: run.status, killed: run.status !== 0, failing: failing.slice(0, 4) });
  } finally {
    write(m.file, original);
  }
}
for (const r of results) console.log(`${r.id}\t${r.applied ? (r.killed ? "KILLED" : "SURVIVED") : "NOT APPLIED"}\t${r.what}${r.failing ? `\t← ${r.failing.join(" | ")}` : ""}`);
fs.writeFileSync(process.argv[2], JSON.stringify(results, null, 2));
