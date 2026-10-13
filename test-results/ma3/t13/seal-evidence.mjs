// M-A-3 T13 byte seal for retained evidence (adapted from t12/seal-evidence.mjs). Package binaries are pinned by the copied
// release manifest, not recommitted. The source commit is read from regression-summary.json.
// Usage: node test-results/ma3/t13/seal-evidence.mjs --write | --verify
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { resolve, join, relative, sep } from "node:path";
import { createHash } from "node:crypto";
const ev = resolve(import.meta.dirname), root = resolve(ev, "../../..");
const sha = (data) => createHash("sha256").update(data).digest("hex");
const index = join(ev, "INDEX.md"), seal = join(ev, "INDEX.sha256");
const allowedRootFiles = new Set(["MA3_T13_UI_UX_MASTERY_ACCEPTANCE.md", ".gitattributes", "docs/t13/T13_FINAL_INDEPENDENT_REVIEW.md", "docs/t13/T13_VERIFICATION_EVIDENCE_AUDIT.md"]);
const sourceCommit = JSON.parse(readFileSync(join(ev, "regression-summary.json"), "utf8")).sourceCommit;
const checked = (rel) => {
  const absolute = resolve(root, rel);
  if (!absolute.startsWith(ev + sep) && !allowedRootFiles.has(rel)) throw Error("Seal path is outside T13 evidence");
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
        if (/^(?:windows-package-|source-checkout$|node_modules$|temp$|tmp-)/.test(name)) continue;
        walk(path);
      } else if (!/credentials|\.sqlite(?:-|$)|\.wav$/i.test(name) && path !== index && path !== seal && /\.(?:md|mjs|mts|ps1|json|jsonl|log|txt|out|png|jpg)$/i.test(name)) files.push(path);
    }
  };
  walk(ev);
  files.push(...[...allowedRootFiles].map((name) => join(root, name)));
  const paths = files.map((path) => relative(root, path).replaceAll("\\", "/")).sort();
  writeFileSync(index, [
    "# MA3 T13 retained evidence index", "",
    `Final executable/tooling source: ${sourceCommit}.`,
    "The local evidence commit is separate. This index and every listed artifact are byte-sealed in INDEX.sha256.",
    "",
    "Character art provenance: assets/t13/source (user original), assets/t13/derived/manifest.json (derivatives).",
    "Fixture screenshots are labeled fixture; live Host-backed captures are labeled live. Browser phone captures are",
    "browser simulation, not physical-phone acceptance. Package folders/archives are excluded; package/ pins them.",
    "No credentials or private transcripts are included. Production was not installed, migrated or restarted.",
    "",
    "Verify from the repository with node test-results/ma3/t13/seal-evidence.mjs --verify.",
    "",
    "Retained artifacts: " + paths.length + ".", "",
    ...paths.map((path) => "- [" + path + "](" + relative(ev, join(root, path)).replaceAll("\\", "/") + ")"),
    "",
  ].join("\n"));
  const sealedPaths = [...paths, relative(root, index).replaceAll("\\", "/")].sort();
  writeFileSync(seal, sealedPaths.map((path) => sha(readFileSync(checked(path))) + "  " + path).join("\n") + "\n");
  console.log(JSON.stringify({ result: "WRITTEN", artifacts: sealedPaths.length }));
} else throw Error("Use --write or --verify");
