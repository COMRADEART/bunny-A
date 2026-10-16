// M-A-3 T14 Gate G: performance measurements on this workstation, with scripted (SIMULATED) model I/O and the real
// Host, MissionManager, TaskManager, Capability Bus, SQLite and HTTP surface. One hardware configuration; not universal.
// Usage: node --experimental-strip-types test-results/ma3-t14/harness/perf.ts <out.json>
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { cpus, freemem, totalmem, tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { startHost } from "../../../src/lib/bunny-host/http.server.ts";
import { providerBase } from "../../../src/lib/bunny-host/adapters.server.ts";
import { HostDatabase } from "../../../src/lib/bunny-host/persistence.server.ts";
import { ModelCapabilityRegistry } from "../../../src/lib/bunny-host/model-capability.server.ts";
import { TaskManager } from "../../../src/lib/bunny-host/manager.server.ts";
import { MissionManager } from "../../../src/lib/bunny-missions/manager.server.ts";
import { FilesystemCapability, GitCapability, NotificationsCapability, TerminalCapability } from "../../../src/lib/bunny-missions/capabilities/local.server.ts";
import type { AdapterResult, ProviderAdapter } from "../../../src/lib/bunny-host/contracts.ts";
import type { OrchTask, ProviderId } from "../../../src/lib/orch/types.ts";
import { simulatedCodexProfile } from "../../../src/lib/bunny-host/testing/codex.test.ts";

const out = process.argv[2] ?? "perf.json";
const stats = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  return { n: values.length, min: +sorted[0].toFixed(2), median: +at(0.5).toFixed(2), p95: +at(0.95).toFixed(2), max: +sorted.at(-1)!.toFixed(2) };
};
const until = async (check: () => boolean | Promise<boolean>, label: string, timeout = 30_000) => {
  const start = Date.now();
  while (!(await check())) { if (Date.now() - start > timeout) throw new Error(`timeout: ${label}`); await new Promise((r) => setTimeout(r, 2)); }
};

type Launch = { task: OrchTask; at: number; finish: (r: AdapterResult) => void };
function fake(id: ProviderId, launched: Launch[]): ProviderAdapter {
  return {
    id,
    detect: async () => ({ ...providerBase(id), installed: true, authenticated: true, availability: "ready", capabilities: ["filesystem", "terminal", "text"], current_model: "fixture", ...(id === "codex" ? { securityCompatibility: simulatedCodexProfile() } : {}) }),
    launch: (task) => {
      let finish!: (r: AdapterResult) => void;
      const done = new Promise<AdapterResult>((resolve) => (finish = resolve));
      launched.push({ task, at: performance.now(), finish });
      return { done, stop: async () => finish({ ok: false, output: "", stopped: true }) };
    },
  };
}

const result: Record<string, unknown> = {
  label: "SIMULATED model I/O; real Host code; single workstation",
  machine: { cpus: cpus().length, cpuModel: cpus()[0]?.model, totalMemGiB: +(totalmem() / 2 ** 30).toFixed(1), freeMemGiB: +(freemem() / 2 ** 30).toFixed(1), node: process.version, platform: process.platform },
  at: new Date().toISOString(),
};

