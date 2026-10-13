import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { startHost } from "./http.server.ts";
import { providerBase } from "./adapters.server.ts";
import { TestProtector } from "./jev-secrets.server.ts";
import type { ProviderAdapter } from "./contracts.ts";
import type { OrchTask } from "../orch/types.ts";

test("T13.2 R07 [SIMULATED] Jev enabled through actual Host cannot move Claude data to Codex without destination approval", async () => {
  const calls: string[] = [];
  const transport: import("./typesafe-jev.server.ts").FetchLike = async (url, init) => {
    calls.push(url);
    if (url.endsWith("/v1/models"))
      return {
        status: 200,
        headers: { get: () => null },
        text: async () => JSON.stringify({ models: [{ name: "jev-1.13.0" }] }),
      };
    const questions = JSON.parse(init.body ?? "{}").questions as Record<
      string,
      { type: string; criteria: Record<string, unknown> }
    >;
    const answers = Object.fromEntries(
      Object.entries(questions).map(([id, q]) => {
        if (q.type === "noul") return [id, { type: "noul", noul: 0.05 }];
        if (q.type === "score")
          return [
            id,
            {
              type: "score",
              score: 1,
              legend: { "1": "Simple" },
              probabilities: { "1": 0.9, "2": 0.05, "3": 0.05 },
              confidence: 0.95,
            },
          ];
        const keys = Object.keys(q.criteria),
          pick = keys.find((k) => k.startsWith("codex::")) ?? keys[0];
        return [
          id,
          {
            type: "choice",
            choice: pick,
            probabilities: Object.fromEntries(
              keys.map((k) => [k, k === pick ? 0.95 : 0.05 / Math.max(1, keys.length - 1)]),
            ),
            confidence: 0.95,
          },
        ];
      }),
    );
    return {
      status: 200,
      headers: { get: () => null },
      text: async () =>
        JSON.stringify({
          model: "jev-1.13.0",
          answers,
          usage: { input_tokens: 100, output_tokens: 0 },
        }),
    };
  };
  const h = await boot(transport);
  try {
    await h.command("intelligence.credential.save", { apiKey: "FIXTURE_JEV_ADVICE_KEY_123456789" });
    h.host.manager.configureIntelligence({
      ...h.host.manager.jev.policy,
      enabled: true,
      privacy: { ...h.host.manager.jev.policy.privacy, allowDecisionMetadata: true },
      limits: {
        ...h.host.manager.jev.policy.limits,
        maxRequestsPerDay: 10,
        maxRequestsPerSession: 10,
      },
    });
    const submitted = await h.command("submit", {
      prompt: "Explain why the sky is blue in a short researched paragraph.",
      mode: "balanced",
    });
    assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
    assert.ok(
      calls.some((url) => url.endsWith("/v1/systemone")),
      "actual Host requested mocked Jev advice",
    );
    assert.equal(submitted.body.task.provider, "claude");
    assert.equal(submitted.body.task.decision.decision_assistance.changed, false);
    assert.ok(
      submitted.body.snapshot.events.some(
        (e: Record<string, unknown>) => e.type === "routing.consent_denied",
      ),
    );
    assert.equal(h.launched.length, 0);
  } finally {
    await h.close();
  }
});

