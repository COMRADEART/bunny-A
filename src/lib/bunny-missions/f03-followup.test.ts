import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyDeviceWrite } from "./authorization.server.ts";

/**
 * M-A-3 T9R-F04: independent follow-up review of the F03 final-round fixes (F03-FOLLOWUP-1). The read-only-tool
 * exemption was a word match per pipe stage, so a runner was missed when a read-only word sat in an argument, a
 * trailing comment, a command substitution, or an earlier pipeline stage holding the glob. The F03 suite is unchanged.
 */
function project(files: Record<string, string>) {
  const base = mkdtempSync(join(tmpdir(), "bunny-f03fu-"));
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(join(base, path, ".."), { recursive: true });
    writeFileSync(join(base, path), body);
  }
  return base;
}
const SAFE = ["PHONE_SAFE_DOCUMENT", "PHONE_SAFE_DATA"];
function classify(files: Record<string, string>, path: string) {
  const base = project(files);
  try { return classifyDeviceWrite(path, { base, operation: "write", content: "plain words" }).classification; }
  finally { rmSync(base, { recursive: true, force: true }); }
}
const refused = (files: Record<string, string>, path: string) => { const result = classify(files, path); assert.ok(!SAFE.includes(result), `${path} must not be phone-safe (got ${result}) with ${JSON.stringify(files)}`); };
const allowed = (files: Record<string, string>, path: string) => { const result = classify(files, path); assert.ok(SAFE.includes(result), `${path} must stay phone-safe (got ${result}) with ${JSON.stringify(files)}`); };

test("F03-FOLLOWUP-1: a read-only word in an argument, comment, substitution or earlier pipe stage never exempts a runner", () => {
  refused({ Makefile: "docs:\n\tnode render.js *.md   # grep\n" }, "notes.md");
  refused({ Makefile: "docs:\n\tnode render.js $(ls *.md)\n" }, "notes.md");
  refused({ Makefile: "docs:\n\tnode render.js `ls *.md`\n" }, "notes.md");
  refused({ Makefile: "docs:\n\tls *.md | xargs -n1 node render.js\n" }, "notes.md");
  refused({ "build.sh": "find . -name '*.md' | grep -v draft | xargs python render.py\n" }, "notes/runbook.md");
  refused({ "package.json": JSON.stringify({ scripts: { docs: "ls **/*.md | xargs node render.js" } }) }, "notes/runbook.md");
  refused({ "package.json": JSON.stringify({ scripts: { docs: "node render.js **/*.md --reporter=wc" } }) }, "notes/runbook.md");
});

test("F03-FOLLOWUP-1: genuinely read-only statements and pipelines stay exempt", () => {
  allowed({ "package.json": JSON.stringify({ scripts: { fmt: "prettier --write **/*.md" } }) }, "notes/x.md");
  allowed({ "package.json": JSON.stringify({ scripts: { lint: "npx markdownlint-cli2 \"**/*.md\" && echo ok" } }) }, "notes/x.md");
  allowed({ "package.json": JSON.stringify({ scripts: { count: "ls **/*.md | wc -l" } }) }, "notes/x.md");
  allowed({ "package.json": JSON.stringify({ scripts: { spell: "pnpm exec cspell --no-progress **/*.md" } }) }, "notes/x.md");
  allowed({ "package.json": JSON.stringify({ scripts: { stage: "git add **/*.md" } }) }, "notes/x.md");
});

