// M-A-3 T12: a DISPOSABLE Host for the Island UI-automation check (uia-handsfree.ps1). Prints one JSON line with the Island
// credential path, then polls voice.state every 250 ms into <out>.jsonl until the stop file appears. Production is never touched.
// Usage: node --experimental-strip-types uia-host.mjs <out.jsonl> <stopFile>
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { startHost } from "./lib.mjs";

const [out, stopFile] = process.argv.slice(2);
const host = await startHost({ label: "t12-uia" });
writeFileSync(out, "");
console.log(JSON.stringify({ credentials: host.credentials, port: host.port, pid: host.pid }));
let last = "";
while (!existsSync(stopFile)) {
  const v = await host.voice().catch(() => null);
  const row = v && { open: v.open, mode: v.mode, state: v.state, capturing: v.capturing, duplex: v.duplex && { active: v.duplex.active, starting: v.duplex.starting, available: v.duplex.available, aec: v.duplex.aec, grant: v.duplex.grantExpiresAt !== null }, error: v.error?.code ?? null, lastClose: v.lastClose?.source ?? null };
  const key = JSON.stringify(row);
  if (key !== last) { last = key; appendFileSync(out, JSON.stringify({ at: Date.now(), ...row }) + "\n"); }
  await sleep(250);
}
await host.stop();
console.log("stopped");
process.exit(0);
