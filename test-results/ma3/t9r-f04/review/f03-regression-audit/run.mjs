import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
const WT = await import("file:///C:/Users/allam/Documents/new/bun-router/src/lib/bunny-missions/authorization.server.ts");
const HEAD = await import("file:///C:/Users/allam/AppData/Local/Temp/claude/C--Users-allam-Documents-new-bun-router/a62fc04b-9e6f-4319-b7f7-44e7b997d5f5/scratchpad/head-authz.server.ts");
const SAFE = new Set(["PHONE_SAFE_DOCUMENT", "PHONE_SAFE_DATA"]);
const DESTS = ["notes.md", "docs/guide.md", "data/x.csv", "notes/readme.txt"];
function classify(mod, files, dest) {
  const base = mkdtempSync(join(tmpdir(), "f03aud-"));
  try {
    for (const [p, body] of Object.entries(files)) { mkdirSync(join(base, p, ".."), { recursive: true }); writeFileSync(join(base, p), body); }
    return mod.classifyDeviceWrite(dest, { base, operation: "write", content: "plain words" }).classification;
  } catch (e) { return "THREW:" + e.message; } finally { rmSync(base, { recursive: true, force: true }); }
}
const L = [
 "prettier --write *.md", "prettier --check *.md", "markdownlint-cli2 \"**/*.md\"", "wc -l *.md", "ls *.md | wc -l",
 "git diff --stat *.md", "git add *.md", "grep -l x *.md", "node render.js *.md", "ls *.md | xargs node render.js",
 "pandoc *.md -o out.html", "cat *.md | sh", "eslint *.md", "cspell \"**/*.md\"", "rg foo docs/*.md",
 "node render.js docs/*.md", "vale --config=.vale.ini *.md", "prettier --plugin ./p.js --write *.md", "prettier --write --config ./x.json *.md",
 "markdownlint --config .markdownlint.json *.md", "textlint *.md", "remark *.md -o", "cat notes.md | node run.js",
 "for f in *.md; do node r.js $f; done", "find . -name '*.md' -exec node r.js {} \;", "ls docs/", "npx prettier --write docs/",
 "npm run build -- notes.md", "python -m pytest --doctest-glob='*.md'", "./scripts/render notes.md", "echo done",
 "wc -l notes.md", "node render.js notes.md", "prettier --write notes.md", "node render.js \"notes.md\"", "prettier --write \"*.md\"",
 "ls -la *.md", "grep -n x *.md 2>/dev/null", "prettier --check *.md # lint", "prettier --check *.md && node render.js", "node render.js; ls *.md",
 "git add -A *.md", "git diff *.md | node r.js", "git status *.md", "prettier --write `ls *.md`", "prettier --write $(ls *.md)",
];
const WRAP = {
 "Makefile": (l) => `docs:\n\t${l}\n`,
 "build.sh": (l) => `#!/bin/sh\n${l}\n`,
 "build.ps1": (l) => `${l}\n`,
 "build.cmd": (l) => `${l}\r\n`,
 "ci.yml": (l) => `jobs:\n  b:\n    steps:\n      - run: ${l}\n`,
 "justfile": (l) => `docs:\n    ${l}\n`,
 "Dockerfile": (l) => `FROM node\nRUN ${l}\n`,
 ".pre-commit-config.yaml": (l) => `repos:\n- repo: local\n  hooks:\n  - id: x\n    entry: ${l}\n`,
 "package.json": (l) => JSON.stringify({ scripts: { x: l } }),
 "tox.ini": (l) => `[testenv]\ncommands = ${l}\n`,
 "noxfile.py": (l) => `import nox\n@nox.session\ndef s(session):\n    session.run("${l.replace(/"/g, "'")}")\n`,
 "mkdocs.yml": (l) => `site_name: x\n# ${l}\n`,
};
const CFG = { "pytest.ini": (g) => `[pytest]\ndoctest_glob = ${g}\n`, "pyproject.toml": (g) => `[tool.pytest.ini_options]\naddopts = "--doctest-glob=${g}"\n`, "setup.cfg": (g) => `[tool:pytest]\naddopts = --doctest-glob=${g}\n`, "package.json:lint": (g) => JSON.stringify({ "lint-staged": { [g]: "node render.js" } }) };
const GLOBS = ["*.md", "*.m?", "n*", "*", "**/*.md", "notes.md", "[n]otes.md", "*.{md,txt}", "*.txt"];
const fixtures = [];
for (const [name, wrap] of Object.entries(WRAP)) for (const l of L) fixtures.push({ id: `${name} :: ${l}`, files: { [name]: wrap(l) } });
for (const g of GLOBS) for (const [name, f] of Object.entries(CFG)) fixtures.push({ id: `${name} :: ${g}`, files: { [name.split(":")[0]]: f(g) } });
// Multi-line / extras
fixtures.push({ id: "build.sh multi backslash", files: { "build.sh": "node render.js \\nls *.md\n" } });
fixtures.push({ id: "build.sh quoted-newline", files: { "build.sh": "node render.js \"\nls\" *.md\n" } });
fixtures.push({ id: "build.sh rem=1", files: { "build.sh": "rem=1 && node render.js *.md\n" } });
fixtures.push({ id: "build.sh \t git add", files: { "build.sh": "git\tadd *.md\n" } });
fixtures.push({ id: "build.cmd rem node", files: { "build.cmd": "rem node render.js *.md\r\nprettier --write *.md\r\n" } });
fixtures.push({ id: "build.cmd :: node", files: { "build.cmd": ":: node render.js *.md\r\nprettier --write *.md\r\n" } });
fixtures.push({ id: "build.sh #-comment then runner", files: { "build.sh": "# ok\nnode render.js *.md\n" } });
fixtures.push({ id: "Makefile env assign", files: { Makefile: "docs:\n\tPATH=./bin:$$PATH ls *.md\n" } });
fixtures.push({ id: "Makefile tab cmd", files: { Makefile: "docs:\n\t@node render.js *.md\n" } });
fixtures.push({ id: "js config", files: { "render.config.js": "module.exports={files:'*.md'}\n" } });
fixtures.push({ id: "ps1 foreach", files: { "build.ps1": "Get-ChildItem *.md | ForEach-Object { node render.js $_ }\n" } });
fixtures.push({ id: "ps1 comment runner", files: { "build.ps1": "# node r.js *.md\nwc -l *.md\n" } });
fixtures.push({ id: "gha run multi-line", files: { ".github/workflows/ci.yml": "jobs:\n  d:\n    steps:\n      - run: |\n          ls *.md\n          node r.js\n" } });
fixtures.push({ id: "gha run folded", files: { ".github/workflows/ci.yml": "jobs:\n  d:\n    steps:\n      - run: >\n          ls *.md | node r.js\n" } });
fixtures.push({ id: "pkg lint-staged", files: { "package.json": JSON.stringify({ "lint-staged": { "*.md": "node r.js" } }) } });
fixtures.push({ id: "pkg ava files", files: { "package.json": JSON.stringify({ ava: { files: ["*.md"] } }) } });
fixtures.push({ id: "pkg name only", files: { "package.json": JSON.stringify({ name: "x", scripts: { a: "echo" } }) } });
fixtures.push({ id: "justfile dir glob", files: { justfile: "docs:\n    node r.js docs/*\n" } });
fixtures.push({ id: "tox multi-line", files: { "tox.ini": "[testenv]\ncommands =\n    prettier --check *.md\n    node r.js *.md\n" } });
const results = [];
for (const fx of fixtures) for (const dest of DESTS) {
  const h = classify(HEAD, fx.files, dest), w = classify(WT, fx.files, dest);
  results.push({ id: fx.id, dest, head: h, wt: w });
}
const cnt = (pred) => results.filter(pred).length;
console.log("fixtures", fixtures.length, "pairs", results.length);
console.log("REGRESSION (HEAD unsafe, WT safe):", cnt(r => !SAFE.has(r.head) && SAFE.has(r.wt)));
console.log("WT safe (any):", cnt(r => SAFE.has(r.wt)), " HEAD safe:", cnt(r => SAFE.has(r.head)));
console.log("BOTH safe:", cnt(r => SAFE.has(r.head) && SAFE.has(r.wt)));
console.log("THREW:", cnt(r => String(r.wt).startsWith("THREW") || String(r.head).startsWith("THREW")));
const out = join(dirname(new URL(import.meta.url).pathname.slice(1)), "results.json");
writeFileSync(out, JSON.stringify(results, null, 1));
for (const r of results.filter(r => SAFE.has(r.wt))) console.log("WT-SAFE", r.dest, "|", r.id, "| head=", r.head, "wt=", r.wt);
for (const r of results.filter(r => !SAFE.has(r.head) && SAFE.has(r.wt))) console.log("REG", r.dest, "|", r.id);
