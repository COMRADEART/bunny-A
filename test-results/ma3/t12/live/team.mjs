// M-A-3 T12: a real T11 Team Mission on the disposable Host (disposable Git project, real local Ollama, tool-free model
// work). Operator decisions (plan approval) go through the same Host command API the Agentic UI uses. Nothing here is
// faked: Agents, Tasks and verification state are whatever the Host records.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

export function makeProject(parent) {
  const project = join(parent, "offline-dashboard");
  for (const p of [project, join(project, "data"), join(project, "docs")]) mkdirSync(p, { recursive: true });
  const git = (...args) => execFileSync("git", ["-c", "user.name=T12 Fixture", "-c", "user.email=t12@example.invalid", "-c", "core.autocrlf=false", ...args], { cwd: project, windowsHide: true });
  const commit = (files, message) => { for (const [path, body] of Object.entries(files)) writeFileSync(join(project, path), body); git("add", "."); git("commit", "-qm", message); };
  git("init", "-q");
  commit({ "README.md": "# Offline dashboard\n\nDisposable T12 acceptance project. Test data only.\n" }, "Start the offline dashboard project");
  commit({ "data/inventory.csv": "name,category,count,status\nWidgets,parts,120,ok\nGadgets,parts,8,warning\nSprockets,parts,0,error\nCables,accessories,64,ok\nAdapters,accessories,15,warning\nBatteries,power,42,ok\n" }, "Add inventory test data");
  commit({ "data/services.csv": "service,status,latency_ms,owner\nauth,ok,42,identity\nsearch,warning,310,discovery\nbilling,ok,88,payments\nexport,error,0,reports\nnotify,ok,51,platform\n" }, "Add service status test data");
  commit({ "docs/notes.md": "# Notes\n\nThe dashboard must work offline. Every number comes from the data folder.\n" }, "Document the offline constraint");
  return project;
}

export const TEAMS = [
  { name: "Inventory dashboard team", outputDir: "inventory-dashboard", objective: "Build an offline inventory dashboard page from data/inventory.csv with a README that explains how to use it.",
    requirements: [{ id: "R1", text: "The dashboard has a summary section", check: { kind: "html_id", value: "summary" } }, { id: "R2", text: "Every inventory item is shown", check: { kind: "dataset_values" } }, { id: "R3", text: "The page works offline", check: { kind: "no_external_resources" } }, { id: "R4", text: "The README has a Usage section", check: { kind: "markdown_heading", value: "Usage" } }] },
  { name: "Service status team", outputDir: "service-status", objective: "Build an offline service status page from data/services.csv and a short operations note in Markdown.",
    requirements: [{ id: "R1", text: "The page has a status table section", check: { kind: "html_id", value: "status" } }, { id: "R2", text: "Every service is listed", check: { kind: "dataset_values" } }, { id: "R3", text: "The page works offline", check: { kind: "no_external_resources" } }, { id: "R4", text: "The note has an Incidents section", check: { kind: "markdown_heading", value: "Incidents" } }] },
];

const ok = async (host, action, data) => {
  const r = await host.command(action, data);
  if (r.status !== 200) throw Object.assign(Error(`${action}: ${r.body?.error ?? r.status}`), { result: r.body });
  return r.body;
};

/** Registers the project, creates one Team Mission, plans it with the real Planner Agent and approves the reviewed plan. */
export async function startTeam(host, project, spec, note = () => {}) {
  await ok(host, "mission.configure", { enabled: true, limits: { maxSteps: 20, maxActiveMissions: 3 } });
  let projectId = host.projectId;
  if (!projectId) { projectId = (await ok(host, "project.add", { name: "T12 offline dashboard (disposable)", path: project })).data.id; host.projectId = projectId; }
  const created = await ok(host, "agent.create", { projectId, name: spec.name, objective: spec.objective, team: { outputDir: spec.outputDir, requirements: spec.requirements } });
  const coordinator = created.snapshot.agents.agents.find((a) => a.team?.role === "coordinator" && a.name === spec.name);
  const team = { ...spec, missionId: coordinator.missionId, coordinatorId: coordinator.id };
  note("team.created", { name: spec.name, missionId: team.missionId });
  await ok(host, "agent.start", { id: team.coordinatorId });
  let revised = false;
  for (const deadline = Date.now() + 15 * 60_000; Date.now() < deadline; ) {
    const s = await host.state();
    const m = s.missions.missions.find((x) => x.id === team.missionId);
    if (m && m.state === "waiting_for_approval" && m.teamView?.phase === "review") {
      await ok(host, "agent.team.approve", { id: team.coordinatorId, planReference: m.teamView.planReference });
      note("team.approved", { name: spec.name, tasks: m.steps.filter((st) => !st.team?.dormant).length });
      return team;
    }
    if (m && m.state === "waiting_for_user" && m.teamView?.phase === "planning" && !revised) {
      revised = true;
      await ok(host, "agent.team.revise", { id: team.coordinatorId, note: "Follow every rule Bunny listed; keep one chain per deliverable." });
      await host.command("agent.team.approve", { id: team.coordinatorId });
      note("team.revision_requested", { name: spec.name });
    }
    if (m && ["failed", "stopped"].includes(m.state)) throw Error(`${spec.name} planning ended ${m.state}`);
    await sleep(2000);
  }
  throw Error(`${spec.name}: plan review timed out`);
}

/** Canonical Agent/Mission facts (ids, roles, states, current Task kind, verification) at one instant. */
export async function agentFacts(host) {
  const s = await host.state();
  return {
    at: Date.now(),
    agents: s.agents.agents.filter((a) => a.team).map((a) => ({ id: a.id, name: a.name, role: a.team.role, state: a.state, missionId: a.missionId, current: a.current?.kind ?? null, revision: a.authorization?.revision ?? null })),
    missions: s.missions.missions.filter((m) => m.teamView).map((m) => ({ id: m.id, title: m.title, state: m.state, phase: m.teamView.phase, requirementResults: m.teamView.requirementResults ?? null })),
    tasks: s.tasks.length,
  };
}