test("F03-FOLLOWUP-1 verification: separators, redirections, quotes, program options, paths, env and name globs all fail closed", () => {
  const make = (line: string) => ({ Makefile: "docs:\n\t" + line + "\n" });
  for (const line of [
    "ls *.md 2>&1 | xargs node render.js",
    "ls *.md \" #\" | xargs node render.js",
    "ls *.md \";\" | xargs node render.js",
    "rg --pre \"node render.js\" x *.md",
    "remark --use ./render.js *.md",
    "prettier --plugin=./render.js --write *.md",
    "./grep x *.md",
    "npx ./ls *.md",
    "PATH=./bin:$PATH ls *.md",
    "GIT_EXTERNAL_DIFF=./render.sh git diff *.md",
    "node render.js n*",
    "node render.js *.m?",
    "node render.js *.m[d]",
    "grep -l x *.md 2>&1 | node render.js",
    "ls *.md >list.txt 2>&1; xargs node render.js < list.txt",
  ]) refused(make(line), "notes.md");
  refused({ "package.json": JSON.stringify({ scripts: { x: "node -e \"1\"" }, "lint-staged": { "*.md": "node render.js" } }) }, "notes.md");
  refused({ "package.json": JSON.stringify({ scripts: { x: "node -e \"1\"" }, ava: { files: ["*.md"] } }) }, "notes.md");
  refused({ "package.json": JSON.stringify({ "lint-staged": { "*.md": "node render.js" } }) }, "notes.md");
  allowed(make("prettier --write *.md"), "notes.md");
  allowed(make("git diff --stat *.md"), "notes.md");
});

test("F03-FOLLOWUP-1 verification 2: multi-line statements, computed names, folder globs, option globs and config globs fail closed", () => {
  const BS = String.fromCharCode(92);
  refused({ "build.sh": "node render.js " + BS + "\nls *.md\n" }, "notes.md");
  refused({ Makefile: "docs:\n\tnode render.js " + BS + "\n\tls *.md\n" }, "notes.md");
  refused({ Makefile: "lint:\n\tls *.md" + BS + "\n\t| xargs node run.js\n" }, "notes.md");
  refused({ "build.sh": "node render.js \"\nls\" *.md\n" }, "notes.md");
  refused({ "package.json": JSON.stringify({ scripts: { docs: "node render.js " + BS + "\nls *.md" } }) }, "notes.md");
  refused({ ".github/workflows/ci.yml": "jobs:\n  d:\n    steps:\n      - run: >\n          ls *.md\n          | node render.js\n" }, "notes.md");
  refused({ "build.cmd": "grep -l x *.md ^\r\n| node render.js\r\n" }, "notes.md");
  for (const line of ["node render.js {notes,x}.md", "node render.js notes.{md,txt}", "node render.js \"notes\".md", "node render.js \"$N.md\"", "node ./*", "node **", ". ./*", "node *.{m{d,x},txt}", "node n[]o]tes.md", "markdownlint --rules *.md", "stylelint --custom-formatter n*.md", "git\tadd *.md", "git  add *.md"])
    refused({ "build.sh": line + "\n" }, "notes.md");
  refused({ "build.cmd": "set N=notes\r\nnode render.js %N%.md\r\n" }, "notes.md");
  refused({ Makefile: "N := notes\ndocs:\n\tnode render.js $(N).md\n" }, "notes.md");
  refused({ Makefile: "all: notes.html\n%.html: %.md\n\tnode render.js $< > $@\n" }, "notes.md");
  refused({ "build.cmd": "node render.js ARCHIT~1.MD\r\n" }, "architecture-decisions.md");
  refused({ "build.sh": "rem=1 && node render.js *.md\n" }, "notes.md");
  refused({ "pyproject.toml": "[tool.pytest.ini_options]\naddopts = \"--doctest-glob=*.m?\"\n" }, "notes.md");
  refused({ "pytest.ini": "[pytest]\ndoctest_glob = n*\n" }, "notes.md");
  refused({ "pytest.ini": "[pytest]\ndoctest_glob = *\n" }, "notes.md");
  // Still exempt: single-line, read-only, allow-listed options.
  allowed({ "build.sh": "prettier --check *.md\nwc -l *.md\n" }, "notes.md");
  allowed({ "build.cmd": "rem node render.js *.md\r\nprettier --write *.md\r\n" }, "notes.md");
});

