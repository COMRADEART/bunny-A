// MA5-S1R1: install-dev-candidate.ps1 replaces or removes only a folder it can prove it installed. Each case runs the
// real script in disposable folders with synthetic candidates (no build needed) and compares file hashes before/after.
// BUNNY_S1R1_INSTALLER may point at another copy of the script (used to reproduce the e094a26 defect).
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync, lstatSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";

const windows = process.platform === "win32";
// Launched from PowerShell 7 (e.g. a CI `pwsh` step), Windows PowerShell would inherit PS7's PSModulePath and fail to load
// its own built-in modules (Get-FileHash "not recognized"); it rebuilds its default path when the variable is absent.
const psEnv = (extra = {}) => { const env = { ...process.env, ...extra }; for (const k of Object.keys(env)) if (k.toLowerCase() === "psmodulepath") delete env[k]; return env; };
const installer = process.env.BUNNY_S1R1_INSTALLER ?? join(process.cwd(), "native/windows/install-dev-candidate.ps1");
const sha = (b) => createHash("sha256").update(b).digest("hex");

function tree(dir) {
  const out = {};
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = lstatSync(p);
    if (st.isSymbolicLink()) out[relative(dir, p)] = "link";
    else if (st.isDirectory()) for (const [k, v] of Object.entries(tree(p))) out[join(name, k)] = v;
    else out[name] = sha(readFileSync(p));
  }
  return out;
}

/** A candidate zip: entries [{name, content}]; candidate.json is generated unless `manifest` overrides it. */
function candidate(dir, name, { version = "0.5.1", files = { "BunnyA.exe": "exe-v1", "BunnyA.dll": "dll-v1" }, extra = [], manifest } = {}) {
  const entries = Object.entries(files).map(([n, c]) => ({ name: n, content: c }));
  const listed = manifest ?? {
    schema: "bunny-windows-dev-candidate.v1", version, entry: "BunnyA.exe",
    files: entries.map((e) => ({ path: e.name, bytes: Buffer.byteLength(e.content), sha256: sha(Buffer.from(e.content)) })),
  };
  const all = [...entries, { name: "candidate.json", content: JSON.stringify(listed) }, ...extra];
  const spec = join(dir, `${name}.json`);
  const zip = join(dir, `${name}.zip`);
  writeFileSync(spec, JSON.stringify(all));
  execFileSync("powershell.exe", ["-NoProfile", "-Command", `
    Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
    $z = [IO.Compression.ZipFile]::Open('${zip.replace(/'/g, "''")}', 'Create')
    foreach ($e in (Get-Content -LiteralPath '${spec.replace(/'/g, "''")}' -Raw | ConvertFrom-Json)) {
      $s = $z.CreateEntry($e.name).Open(); $b = [Text.Encoding]::UTF8.GetBytes($e.content); $s.Write($b, 0, $b.Length); $s.Dispose()
    }
    $z.Dispose()`], { stdio: "pipe", env: psEnv() });
  return zip;
}

function run(args, env = {}) {
  const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", installer, ...args], { encoding: "utf8", env: psEnv(env), timeout: 120_000 });
  return { ok: r.status === 0, out: `${r.stdout}${r.stderr}`.replace(/\s+/g, " ").trim() };
}

function fixture() {
  const base = mkdtempSync(join(tmpdir(), "bunny-s1r1-installer-"));
  const root = join(base, "Programs", "BunnyA-DevCandidate");
  const links = join(base, "StartMenu");
  const install = (pkg, extra = [], env) => run(["-Package", pkg, "-InstallRoot", root, "-ShortcutDirectory", links, ...extra], env);
  const uninstall = (env) => run(["-Uninstall", "-InstallRoot", root, "-ShortcutDirectory", links], env);
  const leftovers = () => (existsSync(join(base, "Programs")) ? readdirSync(join(base, "Programs")).filter((n) => n !== "BunnyA-DevCandidate") : []);
  return { base, root, links, install, uninstall, leftovers, close: () => rmSync(base, { recursive: true, force: true }) };
}

/** An unrelated folder with user data at the install path. */
function foreign(root) {
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(join(root, "thesis.docx"), "years of work");
  writeFileSync(join(root, "docs", "notes.md"), "keep");
}

function refusedUnchanged(f, r, before, what) {
  assert.ok(!r.ok, `${what}: must be refused, got: ${r.out}`);
  assert.deepEqual(tree(f.root), before, `${what}: existing files must be unchanged`);
  assert.deepEqual(f.leftovers(), [], `${what}: no staging or previous folders left behind`);
}

