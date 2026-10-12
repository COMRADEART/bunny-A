import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { startHost } from "./http.server.ts";
import { providerBase } from "./adapters.server.ts";
import { FilesystemCapability, GitCapability, TerminalCapability } from "../bunny-missions/capabilities/local.server.ts";
import type { ProviderAdapter } from "./contracts.ts";

/**
 * M-A-3 T13: the Personal Agent slot command at the real Host HTTP surface. Each test runs its own disposable Host on
 * a disposable state directory and a port in the 43820-43829 range reserved for these fixtures.
 */

type Body = Record<string, any>;
type Host = Awaited<ReturnType<typeof boot>>;
const WEAPONS = ["gada", "spear", "chakra", "sword"] as const;

function slots(bindings: Record<number, string> = {}, names: Record<number, string> = {}) {
  return [1, 2, 3, 4].map((slot, index) => ({
    slot,
    weapon: WEAPONS[index],
    displayName: names[slot] ?? "",
    description: "",
    purpose: "",
    style: "concise",
    responsibilities: [],
    agentId: bindings[slot] ?? null,
    active: true,
  }));
}

/** A provider that never launches: these tests create Agents and slots only, never a provider run. */
function neverLaunches(): ProviderAdapter {
  return {
    id: "claude",
    detect: async () => ({ ...providerBase("claude"), installed: true, authenticated: true, availability: "ready", capabilities: ["text"], current_model: "fixture" }),
    launch: () => {
      throw new Error("The Personal Agent fixture must never launch a provider.");
    },
  };
}

async function boot(directory: string, port: number) {
  // The project folder is a child of the state directory, as in the other Host fixtures, so cleanup never races it.
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
  const command = async (action: string, data: unknown = {}, token = host.token) => {
    const response = await fetch(`${base}/command`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ action, data }),
    });
    return { status: response.status, body: (await response.json()) as Body };
  };
  const state = async (token = host.token) => {
    const response = await fetch(`${base}/state`, { headers: { authorization: `Bearer ${token}` } });
    return { status: response.status, body: (await response.json()) as Body };
  };
  const pair = async (name: string) => {
    const code = (await command("pairing.create")).body.pairCode;
    const response = await fetch(`${base}/pair`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, name }) });
    assert.equal(response.status, 200);
    return (await response.json()) as { token: string; deviceId: string };
  };
  // Agents are created through the Mission layer, which is off until the workstation enables it.
  const enabled = await command("mission.configure", { enabled: true });
  assert.equal(enabled.status, 200, JSON.stringify(enabled.body));
  return { host, command, state, pair, close: () => host.close() };
}

/** A bound slot shows the presentation its own Agent state maps to in the same snapshot, never a guessed state. */
function assertFollowsAgentState(slot: { agent: { state: string }; presentation: { state: string; basis: unknown } }) {
  const agentState = slot.agent.state;
  assert.ok(agentState === "CREATED" || agentState === "PLANNING", `unexpected Agent state ${agentState}`);
  assert.equal(slot.presentation.state, agentState === "CREATED" ? "IDLE" : "PLANNING");
  assert.deepEqual(slot.presentation.basis, { kind: "agent-state", agentState });
}

function fixtureDirectory() {
  return mkdtempSync(join(tmpdir(), "bunny-t13-personal-"));
}

function cleanup(directory: string) {
  rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}

test("T13 configure saves the four slots durably: a Host restart on the same state reads them back", async () => {
  const directory = fixtureDirectory();
  const port = 43820;
  let h: Host | undefined;
  try {
    h = await boot(directory, port);
    const created = await h.command("agent.create", { objective: "Research the release notes" });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const agentId = created.body.snapshot.personalAgents.bindable[0].id as string;
    assert.ok(agentId, "the user-facing Agent is bindable");

    const saved = await h.command("personal_agents.configure", { slots: slots({ 1: agentId }, { 1: "Research Gada" }), expectRevision: 0 });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    const view = saved.body.snapshot.personalAgents;
    assert.equal(view.revision, 1);
    assert.equal(view.slots[0].displayName, "Research Gada");
    assert.equal(view.slots[0].agent.id, agentId);
    // Planning starts asynchronously after creation, so the slot must follow the Agent state of the same snapshot.
    assertFollowsAgentState(view.slots[0]);
    assert.equal(view.slots[1].presentation.state, "UNASSIGNED");
    await h.close();

    h = await boot(directory, port);
    const restarted = (await h.state()).body.personalAgents;
    assert.equal(restarted.revision, 1, "the revision survives the restart");
    assert.equal(restarted.slots[0].displayName, "Research Gada");
    assert.equal(restarted.slots[0].agent.id, agentId, "the binding survives the restart");
    assertFollowsAgentState(restarted.slots[0]);
    await h.close();
  } finally {
    // A failed assertion must not leave a Host running on the directory it is about to remove.
    await h?.close();
    cleanup(directory);
  }
});

