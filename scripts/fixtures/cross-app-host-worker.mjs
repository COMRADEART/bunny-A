// Disposable T6 Host; uses real capability adapters. Tokens are private IPC only.
import { startHost } from "../../src/lib/bunny-host/http.server.ts";
import { FilesystemCapability, GitCapability, TerminalCapability } from "../../src/lib/bunny-missions/capabilities/local.server.ts";
import { BrowserCapability } from "../../src/lib/bunny-missions/capabilities/browser.server.ts";
import { ComputerCapability } from "../../src/lib/bunny-missions/capabilities/computer.server.ts";
const [dataDirectory, root, portValue] = process.argv.slice(2);
if (!dataDirectory || !root || !/^\d+$/.test(portValue ?? "")) throw new Error("Explicit disposable Host paths and port required.");
delete process.env.BUNNY_STATE_LAYOUT; delete process.env.BUNNY_RELEASE_ROOT;
const computer = new ComputerCapability(dataDirectory);
const browser = new BrowserCapability(dataDirectory, { headless: true, allowLoopback: true });
const host = await startHost({ dataDirectory, root, port: Number(portValue), adapters: [],
  missions: { adapters: [new FilesystemCapability(), new GitCapability(dataDirectory), new TerminalCapability(), browser, computer] },
  sample: async () => ({ at: Date.now(), cpu: { utilization: null, clockMhz: null, temperatureC: null }, memory: { usedBytes: 0, availableBytes: 1, totalBytes: 1 }, gpus: [], notes: ["Disposable telemetry"] }) });
computer.targets.storage = { load: owner => host.missions.store.calculatorTarget(owner), save: (owner, target) => host.missions.store.saveCalculatorTarget(owner, target) };
await host.missions.bus.refreshHealth();
let stopRole = null;
let closing = false;
async function close() { if (closing) return; closing = true; await host.close(); process.exit(0); }
host.manager.bus.on("event", event => {
  if (!stopRole || event.type !== "mission.step.completed" || !event.missionId) return;
  const step = host.missions.store.steps(event.missionId).find(step => step.role === stopRole && step.state === "completed");
  if (!step) return;
  // Stop only this disposable Host at a real persisted boundary, before the next handoff.
  host.missions.closed = true;
  process.send?.({ kind: "boundary", missionId: step.missionId, stepId: step.id });
  void close();
});
process.on("message", message => {
  if (message === "close") void close();
  else if (message && typeof message === "object" && message.stopAfterRole) { stopRole = String(message.stopAfterRole); process.send?.({ kind: "armed" }); }
});
process.send?.({ kind: "ready", token: host.token, generation: host.manager.instanceId, pid: process.pid });
