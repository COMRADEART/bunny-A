// MA4-S2-T3R soak Host: the production entry (runHostEntry: real process policy and containment) on an isolated data
// directory and port, with provider adapters off (no CLI or network probes). Real clock, real proactive engine, real
// task runtime and broker. No model is called by the soak workload.
//   node --experimental-strip-types scripts/ma4-s2t3r/soak-host.mjs <dataDirectory> <workspace> <port>
import { runHostEntry } from '../../src/lib/bunny-host/entry.server.ts';

const [dataDirectory, root, port] = process.argv.slice(2);
if (!dataDirectory || !root || !port) { console.error('usage: soak-host.mjs <dataDirectory> <workspace> <port>'); process.exit(2); }
const host = await runHostEntry({ dataDirectory, root, port: Number(port), adapters: [] });
if (!host) process.exit(1);
console.log(`soak host ready pid=${process.pid} port=${port}`);
const stop = () => { void host.close().finally(() => process.exit(0)); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
// The driver asks for a graceful stop by writing this file (Windows has no portable SIGTERM for a detached child).
const { existsSync, rmSync } = await import('node:fs');
const marker = `${dataDirectory}/stop-requested`;
setInterval(() => { if (existsSync(marker)) { rmSync(marker, { force: true }); stop(); } }, 1_000);
