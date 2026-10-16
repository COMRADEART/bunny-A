// Widget Studio harness (copied unchanged from VE2) Host: the real Host (src/lib/bunny-host/http.server.ts) on disposable state, plus ONE
// labelled FIXTURE provider ("claude" id, never a real CLI) whose launches end like a dropped connection mid-run. The Host's
// own N-C policy then decides what happens: unscoped work is paused as "Outcome uncertain — reconciliation required".
// No real provider, account or network is used. Usage: node --experimental-strip-types host-worker.mjs <data> <workspace> <port>
import { startHost } from "../../../src/lib/bunny-host/http.server.ts";
import { providerBase } from "../../../src/lib/bunny-host/adapters.server.ts";
import { FilesystemCapability, GitCapability, TerminalCapability } from "../../../src/lib/bunny-missions/capabilities/local.server.ts";

const [dataDirectory, workspaceRoot, port] = process.argv.slice(2);
if (!dataDirectory || !workspaceRoot || !/^4389\d$/.test(port ?? "")) throw new Error("Disposable paths and a 4389x port required.");
delete process.env.BUNNY_STATE_LAYOUT;
delete process.env.BUNNY_RELEASE_ROOT;
delete process.env.BUNNY_HOST_WORKSPACE;

const fixtureProvider = {
  id: "claude",
  detect: async () => ({ ...providerBase("claude"), installed: true, authenticated: true, availability: "ready", capabilities: ["text"], current_model: "fixture-model", detail: "VE2 harness fixture provider (not a real CLI)" }),
  health: async (previous) => previous,
  usage: async () => null,
  launch: (_task, hooks) => {
    let finish;
    const done = new Promise((resolve) => { finish = resolve; });
    // The fixture "starts", reports one event, then its connection drops before any result is known.
    setTimeout(() => {
      try { hooks.event?.({ type: "activity", detail: "Fixture provider started editing the project", at: Date.now() }); } catch { /* optional hook */ }
    }, 200);
    setTimeout(() => finish({ ok: false, output: "", error: "stream reset: socket hang up", exitCode: 1 }), 900);
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
  sample: async () => ({ at: Date.now(), cpu: { utilization: null, clockMhz: null, temperatureC: null }, memory: { usedBytes: 0, availableBytes: 1, totalBytes: 1 }, gpus: [], notes: ["Disposable VE2 telemetry"] }),
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
