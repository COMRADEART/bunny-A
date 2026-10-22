import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startHost } from "./http.server.ts";
import { providerBase } from "./adapters.server.ts";
import { FilesystemCapability, GitCapability, TerminalCapability } from "../bunny-missions/capabilities/local.server.ts";
import type { ProviderAdapter } from "./contracts.ts";

/**
 * M-A-3 T13.3 Gate B at the real Host HTTP surface: Personal Agent ownership, profile, foreground identity and
 * conversation. Each test runs a disposable Host on a disposable state directory, ports 43860-43869.
 */

type Body = Record<string, any>;
type Host = Awaited<ReturnType<typeof boot>>;

function neverLaunches(): ProviderAdapter {
  return {
    id: "claude",
    detect: async () => ({ ...providerBase("claude"), installed: true, authenticated: true, availability: "ready", capabilities: ["text"], current_model: "fixture" }),
    launch: () => {
      throw new Error("The Personal Agent context fixture must never launch a provider.");
    },
  };
}

async function boot(directory: string, port: number) {
  const root = join(directory, "project");
  mkdirSync(root, { recursive: true });
  const host = await startHost({
    dataDirectory: directory,
    root,
    port,
    adapters: [neverLaunches()],
    missions: { adapters: [new FilesystemCapability(), new TerminalCapability(), new GitCapability(directory)] },
  });
  const base = `http://127.0.0.1:${port}`;
  // One connection per request: a socket pooled by an earlier Host on this port is reset when that Host's deferred
  // socket close lands (hosted Windows, MA4-S1R3-CI2), so it must never carry the restarted Host's first request.
  const fresh = { connection: "close" };
  const command = async (action: string, data: unknown = {}, token = host.token) => {
    const response = await fetch(`${base}/command`, {
      method: "POST",
      headers: { ...fresh, authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ action, data }),
    });
    return { status: response.status, body: (await response.json()) as Body };
  };
  const state = async (token = host.token) => {
    const response = await fetch(`${base}/state`, { headers: { ...fresh, authorization: `Bearer ${token}` } });
    return { status: response.status, body: (await response.json()) as Body };
  };
  const pair = async (name: string) => {
    const code = (await command("pairing.create")).body.pairCode;
    const response = await fetch(`${base}/pair`, { method: "POST", headers: { ...fresh, "content-type": "application/json" }, body: JSON.stringify({ code, name }) });
    assert.equal(response.status, 200);
    return (await response.json()) as { token: string; deviceId: string };
  };
  try {
    const enabled = await command("mission.configure", { enabled: true });
    assert.equal(enabled.status, 200, JSON.stringify(enabled.body));
  } catch (error) {
    // The caller never receives this Host, so close it here: a leaked Host keeps its port, state files and the test
    // process alive (the MA4-S1R3 stage 2 hang).
    await host.close();
    throw error;
  }
  return { host, command, state, pair, close: () => host.close() };
}

