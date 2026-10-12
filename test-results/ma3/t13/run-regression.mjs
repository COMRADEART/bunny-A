// M-A-3 T13 regression runner (adapted from t12/run-regression.mjs). Runs `npm run pretest`, then each `&&`-joined part of
// the `npm test` script as its own log (one failing part never hides another part's counts), then test:ui, typecheck, lint
// and build, inside REPO (default: this checkout; normally a clean git worktree of the pinned T13 source).
// Usage: node test-results/ma3/t13/run-regression.mjs [repoRoot] [outName]
// Writes <evidence>/<outName|regression-final>/<part>.log, exits.txt and source.txt.
import { spawnSync, execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(process.argv[2] ?? resolve(import.meta.dirname, "../../.."));
const out = join(import.meta.dirname, process.argv[3] ?? "regression-final");
mkdirSync(out, { recursive: true });
const source = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const dirty = execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: root, encoding: "utf8" }).trim();
writeFileSync(join(out, "source.txt"), `${source}\nroot ${root}\n${dirty ? "tracked changes present at start:\n" + dirty : "clean tracked tree at start"}\n`);
writeFileSync(join(out, "exits.txt"), "");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const parts = pkg.scripts.test.split(" && ");
const names = ["scripts", "library", "agent"];
let failed = false;
const run = (name, command) => {
  const started = Date.now();
  const r = spawnSync(command, { cwd: root, shell: true, encoding: "utf8", maxBuffer: 512 * 1024 * 1024, env: { ...process.env, FORCE_COLOR: "0" } });
  writeFileSync(join(out, `${name}.log`), (r.stdout ?? "") + (r.stderr ?? ""));
  appendFileSync(join(out, "exits.txt"), `${name} exit=${r.status} ms=${Date.now() - started}\n`);
  console.log(`${name} exit=${r.status}`);
  if (r.status !== 0 || r.error) failed = true;
};
run("pretest", "npm run pretest");
parts.forEach((part, i) => run(names[i] ?? `part${i + 1}`, part));
run("ui", "npm run test:ui");
run("typecheck", "npm run typecheck");
run("lint", "npm run lint");
run("build", "npm run build");
process.exitCode = failed ? 1 : 0;
