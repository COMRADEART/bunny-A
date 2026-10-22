import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { descendants, parseArgs, snapshot, watch } from "./ci/watchdog.mjs";
import { testStage } from "./ci/test-stage.mjs";

test("CI test-stage: flags go after --test; stage 1 drops only the hardware voice tests", () => {
  const script = "node --test --test-concurrency=1 scripts/*.test.mjs && node --experimental-strip-types --test --test-concurrency=1 a.test.ts b.test.ts && npm run test:ma4";
  assert.equal(testStage(script, 0, [], ["a.test.mjs", "voice-worker.test.mjs"]), "node --test --test-concurrency=1 scripts/a.test.mjs");
  assert.equal(testStage(script, 1, ["--test-reporter=tap"]), "node --experimental-strip-types --test --test-reporter=tap --test-concurrency=1 a.test.ts b.test.ts");
  assert.equal(testStage(script, 2), "npm run test:ma4");
  assert.throws(() => testStage(script, 2, ["--test-reporter=tap"]), /not a node --test command/);
  assert.throws(() => testStage(script, 3), /no stage 3/);
});

test("CI watchdog: arguments are validated", () => {
  assert.throws(() => parseArgs(["--label", "x", "--out", "d"]), /usage/);
  assert.throws(() => parseArgs(["--label", "x", "--out", "d", "--", "node"]), /budget-s/);
  assert.deepEqual(parseArgs(["--label", "x", "--budget-s", "2", "--out", "d", "--grace-s", "1", "--", "node", "-v"]), { label: "x", out: "d", budgetMs: 2000, graceMs: 1000, command: ["node", "-v"] });
  assert.deepEqual(descendants([{ pid: 1, ppid: 0 }, { pid: 2, ppid: 1 }, { pid: 3, ppid: 2 }, { pid: 4, ppid: 9 }], 1).map((row) => row.pid), [1, 2, 3]);
});

test("CI watchdog: a hung command and its child become a named timeout, and nothing it started survives", async () => {
  const out = mkdtempSync(join(tmpdir(), "bunny-ci-watchdog-"));
  try {
    const hang = `require("child_process").spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" }); console.log("started"); setInterval(() => {}, 1000)`;
    const code = await watch({ label: "hang", out, budgetMs: 3000, graceMs: 1000, command: [process.execPath, "-e", hang] });
    assert.equal(code, 124);
    const report = JSON.parse(readFileSync(join(out, "hang.watchdog.json"), "utf8"));
    assert.equal(report.result, "TIMEOUT");
    assert.ok(report.tree.length >= 2, "the parent and its child are both recorded");
    assert.deepEqual(report.survivedForced, []);
    assert.match(readFileSync(join(out, "hang.log"), "utf8"), /started/);
    const left = new Set(report.tree.map((row) => row.pid));
    assert.deepEqual(snapshot().filter((row) => left.has(row.pid)), [], "no process of the tree is still running");
  } finally {
    rmSync(out, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test("CI watchdog: a command that exits keeps its exit code", async () => {
  const out = mkdtempSync(join(tmpdir(), "bunny-ci-watchdog-"));
  try {
    assert.equal(await watch({ label: "ok", out, budgetMs: 20_000, graceMs: 1000, command: [process.execPath, "-e", "process.exit(3)"] }), 3);
    assert.equal(JSON.parse(readFileSync(join(out, "ok.watchdog.json"), "utf8")).result, "EXITED");
  } finally {
    rmSync(out, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});