async function withHost(port: number, work: (h: Host, reboot: () => Promise<Host>) => Promise<void>) {
  const directory = mkdtempSync(join(tmpdir(), "bunny-t13-3-context-"));
  let h: Host | undefined;
  try {
    h = await boot(directory, port);
    await work(h, async () => {
      await h!.close();
      h = await boot(directory, port);
      return h;
    });
  } finally {
    await h?.close();
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}

const delegate = async (h: Host, slot: number, objective: string, title: string) => {
  const result = await h.command("personal_agent.delegate", { slot, objective, title });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return result.body.data.agentId as string;
};
const contextOf = (snapshot: Body, slot: number) => snapshot.personalAgentContext.slots.find((row: Body) => row.slot === slot);

test("T13.3 B delegate admits through agent.create; one Personal Agent owns several Missions; everything survives a restart", async () => {
  await withHost(43860, async (h, reboot) => {
    const website = await delegate(h, 1, "Redesign my website landing page", "Website redesign");
    const docs = await delegate(h, 1, "Write the release documentation", "Release docs");
    const game = await delegate(h, 2, "Prototype the platformer level", "Game prototype");
    const view = (await h.state()).body;
    assert.deepEqual(contextOf(view, 1).owned.map((row: Body) => row.agentId), [website, docs], "Gada owns both of its Missions");
    assert.deepEqual(contextOf(view, 2).owned.map((row: Body) => row.agentId), [game]);
    assert.ok(contextOf(view, 1).owned.every((row: Body) => typeof row.missionId === "string"), "each owned Agent has its own Mission");
    assert.equal(view.personalAgents.slots[0].agent.id, website, "the first delegated Agent becomes the slot's focus");
    assert.equal(view.personalAgents.slots[1].agent.id, game);
    assert.ok(view.events.some((event: Body) => event.type === "personal_agent.owner"), "ownership is journaled");

    const profile = await h.command("personal_agent.profile", { slot: 1, expectRevision: 0, personality: "Patient, explains trade-offs", goals: ["Launch the website"], preferences: [{ key: "tone", value: "brief" }] });
    assert.equal(profile.status, 200, JSON.stringify(profile.body));
    assert.equal((await h.command("personal_agent.foreground", { identity: 1 })).status, 200);
    const said = await h.command("personal_agent.converse", { slot: 1, text: "Gada, what happened to the website?" });
    assert.equal(said.status, 200, JSON.stringify(said.body));
    assert.match(said.body.data.reply.text, /^Website redesign: /);
    assert.equal(said.body.data.reply.basis, "host-facts");

    const after = (await reboot()).state;
    const restarted = (await after()).body;
    assert.deepEqual(contextOf(restarted, 1).owned.map((row: Body) => row.agentId), [website, docs], "ownership survives the restart");
    assert.equal(contextOf(restarted, 1).profile.personality, "Patient, explains trade-offs");
    assert.equal(contextOf(restarted, 1).profile.revision, 1);
    assert.deepEqual(contextOf(restarted, 1).turns.map((turn: Body) => turn.role), ["user", "agent"]);
    assert.equal(restarted.personalAgentContext.foreground, 1, "the foreground identity survives the restart");
    for (const row of contextOf(restarted, 1).owned) assert.notEqual(row.state, "COMPLETED", "a restart never marks unfinished work complete");
  });
});

test("T13.3 B switching the foreground speaker never pauses, stops, transfers or cancels work", async () => {
  await withHost(43861, async (h) => {
    const gada = await delegate(h, 1, "Keep working on the website", "Website");
    const spear = await delegate(h, 2, "Keep working on the game", "Game");
    const before = (await h.state()).body;
    const lifecycle = (snapshot: Body) => snapshot.events.filter((event: Body) => /^(agent\.(paused|stopped|resumed)|mission\.(stopped|paused))/.test(event.type)).length;
    for (const identity of [1, 2, 3, 4, "bunny", 1]) {
      const switched = await h.command("personal_agent.foreground", { identity });
      assert.equal(switched.status, 200, JSON.stringify(switched.body));
    }
    const after = (await h.state()).body;
    assert.equal(after.personalAgentContext.foreground, 1);
    for (const id of [gada, spear]) {
      const row = after.agents.agents.find((agent: Body) => agent.id === id);
      assert.equal(row.pausedAt, null);
      assert.equal(row.stoppedAt, null);
      assert.ok(!["PAUSED", "STOPPED"].includes(row.state), `${id} keeps running state ${row.state}`);
    }
    assert.equal(lifecycle(after), lifecycle(before), "no pause/stop/resume event ran");
    assert.equal(after.missions.missions.length, before.missions.missions.length);
    assert.deepEqual(contextOf(after, 1).owned.map((row: Body) => row.agentId), [gada], "ownership is unchanged by speaking");
    assert.deepEqual(contextOf(after, 2).owned.map((row: Body) => row.agentId), [spear]);
    const bad = await h.command("personal_agent.foreground", { identity: "sword" });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.code, "REFUSED");
  });
});

test("T13.3 B a Personal Agent answers from its own Missions only; conversations stay per Agent", async () => {
  await withHost(43862, async (h) => {
    await delegate(h, 1, "Redesign the website", "Website redesign");
    await delegate(h, 2, "Secret game prototype", "Secret game prototype");
    const gada = await h.command("personal_agent.converse", { slot: 1, text: "how are you doing" });
    assert.equal(gada.status, 200);
    assert.match(gada.body.data.reply.text, /^Gada owns 1 Mission, 1 unfinished\. Website redesign: /);
    assert.doesNotMatch(gada.body.data.reply.text, /Secret game/, "Gada never reports Spear's Mission");
    const asked = await h.command("personal_agent.converse", { slot: 1, text: "what about the secret game prototype?" });
    assert.doesNotMatch(asked.body.data.reply.text, /Secret game/, "naming another Agent's Mission does not reveal it");
    const chakra = await h.command("personal_agent.converse", { slot: 3, text: "status" });
    assert.equal(chakra.body.data.reply.text, "Vishnu Chakra has no Missions yet.");
    const view = (await h.state()).body;
    assert.equal(contextOf(view, 1).turns.length, 4);
    assert.equal(contextOf(view, 2).turns.length, 0, "Spear's conversation is untouched");
    const secret = await h.command("personal_agent.converse", { slot: 1, text: "here is my password: hunter2" });
    assert.equal(secret.status, 400);
    assert.match(secret.body.error, /credential/);
    assert.equal(contextOf((await h.state()).body, 1).turns.length, 4, "a refused message is not stored");
  });
});

