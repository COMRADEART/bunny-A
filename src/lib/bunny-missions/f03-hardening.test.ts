import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostDatabase } from "../bunny-host/persistence.server.ts";
import { ModelCapabilityRegistry } from "../bunny-host/model-capability.server.ts";
import { TaskManager } from "../bunny-host/manager.server.ts";
import { providerBase } from "../bunny-host/adapters.server.ts";
import type { AdapterHooks, AdapterResult, ProviderAdapter } from "../bunny-host/contracts.ts";
import type { OrchTask, ProviderId, ProviderLive } from "../orch/types.ts";
import { MissionManager } from "./manager.server.ts";
import { missionCommand } from "./commands.server.ts";
import { FilesystemCapability, NotificationsCapability, TerminalCapability } from "./capabilities/local.server.ts";
import type { CapabilityAdapter } from "./capabilities/bus.server.ts";
import { classifyDeviceWrite } from "./authorization.server.ts";
import type { PermissionRequest } from "./types.ts";
import { createHash } from "node:crypto";

/**
 * M-A-3 T9R-F03: consumer-classification hardening (F02 round-5 MEDIUMs) and the F02 round-5 LOW repairs.
 * The fixtures are copied from f02-staging.test.ts (unchanged there) so the F02 suite stays as accepted.
 */
const PHONE = "device:f02-phone";

function ready(id: ProviderId): ProviderLive {
  return { ...providerBase(id), installed: true, authenticated: true, availability: "ready", capabilities: ["filesystem", "terminal", "text"], current_model: null };
}
type Launched = { task: OrchTask; finish: (result: AdapterResult) => void; hooks: AdapterHooks };
function fakeAdapter(id: ProviderId, launched: Launched[]): ProviderAdapter {
  return { id, detect: async () => ready(id), launch: (task, hooks) => {
    let finish!: (result: AdapterResult) => void; const done = new Promise<AdapterResult>((resolve) => (finish = resolve));
    launched.push({ task, finish, hooks });
    return { done, stop: async () => finish({ ok: false, output: "", stopped: true }) };
  } };
}
const until = async (check: () => boolean, label: string, timeout = 15000) => {
  const start = Date.now();
  while (!check()) { if (Date.now() - start > timeout) throw new Error(`Timed out waiting for ${label}`); await new Promise((r) => setTimeout(r, 10)); }
};
const settle = (ms = 150) => new Promise((r) => setTimeout(r, ms));
async function open(dir: string, root: string, providers: ProviderId[], launched: Launched[], adapters?: CapabilityAdapter[]) {
  const db = new HostDatabase(join(dir, "host.sqlite"));
  const tasks = new TaskManager(db, root, providers.map((id) => fakeAdapter(id, launched)), { modelRegistry: new ModelCapabilityRegistry(db, { availableProviders: () => [] }) });
  await tasks.discover();
  const missions = new MissionManager(tasks, { dataDirectory: dir, adapters: adapters ?? [new FilesystemCapability(), new TerminalCapability(), new NotificationsCapability(() => {})] });
  missions.configure({ enabled: true }, "workstation");
  await missions.bus.refreshHealth();
  return { db, tasks, missions };
}
/** Project root is dir/project unless `broadRoot`, which makes the whole Host data folder's parent the project root. */
async function setup(options: { broadRoot?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "bunny-f02-"));
  const root = options.broadRoot ? dir : join(dir, "project");
  mkdirSync(root, { recursive: true });
  const launched: Launched[] = [];
  let current = await open(dir, root, ["claude"], launched);
  const env = {
    dir, root, launched,
    get db() { return current.db; }, get tasks() { return current.tasks; }, get missions() { return current.missions; },
    /** A real Host restart over the same SQLite state: new TaskManager and MissionManager, new epoch. */
    restart: async () => { await current.missions.close(); current.db.close(); current = await open(dir, root, ["claude"], launched); },
    cleanup: async () => { for (const session of launched) session.finish({ ok: false, output: "", stopped: true }); await settle(60); await current.missions.close(); try { current.db.close(); } catch { /* closed */ } rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); },
  };
  return env;
}
type Env = Awaited<ReturnType<typeof setup>>;

