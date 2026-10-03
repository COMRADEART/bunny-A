import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { closeSync, copyFileSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { assertIdleDatabase, compareDatabases, databaseReport, fileDigest, migrationPreflight, prepareMigration, snapshotDatabase } from "./bunny-state-migration.mjs";
import { tunnelPaths } from "./bunny-tunnel-paths.mjs";
import { hostStatePaths } from "../src/lib/bunny-host/state-paths.server.ts";
import { walkFiles, writeManifest } from "./bunny-release.mjs";

const TABLES = ["tasks", "outcomes", "events", "projects", "devices", "settings", "missions", "mission_steps", "mission_authorizations", "capability_grants", "capability_runs", "skills", "skill_versions", "inbox_events", "mission_memory", "mission_artifacts", "mission_dependencies", "permission_requests", "policies", "triggers", "workspace_locks", "providers", "migrations"];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "bunny-state-test-"));
  const source = join(root, "checkout", ".bunny-a"); const install = join(root, "install");
  mkdirSync(join(source, "validation"), { recursive: true }); mkdirSync(install);
  writeFileSync(join(source, "validation", "evidence.txt"), "retained validation evidence");
  mkdirSync(join(source, "validation", "empty-workspace"));
  writeFileSync(join(source, "credentials.json"), JSON.stringify({ token: "fixture-credential", port: 43119, instanceId: "old", pid: 1 }));
  writeFileSync(join(source, "remote-consent.json"), JSON.stringify({ enabled: false, provider: "Cloudflare" }));
  writeFileSync(join(source, "host.log"), "retained log\n");
  writeFileSync(join(source, "tunnel-process.json"), JSON.stringify({ pid: 123, root: join(root, "checkout") }));
  const db = new DatabaseSync(join(source, "host.sqlite"));
  db.exec("PRAGMA journal_mode=WAL; PRAGMA user_version=3");
  for (const table of TABLES) {
    db.exec(table === "events" ? "CREATE TABLE events(sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE,record TEXT NOT NULL,evidence BLOB)" : `CREATE TABLE ${table}(id TEXT PRIMARY KEY,record TEXT NOT NULL,evidence BLOB)`);
    const record = table === "tasks" ? { id: "task1", state: "completed", cwd: source, output: "original result" }
      : table === "missions" ? { id: "mission1", state: "completed" }
      : table === "projects" ? { id: "project1", path: join(source, "validation"), name: "validation", extra: 7 }
      : { id: `${table}1`, original: true };
    db.prepare(`INSERT INTO ${table}(id,record,evidence) VALUES(?,?,?)`).run(record.id, JSON.stringify(record), new Uint8Array([0, 1, 255]));
  }
  db.close();
  return { root, source, install, target: join(install, "state"), stage: join(install, "stage"), backup: join(install, "backup") };
}
const clean = (f) => rmSync(f.root, { recursive: true, force: true });

test("MA2 T1: the read-only SQLite snapshot includes committed WAL rows", () => {
  const f = fixture(); const db = new DatabaseSync(join(f.source, "host.sqlite"));
  try {
    db.prepare("INSERT INTO events(id,record,evidence) VALUES(?,?,?)").run("wal-event", '{"original":"wal"}', null);
    assert.ok(existsSync(join(f.source, "host.sqlite-wal")));
    const report = snapshotDatabase(join(f.source, "host.sqlite"), join(f.install, "online.sqlite"));
    assert.equal(report.integrity, "ok"); assert.equal(report.userVersion, 3);
    assert.ok(compareDatabases(join(f.source, "host.sqlite"), join(f.install, "online.sqlite")).ok);
    assert.equal(report.tables.find((t) => t.name === "events").count, 2);
  } finally { db.close(); clean(f); }
});

