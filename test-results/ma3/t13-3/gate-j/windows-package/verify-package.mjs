// M-A-3 T13.3 Gate J: copied from gate-i/windows-package/verify-package.mjs with gate-i paths changed to gate-j.
// M-A-3 T13.3 Gate I: verifies the built test package (file hashes, import closure, source match) and records it with
// the packaged end-to-end receipt. Nothing is installed or published.
// Run from the repository root: node test-results/ma3/t13-3/gate-j/windows-package/verify-package.mjs <packageName>
import { copyFileSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";

const name = process.argv[2];
if (!name) throw new Error("Usage: verify-package.mjs <packageName>");
const here = resolve("test-results/ma3/t13-3/gate-j/windows-package");
const pkg = join(here, name);
const release = (...args) => {
  const run = execFileSync(process.execPath, ["scripts/bunny-release.mjs", ...args], { encoding: "utf8" });
  return JSON.parse(run);
};
const manifest = JSON.parse(readFileSync(join(pkg, "release-manifest.json"), "utf8"));
const verification = { files: release("verify", pkg), closure: release("closure", pkg), source: release("source-check", process.cwd(), pkg) };
const archive = `${pkg}.zip`;
const e2e = JSON.parse(readFileSync(resolve("test-results/ma3/t13-3/gate-j/e2e/package-e2e.json"), "utf8"));
const result = {
  release: manifest.release,
  version: manifest.version,
  sourceCommit: manifest.sourceCommit,
  toolingCommit: manifest.toolingCommit,
  archive: {
    path: `test-results/ma3/t13-3/gate-j/windows-package/${name}.zip`,
    bytes: statSync(archive).size,
    sha256: createHash("sha256").update(readFileSync(archive)).digest("hex"),
  },
  verification,
  packagedEndToEnd: { result: e2e.result, packaged: e2e.packaged, checks: e2e.checks.length, passed: e2e.checks.filter((check) => check.ok).length },
  installed: false,
  published: false,
};
copyFileSync(join(pkg, "release-manifest.json"), join(here, "release-manifest.json"));
writeFileSync(join(here, "package-results.json"), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
if (!Object.values(verification).every((check) => check.ok) || e2e.result !== "PASS") process.exitCode = 1;