const phoneApprove = (env: Env, id: string, start = true, plan?: string) => missionCommand(env.missions, "mission.approve", { id, start, ...(plan ? { plan } : {}) }, { local: false, actor: PHONE });
const writeStep = (path: string, content: string, extra: Record<string, unknown> = {}) => ({
  key: "write", role: "Write", objective: `write ${path}`, dependsOn: [], executor: { kind: "capability", action: "filesystem.write", params: { path, content, overwrite: true } },
  verification: [{ kind: "file_exists", path, contains: content }], maxRetries: 0, ...extra,
});
/** A Mission whose one step is a phone-attributed write once the phone approves it. */
const writeMission = (env: Env, path: string, content: string, extra: Record<string, unknown> = {}) =>
  env.missions.create({ objective: `Write ${path}`, mode: "fast", origin: "workstation", steps: [writeStep(path, content, extra)] });
const requestsOf = (env: Env, missionId: string) => env.missions.store.requests(missionId);
const openRequests = (env: Env, missionId: string) => requestsOf(env, missionId).filter((request) => !request.resolvedAt);
const promotionAsk = (env: Env, missionId: string) => openRequests(env, missionId).find((request) => request.promotion);
async function waitPromotion(env: Env, missionId: string): Promise<PermissionRequest> {
  await until(() => !!promotionAsk(env, missionId), "promotion ask");
  return promotionAsk(env, missionId)!;
}
const stagedFor = (env: Env, missionId: string) => env.missions.staging.forMission(missionId);
const stepsOf = (env: Env, missionId: string) => env.missions.store.steps(missionId);

// ── Fixture projects for the D1 consumer scan ────────────────────────────────
function project(files: Record<string, string | Buffer>) {
  const base = mkdtempSync(join(tmpdir(), "bunny-f03-"));
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(join(base, path, ".."), { recursive: true });
    writeFileSync(join(base, path), body);
  }
  return base;
}
const kind = (base: string, path: string, content = "plain words") => classifyDeviceWrite(path, { base, operation: "write", content }).classification;
const SAFE = ["PHONE_SAFE_DOCUMENT", "PHONE_SAFE_DATA"];
function refused(files: Record<string, string | Buffer>, path: string, content = "plain words") {
  const base = project(files);
  try { const result = kind(base, path, content); assert.ok(!SAFE.includes(result), `${path} must not be phone-safe (got ${result}) with ${Object.keys(files).join(", ")}`); return result; }
  finally { rmSync(base, { recursive: true, force: true }); }
}
function allowed(files: Record<string, string | Buffer>, path: string, content = "plain words") {
  const base = project(files);
  try { const result = kind(base, path, content); assert.ok(SAFE.includes(result), `${path} must stay phone-safe (got ${result}) with ${Object.keys(files).join(", ")}`); return result; }
  finally { rmSync(base, { recursive: true, force: true }); }
}
const utf16le = (text: string) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);
const utf16be = (text: string) => Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(text, "utf16le").swap16()]);
const utf32le = (text: string) => { const out = Buffer.alloc(4 + text.length * 4); out.set([0xff, 0xfe, 0, 0]); for (let i = 0; i < text.length; i++) out.writeUInt32LE(text.charCodeAt(i), 4 + i * 4); return out; };

test("F03-C1: glob, quoted and variable spellings in CI and install steps make the destination non-phone-safe", () => {
  refused({ ".github/workflows/ci.yml": "jobs:\n  a:\n    steps:\n      - run: for f in docs/*.txt; do sh \"$f\"; done\n" }, "docs/evil.txt", "echo pwned");
  refused({ ".gitlab-ci.yml": "build:\n  script:\n    - sh docs/'evil.txt'\n" }, "docs/evil.txt", "echo pwned");
  refused({ ".github/workflows/ci.yml": "env:\n  D: docs\nsteps:\n  - run: sh \"$D/x.txt\"\n" }, "docs/x.txt", "echo pwned");
  refused({ ".github/workflows/ci.yml": "steps:\n  - run: pip install -r docs/*.txt\n" }, "docs/deps.txt", "left-pad-evil==1.0");
  assert.equal(refused({ "Makefile": "all:\n\tfor f in $(DIR)/*; do sh $$f; done\n" }, "notes/x.md"), "UNKNOWN", "a computed glob in a shell-run consumer cannot be checked");
});

