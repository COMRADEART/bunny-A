import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
const root = resolve(import.meta.dirname, "../../..");
const git = (args, options = {}) => execFileSync("git", args, { cwd: root, encoding: "utf8", ...options }).trim();
if (git(["diff", "--cached", "--name-only"])) throw Error("Unexpected existing staged changes");
const paths = ["src", "install", "public", "assets/t13", "docs/t13/BUNNY_A_T13_DESIGN_SPEC.md",
  "scripts/island-placement.test.mjs", "scripts/island-team-chips.test.mjs", "scripts/island-voice.test.mjs",
  "scripts/island-notch.test.mjs", "scripts/package-bunny-desktop.ps1"];
git(["add", "--", ...paths]);
// The user's separate session-evidence task remains in the working tree; do not pin a script whose hook is outside T13.
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
delete pkg.scripts["test:session-evidence"];
const packageText = JSON.stringify(pkg, null, 2) + "\n";
const blob = git(["hash-object", "-w", "--stdin"], { input: packageText });
git(["update-index", "--add", "--cacheinfo", `100644,${blob},package.json`]);
const files = git(["diff", "--cached", "--name-only"]).split(/\r?\n/);
if (files.some((p) => !paths.some((prefix) => p === prefix || p.startsWith(prefix + "/")) && p !== "package.json")) throw Error("Stage contains an unrelated file");
git(["commit", "-m", "feat(t13): implement living glass, Personal Agents and native character Notch"]);
const commit = git(["rev-parse", "HEAD"]);
writeFileSync(join(import.meta.dirname, "source-provenance.json"), JSON.stringify({ sourceCommit: commit,
  t12Source: "86cc164d103edb97b7c39de0f520bc37d40e1db4", t12Evidence: "f104057d125d3265587d55d20fcf2eb555489303",
  branch: git(["branch", "--show-current"]), sourceFiles: files,
  preservedUnrelated: [".claude session logger, docs/lokam, tests/test_lokam_evidence.py, .gitignore logger rules", "package.json test:session-evidence remains an unstaged user change"] }, null, 2) + "\n");
const checkout = join(import.meta.dirname, "source-checkout");
mkdirSync(checkout, { recursive: false });
const tar = join(import.meta.dirname, "source.tar");
git(["-c", "core.autocrlf=false", "archive", "--format=tar", "-o", tar, commit]);
execFileSync("tar.exe", ["-xf", tar, "-C", checkout], { cwd: root });
console.log(JSON.stringify({ sourceCommit: commit, sourceFiles: files.length, checkout }));
