import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

const until = async <T,>(check: () => T | undefined | null | false, label: string, timeout = 30_000): Promise<T> => {
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

function localModel(launched: Launch[], env: { missions?: MissionManager; responder: Responder; attempts: Map<string, number>; hold: boolean; unknown?: boolean }): ProviderAdapter {
  return {
    id: "ollama",
    detect: async (): Promise<ProviderLive> => ({ ...providerBase("ollama"), installed: true, authenticated: true, availability: env.unknown ? "unknown" : "ready", capabilities: ["text"], current_model: "test-local:7b", models: ["test-local:7b"] }),
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
  control: { responder: Responder; attempts: Map<string, number>; hold: boolean; unknown?: boolean; missions?: MissionManager };
  cleanup: () => Promise<void>; reopen: (extra?: { startUnknown?: boolean }) => Promise<TeamEnv>;
};

export async function teamSetup(label: string, options: { faults?: TeamFaults; responder?: Responder; dir?: string; providers?: ProviderAdapter[]; startUnknown?: boolean } = {}): Promise<TeamEnv> {
  const dir = options.dir ?? mkdtempSync(join(tmpdir(), `bunny-t11-${label}-`));
  const root = join(dir, "project");
  if (!options.dir) {
    mkdirSync(join(root, "data"), { recursive: true });
    writeFileSync(join(root, "data", "inventory.csv"), "name,count\nWidgets,12\nGadgets,3\n");
    writeFileSync(join(root, "notes.md"), "# Notes\n");
  }
  const db = new HostDatabase(join(dir, "host.sqlite"));
  const launched: Launch[] = [];
  const control = { responder: options.responder ?? scripted, attempts: new Map<string, number>(), hold: false, unknown: options.startUnknown === true } as TeamEnv["control"];
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
    reopen: async (extra: { startUnknown?: boolean } = {}) => { await close(); return teamSetup(label, { ...options, ...extra, dir }); },
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

test("T11-I01: one objective → Planner Agent → validated plan → member Agents execute, hand off, verify and complete", async () => {
  const env = await teamSetup("i01");
  try {
    const { coordinatorId, missionId } = createTeam(env);
    let rows = teamRows(env);
    assert.equal(rows.length, 2, "Coordinator and Planner exist before planning; members wait for a validated plan");
    assert.deepEqual(rows.map((row) => row.team?.role).sort(), ["coordinator", "planner"]);
    const review = await reachReview(env, coordinatorId, missionId);
    rows = teamRows(env);
    assert.deepEqual(rows.map((row) => row.team?.role).sort(), ["coordinator", "documenter", "implementer", "planner", "researcher", "reviewer", "tester"]);
    assert.ok(review.steps.every((step) => step.team?.agentId), "every step has a durable owning Agent");
    assert.equal(review.steps.filter((step) => step.team?.dormant).length, 6, "two verify chains × one rework round are reserved, dormant");
    // Approval needs the exact reviewed reference.
    await assert.rejects(() => agentCommand(env.agents, "agent.team.approve", { id: coordinatorId, planReference: "team:forged" }, "workstation"), /plan changed/);
    await approvePlan(env, coordinatorId, missionId);
    const done = await until(() => { const m = missionOf(env, missionId); return ["completed", "failed", "waiting_for_user"].includes(m.state) ? m : null; }, "team completion", 60_000);
    assert.equal(done.state, "completed", JSON.stringify(done.steps.map((step) => [step.team?.key, step.state, step.failure?.detail])));
    assert.equal(readFileSync(join(env.root, "team-out", "index.html"), "utf8").trim(), HTML);
    assert.equal(readFileSync(join(env.root, "team-out", "README.md"), "utf8"), README);
    assert.ok(done.steps.filter((step) => step.team?.dormant).every((step) => step.state === "skipped" && !step.attempts.length), `no rework was needed; reserved steps never ran: ${JSON.stringify(done.steps.filter((step) => step.team?.dormant).map((step) => [step.team?.key, step.state, step.attempts.length]))}`);
    const handoffs = env.missions.store.handoffs(missionId, 100);
    assert.ok(handoffs.length >= 5, `verified handoffs recorded (${handoffs.length})`);
    // Every model launch was a tool-free local Ollama task with read access.
    assert.ok(env.launched.every((launch) => launch.task.provider === "ollama" && launch.task.executionScope?.access === "read"));
    // Distinct Agents own the work, and each member completed with its Mission.
    const owners = new Set(done.steps.filter((step) => !step.team?.dormant).map((step) => step.team!.agentId));
    assert.equal(owners.size, 6, "planner + five member roles own steps");
    rows = await until(() => { const r = teamRows(env); return r.every((row) => row.state === "COMPLETED") ? r : null; }, "agents complete");
    const started = env.db.events().filter((event) => event.type === "agent.task_started" && event.missionId === missionId).map((event) => JSON.parse(event.detail).agentId);
    assert.ok(new Set(started).size >= 5, "task lifecycle is attributed to member Agents, not only the Coordinator");
    assert.ok(!started.includes(coordinatorId), "the Coordinator owns no task");
  } finally { await env.cleanup(); }
});

test("T11-I02: a seeded defect fails Host verification; the reserved rework chain repairs it within the approved plan", async () => {
  const faults: TeamFaults = { seedOutput: ({ kind, round, text }) => kind === "generate_html" && round === 0 ? text.replace(' id="summary"', "") : null };
  const env = await teamSetup("i02", { faults });
  try {
    const { coordinatorId, missionId } = createTeam(env);
    await reachReview(env, coordinatorId, missionId);
    const approvedSteps = missionOf(env, missionId).steps.map((step) => step.id).sort();
    await approvePlan(env, coordinatorId, missionId);
    const done = await until(() => { const m = missionOf(env, missionId); return ["completed", "failed", "waiting_for_user"].includes(m.state) ? m : null; }, "team completion", 60_000);
    assert.equal(done.state, "completed", JSON.stringify(done.steps.map((step) => [step.team?.key, step.state, step.failure?.detail])));
    assert.deepEqual(done.steps.map((step) => step.id).sort(), approvedSteps, "rework added no step outside the reviewed plan");
    const verify = done.steps.find((step) => step.team?.key === "t8")!;
    assert.equal(verify.state, "failed");
    assert.match(verify.failure?.detail ?? "", /R1/);
    assert.ok(verify.team?.supersededBy, "the failed verify is superseded by its replica");
    const replica = done.steps.find((step) => step.team?.key === "t4_r1")!;
    assert.equal(replica.state, "completed");
    assert.match(replica.team?.repair ?? "", /R1/, "the repair note is the Host failure evidence");
    assert.equal(missionOf(env, missionId).team!.reworkRounds, 1);
    assert.match(readFileSync(join(env.root, "team-out", "index.html"), "utf8"), /id="summary"/);
    assert.ok(env.db.events().some((event) => event.type === "mission.team.seeded" && event.missionId === missionId), "the seeded fault is recorded, never hidden");
  } finally { await env.cleanup(); }
});

test("T11-I03: an invalid plan is rejected with reasons and re-proposed; members are never created for it", async () => {
  let plans = 0;
  const env = await teamSetup("i03", { responder: (step, task, attempt) => {
    if (step.team?.kind === "plan") { plans++; return plans === 1 ? JSON.stringify({ ...PLAN, tasks: [...PLAN.tasks, { id: "t10", role: "implementer", kind: "write_file", objective: "x", dependsOn: ["t4"], target: "../escape.html", content: "t4" }] }) : JSON.stringify(PLAN); }
    return scripted(step, task, attempt);
  } });
  try {
    const { coordinatorId, missionId } = createTeam(env);
    const review = await reachReview(env, coordinatorId, missionId);
    assert.equal(plans, 2, "the rejected plan was retried with the rejection reasons");
    assert.equal(review.team!.planRevisions, 1);
    assert.ok(review.team!.rejected[0].reasons.some((reason) => /target/.test(reason)));
    assert.match(env.launched[1].task.prompt, /REJECTED/, "the repair prompt names the Host's reasons");
    assert.ok(!existsSync(join(env.root, "escape.html")));
  } finally { await env.cleanup(); }
});

test("T11-I04: member pause holds only that member; member stop holds the Mission for the user; Coordinator stop stops everyone", async () => {
  const env = await teamSetup("i04");
  try {
    const { coordinatorId, missionId } = createTeam(env);
    await reachReview(env, coordinatorId, missionId);
    const documenter = teamRows(env).find((row) => row.team?.role === "documenter")!;
    env.agents.pause(documenter.id, "workstation");
    await approvePlan(env, coordinatorId, missionId);
    // Everything not owned by the documenter (and not depending on it) completes.
    await until(() => missionOf(env, missionId).steps.find((step) => step.team?.key === "t8")?.state === "completed", "dashboard verified while documenter paused", 60_000);
    const m = missionOf(env, missionId);
    assert.equal(m.steps.find((step) => step.team?.key === "t3")!.state === "completed", false, "the paused member's step was never admitted");
    assert.notEqual(m.state, "completed");
    assert.equal(teamRows(env).find((row) => row.id === documenter.id)!.state, "PAUSED");
    // Stop the paused member: its work is stopped and the Mission waits for the user.
    await env.agents.stop(documenter.id, "workstation");
    await until(() => missionOf(env, missionId).state === "waiting_for_user", "mission holds after member stop");
    const after = teamRows(env);
    assert.equal(after.find((row) => row.id === documenter.id)!.state, "STOPPED");
    assert.notEqual(after.find((row) => row.id === coordinatorId)!.state, "STOPPED", "a member stop is not a Mission stop");
    await env.agents.stop(coordinatorId, "workstation");
    await until(() => missionOf(env, missionId).state === "stopped", "mission stopped");
    assert.ok(teamRows(env).every((row) => row.state === "STOPPED" || row.state === "COMPLETED"));
  } finally { await env.cleanup(); }
});

test("T11-I05: a Host restart mid-team reconciles once through the Coordinator; members open new generations and the team completes", async () => {
  let env = await teamSetup("i05");
  try {
    const { coordinatorId, missionId } = createTeam(env);
    await reachReview(env, coordinatorId, missionId);
    env.control.hold = true;
    await approvePlan(env, coordinatorId, missionId);
    await until(() => env.launched.some((launch) => launch.step?.team?.kind === "generate_markdown"), "a member model step in flight");
    const members = teamRows(env).filter((row) => row.team?.role !== "coordinator").map((row) => row.id);
    env = await env.reopen();
    const done = await until(() => { const m = missionOf(env, missionId); return ["completed", "failed", "waiting_for_user", "stopped"].includes(m.state) ? m : null; }, "team completion after restart", 60_000);
    assert.equal(done.state, "completed", JSON.stringify(done.steps.map((step) => [step.team?.key, step.state, step.failure?.detail])));
    const recovered = env.db.events().filter((event) => event.type === "agent.recovered" && event.missionId === missionId).map((event) => JSON.parse(event.detail));
    assert.equal(recovered.filter((detail) => detail.agentId === coordinatorId).length, 1, "exactly one Coordinator recovery");
    assert.ok(recovered.some((detail) => members.includes(detail.agentId) && detail.scope === "member"), "members open a new run generation without reconciling");
    const interrupted = done.steps.filter((step) => step.attempts.some((attempt) => attempt.outcome === "interrupted"));
    assert.ok(interrupted.length >= 1, "the in-flight step was recorded as interrupted, then requeued once");
    assert.ok(interrupted.every((step) => step.attempts.filter((attempt) => attempt.outcome === "interrupted").length === 1));
  } finally { await env.cleanup(); }
});

/** Finishes every held model launch with its scripted answer (the stand-in model "returns"). */
function release(env: TeamEnv) {
  for (const launch of env.launched.filter((item) => !item.stopped && !(item as { released?: boolean }).released)) {
    (launch as { released?: boolean }).released = true;
    const answer = launch.step ? env.control.responder(launch.step, launch.task, 1) : "";
    launch.finish(typeof answer === "string" ? { ok: true, output: answer } : { ok: false, output: "held", exitCode: 1 });
  }
}

test("T11-I06: one Coordinator consent covers the reviewed execution plan; a mid-run reduction is never revived by old authority", async () => {
  const env = await teamSetup("i06");
  try {
    const { coordinatorId, missionId } = createTeam(env);
    // Consent is refused during the planner-only phase and for member Agents.
    await assert.rejects(() => agentCommand(env.agents, "agent.authorization.propose", { id: coordinatorId }, "workstation"), /Review the planned Mission|execution plan/);
    await reachReview(env, coordinatorId, missionId);
    const member = teamRows(env).find((row) => row.team?.role === "researcher")!;
    await assert.rejects(() => agentCommand(env.agents, "agent.authorization.propose", { id: member.id }, "workstation"), /Coordinator/);
    await agentCommand(env.agents, "agent.authorization.propose", { id: coordinatorId }, "workstation");
    const offered = env.missions.agentic.forMission(missionId)!;
    assert.equal(offered.plan_reference, env.missions.agenticPlanReference(missionId), "the consent names the reviewed team plan");
    assert.ok(offered.permitted_capabilities.includes("filesystem.write"));
    env.control.hold = true;
    await agentCommand(env.agents, "agent.authorization.approve", { id: coordinatorId, revision: offered.revision }, "workstation");
    await until(() => missionOf(env, missionId).state === "running", "team running under consent");
    // Reduce: no more file writes under this consent.
    const active = env.missions.agentic.forMission(missionId)!;
    await agentCommand(env.agents, "agent.authorization.adjust", { id: coordinatorId, revision: active.revision, patch: { capabilities: active.permitted_capabilities.filter((capability) => capability !== "filesystem.write") } }, "workstation");
    env.control.hold = false;
    release(env);
    const held = await until(() => { const m = missionOf(env, missionId); return m.requests.some((request) => !request.resolvedAt && request.action === "filesystem.write") ? m : null; }, "a write asks instead of using the narrowed consent", 60_000);
    assert.ok(!existsSync(join(env.root, "team-out", "index.html")) || !existsSync(join(env.root, "team-out", "README.md")), "no write ran under the old scope");
    const writes = held.steps.filter((step) => step.team?.kind === "write_file" && !step.team.dormant);
    assert.ok(writes.every((step) => step.state !== "completed"), "no write step completed after the reduction");
    // A one-time workstation answer cannot re-grant a capability removed from the consent: new authority needs a new
    // exact proposal, so the write keeps asking and never runs.
    for (let round = 0; round < 3; round++) {
      for (const request of missionOf(env, missionId).requests.filter((item) => !item.resolvedAt)) env.missions.respond(request.id, "allow_once", "workstation");
      await until(() => missionOf(env, missionId).requests.some((request) => !request.resolvedAt) || null, "the write asks again", 30_000);
    }
    assert.ok(!existsSync(join(env.root, "team-out", "index.html")) && !existsSync(join(env.root, "team-out", "README.md")), "the narrowed write never ran");
    assert.ok(missionOf(env, missionId).requests.some((request) => /outside the explicitly approved Agent capability list/.test(request.reason)), "the refusal names the narrowed consent");
    const admissions = env.db.db.prepare("SELECT record FROM agentic_admissions").all() as { record: string }[];
    const owners = new Set(admissions.map((row) => (JSON.parse(row.record) as { agent_id: string }).agent_id));
    assert.ok(owners.size >= 3 && !owners.has(coordinatorId), "consent admissions are attributed to the member Agents that used them");
    await env.agents.stop(coordinatorId, "workstation");
    await until(() => missionOf(env, missionId).state === "stopped", "team stopped");
  } finally { await env.cleanup(); }
});

test("T11-I07: after a restart, requeued team work waits for the first provider probe instead of failing or holding", async () => {
  let env = await teamSetup("i07");
  try {
    const { coordinatorId, missionId } = createTeam(env);
    await reachReview(env, coordinatorId, missionId);
    env.control.hold = true;
    await approvePlan(env, coordinatorId, missionId);
    await until(() => env.launched.some((launch) => launch.step?.team?.kind === "generate_markdown"), "a model step in flight");
    env = await env.reopen({ startUnknown: true });
    await new Promise((r) => setTimeout(r, 2500));
    const waiting = missionOf(env, missionId);
    assert.equal(waiting.state, "running", "the Mission keeps running while the provider is unprobed");
    assert.ok(!waiting.steps.some((step) => step.attempts.some((attempt) => attempt.category === "provider_unavailable")), "no attempt is spent on an unobserved provider state");
    assert.equal(env.launched.length, 0, "nothing is launched before the probe");
    env.control.unknown = false;
    await env.tasks.discover();
    const done = await until(() => { const m = missionOf(env, missionId); return ["completed", "failed", "waiting_for_user"].includes(m.state) ? m : null; }, "completion after the probe", 60_000);
    assert.equal(done.state, "completed", JSON.stringify(done.steps.map((step) => [step.team?.key, step.state, step.failure?.detail])));
  } finally { await env.cleanup(); }
});