test("S1R1 installer 1-2: new install into an empty authorized folder, then upgrade of that install", { skip: !windows }, () => {
  const f = fixture();
  try {
    const first = f.install(candidate(f.base, "v1"));
    assert.ok(first.ok, first.out);
    const marker = JSON.parse(readFileSync(join(f.root, "install.json"), "utf8").replace(/^\uFEFF/, ""));
    assert.equal(marker.product, "bunny-a-windows-dev-candidate");
    // The installer records the full path; a short 8.3 temp path (as on CI runners) is expanded, so compare resolved paths.
    assert.equal(realpathSync.native(marker.installRoot).toLowerCase(), realpathSync.native(f.root).toLowerCase());
    assert.deepEqual([...marker.files].sort(), ["BunnyA.dll", "BunnyA.exe", "candidate.json"]);
    const second = f.install(candidate(f.base, "v2", { version: "0.5.2", files: { "BunnyA.exe": "exe-v2", "BunnyA.dll": "dll-v2", "runtimes/win/native.dll": "n" } }));
    assert.ok(second.ok, second.out);
    assert.equal(JSON.parse(second.out).replacedPrevious, true);
    assert.equal(readFileSync(join(f.root, "BunnyA.exe"), "utf8"), "exe-v2");
    assert.deepEqual(f.leftovers(), []);
    // The upgraded install (with a sub-folder) is itself provably owned: a further upgrade and the uninstall succeed.
    { const r = f.install(candidate(f.base, "v3", { version: "0.5.3" })); assert.ok(r.ok, r.out); }
    const removed = f.uninstall();
    assert.ok(removed.ok, removed.out);
    assert.ok(!existsSync(f.root) && !existsSync(join(f.links, "Bunny A (Dev Candidate).lnk")));
  } finally { f.close(); }
});

test("S1R1 installer 3-6: an existing folder without a valid marker for this exact install is never replaced", { skip: !windows }, () => {
  const f = fixture();
  try {
    const pkg = candidate(f.base, "v1");
    const cases = [
      ["unrelated folder", () => foreign(f.root)],
      ["install-looking folder, no marker", () => { mkdirSync(f.root, { recursive: true }); writeFileSync(join(f.root, "BunnyA.exe"), "someone else's"); }],
      ["corrupted marker", () => { foreign(f.root); writeFileSync(join(f.root, "install.json"), "{ not json"); }],
      ["wrong marker schema", () => { foreign(f.root); writeFileSync(join(f.root, "install.json"), JSON.stringify({ schema: "something-else.v9", product: "bunny-a-windows-dev-candidate", installRoot: f.root, packageSha256: "0".repeat(64), files: [] })); }],
      ["e094a26-style marker without identity", () => { foreign(f.root); writeFileSync(join(f.root, "install.json"), JSON.stringify({ schema: "bunny-windows-dev-install.v1", version: "0.5.1", packageSha256: "0".repeat(64), files: 2 })); }],
      ["marker naming another folder", () => { foreign(f.root); writeFileSync(join(f.root, "install.json"), JSON.stringify({ schema: "bunny-windows-dev-install.v1", product: "bunny-a-windows-dev-candidate", installRoot: join(f.base, "elsewhere"), packageSha256: "0".repeat(64), files: ["thesis.docx", "docs/notes.md"] })); }],
    ];
    for (const [what, make] of cases) {
      rmSync(f.root, { recursive: true, force: true });
      make();
      const before = tree(f.root);
      refusedUnchanged(f, f.install(pkg), before, `install over ${what}`);
      refusedUnchanged(f, f.uninstall(), before, `uninstall of ${what}`);
    }
    // A genuine install with a user file dropped into it is no longer provably ours either.
    rmSync(f.root, { recursive: true, force: true });
    { const r = f.install(pkg); assert.ok(r.ok, r.out); }
    writeFileSync(join(f.root, "my-notes.txt"), "user data");
    const before = tree(f.root);
    refusedUnchanged(f, f.install(candidate(f.base, "v2", { version: "0.5.2" })), before, "upgrade with an unlisted user file");
    refusedUnchanged(f, f.uninstall(), before, "uninstall with an unlisted user file");
  } finally { f.close(); }
});

test("S1R1 installer 7-8: manipulated candidates and path traversal are refused before anything changes", { skip: !windows }, () => {
  const f = fixture();
  try {
    { const r = f.install(candidate(f.base, "v1")); assert.ok(r.ok, r.out); }
    const before = tree(f.root);
    const good = candidate(f.base, "v2", { version: "0.5.2" });
    const tampered = candidate(f.base, "tampered", { manifest: { schema: "bunny-windows-dev-candidate.v1", version: "9", files: [{ path: "BunnyA.exe", sha256: sha(Buffer.from("something else")) }] }, files: { "BunnyA.exe": "evil" } });
    refusedUnchanged(f, f.install(tampered), before, "file hash differs from the manifest");
    refusedUnchanged(f, f.install(good, ["-ExpectedSha256", "0".repeat(64)]), before, "package hash differs from -ExpectedSha256");
    assert.ok(f.install(good, ["-ExpectedSha256", sha(readFileSync(good))]).ok, "the matching -ExpectedSha256 is accepted");
    const upgraded = tree(f.root);
    const escape = join(f.base, "Programs", "escaped.txt");
    for (const [what, opts] of [
      ["zip entry ../", { extra: [{ name: "../escaped.txt", content: "x" }] }],
      ["zip entry ../../ (backslash)", { extra: [{ name: "..\\..\\escaped.txt", content: "x" }] }],
      ["zip entry with drive", { extra: [{ name: "C:/escaped.txt", content: "x" }] }],
      ["manifest path ../", { manifest: { schema: "bunny-windows-dev-candidate.v1", version: "9", files: [{ path: "../escaped.txt", sha256: sha(Buffer.from("x")) }] } }],
      ["file not in the manifest", { extra: [{ name: "unlisted.dll", content: "x" }] }],
    ]) {
      refusedUnchanged(f, f.install(candidate(f.base, `bad-${what.replace(/\W+/g, "-")}`, opts)), upgraded, what);
      assert.ok(!existsSync(escape) && !existsSync(join(f.base, "escaped.txt")), `${what}: nothing written outside staging`);
    }
  } finally { f.close(); }
});

