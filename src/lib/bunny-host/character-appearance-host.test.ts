import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startHost } from "./http.server.ts";
import { providerBase } from "./adapters.server.ts";
import { WEAPONS } from "./personal-agents.ts";
import { FilesystemCapability, GitCapability, TerminalCapability } from "../bunny-missions/capabilities/local.server.ts";
import type { ProviderAdapter } from "./contracts.ts";

/**
 * M-A-3 T13.3 Gate H at the real Host HTTP surface: a character style is presentation only. It never changes a Mission,
 * an owner, a profile, who answers or the Personal Agent configuration revision; devices draw it but cannot change it.
 * Disposable Hosts on disposable state directories, ports 43910-43912.
 */

type Body = Record<string, any>;
type Host = Awaited<ReturnType<typeof boot>>;

function neverLaunches(): ProviderAdapter {
  return {
    id: "claude",
    detect: async () => ({ ...providerBase("claude"), installed: true, authenticated: true, availability: "ready", capabilities: ["text"], current_model: "fixture" }),
    launch: () => {
      throw new Error("The appearance fixture must never launch a provider.");
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
  const instance = (host as any).instanceId ?? String(host.token).slice(0, 6);
  const traced = async (what: string, run: () => Promise<Response>) => {
    try {
      return await run();
    } catch (error: any) {
      throw new Error(`[diag] ${what} on Host ${instance} port ${port} at ${new Date().toISOString()}: ${error.message}; cause ${error.cause?.code ?? ""} ${error.cause?.name ?? ""} ${error.cause?.message ?? ""} socket ${JSON.stringify(error.cause?.socket ?? null)}`);
    }
  };
  const command = async (action: string, data: unknown = {}, token = host.token) => {
    const response = await traced(`command ${action}`, () => fetch(`${base}/command`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", connection: "close" },
      body: JSON.stringify({ action, data }),
    }));
    return { status: response.status, body: (await response.json()) as Body };
  };
  const state = async (token = host.token) => {
    const response = await traced("state", () => fetch(`${base}/state`, { headers: { authorization: `Bearer ${token}`, connection: "close" } }));
    return { status: response.status, body: (await response.json()) as Body };
  };
  const pair = async (name: string) => {
    const code = (await command("pairing.create")).body.pairCode;
    const response = await fetch(`${base}/pair`, { method: "POST", headers: { "content-type": "application/json", connection: "close" }, body: JSON.stringify({ code, name }) });
    assert.equal(response.status, 200);
    return (await response.json()) as { token: string; deviceId: string };
  };
  try {
    const enabled = await command("mission.configure", { enabled: true });
    assert.equal(enabled.status, 200, JSON.stringify(enabled.body));
  } catch (error) {
    // The caller never receives this Host, so close it here; a leaked Host keeps its port and state files open.
    await host.close();
    throw error;
  }
  return { host, command, state, pair, close: () => host.close() };
}

async function withHost(port: number, work: (h: Host, reboot: () => Promise<Host>) => Promise<void>) {
  const directory = mkdtempSync(join(tmpdir(), "bunny-t13-3-appearance-"));
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

const appearanceOf = (snapshot: Body, slot: number) => snapshot.characterAppearance.slots.find((row: Body) => row.slot === slot).appearance;
const contextOf = (snapshot: Body, slot: number) => snapshot.personalAgentContext.slots.find((row: Body) => row.slot === slot);

/** Everything a style change must leave alone: authority, ownership, identity, Missions, Agents and the slot config. */
const authority = (snapshot: Body) => ({
  revision: snapshot.personalAgents.revision,
  slots: snapshot.personalAgents.slots.map((row: Body) => ({ slot: row.slot, weapon: row.weapon, agent: row.agent?.id ?? null, state: row.presentation?.state })),
  foreground: snapshot.personalAgentContext.foreground,
  owned: snapshot.personalAgentContext.slots.map((row: Body) => row.owned.map((owned: Body) => [owned.agentId, owned.missionId])),
  profiles: snapshot.personalAgentContext.slots.map((row: Body) => row.profile),
  memories: snapshot.personalAgentContext.slots.map((row: Body) => row.memories.length),
  agents: snapshot.agents.agents.map((agent: Body) => [agent.id, agent.missionId, agent.pausedAt, agent.stoppedAt]),
  missions: snapshot.missions.missions.map((mission: Body) => [mission.id, mission.projectId ?? null]),
  lifecycle: snapshot.events.filter((event: Body) => /^(agent\.|mission\.|personal_agent\.(owner|foreground|profile))/.test(event.type)).length,
});

test("T13.3 H every weapon wears every style with no Mission, owner, identity or configuration change; it survives a restart", async () => {
  await withHost(43910, async (h, reboot) => {
    const delegated = await h.command("personal_agent.delegate", { slot: 1, objective: "Redesign the website", title: "Website" });
    assert.equal(delegated.status, 200, JSON.stringify(delegated.body));
    assert.equal((await h.command("personal_agent.foreground", { identity: 1 })).status, 200);
    const initial = (await h.state()).body;
    assert.equal(initial.characterAppearance.schema, "bunny-a.character-appearance.v1");
    for (const slot of [1, 2, 3, 4]) assert.deepEqual(appearanceOf(initial, slot), { style: null, intensity: "full", highContrast: false });
    const before = authority(initial);

    for (const slot of [1, 2, 3, 4]) {
      for (const style of ["glossy", "cel", "arcade", "comic", "pixel"]) {
        const set = await h.command("personal_agent.appearance", { slot, appearance: { style } });
        assert.equal(set.status, 200, JSON.stringify(set.body));
        assert.deepEqual(set.body.data, { slot, appearance: { style, intensity: "full", highContrast: false } });
      }
    }
    const styled = await h.command("personal_agent.appearance", { slot: 2, appearance: { style: "arcade", intensity: "subtle", highContrast: true } });
    assert.equal(styled.status, 200);
    const after = (await h.state()).body;
    assert.deepEqual(authority(after), before, "no authority, ownership, identity, Mission or Agent fact changed");
    assert.deepEqual(appearanceOf(after, 2), { style: "arcade", intensity: "subtle", highContrast: true });
    assert.deepEqual(appearanceOf(after, 1), { style: "pixel", intensity: "full", highContrast: false });
    assert.ok(after.events.some((event: Body) => event.type === "personal_agent.appearance" && /Personal Agent 2 appearance: Arcade\./.test(event.detail)));

    const restarted = (await (await reboot()).state()).body;
    assert.deepEqual(appearanceOf(restarted, 2), { style: "arcade", intensity: "subtle", highContrast: true }, "the preference persists per Agent");
    assert.deepEqual(appearanceOf(restarted, 4), { style: "pixel", intensity: "full", highContrast: false });
    assert.equal(contextOf(restarted, 1).owned.length, 1);
    assert.equal(restarted.personalAgentContext.foreground, 1);
  });
});

test("T13.3 H reset returns a slot to its signature; invalid or authority-shaped input is refused and changes nothing", async () => {
  await withHost(43911, async (h) => {
    assert.equal((await h.command("personal_agent.appearance", { slot: 3, appearance: { style: "comic", intensity: "off" } })).status, 200);
    const reset = await h.command("personal_agent.appearance_reset", { slot: 3 });
    assert.equal(reset.status, 200);
    assert.deepEqual(reset.body.data.appearance, { style: null, intensity: "full", highContrast: false });
    assert.ok((await h.state()).body.events.some((event: Body) => event.type === "personal_agent.appearance" && /Personal Agent 3 appearance: Arcade \(signature\)\./.test(event.detail)), "Vishnu Chakra's signature is Arcade");

    const refusals: [Body, RegExp][] = [
      [{ slot: 1, appearance: { style: "gold" } }, /Unsupported character style/],
      [{ slot: 1, appearance: { intensity: "turbo" } }, /intensity/],
      [{ slot: 1, appearance: { highContrast: 1 } }, /true or false/],
      [{ slot: 1, appearance: { style: "cel", permissions: "all" } }, /Unsupported appearance setting: permissions/],
      [{ slot: 1, appearance: { weapon: "sword" } }, /Unsupported appearance setting: weapon/],
      [{ slot: 1, appearance: null }, /object/],
      [{ slot: 9, appearance: { style: "cel" } }, /slot/i],
    ];
    for (const [data, message] of refusals) {
      const refused = await h.command("personal_agent.appearance", data);
      assert.equal(refused.status, 400, JSON.stringify(data));
      assert.equal(refused.body.code, "REFUSED");
      assert.match(refused.body.error, message);
    }
    const view = (await h.state()).body;
    for (const slot of [1, 2, 3, 4]) assert.deepEqual(appearanceOf(view, slot), { style: null, intensity: "full", highContrast: false });
    assert.equal(view.personalAgents.revision, 0);
  });
});

test("T13.3 H a weapon swap keeps the chosen look; a paired device draws the styles but cannot change them", async () => {
  await withHost(43912, async (h) => {
    assert.equal((await h.command("personal_agent.appearance", { slot: 1, appearance: { style: "pixel" } })).status, 200);
    const swapped = [1, 2, 3, 4].map((slot, index) => ({
      slot, weapon: slot === 1 ? "sword" : WEAPONS[index], displayName: "", description: "", purpose: "", style: "concise", responsibilities: [], agentId: null, active: true,
    }));
    swapped[3].weapon = "gada";
    const configured = await h.command("personal_agents.configure", { slots: swapped, expectRevision: 0 });
    assert.equal(configured.status, 200, JSON.stringify(configured.body));
    const view = (await h.state()).body;
    assert.equal(view.personalAgents.slots[0].weapon, "sword");
    assert.deepEqual(appearanceOf(view, 1), { style: "pixel", intensity: "full", highContrast: false }, "the slot keeps its chosen style");
    assert.equal(appearanceOf(view, 4).style, null, "an unchosen slot follows the new weapon's signature");

    const phone = await h.pair("T13.3 H disposable phone");
    for (const [action, data] of [
      ["personal_agent.appearance", { slot: 1, appearance: { style: "comic" } }],
      ["personal_agent.appearance_reset", { slot: 1 }],
    ] as const) {
      const refused = await h.command(action, data, phone.token);
      assert.equal(refused.status, 400, `${action} must be refused for a device`);
      assert.ok(["WORKSTATION_REQUIRED", "DEVICE_ACTION_DENIED", "REFUSED"].includes(refused.body.code) || /device|workstation/i.test(refused.body.error), JSON.stringify(refused.body));
    }
    const device = (await h.state(phone.token)).body;
    assert.equal(device.viewer.kind, "device");
    assert.deepEqual(appearanceOf(device, 1), { style: "pixel", intensity: "full", highContrast: false }, "the device draws the same look");
    assert.equal(device.personalAgentContext, undefined, "presentation reaches the device; context does not");
    assert.deepEqual(appearanceOf((await h.state()).body, 1), { style: "pixel", intensity: "full", highContrast: false });
  });
});
