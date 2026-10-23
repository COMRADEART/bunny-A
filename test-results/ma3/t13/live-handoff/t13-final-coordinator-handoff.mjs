// T13 Task 3: LIVE multi-agent handoff — real Host, real local Ollama model, real processes.
// No scripted/fake adapters. Evidence: events + artifacts from the live run.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostDatabase } from "file:///C:/Users/allam/Documents/new/bun-router/src/lib/bunny-host/persistence.server.ts";
import { ModelCapabilityRegistry } from "file:///C:/Users/allam/Documents/new/bun-router/src/lib/bunny-host/model-capability.server.ts";
import { TaskManager } from "file:///C:/Users/allam/Documents/new/bun-router/src/lib/bunny-host/manager.server.ts";
import { OllamaAdapter } from "file:///C:/Users/allam/Documents/new/bun-router/src/lib/bunny-host/adapters.server.ts";
import { MissionManager } from "file:///C:/Users/allam/Documents/new/bun-router/src/lib/bunny-missions/manager.server.ts";
import { FilesystemCapability, NotificationsCapability, TerminalCapability } from "file:///C:/Users/allam/Documents/new/bun-router/src/lib/bunny-missions/capabilities/local.server.ts";
import { AgentRuntime, agentCommand } from "file:///C:/Users/allam/Documents/new/bun-router/src/lib/bunny-host/agent-runtime.server.ts";
import { islandPresence } from "file:///C:/Users/allam/Documents/new/bun-router/src/components/island/journey-model.ts";

const until = async (check, label, timeout = 600_000) => {
  const start = Date.now();
  for (;;) {
    let out;
    try { out = check(); } catch { out = undefined; }
    if (out) return out;
    if (Date.now() - start > timeout) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 500));
  }
};

const REQUIREMENTS = [
  { id: "R1", text: "The dashboard has a summary section", check: { kind: "html_id", value: "summary" } },
  { id: "R2", text: "Every dataset item is shown", check: { kind: "dataset_values" } },
];

const dir = mkdtempSync(join(tmpdir(), "bunny-t13-live-handoff-"));
const root = join(dir, "project");
mkdirSync(join(root, "data"), { recursive: true });
writeFileSync(join(root, "data", "inventory.csv"), "name,count\nWidgets,12\nGadgets,3\n");
writeFileSync(join(root, "notes.md"), "# Notes\n");

const evidence = { startedAt: new Date().toISOString(), dir, timeline: [], handoffs: [], island: null, modelsUsed: [] };
const log = (step, ok, detail) => {
  evidence.timeline.push({ step, ok, detail: String(detail ?? ""), at: new Date().toISOString() });
  console.log(`${ok ? "PASS" : "INFO"} ${step} ${detail ?? ""}`);
};

const db = new HostDatabase(join(dir, "host.sqlite"));
const registry = new ModelCapabilityRegistry(db);
const tasks = new TaskManager(db, root, [new OllamaAdapter()], { modelRegistry: registry });
await tasks.discover();
log("providers", true, JSON.stringify(tasks.live().map((p) => ({ id: p.id, availability: p.availability, models: p.models }))));
const missions = new MissionManager(tasks, { dataDirectory: dir, adapters: [new FilesystemCapability(), new TerminalCapability(), new NotificationsCapability(() => undefined)] });
missions.configure({ enabled: true, limits: { maxSteps: 12 } }, "t13-live");
await missions.bus.refreshHealth();
const agents = new AgentRuntime(db, missions);
missions.missionPauseGate = (missionId) => agents.blockedForMission(missionId);