test("S1R1 installer 9: junctions and links are refused, never followed", { skip: !windows }, () => {
  const f = fixture();
  try {
    const victim = join(f.base, "victim");
    mkdirSync(victim);
    writeFileSync(join(victim, "precious.txt"), "do not delete");
    const victimBefore = tree(victim);
    const pkg = candidate(f.base, "v1");
    // The install path itself is a junction to someone else's folder.
    mkdirSync(join(f.base, "Programs"), { recursive: true });
    execFileSync("cmd.exe", ["/c", "mklink", "/J", f.root, victim], { stdio: "pipe" });
    assert.ok(!f.install(pkg).ok, "install through a junction is refused");
    assert.ok(!f.uninstall().ok, "uninstall through a junction is refused");
    assert.deepEqual(tree(victim), victimBefore);
    execFileSync("cmd.exe", ["/c", "rmdir", f.root], { stdio: "pipe" });
    // A genuine install that later gained a junction inside it.
    { const r = f.install(pkg); assert.ok(r.ok, r.out); }
    execFileSync("cmd.exe", ["/c", "mklink", "/J", join(f.root, "runtimes"), victim], { stdio: "pipe" });
    assert.ok(!f.install(candidate(f.base, "v2", { version: "0.5.2" })).ok, "upgrade of an install containing a junction is refused");
    assert.ok(!f.uninstall().ok, "uninstall of an install containing a junction is refused");
    assert.deepEqual(tree(victim), victimBefore, "the junction target is untouched");
    assert.ok(existsSync(join(f.root, "BunnyA.exe")));
    execFileSync("cmd.exe", ["/c", "rmdir", join(f.root, "runtimes")], { stdio: "pipe" });
  } finally { f.close(); }
});

test("S1R1 installer 10-11: a failed replacement restores the previous install exactly", { skip: !windows }, () => {
  const f = fixture();
  try {
    { const r = f.install(candidate(f.base, "v1")); assert.ok(r.ok, r.out); }
    const before = tree(f.root);
    const v2 = candidate(f.base, "v2", { version: "0.5.2", files: { "BunnyA.exe": "exe-v2", "BunnyA.dll": "dll-v2" } });
    for (const point of ["after-backup", "after-swap"]) {
      const r = f.install(v2, [], { BUNNY_DEV_INSTALL_FAULT: point });
      assert.match(r.out, /Injected fault/, `${point}: the fault fired`);
      refusedUnchanged(f, r, before, `fault ${point}`);
      assert.ok(existsSync(join(f.links, "Bunny A (Dev Candidate).lnk")), `${point}: the shortcut still opens the restored install`);
    }
    assert.ok(f.install(v2).ok, "without the fault the same upgrade succeeds");
  } finally { f.close(); }
});

test("S1R1 installer 12-13: uninstall refuses unowned folders and protected Bunny A folders are never touched", { skip: !windows }, () => {
  const f = fixture();
  try {
    // Protected locations, redirected into the fixture so the owner's real ones are never involved.
    const local = join(f.base, "LocalAppData");
    const roaming = join(f.base, "AppData");
    const owner = [join(local, "Bunny-A"), join(local, "BunnyA"), join(roaming, "bunny-a")];
    for (const d of owner) { mkdirSync(d, { recursive: true }); writeFileSync(join(d, "host-credentials.json"), `{"token":"${d.length}"}`); }
    const env = { LOCALAPPDATA: local, APPDATA: roaming };
    const before = owner.map(tree);
    const pkg = candidate(f.base, "v1");
    for (const target of [owner[0], join(owner[1], "Programs"), owner[2], local]) {
      const r = run(["-Package", pkg, "-InstallRoot", target, "-ShortcutDirectory", f.links], env);
      assert.ok(!r.ok && /overlaps/.test(r.out), `install at ${target} refused: ${r.out}`);
      assert.ok(!run(["-Uninstall", "-InstallRoot", target, "-ShortcutDirectory", f.links], env).ok, `uninstall at ${target} refused`);
    }
    assert.deepEqual(owner.map(tree), before, "protected folders unchanged");
    foreign(f.root);
    const unrelated = tree(f.root);
    refusedUnchanged(f, f.uninstall(), unrelated, "uninstall of an unrelated folder");
  } finally { f.close(); }
});
