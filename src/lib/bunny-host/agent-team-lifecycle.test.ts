import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { agentCommand } from "./agent-runtime.server.ts";
import { approvePlan, createTeam, missionOf, reachReview, teamRows, teamSetup } from "./agent-team.fixture.ts";

const until = async <T,>(check: () => T | undefined | null | false, label: string, timeout = 30_000): Promise<T> => {
  const started = Date.now();
  for (;;) {
    const result = check();
    if (result) return result;
    if (Date.now() - started >= timeout) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 100));

test("T11-LC-01: Coordinator pause recorded during a scheduler yield blocks the next new team admission", async () => {
  const env = await teamSetup("lc01");
  try {
    const { coordinatorId, missionId } = createTeam(env);
    await reachReview(env, coordinatorId, missionId);
    env.control.hold = true;
    await approvePlan(env, coordinatorId, missionId);
    // The first read is admitted synchronously; tickOnce yields before the independent documenter step.
    const ticking = env.missions.tickOnce(missionId);
    const admittedRead = missionOf(env, missionId).steps.find((step) => step.team?.key === "t1")!;
    assert.equal(admittedRead.state, "running");
    env.agents.pause(coordinatorId, "workstation");
    await ticking;
    await until(() => missionOf(env, missionId).steps.find((step) => step.id === admittedRead.id)?.state === "completed", "the previously admitted read finishes");
    await settle();
    assert.equal(env.agents.store.agentFlags(coordinatorId).paused, true);
    assert.equal(env.launched.some((launch) => launch.step?.team?.kind === "generate_markdown"), false, "no new model session begins after Pause");
    assert.equal(missionOf(env, missionId).steps.find((step) => step.team?.key === "t3")!.attempts.length, 0);
  } finally { await env.cleanup(); }
});

test("T11-LC-02: member Stop during a scheduler yield blocks that member and preserves other admitted work", async () => {
  const env = await teamSetup("lc02");
  try {
    const { coordinatorId, missionId } = createTeam(env);
    await reachReview(env, coordinatorId, missionId);
    const documenter = teamRows(env).find((agent) => agent.team?.role === "documenter")!;
    env.control.hold = true;
    await approvePlan(env, coordinatorId, missionId);
    const ticking = env.missions.tickOnce(missionId);
    await env.agents.stop(documenter.id, "workstation");
    await ticking;
    await settle();
    assert.equal(env.agents.store.agentFlags(documenter.id).stopped, true);
    assert.equal(env.agents.store.agentFlags(coordinatorId).stopped, false);
    assert.equal(env.launched.some((launch) => launch.step?.team?.kind === "generate_markdown"), false);
    assert.equal(missionOf(env, missionId).steps.find((step) => step.team?.key === "t1")!.state, "completed");
    assert.throws(() => env.agents.resume(documenter.id, "workstation"), /stopped|not paused/i);
  } finally { await env.cleanup(); }
});

test("T11-LC-03: member consent commands refuse before mutation; Coordinator revoke stops every admitted team session", async () => {
  const env = await teamSetup("lc03");
  try {
    const { coordinatorId, missionId } = createTeam(env);
    await reachReview(env, coordinatorId, missionId);
    await agentCommand(env.agents, "agent.authorization.propose", { id: coordinatorId }, "workstation");
    const offered = env.missions.agentic.forMission(missionId)!;
    env.control.hold = true;
    await agentCommand(env.agents, "agent.authorization.approve", { id: coordinatorId, revision: offered.revision }, "workstation");
    await until(() => env.launched.some((launch) => launch.step?.team?.kind === "generate_json"), "both independent team model sessions are admitted");
    const member = teamRows(env).find((agent) => agent.team?.role === "reviewer")!;
    const active = env.missions.agentic.forMission(missionId)!;
    const sessions = env.launched.filter((launch) => launch.step?.team?.kind !== "plan");
    assert.equal(sessions.length, 2);
    for (const action of ["propose", "approve", "adjust", "deny", "revoke"])
      await assert.rejects(() => agentCommand(env.agents, `agent.authorization.${action}`, { id: member.id, revision: active.revision, patch: { capabilities: [] } }, "workstation"), /Coordinator/i);
    assert.deepEqual(env.missions.agentic.forMission(missionId), active, "a member command changes no shared consent field");
    assert.ok(sessions.every((session) => !session.stopped), "a refused command changes no admitted work");
    assert.equal(env.agents.store.agentFlags(member.id).stopped, false);
    await agentCommand(env.agents, "agent.authorization.revoke", { id: coordinatorId, revision: active.revision }, "workstation");
    assert.equal(env.missions.agentic.forMission(missionId)!.current_state, "REVOKED");
    assert.equal(missionOf(env, missionId).state, "stopped");
    assert.ok(sessions.every((session) => session.stopped));
    assert.ok(teamRows(env).every((agent) => agent.state === "STOPPED" || agent.state === "COMPLETED"));
  } finally { await env.cleanup(); }
});

