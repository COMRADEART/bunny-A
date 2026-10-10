/**
 * T9R-F04 disposable Host process (child of live-containment-acceptance.mjs).
 * Real startHost (loopback HTTP, real SQLite in a disposable directory, real Missions/Agents) with ONE fixture
 * provider: a Claude-shaped adapter whose launch is the production contained spawnSession, running the disposable
 * Node provider stand-in. Prints one READY line with the port and the disposable owner token. No network beyond
 * loopback; never uses production state or ports.
 * argv: <dataDirectory> <projectRoot> <workspaceRoot> <port> <providerScript>
 */
const [dataDirectory, root, workspaceRoot, port, providerScript] = process.argv.slice(2);
const repo = new URL("../../../../", import.meta.url);
const { startHost } = await import(new URL("src/lib/bunny-host/http.server.ts", repo));
const { spawnSession, providerBase } = await import(new URL("src/lib/bunny-host/adapters.server.ts", repo));
const launch = { command: process.execPath, args: [providerScript], path: providerScript, kind: "node-script", source: "F04 disposable provider" };
const adapter = {
  id: "claude",
  detect: async () => ({ ...providerBase("claude"), installed: true, authenticated: true, authenticatedState: "authenticated", availability: "ready", capabilities: ["text", "filesystem", "terminal"], current_model: "fixture-claude", models: ["fixture-claude"], probedAt: Date.now() }),
  health: async (previous) => previous,
  usage: async () => null,
  launch: (task, hooks) => spawnSession("claude", launch, [], task, hooks, task.sessionId ?? task.id),
};
const host = await startHost({ dataDirectory, root, workspaceRoot, port: Number(port), adapters: [adapter],
  sample: async () => ({ at: Date.now(), cpu: { utilization: null, clockMhz: null, temperatureC: null }, memory: { usedBytes: 0, availableBytes: 1, totalBytes: 1 }, gpus: [], notes: ["F04 disposable"] }) });
await host.missions.bus.refreshHealth();
console.log("READY " + JSON.stringify({ port: Number(port), token: host.token, pid: process.pid, instanceId: host.manager.instanceId }));
// Graceful shutdown on request: the production Host close() path (stopOwnedChildren, manager.stop, settleStops).
process.on("message", (message) => { if (message === "close") void host.close().then(() => { console.log("CLOSED"); process.exit(0); }); });
