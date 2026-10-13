// M-A-3 T12 final regression runner. Runs `npm run pretest`, then each `&&`-joined part of the `npm test` script as its own
// log (so one failing part never hides another part's counts), then test:ui, typecheck, lint and build. Writes
// regression-final/<part>.log, exits.txt and source.txt. Usage: node test-results/ma3/t12/run-regression.mjs
import { spawnSync, execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../..");
const out = join(import.meta.dirname, "regression-final");
mkdirSync(out, { recursive: true });
const source = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const dirty = execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: root, encoding: "utf8" }).trim();
writeFileSync(join(out, "source.txt"), `${source}\n${dirty ? "tracked changes present at start:\n" + dirty : "clean tracked tree at start"}\n`);
writeFileSync(join(out, "exits.txt"), "");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const parts = pkg.scripts.test.split(" && ");
const names = ["scripts", "library", "agent"];
const run = (name, command) => {
  const started = Date.now();
  const r = spawnSync(command, { cwd: root, shell: true, encoding: "utf8", maxBuffer: 512 * 1024 * 1024, env: { ...process.env, FORCE_COLOR: "0" } });
  writeFileSync(join(out, `${name}.log`), (r.stdout ?? "") + (r.stderr ?? ""));
  appendFileSync(join(out, "exits.txt"), `${name} exit=${r.status} ms=${Date.now() - started}\n`);
  console.log(`${name} exit=${r.status}`);
};
run("pretest", "npm run pretest");
parts.forEach((part, i) => run(names[i] ?? `part${i + 1}`, part));
run("ui", "npm run test:ui");
run("typecheck", "npm run typecheck");
run("lint", "npm run lint");
run("build", "npm run build");
