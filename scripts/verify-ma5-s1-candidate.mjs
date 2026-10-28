// MA5-S1: install lifecycle of the Windows development candidate, in disposable folders against an isolated Host.
// Install → launch → settings change → refused replacement while running → Quit → replacement → relaunch → uninstall.
import { spawn, execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { startHost } from "../src/lib/bunny-host/http.server.ts";
import { writeEvidence } from "./evidence-guard.mjs";

const execFileAsync = promisify(execFile);
const RUN_ID = `ma5s1-candidate-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const EVIDENCE_DIR = join(process.cwd(), "test-results", "ma5-s1-candidate", RUN_ID);
mkdirSync(EVIDENCE_DIR, { recursive: true });
const PORT = 43191;
const pkg = process.env.BUNNY_CANDIDATE ?? join(process.cwd(), "releases", "BunnyA-Windows-dev-0.5.1.zip");
const installer = join(process.cwd(), "native/windows/install-dev-candidate.ps1");
const helper = join(process.cwd(), "scripts/ui-automation-helper.ps1");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (b) => createHash("sha256").update(b).digest("hex");
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

assert.ok(!/BunnyA\.exe/i.test(spawnSync("tasklist", ["/FI", "IMAGENAME eq BunnyA.exe", "/FO", "CSV", "/NH"], { encoding: "utf8" }).stdout), "Close other BunnyA.exe first.");
const base = mkdtempSync(join(tmpdir(), "bunny-candidate-ma5s1-"));
const installRoot = join(base, "Programs", "BunnyA-DevCandidate");
const shortcutDir = join(base, "StartMenu", "Bunny A (Dev Candidate)");
const configDir = join(base, "config");
const projectDir = join(base, "UserProject");
mkdirSync(configDir, { recursive: true });
mkdirSync(projectDir, { recursive: true });
writeFileSync(join(configDir, "config.json"), JSON.stringify({ NotchEdge: "Top", NotchOffsetRatio: 0.5 }));
writeFileSync(join(projectDir, "notes.md"), "user-owned project file\n");
const projectHash = () => sha(readFileSync(join(projectDir, "notes.md")));
const projectBefore = projectHash();

const host = await startHost({ port: PORT, dataDirectory: join(base, "host") });
const credPath = join(base, "creds.json");
writeFileSync(credPath, JSON.stringify({ port: PORT, token: host.token }));
let stateRequests = 0;
host.server.prependListener("request", (req) => { if (req.url === "/state" && req.headers.authorization === `Bearer ${host.token}`) stateRequests++; });

async function ps(file, args) {
  try {
    const run = execFileAsync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", file, ...args], { encoding: "utf8", timeout: 120_000 });
    run.child.stdin.end();
    const { stdout } = await run;
    return { ok: true, out: stdout.trim() };
  } catch (e) { return { ok: false, out: `${e.stdout ?? ""} ${e.stderr ?? ""}`.trim().slice(0, 600) }; }
}
const install = (extra = []) => ps(installer, ["-Package", pkg, "-InstallRoot", installRoot, "-ShortcutDirectory", shortcutDir, ...extra]);
const ui = async (action, args = {}) => {
  const r = await ps(helper, ["-Action", action, ...Object.entries(args).flatMap(([k, v]) => [`-${k}`, String(v)])]);
  if (!r.ok) throw new Error(`UI ${action}: ${r.out}`);
  return JSON.parse(r.out);
};
function launch() {
  const child = spawn(join(installRoot, "BunnyA.exe"), [], { env: { ...process.env, BUNNY_HOST_CREDENTIALS_FILE: credPath, BUNNY_CONFIG_DIRECTORY: configDir }, stdio: "ignore" });
  return { child, exited: new Promise((resolve) => child.on("exit", (code) => resolve({ code }))) };
}
async function until(what, fn, ms = 20_000) { const s = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - s > ms) throw new Error(`Timed out: ${what}`); await sleep(250); } }
const edge = () => JSON.parse(readFileSync(join(configDir, "config.json"), "utf8").replace(/^﻿/, "")).NotchEdge;
const out = { runId: RUN_ID, package: { path: pkg, sha256: sha(readFileSync(pkg)) } };

let app;
try {
  const first = await install();
  assert.ok(first.ok, first.out);
  out.install = { result: JSON.parse(first.out), files: readdirSync(installRoot).sort(), shortcutExists: existsSync(join(shortcutDir, "Bunny A (Dev Candidate).lnk")) };
  log("installed", out.install.files.join(", "));

  app = launch();
  await until("installed client authenticated", () => stateRequests > 0);
  await sleep(2000);
  await ui("cycle_dock_edge", { ProcessId: app.child.pid, ExpectedEdge: "Right", ConfigPath: join(configDir, "config.json") });
  out.launch = { authenticatedStateRequests: stateRequests, edgeAfterChange: edge() };
  assert.equal(edge(), "Right");

  const whileRunning = await install();
  out.replaceWhileRunning = { refused: !whileRunning.ok, message: whileRunning.out.replace(/\s+/g, " ").slice(0, 300), installIntact: existsSync(join(installRoot, "BunnyA.exe")) };
  assert.ok(out.replaceWhileRunning.refused && out.replaceWhileRunning.installIntact);

  const tree = await ui("process_tree", { ProcessId: app.child.pid });
  await ui("invoke_and_dialog", { ProcessId: app.child.pid, TargetId: "QuitButton" });
  const exit = await Promise.race([app.exited, sleep(15000).then(() => null)]);
  out.quit = { exit, descendantsBefore: tree.descendants };
  assert.equal(exit?.code, 0);
  app = null;

  const replaced = await install();
  assert.ok(replaced.ok, replaced.out);
  out.replacement = { result: JSON.parse(replaced.out), settingsKept: edge() === "Right", leftoverStagingOrPrevious: readdirSync(join(base, "Programs")).filter((n) => n !== "BunnyA-DevCandidate") };
  assert.ok(out.replacement.result.replacedPrevious && out.replacement.settingsKept && out.replacement.leftoverStagingOrPrevious.length === 0);

  stateRequests = 0;
  app = launch();
  await until("relaunched after replacement", () => stateRequests > 0);
  await sleep(2000);
  const layout = await ui("notch_layout", { ProcessId: app.child.pid, ConfigPath: join(configDir, "config.json") });
  out.relaunchAfterReplacement = { persistedEdge: layout.persistedEdge, agentsRendered: layout.agents.map((a) => a.id) };
  await ui("invoke_and_dialog", { ProcessId: app.child.pid, TargetId: "QuitButton" });
  out.relaunchAfterReplacement.exit = await Promise.race([app.exited, sleep(15000).then(() => null)]);
  app = null;
  assert.equal(out.relaunchAfterReplacement.persistedEdge, "Right");

  const removed = await install(["-Uninstall"]);
  assert.ok(removed.ok, removed.out);
  const leftovers = spawnSync("powershell.exe", ["-NoProfile", "-Command", `@(Get-CimInstance Win32_Process -Filter "Name='BunnyA.exe'" | Where-Object { $_.ExecutablePath -like '${installRoot.replace(/'/g, "''")}*' }).Count`], { encoding: "utf8" }).stdout.trim();
  out.uninstall = {
    result: JSON.parse(removed.out), installRootRemoved: !existsSync(installRoot), shortcutRemoved: !existsSync(join(shortcutDir, "Bunny A (Dev Candidate).lnk")),
    settingsKept: existsSync(join(configDir, "config.json")), userProjectUnchanged: projectHash() === projectBefore, remainingProcessesFromInstallRoot: Number(leftovers),
  };
  assert.ok(out.uninstall.installRootRemoved && out.uninstall.shortcutRemoved && out.uninstall.settingsKept && out.uninstall.userProjectUnchanged && out.uninstall.remainingProcessesFromInstallRoot === 0);

  // An uninstall never deletes a folder it did not create.
  mkdirSync(installRoot, { recursive: true });
  writeFileSync(join(installRoot, "someone-elses.txt"), "keep");
  const foreign = await install(["-Uninstall"]);
  out.foreignFolderUninstall = { refused: !foreign.ok, fileKept: existsSync(join(installRoot, "someone-elses.txt")) };
  assert.ok(out.foreignFolderUninstall.refused && out.foreignFolderUninstall.fileKept);
  out.ok = true;
  log("candidate lifecycle passed");
} catch (e) {
  out.ok = false; out.error = String(e?.message ?? e).slice(0, 1500);
  process.exitCode = 1;
  log("FAILED", out.error);
} finally {
  if (app) try { app.child.kill(); } catch {}
  writeEvidence(join(EVIDENCE_DIR, "candidate-lifecycle.json"), out, [host.token]);
  await host.close();
  rmSync(base, { recursive: true, force: true });
}
