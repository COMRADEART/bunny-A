// M-A-3 T12: relaunches the test Island against the running DISPOSABLE endurance Host, with stdout/stderr captured to a
// log so an unexpected Island exit can be diagnosed. Production's installed Island is never touched.
import { spawn } from "node:child_process";
import { mkdtempSync, openSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
const repo = resolve(import.meta.dirname, "../../../..");
const dir = readdirSync(tmpdir()).filter((n) => n.startsWith("bunny-t12-endurance-")).map((n) => join(tmpdir(), n)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
const work = mkdtempSync(join(tmpdir(), "bunny-t12-island-"));
const pref = join(work, "pref.json");
writeFileSync(pref, JSON.stringify({ edge: process.argv[3] ?? "left", position: "center", size: "compact", motion: "full", theme: "dark" }));
const log = openSync(resolve(import.meta.dirname, process.argv[2] ?? "island-relaunch.log"), "a");
const island = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(repo, "install/Bunny-Island.ps1"), "-CredentialPath", join(dir, "island-credentials.json"), "-DeploymentPath", join(work, "no-deploy"), "-PreferencePath", pref], { stdio: ["ignore", log, log], detached: true, windowsHide: false });
island.unref();
console.log(JSON.stringify({ pid: island.pid, host: dir }));