// ── Mission layer ──────────────────────────────────────────────────────────
{
  const dir = mkdtempSync(join(tmpdir(), "bunny-t14-perf-"));
  const root = join(dir, "project");
  mkdirSync(root, { recursive: true });
  const db = new HostDatabase(join(dir, "host.sqlite"));
  const launched: Launch[] = [];
  const tasks = new TaskManager(db, root, [fake("claude", launched), fake("codex", launched)], { modelRegistry: new ModelCapabilityRegistry(db, { availableProviders: () => [] }) });
  await tasks.discover();
  const missions = new MissionManager(tasks, { dataDirectory: dir, adapters: [new FilesystemCapability(), new TerminalCapability(), new NotificationsCapability(() => undefined)] });
  missions.configure({ enabled: true, limits: { maxActiveMissions: 10 } }, "perf");
  await missions.bus.refreshHealth();
  const plan: number[] = [], dispatch: number[] = [], complete: number[] = [], approve: number[] = [];
  const sizeBefore = statSync(join(dir, "host.sqlite")).size;
  for (let i = 0; i < 40; i++) {
    let t = performance.now();
    const view = missions.create({ objective: `Perf ${i}`, mode: "balanced", origin: "workstation", steps: [{ role: "Reader", objective: "Read", executor: { kind: "model" } }, { role: "Writer", objective: "Write", dependsOn: [0], access: "write", executor: { kind: "model" } }] });
    plan.push(performance.now() - t);
    t = performance.now();
    const n = launched.length;
    missions.approve(view.id, "workstation");
    approve.push(performance.now() - t);
    await until(() => launched.length === n + 1, "dispatch");
    dispatch.push(launched[n].at - t);
    const c = performance.now();
    launched[n].finish({ ok: true, output: "read" });
    await until(() => launched.length === n + 2, "second");
    launched[n + 1].finish({ ok: true, output: "written" });
    await until(() => missions.mission(view.id).state === "completed", "complete");
    complete.push(performance.now() - c);
  }
  const sizeAfter = statSync(join(dir, "host.sqlite")).size;
  // Fallback: a read step whose provider disconnects is rerouted.
  const reroute: number[] = [];
  for (let i = 0; i < 15; i++) {
    const view = missions.create({ objective: `Fallback ${i}`, mode: "balanced", origin: "workstation", steps: [{ role: "Reader", objective: "Read", executor: { kind: "model" }, maxRetries: 1 }] });
    const n = launched.length;
    missions.approve(view.id, "workstation");
    await until(() => launched.length === n + 1, "first");
    const t = performance.now();
    launched[n].finish({ ok: false, output: "", error: "provider unavailable: connection lost" });
    await until(() => launched.length === n + 2, "reroute");
    reroute.push(launched[n + 1].at - t);
    launched[n + 1].finish({ ok: true, output: "ok" });
    await until(() => missions.mission(view.id).state === "completed", "done");
  }
  result.missionLayer = {
    planningMs: stats(plan),
    approveCallMs: stats(approve),
    approveToProviderLaunchMs: stats(dispatch),
    twoStepRunMs: stats(complete),
    fallbackRerouteMs: stats(reroute),
    persistence: { missions: 55, sqliteBytesBefore: sizeBefore, sqliteBytesAfter: sizeAfter, bytesPerTwoStepMission: Math.round((sizeAfter - sizeBefore) / 40) },
  };
  await missions.close();
  db.close();
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}

