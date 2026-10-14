// Gate I review-fix mutation checks: each mutation re-introduces one independent-review finding and must make its
// targeted test fail. Files are restored after every run.
// Run from the repository root: node test-results/ma3/t13-3/gate-i/review-fixes/mutation-checks.cjs <out.json>
const fs = require("fs");
const { spawnSync } = require("child_process");
const H = "src/lib/bunny-host/";
const workers = H + "workers-host.test.ts";
const context = H + "personal-agent-context-host.test.ts";
const mutations = [
  { id: "F1-M1", what: "worker Project memory appended to the child Mission objective again", file: H + "http.server.ts",
    from: "if (ability.kind === \"model\") return [{ ...step, objective, executor: { kind: \"model\" } }];",
    to: "if (ability.kind === \"model\") return [{ ...step, objective: `${objective}\\n\\nContext: ${workerStore.open().flatMap((w) => w.context).join(\"; \")}`, executor: { kind: \"model\" } }];", test: workers },
  { id: "F1-M2", what: "worker Project memory never reaches the model prompt", file: "src/lib/bunny-missions/manager.server.ts",
    from: "facts.push(...(this.missionPromptFacts?.(mission.id) ?? []));", to: "", test: workers },
  { id: "F2-M1", what: "a paired device may approve, start or retry a worker's child Mission", file: H + "http.server.ts",
    from: "if (target && workerStore.isWorkerMission(target)) throw", to: "if (false) throw", test: workers },
  { id: "F3-M1", what: "Studio save re-records every focused Agent's owner", file: H + "http.server.ts",
    from: "if (slot.agentId && slot.agentId !== boundBefore.get(slot.slot)) recordOwner", to: "if (slot.agentId) recordOwner", test: context },
  { id: "F3-M2", what: "assign leaves the old slot focused on the moved Agent", file: H + "http.server.ts",
    from: "if (config.slots.some((row) => row.slot !== slot && row.agentId === agentId))", to: "if (false)", test: context },
  { id: "F5-M1", what: "lotus.writeAll writes one by one (no admit-first, no transaction)", file: H + "lotus.server.ts",
    from: "for (const raw of raws) admit(raw);", to: "return raws.map((raw) => this.write(raw, now));", test: H + "lotus.test.ts" },
  { id: "F7-M1", what: "harness.enable resumes every paused route", file: H + "http.server.ts",
    from: "if (paused.has(row.id) && row.lifecycle === \"paused\")", to: "if (row.lifecycle === \"paused\")", test: H + "harnesses-host.test.ts" },
];
const results = [];
for (const m of mutations) {
  const original = fs.readFileSync(m.file, "utf8");
  if (!original.includes(m.from)) { results.push({ id: m.id, what: m.what, applied: false, killed: null }); continue; }
  fs.writeFileSync(m.file, original.replace(m.from, m.to));
  try {
    const args = ["--experimental-strip-types", "--test", "--test-concurrency=1", "--test-timeout=120000", m.test];
    const run = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 600000 });
    const out = `${run.stdout}${run.stderr}`;
    const failing = [...out.matchAll(/^✖ (.+?) \(\d/gm)].map((match) => match[1]).filter((name, index, all) => all.indexOf(name) === index && name !== "failing tests:");
    results.push({ id: m.id, what: m.what, file: m.file, test: m.test, applied: true, exit: run.status, killed: run.status !== 0, failing: failing.slice(0, 4) });
  } finally {
    fs.writeFileSync(m.file, original);
  }
}
for (const r of results) console.log(`${r.id}\t${r.applied ? (r.killed ? "KILLED" : "SURVIVED") : "NOT APPLIED"}\t${r.what}${r.failing ? `\t← ${r.failing.join(" | ")}` : ""}`);
fs.writeFileSync(process.argv[2], JSON.stringify(results, null, 2));
