import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
const root = resolve(import.meta.dirname, "../../..");
const git = (args, opts = {}) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...opts }).trim();
if (git(["diff", "--cached", "--name-only"])) throw Error("Unexpected preexisting staged changes");
const rows = readFileSync(join(import.meta.dirname, "INDEX.sha256"), "utf8").trim().split(/\r?\n/).map((line) => ({ hash: line.slice(0, 64), path: line.slice(66) }));
const allowed = new Set(["MA3_T13_UI_UX_MASTERY_ACCEPTANCE.md", ".gitattributes", "docs/t13/T13_FINAL_INDEPENDENT_REVIEW.md", "docs/t13/T13_VERIFICATION_EVIDENCE_AUDIT.md"]);
if (rows.some((r) => !r.path.startsWith("test-results/ma3/t13/") && !allowed.has(r.path))) throw Error("Unexpected seal path");
git(["add", "-f", "--pathspec-from-file=-", "--pathspec-file-nul"], {
  input: [...rows.map((r) => r.path), "test-results/ma3/t13/INDEX.sha256"].join("\0") + "\0",
});
for (const r of rows) {
  const bytes = execFileSync("git", ["show", `:${r.path}`], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
  if (createHash("sha256").update(bytes).digest("hex") !== r.hash) throw Error("Staged byte mismatch: " + r.path);
}
git(["commit", "-m", "docs(t13): seal UI mastery acceptance, final regression and test-package evidence"]);
console.log(JSON.stringify({ evidenceCommit: git(["rev-parse", "HEAD"]), sourceCommit: "8145377880fa4ab330238db827fa488430b2328d", sealedArtifacts: rows.length }));
