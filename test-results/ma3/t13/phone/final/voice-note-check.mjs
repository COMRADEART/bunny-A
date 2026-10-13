// Pure-model check (SIMULATED at the model level, not a rendered UI): the device-vs-workstation voice caption.
// Calls the same voiceEntry/phoneCapabilities functions the Phone renders. A real device principal needs the HTTPS
// remote gateway (not reachable from this machine), so the device rows are model-level only.
import { voiceEntry, phoneCapabilities } from "../../../../../src/components/island/phone-model.ts";
const viewers = {
  workstation: { kind: "workstation", name: "This workstation", role: "owner", rights: [] },
  device_full: { kind: "device", deviceId: "dev-sim", name: "Phone companion (simulated)", role: "paired-device", rights: ["agent.get", "agent.list", "agent.pause", "agent.resume", "agent.stop", "mission.respond", "mission.approve", "submit", "device.revoke"] },
  device_readonly: { kind: "device", deviceId: "dev-sim", name: "Phone companion (simulated)", role: "paired-device", rights: ["agent.get", "agent.list", "mission.get", "project.list"] },
  none: null,
};
const out = {};
for (const [k, v] of Object.entries(viewers)) out[k] = { voice: voiceEntry(v), capabilities: phoneCapabilities(v) };
console.log(JSON.stringify(out, null, 2));