test("F03-C2: folder-level tool configuration and executable documentation make the folder's documents non-phone-safe", () => {
  refused({ "pyproject.toml": "[tool.pytest.ini_options]\ntestpaths = [\"docs\"]\ndoctest_glob = \"*.md\"\n" }, "docs/evil.md", "# Notes\n>>> import os; os.system('id')\n");
  refused({ "docs/conf.py": "extensions = ['myst_nb']\n" }, "docs/index.md");
  refused({ "README.md": "# app" }, "docs/index.md", "# Title\n\n```{code-cell} python\nimport os\n```\n");
  refused({ "README.md": "# app" }, "docs/run.md", "# Title\n\n.. jupyter-execute::\n\n   print(1)\n");
  refused({ ".github/workflows/docs.yml": "steps:\n  - run: sphinx-build docs _build\n" }, "docs/page.md");
});

test("F03-C3: consumers of any name are scanned (Dockerfile variants, compose overrides, Procfile, Cirrus, Semaphore, VS Code tasks)", () => {
  refused({ "Dockerfile.dev": "RUN sh docs/install.txt\n" }, "docs/install.txt", "echo pwned");
  refused({ "docker-compose.override.yml": "services:\n  web:\n    command: sh docs/start.txt\n" }, "docs/start.txt", "echo pwned");
  refused({ ".cirrus.yml": "task:\n  script: sh docs/x.txt\n" }, "docs/x.txt", "echo pwned");
  refused({ ".semaphore/semaphore.yml": "blocks:\n  - task:\n      jobs:\n        - commands:\n            - sh docs/x.txt\n" }, "docs/x.txt", "echo pwned");
  refused({ "Procfile": "web: sh docs/start.txt\n" }, "docs/start.txt", "echo pwned");
  refused({ ".vscode/tasks.json": JSON.stringify({ tasks: [{ command: "sh notes/run.txt" }] }) }, "notes/run.txt", "echo pwned");
});

test("F03-C4: UTF-16 consumers are read; UTF-32 and other NUL-bearing consumers fail closed", () => {
  const csproj = "<Project><Target Name=\"x\" BeforeTargets=\"Build\"><Exec Command=\"sh docs/x.txt\"/></Target></Project>";
  refused({ "app.csproj": utf16le(csproj) }, "docs/x.txt", "echo pwned");
  refused({ "app.csproj": utf16be(csproj) }, "docs/x.txt", "echo pwned");
  assert.equal(refused({ "app.csproj": utf32le(csproj) }, "docs/x.txt", "echo pwned"), "UNKNOWN");
  assert.equal(refused({ "Procfile": Buffer.from([0x77, 0x65, 0x62, 0x00, 0x3a]) }, "notes/x.md"), "UNKNOWN");
  // A binary cache file inside a scanned dot-folder is skipped, not fatal.
  allowed({ ".tanstack/tmp/blob": Buffer.from([0, 1, 2, 3, 0, 0, 7]) }, "notes/x.md");
});

test("F03-C5: ordinary projects keep their unreferenced notes, docs and data phone-writable", () => {
  const node = { "package.json": JSON.stringify({ name: "app", scripts: { docs: "typedoc", build: "vite build" }, files: ["dist"] }), "README.md": "# app\nSee the docs folder.\n", "src/main.ts": "export {};\n" };
  allowed(node, "docs/new.md");
  allowed(node, "notes/todo.md");
  allowed(node, "data/x.csv", "a,b");
  allowed({ ".gitignore": "node_modules/\ndata/raw/\n", "pyproject.toml": "[project]\nname = \"x\"\n" }, "data/new.csv", "a,b");
  allowed({ ".obsidian/workspace.json": JSON.stringify({ lastOpenFiles: ["notes/new.md"] }), "notes/old.md": "# old" }, "notes/new.md");
  allowed({ "AGENTS.md": "Keep the docs and data folders tidy.\n", "package.json": "{}" }, "docs/x.md");
  allowed({ "data/schema.json": "{}", "package.json": "{}" }, "data/x.csv", "a,b");
  allowed({ "notes/a.md": "# a", "journal/2026.md": "# j" }, "notes/b.md");
  allowed({ "README.md": "# r" }, "NOTES.md");
});

