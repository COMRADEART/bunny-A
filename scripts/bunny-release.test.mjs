// M-A-1D deployment hardening: the installed Bunny-A Host runs a pinned release, never a development checkout.
import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync, spawnSync, spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { appendFileSync, chmodSync, closeSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { importClosure, sourceCheck, verifyRelease, walkFiles, writeManifest } from "./bunny-release.mjs";

const repo = fileURLToPath(new URL("..", import.meta.url));
// Hosted Windows runners set TEMP to an 8.3 short path (C:\Users\RUNNER~1\...); the scripts under test compare long paths.
const TEMP = realpathSync.native(tmpdir());
const windows = process.platform === "win32";
const MA1_CODE_CANDIDATE = "f1934bda6b0d33f27bef198e8967a69f6eb329ff";
const TOOLING = ["install/Start-Bunny-Release.ps1", "install/Bunny-Release-Info.ps1", "install/Bunny-State.ps1", "install/release-pin.json", "scripts/migrate-bunny-state.ps1", "scripts/bunny-state-migration.mjs", "scripts/install-bunny-release.ps1"];
const candidatePin = () => JSON.parse(readFileSync(join(repo, "install/release-pin.json"), "utf8"));
const winEnv = () => ({ ...process.env, PSModulePath: join(process.env.WINDIR ?? "C:\\Windows", "System32/WindowsPowerShell/v1.0/Modules") });
const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
/** Output goes to files, not pipes: processes the launcher starts inherit its handles, and an inherited pipe would hold spawnSync open. */
function powershell(file, args, logs) {
  const out = join(logs, `ps-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const stdout = openSync(`${out}.out`, "w"); const stderr = openSync(`${out}.err`, "w");
  try {
    const result = spawnSync(join(process.env.WINDIR ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"), ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", file, ...args], { env: winEnv(), stdio: ["ignore", stdout, stderr], timeout: 240_000 });
    return { status: result.status, stdout: readFileSync(`${out}.out`, "utf8"), stderr: readFileSync(`${out}.err`, "utf8") };
  } finally { closeSync(stdout); closeSync(stderr); }
}
const ps = (command) => execFileSync("powershell.exe", ["-NoProfile", "-Command", command], { env: winEnv(), encoding: "utf8" }).trim();
const same = (a, b) => realpathSync(a).toLowerCase() === realpathSync(b).toLowerCase();
const insideGit = (path) => { for (let folder = path; ; folder = dirname(folder)) { if (existsSync(join(folder, ".git"))) return folder; if (dirname(folder) === folder) return null; } };
const shortcut = (path) => JSON.parse(ps(`$l=(New-Object -ComObject WScript.Shell).CreateShortcut('${path}');[pscustomobject]@{target=$l.TargetPath;arguments=$l.Arguments;workingDirectory=$l.WorkingDirectory}|ConvertTo-Json`));
const freePort = () => new Promise((resolve) => { const server = createServer(); server.listen(0, "127.0.0.1", () => { const { port } = server.address(); server.close(() => resolve(port)); }); });

test("M-A-1D: the production release pin is the reviewed M-A-1 code candidate", () => {
  const pin = JSON.parse(readFileSync(join(repo, "install/release-pin.json"), "utf8"));
  assert.equal(pin.baselineCommit ?? pin.sourceCommit, MA1_CODE_CANDIDATE);
  assert.match(pin.release, /^Bunny-A-Windows-v\d+(?:-T\d+|-MA2-R1)?$/);
  assert.ok(Number(pin.release.match(/v(\d+)(?:-T\d+|-MA2-R1)?$/)[1]) >= 16, "a new release name; the pre-f1934bd v15 artifact is not reused");
  assert.equal(git(repo, "rev-parse", `${pin.sourceCommit}^{commit}`), pin.sourceCommit);
  execFileSync("git", ["-C", repo, "merge-base", "--is-ancestor", MA1_CODE_CANDIDATE, pin.sourceCommit]);
});

test("M-A-1D: a release is built from the exact pinned commit; a dirty development tree never reaches it", { skip: !windows, timeout: 300_000 }, () => {
  const temp = mkdtempSync(join(TEMP, "bunny-release-pkg-"));
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
    const release = join(out, candidatePin().release);
    const manifest = JSON.parse(readFileSync(join(release, "release-manifest.json"), "utf8"));
    assert.equal(manifest.sourceCommit, candidatePin().sourceCommit);
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
  copyFileSync(join(repo, "install/Bunny-State.ps1"), join(release, "Bunny-State.ps1"));
  writeFileSync(join(release, "src/lib/bunny-host/persistence.server.ts"), "// PRAGMA user_version=3\n");
  writeFileSync(join(release, "Bunny-Host.mjs"), [
    'import { createServer } from "node:http"; import { writeFileSync } from "node:fs"; import { join } from "node:path";',
    'const data = process.env.BUNNY_HOST_DATA_DIRECTORY; const port = Number(process.env.BUNNY_HOST_PORT); const instanceId = `stand-in-${process.pid}`;',
    'writeFileSync(process.env.BUNNY_HOST_CREDENTIALS_FILE, JSON.stringify({ instanceId, port, pid: process.pid, token: "test" }));',
    'writeFileSync(join(data, "stand-in-host.json"), JSON.stringify({ cwd: process.cwd(), execPath: process.execPath, argv: process.argv, data }));',
    'createServer((req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ app: "Bunny-A", instanceId, pid: process.pid })); }).listen(port, "127.0.0.1");',
  ].join("\n"));
  writeFileSync(join(release, "package.json"), '{"type":"module"}');
  writeFileSync(join(release, ".release-build.json"), JSON.stringify({ release: name, version: "99.0.0", sourceCommit: MA1_CODE_CANDIDATE, toolingCommit: "test", builtAt: new Date().toISOString(), build: { dashboardBuild: false }, compatibility: { hostEntry: "Bunny-Host.mjs", stateLayoutVersion: 2 }, origins: [
    { path: "Bunny-Host.mjs", origin: "source", repoPath: "install/Bunny-Host.mjs" },
    { path: "src/lib/bunny-host/persistence.server.ts", origin: "source", repoPath: "src/lib/bunny-host/persistence.server.ts" },
    { path: "Start-Bunny-Release.ps1", origin: "tooling", repoPath: "install/Start-Bunny-Release.ps1" },
    { path: "Bunny-Release-Info.ps1", origin: "tooling", repoPath: "install/Bunny-Release-Info.ps1" },
    { path: "Bunny-State.ps1", origin: "tooling", repoPath: "install/Bunny-State.ps1" },
  ] }));
  writeManifest(release);
  return release;
}

test("M-A-1D: the logon launcher starts the release runtime in the separate workspace and refuses a changed release", { skip: !windows, timeout: 120_000 }, async () => {
  const temp = mkdtempSync(join(TEMP, "bunny-release-launch-"));
  let hostPid = null;
  try {
    const release = sandboxRelease(join(temp, "releases"));
    const state = join(temp, "state"); const data = state; const workspace = join(temp, "workspace");
    for(const folder of ["credentials", "settings", "logs", "runtime", "sessions", "backups", "cloudflared"]) mkdirSync(join(state, folder), { recursive: true });
    writeFileSync(join(data, "host.sqlite"), "stand-in database");
    writeFileSync(join(data, "state-layout.json"), JSON.stringify({ schema: "bunny-state/2", stateRoot: state }));
    mkdirSync(workspace);
    const config = join(temp, "install.json");
    writeFileSync(config, JSON.stringify({ schema: "bunny-install/2", stateLayoutVersion: 2, stateRoot: state, dataDirectory: data, workspace, hostPort: await freePort(), currentRelease: { name: "Bunny-A-Windows-v99", folder: release, sourceCommit: MA1_CODE_CANDIDATE, manifestSha256: (await import("./bunny-release.mjs")).fileSha256(join(release, "release-manifest.json")) } }));
    const launch = () => powershell(join(release, "Start-Bunny-Release.ps1"), ["-InstallConfig", config, "-NoIsland", "-NoGateway", "-NoRemote"], temp);
    const first = launch();
    assert.equal(first.status, 0, first.stderr);
    const started = JSON.parse(readFileSync(join(data, "stand-in-host.json"), "utf8"));
    hostPid = JSON.parse(readFileSync(join(data, "credentials/credentials.json"), "utf8")).pid;
    assert.ok(same(started.cwd, workspace), `Host default folder ${started.cwd}`);
    assert.ok(same(started.execPath, join(release, "runtime/node.exe")), `Host runtime ${started.execPath}`);
    assert.ok(same(started.argv[1], join(release, "Bunny-Host.mjs")));
    assert.ok(same(started.data, data));
    const second = launch();
    assert.equal(second.status, 0, second.stderr);
    const events = readFileSync(join(data, "logs/release-launch.log"), "utf8").trim().split(/\r?\n/).map((line) => JSON.parse(line.replace(/^\uFEFF/, "")));
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

test("M-A-1D/M-A-2: install pins startup outside Git, requires canonical state, separates the workspace and rolls back to a pinned release", { skip: !windows, timeout: 240_000 }, async () => {
  const temp = mkdtempSync(join(TEMP, "bunny-release-install-"));
  let idleHost = null; let hostPort;
  try {
    const release = sandboxRelease(join(temp, "built"));
    const checkout = join(temp, "checkout"); mkdirSync(join(checkout, "releases", "Gateway-v1"), { recursive: true });
    execFileSync("git", ["init", "--quiet", checkout]);
    writeFileSync(join(checkout, "releases", "Gateway-v1", "Bunny-Server.mjs"), "// gateway\n");
    const install = join(temp, "install"); const data = join(install, "state");
    for (const folder of ["settings", "credentials", "runtime", "logs", "backups", "cloudflared", "sessions"]) mkdirSync(join(data, folder), { recursive: true });
    const db = new DatabaseSync(join(data, "host.sqlite"));
    db.exec('CREATE TABLE tasks(record TEXT);CREATE TABLE missions(record TEXT);CREATE TABLE capability_runs(record TEXT);CREATE TABLE approval_batches(record TEXT);CREATE TABLE settings(key TEXT,value TEXT);CREATE TABLE preserved_user_data(value TEXT)');
    db.prepare('INSERT INTO settings VALUES (?,?)').run('missions_config',JSON.stringify({enabled:false,triggersEnabled:false}));
    db.prepare('INSERT INTO preserved_user_data VALUES (?)').run('database bytes');db.close();
    const originalDatabase = readFileSync(join(data, "host.sqlite"));
    hostPort = await freePort();
    const idleEntry = join(temp, 'authenticated-idle-host.mjs');
    writeFileSync(idleEntry, `import {createServer} from 'node:http';const server=createServer((req,res)=>{if(req.headers.authorization!=='Bearer t10-install-fixture'){res.writeHead(401);res.end();return;}res.setHeader('content-type','application/json');res.end(JSON.stringify({missions:{enabled:false,config:{triggersEnabled:false}},tasks:[]}));if(req.url==='/close')server.close();});server.listen(${hostPort},'127.0.0.1');`);
    idleHost = spawn(process.execPath,[idleEntry],{stdio:'ignore',windowsHide:true});
    for(let i=0;;i++){try{assert.equal((await fetch(`http://127.0.0.1:${hostPort}/state`,{headers:{authorization:'Bearer t10-install-fixture'}})).status,200);break;}catch(error){if(i>=100)throw error;await new Promise(r=>setTimeout(r,20));}}
    writeFileSync(join(data,'credentials/credentials.json'),JSON.stringify({token:'t10-install-fixture',port:hostPort}));
    writeFileSync(join(data, "state-layout.json"), JSON.stringify({ schema: "bunny-state/2", stateRoot: data }));
    writeFileSync(join(data, "settings/deployment.json"), JSON.stringify({ packagePath: join(checkout, "releases", "Gateway-v1") }));
    const startup = join(temp, "startup"); mkdirSync(startup);
    const link = join(startup, "Bunny-A.lnk");
    ps(`$l=(New-Object -ComObject WScript.Shell).CreateShortcut('${link}');$l.TargetPath='C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';$l.Arguments='-File "${join(checkout, "scripts", "start-bunny-island.ps1")}"';$l.WorkingDirectory='${checkout}';$l.Save()`);
    const before = shortcut(link);
    const workspace = join(temp, "Bunny-Workspace");
    const installer = join(repo, "scripts/install-bunny-release.ps1");
    const common = ["-InstallRoot", install, "-DataDirectory", data, "-StartupDirectory", startup, "-AllowTestPackage", "-HostPort", String(hostPort)];
    assert.match(powershell(installer, ["-Package", release, ...common, "-Workspace", join(checkout, "work")], temp).stderr, /inside a Git checkout/);
    assert.match(powershell(installer, ["-Package", release, ...common, "-Workspace", join(install, "releases", "work")], temp).stderr, /must be separate/);
    const unsafeState = join(checkout, ".bunny-a"); mkdirSync(unsafeState);
    const refused = powershell(installer, ["-Package", release, "-InstallRoot", install, "-DataDirectory", unsafeState, "-Workspace", workspace, "-StartupDirectory", startup, "-AllowTestPackage"], temp);
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /outside Git/);
    assert.ok(!existsSync(join(install, "releases", "Bunny-A-Windows-v99")), "a refused install installs nothing");
    assert.deepEqual(shortcut(link), before, "a refused install leaves startup untouched");

    const result = powershell(installer, ["-Package", release, ...common, "-Workspace", workspace], temp);
    assert.equal(result.status, 0, result.stderr);
    const installed = join(install, "releases", "Bunny-A-Windows-v99");
    const after = shortcut(link);
    assert.match(after.target, /powershell\.exe$/i);
    assert.equal(after.arguments, `-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "${join(installed, "Start-Bunny-Release.ps1")}"`);
    assert.ok(!after.arguments.includes(checkout) && !after.workingDirectory.includes(checkout));
    assert.equal(insideGit(installed), null);
    assert.ok(verifyRelease(installed).ok);
    assert.equal(statSync(join(installed, "Bunny-Host.mjs")).mode & 0o200, 0);
    assert.ok(!lstatSync(data).isSymbolicLink() && !existsSync(join(data, ".bunny-a")));
    assert.deepEqual(readFileSync(join(data, "host.sqlite")), originalDatabase);
    const config = JSON.parse(readFileSync(join(install, "install.json"), "utf8").replace(/^\uFEFF/, ""));
    assert.equal(config.schema, "bunny-install/2"); assert.equal(config.stateLayoutVersion, 2);
    assert.ok(same(config.workspace, workspace) && existsSync(workspace) && insideGit(workspace) === null);
    assert.ok(same(config.dataDirectory, data));
    assert.equal(config.currentRelease.sourceCommit, MA1_CODE_CANDIDATE);
    const deployment = JSON.parse(readFileSync(join(data, "settings/deployment.json"), "utf8").replace(/^\uFEFF/, ""));
    assert.ok(same(deployment.packagePath, join(install, "releases", "Gateway-v1")) && insideGit(deployment.packagePath) === null);
    assert.equal(readFileSync(join(deployment.packagePath, "Bunny-Server.mjs"), "utf8"), "// gateway\n");
    const unsafeRollback = powershell(installer, ["-Rollback", "-InstallRoot", install, "-StartupDirectory", startup, "-RollbackDirectory", config.rollbackDirectory], temp);
    assert.notEqual(unsafeRollback.status, 0);
    assert.match(unsafeRollback.stderr, /Legacy rollback was refused/);
    assert.deepEqual(shortcut(link), after);

    const nextRelease = sandboxRelease(join(temp, "built-next"), "Bunny-A-Windows-v100");
    const next = powershell(installer, ["-Package", nextRelease, ...common, "-Workspace", workspace], temp);
    assert.equal(next.status, 0, next.stderr);
    const nextConfig = JSON.parse(readFileSync(join(install, "install.json"), "utf8"));
    const rollback = powershell(installer, ["-Rollback", "-InstallRoot", install, "-StartupDirectory", startup, "-RollbackDirectory", nextConfig.rollbackDirectory], temp);
    assert.equal(rollback.status, 0, rollback.stderr);
    assert.deepEqual(shortcut(link), after);
    assert.ok(same(JSON.parse(readFileSync(join(data, "settings/deployment.json"), "utf8")).packagePath, deployment.packagePath));
    assert.ok(existsSync(installed) && existsSync(join(install, "releases", "Bunny-A-Windows-v100")));
    assert.deepEqual(readFileSync(join(data, "host.sqlite")), originalDatabase);
  } finally {
    if(idleHost){await fetch(`http://127.0.0.1:${hostPort}/close`,{headers:{authorization:'Bearer t10-install-fixture'}}).catch(()=>{});if(idleHost.exitCode===null)await Promise.race([new Promise(r=>idleHost.once('exit',r)),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Owned idle fixture did not exit')),5000))]);}
    for (const file of walkFiles(temp)) chmodSync(join(temp, file), 0o600);
    rmSync(temp, { recursive: true, force: true, maxRetries: 40, retryDelay: 500 });
  }
});
