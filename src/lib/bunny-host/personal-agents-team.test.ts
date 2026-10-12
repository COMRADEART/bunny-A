import test from "node:test";
import assert from "node:assert/strict";
import { defaultPersonalAgentsConfig, isUserFacingAgent, projectPersonalAgents } from "./personal-agents.ts";
import { createTeam, teamRows, teamSetup } from "./agent-team.fixture.ts";

test("T13: a team member whose Mission facts fail to load stays internal — never bindable, never a weapon", async () => {
  const env = await teamSetup("t13-member-identity");
  try {
    const { coordinatorId } = createTeam(env);
    const before = teamRows(env);
    const members = before.filter((agent) => agent.team && agent.team.role !== "coordinator");
    assert.ok(members.length > 0, "the team has at least one internal member");
    // Simulate unreadable Mission evidence: every runtime-facts lookup now throws, as an unknown/corrupt Mission row would.
    const original = env.missions.get.bind(env.missions);
    env.missions.get = (() => { throw new Error("Unknown mission."); }) as typeof env.missions.get;
    try {
      const rows = teamRows(env);
      for (const member of members) {
        const row = rows.find((agent) => agent.id === member.id)!;
        assert.equal(row.authorization, null, "the fault path was taken");
        assert.equal(row.team?.role, member.team!.role, "team identity survives the fault path");
        assert.equal(isUserFacingAgent(row), false);
      }
      const coordinatorRow = rows.find((agent) => agent.id === coordinatorId)!;
      assert.equal(coordinatorRow.team?.role, "coordinator");
      assert.equal(isUserFacingAgent(coordinatorRow), true);
      const config = defaultPersonalAgentsConfig();
      const projected = projectPersonalAgents({ config, agents: rows, missions: [], tasks: [], now: Date.now() });
      const bindable = new Set(projected.bindable.map((agent) => agent.id));
      for (const member of members) assert.equal(bindable.has(member.id), false, `${member.team!.role} is never bindable`);
      assert.equal(bindable.has(coordinatorId), true);
    } finally {
      env.missions.get = original;
    }
  } finally {
    await env.cleanup();
  }
});