test("MA2 T1: all 23 tables and non-database files survive migration", () => {
  const f = fixture();
  try {
    const before = fileDigest(join(f.source, "host.sqlite")); const result = prepareMigration(f);
    assert.equal(result.before.tables.length, 23); assert.ok(result.preservation.ok);
    assert.equal(fileDigest(join(f.source, "host.sqlite")), before);
    assert.equal(readFileSync(join(f.stage, "logs/host.log"), "utf8"), "retained log\n");
    assert.equal(readFileSync(join(f.stage, "credentials/credentials.json"), "utf8"), readFileSync(join(f.source, "credentials.json"), "utf8"));
    assert.ok(!existsSync(join(f.stage, "runtime/tunnel-process.json")), "a dead worker record is retained only in the full backup");
    assert.ok(existsSync(join(f.backup, "original-state/tunnel-process.json")));
    assert.equal(result.rebases.length, 1); assert.equal(result.rebases[0].after, join(f.target, "validation"));
    assert.ok(existsSync(join(f.stage, "validation/empty-workspace")), "empty registered workspace folders are retained");
    assert.ok(compareDatabases(join(f.backup, "host.sqlite"), join(f.stage, "host.sqlite"), { rebases: result.rebases }).ok);
  } finally { clean(f); }
});

test("MA2 T1: an unexpected changed task field fails preservation", () => {
  const f = fixture();
  try {
    const result = prepareMigration(f); const db = new DatabaseSync(join(f.stage, "host.sqlite"));
    db.prepare("UPDATE tasks SET record=?").run('{"id":"task1","state":"completed","output":"changed"}'); db.close();
    const check = compareDatabases(join(f.backup, "host.sqlite"), join(f.stage, "host.sqlite"), { rebases: result.rebases, live: true });
    assert.equal(check.ok, false); assert.ok(check.mismatches.some((r) => r.table === "tasks"));
  } finally { clean(f); }
});

test("MA2 T1: new telemetry is allowed, but missing historical events fail", () => {
  const f = fixture();
  try {
    const result = prepareMigration(f); const db = new DatabaseSync(join(f.stage, "host.sqlite"));
    db.prepare("UPDATE providers SET record=?").run('{"id":"providers1","checkedAt":10}');
    db.prepare("INSERT INTO events(id,record,evidence) VALUES(?,?,?)").run("new", '{"type":"provider.status"}', null); db.close();
    assert.ok(compareDatabases(join(f.backup, "host.sqlite"), join(f.stage, "host.sqlite"), { rebases: result.rebases, live: true }).ok);
    const next = new DatabaseSync(join(f.stage, "host.sqlite")); next.prepare("DELETE FROM events WHERE id=?").run("events1"); next.close();
    assert.equal(compareDatabases(join(f.backup, "host.sqlite"), join(f.stage, "host.sqlite"), { rebases: result.rebases, live: true }).ok, false);
  } finally { clean(f); }
});

for (const table of ["tasks", "missions"]) test(`MA2 T1: active ${table} refuse migration before copy`, () => {
  const f = fixture();
  try {
    const db = new DatabaseSync(join(f.source, "host.sqlite")); db.prepare(`UPDATE ${table} SET record=?`).run(JSON.stringify({ id: "active", state: "running" })); db.close();
    assert.throws(() => prepareMigration(f), /active tasks or Missions/); assert.ok(!existsSync(f.stage) && !existsSync(f.backup));
  } finally { clean(f); }
});

test("MA2 T1: unknown schema refuses migration", () => {
  const f = fixture();
  try { const db = new DatabaseSync(join(f.source, "host.sqlite")); db.exec("PRAGMA user_version=4"); db.close(); assert.throws(() => prepareMigration(f), /schema 3 only/); assert.ok(!existsSync(f.stage)); }
  finally { clean(f); }
});

test("MA2 T1: an occupied stage is never overwritten", () => {
  const f = fixture();
  try { mkdirSync(f.stage); writeFileSync(join(f.stage, "user-file"), "keep"); assert.throws(() => prepareMigration(f), /already exists/); assert.equal(readFileSync(join(f.stage, "user-file"), "utf8"), "keep"); }
  finally { clean(f); }
});

