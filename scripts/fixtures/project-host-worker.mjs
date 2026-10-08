import { startHost } from "../../src/lib/bunny-host/http.server.ts";
import {
  FilesystemCapability,
  GitCapability,
  TerminalCapability,
} from "../../src/lib/bunny-missions/capabilities/local.server.ts";
const [dataDirectory, workspaceRoot, port] = process.argv.slice(2);
if (!dataDirectory || !workspaceRoot || !/^\d+$/.test(port ?? ""))
  throw new Error("Disposable paths and port required.");
delete process.env.BUNNY_STATE_LAYOUT;
delete process.env.BUNNY_RELEASE_ROOT;
delete process.env.BUNNY_HOST_WORKSPACE;
const host = await startHost({
  dataDirectory,
  root: workspaceRoot,
  workspaceRoot,
  port: Number(port),
  adapters: [],
  missions: {
    adapters: [
      new FilesystemCapability(),
      new GitCapability(dataDirectory),
      new TerminalCapability(),
    ],
  },
  sample: async () => ({
    at: Date.now(),
    cpu: { utilization: null, clockMhz: null, temperatureC: null },
    memory: { usedBytes: 0, availableBytes: 1, totalBytes: 1 },
    gpus: [],
    notes: ["Disposable T7 telemetry"],
  }),
});
await host.missions.bus.refreshHealth();
let closing = false;
process.on("message", (message) => {
  if (message === "close" && !closing) {
    closing = true;
    void host.close().then(() => process.exit(0));
  }
});
process.send?.({ token: host.token, pid: process.pid, generation: host.manager.instanceId });
