import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { HostDatabase } from "../bunny-host/persistence.server.ts";
import { startHost } from "../bunny-host/http.server.ts";
import { MissionStore } from "./store.server.ts";
import { ArtifactStore } from "./artifacts.server.ts";
import { CapabilityBus, type CapabilityRequest } from "./capabilities/bus.server.ts";
import { FilesystemCapability, GitCapability, NotificationsCapability, TerminalCapability } from "./capabilities/local.server.ts";
import { BrowserCapability, blockedHost, safeUrl } from "./capabilities/browser.server.ts";
import { ComputerCapability } from "./capabilities/computer.server.ts";
import { realGit, resolveCommand } from "./capabilities/process.server.ts";
import { SkillLibrary } from "./skills.server.ts";
import { communicationConnectors } from "./capabilities/connectors.server.ts";
import { envelopeFrom, scopeFor } from "./authorization.server.ts";

function harness() {
  const dir = mkdtempSync(join(tmpdir(), "bunny-cap-"));
  const root = join(dir, "project"); mkdirSync(root);
  const db = new HostDatabase(":memory:"); const store = new MissionStore(db);
  const artifacts = new ArtifactStore(store, dir); const events: string[] = [];
  const bus = new CapabilityBus(store, artifacts, dir, (type, detail) => events.push(`${type}: ${detail}`));
  const request = (action: string, params: Record<string, unknown>, extra: Partial<CapabilityRequest> = {}): CapabilityRequest => ({ action, params, missionId: null, stepId: null, envelope: null, origin: "workstation", cwd: root, roots: [root], direct: { confirmed: false }, ...extra });
  const cleanup = async () => { await bus.close(); db.close(); rmSync(dir, { recursive: true, force: true }); };
  return { dir, root, db, store, artifacts, bus, events, request, cleanup };
}

test("filesystem capability stays inside approved roots, writes atomically and refuses symlink-style escapes", async () => {
  const h = harness();
  try {
    h.bus.register(new FilesystemCapability()); await h.bus.refreshHealth();
    const write = await h.bus.request(h.request("filesystem.write", { path: "notes/a.txt", content: "hello" }));
    assert.equal(write.run?.status, "succeeded"); assert.equal(readFileSync(join(h.root, "notes", "a.txt"), "utf8"), "hello");
    assert.equal(write.run?.params.content, "[5 characters]", "file bodies are not stored in run records");
    const again = await h.bus.request(h.request("filesystem.write", { path: "notes/a.txt", content: "x" }));
    assert.equal(again.run?.status, "failed", "no silent overwrite");
    const read = await h.bus.request(h.request("filesystem.read", { path: "notes/a.txt" }));
    assert.equal((read.result?.output as { text: string }).text, "hello");
    const escape = await h.bus.request(h.request("filesystem.read", { path: "../../outside.txt" }));
    assert.equal(escape.run?.status, "failed"); assert.match(escape.run!.summary, /outside the approved scope/);
    const del = await h.bus.request(h.request("filesystem.delete", { path: "notes/a.txt" }));
    assert.equal(del.decision.decision, "ask", "destructive direct actions need confirmation"); assert.ok(existsSync(join(h.root, "notes", "a.txt")));
    const confirmed = await h.bus.request(h.request("filesystem.delete", { path: "notes/a.txt" }, { direct: { confirmed: true } }));
    assert.equal(confirmed.run?.status, "succeeded"); assert.ok(!existsSync(join(h.root, "notes", "a.txt")));
    assert.ok(h.store.runs().length >= 4, "every executed action is a recorded capability run");
  } finally { await h.cleanup(); }
});

