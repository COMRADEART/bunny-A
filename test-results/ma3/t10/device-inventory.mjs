// M-A-3 T10 §46: read-only audio device inventory as the contained worker reports it (waveIn/waveOut enumeration, Core
// Audio default-endpoint name/mute/volume, microphone privacy). Opens no capture and plays nothing. No audio is retained.
// Usage: node test-results/ma3/t10/device-inventory.mjs
import { spawn, execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "../../..");
const w = spawn(resolve(root, "native/voice/bunny-voice-worker.exe"), [], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
let buf = "";
const events = [];
w.stdout.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (l) events.push(JSON.parse(l)); } });
const until = (p, ms) => new Promise((r) => { const t0 = Date.now(); const tick = () => { const e = events.find(p); if (e || Date.now() - t0 > ms) r(e ?? null); else setTimeout(tick, 50); }; tick(); });
const ready = await until((e) => e.ev === "ready", 15000);
w.stdin.write(JSON.stringify({ op: "devices" }) + "\n");
const devices = await until((e) => e.ev === "devices", 10000);
w.stdin.write(JSON.stringify({ op: "shutdown" }) + "\n");
await new Promise((r) => setTimeout(r, 800));
const pnp = execFileSync("powershell.exe", ["-NoProfile", "-Command", "Get-PnpDevice -Class AudioEndpoint | Sort-Object FriendlyName | ForEach-Object { $_.Status + ' | ' + $_.FriendlyName }"], { encoding: "utf8" }).trim().split(/\r?\n/);
const out = { classification: "LIVE read-only enumeration by the T10 voice worker (no capture opened, nothing played)", at: new Date().toISOString(), worker: { protocol: ready?.protocol ?? null, stt: ready?.stt ?? null, tts: ready?.tts ?? null }, devices: devices ? { inputs: devices.inputs, outputs: devices.outputs, defaultInput: devices.defaultInput, defaultOutput: devices.defaultOutput, micPrivacy: devices.micPrivacy } : null, pnpAudioEndpoints: pnp, notes: ["Default STT engine here is the worker's no-argument default (SAPI); the Host passes the verified whisper runtime arguments.", "Endpoint mute/volume are read through Core Audio; Bunny never changes them."] };
writeFileSync(resolve(root, "test-results/ma3/t10/audio-device-inventory.json"), JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify(out.devices).slice(0, 600));
