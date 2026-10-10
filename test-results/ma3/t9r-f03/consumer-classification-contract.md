# D1 consumer classification after T9R-F03

Implementation: `consumerOf()`, `folderRef()`, `consumerText()` and `classifyDeviceWrite()` in `src/lib/bunny-missions/authorization.server.ts`. This document extends `test-results/ma3/t9r-f02/file-classification-contract.md` (unchanged), and it replaces that file's item 11 ("consumer references").

**The classifier is risk reduction.** A gap lets a paired device *propose* a change with a phone-safe label. The change still stays inert in Host staging. It reaches the project only when the Windows Host owner promotes the exact reviewed bytes, and the bytes are re-classified at promotion, with content (F03).

## Which files are consumers

1. **The project root and every folder above the destination.**
   - Every file that is not a plain document (`.md`/`.txt`), not data (`.csv` …) and not opaque. Opaque means binary, media, office, e-book, database, lock, installer, `.sample`, `.DS_Store`, or generated `.html`/`.svg`/`.ipynb`.
   - A binary whose name is not a consumer name is skipped. Any name counts: `Dockerfile.dev`, compose override files, `Procfile`, `.cirrus.yml`, `app.csproj`, `site.config.json`, …
   - A `.txt` with package-installer directives (`-r`, `-e`, `--index-url` …) is a consumer.
   - Structured data inside a data folder is not a consumer.
2. **Anywhere in the project tree** (dependency and build-output folders skipped: `node_modules`, `vendor`, `dist`, `build`, `out`, `target`, `coverage`, `test-results`, `playwright-report`, `artifacts`, `release(s)`, …):
   - shell, CI, build, container and install files (`*.sh`, `*.ps1`, `*.bat`, `*.cmd`, `*.mk`, `*.yml`, `*.yaml`, `*.toml`, `*.cfg`, `*.ini`, `Makefile`, `justfile`, `Dockerfile*`, `Procfile*`, `Jenkinsfile`, `package.json`, `*requirements*.txt` …);
   - extensionless scripts that start with `#!`;
   - agent instruction files.
   - Linked folders are followed, once per real folder.
3. **Every text file inside the project's dot-folders**, except caches and tool downloads (`.git`, `.venv`, `.next`, `.vs`, `.vscode-test`, …), plus Git hooks in `.git/hooks`.
4. **Not consumers:** ignore lists, `.gitattributes`, `.obsidian` state.

## When a consumer references the destination

Text is normalized: JSON/JS `\uXXXX` escapes decoded, lowercase, `\` → `/`, `%2F`/`%5C` → `/`, and `./` and `//` collapsed. A consumer references the destination when it contains any of:

- the destination path, root-relative or relative to the consumer's folder;
- the destination file name as a token (this covers variable and quoted spellings such as `$D/x.txt`);
- a folder above the destination, *named as a folder*:
  - a path into it with a glob, variable, command or quote-split part: `docs/*.txt`, `ci/reqs-$(ENV).txt`, `docs/'x.txt'`;
  - the folder path itself: `docs/`, `docs/**`;
  - a whole quoted value that is not a key: `"docs"`, but not `"docs": …`;
  - an option or setting value: `--source=site`, `testpaths = docs`, `D: docs`;
  - a list item: `[docs]`, `{ci,tests}`, `- docs`;
  - in shell-run text, a bare command argument (`sphinx-build docs _build`). Assignments and keys (`data = $x`) are excluded, and so are comments. For `package.json`, only `scripts` count;
- a glob of the destination's extension:
  - in shell-run text, on any line unless that line names a read-only tool (prettier, markdownlint, eslint, cspell, vale, …). An unknown runner fails safe;
  - elsewhere, on a line that runs or collects files (`doctest_glob = "*.md"`, `wildcard`, `for … in`, `sh`, `python`, `pytest`, …);
- for Markdown, a `markdown-docs` reference (pytest-markdown-docs).

Agent instruction files count exact paths and file names only.

## Other rules

- **Markdown site generators:** a `.vitepress` folder in the root or any folder above the destination, or MkDocs `docs_dir` (default `docs/`), makes Markdown under it `EXECUTION_RELEVANT`.
- **Folder role:** a folder below the root that also holds a program or tool file (`docs/conf.py`, `*.toml`, `Makefile` …) is a folder some tool works in → `EXECUTION_RELEVANT`.
- **Content** (new content and, at promotion, the staged bytes) → `EXECUTION_RELEVANT`:
  - program starts and ESM `import`/`export` lines;
  - `<script` anywhere;
  - Templater `<% … %>`;
  - DataviewJS, meta-bind-js, js-engine and templater fences;
  - MyST/reST executable directives;
  - doctest `>>>` prompts;
  - pinned requirement lines (`pkg==1.0`);
  - installer directives.
- **Names:** `test*.txt` (pytest's default doctest collection) → `EXECUTION_RELEVANT`.
- **Precedence:** an agent-instruction reference wins over a tool reference (`AGENT_INSTRUCTIONS` rather than `EXECUTION_RELEVANT`).
- **Fail closed (`UNKNOWN`):**
  - a linked consumer (a link to a folder is skipped);
  - a consumer over 1 MiB, unless it is a skipped binary (F02 contract);
  - unreadable text, UTF-32, or NUL-bearing non-UTF-16 text;
  - more than 2000 consumers, or a tree deeper than 32;
  - a linked folder that cannot be resolved;
  - a computed glob (`$VAR/*`, `$(cmd)/*`) in an automatically run consumer: root and ancestor files, dot-folder CI, hook and editor files, Git hooks.

Tabular data whose cells look like spreadsheet formulas stays `PHONE_SAFE_DATA` but carries a review warning.

**Backstop scope.** Promotion-time re-classification refuses non-phone-safe classes only for changes staged under a paired-device (remote) envelope. Under a workstation envelope, the owner's review of the exact bytes is the control.

## Documented residuals (disclosed, not claimed)

- a path built from both a computed folder and a computed file name;
- computed paths inside JS/TS/Python program code;
- folder-level mentions in agent-instruction prose;
- references via `../` from sibling folders;
- programs outside the project, or in skipped dependency and output folders;
- literal paths inside program code (`readFileSync("notes/x.md")` in `scripts/*.mjs`). This is the F02 R3-7 disposition: PHONE_SAFE is an inertness claim, and programs may read any file;
- **the heuristic class itself:** a tool or convention that consumes a file by default, without naming it in any project file the scan reads. The independent reviews found such families round after round (pytest defaults, MkDocs, VitePress, Obsidian plugins); each found family was repaired, but the class is open-ended;
- prose in shell text that happens to be a bare folder word, which over-refuses (fail-safe);
- a consumer-named YAML/TOML file over 1 MiB makes every write `UNKNOWN` (fail-safe).

In this repository, `data/` writes are refused because of the prose "Host data" in `scripts/install-bunny-release.ps1`. `notes/`, `docs/`, `reports/` and root `.md` writes stay phone-safe.