test("MA2 T1: state cannot be installed inside a Git checkout", () => {
  const f = fixture();
  try { mkdirSync(join(f.install, ".git")); assert.throws(() => prepareMigration(f), /outside Git/); assert.ok(!existsSync(f.stage)); }
  finally { clean(f); }
});

test("MA2 T1: a source directory junction fails preflight", () => {
  const f = fixture();
  try { mkdirSync(join(f.root, "external")); symlinkSync(join(f.root, "external"), join(f.source, "linked"), process.platform === "win32" ? "junction" : "dir"); assert.throws(() => migrationPreflight(f.source, f.target), /reparse point/); assert.ok(!existsSync(f.stage)); }
  finally { clean(f); }
});

test("MA2 T1: a target junction cannot hide a repository dependency", () => {
  const f = fixture();
  try { symlinkSync(f.source, f.target, process.platform === "win32" ? "junction" : "dir"); assert.throws(() => prepareMigration(f), /link/); }
  finally { clean(f); }
});

test("MA2 T1: copied hard-linked files become independent files", () => {
  const f = fixture();
  try {
    writeFileSync(join(f.root, "shared.txt"), "original"); linkSync(join(f.root, "shared.txt"), join(f.source, "extra-evidence.txt"));
    prepareMigration(f); assert.equal(lstatSync(join(f.stage, "extra-evidence.txt")).nlink, 1);
    writeFileSync(join(f.root, "shared.txt"), "changed outside state"); assert.equal(readFileSync(join(f.stage, "extra-evidence.txt"), "utf8"), "original");
  } finally { clean(f); }
});

test("MA2 T1: git clean in a disposable checkout cannot delete migrated state", () => {
  const f = fixture();
  try {
    const checkout = join(f.root, "checkout"); execFileSync("git", ["init", "--quiet", checkout]);
    const result = prepareMigration(f); renameSync(f.stage, f.target);
    const hash = fileDigest(join(f.target, "host.sqlite"));
    execFileSync("git", ["-C", checkout, "clean", "-fdx"]);
    assert.ok(!existsSync(f.source)); assert.equal(fileDigest(join(f.target, "host.sqlite")), hash);
    assert.ok(compareDatabases(join(f.backup, "host.sqlite"), join(f.target, "host.sqlite"), { rebases: result.rebases }).ok);
    assert.ok(existsSync(join(f.target, "credentials/credentials.json")) && existsSync(join(f.backup, "host.sqlite")));
  } finally { clean(f); }
});

test("MA2 T1: a named-tunnel configuration needs an explicit credential inventory", () => {
  const f = fixture();
  try { writeFileSync(join(f.source, "tunnel.json"), JSON.stringify({ mode: "named", config: "unknown-credentials.yml" })); assert.throws(() => migrationPreflight(f.source, f.target), /explicit credential\/config inventory/); assert.ok(!existsSync(f.stage)); }
  finally { clean(f); }
});

test("MA2 T1: the installed tunnel uses application state and rejects a missing or changed client", () => {
  const f = fixture();
  try {
    prepareMigration(f); renameSync(f.stage, f.target);
    const binary = join(f.target, "cloudflared/cloudflared.exe"); writeFileSync(binary, "test tool bytes");
    const hash = fileDigest(binary); writeFileSync(join(f.target, "cloudflared/tool.json"), JSON.stringify({ sha256: hash }));
    const env = { BUNNY_STATE_LAYOUT: "2", BUNNY_HOST_DATA_DIRECTORY: f.target, BUNNY_CLOUDFLARED_SHA256: hash };
    const paths = tunnelPaths(env, join(f.root, "checkout")); assert.equal(paths.binary, binary); assert.equal(paths.root, f.target);
    writeFileSync(binary, "changed tool"); assert.throws(() => tunnelPaths(env), /missing or changed/);
    rmSync(binary); assert.throws(() => tunnelPaths(env), /missing or changed/);
  } finally { clean(f); }
});

