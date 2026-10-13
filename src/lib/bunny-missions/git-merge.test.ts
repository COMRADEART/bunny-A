import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mergeTransaction, runGitProcess, type GitRunner } from "./capabilities/git-merge.server.ts";
import type { ExecutionContext } from "./capabilities/bus.server.ts";
import { HostDatabase } from "../bunny-host/persistence.server.ts";
import { TaskManager } from "../bunny-host/manager.server.ts";
import { MissionManager } from "./manager.server.ts";
import { GitCapability } from "./capabilities/local.server.ts";

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, windowsHide: true, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
function repository(conflict = false) {
  const directory = mkdtempSync(join(tmpdir(), "bunny-ma0r-merge-")); const root = join(directory, "repo"); mkdirSync(root);
  git(root, "init", "-q", "-b", "main"); git(root, "config", "user.name", "Bunny Fixture"); git(root, "config", "user.email", "bunny@fixture");
  writeFileSync(join(root, "a.txt"), "base\n"); git(root, "add", "."); git(root, "commit", "-qm", "base");
  git(root, "checkout", "-qb", "bunny/test");
  writeFileSync(join(root, conflict ? "a.txt" : "b.txt"), "branch\n"); git(root, "add", "."); git(root, "commit", "-qm", "branch");
  git(root, "checkout", "-q", "main");
  if (conflict) { writeFileSync(join(root, "a.txt"), "main\n"); git(root, "commit", "-qam", "main"); }
  const head = git(root, "rev-parse", "HEAD");
  writeFileSync(join(root, "user-untracked.txt"), "USER WORK");
  const controller = new AbortController();
  const context: ExecutionContext = { missionId: "fixture", stepId: "merge", cwd: root, roots: [root], dataDirectory: directory, signal: controller.signal, timeoutMs: 15_000 };
  return { directory, root, head, controller, context, dispose: () => rmSync(directory, { recursive: true, force: true }) };
}
function restored(repo: ReturnType<typeof repository>) {
  assert.equal(git(repo.root, "rev-parse", "HEAD"), repo.head);
  assert.equal(git(repo.root, "status", "--porcelain=v1", "--untracked-files=no"), "");
  assert.ok(!existsSync(join(repo.root, ".git", "MERGE_HEAD")));
  assert.equal(readFileSync(join(repo.root, "user-untracked.txt"), "utf8"), "USER WORK");
  assert.ok(!existsSync(join(repo.root, ".git", "bunny-merge.lock")));
}
test("MA0R: real merge success commits; real conflict abort restores original HEAD and preserves user files", async () => {
  for (const conflict of [false, true]) {
    const repo = repository(conflict);
    try {
      const result = await mergeTransaction("bunny/test", repo.root, repo.context);
      assert.equal(result.ok, !conflict); assert.equal(result.cleanup?.ok, true);
      if (conflict) { assert.deepEqual((result.output as { conflict: string[] }).conflict, ["a.txt"]); assert.equal(result.cleanup?.attempted, true); restored(repo); }
      else { assert.notEqual(git(repo.root, "rev-parse", "HEAD"), repo.head); assert.ok(existsSync(join(repo.root, "b.txt"))); }
    } finally { repo.dispose(); }
  }
});

test("MA0R: stop during the real Git commit process aborts Bunny's owned merge", { timeout: 40_000 }, async () => {
  const repo = repository();
  const barrier = join(repo.directory, "hook-started");
  const hookScript = join(repo.directory, "hook.mjs");
  writeFileSync(hookScript, `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(barrier)}, 'started'); setTimeout(()=>{},5000);`);
  writeFileSync(join(repo.root, ".git", "hooks", "pre-commit"), `#!/bin/sh\nexec '${process.execPath.replaceAll("\\", "/")}' '${hookScript.replaceAll("\\", "/")}'\n`, { mode: 0o755 });
  const pending = mergeTransaction("bunny/test", repo.root, repo.context);
  try {
    const start = Date.now();
    while (!existsSync(barrier)) { if (Date.now() - start > 10_000) throw new Error("Git pre-commit hook did not start"); await new Promise((done) => setTimeout(done, 10)); }
    assert.ok(existsSync(join(repo.root, ".git", "MERGE_HEAD")), "native Git merge is in progress");
    repo.controller.abort(new Error("User Stop"));
    const result = await pending;
    assert.equal(result.ok, false); assert.equal(result.errorCategory, "user_stopped");
    assert.equal(result.cleanup?.attempted, true); assert.equal(result.cleanup?.ok, true, result.summary);
    restored(repo);
  } finally { repo.controller.abort(); await pending; repo.dispose(); }
});

test("MA0R: process failure after native merge state is created still aborts safely", async () => {
  const repo = repository();
  const runner: GitRunner = async (args, cwd, signal, timeout) => {
    if (args[0] === "commit") throw new Error("Fixture process launch failed");
    return runGitProcess(args, cwd, signal, timeout);
  };
  try {
    const result = await mergeTransaction("bunny/test", repo.root, repo.context, runner);
    assert.equal(result.ok, false); assert.match(result.summary, /process launch failed/); assert.equal(result.cleanup?.ok, true); restored(repo);
  } finally { repo.dispose(); }
});

