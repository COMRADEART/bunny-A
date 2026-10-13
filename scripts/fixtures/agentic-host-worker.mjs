// Disposable T5 Host only. Authority tokens travel over private IPC and never enter evidence.
import { startHost } from "../../src/lib/bunny-host/http.server.ts";
import { FilesystemCapability, GitCapability, TerminalCapability } from "../../src/lib/bunny-missions/capabilities/local.server.ts";
const [dataDirectory, root, portValue] = process.argv.slice(2);
if (!dataDirectory || !root || !/^\d+$/.test(portValue ?? "")) throw new Error("Disposable Host requires explicit state, project and port.");
delete process.env.BUNNY_STATE_LAYOUT;
delete process.env.BUNNY_RELEASE_ROOT;
const host = await startHost({ dataDirectory, root, port: Number(portValue), adapters: [],
  missions: { adapters: [new FilesystemCapability(), new TerminalCapability(), new GitCapability(dataDirectory)] },
  sample: async () => ({ at: Date.now(), cpu: { utilization: null, clockMhz: null, temperatureC: null }, memory: { usedBytes: 0, availableBytes: 1, totalBytes: 1 }, gpus: [], notes: ["Disposable test telemetry"] }) });
await host.missions.bus.refreshHealth();
process.send?.({ kind: "ready", token: host.token, generation: host.manager.instanceId, pid: process.pid });
process.on("message", async message => { if (message === "close") { await host.close(); process.exit(0); } });