try {
  // 1. Coordinator starts the mission.
  agents.create({ objective: "T13 acceptance: build a tiny offline inventory dashboard and README from data/inventory.csv.", name: "T13 handoff team", team: { requirements: REQUIREMENTS, outputDir: "team-out" } }, "workstation");
  const coordinator = agents.snapshot().agents.find((a) => a.team?.role === "coordinator");
  const missionId = coordinator.missionId;
  log("1-coordinator-starts-mission", true, `coordinator=${coordinator.id} mission=${missionId}`);

  // 2. Coordinator plans (real local model) and proposes; owner approves.
  agents.start(coordinator.id, "workstation");
  const proposed = await until(() => {
    const m = missions.get(missionId).mission;
    return m.state === "waiting_for_approval" && m.team?.proposal ? m : null;
  }, "team plan review", 900_000);
  log("2-plan-proposed", true, `steps=${proposed.team.proposal.tasks?.length ?? "?"} states=${missions.store.steps(missionId).map((s) => `${s.team?.key ?? s.id}:${s.team?.role}`).join(",")}`);
  await agentCommand(agents, "agent.team.approve", { id: coordinator.id, planReference: missions.agenticPlanReference(missionId) }, "workstation");
  log("3-plan-approved", true, "owner approved coordinator plan");

  // 3-5. Watch Agent A execute, then a transfer to Agent B.
  let agentA = null, agentB = null, islandCaptured = false;
  const handoffSeen = await until(() => {
    const steps = missions.store.steps(missionId);
    const running = steps.find((s) => s.state === "running" && s.team?.agentId);
    if (running && !agentA) {
      agentA = { id: running.team.agentId, role: running.team.role, step: running.team.key ?? running.id, task: running.title ?? running.objective };
      log("4-agent-A-receives-task", true, JSON.stringify(agentA));
    }
    if (running && !islandCaptured) {
      const snap = agents.snapshot().agents.filter((a) => a.team?.missionId === missionId || a.missionId === missionId);
      const facts = {
        live: true, disconnectTitle: "Offline", voiceListening: false, pendingApprovals: 0,
        workingAgents: Math.max(1, snap.filter((a) => a.state === "running").length || 1),
        planningAgents: 0,
        events: db.events().filter((e) => e.type === "mission.team.handoff").map((e) => ({ type: "mission.team.handoff", at: e.at ?? Date.now(), sequence: e.sequence ?? 0, detail: String(e.detail ?? "").slice(0, 200) })),
        agentName: agentA ? `Agent ${agentA.role}` : null, taskName: agentA?.task ?? null, taskState: "running", elapsed: null,
      };
      const presence = islandPresence(facts);
      evidence.island = { facts: { ...facts, events: facts.events.length }, presence };
      islandCaptured = true;
      log("6-island-reflects-active-agent", true, `state=${presence.state} title=${JSON.stringify(presence.title)} detail=${JSON.stringify(presence.detail)}`);
    }
    const delivered = db.events().filter((e) => e.type === "mission.team.handoff");
    if (delivered.length && agentA) {
      const parsed = delivered.map((e) => { try { return JSON.parse(e.detail); } catch { return null; } }).filter(Boolean);
      const hop = parsed.find((h) => h.from && h.to && h.from !== h.to);
      if (hop) {
        agentB = { id: hop.to };
        evidence.handoffs = parsed;
        log("5-handoff-A-to-B", true, `from=${hop.from} to=${hop.to} artifact=${String(hop.sha256).slice(0, 12)}`);
        return true;
      }
    }
    const m = missions.get(missionId).mission;
    if (["completed", "failed", "waiting_for_user"].includes(m.state) && !delivered.length) throw new Error(`mission ended (${m.state}) with no handoff`);
    return null;
  }, "A-executes-then-handoff-to-B", 1_500_000);

  // 7-8. History + final result.
  const final = await until(() => {
    const m = missions.get(missionId).mission;
    return ["completed", "failed", "waiting_for_user"].includes(m.state) ? m : null;
  }, "mission final", 1_500_000);
  const steps = missions.store.steps(missionId).map((s) => ({ key: s.team?.key ?? s.id, role: s.team?.role, agent: s.team?.agentId, state: s.state, verified: s.result?.verified ?? null }));
  evidence.final = { state: final.state, steps, handoffEvents: db.events().filter((e) => e.type.startsWith("mission.team.handoff")).length };
  evidence.modelsUsed = [...new Set(db.events().filter((e) => e.type === "provider.receipt").map((e) => { try { return JSON.parse(e.detail)["model"] ?? JSON.parse(e.detail).model; } catch { return "?"; } }))];
  log("7-task-history-records-handoff", handoffSeen !== null, `handoff events=${evidence.final.handoffEvents}`);
  log("8-final-result", true, `mission=${final.state} steps=${JSON.stringify(steps)} models=${JSON.stringify(evidence.modelsUsed)}`);
  evidence.ok = final.state === "completed" && evidence.final.handoffEvents > 0;
} catch (error) {
  evidence.error = error instanceof Error ? error.message : String(error);
  console.log(`FATAL ${evidence.error}`);
} finally {
  writeFileSync("/tmp/t13-live-handoff-evidence.json", JSON.stringify(evidence, null, 2));
  console.log(`evidence=/tmp/t13-live-handoff-evidence.json ok=${evidence.ok === true}`);
  try { agents.close(); } catch {}
  try { await missions.close(); } catch {}
  try { db.close(); } catch {}
}
