import { existsSync, openSync, closeSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { CapabilityResult } from "../types.ts";
import type { ExecutionContext } from "./bus.server.ts";
import { runCommand, runProcess, resolveCommand, tail, type RunResult } from "./process.server.ts";

export type GitRunner = (args: string[], cwd: string, signal: AbortSignal, timeoutMs: number) => Promise<RunResult>;
type Cleanup = { attempted: boolean; ok: boolean; detail: string };

/** One Git transaction. Starts only on a clean tracked tree and without another Git transaction;
 * a unique MERGE_MSG marker + original/target HEAD identify our unfinished merge. Cancellation
 * cleanup uses a fresh bounded signal and never resets or aborts an unrelated merge.
 */
export async function mergeTransaction(branch: string, cwd: string, context: ExecutionContext, suppliedRun?: GitRunner): Promise<CapabilityResult> {
  const run: GitRunner=suppliedRun??((args,cwd,signal,timeoutMs)=>runCommand("git",args,{cwd,signal,timeoutMs,owner:{missionId:context.missionId,stepId:context.stepId,capabilityRunId:context.capabilityRunId,dataDirectory:context.dataDirectory,records:context.processOwnership,action:`git.${args[0]}`}}));
  const cleanupContext = new AbortController();
  const inspect = (args: string[]) => run(args, cwd, cleanupContext.signal, 15_000);
  const required = async (args: string[]) => { const result = await inspect(args); if (result.exitCode !== 0) throw new Error(`Git inspection failed: ${tail(result.stderr || result.stdout, 400)}`); return result.stdout.trim(); };
  const gitDir = resolve(cwd, await required(["rev-parse", "--absolute-git-dir"]));
  const headBefore = await required(["rev-parse", "HEAD"]);
  const target = await required(["rev-parse", "--verify", `${branch}^{commit}`]);
  const originalStatus = await required(["status", "--porcelain=v1", "--untracked-files=no"]);
  const refused = (detail: string): CapabilityResult => ({ ok: false, status: "failed", summary: detail, output: { merged: false, cleanup: { attempted: false, ok: true, detail: "No Bunny merge started." } }, evidence: [detail], errorCategory: "workspace_conflict" });
  const read = (name: string) => { try { return readFileSync(join(gitDir, name), "utf8").trim(); } catch { return ""; } };
  const lock = join(gitDir, "bunny-merge.lock");
  if (["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply", "index.lock"].some((path) => existsSync(join(gitDir, path)))) {
    // A merge whose MERGE_MSG carries Bunny's marker was left by an interrupted Bunny transaction (e.g. a Host crash). Still never touched.
    const interrupted = existsSync(join(gitDir, "MERGE_HEAD")) ? /Bunny merge transaction [0-9a-f-]{36}/.exec(read("MERGE_MSG"))?.[0] : undefined;
    return refused(interrupted ? `An interrupted ${interrupted} is still in progress in this repository; Bunny did not start or abort any merge. Review git status, then commit it or run "git merge --abort"${existsSync(lock) ? ` and delete ${lock}` : ""} to discard it.` : "An existing Git operation or index lock is present; Bunny did not start or abort any merge.");
  }
  if (originalStatus) return refused("Merge requires a clean tracked working tree and index; user changes were preserved.");
  if (context.signal.aborted) return refused("Merge cancelled before start; no files changed.");
  const marker = `Bunny merge transaction ${crypto.randomUUID()}`;
  let descriptor: number;
  try { descriptor = openSync(lock, "wx"); } catch { return refused(`A Bunny merge lock is present (${lock}): another Bunny merge is running in this repository, or an interrupted one left the lock behind. No merge started; if no Bunny merge is running, delete the lock.`); }
  writeFileSync(descriptor, marker); closeSync(descriptor);
  let result: RunResult | null = null; let error: string | null = null;
  let head = headBefore; let conflicts: string[] = []; let cleanup: Cleanup = { attempted: false, ok: true, detail: "No unfinished merge." };
  try {
    // Re-check after taking our lock. External Git processes never use it.
    if (read("MERGE_HEAD") || await required(["rev-parse", "HEAD"]) !== headBefore) return refused("Repository changed before merge; no Bunny merge started.");
    try {
      // Stage first: MERGE_HEAD/MERGE_MSG retain the ownership marker until commit finishes.
      result = await run(["merge", "--no-ff", "--no-commit", "--no-edit", "-m", `Merge ${branch}\n\n${marker}`, branch], cwd, context.signal, Math.min(120_000, context.timeoutMs));
      if (result.exitCode === 0 && !result.aborted && !result.timedOut && !context.signal.aborted && read("MERGE_HEAD")) result = await run(["commit", "--no-edit"], cwd, context.signal, Math.min(120_000, context.timeoutMs));
    }
    catch (caught) { error = caught instanceof Error ? caught.message : String(caught); }
    head = await required(["rev-parse", "HEAD"]);
    const mergeHead = read("MERGE_HEAD");
    if (mergeHead) {
      const owned = mergeHead === target && read("ORIG_HEAD") === headBefore && head === headBefore && read("MERGE_MSG").includes(marker) && readFileSync(lock, "utf8") === marker;
      if (!owned) cleanup = { attempted: false, ok: false, detail: "In-progress merge ownership could not be proven; it was left untouched." };
      else {
        conflicts = (await inspect(["diff", "--name-only", "--diff-filter=U"])).stdout.split(/\r?\n/).filter(Boolean);
        const aborted = await inspect(["merge", "--abort"]);
        const restoredHead = await required(["rev-parse", "HEAD"]);
        const restoredStatus = await required(["status", "--porcelain=v1", "--untracked-files=no"]);
        const restored = aborted.exitCode === 0 && !existsSync(join(gitDir, "MERGE_HEAD")) && restoredHead === headBefore && restoredStatus === originalStatus;
        cleanup = { attempted: true, ok: restored, detail: restored ? "Bunny's merge aborted; original HEAD, tracked tree and index restored." : `Merge cleanup failed; user work was preserved. ${tail(aborted.stderr || aborted.stdout, 400)}` };
      }
    } else if (head === headBefore && (await required(["status", "--porcelain=v1", "--untracked-files=no"]) !== originalStatus || existsSync(join(gitDir, "index.lock")))) {
      cleanup = { attempted: false, ok: false, detail: "Git left changed files or an index lock before merge ownership was established; no destructive cleanup attempted." };
    }
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
    cleanup = { ...cleanup, ok: false, detail: `Git state/cleanup could not be verified: ${error}` };
  } finally {
    // This is only our sidecar, not Git's index.lock. Never remove someone else's lock.
    if (existsSync(lock) && readFileSync(lock, "utf8") === marker) rmSync(lock);
  }
  const merged = head !== headBefore && !existsSync(join(gitDir, "MERGE_HEAD"));
  const cancelled = context.signal.aborted || result?.aborted;
  const succeeded = result?.exitCode === 0 && !cancelled && !error && cleanup.ok;
  const summary = succeeded ? `Merged ${branch} → ${head.slice(0, 12)}.` : `Merge ${cancelled ? "cancelled" : result?.timedOut ? "timed out" : conflicts.length ? "conflicted" : "failed"}: ${error ?? tail(result?.stderr || result?.stdout || "process did not succeed", 400)}. ${cleanup.detail}${merged ? " Merge completed before cancellation/failure; its committed changes remain." : ""}`;
  return { ok: !!succeeded, status: succeeded ? "succeeded" : result?.timedOut ? "timeout" : "failed", summary,
    output: { merged, conflict: conflicts, head, headBefore, cleanup }, cleanup, evidence: [`Original HEAD ${headBefore}`, `Target ${target}`, cleanup.detail],
    ...(succeeded ? {} : { errorCategory: cancelled ? "user_stopped" as const : result?.timedOut ? "timeout" as const : "workspace_conflict" as const }) };
}

/** Testable process seam that still launches only the installed Git executable, argv only. */
export async function runGitProcess(args: string[], cwd: string, signal: AbortSignal, timeoutMs: number, env?: NodeJS.ProcessEnv) {
  const executable = resolveCommand("git"); if (!executable) throw new Error("Git is unavailable.");
  return runProcess(executable, args, { cwd, signal, timeoutMs, env });
}
