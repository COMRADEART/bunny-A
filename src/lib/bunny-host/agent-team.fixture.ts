import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostDatabase } from "./persistence.server.ts";
import { ModelCapabilityRegistry } from "./model-capability.server.ts";
import { TaskManager } from "./manager.server.ts";
import { providerBase } from "./adapters.server.ts";
import type { AdapterHooks, AdapterResult, ProviderAdapter } from "./contracts.ts";
import type { OrchTask, ProviderLive } from "../orch/types.ts";
import { MissionManager } from "../bunny-missions/manager.server.ts";
import { FilesystemCapability, NotificationsCapability, TerminalCapability } from "../bunny-missions/capabilities/local.server.ts";
import type { TeamFaults } from "../bunny-missions/team-coordination.server.ts";
import type { MissionStep } from "../bunny-missions/types.ts";
import { AgentRuntime, agentCommand } from "./agent-runtime.server.ts";

/**
 * M-A-3 T11 — Team Mission integration. The model is a scripted local stand-in (labelled SIMULATED in the evidence):
 * it answers by the Host-recorded kind of the step it was launched for. Everything else — planning validation,
 * identities, scheduling, handoffs, writes, Host verification, rework, recovery — is the real Host code.
 */

type Responder = (step: MissionStep, task: OrchTask, attempt: number) => string | { fail: string } | { hang: true };
type Launch = { task: OrchTask; step: MissionStep | null; finish: (result: AdapterResult) => void; hooks: AdapterHooks; stopped: boolean };

export const until = async <T,>(check: () => T | undefined | null | false, label: string, timeout = 30_000): Promise<T> => {
  const start = Date.now();
  for (;;) {
    let out: T | undefined | null | false;
    try { out = check(); } catch { out = undefined; }
    if (out) return out;
    if (Date.now() - start > timeout) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 10));
  }
};

export const REQUIREMENTS = [
  { id: "R1", text: "The dashboard has a summary section", check: { kind: "html_id", value: "summary" } },
  { id: "R2", text: "Every dataset item is shown", check: { kind: "dataset_values" } },
  { id: "R3", text: "The page works offline", check: { kind: "no_external_resources" } },
  { id: "R4", text: "The README has a Usage section", check: { kind: "markdown_heading", value: "Usage" } },
];
export const PLAN = {
  version: "bunny.team-plan.v1",
  summary: "Read the inventory, build the dataset, dashboard and README in parallel, review and verify them.",
  tasks: [
    { id: "t1", role: "researcher", kind: "observe", objective: "Read the inventory file.", dependsOn: [], path: "data/inventory.csv" },
    { id: "t2", role: "researcher", kind: "generate_json", objective: "Turn the inventory into the dataset.", dependsOn: ["t1"], schema: "dashboard-dataset.v1" },
    { id: "t3", role: "documenter", kind: "generate_markdown", objective: "Write the README.", dependsOn: [] },
    { id: "t4", role: "implementer", kind: "generate_html", objective: "Build the offline dashboard.", dependsOn: ["t2"], requirements: ["R1", "R2", "R3"] },
    { id: "t5", role: "implementer", kind: "write_file", objective: "Save the dashboard.", dependsOn: ["t4"], target: "index.html", content: "t4" },
    { id: "t6", role: "documenter", kind: "write_file", objective: "Save the README.", dependsOn: ["t3"], target: "README.md", content: "t3" },
    { id: "t7", role: "reviewer", kind: "review", objective: "Review the dashboard.", dependsOn: ["t5", "t2"], subject: "t5", requirements: ["R1", "R2"] },
    { id: "t8", role: "tester", kind: "verify_output", objective: "Verify the dashboard.", dependsOn: ["t5", "t7"], subject: "t5", requirements: ["R1", "R2", "R3"] },
    { id: "t9", role: "tester", kind: "verify_output", objective: "Verify the README.", dependsOn: ["t6"], subject: "t6", requirements: ["R4"] },
  ],
};
export const DATASET = { title: "Inventory", source: "data/inventory.csv", items: [
  { id: "widgets", name: "Widgets", category: "parts", value: 12, status: "ok" },
  { id: "gadgets", name: "Gadgets", category: "parts", value: 3, status: "warning" },
] };
export const HTML = `<!DOCTYPE html><html><head><title>Inventory</title><style>body{font-family:sans-serif}</style></head><body><section id="summary"><h1>Inventory</h1><p>2 items</p></section><ul><li>Widgets 12</li><li>Gadgets 3</li></ul></body></html>`;
export const README = "# Inventory dashboard\n\n## Usage\n\nOpen index.html in a browser.\n";
export const REVIEW = { verdict: "pass", findings: [{ requirement: "R1", severity: "advisory", summary: "Summary section present.", evidence: "section#summary" }] };

/** Default scripted answers by kind (the stand-in for a real local model). */
export const scripted: Responder = (step) => {
  const kind = step.team?.kind;
  if (kind === "plan") return JSON.stringify(PLAN);
  if (kind === "generate_json") return "```json\n" + JSON.stringify(DATASET) + "\n```";
  if (kind === "generate_markdown") return README;
  if (kind === "generate_html") return "Here is the page:\n```html\n" + HTML + "\n```";
  if (kind === "review") return JSON.stringify(REVIEW);
  return "";
};