test("MA2 T1: installed Host state fails closed without an explicit path or database", () => {
  const f = fixture();
  try {
    assert.throws(() => hostStatePaths(undefined, { BUNNY_STATE_LAYOUT: "2" }), /absolute/);
    assert.throws(() => hostStatePaths(f.target, { BUNNY_STATE_LAYOUT: "2" }), /state is missing/);
    assert.ok(!existsSync(join(f.target, "host.sqlite")));
  } finally { clean(f); }
});

test("MA2 T1: installed Host resolves flat canonical state and moved credentials", () => {
  const f = fixture();
  try {
    prepareMigration(f); renameSync(f.stage, f.target);
    const paths = hostStatePaths(f.target, { BUNNY_STATE_LAYOUT: "2" });
    assert.equal(paths.database, join(f.target, "host.sqlite")); assert.equal(paths.credentials, join(f.target, "credentials/credentials.json"));
    assert.ok(!existsSync(join(f.target, ".bunny-a")));
  } finally { clean(f); }
});

test("MA2 T1: a truncated database and unknown layout fail closed without creating state", () => {
  const f = fixture();
  try {
    prepareMigration(f); renameSync(f.stage, f.target);
    assert.throws(() => hostStatePaths(f.target, { BUNNY_STATE_LAYOUT: "3" }), /Unknown/);
    assert.throws(() => hostStatePaths(f.target, {}), /Legacy fallback/);
    writeFileSync(join(f.target,"host.sqlite"),new Uint8Array());
    assert.throws(() => hostStatePaths(f.target,{BUNNY_STATE_LAYOUT:"2"}), /damaged|unexpected schema/);
    assert.equal(readFileSync(join(f.target,"host.sqlite")).length,0);
  } finally { clean(f); }
});

test("MA2 T1: a retired production source cannot become development state", () => {
  const f = fixture();
  try { writeFileSync(join(f.source, "state-retired.json"), "{}"); assert.throws(() => hostStatePaths(f.source, {}), /retired/); assertIdleDatabase(join(f.source, "host.sqlite")); assert.equal(databaseReport(join(f.source, "host.sqlite")).integrity, "ok"); }
  finally { clean(f); }
});