test("F03-C6: folder names are matched literally (regex metacharacters escaped)", () => {
  allowed({ "package.json": JSON.stringify({ scripts: { a: "node x.js myxdocs/" } }) }, "my.docs/b.md");
  refused({ "package.json": JSON.stringify({ scripts: { a: "node x.js my.docs/" } }) }, "my.docs/b.md");
  refused({ "package.json": JSON.stringify({ scripts: { a: "cat my.docs/*.md" } }) }, "my.docs/b.md");
  // A path to another file in the folder names that file, not the folder.
  allowed({ "package.json": JSON.stringify({ scripts: { a: "node x.js my.docs/a.txt" } }) }, "my.docs/b.md");
});

test("F03-L1: promotion re-classifies the exact staged bytes, so program-like content never passes at promotion", async () => {
  const env = await setup();
  try {
    const original = "plain text 12345";
    const view = writeMission(env, "note.md", original);
    await phoneApprove(env, view.id);
    const promotion = await waitPromotion(env, view.id);
    const [record] = stagedFor(env, view.id);
    // The staged bytes become program-like with an updated record (same length and file identity): only a content
    // re-check at promotion can refuse it.
    const tampered = "import{x}from'y'";
    assert.equal(tampered.length, original.length);
    writeFileSync(env.missions.staging.contentPath(record.id), tampered);
    const contentHash = createHash("sha256").update(tampered).digest("hex");
    env.missions.staging.save({ ...env.missions.staging.get(record.id)!, contentHash });
    const asked = env.missions.store.request(promotion.id);
    env.missions.store.saveRequest({ ...asked, promotion: { ...asked.promotion!, contentHash } });
    await assert.rejects(env.missions.respond(promotion.id, "allow_once", "workstation"), /EXECUTION_RELEVANT/);
    assert.equal(existsSync(join(env.root, "note.md")), false);
  } finally { await env.cleanup(); }
});

test("F03-L3: Replan ends the replaced steps' unused one-time answers (WITHDRAWN)", async () => {
  const env = await setup();
  try {
    env.missions.store.setGrant("filesystem.write", "global", "ask_every_time", "workstation");
    const view = writeMission(env, "replanned.md", "x");
    env.missions.approve(view.id, "workstation", true);
    await until(() => !!openRequests(env, view.id).find((request) => request.action === "filesystem.write"), "write ask");
    const ask = openRequests(env, view.id).find((request) => request.action === "filesystem.write")!;
    const step = stepsOf(env, view.id)[0];
    env.missions.store.saveStep({ ...step, approvedOnce: { requestId: ask.id, action: "filesystem.write" } });
    await env.missions.replan(view.id, "workstation");
    assert.equal(env.missions.store.request(ask.id).lifecycle?.state, "WITHDRAWN");
    assert.equal(existsSync(join(env.root, "replanned.md")), false);
  } finally { await env.cleanup(); }
});


// ── F03 independent review round 1 regressions (F03-R1-*) ────────────────────
test("F03-R1-1: default test discovery, doctest prompts and requirement lines are never phone-safe", () => {
  refused({ "README.md": "# r" }, "docs/test-plan.txt", "notes");
  refused({ "README.md": "# r" }, "docs/notes.txt", ">>> import pathlib\n>>> pathlib.Path('m').write_text('x')\n");
  refused({ "README.md": "# r" }, "notes/deps.txt", "zz-pkg==1.0\n");
  allowed({ "README.md": "# r" }, "notes/plan.txt", "Ship when x is ready.\nPrices rose > 3% this week.\n");
});

test("F03-R1-2: install files of any name, and shell or CI scripts anywhere in the project, are consumers", () => {
  refused({ "dev.txt": "-r tools/extra.txt\n" }, "tools/extra.txt");
  refused({ "tooling/dev.txt": "-r extra.txt\n" }, "tooling/extra.txt");
  refused({ "scripts/install.sh": "pip install -r deps.txt\n", ".github/workflows/ci.yml": "steps:\n  - run: bash scripts/install.sh\n" }, "deps.txt");
  refused({ "tools/sub/requirements.txt": "-r ../extra.txt\n" }, "tools/extra.txt");
  refused({ ".git/hooks/pre-commit": "npx markdownlint-cli2 docs/guide.md\n" }, "docs/guide.md");
  allowed({ ".git/hooks/pre-commit.sample": "docs/guide.md\n" }, "docs/guide.md");
});

