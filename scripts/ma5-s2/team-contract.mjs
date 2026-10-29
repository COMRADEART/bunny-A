// MA5-S2 Phase 1B: drives the real Host team contract (agent.create team → Planner review → approval → execution) on a
// disposable Host with the Ollama adapter only and a real local model. Never the owner's Host.
// Usage: node --experimental-strip-types scripts/ma5-s2/team-contract.mjs [out.json]
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startHost } from "../../src/lib/bunny-host/http.server.ts";
import { defaultAdapters } from "../../src/lib/bunny-host/adapters.server.ts";
import { writeEvidence } from "../evidence-guard.mjs";

const out = process.argv[2] ?? "docs/ma5-s2/evidence/team-contract.json";
const temp = mkdtempSync(join(tmpdir(), "bunny-ma5s2-team-"));
// A project must not live under AppData or inside Bunny state; the checkout's ignored test-results/ is neither.
mkdirSync("test-results/ma5-s2", { recursive: true });
const project = mkdtempSync(join(process.cwd(), "test-results", "ma5-s2", "team-project-"));
mkdirSync(join(project, "data"));
writeFileSync(join(project, "data", "inventory.csv"), "name,count\nWidgets,12\nGadgets,3\nSprockets,7\n");
const port = Number(process.env.BUNNY_TEAM_PORT ?? 43412);
const host = await startHost({ dataDirectory: join(temp, "host"), root: join(temp, "host"), port, adapters: defaultAdapters().filter((a) => a.id === "ollama") });
const headers = { authorization: `Bearer ${host.token}`, "content-type": "application/json", connection: "close" };
const state = async () => (await fetch(`http://127.0.0.1:${port}/state`, { headers })).json();
const command = async (action, data) => {
  const r = await fetch(`http://127.0.0.1:${port}/command`, { method: "POST", headers, body: JSON.stringify({ action, data, operationId: crypto.randomUUID() }) });
  const { snapshot: _s, ...body } = await r.json();
  return { status: r.status, ok: r.ok, body };
};
const scrub = (v) => JSON.parse(JSON.stringify(v ?? null).split(JSON.stringify(project).slice(1, -1)).join("<project>").split(JSON.stringify(temp).slice(1, -1)).join("<temp>"));
const steps = [];
const record = (name, value) => { steps.push(scrub({ name, ...value })); console.log(name, JSON.stringify(scrub(value)).slice(0, 300)); return value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const team = async () => {
  const s = await state();
  const coordinator = (s.agents?.agents ?? []).find((a) => a.team?.role === "coordinator");
  const mission = (s.missions?.missions ?? []).find((m) => m.id === coordinator?.missionId);
  return { s, coordinator, mission };
};
const summary = ({ coordinator, mission, s }) => ({
  missionState: mission?.state, phase: mission?.teamView?.phase, planReference: mission?.teamView?.planReference ?? null,
  coordinator: coordinator ? { id: coordinator.id, state: coordinator.state } : null,
  members: (s.agents?.agents ?? []).filter((a) => a.team && a.missionId === mission?.id).map((a) => ({ role: a.team.role, state: a.state, current: a.current ? { kind: a.current.kind, state: a.current.state, model: a.current.model } : null, owned: a.owned ?? null, failure: a.failure?.code ?? null })),
  steps: (mission?.steps ?? []).map((st) => ({ key: st.team?.key, role: st.team?.role, kind: st.team?.kind, state: st.state, verified: st.result?.verified ?? null })),
  handoffs: (mission?.teamView?.handoffs ?? []).map((h) => ({ type: h.artifactType, purpose: h.purpose, state: h.state })),
  requirements: mission?.teamView?.requirementResults ?? [], rejected: mission?.teamView?.rejected ?? [],
});

try {
  record("mission.configure", await command("mission.configure", { enabled: true }));
  const p = record("project.add", await command("project.add", { path: project, name: "Team probe", description: "Disposable" }));
  const projectId = p.body?.data?.id ?? p.body?.project?.id ?? (await state()).projects?.[0]?.id;
  const requirements = [
    { id: "R1", text: "The page has a summary section", check: { kind: "html_id", value: "summary" } },
    { id: "R2", text: "The page loads nothing from the internet", check: { kind: "no_external_resources" } },
  ];
  const t0 = Date.now();
  const created = record("agent.create (team)", await command("agent.create", { objective: "Build an offline inventory dashboard page from data/inventory.csv.", name: "Inventory team", projectId, team: { requirements } }));
  const coordinatorId = created.body?.agents?.agents?.find((a) => a.team?.role === "coordinator")?.id;
  // Creating a team only records it; the owner starts the Coordinator, which runs the Planner up to plan review.
  record("agent.start (coordinator)", await command("agent.start", { id: coordinatorId }));
  const review = await (async () => {
    for (const deadline = Date.now() + 600_000; Date.now() < deadline; await sleep(3_000)) {
      const t = await team();
      if (t.mission?.teamView?.phase === "review" || t.mission?.teamView?.proposal || ["failed", "stopped", "completed"].includes(t.mission?.state)) return t;
    }
    return team();
  })();
  record("after planning", { ms: Date.now() - t0, ...summary(review) });
  if (review.mission?.teamView?.phase === "review") {
    record("mission.approve on a team Mission (the old Windows path)", await command("mission.approve", { id: review.mission.id, start: true, plan: review.mission.teamView.planReference }));
    record("agent.team.approve with a wrong plan reference", await command("agent.team.approve", { id: review.coordinator.id, planReference: "0".repeat(64) }));
    record("agent.team.approve", await command("agent.team.approve", { id: review.coordinator.id, planReference: review.mission.teamView.planReference }));
    const t1 = Date.now();
    let last;
    for (const deadline = Date.now() + 900_000; Date.now() < deadline; await sleep(5_000)) {
      last = await team();
      if (["completed", "failed", "stopped"].includes(last.mission?.state) || last.mission?.state === "waiting_for_user") break;
    }
    record("after execution", { ms: Date.now() - t1, ...summary(last) });
  }
  writeEvidence(out, { schema: "ma5-s2.team-contract.v1", at: new Date().toISOString(), host: "disposable, Ollama adapter only", steps }, [host.token]);
} finally {
  await host.close();
  rmSync(temp, { recursive: true, force: true });
  rmSync(project, { recursive: true, force: true });
}
