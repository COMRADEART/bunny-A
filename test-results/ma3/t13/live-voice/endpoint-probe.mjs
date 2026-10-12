// Read-only endpoint observation: a short-lived voice worker `devices` report. Never changes mute/volume/privacy.
import { writeFileSync } from "node:fs";
import { endpointState } from "../../t12/live/lib.mjs";
const out = process.argv[2];
const devices = await endpointState();
writeFileSync(out, JSON.stringify({ classification: "LIVE (real worker, read-only devices report)", at: new Date().toISOString(), devices }, null, 2));
console.log(JSON.stringify(devices, null, 2).slice(0, 3000));
process.exit(0);
