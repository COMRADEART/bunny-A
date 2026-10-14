// M-A-3 T13.2 byte seal for retained evidence (adapted from t13-1/seal-evidence.mjs). Package folders/archives are pinned by
// package-results.json and the copied release manifest, not committed. Source commit comes from regression-summary.json.
// Usage: node test-results/ma3/t13-2/seal-evidence.mjs --write | --verify
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { createHash } from "node:crypto";

const ev = resolve(import.meta.dirname), root = resolve(ev, "../../..");
const sha = (data) => createHash("sha256").update(data).digest("hex");
const index = join(ev, "INDEX.md"), seal = join(ev, "INDEX.sha256");
const allowedRootFiles = new Set([".gitattributes", "MA3_T13_2_UNIFIED_ACCOUNTS_ACCEPTANCE.md", "docs/t13-2/BUNNY_A_T13_2_DESIGN.md"]);
const sourceCommit = JSON.parse(readFileSync(join(ev, "regression-summary.json"), "utf8")).sourceCommit;
const checked = (rel) => {
  const absolute = resolve(root, rel);
  if (!absolute.startsWith(ev + sep) && !allowedRootFiles.has(rel)) throw Error("Seal path is outside T13.2 evidence");
  return absolute;
};
if (process.argv[2] === "--verify") {
  const entries = readFileSync(seal, "utf8").trim().split(/\r?\n/).map((line) => {
    const m = /^([0-9a-f]{64})  (.+)$/.exec(line);
    if (!m) throw Error("Malformed seal line");
    return { sha256: m[1], path: m[2] };
  });
  const failures = entries.filter((entry) => sha(readFileSync(checked(entry.path))) !== entry.sha256);
  if (failures.length) throw Error("Seal mismatch: " + failures.map((x) => x.path).join(", "));
  console.log(JSON.stringify({ result: "PASS", checked: entries.length, sourceCommit }));
} else if (process.argv[2] === "--write") {
  const files = [];
  const walk = (directory) => {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name), stat = statSync(path);
      if (stat.isDirectory()) {
        if (/^(?:windows-package|source-checkout$|node_modules$|temp$|tmp-)/.test(name)) continue;
        walk(path);
      } else if (!/credentials|\.sqlite(?:-|$)|\.wav$/i.test(name) && path !== index && path !== seal && /\.(?:md|mjs|mts|ps1|json|jsonl|log|txt|png|jpg)$/i.test(name)) files.push(path);
    }
  };
  walk(ev);
  files.push(...[...allowedRootFiles].map((name) => join(root, name)));
  const paths = files.map((path) => relative(root, path).replaceAll("\\", "/")).sort();
  writeFileSync(index, [
    "# MA3 T13.2 retained evidence index", "",
    `Final executable source: ${sourceCommit}. The local evidence commit is separate.`,
    "This index and every listed artifact are byte-sealed in INDEX.sha256.",
    "",
    "Evidence categories used throughout: LIVE VERIFIED, SIMULATED, STATIC VERIFIED, NOT TESTED.",
    "Settings screenshots use isolated development or the exact test package. API fields are empty and identities masked.",
    "Keys used in tests are synthetic. Live provider inference and hosted Jev inference were not performed.",
    "Provider sessions, metadata transport and new Laya inference are SIMULATED or NOT TESTED, as recorded in acceptance.",
    "Package folders/archives are excluded; package-results.json pins them. Production was not installed, migrated or restarted.",
    "",
    "Verify from the repository with node test-results/ma3/t13-2/seal-evidence.mjs --verify.",
    "",
    "Retained artifacts: " + paths.length + ".", "",
    ...paths.map((path) => "- [" + path + "](" + relative(ev, join(root, path)).replaceAll("\\", "/") + ")"),
    "",
  ].join("\n"));
  const sealedPaths = [...paths, relative(root, index).replaceAll("\\", "/")].sort();
  writeFileSync(seal, sealedPaths.map((path) => sha(readFileSync(checked(path))) + "  " + path).join("\n") + "\n");
  console.log(JSON.stringify({ result: "WRITTEN", artifacts: sealedPaths.length }));
} else throw Error("Use --write or --verify");
