// MA4-S2-T2 test rig: the real broker, connectors, task store and runtime on a temporary Host database, with a recorded
// fake local model and (optionally) the recorded synthetic workspace. Nothing here reaches a network beyond 127.0.0.1.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HostDatabase } from "./persistence.server.ts";
import { TaskStore } from "./ma4/task-store.server.ts";
import { PersistentTaskRuntime, type FaultPoint } from "./ma4/task-runtime.server.ts";
import { connectedActions, type ConnectedActions } from "./ma4/connected-actions.server.ts";
import { localGenerate, localTest } from "./ma4/task-executors.server.ts";
import { localReview } from "./ma4/connected-workflow.server.ts";
import { SyntheticWorkspace, type ServiceProvider } from "./ma4/connectors/services.server.ts";
import type { ModelCall } from "./ma4/coding-workflow.server.ts";
import type { TaskView } from "./ma4/task-runtime.ts";

export const MODEL = "qwen3:8b-fixture";
/** Git-ignored scratch space inside the checkout. */
export const TEST_BASE = join(process.cwd(), ".tmp-s2t2");
export type Prompt = { role: string; model: string; prompt: string };
/** Recorded fake local model: answers per role from a script; records every prompt it was given. */
export function fakeModel(script: Partial<Record<string, string | ((prompt: string) => string)>> = {}, served: (model: string) => string = m => m) {
  const prompts: Prompt[] = [];
  const call: ModelCall = async ({ role, model, prompt }) => {
    prompts.push({ role, model, prompt });
    const answer = script[role] ?? (role === "Reviewer" ? JSON.stringify({ approved: true, issues: [] }) : `Summary by ${role}.`);
    return { ok: true, text: typeof answer === "function" ? answer(prompt) : answer, servedModel: served(model), durationMs: 1 };
  };
  return { call, prompts };
}

export function vault(tokens: Record<string, string>) { return { token: (_p: string, account: string) => tokens[account] ?? null }; }
export const SECRET_TOKEN = "ya29.synthetic-delegated-token-0123456789abcdef";
export function workspace(): SyntheticWorkspace {
  const w = new SyntheticWorkspace(vault({ "me@example.test": SECRET_TOKEN }), { email: ["me@example.test"], calendar: ["me@example.test"], docs: ["me@example.test"] });
  w.inbox = [{ id: "m1", from: "lead@example.test", to: ["me@example.test"], subject: "Status?", receivedAt: 1, snippet: "Where are we?", body: "Where are we on the project? Reply with the open issues." }];
  w.docsStore.set("d1", { id: "d1", title: "Plan", version: "v1", content: "Old plan." });
  return w;
}

export type Rig = {
  dir: string; data: string; db: HostDatabase; store: TaskStore; rt: PersistentTaskRuntime; connected: ConnectedActions; model: ReturnType<typeof fakeModel>;
  root(id: string, files?: Record<string, string>): string;
  restart(o?: { faults?: (point: FaultPoint, taskId: string) => void }): Promise<void>;
  run(id: string): Promise<TaskView>;
  close(): Promise<void>;
};

export async function rig(o: { services?: ServiceProvider | null; allowLoopback?: boolean; model?: ReturnType<typeof fakeModel>; uiAttached?: () => boolean; faults?: (point: FaultPoint, taskId: string) => void; now?: () => number; call?: ModelCall; modelAvailable?: (m: string) => Promise<boolean> } = {}): Promise<Rig> {
  // Not os.tmpdir(): on Windows that is inside %LOCALAPPDATA%, which (correctly) can never be granted as a folder.
  mkdirSync(TEST_BASE, { recursive: true });
  const dir = mkdtempSync(join(TEST_BASE, "rig-")), data = join(dir, "data");
  mkdirSync(data, { recursive: true });
  const db = new HostDatabase(join(data, "host.sqlite"));
  const store = new TaskStore(db);
  const model = o.model ?? fakeModel();
  const call = o.call ?? model.call;
  const modelAvailable = o.modelAvailable ?? (async (m: string) => m === MODEL);
  let n = 0;
  const make = (connected: ConnectedActions, faults?: (point: FaultPoint, taskId: string) => void) => new PersistentTaskRuntime({
    store, executors: [localGenerate, localReview, localTest, ...connected.executors], call, modelAvailable,
    // The heartbeat must renew the 30 s lease while a slow real-time step runs (a cold browser launch can exceed 30 s).
    uiAttached: o.uiAttached ?? (() => true), instanceId: `host-${++n}`, exclusive: true, now: o.now, faults, maintenanceMs: 10_000,
    onTerminal: id => connected.browser.close(id),
  });
  const connected = connectedActions({ db, dataDirectory: data, protectedPaths: [data], allowLoopback: o.allowLoopback ?? false, services: o.services ?? null });
  const r: Rig = {
    dir, data, db, store, connected, model, rt: make(connected, o.faults),
    root(id, files = {}) {
      const path = join(dir, `root-${id}`);
      mkdirSync(path, { recursive: true });
      for (const [name, content] of Object.entries(files)) { mkdirSync(join(path, name, ".."), { recursive: true }); writeFileSync(join(path, name), content); }
      connected.roots.set([...connected.roots.list().filter(x => x.id !== id), { id, label: id, path }]);
      return path;
    },
    async restart(x = {}) { r.rt.crash(); await connected.browser.closeAll(); r.rt = make(connected, x.faults); await r.rt.start(); },
    async run(id) {
      for (let i = 0; i < 200; i++) { r.rt.wake(); await r.rt.idle(); const v = r.rt.view(id) as TaskView; if (!["QUEUED", "RUNNING", "RESUMING"].includes(v.state)) return v; await new Promise(res => setTimeout(res, 5)); }
      return r.rt.view(id) as TaskView;
    },
    async close() { await r.rt.close(); await connected.close(); db.close(); rmSync(dir, { recursive: true, force: true, maxRetries: 5 }); },
  };
  await r.rt.start();
  return r;
}

type Step = { id: string; kind: string; input?: Record<string, unknown>; model?: string | null };
/** An envelope that grants exactly the step kinds used (the envelope caps capabilities at 16). */
export const envelope = (steps: Step[], grants: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  capabilities: [...new Set(steps.map(s => s.kind))], providers: ["ollama"], localOnly: true, models: [MODEL], projectScopes: ["p1"], sideEffects: false, background: false,
  budgets: { maxModelCalls: 20, maxWallMs: 3_600_000 }, expiresAt: Date.now() + 86_400_000, grants, ...extra,
});
export const spec = (steps: Step[], title = "Connected task") =>
  ({ title, projectId: "p1", steps: steps.map(s => ({ input: {}, ...s, ...(s.kind.startsWith("local.") ? { model: s.model ?? MODEL } : {}) })), acceptance: { requiredSteps: steps.map(s => s.id) } });
/** Creates a workstation task over these steps and grants; approves it when its impact requires that. */
export function create(r: Rig, steps: Step[], grants: Record<string, unknown>, extra: Record<string, unknown> = {}, title?: string): TaskView {
  const view = r.rt.create({ spec: spec(steps, title), envelope: envelope(steps, grants, extra) }, WS);
  return view.state === "AWAITING_APPROVAL" && !view.pendingAction ? r.rt.approve(view.id, WS) : view;
}
export const WS = "workstation";
/** The parsed connector result a step stored. */
export function result(r: Rig, taskId: string, stepId: string): Record<string, any> { return JSON.parse(r.store.output(taskId, stepId)!.content).result; }
