// T13 final smoke driver: disposable Host 43867 + isolated dev 8096, then the repo's browser-smoke against it.
// The dev smoke lands test-results/ma3/t13/a11y/smoke-dev-final.png (desktop+mobile) + verdict JSON.
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const dir = import.meta.dirname;
const repo = join(dir, "../../..");
const DEV_PORT = 8096;
let host, dev;
try {
  host = await spawnHost();
  dev = spawn(process.execPath, [join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"), "run", "dev", "--", "--host", "127.0.0.1", "--port", String(DEV_PORT)], { cwd: repo, env: { ...process.env, BUNNY_HOST_DATA_DIRECTORY: host.data, BUNNY_HOST_CREDENTIALS_FILE: host.credentials, FORCE_COLOR: "0", NO_COLOR: "1" }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let ready = false;
  for (let i = 0; i < 240; i++) {
    try { const r = await fetch(`http://127.0.0.1:${DEV_PORT}/`); if (r.ok) { ready = true; break; } } catch {}
    await sleep(500);
  }
  if (!ready) throw new Error("dev never answered");
  await sleep(5000);
  const outPng = join(dir, "../a11y/smoke-dev-final.png").replace(/\//g, "\\");
  const r = spawnSync(process.execPath, [join(repo, "scripts/browser-smoke.mjs"), `http://127.0.0.1:${DEV_PORT}/`, outPng], { cwd: repo, encoding: "utf8", windowsHide: true, timeout: 240_000, maxBuffer: 16 * 1024 * 1024 });
  writeFileSync(join(dir, "smoke-dev-final.console.log"), (r.stdout ?? "") + (r.stderr ?? ""));
  console.log("SMOKE exit", r.status);
  process.exitCode = r.status === 0 ? 0 : 1;
} catch (e) {
  console.error("FATAL", String(e?.stack ?? e));
  process.exitCode = 1;
} finally {
  try { if (dev && dev.exitCode === null) execFileSync("taskkill.exe", ["/PID", String(dev.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }); } catch {}
  try { if (host) await stopHost(); } catch {}
}

async function spawnHost() {
  // Reuses the live-agentic startHost contract (4386x ports, scratch outside the repo).
  const { startHost } = await import("../live-agentic/host.mjs");
  return startHost(43867, "smoke-driver");
}
async function stopHost() { await host.stop(); }