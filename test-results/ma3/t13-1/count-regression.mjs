// M-A-3 T13.1: derive distinct regression counts from a run-regression.mjs folder and prove every T13 baseline case
// (t13/regression-inventory.json, 2,264 distinct) still exists, one-to-one through baseline-retention-map.json.
// Usage: node test-results/ma3/t13-1/count-regression.mjs <runFolder> <sourceCommit>
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ev = resolve(import.meta.dirname);
const run = resolve(process.argv[2] ?? join(ev, "regression-final"));
const sourceCommit = process.argv[3];
if (!/^[0-9a-f]{40}$/.test(sourceCommit ?? "")) throw Error("Pass the 40-hex T13.1 source commit");
const PARTS = ["scripts", "library", "agent", "ui"];
const parts = {};
const tests = [];
for (const part of PARTS) {
  const log = readFileSync(join(run, `${part}.log`), "utf8");
  const counts = {};
  for (const key of ["tests", "pass", "fail", "cancelled", "skipped", "todo"]) {
    const hits = [...log.matchAll(new RegExp(`^ℹ ${key} (\\d+)$`, "gm"))];
    if (hits.length !== 1) throw Error(`${part}: expected one "ℹ ${key}" line, found ${hits.length}`);
    counts[key] = Number(hits[0][1]);
  }
  const names = [...log.matchAll(/^\s*✔ (.+?) \([\d.]+m?s\)$/gm)].map((m) => m[1]).filter((name) => !/^▶ /.test(name));
  const suites = new Set([...log.matchAll(/^\s*▶ (.+)$/gm)].map((m) => m[1].trim()));
  const cases = names.filter((name) => !suites.has(name));
  if (cases.length !== counts.tests) throw Error(`${part}: ${cases.length} passing case lines for ${counts.tests} tests`);
  parts[part] = counts;
  for (const test of cases) tests.push({ suite: part, test, result: "PASS" });
}
const total = PARTS.reduce((sum, part) => sum + parts[part].tests, 0);
const bad = PARTS.filter((part) => parts[part].fail || parts[part].cancelled || parts[part].skipped || parts[part].todo || parts[part].pass !== parts[part].tests);
const distinct = new Set(tests.map((t) => `${t.suite}:${t.test}`));
const baseline = JSON.parse(readFileSync(join(ev, "../t13/regression-inventory.json"), "utf8"));
const replacements = JSON.parse(readFileSync(join(ev, "baseline-retention-map.json"), "utf8"));
const revised = [];
const missing = [];
for (const t of baseline.tests) {
  if (distinct.has(`${t.suite}:${t.test}`)) continue;
  const replacement = replacements.find((r) => r.suite === t.suite && r.from === t.test);
  if (replacement && distinct.has(`${t.suite}:${replacement.to}`)) revised.push(replacement);
  else missing.push(`${t.suite}:${t.test}`);
}
if (new Set(revised.map((r) => `${r.suite}:${r.to}`)).size !== revised.length) throw Error("Baseline replacements must be one-to-one");
const baselineParts = Object.fromEntries(PARTS.map((p) => [p, baseline.tests.filter((t) => t.suite === p).length]));
const exits = readFileSync(join(run, "exits.txt"), "utf8").trim().split(/\r?\n/);
const summary = {
  sourceCommit,
  runFolder: run.replace(/\\/g, "/").replace(/^.*?(test-results\/)/, "$1"),
  baseline: { sourceCommit: baseline.sourceCommit, distinct: baseline.distinctSuiteNames, parts: baselineParts },
  parts,
  total,
  npmTestTotal: total - parts.ui.tests,
  distinct: distinct.size,
  newDistinct: distinct.size - (baseline.distinctSuiteNames - missing.length),
  newCases: tests.filter((t) => !baseline.tests.some((b) => b.suite === t.suite && b.test === t.test) && !revised.some((r) => r.suite === t.suite && r.to === t.test)).map((t) => `${t.suite}:${t.test}`),
  baselineRetained: baseline.distinctSuiteNames - missing.length,
  baselineRetainedExact: baseline.distinctSuiteNames - missing.length - revised.length,
  baselineRevised: revised,
  baselineMissing: missing,
  exits,
  result: bad.length || missing.length || distinct.size !== total || exits.some((line) => !/exit=0\b/.test(line)) ? "FAIL" : "PASS",
};
writeFileSync(join(ev, "regression-summary.json"), JSON.stringify(summary, null, 2) + "\n");
writeFileSync(join(ev, "regression-inventory.json"), JSON.stringify({ sourceCommit, baselineDistinctTests: baseline.distinctSuiteNames, total, distinctSuiteNames: distinct.size, parts, tests }, null, 2) + "\n");
console.log(JSON.stringify({ result: summary.result, total, distinct: distinct.size, parts: Object.fromEntries(PARTS.map((p) => [p, parts[p].tests])), newCases: summary.newCases.length, baselineRevised: revised.length, baselineMissing: missing.length }));
if (summary.result !== "PASS") process.exit(1);