test("F03-FOLLOWUP-1 verification 3: escapes, braces, PowerShell block-comment ends, suffix rules and collecting configs fail closed", () => {
  const BS = String.fromCharCode(92);
  refused({ "build.ps1": "<#\n#>node render.js *.md\n" }, "notes.md");
  for (const line of ["node render.js n" + BS + "otes.md", "node render.js notes" + BS + ".md", "node render.js notes.m" + BS + "d", "node render.js notes.m{d,}", "node render.js notes.m{,d}", "node render.js notes.{m{d,x},txt}", "node render.js $(echo notes).md", "node render.js [[:alpha:]]otes.m?", "node render.js notes.md."])
    refused({ "build.sh": line + "\n" }, "notes.md");
  refused({ "build.cmd": "node render.js notes.m^d\r\n" }, "notes.md");
  refused({ "build.sh": "node render.js archit~1.md.\n" }, "architecture-decisions.md");
  refused({ Makefile: ".md.html:\n\tnode render.js $< > $@\nall: x.html\n" }, "notes.md");
  refused({ "build.py": "import glob, os\nfiles = glob.glob('*.md')\nos.system('node r.js ' + files[0])\n" }, "notes.md");
  refused({ "tox.ini": "[testenv]\ncommands = mytool *.md\n" }, "notes.md");
  refused({ "tox.ini": "[testenv]\ncommands = node r.js {notes,x}.md\n" }, "notes.md");
  refused({ "pytest.ini": "[pytest]\npython_files = *.md\n" }, "notes.md");
  refused({ "package.json": JSON.stringify({ "lint-staged": { "*.md": "node render.js" } }) }, "notes.md");
  refused({ "package.json": JSON.stringify({ ava: { files: ["*.md"] } }) }, "notes.md");
  // Common read-only layouts stay exempt (verification 3 false positives).
  allowed({ ".github/workflows/ci.yml": "name: ci\njobs:\n  lint:\n    steps:\n      - run: |\n          npm ci\n          npx prettier --check \"**/*.md\"\n" }, "notes.md");
  allowed({ ".github/workflows/ci.yml": "jobs:\n  lint:\n    steps:\n      - run: npx prettier --check \"**/*.md\"\n" }, "notes.md");
  allowed({ "build.ps1": "Write-Host \"Don't stop\"\nprettier --check *.md\n" }, "notes.md");
  allowed({ Makefile: "lint:\n\t@echo \"it's linting\"\n\tprettier --check *.md\n" }, "notes.md");
  allowed({ "build.sh": "prettier --check *.md # lint\n" }, "notes.md");
  allowed({ "package.json": JSON.stringify({ name: "x", files: ["*.md"], scripts: { t: "echo ok" } }) }, "notes.md");
  allowed({ "package.json": JSON.stringify({ scripts: { lint: "markdownlint '**/*.md' --ignore node_modules", fmt: "prettier --write \"**/*.md\" --log-level warn" } }) }, "notes.md");
  allowed({ "package.json": JSON.stringify({ "lint-staged": { "*.md": "prettier --write" } }) }, "notes.md");
});

test("F03-FOLLOWUP-1: package.json scripts run under cmd.exe on Windows, where # is not a comment", () => {
  refused({ "package.json": JSON.stringify({ scripts: { docs: "node render.js # *.md" } }) }, "notes.md");
  refused({ "build.cmd": "node render.js # *.md\r\n" }, "notes.md");
  allowed({ "build.sh": "node render.js # *.md\n" }, "notes.md");
});

test("F03-FOLLOWUP-1 verification 4: cmd REM delimiters, executable package.json keys, folder-qualified escapes", () => {
  const BS = String.fromCharCode(92);
  for (const line of ["rem:x & node *.md", "rem-x & node *.md", "rem.x & node *.md", "rem/x & node *.md", "rem+x & node *.md"])
    refused({ "build.cmd": line + "\r\n" }, "hold.md");
  allowed({ "build.cmd": "rem node *.md\r\nrem, node *.md\r\n" }, "hold.md");
  refused({ "package.json": JSON.stringify({ exports: { "./*": "./*.md" } }) }, "hold.md");
  refused({ "package.json": JSON.stringify({ imports: { "#*": "./*/*.md" } }) }, "zq/hold.md");
  refused({ "package.json": JSON.stringify({ module: "./*.md" }) }, "hold.md");
  refused({ "build.sh": "node zq/ho" + BS + "ld.md\n" }, "zq/hold.md");
  refused({ "build.sh": "node zq/hold" + BS + ".md\n" }, "zq/hold.md");
  refused({ "build.cmd": "node zq" + BS + "ho^ld.md\r\n" }, "zq/hold.md");
  refused({ "build.cmd": "node zq" + BS + "h^old.md\r\n" }, "zq/hold.md");
});