test("terminal capability runs argv without a shell, bounds time and escalates destructive commands", async () => {
  const h = harness();
  try {
    const terminal = new TerminalCapability(); h.bus.register(terminal); await h.bus.refreshHealth();
    const ok = await h.bus.request(h.request("terminal.exec", { command: "node", args: ["-e", "console.log('BUNNY_A_OK')"] }));
    assert.equal(ok.run?.status, "succeeded"); assert.match((ok.result?.output as { stdout: string }).stdout, /BUNNY_A_OK/);
    const injected = await h.bus.request(h.request("terminal.exec", { command: "node", args: ["-e", "console.log(process.argv.length)", "&&", "echo", "pwned"] }));
    assert.match((injected.result?.output as { stdout: string }).stdout, /^\d+/, "shell metacharacters are plain arguments");
    assert.doesNotMatch((injected.result?.output as { stdout: string }).stdout, /pwned/);
    const failing = await h.bus.request(h.request("terminal.exec", { command: "node", args: ["-e", "process.exit(4)"] }));
    assert.equal(failing.run?.status, "failed"); assert.equal((failing.result?.output as { exitCode: number }).exitCode, 4);
    const slow = await h.bus.request(h.request("terminal.exec", { command: "node", args: ["-e", "setTimeout(()=>{},10000)"], timeoutMs: 400 }));
    assert.equal(slow.run?.status, "timeout");
    assert.equal(resolveCommand("cmd.bat"), null, "scripts are refused"); assert.ok(resolveCommand("npm"), "npm via the bundled CLI");
    assert.equal(terminal.riskFor("terminal.exec", { command: "git", args: ["reset", "--hard"] }), "DESTRUCTIVE");
    assert.equal(terminal.riskFor("terminal.exec", { command: "git", args: ["push"] }), "DESTRUCTIVE");
    assert.equal(terminal.riskFor("terminal.exec", { command: "npm", args: ["publish"] }), "EXTERNAL_SIDE_EFFECT");
    const destructive = await h.bus.request(h.request("terminal.exec", { command: "git", args: ["clean", "-fdx"] }));
    assert.equal(destructive.decision.decision, "ask"); assert.equal(destructive.run, null, "nothing executed while asking");
  } finally { await h.cleanup(); }
});