test("F03-R1-3: quoted, option, list and brace folder values and computed file names under a literal folder are references", () => {
  refused({ "Makefile": "site:\n\thugo -s \"mysite\"\n" }, "mysite/notes/a.md");
  refused({ "Makefile": "site:\n\thugo --source=mysite --minify\n" }, "mysite/notes/a.md");
  refused({ "Makefile": "deps:\n\tpip install -r {ci,tests}/*.txt\n" }, "ci/notes.txt");
  refused({ "Makefile": "deps:\n\tpip install -r ci/reqs-$(ENV).txt\n" }, "ci/reqs-dev.txt");
  refused({ ".github/workflows/ci.yml": "steps:\n  - run: pip install -r ci/reqs-${{ matrix.env }}.txt\n" }, "ci/reqs-dev.txt");
  refused({ "Makefile": "deps:\n\tpip install -r ci%2Freqs-dev.txt\n" }, "ci/reqs-dev.txt");
  refused({ "mysite/site.config.json": JSON.stringify({ contentDir: "notes" }) }, "mysite/notes/a.md");
});

test("F03-R1-4: a glob of the destination's extension on a line that runs or collects files is a reference", () => {
  refused({ "pyproject.toml": "[tool.pytest.ini_options]\ndoctest_glob = \"*.md\"\n" }, "notes/evil.md", "# notes");
  refused({ ".github/workflows/ci.yml": "steps:\n  - run: pytest --doctest-glob=\"*.md\"\n" }, "notes/evil.md", "# notes");
  refused({ "Makefile": "all:\n\tsh $(wildcard **/*.txt)\n" }, "notes/x.txt");
  // Formatting or linting a glob reads files but does not run them.
  allowed({ "package.json": JSON.stringify({ scripts: { fmt: "prettier --write **/*.md" } }) }, "notes/x.md");
});

test("F03-R1-5: prose, variable names and descriptions never refuse an unreferenced folder", () => {
  allowed({ "analysis.py": "# load the data and plot it\n" }, "data/out.csv", "a,b");
  allowed({ "server.js": "const data = [];\n" }, "data/out.csv", "a,b");
  allowed({ "package.json": JSON.stringify({ description: "A docs site", scripts: { docs: "typedoc" } }) }, "docs/x.md");
  allowed({ "pyproject.toml": "[project]\ndescription = \"Tools for data analysis of sales\"\n", "data/raw.csv": "a,b" }, "data/clean.csv", "a,b");
  allowed({ ".gitattributes": "# Keep current audit reports byte-stable\n*.md text\n" }, "reports/x.md");
});

test("F03-R1-6: editor test downloads, Visual Studio state and binary dot-folder files do not block phone writes; UTF-16 without a BOM is read", () => {
  allowed({ ".vscode-test/vscode-1/resources/app/out/vs/workbench/deep/x.txt": "x" }, "notes/b.md");
  allowed({ ".vs/sln/v17/.suo": Buffer.concat([Buffer.alloc(1100 * 1024, 1), Buffer.from([0, 0, 0])]) }, "notes/b.md");
  allowed({ ".idea/cache.bin": Buffer.concat([Buffer.from([0, 7, 0, 9]), Buffer.alloc(1100 * 1024, 2)]) }, "notes/b.md");
  refused({ ".husky/pre-push": Buffer.from("sh notes/run.txt\n", "utf16le") }, "notes/run.txt", "echo x");
});

