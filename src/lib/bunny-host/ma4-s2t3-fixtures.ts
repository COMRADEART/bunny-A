// MA4-S2-T3 test rig: the real task store and runtime, the real broker and file connector, the real proactive store and
// engine on a temporary Host database, a fake clock shared by all of them, a recorded fake local model and recorded
// synthetic sources. A "restart" crashes the runtime (no further writes) and abandons the engine, then starts both anew.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HostDatabase } from "./persistence.server.ts";
import { TaskStore } from "./ma4/task-store.server.ts";
import { PersistentTaskRuntime, type Executor } from "./ma4/task-runtime.server.ts";
import { connectedActions } from "./ma4/connected-actions.server.ts";
import { localGenerate, killVerifiedProcess, processIdentity } from "./ma4/task-executors.server.ts";
import { localReview } from "./ma4/connected-workflow.server.ts";
import { ProactiveStore } from "./ma4/proactive-store.server.ts";
import { ProactiveEngine, type ProactiveDeps } from "./ma4/proactive.server.ts";
import type { NotificationCategory } from "./ma4/proactive.ts";
import type { TaskView } from "./ma4/task-runtime.ts";
import { fakeModel, MODEL, TEST_BASE } from "./ma4-s2t2-fixtures.ts";

export { MODEL };
/** Sat 24 Oct 2026 12:00 UTC. */
export const T0 = Date.UTC(2026, 9, 24, 12, 0);
export const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
export const WS = "workstation", PHONE = "device:phone-1";

export const envelope = (kinds: string[], grants: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
  capabilities: [...new Set(kinds)], providers: ["ollama"], localOnly: true, models: [MODEL], projectScopes: ["p1"], sideEffects: false, background: false,
  budgets: { maxModelCalls: 20, maxWallMs: HOUR }, expiresAt: T0 + 60 * DAY, grants, ...extra,
});
/** Scenario A's team: Worker reads approved artifacts, Worker summarizes, Reviewer checks the summary against them. */
export const summaryAction = (o: { project?: string; path?: string; extra?: Record<string, unknown> } = {}) => ({
  type: "task" as const,
  spec: {
    title: "Project summary", projectId: o.project ?? "p1",
    steps: [
      { id: "read", kind: "file.read", input: { root: "atlas", path: o.path ?? "STATUS.md" }, model: null },
      { id: "sum", kind: "local.generate", input: { prompt: "Summarize the project's status for the owner in three lines.", contextFrom: "read" }, model: MODEL },
      { id: "check", kind: "local.review", input: { criteria: "Every statement in the summary is supported by the sources.", subjectFrom: "sum", contextFrom: "read" }, model: MODEL },
    ],
    acceptance: { requiredSteps: ["read", "sum", "check"], description: "A reviewed summary of approved files." },
  },
  // A scheduled run may happen with Bunny-A's windows closed: background work, so each run needs an approval (the schedule's).
  envelope: envelope(["file.read", "local.generate", "local.review"], { files: [{ root: "atlas", access: "read" }] }, { projectScopes: [o.project ?? "p1"], background: true, ...o.extra }),
});
export const schedule = (o: Record<string, unknown> = {}) => ({
  title: "Evening project summary", projectId: "p1", trigger: { type: "daily", time: "18:00", timeZone: "UTC" }, action: summaryAction(), expiresAt: T0 + 30 * DAY, ...o,
});
export const monitor = (o: Record<string, unknown> = {}) => ({
  title: "Release check", label: "Build status", projectId: "p1", source: { kind: "file", root: "atlas", path: "build/status.json", field: "status" },
  predicate: { type: "transition", from: "PASS", to: "FAIL" }, intervalMs: 5 * MIN, maxChecksPerHour: 12, dedupMs: 30 * MIN, expiresAt: T0 + 30 * DAY, ...o,
});
export const goal = (o: Record<string, unknown> = {}) => ({
  title: "Prepare Bunny A for beta", projectId: "p1", description: "Release readiness.",
  successCriteria: [{ id: "tests", description: "Regression suite green" }, { id: "notes", description: "Release notes drafted" }, { id: "build", description: "Installer built" }],
  expiresAt: T0 + 60 * DAY, ...o,
});