test("MA0R: same-basename rogue executable and changed PATH cannot inherit an approved executable identity", async () => {
  const h = harness(); const originalPath = process.env.PATH;
  const commandScope = (command: string) => envelopeFrom(scopeFor([{ executor: { kind: "capability", action: "terminal.exec", params: { command } }, scope: { root: h.root, access: "write", isolation: "shared" }, providerConstraints: {}, verification: [], requiredCapabilities: [] }], h.root, "fast"), "identity-test", "workstation", 60_000);
  try {
    h.bus.register(new TerminalCapability()); await h.bus.refreshHealth();
    const envelope = commandScope("node");
    const rogueDirectory = join(h.root, "rogue"); mkdirSync(rogueDirectory);
    const rogue = join(rogueDirectory, process.platform === "win32" ? "node.exe" : "node"); copyFileSync(process.execPath, rogue);
    const request = { missionId: envelope.missionId, envelope, direct: undefined };
    const blocked = await h.bus.request(h.request("terminal.exec", { command: rogue, args: ["-e", "console.log('ROGUE')"] }, request));
    assert.equal(blocked.decision.decision, "ask"); assert.equal(blocked.run, null); assert.match(blocked.decision.reason, /executable identity/);
    const normal = await h.bus.request(h.request("terminal.exec", { command: "node", args: ["-e", "console.log('TRUSTED')"] }, request));
    assert.equal(normal.run?.status, "succeeded");
    // An explicitly approved path still works; trust is to that exact path, not its basename.
    const explicit = commandScope(rogue);
    assert.equal(h.bus.decision(h.request("terminal.exec", { command: rogue }, { ...request, envelope: explicit })).decision, "allow");
    const gitScope = commandScope("git");
    copyFileSync(process.execPath, join(rogueDirectory, process.platform === "win32" ? "git.exe" : "git"));
    process.env.PATH = `${rogueDirectory}${process.platform === "win32" ? ";" : ":"}${originalPath}`;
    const changedPath = h.bus.decision(h.request("terminal.exec", { command: "git" }, { ...request, envelope: gitScope }));
    assert.equal(changedPath.decision, "ask"); assert.match(changedPath.reason, /executable identity/);
  } finally { process.env.PATH = originalPath; await h.cleanup(); }
});

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
test("git capability: status, diff artifact, commit, isolated worktree, merge and clean conflict abort", { skip: !resolveCommand("git") && "git not installed" }, async () => {
  const h = harness();
  try {
    h.bus.register(new GitCapability(h.dir)); await h.bus.refreshHealth();
    git(h.root, "init", "-q", "-b", "main"); git(h.root, "config", "user.email", "bunny@test"); git(h.root, "config", "user.name", "Bunny Test");
    writeFileSync(join(h.root, "a.txt"), "one\n"); git(h.root, "add", "."); git(h.root, "commit", "-qm", "init");
    writeFileSync(join(h.root, "a.txt"), "two\n");
    const status = await h.bus.request(h.request("git.status", {}));
    assert.equal((status.result?.output as { clean: boolean }).clean, false);
    const missionReq = { missionId: "00000000-0000-0000-0000-00000000aaaa", oneTime: true };
    const diff = await h.bus.request(h.request("git.diff", {}, missionReq));
    assert.equal(diff.artifactIds.length, 1, "patch stored as an artifact by reference");
    assert.match(h.artifacts.get(diff.artifactIds[0]).body!, /\+two/);
    const commit = await h.bus.request(h.request("git.commit", { message: "bunny change" }, { direct: { confirmed: true } }));
    assert.equal(commit.run?.status, "succeeded");
    const tree = await h.bus.request(h.request("git.worktree_add", { name: "coding" }, missionReq));
    const worktree = tree.result?.output as { path: string; branch: string };
    assert.equal(tree.run?.status, "succeeded"); assert.ok(existsSync(join(worktree.path, "a.txt")));
    assert.ok(worktree.path.startsWith(join(h.dir, "worktrees")), "worktrees live under the Host data folder");
    writeFileSync(join(worktree.path, "b.txt"), "from worktree\n"); git(worktree.path, "add", "."); git(worktree.path, "commit", "-qm", "worktree change");
    const merge = await h.bus.request(h.request("git.merge", { branch: worktree.branch }, { direct: { confirmed: true } }));
    assert.equal(merge.run?.status, "succeeded"); assert.ok(existsSync(join(h.root, "b.txt")));
    // Conflict: both sides change the same line; the merge aborts and leaves main untouched.
    const second = (await h.bus.request(h.request("git.worktree_add", { name: "conflict" }, missionReq))).result?.output as { path: string; branch: string };
    writeFileSync(join(second.path, "a.txt"), "left\n"); git(second.path, "commit", "-qam", "left");
    writeFileSync(join(h.root, "a.txt"), "right\n"); git(h.root, "commit", "-qam", "right");
    const conflict = await h.bus.request(h.request("git.merge", { branch: second.branch }, { direct: { confirmed: true } }));
    assert.equal(conflict.run?.status, "failed"); assert.deepEqual((conflict.result?.output as { conflict: string[] }).conflict, ["a.txt"]);
    assert.equal(readFileSync(join(h.root, "a.txt"), "utf8").replace(/\r/g, ""), "right\n"); assert.equal(git(h.root, "status", "--porcelain").trim(), "");
    const refuse = await h.bus.request(h.request("git.merge", { branch: "main" }, { direct: { confirmed: true } }));
    assert.match(refuse.run!.summary, /Only bunny\/\* branches/);
    const outside = await h.bus.request(h.request("git.worktree_remove", { path: h.root }, { direct: { confirmed: true } }));
    assert.match(outside.run!.summary, /Only Bunny-owned worktrees/);
  } finally { await h.cleanup(); }
});

test("isolated browser: SSRF guard on loopback/private hosts and URL schemes", () => {
  assert.ok(blockedHost("127.0.0.1")); assert.ok(blockedHost("localhost")); assert.ok(blockedHost("10.0.0.5")); assert.ok(blockedHost("192.168.1.1")); assert.ok(blockedHost("169.254.169.254")); assert.ok(blockedHost("[::1]")); assert.ok(blockedHost("printer.local"));
  assert.ok(!blockedHost("example.com")); assert.ok(!blockedHost("8.8.8.8"));
  assert.throws(() => safeUrl("file:///C:/Windows/win.ini"), /Only http/); assert.throws(() => safeUrl("http://127.0.0.1:43119/state"), /loopback/); assert.throws(() => safeUrl("https://user:pass@example.com"), /credentials/);
  assert.equal(safeUrl("http://127.0.0.1:9/x", true).hostname, "127.0.0.1");
});