// ── Host HTTP surface ──────────────────────────────────────────────────────
{
  const dir = mkdtempSync(join(tmpdir(), "bunny-t14-perf-host-"));
  const root = join(dir, "project");
  mkdirSync(root, { recursive: true });
  const launched: Launch[] = [];
  const port = 43979;
  const options = { dataDirectory: dir, root, port, adapters: [fake("claude", launched)], missions: { adapters: [new FilesystemCapability(), new TerminalCapability(), new GitCapability(dir)] } };
  const cpu0 = process.cpuUsage();
  let t = performance.now();
  let host = await startHost(options);
  const bootMs = performance.now() - t;
  const base = `http://127.0.0.1:${port}`;
  const command = async (action: string, data: unknown = {}) => (await (await fetch(`${base}/command`, { method: "POST", headers: { authorization: `Bearer ${host.token}`, "content-type": "application/json" }, body: JSON.stringify({ action, data }) })).json()) as Record<string, any>;
  const state = async () => (await (await fetch(`${base}/state`, { headers: { authorization: `Bearer ${host.token}` } })).json()) as Record<string, any>;
  // Four parents plus their workers exceed the default 4 active Missions; the owner raises it (configurable to 10).
  await command("mission.configure", { enabled: true, limits: { maxActiveMissions: 10 } });
  // Idle: 10 s with nothing running.
  const idleCpu = process.cpuUsage();
  const idleMem = process.memoryUsage().rss;
  await new Promise((r) => setTimeout(r, 10_000));
  const idle = process.cpuUsage(idleCpu);
  result.hostIdle = { seconds: 10, cpuUserMs: Math.round(idle.user / 1000), cpuSystemMs: Math.round(idle.system / 1000), cpuPercentOfOneCore: +(((idle.user + idle.system) / 1000 / 10_000) * 100).toFixed(2), rssMiB: +(idleMem / 2 ** 20).toFixed(1), bootMs: Math.round(bootMs) };

  const projects: string[] = [];
  for (let i = 0; i < 4; i++) {
    const path = join(dir, `p${i}`);
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, "package.json"), JSON.stringify({ name: "p", private: true, scripts: { test: 'node -e "setTimeout(()=>process.exit(0),300)"' } }));
    projects.push((await command("project.add", { name: `Perf ${i}`, path })).data.id);
  }
  const plan = [{ role: "Reader", objective: "Read", access: "read", executor: { kind: "model" }, verification: [{ kind: "command", command: "npm", args: ["test"], expectExit: 0 }] }];
  const stateMs: number[] = [];
  const agentIds: string[] = [];
  const missionIds: string[] = [];
  for (let slot = 1; slot <= 4; slot++) {
    const agentId = (await command("personal_agent.delegate", { slot, objective: "Perf", projectId: projects[slot - 1], steps: plan })).data.agentId;
    agentIds.push(agentId);
    const s = await state();
    const missionId = s.agents.agents.find((a: any) => a.id === agentId).missionId;
    missionIds.push(missionId);
    await until(async () => (await state()).missions.missions.find((m: any) => m.id === missionId)?.state === "waiting_for_approval", "plan");
    await command("agent.start", { id: agentId });
  }
  await until(() => launched.length === 4, "four dispatched");
  const busyCpu = process.cpuUsage();
  // Derived worker admission latency (propose -> child running), one per Agent.
  const admit: number[] = [];
  for (let slot = 1; slot <= 4; slot++) {
    t = performance.now();
    const worker = (await command("worker.propose", { slot, parentMissionId: missionIds[slot - 1], ability: "test", objective: "Run tests", projectId: projects[slot - 1] })).data.worker;
    await until(async () => ["running", "completed"].includes((await state()).missions.missions.find((m: any) => m.id === worker.childMissionId)?.state), "child running");
    admit.push(performance.now() - t);
  }
  for (let i = 0; i < 30; i++) { t = performance.now(); await state(); stateMs.push(performance.now() - t); }
  // Status update latency: a provider finishing until /state shows the step past running.
  const statusMs: number[] = [];
  for (const [index, launch] of launched.slice(0, 4).entries()) {
    t = performance.now();
    launch.finish({ ok: true, output: "done" });
    await until(async () => (await state()).missions.missions.find((m: any) => m.id === missionIds[index]).steps[0].state !== "running", "status");
    statusMs.push(performance.now() - t);
  }
  for (const id of missionIds) await until(async () => (await state()).missions.missions.find((m: any) => m.id === id).state === "completed", "complete", 60_000);
  const busy = process.cpuUsage(busyCpu);
  // Lotus recall latency with 200 memories.
  for (let i = 0; i < 200; i++) await command("lotus.remember", { scope: i % 2 ? "agent:1" : `project:${projects[0]}`, key: `Fact ${i}`, value: `Value number ${i} about the build` });
  const recall: number[] = [];
  for (let i = 0; i < 30; i++) { t = performance.now(); await command("lotus.recall", { slot: 1, query: "build value", limit: 12 }); recall.push(performance.now() - t); }
  // Restart recovery: close and reopen the same data directory.
  t = performance.now();
  await host.close();
  host = await startHost(options);
  const restartMs = performance.now() - t;
  result.hostSurface = {
    stateRequestMs: stats(stateMs),
    derivedWorkerProposeToRunningMs: stats(admit),
    providerFinishToStatusVisibleMs: stats(statusMs),
    lotusRecallMs200Memories: stats(recall),
    restartToServingMs: Math.round(restartMs),
    fourAgentRun: { cpuUserMs: Math.round(busy.user / 1000), cpuSystemMs: Math.round(busy.system / 1000), rssMiB: +(process.memoryUsage().rss / 2 ** 20).toFixed(1) },
    duplicateDispatches: launched.length - 4,
  };
  const total = process.cpuUsage(cpu0);
  result.processTotals = { cpuUserMs: Math.round(total.user / 1000), cpuSystemMs: Math.round(total.system / 1000), peakRssMiB: +(process.resourceUsage().maxRSS / 1024).toFixed(1) };
  await host.close();
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}

writeFileSync(out, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));
process.exit(0);
