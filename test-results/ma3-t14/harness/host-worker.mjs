// M-A-3 T14 harness Host (adapted from the Widget Studio harness): the real Host (src/lib/bunny-host/http.server.ts) on
// disposable state plus ONE labelled FIXTURE provider ("claude" id, never a real CLI). Its launches wait until the parent
// process answers them over IPC ({ release: "read" | "write" | "all", ok, error }), so live Mission phases can be held.
// No real provider, account or network is used. Usage: node --experimental-strip-types host-worker.mjs <data> <workspace> <port>
import { startHost } from "../../../src/lib/bunny-host/http.server.ts";
import { providerBase } from "../../../src/lib/bunny-host/adapters.server.ts";
import { FilesystemCapability, GitCapability, TerminalCapability } from "../../../src/lib/bunny-missions/capabilities/local.server.ts";

const [dataDirectory, workspaceRoot, port] = process.argv.slice(2);
if (!dataDirectory || !workspaceRoot || !/^4389[3-9]$/.test(port ?? "")) throw new Error("Disposable paths and a 43893-43899 port required.");
delete process.env.BUNNY_STATE_LAYOUT;
delete process.env.BUNNY_RELEASE_ROOT;
delete process.env.BUNNY_HOST_WORKSPACE;

const waiting = [];
const fixtureProvider = {
  id: "claude",
  detect: async () => ({ ...providerBase("claude"), installed: true, authenticated: true, availability: "ready", capabilities: ["text", "filesystem"], current_model: "fixture-model", detail: "T14 harness fixture provider (not a real CLI)" }),
  health: async (previous) => previous,
  usage: async () => null,
  launch: (task) => {
    let finish;
    const done = new Promise((resolve) => { finish = resolve; });
    waiting.push({ access: task.executionScope?.access ?? "read", finish });
    return { done, stop: async () => finish({ ok: false, output: "", stopped: true }), pid: () => null };
  },
};

const host = await startHost({
  dataDirectory,
  root: workspaceRoot,
  workspaceRoot,
  port: Number(port),
  adapters: [fixtureProvider],
  missions: { adapters: [new FilesystemCapability(), new GitCapability(dataDirectory), new TerminalCapability()] },
  sample: async () => ({ at: Date.now(), cpu: { utilization: null, clockMhz: null, temperatureC: null }, memory: { usedBytes: 0, availableBytes: 1, totalBytes: 1 }, gpus: [], notes: ["Disposable T14 telemetry"] }),
});
await host.missions.bus.refreshHealth();
let closing = false;
process.on("message", (message) => {
  if (message === "close" && !closing) {
    closing = true;
    void host.close().then(() => process.exit(0));
    return;
  }
  if (message && typeof message === "object" && message.release) {
    for (let i = waiting.length - 1; i >= 0; i--) {
      if (message.release !== "all" && waiting[i].access !== message.release) continue;
      waiting[i].finish(message.ok === false ? { ok: false, output: "", error: message.error ?? "fixture failure", exitCode: 1 } : { ok: true, output: "Fixture step done." });
      waiting.splice(i, 1);
    }
    process.send?.({ released: true, pending: waiting.length });
  }
});
process.send?.({ token: host.token, pid: process.pid, generation: host.manager.instanceId });
