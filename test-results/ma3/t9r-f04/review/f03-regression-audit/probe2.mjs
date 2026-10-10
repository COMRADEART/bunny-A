import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const WT = await import("file:///C:/Users/allam/Documents/new/bun-router/src/lib/bunny-missions/authorization.server.ts");
const HEAD = await import("file:///C:/Users/allam/AppData/Local/Temp/claude/C--Users-allam-Documents-new-bun-router/a62fc04b-9e6f-4319-b7f7-44e7b997d5f5/scratchpad/head-authz.server.ts");
const SAFE = new Set(["PHONE_SAFE_DOCUMENT", "PHONE_SAFE_DATA"]);
function cls(mod, files, dest, content = "plain words") {
  const base = mkdtempSync(join(tmpdir(), "f03aud-"));
  try {
    for (const [p, body] of Object.entries(files)) { mkdirSync(join(base, p, ".."), { recursive: true }); writeFileSync(join(base, p), body); }
    return mod.classifyDeviceWrite(dest, { base, operation: "write", content }).classification;
  } catch (e) { return "THREW:" + e.message; } finally { rmSync(base, { recursive: true, force: true }); }
}
const cases = [
  ["NB-1 tox commands unnamed tool", { "tox.ini": "[testenv]\ncommands = mytool *.md\n" }, "notes.md"],
  ["NB-2 nox session.run unnamed tool", { "noxfile.py": "import nox\n@nox.session\ndef s(session):\n    session.run('mytool *.md')\n" }, "notes.md"],
  ["NB-3 py glob line + runner line (multi-line)", { "build.py": "import glob\nfiles = glob.glob('*.md')\nos.system('node r.js ' + files[0])\n" }, "notes.md"],
  ["NB-3b py glob and runner on separate lines, no runner keyword", { "build.py": "files = glob.glob('*.md')\nrender_all(files)\n" }, "notes.md"],
  ["NB-4 Makefile suffix rule .md.html", { Makefile: ".md.html:\n\tnode render.js $< > $@\nall: x.html\n" }, "notes.md"],
  ["NB-5 pre-commit files regex (pass_filenames)", { ".pre-commit-config.yaml": "repos:\n- repo: local\n  hooks:\n  - id: r\n    name: r\n    entry: node render.js\n    language: system\n    files: '\.md$'\n" }, "notes.md"],
  ["NB-6 pytest.ini python_files", { "pytest.ini": "[pytest]\npython_files = *.md\n" }, "notes.md"],
  ["NB-7 gha run block + read-only glob (FP check)", { ".github/workflows/ci.yml": "name: ci\njobs:\n  lint:\n    steps:\n      - run: |\n          npm ci\n          npx prettier --check \"**/*.md\"\n" }, "notes.md"],
  ["FP-1 ps1 apostrophe string + read-only glob", { "build.ps1": "Write-Host \"Don't stop\"\nprettier --check *.md\n" }, "notes.md"],
  ["FP-2 Makefile echo apostrophe + prettier glob", { Makefile: "lint:\n\t@echo \"it's linting\"\n\tprettier --check *.md\n" }, "notes.md"],
  ["FP-3 package.json files array *.md", { "package.json": JSON.stringify({ name: "x", files: ["*.md"], scripts: { t: "echo ok" } }) }, "notes.md"],
  ["FP-4 shell inline # after read-only glob", { "build.sh": "prettier --check *.md # lint\n" }, "notes.md"],
  ["FP-5 CI run: multi-line with block + unrelated apostrophe", { "ci.yml": "jobs:\n  a:\n    steps:\n      - run: |\n          echo ok\n" }, "docs/guide.md"],
  ["DATA-1 csv dest: unnamed glob in tox", { "tox.ini": "[testenv]\ncommands = mytool *.csv\n" }, "data/x.csv"],
  ["TXT-1 readme.txt dest: pytest doctest glob *.txt", { "pytest.ini": "[pytest]\ndoctest_glob = *.txt\n" }, "notes/readme.txt"],
  ["TXT-2 Makefile *.txt runner", { Makefile: "docs:\n\tnode r.js *.txt\n" }, "notes/readme.txt"],
  ["TXT-3 readme.txt in folder with pytest.ini doctest", { "pytest.ini": "[pytest]\ndoctest_glob = notes/*.txt\n" }, "notes/readme.txt"],
  ["CSV-1 makefile csv glob read-only", { Makefile: "stats:\n\twc -l data/*.csv\n" }, "data/x.csv"],
  ["CSV-2 makefile csv glob runner", { Makefile: "stats:\n\tpython load.py data/*.csv\n" }, "data/x.csv"],
  ["DOC-1 docs/guide.md: docs/ folder named in ps1 runner", { "build.ps1": "node r.js docs/*\n" }, "docs/guide.md"],
  ["DOC-2 docs/guide.md: mkdocs default docs dir", { "mkdocs.yml": "site_name: x\n" }, "docs/guide.md"],
  ["DOC-3 justfile dir glob", { justfile: "docs:\n    node r.js docs/*\n" }, "docs/guide.md"],
  ["DOC-4 vitepress folder", { ".vitepress/config.mts": "export default {}\n" }, "docs/guide.md"],
];
for (const [label, files, dest] of cases) {
  const h = cls(HEAD, files, dest), w = cls(WT, files, dest);
  console.log(w.padEnd(22), h.padEnd(22), dest.padEnd(18), label);
}
// Regression fuzz: random shell-ish lines, compare HEAD refused -> WT safe
const toks = ["prettier","--write","--check","-l","-w","--plugin=./p.js","*.md","notes.md","ls","wc","grep","git","add","diff","node","r.js","|","&&",";","&",">","2>&1","#","\"","'","$(ls *.md)","`ls`"," ","xargs","n*","{md,txt}","npx","exec","--","rem","::","-n","--cache","x.js","\\","sh","cat","**/*.md","ls *.md","-r","--rules","markdownlint","eslint","echo","[n]otes.md","./*","rg","--pre"];
let seed = 12345; const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
const wrappers = [["build.sh", (l) => l + "\n"], ["Makefile", (l) => "docs:\n\t" + l + "\n"], ["build.cmd", (l) => l + "\r\n"], ["build.ps1", (l) => l + "\n"], ["justfile", (l) => "x:\n    " + l + "\n"], ["ci.yml", (l) => "j:\n  s:\n    - run: " + JSON.stringify(l) + "\n"], ["package.json", (l) => JSON.stringify({ scripts: { x: l } })], ["tox.ini", (l) => "[testenv]\ncommands = " + l + "\n"]];
const regs = []; let total = 0, walked = { wtSafe: 0, headSafe: 0 };
for (let i = 0; i < 2500; i++) {
  const n = 1 + rnd(7); const parts = []; for (let k = 0; k < n; k++) parts.push(toks[rnd(toks.length)]);
  const line = parts.join(rnd(3) ? " " : "");
  const [wname, wf] = wrappers[rnd(wrappers.length)];
  const files = { [wname]: wf(line) };
  for (const dest of ["notes.md", "docs/guide.md", "notes/readme.txt", "data/x.csv"]) {
    total++;
    const h = cls(HEAD, files, dest), w = cls(WT, files, dest);
    if (SAFE.has(w)) walked.wtSafe++; if (SAFE.has(h)) walked.headSafe++;
    if (!SAFE.has(h) && SAFE.has(w)) regs.push({ wname, line, dest, head: h, wt: w });
  }
}
console.log("fuzz pairs", total, "wtSafe", walked.wtSafe, "headSafe", walked.headSafe, "REGRESSIONS", regs.length);
for (const r of regs.slice(0, 40)) console.log("REG", JSON.stringify(r));