test("MA0R: unrelated pre-existing merge is never aborted and dirty tracked work is refused", async () => {
  const repo = repository(true);
  try {
    try { git(repo.root, "merge", "--no-ff", "--no-edit", "bunny/test"); } catch { /* real conflict */ }
    const mergeHead = readFileSync(join(repo.root, ".git", "MERGE_HEAD"), "utf8");
    const conflict = readFileSync(join(repo.root, "a.txt"), "utf8");
    const before = git(repo.root, "status", "--porcelain=v1");
    const result = await mergeTransaction("bunny/test", repo.root, repo.context);
    assert.equal(result.ok, false); assert.match(result.summary, /existing Git operation/);
    assert.equal(readFileSync(join(repo.root, ".git", "MERGE_HEAD"), "utf8"), mergeHead);
    assert.equal(readFileSync(join(repo.root, "a.txt"), "utf8"), conflict);
    assert.equal(git(repo.root, "status", "--porcelain=v1"), before);
    git(repo.root, "merge", "--abort");
    writeFileSync(join(repo.root, "a.txt"), "USER EDIT\n");
    const dirty = await mergeTransaction("bunny/test", repo.root, repo.context);
    assert.match(dirty.summary, /clean tracked/); assert.equal(readFileSync(join(repo.root, "a.txt"), "utf8"), "USER EDIT\n");
  } finally { repo.dispose(); }
});

test("MA0R: cleanup failure reports the remaining merge honestly without reset", async () => {
  const repo = repository(true);
  const runner: GitRunner = async (args, cwd, signal, timeout) => args[0] === "merge" && args[1] === "--abort"
    ? { exitCode: 1, stdout: "", stderr: "Fixture cleanup denied", durationMs: 1, timedOut: false, aborted: false }
    : runGitProcess(args, cwd, signal, timeout);
  try {
    const result = await mergeTransaction("bunny/test", repo.root, repo.context, runner);
    assert.equal(result.ok, false); assert.equal(result.cleanup?.ok, false); assert.match(result.summary, /cleanup failed/);
    assert.ok(existsSync(join(repo.root, ".git", "MERGE_HEAD")), "failed cleanup is not disguised by reset");
    assert.equal(readFileSync(join(repo.root, "user-untracked.txt"), "utf8"), "USER WORK");
    git(repo.root, "merge", "--abort"); restored(repo);
  } finally { repo.dispose(); }
});

test("MA0R: capability and mission cancellation wait for real merge cleanup; no retry follows Stop", async () => {
  const repo = repository(); const db = new HostDatabase(":memory:");
  const tasks = new TaskManager(db, repo.root, []);
  let begun!: () => void; const started = new Promise<void>((done) => { begun = done; });
  const runner: GitRunner = async (args, cwd, signal, timeout) => {
    if (args[0] !== "commit") return runGitProcess(args, cwd, signal, timeout);
    begun();
    await new Promise<void>((done) => signal.aborted ? done() : signal.addEventListener("abort", () => done(), { once: true }));
    return { exitCode: null, stdout: "", stderr: "Cancelled at commit barrier", durationMs: 1, timedOut: false, aborted: true };
  };
  const gitCapability = new GitCapability(repo.directory);
  gitCapability.execute = (_action, _params, context) => mergeTransaction("bunny/test", repo.root, context, runner);
  const missions = new MissionManager(tasks, { dataDirectory: repo.directory, adapters: [gitCapability] });
  try {
    missions.configure({ enabled: true }, "test"); await missions.bus.refreshHealth();
    const view = missions.create({ objective: "Merge", mode: "fast", origin: "workstation", steps: [{ role: "Merge", objective: "merge", access: "write", executor: { kind: "capability", action: "git.merge", params: { branch: "bunny/test" } } }] });
    missions.approve(view.id, "workstation"); await started;
    const stopped = await missions.stop(view.id, "workstation");
    assert.equal(stopped.state, "stopped"); restored(repo);
    const runs = missions.store.runs({ missionId: view.id });
    assert.equal(runs.length, 1); assert.equal(runs[0].cleanup?.ok, true); assert.equal(runs[0].status, "failed");
    await missions.tick(view.id); assert.equal(missions.store.runs({ missionId: view.id }).length, 1, "cancelled step was not retried");
  } finally { await missions.close(); db.close(); repo.dispose(); }
});

test("MA1: a Bunny merge left by a Host crash is named, with its cleanup, and never touched; a stale lock is explained", async () => {
  const repo = repository();
  try {
    const marker = `Bunny merge transaction ${crypto.randomUUID()}`;
    git(repo.root, "merge", "--no-ff", "--no-commit", "-m", `Merge bunny/test\n\n${marker}`, "bunny/test");
    const lock = join(repo.root, ".git", "bunny-merge.lock"); writeFileSync(lock, marker);
    const mergeHead = readFileSync(join(repo.root, ".git", "MERGE_HEAD"), "utf8"); const before = git(repo.root, "status", "--porcelain=v1");
    const left = await mergeTransaction("bunny/test", repo.root, repo.context);
    assert.equal(left.ok, false); assert.equal(left.errorCategory, "workspace_conflict");
    assert.ok(left.summary.includes(`An interrupted ${marker} is still in progress`), left.summary);
    assert.ok(left.summary.includes("git merge --abort") && left.summary.includes(lock), left.summary);
    assert.equal(readFileSync(join(repo.root, ".git", "MERGE_HEAD"), "utf8"), mergeHead); assert.equal(readFileSync(lock, "utf8"), marker);
    assert.equal(git(repo.root, "status", "--porcelain=v1"), before);
    git(repo.root, "merge", "--abort");
    const stale = await mergeTransaction("bunny/test", repo.root, repo.context);
    assert.equal(stale.ok, false); assert.match(stale.summary, /A Bunny merge lock is present .*interrupted one left the lock behind/);
    assert.equal(readFileSync(lock, "utf8"), marker, "the lock is not removed by Bunny"); assert.equal(git(repo.root, "rev-parse", "HEAD"), repo.head);
  } finally { repo.dispose(); }
});
