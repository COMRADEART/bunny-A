import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { startHost } from "./http.server.ts";
import { providerBase } from "./adapters.server.ts";
import { UI_THEME_IDS } from "./ui-theme.ts";
import { FilesystemCapability, GitCapability, TerminalCapability } from "../bunny-missions/capabilities/local.server.ts";
import type { ProviderAdapter } from "./contracts.ts";

/**
 * Visual Experience 2.0 at the real Host HTTP surface: the UI theme is presentation configuration, never an
 * authorization principal. Switching through all 22 themes while Personal Agents own live Missions changes no Mission,
 * Agent, owner, profile, memory, foreground identity or configuration revision, writes only the theme row, survives a
 * restart, and is refused for a paired device. Disposable Hosts on disposable state directories, ports 43920-43922.
 */

type Body = Record<string, any>;
type Host = Awaited<ReturnType<typeof boot>>;

function neverLaunches(): ProviderAdapter {
  return {
    id: "claude",
    detect: async () => ({ ...providerBase("claude"), installed: true, authenticated: true, availability: "ready", capabilities: ["text"], current_model: "fixture" }),
    launch: () => {
      throw new Error("The theme fixture must never launch a provider.");
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
  const enabled = await command("mission.configure", { enabled: true });
  assert.equal(enabled.status, 200, JSON.stringify(enabled.body));
  return { host, command, state, pair, close: () => host.close() };
}

async function withHost(port: number, work: (h: Host, reboot: () => Promise<Host>, directory: string) => Promise<void>) {
  const directory = mkdtempSync(join(tmpdir(), "bunny-ve2-theme-"));
  let h: Host | undefined;
  try {
    h = await boot(directory, port);
    await work(h, async () => {
      await h!.close();
      h = await boot(directory, port);
      return h;
    }, directory);
  } finally {
    await h?.close();
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}

/** Every execution and context fact a theme change must leave alone. */
const authority = (snapshot: Body) => ({
  revision: snapshot.personalAgents.revision,
  slots: snapshot.personalAgents.slots.map((row: Body) => ({ slot: row.slot, weapon: row.weapon, agent: row.agent?.id ?? null, state: row.presentation?.state })),
  foreground: snapshot.personalAgentContext.foreground,
  owned: snapshot.personalAgentContext.slots.map((row: Body) => row.owned.map((owned: Body) => [owned.agentId, owned.missionId, owned.state])),
  profiles: snapshot.personalAgentContext.slots.map((row: Body) => row.profile),
  memories: snapshot.personalAgentContext.slots.map((row: Body) => row.memories.length),
  agents: snapshot.agents.agents.map((agent: Body) => [agent.id, agent.missionId, agent.state, agent.pausedAt, agent.stoppedAt]),
  missions: snapshot.missions.missions.map((mission: Body) => [mission.id, mission.state, mission.projectId ?? null]),
  tasks: snapshot.tasks.map((task: Body) => [task.id, task.state]),
  characterAppearance: snapshot.characterAppearance,
});
/** The snapshot's event list is a bounded newest-first window, so lifecycle history is counted in the journal itself. */
function lifecycle(directory: string) {
  const db = new DatabaseSync(join(directory, "host.sqlite"), { readOnly: true });
  try {
    return (db.prepare("SELECT type FROM events ORDER BY rowid").all() as { type: string }[]).filter((row) => !row.type.startsWith("appearance.")).map((row) => row.type);
  } finally {
    db.close();
  }
}

/** Row counts and contents of every table except the theme row and the append-only event journal. */
function tables(directory: string) {
  const db = new DatabaseSync(join(directory, "host.sqlite"), { readOnly: true });
  try {
    const out: Record<string, string> = {};
    for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[]) {
      // connection_accounts holds the Host's own background provider observations, which refresh on their own clock.
      if (name === "ui_theme_preference" || name === "events" || name === "connection_accounts" || name.startsWith("sqlite_")) continue;
      out[name] = JSON.stringify(db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all());
    }
    return out;
  } finally {
    db.close();
  }
}

test("VE2 every theme applies while all four Personal Agents own Missions, with no execution or context change, and persists", async () => {
  await withHost(43920, async (h, reboot, directory) => {
    for (const slot of [1, 2, 3, 4]) {
      const delegated = await h.command("personal_agent.delegate", { slot, objective: `Theme fixture work ${slot}`, title: `Mission ${slot}` });
      assert.equal(delegated.status, 200, JSON.stringify(delegated.body));
    }
    const initial = (await h.state()).body;
    assert.equal(initial.uiTheme.schema, "bunny-a.ui-theme.v1");
    assert.equal(initial.uiTheme.revision, 0);
    assert.equal(initial.uiTheme.preference.theme, "glass", "the system default is the accepted glass workspace");
    assert.ok(initial.personalAgentContext.slots.every((row: Body) => row.owned.length === 1), "all four Agents own a Mission");
    const before = authority(initial);
    const history = lifecycle(directory);

    let revision = 0;
    for (const theme of UI_THEME_IDS) {
      const set = await h.command("appearance.theme", { theme, variant: "dark", expectRevision: revision });
      assert.equal(set.status, 200, JSON.stringify(set.body));
      revision += 1;
      assert.equal(set.body.data.revision, revision);
      assert.equal(set.body.data.preference.theme, theme);
      assert.equal(set.body.data.notch.theme, theme);
    }
    const tuned = await h.command("appearance.theme", { theme: "swiss", accent: "#0047ff", density: "compact", transparency: "low", highContrast: true });
    assert.equal(tuned.status, 200, JSON.stringify(tuned.body));
    const after = (await h.state()).body;
    assert.deepEqual(authority(after), before, "no Mission, Agent, owner, profile, memory, identity or appearance fact changed");
    assert.deepEqual(lifecycle(directory).slice(0, history.length), history, "no lifecycle event was rewritten");
    assert.ok(lifecycle(directory).slice(history.length).every((type) => !/^(agent|mission|task|personal_agent)\./.test(type)), "no lifecycle event was caused by a theme change");
    assert.deepEqual(after.uiTheme.preference, { theme: "swiss", variant: "dark", accent: "#0047ff", density: "compact", transparency: "low", highContrast: true });
    assert.ok(after.events.some((event: Body) => event.type === "appearance.theme" && /Workstation theme: Swiss Design \(revision 23\)\./.test(event.detail)));

    const restarted = (await (await reboot()).state()).body;
    assert.deepEqual(restarted.uiTheme.preference, after.uiTheme.preference, "the theme survives a Host restart");
    assert.equal(restarted.uiTheme.revision, 23);
  });
});

test("VE2 a stale revision, an unknown theme or authority-shaped input is refused and changes nothing; reset restores the default", async () => {
  await withHost(43921, async (h, _reboot, directory) => {
    assert.equal((await h.command("appearance.theme", { theme: "pixel" })).status, 200);
    const before = tables(directory);
    const refusals: [Body, RegExp][] = [
      [{ theme: "pixel", expectRevision: 0 }, /changed since/],
      [{ theme: "hologram" }, /Unsupported theme/],
      [{ theme: "pixel", permissions: "all" }, /Unsupported theme setting: permissions/],
      [{ approvals: "phone" }, /Unsupported theme setting: approvals/],
      [{ accent: "javascript:alert(1)" }, /#rrggbb/],
      [{ accent: "#777777" }, /contrast/],
      [{ highContrast: "on" }, /true or false/],
      // Independent review finding 4: a malformed revision is refused, never treated as "no check".
      [{ theme: "minimal", expectRevision: "1" }, /expectRevision must be an integer/],
      [{ theme: "minimal", expectRevision: 1.5 }, /expectRevision must be an integer/],
    ];
    for (const [data, message] of refusals) {
      const refused = await h.command("appearance.theme", data);
      assert.equal(refused.status, 400, JSON.stringify(data));
      assert.equal(refused.body.code, "REFUSED");
      assert.match(refused.body.error, message);
    }
    const view = (await h.state()).body;
    assert.equal(view.uiTheme.preference.theme, "pixel");
    assert.equal(view.uiTheme.revision, 1);
    const changed = (now: Record<string, string>) => Object.keys({ ...now, ...before }).filter((name) => now[name] !== before[name]);
    assert.deepEqual(changed(tables(directory)), [], "a refused change writes nothing anywhere");

    const staleReset = await h.command("appearance.theme_reset", { expectRevision: 0 });
    assert.equal(staleReset.status, 400, "a reset from a stale window is refused like any stale write");
    assert.match(staleReset.body.error, /changed since/);
    assert.deepEqual(changed(tables(directory)), [], "a refused reset writes nothing");
    const reset = await h.command("appearance.theme_reset", { expectRevision: 1 });
    assert.equal(reset.status, 200);
    assert.equal(reset.body.data.preference.theme, "glass");
    // Review round 2: "system" follows Windows on the desktop and hands the native Notch back its own appearance setting.
    assert.equal(reset.body.data.preference.variant, "system");
    assert.equal(reset.body.data.notch.variant, "system");
    assert.equal(reset.body.data.revision, 2);
    assert.deepEqual(changed(tables(directory)), [], "a theme change writes only the theme row and the event journal");
  });
});

test("VE2 a damaged theme row reads back as the system default; a paired device sees the theme but cannot change it", async () => {
  await withHost(43922, async (h, reboot, directory) => {
    assert.equal((await h.command("appearance.theme", { theme: "cyberpunk" })).status, 200);
    const phone = await h.pair("VE2 disposable phone");
    for (const [action, data] of [["appearance.theme", { theme: "minimal" }], ["appearance.theme_reset", {}]] as const) {
      const refused = await h.command(action, data, phone.token);
      assert.equal(refused.status >= 400, true, `${action} must be refused for a device`);
      assert.ok(/workstation|device/i.test(refused.body.error ?? "") || ["WORKSTATION_REQUIRED", "DEVICE_ACTION_DENIED"].includes(refused.body.code), JSON.stringify(refused.body));
    }
    const device = (await h.state(phone.token)).body;
    assert.equal(device.viewer.kind, "device");
    assert.equal(device.uiTheme.preference.theme, "cyberpunk", "the device can draw the workstation's look");
    assert.equal((await h.state()).body.uiTheme.preference.theme, "cyberpunk");

    await h.close();
    const db = new DatabaseSync(join(directory, "host.sqlite"));
    db.prepare("UPDATE ui_theme_preference SET value=? WHERE id=1").run("{not json");
    db.close();
    const recovered = (await (await reboot()).state()).body;
    assert.equal(recovered.uiTheme.preference.theme, "glass", "a damaged row falls back to the default instead of failing the Host");
  });
});