export type PRig = Awaited<ReturnType<typeof prig>>;
export async function prig(o: { extra?: Executor[]; sources?: Record<string, () => Promise<unknown>>; model?: ReturnType<typeof fakeModel>; faults?: ProactiveDeps["faults"] } = {}) {
  // Not os.tmpdir(): on Windows that is inside %LOCALAPPDATA%, which can never be granted as a folder.
  mkdirSync(TEST_BASE, { recursive: true });
  const dir = mkdtempSync(join(TEST_BASE, "s2t3-")), data = join(dir, "data");
  mkdirSync(data, { recursive: true });
  const db = new HostDatabase(join(data, "host.sqlite"));
  const clock = { t: T0 }, ui = { attached: true }, models = { up: true };
  const sources: Record<string, () => Promise<unknown>> = { ...(o.sources ?? {}) };
  const model = o.model ?? fakeModel();
  const connected = connectedActions({ db, dataDirectory: data, protectedPaths: [data], services: null });
  let n = 0;
  const runtime = () => new PersistentTaskRuntime({
    store: new TaskStore(db), executors: [localGenerate, localReview, ...connected.executors, ...(o.extra ?? [])], call: model.call,
    modelAvailable: async m => models.up && m === MODEL, uiAttached: () => ui.attached, instanceId: `host-${++n}`, exclusive: true, now: () => clock.t,
    maintenanceMs: HOUR, identify: processIdentity, killVerified: killVerifiedProcess,
  });
  const engineOf = (rt: PersistentTaskRuntime, faults?: ProactiveDeps["faults"]) => new ProactiveEngine({
    store: new ProactiveStore(db), runtime: rt, roots: connected.roots, sources, modelAvailable: async m => models.up && m === MODEL,
    uiAttached: () => ui.attached, now: () => clock.t, timers: false, maxSleepMs: MIN, faults,
  });
  const rt = runtime();
  const p = {
    dir, db, clock, ui, models, sources, model, connected, rt, engine: engineOf(rt, o.faults),
    root(id: string, files: Record<string, string> = {}) {
      const path = join(dir, `root-${id}`);
      mkdirSync(path, { recursive: true });
      p.write(id, files);
      connected.roots.set([...connected.roots.list().filter(x => x.id !== id), { id, label: id, path }]);
      return path;
    },
    write(id: string, files: Record<string, string>) {
      for (const [name, content] of Object.entries(files)) { const path = join(dir, `root-${id}`, name); mkdirSync(join(path, ".."), { recursive: true }); writeFileSync(path, content); }
    },
    /** Lets the runtime run every task it may run now. */
    async drain() {
      let last = "";
      for (let i = 0; i < 300; i++) {
        p.rt.wake(); await p.rt.idle();
        const sig = p.rt.views().map(v => v.corrupt ? v.id : `${v.id}:${v.version}`).join();
        if (sig === last) return;
        last = sig;
        await new Promise(r => setTimeout(r, 1));
      }
    },
    /** One engine pass, then the runtime, then a pass that settles what the runtime did. */
    async tick() { await p.engine.tick(); await p.drain(); await p.engine.tick(); },
    async at(t: number) { p.clock.t = t; await p.tick(); },
    async restart(x: { faults?: ProactiveDeps["faults"] } = {}) {
      p.rt.crash(); await p.engine.close();
      p.rt = runtime(); p.engine = engineOf(p.rt, x.faults);
      await p.rt.start(); await p.engine.start();
    },
    notes(category?: NotificationCategory) { return p.engine.store.notifications(500).filter(n => !category || n.category === category); },
    tasks() { return p.rt.views().filter((v): v is TaskView => !v.corrupt); },
    async close() { await p.engine.close(); await p.rt.close(); await connected.close(); db.close(); rmSync(dir, { recursive: true, force: true, maxRetries: 5 }); },
  };
  await p.rt.start(); await p.engine.start();
  return p;
}
