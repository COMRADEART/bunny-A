import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startHost } from "./http.server.ts";
import { providerBase } from "./adapters.server.ts";
import { connectionId } from "./connections.ts";
import type { HarnessProbe } from "./harnesses.ts";
import type { ProviderAdapter } from "./contracts.ts";

/**
 * M-A-3 T13.3 Gate E at the real Host HTTP surface: harness views, the stepped capability test, disable/enable/remove
 * through the T13.2 dispatch gate, restart and device refusal. The `--version` probe is a fixture. Ports 43890-43899.
 */

type Body = Record<string, any>;

function claudeFixture(): ProviderAdapter {
  return {
    id: "claude",
    detect: async () => ({ ...providerBase("claude"), installed: true, authenticated: true, availability: "ready", capabilities: ["text"], current_model: "fixture-model", executable: "C:\\fixture\\claude.exe", version: "2.1.299 (Claude Code)" }),
    launch: () => {
      throw new Error("The harness fixture must never launch a provider.");
    },
  };
}

const PROBES: Record<string, HarnessProbe> = {
  anthropic: { path: "C:\\fixture\\claude.exe", version: "2.1.299 (Claude Code)", runs: true, detail: 'Reported "2.1.299 (Claude Code)".' },
  cursor: { path: "C:\\fixture\\cursor-agent.exe", version: null, runs: false, detail: "It exited with code 1." },
};

async function boot(directory: string, port: number) {
  const root = join(directory, "project");
  mkdirSync(root, { recursive: true });
  const probed: string[] = [];
  const host = await startHost({
    dataDirectory: directory,
    root,
    port,
    adapters: [claudeFixture()],
    harnessProbe: async (entry) => {
      probed.push(entry.id);
      return PROBES[entry.id] ?? { path: null, version: null, runs: null, detail: `No ${entry.executables.join(" or ")} was found on this PC.` };
    },
  });
  const base = `http://127.0.0.1:${port}`;
  const command = async (action: string, data: unknown = {}, token = host.token) => {
    const response = await fetch(`${base}/command`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ action, data }) });
    return { status: response.status, body: (await response.json()) as Body };
  };
  const state = async (token = host.token) => (await (await fetch(`${base}/state`, { headers: { authorization: `Bearer ${token}` } })).json()) as Body;
  const pair = async () => {
    const code = (await command("pairing.create")).body.pairCode;
    return (await (await fetch(`${base}/pair`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, name: "Phone" }) })).json()) as { token: string };
  };
  return { host, command, state, pair, probed };
}

const ok = (result: { status: number; body: Body }) => {
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return result.body;
};
const harness = async (h: Awaited<ReturnType<typeof boot>>, id: string) => ((await h.state()).harnesses.harnesses as Body[]).find((row) => row.id === id)!;
const gate = (h: Awaited<ReturnType<typeof boot>>, provider: "claude" | "cursor") =>
  h.host.manager.connections.evaluate({ kind: "advice", provider, model: null, projectId: null, origin: "workstation", route: null });

test("T13.3 E harness views, stepped tests, and disable/enable/remove enforced by the dispatch gate", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bunny-t13-3-harness-"));
  let h = await boot(directory, 43890);
  try {
    const views = (await h.state()).harnesses.harnesses as Body[];
    assert.deepEqual(views.map((row) => row.id).sort(), ["anthropic", "cline", "copilot", "cursor", "gemini", "ollama", "openai", "opencode", "xai"]);
    const claude = views.find((row) => row.id === "anthropic")!;
    assert.deepEqual([claude.execution, claude.found, claude.version, claude.authentication], ["routable", true, "2.1.299 (Claude Code)", "signed_in"]);
    assert.deepEqual(claude.models, ["fixture-model"]);
    assert.equal(claude.install.install, "npm install -g @anthropic-ai/claude-code@2.1.299");
    assert.equal(views.find((row) => row.id === "cursor")!.execution, "detect_only");
    assert.equal(h.probed.length, 0, "viewing never runs a harness");

    const first = ok(await h.command("harness.test", { id: "anthropic" })).data.test as Body;
    assert.equal(first.verdict, "runs");
    assert.match(first.detail, /inference is not demonstrated/);
    const broken = ok(await h.command("harness.test", { id: "cursor" })).data.test as Body;
    assert.equal(broken.verdict, "found_not_running");
    assert.ok((await harness(h, "cursor")).warnings.some((line: string) => /did not run/.test(line)));
    assert.equal(ok(await h.command("harness.test", { id: "gemini" })).data.test.verdict, "not_found");

    const claudeRoute = connectionId("anthropic", "native_cli");
    h.host.manager.connections.settle(h.host.manager.connections.recordDispatch(claudeRoute, "task-fixture"), true);
    const proven = ok(await h.command("harness.test", { id: "anthropic" })).data.test as Body;
    assert.deepEqual([proven.verdict, proven.completedTasks], ["task_completed", 1]);

    assert.equal(gate(h, "cursor").ok, false);
    assert.equal((gate(h, "cursor") as Body).code, "MODE_NOT_DISPATCHABLE", "a detect-only harness never enters routing");
    assert.notEqual((gate(h, "claude") as Body).code, "CONNECTION_PAUSED");
    ok(await h.command("harness.disable", { id: "anthropic" }));
    assert.equal((await harness(h, "anthropic")).execution, "disabled");
    assert.equal((gate(h, "claude") as Body).code, "CONNECTION_PAUSED");
    ok(await h.command("harness.enable", { id: "anthropic" }));
    assert.equal((await harness(h, "anthropic")).execution, "routable");
    assert.notEqual((gate(h, "claude") as Body).code, "CONNECTION_PAUSED");

    // A route the owner paused separately stays paused through a harness disable and enable.
    ok(await h.command("connections.pause", { id: claudeRoute }));
    ok(await h.command("harness.disable", { id: "anthropic" }));
    ok(await h.command("harness.enable", { id: "anthropic" }));
    assert.equal((gate(h, "claude") as Body).code, "CONNECTION_PAUSED", "harness.enable resumes only what harness.disable paused");
    ok(await h.command("connections.resume", { id: claudeRoute }));
    assert.notEqual((gate(h, "claude") as Body).code, "CONNECTION_PAUSED");

    await h.host.close();
    h = await boot(directory, 43890);
    assert.equal((await harness(h, "cursor")).lastTest.verdict, "found_not_running", "tests persist across restart");
    assert.equal((await harness(h, "anthropic")).lastTest.verdict, "task_completed");

    ok(await h.command("harness.remove", { id: "anthropic" }));
    const removed = await harness(h, "anthropic");
    assert.equal(removed.lastTest, null);
    assert.ok(removed.routes.every((route: Body) => route.lifecycle === "disconnected" || route.support === "unsupported"));
    assert.equal((gate(h, "claude") as Body).code, "CONNECTION_DISCONNECTED");
    assert.equal((await h.command("harness.test", { id: "openrouter" })).status, 400, "an API is not a harness");

    const events = (await h.state()).events as Body[];
    for (const type of ["harness.tested", "harness.disabled", "harness.enabled", "harness.removed"]) assert.ok(events.some((event) => event.type === type), type);

    const phone = await h.pair();
    for (const action of ["harness.test", "harness.disable", "harness.enable", "harness.remove"])
      assert.equal((await h.command(action, { id: "openai" }, phone.token)).body.code, "WORKSTATION_REQUIRED", action);
    assert.equal((await h.state(phone.token)).harnesses, undefined, "devices never see harness paths or tests");
  } finally {
    await h.host.close();
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});