const repo = fileURLToPath(new URL("..", import.meta.url));
const sourceCommit = "f1934bda6b0d33f27bef198e8967a69f6eb329ff";
const winEnv = () => ({ ...process.env, BUNNY_MIGRATION_TEST_MODE: "1", PSModulePath: join(process.env.WINDIR, "System32/WindowsPowerShell/v1.0/Modules") });
const winps = () => join(process.env.WINDIR, "System32/WindowsPowerShell/v1.0/powershell.exe");
function psFile(file, args, folder) {
  const name = join(folder, `ps-${Math.random().toString(36).slice(2)}`);
  const stdout = openSync(name + ".out", "w"); const stderr = openSync(name + ".err", "w");
  try {
    const result = spawnSync(winps(), ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", file, ...args], { env: winEnv(), stdio: ["ignore", stdout, stderr], timeout: 120_000 });
    return { status: result.status, stdout: readFileSync(name + ".out", "utf8"), stderr: readFileSync(name + ".err", "utf8") };
  } finally { closeSync(stdout); closeSync(stderr); }
}
const freePort = () => new Promise((resolvePort) => { const server = createServer(); server.listen(0, "127.0.0.1", () => { const port = server.address().port; server.close(() => resolvePort(port)); }); });
function controllerRelease(root, legacy) {
  const release = join(root, legacy ? "Pinned-Old-Test" : "Pinned-Candidate-Test");
  mkdirSync(join(release, "runtime"), { recursive: true }); mkdirSync(join(release, "src/lib/bunny-host"), { recursive: true }); mkdirSync(join(release, "scripts"));
  copyFileSync(process.execPath, join(release, "runtime/node.exe"));
  for (const file of ["Bunny-State.ps1", "Start-Bunny-Release.ps1"]) copyFileSync(join(repo, "install", file), join(release, file));
  if (legacy) writeFileSync(join(release, "Start-Bunny-Release.ps1"), execFileSync("git", ["-C", repo, "cat-file", "blob", "be6e2e56c627a8969b7ecc1c9d992737710d5c11:install/Start-Bunny-Release.ps1"]));
  for (const file of ["migrate-bunny-state.ps1", "bunny-state-migration.mjs"]) copyFileSync(join(repo, "scripts", file), join(release, "scripts", file));
  writeFileSync(join(release, "src/lib/bunny-host/persistence.server.ts"), "// PRAGMA user_version=3\n");
  writeFileSync(join(release, "Bunny-Host.mjs"), `
    import {createServer} from 'node:http'; import {readFileSync,writeFileSync} from 'node:fs'; import {join} from 'node:path'; import {DatabaseSync} from 'node:sqlite';
    const data=process.env.BUNNY_HOST_DATA_DIRECTORY; const credential=process.env.BUNNY_STATE_LAYOUT==='2'?process.env.BUNNY_HOST_CREDENTIALS_FILE:join(data,'credentials.json');
    const old=JSON.parse(readFileSync(credential,'utf8')); const instanceId='fixture-'+process.pid; const port=Number(process.env.BUNNY_HOST_PORT);
    const db=new DatabaseSync(join(data,'host.sqlite'),{readOnly:true});
    writeFileSync(credential,JSON.stringify({...old,instanceId,port,pid:process.pid}));
    const list=table=>db.prepare('SELECT record FROM '+table).all().map(r=>JSON.parse(r.record));
    createServer((req,res)=>{const health={app:'Bunny-A',instanceId,pid:process.pid}; if(req.url!=='/health' && req.headers.authorization!=='Bearer '+old.token){res.writeHead(401);res.end('{}');return;}
      res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(req.url==='/health'?health:{tasks:list('tasks'),projects:list('projects'),missions:{config:{enabled:false,triggersEnabled:false},missions:list('missions')}}));}).listen(port,'127.0.0.1');
  `);
  writeFileSync(join(release, "package.json"), '{"type":"module"}');
  const origins = walkFiles(release).filter((path) => !path.startsWith("runtime/") && path !== "package.json").map((path) => ({ path, origin: "test-fixture", repoPath: path }));
  writeFileSync(join(release, ".release-build.json"), JSON.stringify({ release: legacy ? "Pinned-Old-Test" : "Pinned-Candidate-Test", version: "99.0.0", sourceCommit, toolingCommit: "test", build: { dashboardBuild: false }, compatibility: { stateLayoutVersion: legacy ? 1 : 2 }, origins }));
  const manifest = writeManifest(release);
  return { name: manifest.release, folder: release, sourceCommit, manifestSha256: fileDigest(join(release, "release-manifest.json")) };
}

for (const failure of ["", "after-copy", "after-config", "after-host"]) test(`MA2 T1 Windows controller: ${failure || "complete cutover and idempotent retry"}`, { skip: process.platform !== "win32", timeout: 180_000 }, async () => {
  const f = fixture(); const pids = new Set();
  try {
    const old = controllerRelease(join(f.install, "releases"), true); const candidate = controllerRelease(join(f.install, "releases"), false);
    mkdirSync(join(f.install, "state")); symlinkSync(f.source, join(f.install, "state/.bunny-a"), "junction");
    const startup = join(f.root, "startup"); mkdirSync(startup); const shortcut = join(startup, "Bunny-A.lnk");
    const workspace = join(f.root, "workspace"); mkdirSync(workspace); const port = await freePort(); const configPath = join(f.install, "install.json");
    const config = { schema: "bunny-install/1", installRoot: f.install, stateRoot: join(f.install, "state"), dataDirectory: f.source, workspace, hostPort: port, shortcut, currentRelease: old, previousReleases: [], dataDirectoryInsideGitCheckout: join(f.root, "checkout") };
    writeFileSync(configPath, JSON.stringify(config));
    execFileSync(winps(), ["-NoProfile", "-Command", `$l=(New-Object -ComObject WScript.Shell).CreateShortcut('${shortcut}');$l.TargetPath='${winps()}';$l.Arguments='-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "${join(old.folder, "Start-Bunny-Release.ps1")}"';$l.WorkingDirectory='${old.folder}';$l.Save()`], { env: winEnv() });
    const started = psFile(join(old.folder, "Start-Bunny-Release.ps1"), ["-InstallConfig", configPath, "-NoIsland", "-NoGateway", "-NoRemote"], f.root);
    assert.equal(started.status, 0, started.stderr); pids.add(JSON.parse(readFileSync(join(f.source, "credentials.json"), "utf8")).pid);
    const args = ["-InstallConfig", configPath, "-CandidateRelease", candidate.folder, "-ExpectedManifestSha256", candidate.manifestSha256, "-ExpectedSourceCommit", sourceCommit, "-NoIsland"];
    if (failure) args.push("-TestFailAfter", failure);
    const result = psFile(join(candidate.folder, "scripts/migrate-bunny-state.ps1"), args, f.root);
    const current = JSON.parse(readFileSync(configPath, "utf8"));
    const credential = current.schema === "bunny-install/2" ? join(current.stateRoot, "credentials/credentials.json") : join(current.dataDirectory, "credentials.json");
    const saved = JSON.parse(readFileSync(credential, "utf8")); pids.add(saved.pid);
    if (!failure) {
      assert.equal(result.status, 0, result.stderr);
      assert.equal(current.schema, "bunny-install/2"); assert.equal(current.dataDirectory, join(f.install, "state"));
      assert.ok(!lstatSync(current.stateRoot).isSymbolicLink() && !existsSync(join(current.stateRoot, ".bunny-a")));
      assert.equal(databaseReport(join(current.stateRoot, "host.sqlite")).integrity, "ok");
      assert.ok(JSON.parse(readFileSync(join(current.stateMigration, "preservation-live.json"), "utf8")).ok);
      assert.ok(existsSync(join(f.source, "state-retired.json")));
      assert.ok(!existsSync(join(f.source,"host.sqlite")) && !existsSync(join(f.source,"credentials.json")));
      assert.ok(existsSync(join(current.stateMigration,"retired-original-state/host.sqlite")));
      const again = psFile(join(candidate.folder, "scripts/migrate-bunny-state.ps1"), args, f.root);
      assert.equal(again.status, 0, again.stderr); assert.match(again.stdout, /already-migrated/);
    } else {
      assert.notEqual(result.status, 0); assert.match(result.stderr, /Test failure/);
      assert.equal(current.currentRelease.folder, old.folder);
      assert.ok(current.dataDirectory.startsWith(join(f.install, "backups")));
      assert.ok(!current.dataDirectory.startsWith(join(f.root, "checkout")));
      assert.equal(databaseReport(join(current.dataDirectory, "host.sqlite")).integrity, "ok");
      const recoveredDb=new DatabaseSync(join(current.dataDirectory, "host.sqlite"),{readOnly:true});const recoveredProject=JSON.parse(recoveredDb.prepare("SELECT record FROM projects").get().record);recoveredDb.close();
      assert.equal(recoveredProject.path,join(current.dataDirectory,"validation"));
    }
    assert.equal(saved.token, "fixture-credential");
    const live = await fetch(`http://127.0.0.1:${port}/state`, { headers: { authorization: `Bearer ${saved.token}` } });
    assert.equal(live.status, 200); assert.equal((await live.json()).tasks.length, 1);
  } finally {
    for (const pid of pids) {
      execFileSync(winps(), ["-NoProfile", "-Command", `$p=Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}';if($p -and $p.ExecutablePath.StartsWith('${f.install}\\releases\\') -and $p.CommandLine.Contains('Bunny-Host.mjs')){Stop-Process -Id ${pid};Wait-Process -Id ${pid} -Timeout 10 -ErrorAction SilentlyContinue}`], { env: winEnv() });
    }
    rmSync(f.root, { recursive: true, force: true, maxRetries: 40, retryDelay: 500 });
  }
});
