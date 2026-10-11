// M-A-3 T11 disposable live Host: the real Host with its default provider adapters (real local Ollama), real
// filesystem/Git/terminal capabilities and the TEST-ONLY team fault hooks below. Never the installed Host, never port
// 8084 or 43119. Fault inputs come from a fixture file and IPC only; nothing here is reachable over HTTP.
import { readFileSync, existsSync } from "node:fs";
import { startHost } from "../../src/lib/bunny-host/http.server.ts";
import { FilesystemCapability, GitCapability, TerminalCapability } from "../../src/lib/bunny-missions/capabilities/local.server.ts";
import { interruptTask } from "../../src/lib/orch/exec.server.ts";

const [dataDirectory, workspaceRoot, port, faultsPath] = process.argv.slice(2);
if (!dataDirectory || !workspaceRoot || !/^438\d\d$/.test(port ?? "")) throw new Error("Disposable paths and a 438xx port are required.");
for (const key of ["BUNNY_STATE_LAYOUT", "BUNNY_RELEASE_ROOT", "BUNNY_HOST_WORKSPACE", "BUNNY_HOST_PORT", "BUNNY_HOST_DATA_DIRECTORY"]) delete process.env[key];

/** Seeded defects: [{ missionId, kind, round, remove }] — the exact text removed from the model's real output. */
const seeds = () => { try { return existsSync(faultsPath ?? "") ? JSON.parse(readFileSync(faultsPath, "utf8")).seed ?? [] : []; } catch { return []; } };
const teamFaults = {
  seedOutput: ({ missionId, kind, round, text }) => {
    const seed = seeds().find((item) => item.missionId === missionId && item.kind === kind && item.round === round);
    const remove = [].concat(seed?.remove ?? []).find((value) => text.includes(value));
    if (!seed || !remove) return null;
    return text.split(remove).join(seed.replace ?? "");
  },
};

const host = await startHost({
  dataDirectory,
  root: workspaceRoot,
  workspaceRoot,
  port: Number(port),
  missions: { adapters: [new FilesystemCapability(), new GitCapability(dataDirectory), new TerminalCapability()], teamFaults },
});
await host.missions.bus.refreshHealth();
let closing = false;
process.on("message", (message) => {
  if (message === "close" && !closing) {
    closing = true;
    void host.close().then(() => process.exit(0));
    return;
  }
  if (message && typeof message === "object" && message.fault === "interrupt") {
    const result = interruptTask(String(message.taskId));
    process.send?.({ fault: "interrupt", taskId: message.taskId, ...result, at: Date.now() });
  }
});
process.send?.({ token: host.token, pid: process.pid, generation: host.manager.instanceId });