test("T13.3 B profile refuses stale revisions, smuggled fields and credentials; nothing changes on refusal", async () => {
  await withHost(43863, async (h) => {
    assert.equal((await h.command("personal_agent.profile", { slot: 2, expectRevision: 0, goals: ["Ship the game"] })).status, 200);
    const stale = await h.command("personal_agent.profile", { slot: 2, expectRevision: 0, goals: ["Other"] });
    assert.equal(stale.status, 400);
    assert.match(stale.body.error, /current revision 1/);
    const smuggled = await h.command("personal_agent.profile", { slot: 2, expectRevision: 1, model: "gpt", provider: "codex" });
    assert.equal(smuggled.status, 400);
    assert.match(smuggled.body.error, /Unsupported Personal Agent profile field/);
    const secret = await h.command("personal_agent.profile", { slot: 2, expectRevision: 1, preferences: [{ key: "github", value: "ghp_abcdefghijklmnopqrstuvwxyz0123" }] });
    assert.equal(secret.status, 400);
    const profile = contextOf((await h.state()).body, 2).profile;
    assert.equal(profile.revision, 1);
    assert.deepEqual(profile.goals, ["Ship the game"]);
    assert.deepEqual(profile.preferences, []);
  });
});

test("T13.3 B rebinding a slot in the Studio transfers ownership explicitly; assign accepts only user-facing Agents", async () => {
  await withHost(43864, async (h) => {
    const agentId = await delegate(h, 1, "Draft the website copy", "Website copy");
    const config = (await h.state()).body.personalAgents;
    const slots = config.slots.map((slot: Body) => ({
      slot: slot.slot, weapon: slot.weapon, displayName: slot.displayName, description: slot.description, purpose: slot.purpose,
      style: slot.style, responsibilities: slot.responsibilities, active: slot.active, agentId: slot.slot === 4 ? agentId : null,
    }));
    const moved = await h.command("personal_agents.configure", { slots, expectRevision: config.revision });
    assert.equal(moved.status, 200, JSON.stringify(moved.body));
    const view = (await h.state()).body;
    assert.deepEqual(contextOf(view, 1).owned, []);
    assert.deepEqual(contextOf(view, 4).owned.map((row: Body) => row.agentId), [agentId]);
    assert.ok(view.events.some((event: Body) => event.type === "personal_agent.owner" && /moved from Personal Agent 1 to 4/.test(event.detail)));
    const ghost = await h.command("personal_agent.assign", { slot: 2, agentId: "not-an-agent" });
    assert.equal(ghost.status, 400);
    assert.match(ghost.body.error, /your own Agents/);
    const back = await h.command("personal_agent.assign", { slot: 2, agentId });
    assert.equal(back.status, 200);
    const assigned = (await h.state()).body;
    assert.deepEqual(contextOf(assigned, 2).owned.map((row: Body) => row.agentId), [agentId]);
    assert.equal(assigned.personalAgents.slots[3].agent?.id ?? null, null, "the old slot stops focusing an Agent it no longer owns");

    // An unrelated Studio save keeps the assignment.
    const current = assigned.personalAgents;
    const renamed = await h.command("personal_agents.configure", {
      slots: current.slots.map((slot: Body) => ({
        slot: slot.slot, weapon: slot.weapon, displayName: slot.slot === 3 ? "Chakra" : slot.displayName, description: slot.description, purpose: slot.purpose,
        style: slot.style, responsibilities: slot.responsibilities, active: slot.active, agentId: slot.agent?.id ?? null,
      })),
      expectRevision: current.revision,
    });
    assert.equal(renamed.status, 200, JSON.stringify(renamed.body));
    const saved = (await h.state()).body;
    assert.deepEqual(contextOf(saved, 2).owned.map((row: Body) => row.agentId), [agentId]);
    assert.deepEqual(contextOf(saved, 4).owned, []);
  });
});

test("T13.3 B a paired device cannot use any Personal Agent context action and never receives the context", async () => {
  await withHost(43865, async (h) => {
    const agentId = await delegate(h, 1, "Workstation-owned work", "Workstation work");
    await h.command("personal_agent.converse", { slot: 1, text: "status" });
    const phone = await h.pair("T13.3 disposable phone");
    const attempts: [string, Body][] = [
      ["personal_agent.delegate", { slot: 2, objective: "From the phone" }],
      ["personal_agent.assign", { slot: 2, agentId }],
      ["personal_agent.profile", { slot: 1, personality: "phone edit" }],
      ["personal_agent.foreground", { identity: 2 }],
      ["personal_agent.converse", { slot: 1, text: "status" }],
    ];
    for (const [action, data] of attempts) {
      const refused = await h.command(action, data, phone.token);
      assert.equal(refused.status, 400, `${action} must be refused for a device`);
      assert.ok(["WORKSTATION_REQUIRED", "DEVICE_ACTION_DENIED", "REFUSED"].includes(refused.body.code) || /device|workstation/i.test(refused.body.error), `${action}: ${JSON.stringify(refused.body)}`);
    }
    const device = (await h.state(phone.token)).body;
    assert.equal(device.viewer.kind, "device");
    assert.equal(device.personalAgentContext, undefined, "conversation, preferences and ownership detail never reach a device");
    const workstation = (await h.state()).body;
    assert.equal(workstation.personalAgentContext.foreground, "bunny");
    assert.deepEqual(contextOf(workstation, 2).owned, []);
    assert.equal(contextOf(workstation, 1).profile.revision, 0);
    assert.equal(contextOf(workstation, 1).turns.length, 2, "no device turn was recorded");
  });
});
