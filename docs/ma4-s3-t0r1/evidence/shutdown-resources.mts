import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostDatabase } from "../../../src/lib/bunny-host/persistence.server.ts";
import { TaskManager } from "../../../src/lib/bunny-host/manager.server.ts";
import { providerBase } from "../../../src/lib/bunny-host/adapters.server.ts";
import type { AdapterResult, ProviderAdapter } from "../../../src/lib/bunny-host/contracts.ts";
import { HostContainment } from "../../../src/lib/bunny-host/failure.server.ts";
import { MissionManager } from "../../../src/lib/bunny-missions/manager.server.ts";
import { FilesystemCapability, NotificationsCapability } from "../../../src/lib/bunny-missions/capabilities/local.server.ts";

const interesting = (row: { type: string }) => !["TTYWrap", "PipeWrap", "Stdio", "Immediate"].includes(row.type);
const sample = (label: string) => {
  const rows = process.getActiveResourcesInfo();
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row] = (counts[row] ?? 0) + 1;
  return { label, total: rows.length, counts, notable: rows.filter((row) => interesting({ type: row.split(" ")[0] ?? row })) };
};

const directory = mkdtempSync(join(tmpdir(), "bunny-t0r1-resources-"));
const root = join(directory, "workspace");
mkdirSync(root);
const db = new HostDatabase(":memory:");
let finish: (result: AdapterResult) => void = () => {};
const containment = new HostContainment({
  diagnosticDirectory: join(directory, "logs"),
  runtimeDirectory: join(directory, "runtime"),
  exit: () => { throw new Error("resource probe became fatal"); },
});
const adapter: ProviderAdapter = {
  id: "claude",
  detect: async () => ({ ...providerBase("claude"), installed: true, authenticated: true, availability: "ready", capabilities: ["text"], models: ["fixture"], current_model: "fixture" }),
  launch: () => ({
    done: new Promise<AdapterResult>((resolve) => { finish = resolve; }),
    stop: async () => finish({ ok: false, output: "", stopped: true }),
  }),
};
const tasks = new TaskManager(db, root, [adapter], { containment });
containment.options.persist = (type, detail, owner) => tasks.emit(db.event(type, owner.taskId ?? null, detail, owner.missionId ?? null));
const missions = new MissionManager(tasks, { dataDirectory: directory, adapters: [new FilesystemCapability(), new NotificationsCapability(() => {})] });
const report: Record<string, unknown> = {};
await tasks.discover();
const task = tasks.submit({ prompt: "Hold open", mode: "fast", constraints: { maxRuntimeMs: 20 * 60_000 } });
tasks.approve(task.id);
report.before = sample("live-deadline");
report.timersBefore = tasks.runtimeTimers.size;
await missions.close();
report.afterClose = sample("after-close");
report.timersAfter = tasks.runtimeTimers.size;
report.shutdownState = tasks.shutdownState;
report.sessions = tasks.sessions.size;
report.taskState = db.get(task.id).state;
report.stopReason = db.get(task.id).stopReason ?? null;
db.close();
rmSync(directory, { recursive: true, force: true });
await new Promise((resolve) => setTimeout(resolve, 50));
report.afterCleanup = sample("after-cleanup");
console.log(JSON.stringify(report, null, 2));