test("F03-R1-7: Replan withdraws unused answers but never rewrites a completed step's CONSUMED answer", async () => {
  const env = await setup();
  try {
    env.missions.store.setGrant("filesystem.write", "global", "ask_every_time", "workstation");
    const view = env.missions.create({ objective: "Two writes", mode: "fast", origin: "workstation", steps: [
      { key: "one", role: "One", objective: "write one", dependsOn: [], executor: { kind: "capability", action: "filesystem.write", params: { path: "one.md", content: "one" } }, verification: [], maxRetries: 0 },
      { key: "two", role: "Two", objective: "write two", dependsOn: [0], executor: { kind: "capability", action: "filesystem.write", params: { path: "two.md", content: "two" } }, verification: [], maxRetries: 0 },
    ] });
    assert.equal(view.state, "waiting_for_approval", JSON.stringify(env.missions.mission(view.id).failure ?? view.state));
    env.missions.approve(view.id, "workstation", true);
    await until(() => !!openRequests(env, view.id).find((request) => request.action === "filesystem.write"), "first write ask");
    const first = openRequests(env, view.id).find((request) => request.action === "filesystem.write")!;
    await env.missions.respond(first.id, "allow_once", "workstation");
    await until(() => !!openRequests(env, view.id).find((request) => request.action === "filesystem.write" && request.id !== first.id), "second write ask");
    const second = openRequests(env, view.id).find((request) => request.action === "filesystem.write" && request.id !== first.id)!;
    const done = stepsOf(env, view.id).find((step) => step.state === "completed")!;
    assert.equal(env.missions.store.request(first.id).lifecycle?.state, "CONSUMED");
    env.missions.store.saveStep({ ...done, approvedOnce: { requestId: first.id, action: "filesystem.write" } });
    const waiting = stepsOf(env, view.id).find((step) => step.id !== done.id)!;
    env.missions.store.saveStep({ ...waiting, approvedOnce: { requestId: second.id, action: "filesystem.write" } });
    await env.missions.replan(view.id, "workstation");
    assert.equal(env.missions.store.request(first.id).lifecycle?.state, "CONSUMED", "completed history is kept");
    assert.equal(env.missions.store.request(second.id).lifecycle?.state, "WITHDRAWN");
  } finally { await env.cleanup(); }
});

// ── F03 independent review round 2 regressions (F03-R2-*) ────────────────────
test("F03-R2-1: a phone write to a file an in-project program reads is refused before staging (end to end)", async () => {
  const env = await setup();
  try {
    mkdirSync(join(env.root, "data"));
    writeFileSync(join(env.root, "data", "helper.json"), JSON.stringify({ v: "host" }));
    writeFileSync(join(env.root, "slow.mjs"), "import { readFileSync } from 'node:fs'; console.log(readFileSync('data/helper.json', 'utf8'));");
    const view = writeMission(env, "data/helper.json", "{\"v\":\"phone\"}");
    await phoneApprove(env, view.id);
    await until(() => !!openRequests(env, view.id).find((request) => request.action === "filesystem.write"), "write ask");
    const ask = openRequests(env, view.id).find((request) => request.action === "filesystem.write")!;
    assert.equal(ask.desktopRequired, true, "workstation-only ask");
    assert.match(ask.reason, /EXECUTION_RELEVANT/);
    assert.equal(promotionAsk(env, view.id), undefined, "no promotion offered");
    assert.equal(stagedFor(env, view.id).length, 0, "nothing staged");
    assert.equal(JSON.parse(readFileSync(join(env.root, "data", "helper.json"), "utf8")).v, "host", "project untouched");
  } finally { await env.cleanup(); }
});

test("F03-R2-2: Retry of a step waiting for promotion closes the attempt that staged the change", async () => {
  const env = await setup();
  try {
    const view = writeMission(env, "again.md", "again");
    env.missions.approve(view.id, "workstation", false);
    await missionCommand(env.missions, "mission.start", { id: view.id }, { local: false, actor: PHONE });
    await waitPromotion(env, view.id);
    await until(() => env.missions.mission(view.id).state === "waiting_for_user", "waiting for the workstation");
    const attemptsBefore = stepsOf(env, view.id)[0].attempts.length;
    env.missions.retry(view.id, "workstation");
    const closed = env.missions.store.step(stepsOf(env, view.id)[0].id).attempts[attemptsBefore - 1];
    assert.equal(closed.outcome, "failed");
    assert.notEqual(closed.finishedAt, null);
    assert.equal(closed.category, "permission_required");
  } finally { await env.cleanup(); }
});