test("MA1: a refused or failed browser download leaves no unhandled rejection that could end the Host", async () => {
  // Live M-A-1: a refused private download returned at once, then its abandoned download wait timed out and
  // the unhandled rejection terminated the test Host 60 s later.
  const dir = mkdtempSync(join(tmpdir(), "bunny-ma1-download-"));
  const unhandled: unknown[] = []; const onUnhandled = (reason: unknown) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  const browser = new BrowserCapability(dir);
  let waits = 0;
  const page = { waitForEvent: () => { waits++; return new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout 30ms exceeded while waiting for event \"download\"")), 30)); }, goto: async () => { throw new Error("goto must not run for a refused URL"); }, url: () => "about:blank" };
  browser.page = async () => ({ id: "fixture", page: page as never });
  const context = { missionId: null, stepId: null, cwd: dir, roots: [dir], timeoutMs: 1000, signal: new AbortController().signal } as never;
  try {
    await assert.rejects(browser.execute("browser.download", { url: "http://127.0.0.1:47901/private" }, context), /loopback/);
    await assert.rejects(browser.execute("browser.download", {}, context), /Provide role/);
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.equal(waits, 2);
    assert.deepEqual(unhandled, [], "no abandoned download wait may reject unhandled");
  } finally { process.off("unhandledRejection", onUnhandled); await browser.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("isolated browser drives a real page with DOM/accessibility locators and records evidence", { timeout: 120_000 }, async (t) => {
  const h = harness();
  const browser = new BrowserCapability(h.dir, { allowLoopback: true });
  const page = `<!doctype html><title>Bunny Test Page</title><meta name="description" content="A test page"><h1>Hello Bunny</h1>
    <label>Name <input id="name"></label><button onclick="document.getElementById('out').textContent='Clicked '+document.getElementById('name').value">Greet</button>
    <p id="out">Waiting</p><ul><li class="item">One</li><li class="item">Two</li></ul><a href="/file">Get file</a>`;
  const server = createServer((req, res) => {
    if (req.url === "/file") { res.writeHead(200, { "content-type": "text/plain", "content-disposition": "attachment; filename=report.txt" }); res.end("REPORT"); return; }
    res.writeHead(200, { "content-type": "text/html" }); res.end(page);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
  try {
    h.bus.register(browser); await h.bus.refreshHealth();
    const mission = { missionId: "11111111-1111-1111-1111-111111111111", direct: { confirmed: true } };
    const nav = await h.bus.request(h.request("browser.navigate", { url }, mission));
    if (nav.run?.status !== "succeeded") { t.skip(`No browser could be launched here: ${nav.run?.summary}`); return; }
    assert.match(nav.run.summary, /Bunny Test Page/);
    const read = await h.bus.request(h.request("browser.read", {}, mission));
    assert.match((read.result?.output as { text: string }).text, /Hello Bunny/);
    assert.equal(read.artifactIds.length, 1); assert.equal(h.artifacts.get(read.artifactIds[0]).artifact.type, "browser_evidence");
    assert.match(h.artifacts.get(read.artifactIds[0]).body!, /"retrievedAt"/);
    const items = await h.bus.request(h.request("browser.extract", { selector: "li.item" }, mission));
    assert.deepEqual((items.result?.output as { items: string[] }).items, ["One", "Two"]);
    assert.equal((await h.bus.request(h.request("browser.type", { label: "Name", text: "Ada" }, mission))).run?.status, "succeeded");
    assert.equal((await h.bus.request(h.request("browser.click", { role: "button", name: "Greet" }, mission))).run?.status, "succeeded");
    assert.equal((await h.bus.request(h.request("browser.wait", { text: "Clicked Ada" }, mission))).run?.status, "succeeded");
    const typedRun = h.store.runs().find((run) => run.action === "browser.type")!;
    assert.equal(typedRun.params.text, "[3 characters]", "typed text is never logged");
    const meta = await h.bus.request(h.request("browser.metadata", {}, mission));
    assert.equal((meta.result?.output as { meta: Record<string, string> }).meta.description, "A test page");
    const shot = await h.bus.request(h.request("browser.screenshot", {}, mission));
    assert.equal(shot.run?.status, "succeeded"); assert.equal(h.artifacts.get(shot.artifactIds[0]).artifact.location.kind, "file");
    assert.match(h.artifacts.get(shot.artifactIds[0]).artifact.sha256, /^[0-9a-f]{64}$/);
    const download = await h.bus.request(h.request("browser.download", { url: `${url}file` }, mission));
    assert.equal(download.run?.status, "succeeded", download.run?.summary);
    assert.equal(readFileSync((download.result?.output as { path: string }).path, "utf8"), "REPORT");
    const tabs = await h.bus.request(h.request("browser.tabs", { op: "list" }, mission));
    assert.ok((tabs.result?.output as { tabs: unknown[] }).tabs.length >= 1);
    assert.ok(existsSync(join(h.dir, "browser-profile")), "a separate Bunny profile, not the user's");
  } finally { server.close(); await h.cleanup(); }
});

test("isolated browser without loopback permission refuses the Host's own API", async () => {
  const h = harness();
  try {
    h.bus.register(new BrowserCapability(h.dir)); await h.bus.refreshHealth();
    const blocked = await h.bus.request(h.request("browser.navigate", { url: "http://127.0.0.1:43119/state" }, { direct: { confirmed: true } }));
    assert.equal(blocked.run?.status, "failed"); assert.match(blocked.run!.summary, /loopback/);
  } finally { await h.cleanup(); }
});

test("computer runtime: semantic read-only window list works; actions need approval; non-allowlisted apps refused", { skip: process.platform !== "win32" && "Windows only" }, async () => {
  const h = harness();
  try {
    h.bus.register(new ComputerCapability(h.dir)); await h.bus.refreshHealth();
    const list = await h.bus.request(h.request("computer.list_windows", {}));
    assert.equal(list.run?.status, "succeeded", list.run?.summary);
    assert.ok(Array.isArray((list.result?.output as { windows: unknown[] }).windows));
    const capture = await h.bus.request(h.request("computer.capture", {}));
    assert.equal(capture.decision.decision, "ask", "screen capture is privacy-sensitive"); assert.equal(capture.run, null);
    const app = await h.bus.request(h.request("computer.open_app", { app: "regedit" }, { direct: { confirmed: true } }));
    assert.equal(app.run?.status, "failed"); assert.match(app.run!.summary, /not an allowlisted application/);
    const missing = await h.bus.request(h.request("computer.focus_window", { title: "zz-no-such-window-zz" }, { direct: { confirmed: true } }));
    assert.equal(missing.run?.status, "failed"); assert.match(missing.run!.summary, /No top-level window/);
    assert.ok(!h.bus.list().find((c) => c.id === "computer")!.actions.some((a) => /mouse|click_at|key/.test(a.id)), "no raw coordinate or keystroke actions exist");
  } finally { await h.cleanup(); }
});

test("skills: versioned, failing skills stop and ask for repair, candidates promote only after a verified run, record/replay is semantic", async () => {
  const h = harness();
  try {
    for (const adapter of [new FilesystemCapability(), new TerminalCapability(), new NotificationsCapability(() => {}), ...communicationConnectors()]) h.bus.register(adapter);
    await h.bus.refreshHealth();
    const skills = new SkillLibrary(h.store, h.bus, (type, detail) => h.events.push(`${type}: ${detail}`));
    const base = { missionId: null, stepId: null, envelope: null, origin: "workstation", cwd: h.root, roots: [h.root], direct: { confirmed: true } };
    const missing = await skills.run("project.test", {}, base);
    assert.equal(missing.ok, false); assert.match(missing.failure!.summary, /package.json not found/);
    writeFileSync(join(h.root, "package.json"), JSON.stringify({ scripts: { test: "node -e \"process.exit(1)\"" } }));
    const failing = await skills.run("project.test", {}, base);
    assert.equal(failing.ok, false); assert.equal(failing.repairNeeded, true);
    assert.ok(h.events.some((e) => e.startsWith("skill.failed") && /last-known-good version is unchanged/.test(e)));
    const candidate = skills.proposeRepair("project.test", [{ action: "terminal.exec", params: { command: "node", args: ["-e", "process.exit(1)"] }, label: "still broken" }]);
    assert.equal(candidate.version, 2); assert.equal(skills.get("project.test").version, 1, "active stays on v1");
    const rejected = await skills.verifyCandidate("project.test", 2, {}, base);
    assert.equal(rejected.promoted, false); assert.equal(skills.get("project.test").version, 1);
    const good = skills.proposeRepair("project.test", [{ action: "terminal.exec", params: { command: "node", args: ["-e", "process.exit(0)"] }, label: "fixed" }]);
    const promoted = await skills.verifyCandidate("project.test", good.version, {}, base);
    assert.equal(promoted.promoted, true); assert.equal(skills.get("project.test").version, 3);
    assert.deepEqual(skills.versions("project.test").map((s) => s.status), ["retired", "candidate", "active"], "history is preserved, nothing overwritten");
    const write = await h.bus.request({ ...base, action: "notifications.send", params: { title: "hi" } });
    const recorded = skills.record("my.notify", "Notify", [write.run!.id]);
    assert.equal(recorded.status, "candidate"); assert.deepEqual(recorded.steps.map((s) => s.action), ["notifications.send"]);
    await assert.rejects(skills.run("my.notify", {}, base), /unverified candidate/);
    assert.equal((await skills.verifyCandidate("my.notify", 1, {}, base)).promoted, true);
    assert.equal((await skills.run("my.notify", {}, base)).ok, true);
    const typed = await h.bus.request({ ...base, action: "filesystem.write", params: { path: "x.txt", content: "secret" } });
    assert.throws(() => skills.record("my.write", "W", [typed.run!.id]), /private parameters/);
  } finally { await h.cleanup(); }
});

test("Host HTTP: snapshot stays backward compatible, mission commands are validated, remote devices are limited", { timeout: 120_000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "bunny-ma0-http-"));
  const host = await startHost({ dataDirectory: directory, port: 43131, root: process.cwd() });
  const url = "http://127.0.0.1:43131";
  const command = async (action: string, data: unknown = {}, token = host.token) => { const res = await fetch(`${url}/command`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ action, data }) }); return { status: res.status, body: await res.json() }; };
  try {
    const state = await (await fetch(`${url}/state`, { headers: { authorization: `Bearer ${host.token}` } })).json();
    for (const key of ["app", "instanceId", "tasks", "projects", "providers", "samples", "events", "cursor", "performance", "remoteConfigured", "thermal"]) assert.ok(key in state, `snapshot keeps ${key}`);
    assert.equal(state.missions.enabled, false, "missions are off by default");
    assert.match((await command("mission.create", { objective: "x", mode: "fast" })).body.error, /disabled/);
    assert.equal((await command("mission.configure", { enabled: true })).status, 200);
    assert.equal((await command("mission.create", { objective: "x", mode: "turbo" })).status, 400);
    const created = await command("mission.create", { objective: "Run the tests", mode: "fast" });
    assert.equal(created.status, 200); assert.equal(created.body.mission.state, "waiting_for_approval");
    assert.equal(created.body.snapshot.missions.missions[0].id, created.body.mission.id);
    const code = (await command("pairing.create")).body.pairCode;
    const device = await (await fetch(`${url}/pair`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, name: "MA0 phone" }) })).json();
    assert.equal((await command("mission.get", { id: created.body.mission.id }, device.token)).status, 200, "a paired phone can inspect missions");
    assert.match((await command("mission.configure", { enabled: false }, device.token)).body.error, /workstation/);
    assert.match((await command("capability.run", { action: "terminal.exec", params: { command: "node" } }, device.token)).body.error, /workstation/);
    assert.match((await command("mission.create", { objective: "x", mode: "fast", steps: [{ role: "A", objective: "b" }] }, device.token)).body.error, /workstation/);
    assert.match((await command("trigger.create", { name: "t" }, device.token)).body.error, /workstation/);
    const modelPlan = [{ role: "Custom", objective: "inspect", access: "read", executor: { kind: "model" } }, { role: "Research", objective: "edit", access: "write", executor: { kind: "model" }, dependsOn: [0] }];
    const desktopMission = (await command("mission.create", { objective: "Desktop scope", mode: "fast", steps: modelPlan })).body.mission;
    const phoneMission = (await command("mission.create", { objective: "Phone scope", mode: "fast", steps: modelPlan })).body.mission;
    // Serialize through the actual HTTP boundary, without starting any model session.
    const desktopApproval = await command("mission.approve", { id: desktopMission.id, start: false });
    const phoneApproval = await command("mission.approve", { id: phoneMission.id, start: false, providers: { execution: true, sessions: { maxSessions: 999 } }, projectRoots: ["/"] }, device.token);
    assert.equal(desktopApproval.status, 200); assert.equal(phoneApproval.status, 200);
    const desktopEnvelope = (await command("mission.get", { id: desktopMission.id })).body.data.authorization;
    const phoneEnvelope = (await command("mission.get", { id: phoneMission.id }, device.token)).body.data.authorization;
    assert.deepEqual(phoneEnvelope.providers, phoneMission.requestedScope.providers, "phone grants exactly the displayed serialized provider authority");
    assert.deepEqual(phoneEnvelope.projectRoots, desktopEnvelope.projectRoots);
    assert.equal(phoneEnvelope.providers.sessions.maxSessions, desktopEnvelope.providers.sessions.maxSessions);
    assert.deepEqual(phoneEnvelope.providers.sessions.steps.map((step: { scope: unknown }) => step.scope), desktopEnvelope.providers.sessions.steps.map((step: { scope: unknown }) => step.scope));
    assert.match(phoneEnvelope.grantedBy, /^device:/);
    const phoneEvents = (await command("mission.get", { id: phoneMission.id }, device.token)).body.data.events;
    assert.ok(phoneEvents.some((event: { type: string }) => event.type === "approval.mission_envelope"));
    assert.ok(phoneEvents.some((event: { type: string }) => event.type === "approval.remote_device"));
    const stopped = await command("mission.stop", { id: created.body.mission.id }, device.token);
    assert.equal(stopped.body.mission.state, "stopped", "a paired phone can stop a mission");
    assert.match((await command("capability.grant", { action: "*", policy: "always_allow" })).body.error, /blanket allow/);
    const trigger = await command("trigger.create", { name: "Notify on failure", source: "mission_event", condition: { eventType: "mission.failed" }, action: { kind: "notify", title: "Mission failed" } });
    assert.equal(trigger.body.data.enabled, false, "triggers are created disabled");
    assert.match((await command("trigger.create", { name: "Mail", source: "email", condition: { eventType: "email.received" }, action: { kind: "notify", title: "x" } })).body.error, /no event feed/);
    // Direct tasks keep their exact contract with missions enabled.
    assert.equal((await command("approve", { id: "unknown" })).status, 400);
    await command("device.revoke", { id: device.deviceId });
    assert.equal((await command("mission.get", { id: created.body.mission.id }, device.token)).status, 401);
  } finally { await host.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("MA1: git resolves past the Git for Windows cmd launcher so a Host crash cannot leave git running", () => {
  // The launcher re-spawns the real git outside the Host's kill-on-close process job (M-A-1 Phase S).
  const root = mkdtempSync(join(tmpdir(), "ma1-git-"));
  try {
    const launcher = join(root, "Git", "cmd", "git.exe"); const real = join(root, "Git", "mingw64", "bin", "git.exe");
    mkdirSync(join(root, "Git", "cmd"), { recursive: true }); mkdirSync(join(root, "Git", "mingw64", "bin"), { recursive: true });
    writeFileSync(launcher, ""); writeFileSync(real, "");
    assert.equal(realGit(launcher, "win32"), real);
    assert.equal(realGit(launcher, "linux"), launcher, "only Windows has the launcher");
    assert.equal(realGit(real, "win32"), real, "the real binary is kept");
    const lone = join(root, "Other", "cmd", "git.exe"); mkdirSync(join(root, "Other", "cmd"), { recursive: true }); writeFileSync(lone, "");
    assert.equal(realGit(lone, "win32"), lone, "no sibling binary: unchanged");
    if (process.platform === "win32") {
      const saved = process.env.PATH;
      try { process.env.PATH = join(root, "Git", "cmd"); assert.equal(resolveCommand("git")?.file.toLowerCase(), real.toLowerCase()); }
      finally { process.env.PATH = saved; }
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
