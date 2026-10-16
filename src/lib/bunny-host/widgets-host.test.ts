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
 * Widget layout at the Host HTTP surface. Presentation only: a paired phone can read the layout and cannot write it,
 * a forged action is refused, and saving a layout while Personal Agents own Missions does not touch those Missions.
 */

type Body = Record<string, any>;

function neverLaunches(): ProviderAdapter {
  return {
    id: "claude",
    detect: async () => ({ ...providerBase("claude"), installed: true, authenticated: true, availability: "ready", capabilities: ["text"], current_model: "fixture" }),
    launch: () => { throw new Error("The widget fixture must never launch a provider."); },
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
    return (await response.json()) as { token: string };
  };
  assert.equal((await command("mission.configure", { enabled: true })).status, 200);
  return { command, state, pair, close: () => host.close() };
}

test("widget layout persists, rejects a stale window and a phone write, and leaves Missions alone", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bunny-widgets-"));
  const host = await boot(directory, 43930);
  try {
    for (const slot of [1, 2, 3, 4]) {
      const delegated = await host.command("personal_agent.delegate", { slot, objective: `Widget fixture ${slot}`, title: `Mission ${slot}` });
      assert.equal(delegated.status, 200, JSON.stringify(delegated.body));
    }
    const initial = (await host.state()).body;
    assert.equal(initial.widgets.schema, "bunny-a.widgets.v1");
    assert.equal(initial.widgets.revision, 0);
    assert.equal(initial.widgets.preference.layout, "board");
    const before = initial.missions.missions.map((mission: Body) => [mission.id, mission.state]);

    const saved = await host.command("widgets.layout", { layout: "sidebar", expectRevision: 0 });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.snapshot.widgets.revision, 1);
    assert.equal(saved.body.snapshot.widgets.preference.layout, "sidebar");

    const stale = await host.command("widgets.layout", { layout: "drawer", expectRevision: 0 });
    assert.equal(stale.status, 400);
    assert.match(stale.body.error, /changed since/);
    const forged = await host.command("widgets.execute", { command: "task.reconcile" });
    assert.equal(forged.status, 400);
    assert.notEqual(forged.body.snapshot?.widgets?.preference?.layout, "drawer");
    assert.ok(forged.body.code === "FAILED" || forged.body.code === "REFUSED");
    const injected = await host.command("widgets.layout", { layout: "board", focus: { projectId: "<script>", slot: null }, expectRevision: 1 });
    assert.equal(injected.status, 400);

    const phone = await host.pair("Widget phone");
    const refused = await host.command("widgets.layout", { layout: "drawer" }, phone.token);
    assert.equal(refused.status, 400);
    assert.equal(refused.body.code, "WORKSTATION_REQUIRED");
    const device = (await host.state(phone.token)).body;
    assert.equal(device.widgets.preference.layout, "sidebar", "a phone may draw the workstation layout");
    assert.equal(device.personalAgentContext, undefined);
    assert.equal(device.sessionLedger, undefined);
    assert.equal(device.voice, undefined);

    const themed = await host.command("appearance.theme", { theme: "wabisabi" });
    assert.equal(themed.status, 200);
    const after = (await host.state()).body;
    assert.equal(after.widgets.preference.layout, "sidebar", "a theme change does not reset the widget layout");
    assert.deepEqual(after.missions.missions.map((mission: Body) => [mission.id, mission.state]), before);
    assert.equal(after.uiTheme.preference.theme, "wabisabi");

    const reset = await host.command("widgets.reset", { expectRevision: after.widgets.revision });
    assert.equal(reset.status, 200, JSON.stringify(reset.body));
    assert.equal(reset.body.snapshot.widgets.preference.layout, "board");
    assert.deepEqual((await host.state()).body.missions.missions.map((mission: Body) => [mission.id, mission.state]), before);
  } finally {
    await host.close();
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});
