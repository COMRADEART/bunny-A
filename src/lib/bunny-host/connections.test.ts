import test from "node:test";
import assert from "node:assert/strict";
import { HostDatabase } from "./persistence.server.ts";
import { ConnectionRegistry } from "./connections.server.ts";
import {
  CONNECTION_CATALOG,
  DEFAULT_ROUTING_POLICY,
  evaluateDispatch,
  maskIdentity,
  parseAccountIntent,
  scrubChildEnvironment,
  type ConnectionView,
  type DispatchRequest,
} from "./connections.ts";
import { providerBase, codexLaunchArgs } from "./adapters.server.ts";
import { TestProtector } from "./jev-secrets.server.ts";
import { pruneUsage } from "./usage-retention.server.ts";
import { JevService } from "./typesafe-jev.server.ts";
import { JevSecretStore } from "./jev-secrets.server.ts";
import { ClaudeNormalizer } from "./events.ts";
import { classifyTranscript } from "./voice/voice-intent.ts";
import type { OrchTask } from "../orch/types.ts";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { spawnSession } from "./adapters.server.ts";
import type { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function fixture() {
  const db = new HostDatabase(":memory:");
  const registry = new ConnectionRegistry({
    db,
    emit: () => {},
    protector: new TestProtector(),
    launcher: () => {
      throw new Error("Native launch fixture not supplied");
    },
    fetch: async () => new Response("{}", { status: 200 }),
  });
  registry.ingestProviderLive(
    ["claude", "codex", "ollama"].map((id) => ({
      ...providerBase(id as "claude"),
      installed: true,
      authenticated: true,
      availability: "ready" as const,
      probedAt: Date.now(),
    })),
    (id) =>
      id === "ollama"
        ? null
        : {
            principal: `${id}@example.com`,
            method: id === "claude" ? "claude.ai" : "chatgpt",
            plan: "fixture",
          },
  );
  return {
    db,
    registry,
    close: () => {
      registry.close();
      db.db.close();
    },
  };
}
function request(
  f: ReturnType<typeof fixture>,
  patch: Partial<DispatchRequest> = {},
): DispatchRequest {
  return {
    kind: "launch",
    provider: "claude",
    model: "fixture",
    projectId: null,
    origin: "workstation",
    route: f.registry.bind("claude", "fixture"),
    ...patch,
  };
}

for (const [phrase, catalog] of [
  ["Bunny, connect my Claude account", "anthropic"],
  ["connect my Claude Code account", "anthropic"],
  ["connect open code", "opencode"],
  ["check my Ollama account", "ollama"],
])
  test(`T13.2 A01 [SIMULATED] account intent ${catalog}: ${phrase}`, () =>
    assert.equal(parseAccountIntent(phrase)?.catalog, catalog));
test("T13.2 A01/A04 [SIMULATED] email, password and compound requests never authenticate", () => {
  for (const p of [
    "person@example.com",
    "connect my Claude account and delete files",
    "connect my password",
    "connect my verification code",
  ])
    assert.equal(parseAccountIntent(p), null);
});
test("T13.2 A05 [SIMULATED] unknown authorization cannot dispatch", () => {
  const f = fixture();
  try {
    const row = f.registry
      .views()
      .find((r) => r.catalog === "anthropic" && r.mode === "native_cli")!;
    const verdict = evaluateDispatch(
      request(f),
      [{ ...row, session: "unknown" }],
      DEFAULT_ROUTING_POLICY,
      { requestsToday: {}, usdToday: {} },
    );
    assert.equal(verdict.ok, false);
  } finally {
    f.close();
  }
});
test("T13.2 R05 [SIMULATED] actual dispatch without an approval binding fails closed", () => {
  const f = fixture();
  try {
    const v = f.registry.evaluate(request(f, { route: null }));
    assert.equal(v.ok, false);
    if (!v.ok) assert.equal(v.code, "STALE_AUTHORITY");
  } finally {
    f.close();
  }
});
test("T13.2 R06 [SIMULATED] Claude to Codex recommendation and final dispatch require destination consent", () => {
  const f = fixture();
  try {
    for (const kind of ["launch", "retry", "reroute", "escalate"] as const) {
      const v = f.registry.evaluate(request(f, { kind, provider: "codex" }));
      assert.equal(v.ok, false);
      if (!v.ok) assert.equal(v.code, "CROSS_VENDOR_SWITCH");
    }
    const v = f.registry.evaluate(
      request(f, { kind: "advice", provider: "codex", route: null, routerVendor: "anthropic" }),
    );
    assert.equal(v.ok, false);
  } finally {
    f.close();
  }
});
test("T13.2 R05/R06 [SIMULATED] explicit destination allowlist permits the exact switch", async () => {
  const f = fixture();
  try {
    await f.registry.command(
      "connections.policy.set",
      { policy: { ...f.registry.policy(), switchAllowlist: ["openai"] } },
      "workstation",
    );
    assert.equal(f.registry.evaluate(request(f, { provider: "codex" })).ok, true);
  } finally {
    f.close();
  }
});
test("T13.2 A10/R08 [SIMULATED] disconnect revokes queued work and stops future use", async () => {
  const f = fixture();
  try {
    const r = request(f);
    let revoked = false;
    f.registry.onRevoked(() => (revoked = true));
    await f.registry.command(
      "connections.disconnect",
      { id: r.route!.connectionId },
      "workstation",
    );
    assert.equal(revoked, true);
    assert.equal(f.registry.evaluate(r).ok, false);
    await f.registry.command("connections.resume", { id: r.route!.connectionId }, "workstation");
    assert.equal(f.registry.evaluate(r).ok, false);
  } finally {
    f.close();
  }
});
test("T13.2 R05 [SIMULATED] consent revision changes invalidate previously reviewed Tasks", async () => {
  const f = fixture();
  try {
    const r = request(f),
      row = f.registry.views().find((x) => x.id === r.route!.connectionId)!;
    await f.registry.command(
      "connections.consent.set",
      { id: row.id, consent: { ...row.consent, projects: ["project-only"] } },
      "workstation",
    );
    assert.equal(f.registry.evaluate(r).ok, false);
    assert.equal(f.registry.evaluate(request(f, { projectId: "other" })).ok, false);
  } finally {
    f.close();
  }
});
test("T13.2 A06/R08 [SIMULATED] provider account switching never silently adopts a new principal", () => {
  const f = fixture();
  try {
    const r = request(f);
    f.registry.ingestProviderLive(
      [{ ...providerBase("claude"), installed: true, authenticated: true, availability: "ready" }],
      () => ({ principal: "other@example.com", method: "claude.ai" }),
    );
    assert.equal(f.registry.evaluate(r).ok, false);
    assert.equal(
      f.registry.views().find((x) => x.id === r.route!.connectionId)!.session,
      "account_switched",
    );
  } finally {
    f.close();
  }
});
test("T13.2 A07 [SIMULATED] key storage persists ciphertext and never exports opaque handles", async () => {
  const f = fixture();
  try {
    const key = "FIXTURE_CONNECTION_KEY_abcdefghij";
    await f.registry.command(
      "connections.credential.save",
      { id: "openai:api_key:second", apiKey: key },
      "workstation",
    );
    const row = f.db.db.prepare("SELECT * FROM connection_credentials").get()!;
    assert.ok(!Buffer.from(row.ciphertext as Uint8Array).includes(Buffer.from(key)));
    const state = JSON.stringify(f.registry.snapshot());
    assert.ok(!state.includes(key));
    assert.ok(!state.includes(String(row.handle)));
    assert.equal(
      f.registry.views().find((x) => x.id === "openai:api_key:second")!.status,
      "not_connected",
    );
  } finally {
    f.close();
  }
});
test("T13.2 A08/A09 [SIMULATED] phone and Agent principals cannot mutate connection authority", async () => {
  const f = fixture();
  try {
    for (const actor of ["device:paired", "agent:worker", "mission:actor"])
      await assert.rejects(
        f.registry.command(
          "connections.credential.save",
          { id: "openai:api_key:default", apiKey: "FIXTURE_DENIED_SECRET_1234" },
          actor,
        ),
        /WORKSTATION_REQUIRED/,
      );
  } finally {
    f.close();
  }
});
test("T13.2 A07/A08 [SIMULATED] device projection contains no identity, workspace, key status or handles", () => {
  const f = fixture();
  try {
    const state = JSON.stringify(f.registry.deviceView());
    for (const field of [
      "accountFingerprint",
      "maskedIdentity",
      "maskedWorkspace",
      "connectionId",
      "credential",
      "handle",
      "example.com",
    ])
      assert.ok(!state.includes(field), field);
  } finally {
    f.close();
  }
});
test("T13.2 R01/R03/R10 [STATIC VERIFIED] unsupported identity, API and detect-only modes never dispatch", () => {
  for (const entry of CONNECTION_CATALOG)
    for (const mode of entry.modes)
      if (mode.mode === "identity" || mode.support !== "implemented")
        assert.equal(mode.dispatch, false, `${entry.id}:${mode.mode}`);
  assert.ok(CONNECTION_CATALOG.some((e) => e.id === "opencode"));
  assert.ok(CONNECTION_CATALOG.some((e) => e.id === "ollama"));
});
test("T13.2 R04/N02 [SIMULATED] ambient billing credentials and injection variables are stripped case-insensitively", () => {
  const { env, stripped } = scrubChildEnvironment({
    Path: "safe",
    anthropic_api_key: "fixture",
    OPENAI_BASE_URL: "https://evil.invalid",
    NODE_OPTIONS: "evil",
    CODEX_HOME: "wrong",
    WSLENV: "wrong",
    AWS_ACCESS_KEY_ID: "wrong",
    CUSTOM_TOKEN: "wrong",
  });
  assert.deepEqual(env, { Path: "safe" });
  assert.equal(stripped.length, 7);
});
test("T13.2 R04 [SIMULATED] unexpected Claude API billing trips the connection and prevents retry", () => {
  const f = fixture();
  try {
    const r = request(f);
    assert.equal(f.registry.observeBillingSource(r.route!.connectionId, "env"), "mismatch");
    assert.equal(f.registry.evaluate(r).ok, false);
    assert.equal(
      new ClaudeNormalizer().normalize({ type: "system", subtype: "init", apiKeySource: "env" })[0]
        .billingSource,
      "env",
    );
  } finally {
    f.close();
  }
});
test("T13.2 R09 [SIMULATED] local inference remains available with no connected cloud account", async () => {
  const f = fixture();
  try {
    for (const id of ["anthropic:native_cli:default", "openai:native_cli:default"])
      await f.registry.command("connections.disconnect", { id }, "workstation");
    assert.equal(
      f.registry.evaluate(
        request(f, {
          provider: "ollama",
          model: "qwen:local",
          route: f.registry.bind("ollama", "qwen:local"),
        }),
      ).ok,
      true,
    );
  } finally {
    f.close();
  }
});
test("T13.2 R11 [SIMULATED] paid ceilings cannot be bypassed using missing usage", () => {
  const f = fixture();
  try {
    const row = f.registry
      .views()
      .find((x) => x.catalog === "anthropic" && x.mode === "native_cli")!;
    const paid: ConnectionView = {
      ...row,
      billing: "api_billed",
      consent: { ...row.consent, billingOptIn: true, maxRequestsPerDay: 2, maxUsdPerDay: 1 },
    };
    assert.equal(
      evaluateDispatch(request(f), [paid], DEFAULT_ROUTING_POLICY, {
        requestsToday: {},
        usdToday: {},
      }).ok,
      false,
    );
  } finally {
    f.close();
  }
});
test("T13.2 N02/N03 [STATIC VERIFIED] Codex provider is pinned for scoped and direct Tasks", () => {
  for (const scope of [undefined, { access: "read" as const }]) {
    const args = codexLaunchArgs({
      cwd: process.cwd(),
      model: "fixture",
      executionScope: scope,
    } as OrchTask);
    assert.ok(args.includes('model_provider="openai"'));
    assert.ok(!args.includes("--dangerously-bypass-approvals-and-sandbox"));
  }
});
test("T13.2 N06 [SIMULATED] voice account journey opens settings without credential authority", () => {
  assert.equal(classifyTranscript("connect my Claude Code account").kind, "account");
  assert.equal(
    classifyTranscript("connect my Claude account and run rm -rf").kind,
    "sensitive_refused",
  );
});
test("T13.2 A04 [SIMULATED] masking always hides at least one account character", () => {
  assert.equal(maskIdentity("a@x.com"), "***@x.com");
  assert.equal(maskIdentity("al@x.com"), "a***@x.com");
});
test("T13.2 N07/R12 [SIMULATED] pruning preserves exact Jev budget reads, current session and newest historic request", () => {
  const db = new HostDatabase(":memory:");
  try {
    const now = Date.now();
    db.db.exec("CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL)");
    const jev = new JevService(db, new JevSecretStore(db, new TestProtector()), {
      sessionId: "current",
      now: () => now,
    });
    const insert = db.db.prepare(
      "INSERT INTO jev_usage(at,session_id,kind,answered_by,input_tokens,output_tokens,latency_ms,outcome) VALUES(?,?,'decision','jev-1.13.0',10,0,3,'ok')",
    );
    insert.run(now - 50 * 86400000, "old");
    insert.run(now - 45 * 86400000, "old");
    insert.run(now - 40 * 86400000, "current");
    const before = jev.usage();
    const first = pruneUsage(db, { days: 30, sessionId: "current", now, batch: 1 });
    assert.equal(first.removed, 1);
    assert.deepEqual(jev.usage(), before);
    const next = pruneUsage(db, { days: 30, sessionId: "current", now });
    assert.deepEqual(jev.usage(), before);
    assert.equal(next.removed, 1);
    assert.equal(pruneUsage(db, { days: 30, sessionId: "current", now }).removed, 0);
    assert.equal(
      (db.db.prepare("SELECT SUM(requests) AS n FROM usage_rollups").get() as { n: number }).n,
      2,
    );
  } finally {
    db.db.close();
  }
});

test("T13.2 R05/R08 [SIMULATED] switching back cannot adopt a different previously approved account", async () => {
  const f = fixture();
  try {
    await f.registry.command(
      "connections.policy.set",
      { policy: { ...f.registry.policy(), switchAllowlist: ["openai", "anthropic"] } },
      "workstation",
    );
    const r = request(f),
      target = f.registry.bind("codex", "fixture")!;
    const switched = {
      ...target,
      destinationBindings: r.route!.destinationBindings,
      consentedVendors: ["openai", "anthropic"] as const,
    };
    f.registry.ingestProviderLive(
      [{ ...providerBase("claude"), installed: true, authenticated: true, availability: "ready" }],
      () => ({ principal: "new@example.com", method: "claude.ai" }),
    );
    await f.registry.command(
      "connections.accept_account",
      { id: "anthropic:native_cli:default" },
      "workstation",
    );
    f.registry.ingestProviderLive(
      [{ ...providerBase("claude"), installed: true, authenticated: true, availability: "ready" }],
      () => ({ principal: "new@example.com", method: "claude.ai" }),
    );
    assert.equal(f.registry.evaluate(request(f, { kind: "reroute", route: switched })).ok, false);
  } finally {
    f.close();
  }
});
test("T13.2 A10 [SIMULATED] transient auth loss revokes and retains the previous account pin", () => {
  const f = fixture();
  try {
    const id = "anthropic:native_cli:default",
      before = f.registry.views().find((r) => r.id === id)!;
    let revoked = false;
    f.registry.onRevoked(() => (revoked = true));
    f.registry.ingestProviderLive(
      [
        {
          ...providerBase("claude"),
          installed: true,
          authenticated: false,
          availability: "authentication_required",
          authenticatedState: "not_authenticated",
        },
      ],
      () => null,
    );
    const after = f.registry.views().find((r) => r.id === id)!;
    assert.equal(revoked, true);
    assert.equal(after.accountFingerprint, before.accountFingerprint);
    assert.ok(after.epoch > before.epoch);
  } finally {
    f.close();
  }
});
test("T13.2 R05 [SIMULATED] ask policy permits initial dispatch and refuses recovery", async () => {
  const f = fixture();
  try {
    await f.registry.command(
      "connections.policy.set",
      { policy: { ...f.registry.policy(), failover: "ask" } },
      "workstation",
    );
    assert.equal(f.registry.evaluate(request(f)).ok, true);
    assert.equal(f.registry.evaluate(request(f, { kind: "retry" })).ok, false);
  } finally {
    f.close();
  }
});
test("T13.2 R11 [SIMULATED] actual fresh-dispatch wrapper admits the first capped Task and refuses the second", async () => {
  const f = fixture();
  try {
    const id = "anthropic:native_cli:default",
      row = f.registry.views().find((r) => r.id === id)!;
    await f.registry.command(
      "connections.consent.set",
      { id, consent: { ...row.consent, maxRequestsPerDay: 1 } },
      "workstation",
    );
    const r = request(f);
    let reservation: number | null = null,
      spawns = 0;
    const fakeSpawn = ((..._args: unknown[]) => {
      spawns++;
      const child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        stdin: new PassThrough(),
        pid: undefined,
        exitCode: null,
        signalCode: null,
        kill: () => true,
      });
      queueMicrotask(() => {
        child.stdout.write(
          JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "OK" }) +
            "\n",
        );
        child.stdout.end();
        child.stderr.end();
        child.emit("close", 0);
      });
      return child;
    }) as unknown as typeof spawn;
    const hooks = {
      event: () => {},
      session: () => {},
      output: () => {},
      beforeDispatch: async () => {
        const verdict = f.registry.evaluate(r);
        assert.equal(verdict.ok, true);
        if (!verdict.ok) throw new Error("denied");
        reservation = f.registry.recordDispatch(verdict.connectionId, "fixture-task");
      },
      childEnvironment: () => {
        assert.equal(
          f.registry.evaluate(r, reservation ? { id: reservation, taskId: "fixture-task" } : null)
            .ok,
          true,
        );
        return {};
      },
    };
    const task = {
      id: "fixture-task",
      cwd: process.cwd(),
      prompt: "fixture",
      model: "fixture",
    } as OrchTask;
    const launch = {
      command: process.execPath,
      args: [],
      path: process.execPath,
      kind: "native" as const,
      source: "fixture",
    };
    const first = spawnSession(
      "claude",
      launch,
      [],
      task,
      hooks,
      "fixture",
      new ClaudeNormalizer(),
      fakeSpawn,
    );
    assert.equal((await first.done).ok, true);
    assert.equal(spawns, 1);
    assert.equal(f.registry.evaluate(r).ok, false);
  } finally {
    f.close();
  }
});
test("T13.2 A07 [SIMULATED] delayed metadata response cannot restore revoked consent", async () => {
  const db = new HostDatabase(":memory:");
  let reply: (r: Response) => void = () => {};
  const registry = new ConnectionRegistry({
    db,
    emit: () => {},
    protector: new TestProtector(),
    fetch: async () =>
      await new Promise<Response>((resolve) => {
        reply = resolve;
      }),
  });
  try {
    const id = "openai:api_key:default";
    await registry.command(
      "connections.credential.save",
      { id, apiKey: "FIXTURE_RACE_KEY_123456789" },
      "workstation",
    );
    const checking = registry.command("connections.check", { id }, "workstation");
    await new Promise((resolve) => setImmediate(resolve));
    const row = registry.views().find((r) => r.id === id)!;
    await registry.command(
      "connections.consent.set",
      { id, consent: { ...row.consent, allowTasks: false } },
      "workstation",
    );
    reply(new Response("{}", { status: 200 }));
    await checking;
    assert.equal(registry.views().find((r) => r.id === id)!.consent.allowTasks, false);
  } finally {
    registry.close();
    db.close();
  }
});
test("T13.2 N07 [SIMULATED] connection retention is bounded, rolls up unknown spend and preserves current budget", () => {
  const f = fixture();
  try {
    const now = Date.now(),
      insert = f.db.db.prepare(
        "INSERT INTO connection_usage(at,connection_id,task_id,kind,outcome,input_tokens,output_tokens,cost_usd,cost_source) VALUES(?,'openai:api_key:default',NULL,'dispatch',?,2,3,?,'fixture')",
      );
    insert.run(now - 40 * 86400000, "completed", 0.5);
    insert.run(now - 39 * 86400000, "failed", null);
    insert.run(now - 38 * 86400000, "pending", null);
    insert.run(now, "completed", 0.2);
    const before = f.registry.usage(now);
    assert.equal(pruneUsage(f.db, { days: 30, sessionId: "", now, batch: 1 }).removed, 1);
    assert.deepEqual(f.registry.usage(now), before);
    assert.equal(pruneUsage(f.db, { days: 30, sessionId: "", now }).removed, 1);
    assert.equal(
      (
        f.db.db
          .prepare(
            "SELECT SUM(requests) AS n,SUM(unknown) AS u FROM usage_rollups WHERE source='connection'",
          )
          .get() as { n: number; u: number }
      ).n,
      2,
    );
    assert.equal(pruneUsage(f.db, { days: 30, sessionId: "", now }).removed, 0);
    assert.deepEqual(f.registry.usage(now), before);
  } finally {
    f.close();
  }
});
test("T13.2 N07 [SIMULATED] a failed retention transaction rolls back both detail deletion and aggregates", () => {
  const f = fixture();
  try {
    f.db.db
      .prepare(
        "INSERT INTO connection_usage(at,connection_id,kind,outcome,cost_usd) VALUES(?,'openai:api_key:default','dispatch','completed',0.1)",
      )
      .run(Date.now() - 40 * 86400000);
    f.db.db.exec(
      "CREATE TRIGGER fixture_reject_prune BEFORE DELETE ON connection_usage BEGIN SELECT RAISE(ABORT,'fixture prune failure'); END",
    );
    assert.throws(() => pruneUsage(f.db, { days: 30, sessionId: "" }), /fixture prune failure/);
    assert.equal(
      (f.db.db.prepare("SELECT COUNT(*) AS n FROM connection_usage").get() as { n: number }).n,
      1,
    );
    assert.equal(
      (f.db.db.prepare("SELECT COUNT(*) AS n FROM usage_rollups").get() as { n: number }).n,
      0,
    );
  } finally {
    f.close();
  }
});
test("T13.2 A01/A02/A10 [SIMULATED] email hint launches only provider-owned verification and revokes existing authority", async () => {
  const db = new HostDatabase(":memory:");
  let launches = 0,
    revocations = 0;
  const registry = new ConnectionRegistry({
    db,
    emit: () => {},
    locate: () => ({
      command: process.execPath,
      args: [],
      path: process.execPath,
      kind: "native",
      source: "fixture",
    }),
    launcher: () => {
      launches++;
    },
  });
  try {
    registry.ingestProviderLive(
      [{ ...providerBase("claude"), installed: true, authenticated: true, availability: "ready" }],
      () => ({ principal: "owner@example.com", method: "claude.ai" }),
    );
    registry.onRevoked(() => revocations++);
    await registry.command(
      "connections.signin.start",
      { id: "anthropic:native_cli:default", accountHint: "new@example.com" },
      "workstation",
    );
    assert.equal(launches, 1);
    assert.equal(revocations, 1);
    assert.equal(
      registry.views().find((r) => r.catalog === "anthropic" && r.mode === "native_cli")!.session,
      "unknown",
    );
    assert.ok(!JSON.stringify(registry.snapshot()).includes("new@example.com"));
    await registry.command(
      "connections.disconnect",
      { id: "anthropic:native_cli:default" },
      "workstation",
    );
    registry.ingestProviderLive(
      [{ ...providerBase("claude"), installed: true, authenticated: true, availability: "ready" }],
      () => ({ principal: "new@example.com", method: "claude.ai" }),
    );
    assert.equal(
      registry.views().find((r) => r.catalog === "anthropic" && r.mode === "native_cli")!.lifecycle,
      "disconnected",
    );
  } finally {
    registry.close();
    db.close();
  }
});
test(
  "T13.2 A07 [LIVE VERIFIED: Windows DPAPI; SIMULATED: metadata transport] encrypted fixture key survives Host restart without plaintext state",
  { skip: process.platform !== "win32" },
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "bunny-t132-dpapi-")),
      path = join(directory, "host.sqlite"),
      key = "FIXTURE_DPAPI_RESTART_KEY_123456789";
    let db = new HostDatabase(path),
      registry = new ConnectionRegistry({ db, emit: () => {} });
    try {
      await registry.command(
        "connections.credential.save",
        { id: "openai:api_key:default", apiKey: key },
        "workstation",
      );
      const ciphertext = (
        db.db.prepare("SELECT ciphertext FROM connection_credentials").get() as {
          ciphertext: Uint8Array;
        }
      ).ciphertext;
      assert.ok(!Buffer.from(ciphertext).includes(Buffer.from(key)));
      registry.close();
      db.close();
      db = new HostDatabase(path);
      let sent = 0;
      registry = new ConnectionRegistry({
        db,
        emit: () => {},
        fetch: async (_url, init) => {
          assert.equal((init?.headers as Record<string, string>).Authorization, `Bearer ${key}`);
          sent++;
          return new Response("{}", { status: 200 });
        },
      });
      assert.equal(
        registry.views().find((r) => r.id === "openai:api_key:default")!.credential?.protection,
        "dpapi",
      );
      await registry.command("connections.check", { id: "openai:api_key:default" }, "workstation");
      assert.equal(sent, 1);
      assert.ok(!JSON.stringify(registry.snapshot()).includes(key));
    } finally {
      registry.close();
      db.close();
      rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  },
);
