// M-A-1D deployment hardening: the installed Bunny-A Host runs a pinned release, never a development checkout.
import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, closeSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { importClosure, sourceCheck, verifyRelease, walkFiles, writeManifest } from "./bunny-release.mjs";

const repo = fileURLToPath(new URL("..", import.meta.url));
const windows = process.platform === "win32";
const MA1_CODE_CANDIDATE = "f1934bda6b0d33f27bef198e8967a69f6eb329ff";
const TOOLING = ["install/Start-Bunny-Release.ps1", "install/Bunny-Release-Info.ps1", "install/release-pin.json"];
const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
/** Output goes to files, not pipes: processes the launcher starts inherit its handles, and an inherited pipe would hold spawnSync open. */
function powershell(file, args, logs) {
  const out = join(logs, `ps-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const stdout = openSync(`${out}.out`, "w"); const stderr = openSync(`${out}.err`, "w");
  try {
    const result = spawnSync(join(process.env.WINDIR ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"), ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", file, ...args], { stdio: ["ignore", stdout, stderr], timeout: 240_000 });
    return { status: result.status, stdout: readFileSync(`${out}.out`, "utf8"), stderr: readFileSync(`${out}.err`, "utf8") };
  } finally { closeSync(stdout); closeSync(stderr); }
}
const ps = (command) => execFileSync("powershell.exe", ["-NoProfile", "-Command", command], { encoding: "utf8" }).trim();
const same = (a, b) => realpathSync(a).toLowerCase() === realpathSync(b).toLowerCase();
const insideGit = (path) => { for (let folder = path; ; folder = dirname(folder)) { if (existsSync(join(folder, ".git"))) return folder; if (dirname(folder) === folder) return null; } };
const shortcut = (path) => JSON.parse(ps(`$l=(New-Object -ComObject WScript.Shell).CreateShortcut('${path}');[pscustomobject]@{target=$l.TargetPath;arguments=$l.Arguments;workingDirectory=$l.WorkingDirectory}|ConvertTo-Json`));
const freePort = () => new Promise((resolve) => { const server = createServer(); server.listen(0, "127.0.0.1", () => { const { port } = server.address(); server.close(() => resolve(port)); }); });

test("M-A-1D: the production release pin is the reviewed M-A-1 code candidate", () => {
  const pin = JSON.parse(readFileSync(join(repo, "install/release-pin.json"), "utf8"));
  assert.equal(pin.sourceCommit, MA1_CODE_CANDIDATE);
  assert.match(pin.release, /^Bunny-A-Windows-v\d+$/);
  assert.ok(Number(pin.release.match(/v(\d+)$/)[1]) >= 16, "a new release name; the pre-f1934bd v15 artifact is not reused");
  assert.equal(git(repo, "rev-parse", `${pin.sourceCommit}^{commit}`), MA1_CODE_CANDIDATE);
});

test("M-A-1D: a release is built from the exact pinned commit; a dirty development tree never reaches it", { skip: !windows, timeout: 300_000 }, () => {
  const temp = mkdtempSync(join(tmpdir(), "bunny-release-pkg-"));
  try {
    const clone = join(temp, "clone");
    execFileSync("git", ["clone", "--shared", "--quiet", repo, clone]);
    for (const file of TOOLING) copyFileSync(join(repo, file), join(clone, file));
    git(clone, "add", ...TOOLING);
    git(clone, "-c", "user.name=release-test", "-c", "user.email=release-test@invalid", "commit", "--quiet", "--allow-empty", "-m", "tooling under test");
    const tooling = git(clone, "rev-parse", "HEAD");
    // Uncommitted and untracked development edits, as a checkout would have them.
    appendFileSync(join(clone, "src/lib/bunny-host/router.ts"), "\nthrow new Error('DIRTY_TREE_MARKER');\n");
    appendFileSync(join(clone, "install/Bunny-Host.mjs"), "\n// DIRTY_TREE_MARKER\n");
    writeFileSync(join(clone, "src/lib/bunny-missions/dirty-marker.server.ts"), "export const marker = 'DIRTY_TREE_MARKER';\n");
    const out = join(temp, "out");
    const result = powershell(join(repo, "scripts/package-bunny-desktop.ps1"), ["-Repository", clone, "-OutputDirectory", out, "-SkipDashboardBuild", "-NoArchive"], temp);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const release = join(out, "Bunny-A-Windows-v16");
    const manifest = JSON.parse(readFileSync(join(release, "release-manifest.json"), "utf8"));
    assert.equal(manifest.sourceCommit, MA1_CODE_CANDIDATE);
    assert.equal(manifest.toolingCommit, tooling);
    assert.equal(manifest.compatibility.hostSchemaUserVersion, 3);
    assert.equal(manifest.build.dashboardBuild, false);
    // Byte-identical to the git blobs of the pinned commit (source) and the tooling commit.
    const check = sourceCheck(clone, release);
    assert.ok(check.ok, JSON.stringify(check.mismatched));
    assert.ok(verifyRelease(release).ok);
    const files = walkFiles(release);
    for (const file of files) if (!file.startsWith("runtime/")) assert.ok(!readFileSync(join(release, file), "utf8").includes("DIRTY_TREE_MARKER"), `${file} carries a dirty-tree edit`);
    assert.ok(!files.some((f) => f.includes("dirty-marker") || /\.test\.(ts|mjs)$/.test(f) || f.split("/").includes(".git")));
    // The Mission runtime and every M-A-1 repair are present, and the Host import graph stays in the release.
    for (const file of ["Bunny-Host.mjs", "Start-Bunny-Release.ps1", "Bunny-Release-Info.ps1", "Bunny-Island.ps1", "scripts/bunny-tunnel.mjs", "runtime/node.exe",
      "src/lib/bunny-missions/manager.server.ts", "src/lib/bunny-missions/inbox.server.ts", "src/lib/bunny-missions/capabilities/process.server.ts",
      "src/lib/bunny-missions/capabilities/browser.server.ts", "src/lib/bunny-host/adapters.server.ts", "src/lib/bunny-host/router.ts", "src/lib/orch/exec.server.ts"]) assert.ok(files.includes(file), `${file} missing`);
    const closure = importClosure(release);
    assert.ok(closure.ok, JSON.stringify(closure));
    assert.ok(closure.files.includes("src/lib/bunny-missions/manager.server.ts") && closure.files.includes("src/lib/bunny-missions/capabilities/bus.server.ts"));
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

/** A minimal release whose Host is a stand-in that records how the launcher started it. */
function sandboxRelease(root, name = "Bunny-A-Windows-v99") {
  const release = join(root, name);
  mkdirSync(join(release, "runtime"), { recursive: true });
  mkdirSync(join(release, "src/lib/bunny-host"), { recursive: true });
  copyFileSync(process.execPath, join(release, "runtime/node.exe"));
  copyFileSync(join(repo, "install/Start-Bunny-Release.ps1"), join(release, "Start-Bunny-Release.ps1"));
  copyFileSync(join(repo, "install/Bunny-Release-Info.ps1"), join(release, "Bunny-Release-Info.ps1"));
  writeFileSync(join(release, "src/lib/bunny-host/persistence.server.ts"), "// PRAGMA user_version=3\n");
  writeFileSync(join(release, "Bunny-Host.mjs"), [
    'import { createServer } from "node:http"; import { writeFileSync } from "node:fs"; import { join } from "node:path";',
    'const data = process.env.BUNNY_HOST_DATA_DIRECTORY; const port = Number(process.env.BUNNY_HOST_PORT); const instanceId = `stand-in-${process.pid}`;',
    'writeFileSync(join(data, "credentials.json"), JSON.stringify({ instanceId, port, pid: process.pid, token: "test" }));',
    'writeFileSync(join(data, "stand-in-host.json"), JSON.stringify({ cwd: process.cwd(), execPath: process.execPath, argv: process.argv, data }));',
    'createServer((req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ app: "Bunny-A", instanceId, pid: process.pid })); }).listen(port, "127.0.0.1");',
  ].join("\n"));
  writeFileSync(join(release, "package.json"), '{"type":"module"}');
  writeFileSync(join(release, ".release-build.json"), JSON.stringify({ release: name, version: "99.0.0", sourceCommit: MA1_CODE_CANDIDATE, toolingCommit: "test", builtAt: new Date().toISOString(), build: { dashboardBuild: false }, compatibility: { hostEntry: "Bunny-Host.mjs" }, origins: [
    { path: "Bunny-Host.mjs", origin: "source", repoPath: "install/Bunny-Host.mjs" },
    { path: "src/lib/bunny-host/persistence.server.ts", origin: "source", repoPath: "src/lib/bunny-host/persistence.server.ts" },
    { path: "Start-Bunny-Release.ps1", origin: "tooling", repoPath: "install/Start-Bunny-Release.ps1" },
    { path: "Bunny-Release-Info.ps1", origin: "tooling", repoPath: "install/Bunny-Release-Info.ps1" },
  ] }));
  writeManifest(release);
  return release;
}

test("M-A-1D: the logon launcher starts the release runtime in the separate workspace and refuses a changed release", { skip: !windows, timeout: 120_000 }, async () => {
  const temp = mkdtempSync(join(tmpdir(), "bunny-release-launch-"));
  let hostPid = null;
  try {
    const release = sandboxRelease(join(temp, "releases"));
    const state = join(temp, "state"); const data = join(state, ".bunny-a"); const workspace = join(temp, "workspace");
    mkdirSync(data, { recursive: true }); mkdirSync(workspace);
    const config = join(temp, "install.json");
    writeFileSync(config, JSON.stringify({ stateRoot: state, workspace, hostPort: await freePort() }));
    const launch = () => powershell(join(release, "Start-Bunny-Release.ps1"), ["-InstallConfig", config, "-NoIsland", "-NoGateway", "-NoRemote"], temp);
    const first = launch();
    assert.equal(first.status, 0, first.stderr);
    const started = JSON.parse(readFileSync(join(data, "stand-in-host.json"), "utf8"));
    hostPid = JSON.parse(readFileSync(join(data, "credentials.json"), "utf8")).pid;
    assert.ok(same(started.cwd, workspace), `Host default folder ${started.cwd}`);
    assert.ok(same(started.execPath, join(release, "runtime/node.exe")), `Host runtime ${started.execPath}`);
    assert.ok(same(started.argv[1], join(release, "Bunny-Host.mjs")));
    assert.ok(same(started.data, data));
    const second = launch();
    assert.equal(second.status, 0, second.stderr);
    const events = readFileSync(join(data, "release-launch.log"), "utf8").trim().split(/\r?\n/).map((line) => JSON.parse(line.replace(/^\uFEFF/, "")));
    assert.deepEqual(events.map((e) => e.event), ["host.started", "host.already-running"]);
    assert.equal(events[1].fromThisRelease, true);
    assert.equal(events[0].sourceCommit, MA1_CODE_CANDIDATE);
    // An edited release file is a changed deployment, not a new production build: nothing starts.
    appendFileSync(join(release, "Bunny-Host.mjs"), "\n// edited after install\n");
    const tampered = launch();
    assert.notEqual(tampered.status, 0);
    assert.match(tampered.stderr + tampered.stdout, /release file changed or missing: Bunny-Host\.mjs/i);
  } finally {
    if (hostPid) {
      try { process.kill(hostPid); } catch { /* already gone */ }
      // The stand-in's executable and working folder live in the sandbox; wait until it has exited.
      for (let i = 0; i < 50; i++) { try { process.kill(hostPid, 0); } catch { break; } await new Promise((r) => setTimeout(r, 100)); }
    }
    // The stand-in ran a fresh copy of node.exe from the sandbox; a scanner may hold it briefly after exit.
    try { rmSync(temp, { recursive: true, force: true, maxRetries: 40, retryDelay: 500 }); } catch { /* temp leftover only */ }
  }
});

test("M-A-1D: install pins the logon shortcut outside any checkout, links existing data, separates the workspace and can roll back", { skip: !windows, timeout: 240_000 }, () => {
  const temp = mkdtempSync(join(tmpdir(), "bunny-release-install-"));
  try {
    const release = sandboxRelease(join(temp, "built"));
    // A development checkout holding a dashboard package, like <repo>\releases on the workstation.
    const checkout = join(temp, "checkout"); mkdirSync(join(checkout, "releases", "Gateway-v1"), { recursive: true });
    execFileSync("git", ["init", "--quiet", checkout]);
    writeFileSync(join(checkout, "releases", "Gateway-v1", "Bunny-Server.mjs"), "// gateway\n");
    const data = join(temp, "data"); mkdirSync(data);
    writeFileSync(join(data, "host.sqlite"), "database bytes");
    writeFileSync(join(data, "deployment.json"), JSON.stringify({ packagePath: join(checkout, "releases", "Gateway-v1") }));
    const startup = join(temp, "startup"); mkdirSync(startup);
    const link = join(startup, "Bunny-A.lnk");
    ps(`$l=(New-Object -ComObject WScript.Shell).CreateShortcut('${link}');$l.TargetPath='C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';$l.Arguments='-File "${join(checkout, "scripts", "start-bunny-island.ps1")}"';$l.WorkingDirectory='${checkout}';$l.Save()`);
    const before = shortcut(link);
    const install = join(temp, "install"); const workspace = join(temp, "Bunny-Workspace");
    const installer = join(repo, "scripts/install-bunny-release.ps1");
    const common = ["-InstallRoot", install, "-DataDirectory", data, "-StartupDirectory", startup, "-AllowTestPackage"];
    // The default task workspace may be neither a checkout nor part of the install.
    assert.match(powershell(installer, ["-Package", release, ...common, "-Workspace", join(checkout, "work")], temp).stderr, /inside a Git checkout/);
    assert.match(powershell(installer, ["-Package", release, ...common, "-Workspace", join(install, "releases", "work")], temp).stderr, /must be separate/);
    assert.ok(!existsSync(join(install, "releases", "Bunny-A-Windows-v99")), "a refused install installs nothing");
    assert.deepEqual(shortcut(link), before, "a refused install leaves the startup untouched");

    const result = powershell(installer, ["-Package", release, ...common, "-Workspace", workspace], temp);
    assert.equal(result.status, 0, result.stderr);
    const installed = join(install, "releases", "Bunny-A-Windows-v99");
    const after = shortcut(link);
    assert.match(after.target, /powershell\.exe$/i);
    assert.equal(after.arguments, `-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "${join(installed, "Start-Bunny-Release.ps1")}"`);
    assert.ok(!after.arguments.includes(checkout) && !after.workingDirectory.includes(checkout));
    assert.equal(insideGit(installed), null, "the startup target is outside every Git checkout");
    assert.ok(verifyRelease(installed).ok);
    assert.equal(statSync(join(installed, "Bunny-Host.mjs")).mode & 0o200, 0, "installed release files are read-only");
    // Existing data is linked in place: the same database, never a new one.
    assert.ok(lstatSync(join(install, "state", ".bunny-a")).isSymbolicLink());
    assert.ok(same(join(install, "state", ".bunny-a"), data));
    assert.equal(readFileSync(join(install, "state", ".bunny-a", "host.sqlite"), "utf8"), "database bytes");
    const config = JSON.parse(readFileSync(join(install, "install.json"), "utf8").replace(/^\uFEFF/, ""));
    assert.ok(same(config.workspace, workspace) && existsSync(workspace) && insideGit(workspace) === null);
    assert.equal(config.currentRelease.sourceCommit, MA1_CODE_CANDIDATE);
    // A dashboard package inside the checkout is copied out byte for byte and deployment.json follows it.
    const deployment = JSON.parse(readFileSync(join(data, "deployment.json"), "utf8").replace(/^\uFEFF/, ""));
    assert.ok(same(deployment.packagePath, join(install, "releases", "Gateway-v1")) && insideGit(deployment.packagePath) === null);
    assert.equal(readFileSync(join(deployment.packagePath, "Bunny-Server.mjs"), "utf8"), "// gateway\n");
    // Rollback needs no Git: the saved shortcut and deployment.json come back.
    assert.ok(existsSync(join(config.rollbackDirectory, "Bunny-A.lnk")) && existsSync(join(config.rollbackDirectory, "ROLLBACK.md")));
    const rollback = powershell(installer, ["-Rollback", "-InstallRoot", install, "-StartupDirectory", startup], temp);
    assert.equal(rollback.status, 0, rollback.stderr);
    assert.deepEqual(shortcut(link), before);
    assert.ok(same(JSON.parse(readFileSync(join(data, "deployment.json"), "utf8").replace(/^\uFEFF/, "")).packagePath, join(checkout, "releases", "Gateway-v1")));
    assert.ok(existsSync(installed), "rollback keeps installed releases");
  } finally {
    try { execFileSync("cmd.exe", ["/c", "attrib", "-r", join(temp, "*"), "/s", "/d"], { stdio: "ignore" }); } catch { /* best effort */ }
    rmSync(temp, { recursive: true, force: true });
  }
});
