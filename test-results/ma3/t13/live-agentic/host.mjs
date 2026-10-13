// T13 live-agentic lane: a DISPOSABLE real Host (scripts/fixtures/project-host-worker.mjs = real Host code with the real
// filesystem/git/terminal capabilities) on a 4386x port with temp state. Production (43119, 8084, %LOCALAPPDATA%\Bunny-A)
// is never addressed. Authority/credential values stay in memory and in the disposable credentials file only.
import { fork } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

export const repo = resolve(import.meta.dirname, "../../../..");
export const evidence = resolve(import.meta.dirname);

export async function startHost(port, label) {
  if (!/^4386\d$/.test(String(port))) throw new Error("T13 live-agentic Hosts only on 43860-43869.");
  const parent = mkdtempSync(join(tmpdir(), `bunny-t13-${label}-`));
  const data = join(parent, "state"), workspace = join(parent, "workspace");
  mkdirSync(data, { recursive: true }); mkdirSync(workspace, { recursive: true });
  const log = [];
  const child = fork(join(repo, "scripts/fixtures/project-host-worker.mjs"), [data, workspace, String(port)], { cwd: repo, execArgv: ["--experimental-strip-types"], stdio: ["ignore", "pipe", "pipe", "ipc"], windowsHide: true });
  child.stdout.on("data", (d) => log.push(`[out] ${d}`));
  child.stderr.on("data", (d) => log.push(`[err] ${String(d).slice(0, 2000)}`));
  const ready = await new Promise((done, reject) => {
    child.once("message", done);
    child.once("exit", (code) => reject(new Error(`Host exited ${code}: ${log.join("").slice(-1500)}`)));
  });
  const credentials = join(parent, "credentials.json");
  writeFileSync(credentials, JSON.stringify({ token: ready.token, port }));
  const base = `http://127.0.0.1:${port}`;
  const api = async (action, data = {}) => {
    const response = await fetch(`${base}/command`, { method: "POST", headers: { authorization: `Bearer ${ready.token}`, "content-type": "application/json" }, body: JSON.stringify({ action, data }) });
    const body = await response.json().catch(() => ({}));
    return { status: response.status, body };
  };
  const state = async () => (await fetch(`${base}/state`, { headers: { authorization: `Bearer ${ready.token}` } })).json();
  const stop = async () => {
    if (child.exitCode === null) {
      child.send("close");
      for (let i = 0; i < 100 && child.exitCode === null; i++) await sleep(100);
      if (child.exitCode === null) child.kill();
    }
  };
  return { child, pid: ready.pid, generation: ready.generation ?? ready.instance, token: ready.token, port, parent, data, workspace, credentials, api, state, stop, log: () => log.join("") };
}
export const now = () => new Date().toISOString();