test("T13 configure refuses a stale view, an invalid binding and malformed slots; nothing changes on refusal", async () => {
  const directory = fixtureDirectory();
  const port = 43821;
  let h: Host | undefined;
  try {
    h = await boot(directory, port);
    const created = await h.command("agent.create", { objective: "Write the summary" });
    const agentId = created.body.snapshot.personalAgents.bindable[0].id as string;
    const first = await h.command("personal_agents.configure", { slots: slots({ 2: agentId }), expectRevision: 0 });
    assert.equal(first.status, 200);
    assert.equal(first.body.snapshot.personalAgents.revision, 1);

    const stale = await h.command("personal_agents.configure", { slots: slots(), expectRevision: 0 });
    assert.equal(stale.status, 400);
    assert.match(stale.body.error, /changed since this view was loaded \(current revision 1\)/);
    assert.equal((await h.state()).body.personalAgents.revision, 1, "a refused stale write leaves the revision alone");

    const unknownAgent = await h.command("personal_agents.configure", { slots: slots({ 3: "agent-that-does-not-exist" }), expectRevision: 1 });
    assert.equal(unknownAgent.status, 400);
    assert.match(unknownAgent.body.error, /own Agents/);

    const extraKey = slots();
    (extraKey[0] as Record<string, unknown>).permissions = "all";
    const smuggled = await h.command("personal_agents.configure", { slots: extraKey, expectRevision: 1 });
    assert.equal(smuggled.status, 400);
    assert.match(smuggled.body.error, /Unsupported Personal Agent field: permissions/);

    const three = await h.command("personal_agents.configure", { slots: slots().slice(0, 3), expectRevision: 1 });
    assert.equal(three.status, 400);
    assert.match(three.body.error, /Exactly four/);

    const unchanged = (await h.state()).body.personalAgents;
    assert.equal(unchanged.revision, 1);
    assert.equal(unchanged.slots[1].agent.id, agentId, "the earlier valid binding is still the only one");

    const current = await h.command("personal_agents.configure", { slots: slots({ 2: agentId }), expectRevision: 1 });
    assert.equal(current.status, 200);
    assert.equal(current.body.snapshot.personalAgents.revision, 2, "a current view saves and bumps the revision");
    await h.close();
  } finally {
    // A failed assertion must not leave a Host running on the directory it is about to remove.
    await h?.close();
    cleanup(directory);
  }
});

test("T13 configure is workstation-only: a paired device is refused and reads the same slots read-only", async () => {
  const directory = fixtureDirectory();
  const port = 43822;
  let h: Host | undefined;
  try {
    h = await boot(directory, port);
    const created = await h.command("agent.create", { objective: "Phone-visible work" });
    const agentId = created.body.snapshot.personalAgents.bindable[0].id as string;
    const saved = await h.command("personal_agents.configure", { slots: slots({ 1: agentId }, { 1: "Phone Gada" }), expectRevision: 0 });
    assert.equal(saved.status, 200);

    const phone = await h.pair("T13 disposable phone");
    const refused = await h.command("personal_agents.configure", { slots: slots(), expectRevision: 1 }, phone.token);
    assert.equal(refused.status, 400);
    assert.equal(refused.body.code, "WORKSTATION_REQUIRED");
    assert.equal((await h.state()).body.personalAgents.revision, 1, "the refused device write changed nothing");

    const view = await h.state(phone.token);
    assert.equal(view.body.viewer.kind, "device");
    assert.equal(view.body.personalAgents.schema, "bunny-a.personal-agents.v1");
    assert.equal(view.body.personalAgents.revision, 1);
    assert.equal(view.body.personalAgents.slots.length, 4);
    assert.equal(view.body.personalAgents.slots[0].displayName, "Phone Gada");
    assert.equal(view.body.personalAgents.slots[0].agent.id, agentId);
    assert.equal(view.body.voice, undefined, "voice stays workstation-only and absent on devices");
    assert.deepEqual(view.body.personalAgents.bindable, [], "a device never receives the list of Agents it could bind");
    await h.close();
  } finally {
    // A failed assertion must not leave a Host running on the directory it is about to remove.
    await h?.close();
    cleanup(directory);
  }
});