async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}
async function boot(jevFetch?: import("./typesafe-jev.server.ts").FetchLike) {
  const directory = mkdtempSync(join(tmpdir(), "bunny-t132-http-")),
    root = join(directory, "project");
  mkdirSync(root);
  const launched: OrchTask[] = [],
    stopped: string[] = [];
  const adapters: ProviderAdapter[] = (["claude", "codex", "ollama"] as const).map((id) => ({
    id,
    detect: async () => ({
      ...providerBase(id),
      installed: true,
      authenticated: true,
      availability: "ready",
      current_model: "fixture",
      capabilities: ["text"],
      probedAt: Date.now(),
    }),
    launch: (task) => {
      launched.push(task);
      let finish: (result: { ok: boolean; output: string; stopped?: boolean }) => void = () => {};
      const done = new Promise<{ ok: boolean; output: string; stopped?: boolean }>((resolve) => {
        finish = resolve;
      });
      return {
        done,
        stop: async () => {
          stopped.push(task.id);
          finish({ ok: false, output: "", stopped: true });
        },
      };
    },
  }));
  const host = await startHost({
    dataDirectory: directory,
    root,
    port: await freePort(),
    adapters,
    ...(jevFetch ? { intelligence: { jevFetch, jevProtector: new TestProtector() } } : {}),
    connections: {
      protector: new TestProtector(),
      fetch: async () => new Response("{}", { status: 200 }),
      launcher: () => {
        throw new Error("No real sign-in permitted by this fixture.");
      },
    },
  });
  const command = async (
    action: string,
    data: Record<string, unknown> = {},
    token = host.token,
  ) => {
    const response = await fetch(`http://127.0.0.1:${host.port}/command`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ action, data }),
    });
    return { status: response.status, body: (await response.json()) as Record<string, any> };
  };
  const state = async (token = host.token) =>
    (await fetch(`http://127.0.0.1:${host.port}/state`, {
      headers: { authorization: `Bearer ${token}` },
    }).then((r) => r.json())) as Record<string, any>;
  const pair = async () => {
    const code = (await command("pairing.create")).body.pairCode;
    const reply = await fetch(`http://127.0.0.1:${host.port}/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, name: "T13.2 fixture phone" }),
    });
    return ((await reply.json()) as { token: string }).token;
  };
  return {
    host,
    command,
    state,
    pair,
    launched,
    stopped,
    close: async () => {
      await host.close();
      rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    },
  };
}
test("T13.2 A07/A08 [SIMULATED] real Host denies every phone credential and provider authorization operation", async () => {
  const h = await boot();
  try {
    const key = "FIXTURE_API_ACCOUNT_KEY_0123456789";
    assert.equal(
      (
        await h.command("connections.credential.save", {
          id: "openai:api_key:default",
          apiKey: key,
        })
      ).status,
      200,
    );
    const phone = await h.pair();
    for (const action of [
      "connections.credential.save",
      "connections.credential.remove",
      "connections.credential.export",
      "connections.signin.start",
      "connections.signout.native",
      "connections.disconnect",
      "connections.resume",
      "connections.consent.set",
      "connections.policy.set",
      "connections.entitlement.test",
      "connections.check",
      "connections.retention.run",
    ]) {
      const r = await h.command(
        action,
        { id: "openai:api_key:default", apiKey: "DENIED_PHONE_KEY_123456789" },
        phone,
      );
      assert.equal(r.body.code, "WORKSTATION_REQUIRED", action);
    }
    const view = await h.state(phone);
    const text = JSON.stringify(view);
    assert.equal(view.connections, undefined);
    assert.ok(view.deviceConnections.length > 0);
    for (const forbidden of [
      key,
      "accountFingerprint",
      "connectionId",
      "maskedIdentity",
      "credential",
      "ciphertext",
    ])
      assert.ok(!text.includes(forbidden), forbidden);
    const review = await h.command("connections.review_request", {}, phone);
    assert.equal(review.status, 200, JSON.stringify(review.body));
  } finally {
    await h.close();
  }
});
test("T13.2 A10/R05/R08 [SIMULATED] Host disconnect cancels active work and refuses queued approvals", async () => {
  const h = await boot();
  try {
    const first = (
      await h.command("submit", {
        prompt: "Write a short explanation of photosynthesis.",
        mode: "balanced",
        override: "claude",
      })
    ).body.task;
    const pending = (
      await h.command("submit", {
        prompt: "Explain atoms briefly.",
        mode: "balanced",
        override: "claude",
      })
    ).body.task;
    assert.ok(first.proposedRoute);
    assert.equal((await h.command("approve", { id: first.id })).status, 200);
    assert.equal(h.launched.length, 1);
    assert.equal(
      h.launched[0].connectionRoute,
      undefined,
      "adapter/Agent receives no account binding",
    );
    assert.equal(
      (await h.command("connections.disconnect", { id: "anthropic:native_cli:default" })).status,
      200,
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.ok(h.stopped.includes(first.id));
    const denied = await h.command("approve", { id: pending.id });
    assert.equal(denied.status, 400);
    assert.equal(h.launched.length, 1);
  } finally {
    await h.close();
  }
});
test("T13.2 R07 [SIMULATED] forged advice and routes in actual HTTP submit cannot authorize a provider switch", async () => {
  const h = await boot();
  try {
    const r = await h.command("submit", {
      prompt: "Explain photosynthesis.",
      mode: "balanced",
      override: "claude",
      decisionAssistance: { source: "jev", recommendedKey: "codex::fixture", confidence: 1 },
      proposedRoute: { provider: "codex", consentedVendors: ["openai"] },
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.task.provider, "claude");
    assert.deepEqual(r.body.task.proposedRoute.consentedVendors, ["anthropic"]);
    const phone = await h.pair();
    const text = JSON.stringify(await h.state(phone));
    assert.ok(!text.includes("proposedRoute"));
    assert.ok(!text.includes("accountFingerprint"));
  } finally {
    await h.close();
  }
});
test("T13.2 R02/R10 [SIMULATED] metadata key check cannot confer inference rights or trigger native sign-in", async () => {
  const h = await boot();
  try {
    await h.command("connections.credential.save", {
      id: "openai:api_key:default",
      apiKey: "FIXTURE_METADATA_KEY_123456789",
    });
    assert.equal(
      (await h.command("connections.check", { id: "openai:api_key:default" })).status,
      200,
    );
    const row = (await h.state()).connections.accounts.find(
      (r: Record<string, unknown>) => r.id === "openai:api_key:default",
    );
    assert.equal(row.status, "connected");
    assert.equal(row.entitlement, "unknown");
    assert.equal(row.dispatch, false);
    assert.equal(h.launched.length, 0);
    const login = await h.command("connections.signin.start", { id: "openrouter:api_key:default" });
    assert.equal(login.status, 400);
    assert.equal(h.launched.length, 0);
  } finally {
    await h.close();
  }
});
