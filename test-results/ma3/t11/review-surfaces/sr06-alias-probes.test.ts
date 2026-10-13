import test from "node:test";
import assert from "node:assert/strict";
import { ProjectService } from "../../../../src/lib/bunny-host/project-service.server.ts";
import { deviceTask } from "../../../../src/lib/bunny-host/device-authority.server.ts";
import { PLAN, REQUIREMENTS, scripted, reachReview, teamSetup, teamRows, approvePlan, until } from "../../../../src/lib/bunny-host/agent-team.fixture.ts";

const matches = (value: unknown, marker: string, path = ""): string[] => typeof value === "string" ? value.includes(marker) ? [path] : []
  : value && typeof value === "object" ? Object.entries(value).flatMap(([key, item]) => matches(item, marker, path ? `${path}.${key}` : key)) : [];

test("SR06-ALIAS: remote project.get must mask planner-origin summary aliases", async () => {
  const marker = "PRIVATE_PLANNER_SUMMARY_SR06";
  const env = await teamSetup("sr06-alias", { responder: (step, task, attempt) => step.team?.kind === "plan"
    ? JSON.stringify({ ...PLAN, summary: `${marker}: C:/private-host/project-data` }) : scripted(step, task, attempt) });
  try {
    const project = env.tasks.projects.register("Surface alias probe", env.root);
    env.agents.create({ objective: "Build the inventory dashboard.", name: "Alias review", projectId: project.id, team: { requirements: REQUIREMENTS, outputDir: "team-out" } } as never, "workstation");
    const coordinator = teamRows(env).find(agent => agent.team?.role === "coordinator")!;
    await reachReview(env, coordinator.id, coordinator.missionId!);
    const service = new ProjectService(env.missions, env.agents);
    const remote = await service.command("project.get", { id: project.id }, false);
    const leaked = matches(remote, marker);
    console.log(JSON.stringify({ probe: "SR06-ALIAS", leakedFields: leaked }));
    assert.deepEqual(leaked, [], "Remote Project detail must not publish unfiltered model planner summary text");
  } finally { await env.cleanup(); }
});

test("SR06-EVENT-ALIAS: remote project.get must mask provider-output aliases on active team Tasks", async () => {
  const marker = "PRIVATE_PROVIDER_OUTPUT_SR06";
  const env = await teamSetup("sr06-event-alias");
  try {
    const project = env.tasks.projects.register("Surface event alias probe", env.root);
    env.agents.create({ objective: "Build the inventory dashboard.", name: "Event alias review", projectId: project.id, team: { requirements: REQUIREMENTS, outputDir: "team-out" } } as never, "workstation");
    const coordinator = teamRows(env).find(agent => agent.team?.role === "coordinator")!;
    await reachReview(env, coordinator.id, coordinator.missionId!);
    env.control.hold = true;
    await approvePlan(env, coordinator.id, coordinator.missionId!);
    const active = await until(() => env.launched.find(launch => launch.step?.team?.kind === "generate_json"), "active team model");
    active.hooks.event("agent.output", `${marker}: ${env.root}`);
    const service = new ProjectService(env.missions, env.agents);
    const remote = await service.command("project.get", { id: project.id }, false);
    const leaked = matches(remote, marker);
    console.log(JSON.stringify({ probe: "SR06-EVENT-ALIAS", leakedFields: leaked }));
    assert.deepEqual(leaked, [], "Remote Project detail must not publish provider output via latest activity");
  } finally { await env.cleanup(); }
});

test("SR06-WORKINGDIR-ALIAS: device task projection removes workingDirectory without changing canonical context", () => {
  const marker = "C:/private-host/project-context";
  const canonical = { prompt: "Read project context.", mission: null, routingPrompt: undefined, cwd: marker, constraints: { workingDirectory: marker } };
  const projected = deviceTask(canonical);
  assert.deepEqual(matches(projected, marker), []);
  assert.equal(canonical.constraints.workingDirectory, marker);
});