test("F03-R2-3: Markdown site generators and test plugins that build or run every page make those pages non-phone-safe", () => {
  refused({ "mkdocs.yml": "site_name: Demo\nplugins:\n  - macros\n" }, "docs/runbook.md", "# Runbook");
  refused({ "mkdocs.yml": "site_name: Demo\ndocs_dir: notes\n" }, "notes/page.md", "# Page");
  allowed({ "mkdocs.yml": "site_name: Demo\ndocs_dir: site-src\n" }, "notes/page.md", "# Page");
  refused({ ".vitepress/config.mts": "export default {}\n" }, "notes/page.md", "# Page");
  refused({ "pytest.ini": "[pytest]\naddopts = --markdown-docs\n" }, "notes/x.md", "# x");
});

test("F03-R2-4: script blocks that note apps, VitePress, MDX or HTML pipelines run are never phone-safe", () => {
  refused({ "README.md": "# r" }, "notes/page.md", "# Page\n\nText.\n\n<script setup>\nconsole.log(1)\n</script>\n");
  refused({ "README.md": "# r" }, "notes/daily.md", "# Daily\n<%* tR += app.vault.getName() %>\n");
  refused({ "README.md": "# r" }, "notes/dash.md", "# Dash\n\n```dataviewjs\ndv.paragraph(1)\n```\n");
  allowed({ "README.md": "# r" }, "notes/code.md", "# Code sample\n\n```js\nconsole.log(1)\n```\n");
});

test("F03-R2-5: in shell-run text any glob of the destination's extension counts unless the line names a read-only tool", () => {
  refused({ "package.json": JSON.stringify({ scripts: { "docs:run": "mdsh **/*.md" } }) }, "notes/runbook.md");
  refused({ "package.json": JSON.stringify({ scripts: { "docs:test": "npx md-runner \"**/*.md\"" } }) }, "notes/runbook.md");
  allowed({ "package.json": JSON.stringify({ scripts: { lint: "markdownlint-cli2 \"**/*.md\"", fmt: "prettier --write **/*.md" } }) }, "notes/runbook.md");
});

test("F03-R2-6: extensionless shebang scripts, escaped JSON paths and consumers inside linked folders are read", () => {
  refused({ "scripts/runbook": "#!/bin/sh\nsed -n '/^```sh/,/^```/p' notes/runbook.md | sh\n" }, "notes/runbook.md");
  refused({ "script/test-docs": "#!/bin/sh\nsh notes/runbook.md\n" }, "notes/runbook.md");
  refused({ "package.json": "{\"scripts\":{\"run\":\"mdsh notes\\u002frunbook.md\"}}" }, "notes/runbook.md");
  const outside = mkdtempSync(join(tmpdir(), "bunny-f03-outside-"));
  const base = project({ "README.md": "# r" });
  try {
    writeFileSync(join(outside, "ci.sh"), "sh notes/runbook.md\n");
    symlinkSync(outside, join(base, "tools"), process.platform === "win32" ? "junction" : "dir");
    assert.ok(!SAFE.includes(kind(base, "notes/runbook.md")), "a consumer inside a linked folder is followed and read");
  } finally { rmSync(base, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
});

test("F03-R2-7: ordinary binaries, generated pages, large files and tool caches do not block phone writes", () => {
  allowed({ "notes/.DS_Store": Buffer.from([0, 0, 0, 1, 66, 117, 100, 49, 0]), ".DS_Store": Buffer.from([0, 0, 0, 1]) }, "notes/x.md");
  allowed({ "notes/voice.m4a": Buffer.from([0, 0, 0, 32, 102, 116, 121, 112]), "notes/photo.heic": Buffer.from([0, 0, 0, 24]), "notes/book.epub": Buffer.from([80, 75, 3, 4, 0]) }, "notes/x.md");
  allowed({ "docs/index.html": "<html>" + "x".repeat(1_600_000) + "</html>", "analysis.ipynb": "{" + " ".repeat(1_600_000) + "}" }, "docs/guide.md");
  // A YAML consumer over 1 MiB still fails closed (F02 contract; documented availability residual).
  assert.equal(refused({ "api/openapi.yaml": "openapi: 3.0.0\n" + "# pad\n".repeat(300_000) }, "notes/x.md"), "UNKNOWN");
  const fixtures: Record<string, string> = { "README.md": "# r" };
  for (let i = 0; i < 420; i++) fixtures[`test/fixtures/case${i}.yaml`] = `id: ${i}\n`;
  for (let i = 0; i < 30; i++) fixtures[`.godot/imported/a${i}.import`] = "x";
  allowed(fixtures, "notes/x.md");
});

test("F03-R2-8: tabular data whose cells look like spreadsheet formulas carries a warning", () => {
  const base = project({ "README.md": "# r" });
  try {
    const result = classifyDeviceWrite("data/export.csv", { base, operation: "write", content: "name,link\nx,=HYPERLINK(\"http://example.invalid\")\n" });
    assert.equal(result.classification, "PHONE_SAFE_DATA");
    assert.ok(result.warnings.some((warning) => /formulas/.test(warning)), result.warnings.join(" | "));
  } finally { rmSync(base, { recursive: true, force: true }); }
});


// ── F03 independent review round 3 (scoped verification) regressions (F03-R3-*) ─
test("F03-R3-1: brace, bare and any-extension globs are references; a read-only tool earlier on a line exempts only its own command", () => {
  refused({ "package.json": JSON.stringify({ scripts: { run: "mdsh **/*.{md,txt}" } }) }, "notes/runbook.md");
  refused({ "Makefile": "run:\n\tsh *.{md,txt}\n" }, "runbook.md");
  refused({ "Makefile": "run:\n\tfor f in *; do sh \"$$f\"; done\n" }, "runbook.md");
  refused({ "Makefile": "run:\n\tsh *.*\n" }, "runbook.md");
  refused({ "Makefile": "run:\n\tsh **/*\n" }, "notes/runbook.md");
  refused({ "package.json": JSON.stringify({ scripts: { run: "markdownlint-cli2 README.md && mdsh **/*.md" } }) }, "notes/runbook.md");
  refused({ "package.json": JSON.stringify({ scripts: { run: "ls && sh **/*.md" } }) }, "notes/runbook.md");
  allowed({ "package.json": JSON.stringify({ scripts: { lint: "markdownlint-cli2 \"**/*.md\" && echo ok" } }) }, "notes/runbook.md");
});

test("F03-R3-2: installer-directive files of any document name and encoding are consumers; direct-reference requirement lines are install input", () => {
  refused({ "dev.txt": Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("-r notes/x.md\n", "utf16le")]) }, "notes/x.md");
  refused({ "dev.txt": Buffer.from("-r notes/x.md\n", "utf16le") }, "notes/x.md");
  refused({ "dev.md": "-r notes/x.md\n" }, "notes/x.md");
  refused({ "README.md": "# r" }, "notes/deps.txt", "evil @ https://example.invalid/x.tar.gz\n");
});

