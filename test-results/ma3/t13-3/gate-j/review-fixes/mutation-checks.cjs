// Gate J repair mutation checks: each mutation re-introduces one review finding (or undoes one Gate I fix) and must make
// its targeted test fail. Files are restored after every run.
// Run from the repository root: node test-results/ma3/t13-3/gate-j/review-fixes/mutation-checks.cjs <out.json>
const fs = require("fs");
const { spawnSync } = require("child_process");
const H = "src/lib/bunny-host/";
const workers = H + "workers-host.test.ts";
const context = H + "personal-agent-context-host.test.ts";
const mutations = [
  // Gate I fixes, re-checked at this source.
  { id: "F1-M1", what: "worker Project memory appended to the child Mission objective again", file: H + "http.server.ts",
    from: "if (ability.kind === \"model\") return [{ ...step, objective, executor: { kind: \"model\" } }];",
    to: "if (ability.kind === \"model\") return [{ ...step, objective: `${objective}\n\nContext: ${workerStore.open().flatMap((w) => w.context).join(\"; \")}`, executor: { kind: \"model\" } }];", test: workers },
  { id: "F1-M2", what: "worker Project memory never reaches the model prompt", file: "src/lib/bunny-missions/manager.server.ts",
    from: "notes: this.missionPromptFacts?.(mission.id) ?? [],", to: "notes: [],", test: workers },
  { id: "F2-M1", what: "a paired device may approve, start, retry or answer a worker's child Mission", file: H + "http.server.ts",
    from: "if (target && workerStore.isWorkerMission(target)) throw", to: "if (false) throw", test: workers },
  { id: "F2-M2", what: "mission.respond is not mapped to its worker Mission", file: H + "http.server.ts",
    from: "? (() => { try { return missions.store.request(String(data.requestId ?? \"\")).missionId; } catch { return \"\"; } })()", to: "? \"\"", test: workers },
  { id: "F3-M1", what: "Studio save re-records every focused Agent's owner", file: H + "http.server.ts",
    from: "if (slot.agentId && slot.agentId !== boundBefore.get(slot.slot)) recordOwner", to: "if (slot.agentId) recordOwner", test: context },
  { id: "F3-M2", what: "assign leaves the old slot focused on the moved Agent", file: H + "http.server.ts",
    from: "if (config.slots.some((row) => row.slot !== slot && row.agentId === agentId))", to: "if (false)", test: context },
  // Gate J repairs.
  { id: "F4-M1", what: "an unscoped direct task reroutes on quota again (only declared write pauses)", file: H + "manager.server.ts",
    from: "taxonomy === \"QUOTA_CONSTRAINED\" && current.executionScope?.access !== \"read\"", to: "taxonomy === \"QUOTA_CONSTRAINED\" && current.executionScope?.access === \"write\"", test: H + "t3-manager.test.ts" },
  { id: "F4-M2", what: "quota never pauses (read work no longer distinguished)", file: H + "manager.server.ts",
    from: "taxonomy === \"QUOTA_CONSTRAINED\" && current.executionScope?.access !== \"read\"", to: "taxonomy === \"QUOTA_CONSTRAINED\"", test: H + "t3-manager.test.ts" },
  { id: "F5-M1", what: "lotus.writeAll writes one by one (no admit-first, no transaction)", file: H + "lotus.server.ts",
    from: "for (const raw of raws) admit(raw);", to: "return raws.map((raw) => this.write(raw, now));", test: H + "lotus.test.ts" },
  { id: "F6-M1", what: "compaction folds the reply's quoted memory lines at host trust", file: H + "http.server.ts",
    from: "turn.text.split(\"\\nFrom memory:\\n\")[0]", to: "turn.text", test: H + "lotus-host.test.ts" },
  { id: "F6-M2", what: "compaction skips the steering check", file: H + "lotus.ts",
    from: "(m.trust !== \"user\" && isSteering(`${m.key} ${m.value}`) ? \"untrusted\" : m.trust)", to: "m.trust", test: H + "lotus.test.ts" },
  { id: "F7-M1", what: "harness.enable resumes every paused route", file: H + "http.server.ts",
    from: "if (paused.has(row.id) && row.lifecycle === \"paused\")", to: "if (row.lifecycle === \"paused\")", test: H + "harnesses-host.test.ts" },
  { id: "F7-M2", what: "an owner's own pause does not supersede the harness.disable record", file: H + "http.server.ts",
    from: "harnessStore.forgetRoute(String(data.id ?? \"\"));", to: "", test: H + "harnesses-host.test.ts" },
  { id: "F11-M1", what: "no aging: priority alone orders held Agents", file: H + "fairness.ts",
    from: "+ Math.floor(Math.max(0, input.now - since) / FAIRNESS_AGING_MS)", to: "", test: "src/lib/bunny-missions/scheduler.test.ts" },
  { id: "F12-M1", what: "an ownership change (assign or Studio rebinding) leaves open workers on the old slot", file: H + "http.server.ts",
    from: "for (const worker of movingWorkers(agentId, slot)) workerStore.save({ ...worker, slot, updatedAt: Date.now() });", to: "", test: workers },
  { id: "F12-M2", what: "the worker store never persists a changed slot", file: H + "workers.server.ts",
    from: "DO UPDATE SET slot=excluded.slot, ", to: "DO UPDATE SET ", test: workers },
  // Review 2 (Gate J) findings.
  { id: "N1-M1", what: "a worker's child Mission ignores its paused parent Agent", file: H + "http.server.ts",
    from: "agents.blockedForMission(workerStore.byChild(missionId)?.parentMissionId ?? missionId)", to: "agents.blockedForMission(missionId)", test: workers },
  { id: "N4-M1", what: "an ownership change may exceed the receiving slot's open-worker cap", file: H + "http.server.ts",
    from: "if (after > WORKER_LIMITS.openPerSlot && after >", to: "if (false && after >", test: workers },
  { id: "N5-M1", what: "write work reroutes after a persistent transport failure", file: H + "manager.server.ts",
    from: "taxonomy === \"TRANSIENT_TRANSPORT\" && action.action === \"reroute\" && current.executionScope?.access !== \"read\"", to: "false", test: H + "t3-manager.test.ts" },
  { id: "N6-M1", what: "steering check misses guidance/guidelines/directions phrasings", file: H + "lotus.ts",
    from: String.raw`|all|any|your|my|the)\b[^.\n]{0,20}\b(instructions?|rules?|prompts?|context|guidance|guidelines?|directions?|directives?)`, to: String.raw`|all|any)\b[^.\n]{0,20}\b(instructions?|rules?|prompts?|context)`, test: H + "lotus.test.ts" },
  { id: "N7-M1", what: "an unavailable phrase outranks quota evidence", file: H + "routing.server.ts",
    from: "if (/usage limit|not allowed right now|quota|rate limit|", to: "if (!/no longer available|offline/i.test(text) && /usage limit|not allowed right now|quota|rate limit|", test: H + "routing.test.ts" },
  { id: "N9-M1", what: "writeAll never rolls back a partial batch", file: H + "lotus.server.ts",
    from: "this.db.exec(\"ROLLBACK\");", to: "this.db.exec(\"COMMIT\");", test: H + "lotus.test.ts" },
  { id: "F1R-M1", what: "worker Project memory listed under Verified facts", file: "src/lib/bunny-missions/manager.server.ts",
    from: "notes: this.missionPromptFacts?.(mission.id) ?? [],", to: "facts: [...facts, \"Context from the Project's memory (labelled notes, not verified facts\", ...(this.missionPromptFacts?.(mission.id) ?? [])],", test: workers },
  // Review 2 confirmation pass (round 3).
  { id: "NB-M1", what: "a Mission treats the Host's write pause as a plain provider failure (reroutes)", file: "src/lib/bunny-missions/machine.ts",
    from: String.raw`if (/\bwrite_pause\b/.test(text)) return "provider_write_paused";`, to: "", test: "src/lib/bunny-missions/scheduler.test.ts" },
  { id: "NA-M1", what: "the cap check counts workers leaving the slot in the same save", file: H + "http.server.ts",
    from: "const after = open.filter((worker) => slotAfter(worker) === slot).length;", to: "const after = open.filter((worker) => slotAfter(worker) === slot || worker.slot === slot).length;", test: workers },
  { id: "ND-M1", what: "429 matches inside an address or port", file: H + "routing.server.ts",
    from: String.raw`rate limit|\b429\b/i`, to: "rate limit|429/i", test: H + "routing.test.ts" },
];
// Windows can briefly refuse a write while another process (indexer, antivirus) holds the file; retry before failing.
const write = (file, text) => {
  for (let i = 0; ; i++) {
    try { return fs.writeFileSync(file, text); } catch (error) { if (i >= 20) throw error; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250); }
  }
};
const results = [];
// Optional third argument: run only the mutation ids it lists (comma-separated).
const only = process.argv[3] ? process.argv[3].split(",") : null;
for (const m of mutations.filter((item) => !only || only.includes(item.id))) {
  const original = fs.readFileSync(m.file, "utf8");
  if (!original.includes(m.from)) { results.push({ id: m.id, what: m.what, applied: false, killed: null }); continue; }
  write(m.file, original.replace(m.from, m.to));
  try {
    const args = ["--experimental-strip-types", "--test", "--test-concurrency=1", "--test-timeout=120000", m.test];
    const run = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 900000 });
    const out = `${run.stdout}${run.stderr}`;
    const failing = [...out.matchAll(/^✖ (.+?) \(\d/gm)].map((match) => match[1]).filter((name, index, all) => all.indexOf(name) === index && name !== "failing tests:");
    results.push({ id: m.id, what: m.what, file: m.file, test: m.test, applied: true, exit: run.status, killed: run.status !== 0, failing: failing.slice(0, 4) });
  } finally {
    write(m.file, original);
  }
}
for (const r of results) console.log(`${r.id}\t${r.applied ? (r.killed ? "KILLED" : "SURVIVED") : "NOT APPLIED"}\t${r.what}${r.failing ? `\t← ${r.failing.join(" | ")}` : ""}`);
fs.writeFileSync(process.argv[2], JSON.stringify(results, null, 2));
