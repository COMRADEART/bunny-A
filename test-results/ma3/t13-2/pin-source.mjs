// M-A-3 T13.2 (adapted from t13-1/pin-source.mjs): record the committed implementation pin and prepare a detached git worktree of it for the clean regression
// (no working-tree edits, no LOKAM files). Ignored local runtime inputs the existing tests need are copied in, never
// committed: node_modules (junction), native/voice/vendor (whisper runtime), native/bunny-owned-process.node(+json) and
// the Node runtime LICENSE from releases/installed/JEV-Windows-v1 (a legacy release folder unrelated to TypeSafe Jev).
// Usage: node test-results/ma3/t13-2/pin-source.mjs <sourceCommit> <worktreePath>
import { execFileSync } from "node:child_process";
import { copyFileSync, cpSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../..");
const git = (args, cwd = root) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
const commit = git(["rev-parse", process.argv[2] ?? "HEAD"]);
const worktree = resolve(process.argv[3]);
git(["worktree", "add", "--detach", worktree, commit]);
execFileSync("cmd.exe", ["/c", "mklink", "/J", join(worktree, "node_modules"), join(root, "node_modules")]);
cpSync(join(root, "native/voice/vendor"), join(worktree, "native/voice/vendor"), { recursive: true });
for (const file of ["native/bunny-owned-process.node", "native/bunny-owned-process.node.json"]) copyFileSync(join(root, file), join(worktree, file));
mkdirSync(join(worktree, "releases/installed/JEV-Windows-v1/runtime"), { recursive: true });
copyFileSync(join(root, "releases/installed/JEV-Windows-v1/runtime/LICENSE"), join(worktree, "releases/installed/JEV-Windows-v1/runtime/LICENSE"));
const files = git(["diff", "--name-only", "aa134f5efb6748f21ec9a5fe4eae83f4c2d8d86f", commit]).split(/\r?\n/).filter(Boolean);
writeFileSync(join(import.meta.dirname, "source-provenance.json"), JSON.stringify({
  sourceCommit: commit,
  parent: git(["rev-parse", `${commit}^`]),
  t131Evidence: "e449456090def0440c4f50bd882fb6d187968e4c",
  t131Source: "aa134f5efb6748f21ec9a5fe4eae83f4c2d8d86f",
  branch: git(["branch", "--show-current"]),
  sourceFiles: files,
  regressionRoot: "detached git worktree of sourceCommit (removed after the run)",
  stagedIgnoredInputs: ["node_modules (junction)", "native/voice/vendor", "native/bunny-owned-process.node(.json)", "releases/installed/JEV-Windows-v1/runtime/LICENSE"],
  preservedUnrelated: [".claude session logger, docs/lokam, tests/test_lokam_evidence.py, .gitignore logger rules (untracked/unstaged)", "package.json test:session-evidence remains an unstaged user change"],
}, null, 2) + "\n");
console.log(JSON.stringify({ sourceCommit: commit, sourceFiles: files.length, worktree }));
