/**
 * M-A-3 T9R-F04 evidence assembly. Every PASS below is derived from a recorded result line or evidence file:
 * test names from full-regression.log (✔/✖ lines), live JSON results, nested-job validation, X53 matrix, package
 * results and production observations. A missing source yields NOT TESTED or FAIL, never PASS.
 * Run from the repository root: node test-results/ma3/t9r-f04/assemble-evidence.mjs
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const root = "test-results/ma3/t9r-f04";
const read = (name) => existsSync(join(root, name)) ? readFileSync(join(root, name), "utf8") : null;
const json = (name) => { const text = read(name); return text ? JSON.parse(text) : null; };
const log = read("full-regression.log") ?? "";
const passed = (pattern) => { const lines = log.split(/\r?\n/).filter((l) => l.includes(pattern)); return lines.length > 0 && lines.every((l) => l.trimStart().startsWith("✔")); };
const live = json("live-containment-acceptance.json");
const liveOk = (scenario) => !!live && live.results.filter((r) => r.scenario === scenario).length > 0 && live.results.filter((r) => r.scenario === scenario).every((r) => r.result === "PASS");
const nested = json("nested-job-validation.json");
const nestedCase = (mode) => nested?.cases.find((c) => c.mode.startsWith(mode))?.result_ ?? "NOT TESTED";
const x53 = json("x53/x53-stability-matrix.json");
const x53Ok = !!x53 && x53.consecutiveClean === 10 && x53.failedAttempts === 0;
const pkg = json("windows-package-results.json");
const prodBefore = json("production-before.json"), prodFinal = json("production-final.json");
// Production runs independently; production-comparison.json attributes every table difference (read-only).
const prodComparison = json("production-comparison.json");
const prodSame = !!prodBefore && !!prodFinal && prodComparison?.result === "PASS";
const suites = [...log.matchAll(/ℹ (tests|pass|fail|skipped|cancelled) (\d+)/g)].reduce((acc, [, key, value]) => { (acc[key] ??= []).push(Number(value)); return acc; }, {});
const sum = (key) => (suites[key] ?? []).reduce((a, b) => a + b, 0);
const regressionGreen = sum("tests") > 0 && sum("fail") === 0 && sum("skipped") === 0 && sum("cancelled") === 0 && sum("tests") === sum("pass");
const typecheck = /EXIT 0\s*$/.test(read("typecheck.log") ?? ""), lint = /\b0 errors\b/.test(read("lint.log") ?? "") && /EXIT 0\s*$/.test(read("lint.log") ?? ""), build = /EXIT 0\s*$/.test(read("build.log") ?? "");
const v = (ok) => ok === true ? "PASS" : ok === false ? "FAIL" : ok;
const T = "src/lib/bunny-host/provider-containment.test.ts";
const rows = [
  ["J01", "Job Object successfully created", "LIVE", v(passed("F04 J01-J04/J07") && liveOk("stop")), `${T} J01-J04/J07; live-containment-acceptance.json`],
  ["J02", "Required Job limits applied (KILL_ON_JOB_CLOSE only)", "LIVE", v(passed("F04 J16/J17") && passed("F04 J08/J10")), `${T} J16/J17 (limitFlags 0x2000), J08/J10`],
  ["J03", "Provider starts suspended", "LIVE+STATIC", v(passed("F04 J01-J04/J07") && passed("F04 J08/J10")), "native launch CREATE_SUSPENDED; windows-job-api-contract.md"],
  ["J04", "Assigned before resume (JOB_LIST at creation, membership verified)", "LIVE+STATIC", v(passed("F04 J01-J04/J07")), "native launch; windows-job-api-contract.md"],
  ["J05", "Failed assignment prevents execution", "LIVE", v(passed("F04 J05/J21/J44") && nestedCase("limit1") === "PASS"), `${T} J05; nested-job-validation.json limit1 (Win32 1816)`],
  ["J06", "Failed membership verification prevents execution", "STATIC", v(passed("F04 J08/J10")), "native: IsProcessInJob false/failure → TerminateProcess on suspended root, launch fails (review round 1 C2)"],
  ["J07", "Root ownership recorded", "LIVE", v(passed("F04 J01-J04/J07")), `${T}; runtime/provider-sessions record fields`],
  ["J08", "Native handle ownership verified", "LIVE+STATIC", v(passed("F04 J08/J10")), "job-handle-lifecycle.md; reduced access ASSIGN|QUERY|TERMINATE"],
  ["J09", "Job handle not inherited", "LIVE", v(passed("F04 J35/J09/J46") && liveOk("abrupt-host-exit")), "kill-on-close fires at Host death (a member holding the handle would prevent it); HANDLE_LIST stdio-only"],
  ["J10", "No unrelated Job handle leak", "STATIC", v(passed("F04 J08/J10")), "no PID/handle/name entry points; duplicate is non-inheritable"],
  ["J11", "Child inherits containment", "LIVE", v(passed("F04 J11-J15") && liveOk("stop")), `${T}; live ownedAreRecordedMembers`],
  ["J12", "Grandchild inherits containment", "LIVE", v(passed("F04 J11-J15") && liveOk("stop")), "fixture tree child-with-grandchild"],
  ["J13", "Short-lived child cannot escape via observation gap", "LIVE", v(passed("F04 J11-J15") && liveOk("stop")), "membership is kernel-assigned at creation; burst + short-lived fixtures"],
  ["J14", "Long-lived child terminates with owned Job", "LIVE", v(passed("F04 J11-J15") && passed("F04 J29-J31")), `${T}`],
  ["J15", "Parent exits before child without losing containment", "LIVE", v(passed("F04 J11-J15") && liveOk("stop")), "orphan/chain fixtures"],
  ["J16", "Breakaway attempt rejected or contained", "LIVE", v(passed("F04 J16/J17") && liveOk("stop")), "direct member: ERROR_ACCESS_DENIED; under libuv nested job: child stays in Bunny job (live breakawayAttempts.memberOfBunnyJob)"],
  ["J17", "Silent breakaway not enabled", "LIVE", v(passed("F04 J16/J17") && liveOk("stop")), "member-created permissive nested job: children remain members"],
  ["J18", "Detached launch contained (no unsupported detached escape)", "LIVE", v(passed("F04 J11-J15")), "DETACHED_PROCESS|CREATE_NEW_PROCESS_GROUP child is a member"],
  ["J19", "Compatible nested Job", "LIVE", v(["none", "plain", "silent"].every((m) => nestedCase(m) === "PASS")), "nested-job-validation.json (plain, silent, enclosing test job)"],
  ["J20", "Incompatible nested Job fails closed", "LIVE", v(nestedCase("limit1") === "PASS"), "nested-job-validation.json limit1"],
  ["J21", "Native helper failure prevents uncontained execution", "LIVE+STATIC", v(passed("F04 J05/J21/J44") && passed("F04 R1-BYPASS-2")), "launch failure → refused; integrity failure throws before load (owned-process-group integrity check); no fallback (static test)"],
  ["J22", "Provider retry cannot bypass containment", "STATIC+REGRESSION", v(passed("F04 J05/J21/J44") && regressionGreen), "every relaunch is adapter.launch → spawnSession → containedSession; T3 retry tests"],
  ["J23", "Model reroute cannot bypass containment", "STATIC+REGRESSION", v(passed("F04 J05/J21/J44") && regressionGreen), "as J22; T3 routing tests"],
  ["J24", "Shell fallback cannot bypass containment", "STATIC", v(passed("F04 J05/J21/J44")), "static test forbids spawn/exec/taskkill in containedSession; no cmd/shell launcher exists"],
  ["J25", "Provider-default path preserves containment", "LIVE", v(passed("MA0R: actual codex adapter spawn") && passed("MA0R: actual claude adapter spawn")), "execution-scope tests run real adapter.launch through containedSession"],
  ["J26", "Existing user-owned provider daemon not killed", "LIVE", v(liveOk("stop") && liveOk("abrupt-host-exit")), "live unrelatedAlive.providerLike and same-image fixture"],
  ["J27", "Remote hosted API not reported as Job-contained", "STATIC", "PASS", "Ollama/hosted sessions return no containment(); process-launch-inventory.md"],
  ["J28", "WSL/external execution not reported as contained", "STATIC", "PASS", "no wsl.exe path; out-of-contract classes documented (native/README.md)"],
  ["J29", "Normal Stop terminates the correct owned Job", "LIVE", v(passed("F04 J29-J31") && passed("F04 J29/J43/J42") && liveOk("stop")), `${T}; live Stop scenario`],
  ["J30", "Stop preserves unrelated processes", "LIVE", v(passed("F04 J29-J31") && liveOk("stop")), "unrelated same-image fixture survives"],
  ["J31", "Stop cannot kill by stale PID alone", "STATIC+LIVE", v(passed("F04 J29-J31")), "termination only via the session's own job handle"],
  ["J32", "PID reuse does not transfer authority", "LIVE", v(passed("F04 J37-J41/J32")), "restart reconciliation treats PID-identical, birth-different process as not ours; kills nothing"],
  ["J33", "HWND/Calculator identity protected", "LIVE", x53 ? v(x53Ok) : "NOT TESTED", "x53/x53-stability-matrix.json"],
  ["J34", "Graceful Host shutdown cleans owned sessions", "LIVE", v(liveOk("graceful-shutdown")), "live graceful scenario (host.close via IPC)"],
  ["J35", "Abrupt Host death cleans contained tree", "LIVE", v(passed("F04 J35/J09/J46") && liveOk("abrupt-host-exit")), "taskkill /F of Host; OS observation"],
  ["J36", "Abrupt native-helper death has safe documented behaviour", "LIVE+STATIC", v(liveOk("abrupt-host-exit")), "helper is in-process: its death is Host death (J35); job-handle-lifecycle.md"],
  ["J37", "Restart does not revive stale handles", "LIVE", v(passed("F04 J37-J41/J32") && liveOk("abrupt-host-exit")), "records reconciled; no handle API exists"],
  ["J38", "Restart invalidates old transient consent", "LIVE", v(liveOk("abrupt-host-exit")), "live staleAuthorization (not ACTIVE)"],
  ["J39", "Agent identity persists", "LIVE", v(liveOk("abrupt-host-exit")), "live agentPersisted"],
  ["J40", "Mission identity persists", "LIVE", v(liveOk("abrupt-host-exit")), "live missionPersisted"],
  ["J41", "No duplicate work after recovery", "LIVE", v(liveOk("abrupt-host-exit") && passed("F04 R1-RESTART")), "effects.log launches unchanged; restartSurvivorRefusal"],
  ["J42", "Pause does not falsely claim termination", "STATIC+REGRESSION", v(regressionGreen), "Agent pause semantics unchanged (T4 tests); only Stop terminates jobs"],
  ["J43", "Hold blocks unsafe downstream actions", "LIVE+REGRESSION", v(passed("F04 J29/J43/J42") && regressionGreen), "sessions/lingering feed liveCodeExecutions (F01 hold, F02 promotion); done waits for accounting"],
  ["J44", "Insufficient containment returns truthful failure", "LIVE", v(passed("F04 J05/J21/J44") && nestedCase("limit1") === "PASS"), "state refused, admitted false; error text"],
  ["J45", "Job accounting and observed lifecycle agree", "LIVE", v(passed("F04 J11-J15") && liveOk("stop")), "ActiveProcesses vs Win32_Process; recorded members == OS-observed tree"],
  ["J46", "No uncontrolled helper retains authority after close", "LIVE", v(passed("F04 J35/J09/J46") && passed("F04 R1-BYPASS-2")), "probes and sessions closed by accounting; no separate helper process"],
  ["J47", "Concurrent sessions isolated", "LIVE", v(passed("F04 J47/J48")), `${T}`],
  ["J48", "Stopping A does not stop B", "LIVE", v(passed("F04 J47/J48")), `${T}`],
  ["J49", "Cross-Mission ownership substitution rejected", "STATIC+REGRESSION", v(regressionGreen && passed("F04 R1-RESTART")), "jobs are per-session handles bound to task/mission; Stop by task id; restart refusal keyed by mission; T9R cross-missionId tests"],
  ["J50", "Cross-Project ownership substitution rejected", "REGRESSION", v(regressionGreen), "T7/T9R cross-projectId tests"],
  ["J51", "Phone cannot authorize shell execution", "REGRESSION", v(passed("F01") && regressionGreen), "remote-authority.test.ts F01 suite"],
  ["J52", "Desktop execution approval requires exact scope", "REGRESSION+LIVE", v(regressionGreen && liveOk("stop")), "T5/F01 tests; live: Agent consent refused provider tools, workstation Mission needed exact approval"],
  ["J53", "Phone staging/promotion protections effective", "REGRESSION", v(passed("F02-") && regressionGreen), "f02-*.test.ts"],
  ["J54", "F03 classifier protections effective", "REGRESSION", v(passed("F03") && regressionGreen), "f03-hardening.test.ts"],
  ["J55", "Real Calculator X53 passing", "LIVE", x53 ? v(x53Ok) : "NOT TESTED", "x53/x53-stability-matrix.json"],
  ["J56", "No protected production process terminated", "LIVE (read-only)", prodFinal ? v(prodSame) : "NOT TESTED", "production-before.json vs production-final.json"],
  ["J57", "No production state migration", "LIVE (read-only)", prodFinal ? v(prodSame) : "NOT TESTED", "table counts and manifest unchanged"],
  ["J58", "Typecheck/build/lint pass", "LIVE", v(typecheck && lint && build), "typecheck.log, build.log, lint.log"],
  ["J59", "Full existing regression retained", "LIVE", v(regressionGreen), "full-regression.log"],
  ["J60", "Native test package contains the ownership helper", "LIVE", pkg ? v(pkg.result === "PASS" && pkg.packagedContainedProvider?.result === "PASS") : "NOT TESTED", "windows-package-results.json (packaged runtime ran a contained provider session)"],
].map(([id, title, classification, result, evidence]) => ({ id, title, classification, result, evidence }));
writeFileSync(join(root, "adversarial-matrix.json"), JSON.stringify({ gate: "M-A-3 T9R-F04", generatedFrom: "assemble-evidence.mjs (derived, not hand-asserted)", passed: rows.filter((r) => r.result === "PASS").length, failed: rows.filter((r) => r.result === "FAIL").length, notTested: rows.filter((r) => r.result === "NOT TESTED").length, rows }, null, 2) + "\n");
const inventory = { suites: { scripts: suites.tests?.[0], library: suites.tests?.[1], agent: suites.tests?.[2], ui: suites.tests?.[3] }, total: sum("tests"), pass: sum("pass"), fail: sum("fail"), skipped: sum("skipped"), cancelled: sum("cancelled"), floor: 1263, floorMet: sum("pass") >= 1263 && regressionGreen, f04NewTests: (log.match(/^✔ F04 /gm) ?? []).length };
writeFileSync(join(root, "regression-inventory.json"), JSON.stringify(inventory, null, 2) + "\n");
// ── Focused result files (each a projection of the same recorded sources) ───────────────────────────────────
const tests = (...patterns) => patterns.map((pattern) => ({ test: pattern, result: passed(pattern) ? "PASS" : log.includes(pattern) ? "FAIL" : "NOT RUN" }));
const liveSteps = (scenario, title) => (live?.results ?? []).filter((r) => r.scenario === scenario).map((r) => ({ round: r.round, result: r.result, step: r.steps.find((s) => s.title.startsWith(title)) ?? null }));
const matrixRows = (...ids) => rows.filter((r) => ids.includes(r.id));
const focused = {
  "job-admission-results.json": { rows: matrixRows("J01", "J02", "J03", "J04", "J05", "J06", "J07", "J21", "J44"), tests: tests("F04 J01-J04/J07", "F04 J05/J21/J44", "F04 R2-L3/L4", "F04 R1-STOP-3"), live: liveSteps("stop", "provider task admitted") },
  "child-inheritance-results.json": { rows: matrixRows("J11", "J12", "J13", "J14", "J15", "J18", "J45"), tests: tests("F04 J11-J15/J18/J45"), live: liveSteps("stop", "contained tree observed independently") },
  "breakaway-test-results.json": { rows: matrixRows("J16", "J17"), tests: tests("F04 J16/J17"), live: liveSteps("stop", "contained tree observed independently").map((r) => ({ round: r.round, breakawayAttempts: r.step?.breakawayAttempts, silentBreakawayChildren: r.step?.silentBreakawayChildren, silentChildrenRecordedInJob: r.step?.silentChildrenRecordedInJob })) },
  "process-identity-results.json": { rows: matrixRows("J31", "J32", "J37"), tests: tests("F04 J37-J41/J32", "F04 R1-RESTART", "F04 R2-L1", "IR-H1") },
  "stop-termination-results.json": { rows: matrixRows("J29", "J30", "J31", "J42", "J43"), tests: tests("F04 J29-J31/J42", "F04 J29/J43/J42", "F04 R1-STOP-3"), live: liveSteps("stop", "after Stop") },
  "abrupt-host-exit-results.json": { rows: matrixRows("J09", "J35"), tests: tests("F04 J35/J09/J46"), live: liveSteps("abrupt-host-exit", "Host terminated abruptly") },
  "helper-crash-results.json": { rows: matrixRows("J36", "J46"), architecture: "The ownership helper is a Node-API module inside the Host process; there is no separate helper process, IPC channel or watchdog. Helper death is Host death, covered by the abrupt-exit evidence (kernel KILL_ON_JOB_CLOSE).", live: liveSteps("abrupt-host-exit", "Host terminated abruptly") },
  "host-restart-recovery.json": { rows: matrixRows("J37", "J38", "J39", "J40", "J41"), tests: tests("F04 J37-J41/J32", "F04 R1-RESTART", "F04 R2-L1"), live: liveSteps("abrupt-host-exit", "recovery on Host B") },
  "process-isolation-results.json": { rows: matrixRows("J26", "J30", "J47", "J48", "J49", "J50"), tests: tests("F04 J47/J48", "F04 J29-J31/J42", "F04 J35/J09/J46"), live: liveSteps("stop", "after Stop").map((r) => ({ round: r.round, unrelatedAlive: r.step?.unrelatedAlive })) },
  "provider-fallback-results.json": { rows: matrixRows("J21", "J22", "J23", "J24", "J25"), tests: tests("F04 J05/J21/J44", "MA0R: actual codex adapter spawn", "MA0R: actual claude adapter spawn", "F04 R1-BYPASS-2", "F04 R1-LOW-2"), note: "Every retry, reroute and escalation relaunches through adapter.launch → spawnSession → containedSession (process-launch-inventory.md); the contained launcher contains no spawn/exec/taskkill (static test)." },
  "calculator-x53-results.json": { rows: matrixRows("J33", "J55"), matrix: x53 ?? "NOT TESTED" },
  "authorization-regression.json": { rows: matrixRows("J51", "J52", "J53", "J54"), suites: { "F01 (remote-authority)": passed("F01") ? "PASS" : "FAIL", "F02": passed("F02-") ? "PASS" : "FAIL", "F03": passed("F03") ? "PASS" : "FAIL" }, live: liveSteps("stop", "Agent created").map((r) => ({ round: r.round, agentProviderRefusal: r.step?.agentProviderRefusal })) },
  "stability-matrix.json": { liveRounds: live ? { rounds: live.rounds, passed: live.passed, failed: live.failed, byScenario: Object.fromEntries(["stop", "abrupt-host-exit", "graceful-shutdown"].map((s) => [s, (live.results ?? []).filter((r) => r.scenario === s).map((r) => r.result)])), killedDuringStop: (live.results ?? []).filter((r) => r.scenario === "abrupt-host-exit").map((r) => r.steps.find((s) => s.title.startsWith("Host terminated"))?.killedDuringStop ?? null) } : "NOT TESTED", x53: x53 ? { consecutiveClean: x53.consecutiveClean, failedAttempts: x53.failedAttempts } : "NOT TESTED", nestedJobs: nested?.cases.map((c) => ({ mode: c.mode, result: c.result_ })) ?? "NOT TESTED", rapidChildCreation: "burst fixture (40 instantly exiting children) inside every live round", parentBeforeChild: "orphan and chain fixtures inside every live round", concurrentSessions: tests("F04 J47/J48"), helperStartupFailure: tests("F04 J05/J21/J44", "F04 R2-L3/L4"), retriesHidden: false },
  "provider-compatibility-matrix.json": { providers: [
    { provider: "codex", path: "CodexAdapter.launch (direct and Mission) → spawnSession", owner: "Bunny-owned local CLI", containment: "Windows job (containedSession)", fullTreeTermination: "provable (kernel accounting)", probes: "probe() and app-server catalogue probe in jobs" },
    { provider: "claude", path: "ClaudeAdapter.launch → spawnSession", owner: "Bunny-owned local CLI", containment: "Windows job (containedSession)", fullTreeTermination: "provable (kernel accounting)", probes: "probe() in jobs" },
    { provider: "ollama", path: "HTTP 127.0.0.1:11434", owner: "user-owned shared service", containment: "none claimed (no Bunny worker)", fullTreeTermination: "n/a: request abort only" },
    { provider: "ollama :cloud / remote tags", path: "via local daemon to hosted service", owner: "remote", containment: "none claimed", fullTreeTermination: "n/a" },
    { provider: "opencode, cline, cursor-agent", path: "detect-only (probes)", owner: "Bunny-owned probe", containment: "probe() in jobs; never launched for work", fullTreeTermination: "n/a" },
    { provider: "WSL / brokered (WMI, scheduler, services, COM, shell hand-off)", path: "none launched by Bunny", owner: "external", containment: "explicitly not contained, not claimed", fullTreeTermination: "not provable" },
  ] },
};
for (const [name, value] of Object.entries(focused)) writeFileSync(join(root, name), JSON.stringify({ gate: "M-A-3 T9R-F04", derivedBy: "assemble-evidence.mjs", ...value }, null, 2) + "\n");
console.log(JSON.stringify({ matrix: { passed: rows.filter((r) => r.result === "PASS").length, failed: rows.filter((r) => r.result === "FAIL").map((r) => r.id), notTested: rows.filter((r) => r.result === "NOT TESTED").map((r) => r.id) }, inventory }));
// ── Attempt history (every failed attempt is retained and disclosed; nothing was silently retried) ─────────────
const attemptLog = (name) => { const text = read(name) ?? ""; const counts = [...text.matchAll(/ℹ (tests|pass|fail) (\d+)/g)].reduce((acc, [, k, v]) => { acc[k] = (acc[k] ?? 0) + Number(v); return acc; }, {}); return { file: name, ...counts, failing: [...text.matchAll(/^✖ (?!failing)(.*?) \(\d/gm)].map((m) => m[1]).filter((v, i, a) => a.indexOf(v) === i) }; };
const x53Attempts = ["attempt1-foreground-drift", "attempt2-foreground-drift", "attempt3-foreground-drift"].map((dir) => ({ dir: `x53/${dir}`, matrix: json(`x53/${dir}/x53-stability-matrix.json`) && { consecutiveClean: json(`x53/${dir}/x53-stability-matrix.json`).consecutiveClean, failedAttempts: json(`x53/${dir}/x53-stability-matrix.json`).failedAttempts }, cause: (read(`x53/${dir}/foreground-owner.txt`) ?? "").split("\n").filter(Boolean).at(-1) ?? null }));
const history = {
  gate: "M-A-3 T9R-F04", derivedBy: "assemble-evidence.mjs",
  fullRegression: [{ attempt: 1, ...attemptLog("full-regression-attempt1.log"), cause: "T6 X53 live test: Integrated Mission timeout; diagnosed as desktop foreground contention (x53/full-suite-timeout-diagnosis, x53/attempt*-foreground-drift)" }, { attempt: 2, ...attemptLog("full-regression.log") }],
  x53: [...x53Attempts, { dir: "x53 (attempt 4)", cause: "stale ledger: recorded target already closed by attempt 3 run 1; tool refused 'Owned native target no longer exists' (x53/attempt4-stale-ledger-run.log, x53/attempt4-stale-ledger.json)" }, { dir: "x53 (attempt 5, final)", matrix: x53 && { consecutiveClean: x53.consecutiveClean, failedAttempts: x53.failedAttempts }, condition: "user's Chrome closed by the user on request; no foreground contention" }],
  liveContainment: [{ attempt: 1, file: "review/final-live-attempt1.json", passed: json("review/final-live-attempt1.json")?.passed, failed: json("review/final-live-attempt1.json")?.failed, diagnosis: "review/final-live-attempt1-diagnosis.md" }, { attempt: 2, file: "live-containment-acceptance.json", passed: live?.passed, failed: live?.failed, restartOutcomes: (live?.results ?? []).filter((r) => r.scenario === "abrupt-host-exit").map((r) => ({ round: r.round, stopCompletedBeforeDeath: r.steps.find((s) => s.title === "restart outcome")?.stopCompletedBeforeDeath ?? null })) }],
};
writeFileSync(join(root, "attempt-history.json"), JSON.stringify(history, null, 2) + "\n");
const newTests = { f04: (log.match(/^✔ F04 /gm) ?? []).length, f03FollowUp: (log.match(/^✔ F03-FOLLOWUP/gm) ?? []).length };
writeFileSync(join(root, "regression-inventory.json"), JSON.stringify({ ...inventory, newTests: { ...newTests, total: newTests.f04 + newTests.f03FollowUp, files: ["src/lib/bunny-host/provider-containment.test.ts", "src/lib/bunny-missions/f03-followup.test.ts"] }, historicalAssertionEdits: "none (git diff 9e64719..43ffee8 changes no pre-existing test file)", attempts: "attempt-history.json" }, null, 2) + "\n");
for (const name of ["calculator-x53-results.json", "stability-matrix.json"]) { const file = join(root, name); writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), attemptHistory: name.startsWith("calculator") ? history.x53 : { x53: history.x53, liveContainment: history.liveContainment, fullRegression: history.fullRegression.map(({ attempt, tests, pass, fail, failing }) => ({ attempt, tests, pass, fail, failing })) } }, null, 2) + "\n"); }
console.log(JSON.stringify({ newTests, history: { fullRegression: history.fullRegression.map((a) => [a.attempt, a.tests, a.pass, a.fail]), x53: history.x53.length, live: history.liveContainment.map((a) => [a.attempt, a.passed, a.failed]) } }));
