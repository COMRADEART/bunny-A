// Repeat only the failed script lane after staging its missing local license dependency. Same final source pin.
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const root = process.argv[2];
const ev = join(import.meta.dirname, "regression-clean-final");
const source = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
if (source !== "8145377880fa4ab330238db827fa488430b2328d") throw Error("Wrong verification source");
copyFileSync(join(ev, "scripts.log"), join(ev, "scripts-before-license.log"));
copyFileSync(join(ev, "exits.txt"), join(ev, "exits-before-license.txt"));
const command = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).scripts.test.split(" && ")[0];
const began = Date.now();
const r = spawnSync(command, { cwd: root, shell: true, encoding: "utf8", maxBuffer: 512 * 1024 * 1024, env: { ...process.env, FORCE_COLOR: "0" } });
writeFileSync(join(ev, "scripts.log"), (r.stdout ?? "") + (r.stderr ?? ""));
const exits = readFileSync(join(ev, "exits.txt"), "utf8").replace(/^scripts exit=.*$/m, `scripts exit=${r.status} ms=${Date.now()-began} rerun=after-local-license-staging`);
writeFileSync(join(ev, "exits.txt"), exits);
writeFileSync(join(ev, "script-lane-rerun.json"), JSON.stringify({ sourceCommit: source, reason: "Existing Node runtime license staged into isolated checkout; no application source/dependency version changed", exit: r.status, durationMs: Date.now()-began }, null, 2) + "\n");
console.log(JSON.stringify({ sourceCommit: source, scriptsExit: r.status }));
process.exitCode = r.status ?? 1;