test("T13 the save is journaled and touches no Agent or Mission; the schema and user_version are unchanged", async () => {
  const directory = fixtureDirectory();
  const port = 43823;
  let h: Host | undefined;
  try {
    h = await boot(directory, port);
    const created = await h.command("agent.create", { objective: "Keep my own state" });
    const agentId = created.body.snapshot.personalAgents.bindable[0].id as string;
    const before = await h.state();
    const agentBefore = before.body.agents.agents.find((row: { id: string }) => row.id === agentId);
    const dbPath = join(directory, "host.sqlite");
    const schemaOf = () => {
      const db = new DatabaseSync(dbPath);
      try {
        return {
          schema: db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name").all(),
          version: db.prepare("PRAGMA user_version").get()?.user_version,
        };
      } finally {
        db.close();
      }
    };
    const schemaBefore = schemaOf();

    const saved = await h.command("personal_agents.configure", { slots: slots({ 4: agentId }, { 4: "Sword sentry" }), expectRevision: 0 });
    assert.equal(saved.status, 200);

    const after = await h.state();
    const agentAfter = after.body.agents.agents.find((row: { id: string }) => row.id === agentId);
    assert.equal(agentAfter.state, agentBefore.state, "the Agent keeps its state");
    assert.equal(agentAfter.updatedAt, agentBefore.updatedAt, "the Agent row is not written");
    assert.equal(after.body.missions.missions.length, before.body.missions.missions.length, "no Mission was created or changed");
    const agentOrMissionEvents = after.body.events.filter((event: { type: string }) => /^(agent|mission)\./.test(event.type) && event.type !== "agent.create" && event.type !== "agent.created");
    const beforeEvents = before.body.events.filter((event: { type: string }) => /^(agent|mission)\./.test(event.type) && event.type !== "agent.create" && event.type !== "agent.created");
    assert.equal(agentOrMissionEvents.length, beforeEvents.length, "no agent or mission action ran");
    const journaled = after.body.events.find((event: { type: string }) => event.type === "personal_agents.configured");
    assert.ok(journaled, "the configure is journaled");
    assert.match(journaled.detail, /revision 1 saved; 1 of 4 slots bound/);

    const schemaAfter = schemaOf();
    assert.deepEqual(schemaAfter.schema, schemaBefore.schema, "no table, index or trigger was added");
    assert.equal(schemaAfter.version, schemaBefore.version, "user_version is not bumped");
    await h.close();
  } finally {
    // A failed assertion must not leave a Host running on the directory it is about to remove.
    await h?.close();
    cleanup(directory);
  }
});

test("T13 the personal agents projection rides on the workstation snapshot before any device redaction", async () => {
  const directory = fixtureDirectory();
  const port = 43824;
  let h: Host | undefined;
  try {
    h = await boot(directory, port);
    const workstation = await h.state();
    assert.equal(workstation.body.personalAgents.revision, 0, "a fresh Host reports the default, unbound slots");
    assert.equal(workstation.body.personalAgents.slots.length, 4);
    assert.ok(workstation.body.personalAgents.slots.every((slot: { presentation: { state: string } }) => slot.presentation.state === "UNASSIGNED"));
    assert.deepEqual(workstation.body.personalAgents.bindable, []);
    assert.equal(workstation.body.personalAgents.unslottedAgents, 0);
    await h.close();
  } finally {
    // A failed assertion must not leave a Host running on the directory it is about to remove.
    await h?.close();
    cleanup(directory);
  }
});
