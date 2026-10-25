import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const creds = JSON.parse(readFileSync("C:/Users/allam/AppData/Local/Bunny-S3T0R1-Install/state/credentials/credentials.json", "utf8"));
const base = `http://127.0.0.1:${creds.port}`;
const headers = { authorization: `Bearer ${creds.token}` };
const out = "C:/Users/allam/Documents/new/bun-router-s3t0/docs/ma4-s3-t0r1/evidence/shutdown-on-running.json";

function identity(pid) {
  const script = `$p = Get-CimInstance Win32_Process -Filter 'ProcessId=${Number(pid)}'; if (-not $p) { 'MISSING' } else { ($p.CommandLine -replace '\\s+',' ') }`;
  return execFileSync("powershell", ["-NoProfile", "-Command", script], { encoding: "utf8" }).trim();
}

const started = Date.now();
let noted = null;
for (let i = 0; i < 200; i++) {
  let body;
  try {
    const res = await fetch(`${base}/state`, { headers });
    body = await res.json();
  } catch {
    await new Promise((r) => setTimeout(r, 250));
    continue;
  }
  const live = (body.tasks ?? []).find((t) => ["launching", "running", "verifying"].includes(t.state) && /Hold the local model/.test(t.title ?? ""));
  if (live) {
    const health = await fetch(`${base}/health`).then((r) => r.json());
    const line = identity(health.pid);
    const owned = line.includes("Bunny-S3T0R1-Install") && line.includes("Bunny-Host.mjs");
    noted = {
      at: new Date().toISOString(),
      waitedMs: Date.now() - started,
      taskId: live.id,
      state: live.state,
      model: live.model,
      stopReason: live.stopReason ?? null,
      hostPid: health.pid,
      owned,
      commandHasInstall: line.includes("Bunny-S3T0R1-Install"),
    };
    if (!owned) break;
    process.kill(health.pid, "SIGTERM");
    noted.signal = "SIGTERM";
    break;
  }
  await new Promise((r) => setTimeout(r, 200));
}
writeFileSync(out, JSON.stringify(noted ?? { timedOut: true, waitedMs: Date.now() - started }, null, 2));
console.log(noted ? `SIGNALLED ${noted.taskId} ${noted.state} owned=${noted.owned}` : "TIMEOUT");
