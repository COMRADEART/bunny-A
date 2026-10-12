import test from "node:test";
import assert from "node:assert/strict";
import { agentCommand } from "./agent-runtime.server.ts";
import { DevicePresence, deviceArtifactRead, deviceSnapshot, TEAM_ARTIFACT_DEVICE_LABEL, type DevicePrincipal } from "./device-authority.server.ts";
import type { HostSnapshot } from "./contracts.ts";
import { dashboardSnapshot } from "./presentation.ts";
import { ProjectService } from "./project-service.server.ts";
import { missionCommand } from "../bunny-missions/commands.server.ts";
import { missionOf, reachReview, PLAN, REQUIREMENTS, scripted, teamRows, teamSetup } from "./agent-team.fixture.ts";

const until = async <T,>(check: () => T | undefined | null | false, label: string): Promise<T> => {
  const started = Date.now();
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() - started > 30_000) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};
function matchingFields(value: unknown, privateText: (text: string) => boolean, path = ""): string[] {
  if (typeof value === "string") return privateText(value) ? [path] : [];
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, item]) => matchingFields(item, privateText, path ? `${path}.${key}` : key));
}

test("T11-SURF: real active/completed team device snapshots and artifact reads withhold Host paths and private working text", async () => {
  const markers = ["PRIVATE_REVIEW_SUMMARY", "PRIVATE_REVIEW_EVIDENCE", "PRIVATE_REVISION_NOTE", "PRIVATE_PLANNER_REJECTION", "http://127.0.0.1:9999", "PRIVATE_PLANNER_SUMMARY", "PRIVATE_RECOVERY_DIAGNOSTICS", "PRIVATE_PROVIDER_OUTPUT"];
  const env = await teamSetup("surfaces", { responder: (step, task, attempt) => step.team?.kind === "plan" ? JSON.stringify({ ...PLAN, summary: markers[5] }) : step.team?.kind === "review"
    ? JSON.stringify({ verdict: "changes_requested", findings: [{ requirement: "R1", severity: "advisory", summary: markers[0], evidence: markers[1] }] })
    : scripted(step, task, attempt) });
  try {
    const project = env.tasks.projects.register("Disposable surface review", env.root);
    env.agents.create({ objective: "Build an offline inventory dashboard from data/inventory.csv.", name: "Surface review", projectId: project.id,
      team: { requirements: REQUIREMENTS, outputDir: "team-out" } } as never, "workstation");
    const coordinator = teamRows(env).find((agent) => agent.team?.role === "coordinator")!;
    const missionId = coordinator.missionId!;
    await reachReview(env, coordinator.id, missionId);
    await agentCommand(env.agents, "agent.authorization.propose", { id: coordinator.id }, "workstation");
    const offered = env.missions.agentic.forMission(missionId)!;
    env.control.hold = true;
    await agentCommand(env.agents, "agent.authorization.approve", { id: coordinator.id, revision: offered.revision }, "workstation");
    await until(() => env.launched.some((launch) => launch.step?.team?.kind === "generate_json"), "two admitted member sessions under active team consent");
    const presence = new DevicePresence(env.db.db);
    const principal = { id: "phone", expiresAt: Date.now() + 30_000 } as DevicePrincipal;
    const snapshot = () => ({ ...env.tasks.snapshot(), agents: env.agents.snapshot(), missions: env.missions.snapshot() }) as HostSnapshot;
    const isPrivate = (text: string) => text.includes(env.dir) || markers.some((marker) => text.includes(marker));
    const activeModel = env.launched.find((launch) => launch.step?.team?.kind === "generate_json")!;
    activeModel.hooks.event("agent.output", `${markers[7]} ${env.root}`);
    const activeService = new ProjectService(env.missions, env.agents);
    assert.deepEqual(matchingFields(await activeService.command("project.get", { id: project.id }, false), isPrivate), [], "active provider transcript aliases stay on the workstation");
    const active = snapshot();
    assert.ok(matchingFields(active.agents, isPrivate).some((field) => field.includes("authorization.roots")), "the real active Host snapshot contains the path alias the device must mask");
    assert.deepEqual(matchingFields(dashboardSnapshot(deviceSnapshot(active, principal, presence)), isPrivate), []);

    env.control.hold = false;
    for (const launch of env.launched.filter((item) => item.step?.team?.kind !== "plan" && !item.stopped)) {
      const answer = scripted(launch.step!, launch.task, 1);
      assert.equal(typeof answer, "string");
      launch.finish({ ok: true, output: answer as string });
    }
    await until(() => missionOf(env, missionId).state === "completed", "real team delivery and Host verification finish");
    const finished = env.missions.store.mission(missionId);
    env.missions.setMission(finished, { recovery: { at: 1, detail: markers[6], interruptedSteps: [] }, team: { ...finished.team!, revisionNote: markers[2], browserFixture: markers[4], rejected: [{ at: 1, reasons: [markers[3]] }] } });
    const workstation = snapshot();
    assert.ok(matchingFields(workstation, isPrivate).length > 0, "workstation evidence remains available");
    const completedPhone = dashboardSnapshot(deviceSnapshot(workstation, principal, presence));
    assert.deepEqual(matchingFields(completedPhone, isPrivate), []);
    const projectService = new ProjectService(env.missions, env.agents);
    for (const [action, data] of [["project.list", {}], ["project.get", { id: project.id }]] as const) {
      const local = await projectService.command(action, data, true);
      assert.ok(matchingFields(local, isPrivate).length > 0, `${action} retains workstation context`);
      const remote = await projectService.command(action, data, false);
      assert.deepEqual(matchingFields(remote, isPrivate), [], `${action} follows the same device privacy boundary`);
    }

    // The actual project.artifact command handler is readable by a phone, then receives this Host-side projection.
    const service = new ProjectService(env.missions, env.agents);
    const working = env.missions.store.artifacts(missionId).filter((artifact) => artifact.verification === "verified" && ["review", "structured_result"].includes(artifact.type));
    assert.ok(working.some((artifact) => artifact.type === "review") && working.some((artifact) => artifact.type === "structured_result"));
    for (const artifact of working) {
      const read = await service.command("project.artifact", { projectId: project.id, artifactId: artifact.id }, false) as ReturnType<ProjectService["artifact"]>;
      assert.notEqual(read.body, TEAM_ARTIFACT_DEVICE_LABEL, "the canonical verified Host body still exists");
      const projected = deviceArtifactRead(read, (stepId) => !!env.missions.store.step(stepId).team);
      assert.equal(projected.body, TEAM_ARTIFACT_DEVICE_LABEL);
      assert.equal("path" in projected.artifact.location, false);
      assert.deepEqual(matchingFields(projected, isPrivate), []);
    }
    const delivery = env.missions.store.artifacts(missionId).find((artifact) => artifact.verification === "verified" && artifact.type === "source_file")!;
    const deliveryRead = service.artifact(project.id, delivery.id);
    assert.equal(deviceArtifactRead(deliveryRead, (stepId) => !!env.missions.store.step(stepId).team).body, deliveryRead.body, "verified deliverable previews remain readable");

    // Raw Mission detail includes memory, runs and events, so teams expose it only on the workstation.
    await assert.rejects(() => missionCommand(env.missions, "mission.get", { id: missionId }, { local: false, actor: "device:phone" }), /workstation|Windows Host/i);
    const local = await missionCommand(env.missions, "mission.get", { id: missionId }, { local: true, actor: "workstation" });
    assert.ok(matchingFields(local, isPrivate).length > 0);
  } finally { await env.cleanup(); }
});