function localModel(launched: Launch[], env: { missions?: MissionManager; responder: Responder; attempts: Map<string, number>; hold: boolean; unknown?: boolean; availability?: "offline" | "unknown" }): ProviderAdapter {
  return {
    id: "ollama",
    detect: async (): Promise<ProviderLive> => ({ ...providerBase("ollama"), installed: true, authenticated: true, availability: env.availability ?? (env.unknown ? "unknown" : "ready"), capabilities: ["text"], current_model: "test-local:7b", models: ["test-local:7b"] }),
    launch: (task, hooks) => {
      let finish!: (result: AdapterResult) => void;
      const done = new Promise<AdapterResult>((resolve) => (finish = resolve));
      hooks.session(`ollama-${launched.length + 1}`, null);
      let step: MissionStep | null = null;
      try { step = task.mission ? env.missions!.store.step(task.mission.stepId) : null; } catch { step = null; }
      const session: Launch = { task, step, finish, hooks, stopped: false };
      launched.push(session);
      const attempt = (env.attempts.get(step?.id ?? task.id) ?? 0) + 1;
      env.attempts.set(step?.id ?? task.id, attempt);
      if (!env.hold) setTimeout(() => {
        if (session.stopped) return;
        const answer = step ? env.responder(step, task, attempt) : "";
        if (typeof answer === "object" && "hang" in answer) return;
        if (typeof answer === "object") finish({ ok: false, output: answer.fail, exitCode: 1 });
        else finish({ ok: true, output: answer });
      }, 5);
      return { done, stop: async () => { session.stopped = true; finish({ ok: false, output: "", stopped: true }); } };
    },
  };
}

export type TeamEnv = {
  dir: string; root: string; db: HostDatabase; tasks: TaskManager; missions: MissionManager; agents: AgentRuntime; launched: Launch[];
  control: { responder: Responder; attempts: Map<string, number>; hold: boolean; unknown?: boolean; availability?: "offline" | "unknown"; missions?: MissionManager };
  cleanup: () => Promise<void>; reopen: (extra?: { startUnknown?: boolean; startOffline?: boolean }) => Promise<TeamEnv>;
};

export async function teamSetup(label: string, options: { faults?: TeamFaults; responder?: Responder; dir?: string; providers?: ProviderAdapter[]; startUnknown?: boolean; startOffline?: boolean } = {}): Promise<TeamEnv> {
  const dir = options.dir ?? mkdtempSync(join(tmpdir(), `bunny-t11-${label}-`));
  const root = join(dir, "project");
  if (!options.dir) {
    mkdirSync(join(root, "data"), { recursive: true });
    writeFileSync(join(root, "data", "inventory.csv"), "name,count\nWidgets,12\nGadgets,3\n");
    writeFileSync(join(root, "notes.md"), "# Notes\n");
  }
  const db = new HostDatabase(join(dir, "host.sqlite"));
  const launched: Launch[] = [];
  const control = { responder: options.responder ?? scripted, attempts: new Map<string, number>(), hold: false, unknown: options.startUnknown === true, ...(options.startOffline ? { availability: "offline" as const } : {}) } as TeamEnv["control"];
  const factLess = new ModelCapabilityRegistry(db, { availableProviders: () => [] });
  const tasks = new TaskManager(db, root, [localModel(launched, control), ...(options.providers ?? [])], { modelRegistry: factLess });
  await tasks.discover();
  const adapters = [new FilesystemCapability(), new TerminalCapability(), new NotificationsCapability(() => undefined)];
  const missions = new MissionManager(tasks, { dataDirectory: dir, adapters, ...(options.faults ? { teamFaults: options.faults } : {}) });
  control.missions = missions;
  missions.configure({ enabled: true, limits: { maxSteps: 20 } }, "test");
  await missions.bus.refreshHealth();
  const agents = new AgentRuntime(db, missions);
  missions.missionPauseGate = (missionId) => agents.blockedForMission(missionId);
  const close = async () => {
    try { agents.close(); } catch { /* closed */ }
    try { await missions.close(); } catch { /* closed */ }
    try { db.close(); } catch { /* closed */ }
  };
  const env: TeamEnv = {
    dir, root, db, tasks, missions, agents, launched, control,
    cleanup: async () => { await close(); try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows locks settle late */ } },
    reopen: async (extra: { startUnknown?: boolean; startOffline?: boolean } = {}) => { await close(); return teamSetup(label, { ...options, ...extra, dir }); },
  };
  return env;
}

export const teamRows = (env: TeamEnv) => env.agents.snapshot().agents;
export function createTeam(env: TeamEnv, extra: Record<string, unknown> = {}) {
  env.agents.create({ objective: "Build an offline inventory dashboard with a README from data/inventory.csv.", name: "Inventory team", team: { requirements: REQUIREMENTS, outputDir: "team-out", ...extra } } as never, "workstation");
  const coordinator = teamRows(env).find((agent) => agent.team?.role === "coordinator")!;
  return { coordinatorId: coordinator.id, missionId: coordinator.missionId! };
}
export const missionOf = (env: TeamEnv, missionId: string) => env.missions.get(missionId).mission;
export async function reachReview(env: TeamEnv, coordinatorId: string, missionId: string) {
  env.agents.start(coordinatorId, "workstation");
  return until(() => { const m = missionOf(env, missionId); return m.state === "waiting_for_approval" && m.team?.proposal ? m : null; }, "team plan review");
}
export async function approvePlan(env: TeamEnv, coordinatorId: string, missionId: string) {
  return agentCommand(env.agents, "agent.team.approve", { id: coordinatorId, planReference: env.missions.agenticPlanReference(missionId) }, "workstation");
}