test("T11-LC-04: direct approval of a real pending team child honors member and Coordinator Pause", async () => {
  const env = await teamSetup("lc04");
  try {
    const { coordinatorId, missionId } = createTeam(env);
    await reachReview(env, coordinatorId, missionId);
    env.control.hold = true;
    await approvePlan(env, coordinatorId, missionId);
    // A canonical reduced provider-session budget creates the ordinary provider.execute approval request.
    const envelope = env.missions.get(missionId).authorization!;
    env.missions.store.saveAuthorization({ ...envelope, providers: { ...envelope.providers, sessions: { ...envelope.providers.sessions!, maxSessions: 0 } } });
    const pending = await until(() => missionOf(env, missionId).steps.find((step) => step.team?.key === "t3" && step.state === "waiting_for_approval" && step.taskId), "documenter child awaiting a real direct approval");
    const documenter = teamRows(env).find((agent) => agent.team?.role === "documenter")!;
    assert.equal(env.tasks.db.get(pending.taskId!).state, "waiting_for_approval");
    env.agents.pause(documenter.id, "workstation");
    assert.throws(() => env.tasks.approve(pending.taskId!), /paused|Pause/i);
    assert.equal(env.tasks.db.get(pending.taskId!).state, "waiting_for_approval");
    assert.equal(env.launched.some((launch) => launch.task.id === pending.taskId), false);
    env.agents.resume(documenter.id, "workstation");
    env.agents.pause(coordinatorId, "workstation");
    assert.throws(() => env.tasks.approve(pending.taskId!), /paused|Pause/i);
    assert.equal(env.agents.store.agentFlags(coordinatorId).paused, true);
    assert.equal(env.launched.some((launch) => launch.task.id === pending.taskId), false);
  } finally { await env.cleanup(); }
});

test("T11-LC-05: restart after a team write landed verifies the same bytes without repeating the effect", async () => {
  let env = await teamSetup("lc05");
  try {
    const { coordinatorId, missionId } = createTeam(env);
    await reachReview(env, coordinatorId, missionId);
    const request = env.missions.bus.request.bind(env.missions.bus);
    let landed = false;
    env.missions.bus.request = async (input) => {
      const result = await request(input);
      if (input.action === "filesystem.write" && input.params.path === "team-out/index.html") {
        landed = result.run?.status === "succeeded";
        return new Promise<never>(() => {}); // Simulate restart before the caller consumes the successful result.
      }
      return result;
    };
    await approvePlan(env, coordinatorId, missionId);
    const destination = join(env.root, "team-out", "index.html");
    await until(() => landed && existsSync(destination), "write landed while its Mission step remains running");
    const before = readFileSync(destination, "utf8");
    const writes = () => env.missions.store.runs({ missionId, limit: 500 }).filter((run) => run.action === "filesystem.write" && run.params.path === "team-out/index.html").length;
    const beforeWrites = writes();
    assert.equal(beforeWrites, 1);
    env = await env.reopen();
    await until(() => missionOf(env, missionId).state === "completed", "team completes after one Coordinator reconciliation");
    assert.equal(readFileSync(destination, "utf8"), before);
    assert.equal(writes(), beforeWrites, "recovery writes no duplicate bytes");
    assert.match(missionOf(env, missionId).steps.find((step) => step.team?.key === "t5")!.result!.summary, /reconciled from disk.*not repeated/i);
    const recovered = env.db.events().filter((event) => event.type === "agent.recovered" && event.missionId === missionId).map((event) => JSON.parse(event.detail) as { agentId: string; scope?: string });
    assert.equal(recovered.filter((event) => event.agentId === coordinatorId).length, 1);
    assert.ok(recovered.filter((event) => event.agentId !== coordinatorId).every((event) => event.scope === "member"));
  } finally { await env.cleanup(); }
});