test("F03-R3-3: notebooks are program consumers (cell sources), including large ones", () => {
  const notebook = (source: string, pad = 0) => JSON.stringify({ cells: [{ cell_type: "code", source: [source], outputs: [{ text: "x".repeat(pad) }] }], nbformat: 4 });
  refused({ "analysis.ipynb": notebook("!sh notes/run.md") }, "notes/run.md");
  refused({ "analysis.ipynb": notebook("!sh notes/run.md", 1_600_000) }, "notes/run.md");
  allowed({ "analysis.ipynb": notebook("print(1)", 1_600_000) }, "notes/run.md");
});

test("F03-R3-4: JS hex and braced escapes are decoded; MkDocs docs_dir '.' covers the whole project; Mercurial hooks are read", () => {
  refused({ "vite.config.js": "export default { x: 'notes\\x2frunbook.md' };\n" }, "notes/runbook.md");
  refused({ "vite.config.js": "export default { x: 'notes\\u{2f}runbook.md' };\n" }, "notes/runbook.md");
  refused({ "mkdocs.yml": "site_name: Demo\ndocs_dir: ./\n" }, "page.md");
  refused({ ".hg/hgrc": "[hooks]\npre-commit = sh notes/run.md\n" }, "notes/run.md");
});

test("F03-R3-5: executable note fences inside list items or blockquotes; NUL-bearing dot-folder files are still searched", () => {
  refused({ "README.md": "# r" }, "notes/a.md", "- ```dataviewjs\n  dv.paragraph(1)\n  ```\n");
  refused({ "README.md": "# r" }, "notes/b.md", "> ```dataviewjs\n> dv.paragraph(1)\n> ```\n");
  refused({ ".husky/pre-push": Buffer.concat([Buffer.from("sh notes/x.md\n"), Buffer.from([0])]) }, "notes/x.md");
});
