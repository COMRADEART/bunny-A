import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startHost } from "./http.server.ts";
import { providerBase } from "./adapters.server.ts";
import { TestProtector } from "./jev-secrets.server.ts";
import { connectionId, type ConnectionView } from "./connections.ts";
import { allowanceFor, knownCost, sessionLedgerView, type LedgerRow } from "./session-ledger.ts";
import type { AdapterResult, ProviderAdapter } from "./contracts.ts";
import type { OrchTask, ProviderId } from "../orch/types.ts";

/**
 * M-A-3 T13.3 Gate F at the real Host HTTP surface: the active-session ledger, UNKNOWN cost and allowance, no double
 * reservation under a shared daily cap, routing priority and fairness commands, and device stripping. Fixture adapters
 * only; no provider, account or network is used.
 */

type Body = Record<string, any>;
const CLAUDE = connectionId("anthropic", "native_cli");
const OLLAMA = connectionId("ollama", "local_runtime");

async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function boot(directory: string) {
  const root = join(directory, "project");
  mkdirSync(root, { recursive: true });
  const launched: { task: OrchTask; finish: (result: AdapterResult) => void; dispatched: Promise<unknown> }[] = [];
  const adapters: ProviderAdapter[] = (["claude", "ollama"] as ProviderId[]).map((id) => ({
    id,
    detect: async () => ({ ...providerBase(id), installed: true, authenticated: true, availability: "ready", current_model: id === "ollama" ? "qwen3:8b" : "fixture", models: id === "ollama" ? ["qwen3:8b"] : undefined, capabilities: ["text"], probedAt: Date.now() }),
    launch: (task, hooks) => {
      let finish!: (result: AdapterResult) => void;
      const result = new Promise<AdapterResult>((resolve) => (finish = resolve));
      // Real adapters pass the dispatch gate before any provider work; a refusal ends the attempt.
      const dispatched = Promise.resolve().then(() => hooks.beforeDispatch?.()).then(() => true, (error: unknown) => error);
      const done = dispatched.then((outcome) => (outcome === true ? result : { ok: false, output: "", error: String((outcome as Error).message ?? outcome) }));
      launched.push({ task, finish: (value) => { if (id === "claude" && value.ok) hooks.usage?.({ inputTokens: 120, outputTokens: 30, cachedInputTokens: 0, source: "provider" } as never); finish(value); }, dispatched });
      return { done, stop: async () => finish({ ok: false, output: "", stopped: true }) };
    },
  }));
  const host = await startHost({
    dataDirectory: directory,
    root,
    port: await freePort(),
    adapters,
    connections: { protector: new TestProtector(), fetch: async () => new Response("{}", { status: 200 }), launcher: () => { throw new Error("No sign-in in this fixture."); } },
  });
  const base = `http://127.0.0.1:${host.port}`;
  const command = async (action: string, data: unknown = {}, token = host.token) => {
    const response = await fetch(`${base}/command`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ action, data }) });
    return { status: response.status, body: (await response.json()) as Body };
  };
  const state = async (token = host.token) => (await (await fetch(`${base}/state`, { headers: { authorization: `Bearer ${token}` } })).json()) as Body;
  const pair = async () => {
    const code = (await command("pairing.create")).body.pairCode;
    return ((await (await fetch(`${base}/pair`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, name: "Phone" }) })).json()) as { token: string }).token;
  };
  return { host, command, state, pair, launched };
}
const ok = (result: { status: number; body: Body }) => {
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return result.body;
};
const until = async (check: () => boolean | Promise<boolean>, label: string, timeout = 4000) => {
  const start = Date.now();
  while (!(await check())) { if (Date.now() - start > timeout) throw new Error(`Timed out waiting for ${label}`); await new Promise((r) => setTimeout(r, 10)); }
};

test("T13.3 F ledger: session usage is separate from account totals; cost and allowance stay UNKNOWN unless known", () => {
  const row = (patch: Partial<LedgerRow>): LedgerRow => ({ usageId: 1, sessionId: "run-2", at: 1, settledAt: 2, connectionId: CLAUDE, provider: "claude", model: "m", taskId: "t", missionId: null, projectId: null, providerSession: null, outcome: "completed", inputTokens: 10, outputTokens: 5, estimatedCostUsd: null, observedCostUsd: null, costSource: "provider_unknown", ...patch });
  const claude = { id: CLAUDE, catalog: "anthropic", billing: "plan_included", consent: { maxRequestsPerDay: 9, maxUsdPerDay: null } } as unknown as ConnectionView;
  const view = sessionLedgerView({
    sessionId: "run-2",
    rows: [row({ usageId: 1, sessionId: "run-1" }), row({ usageId: 2, missionId: "m-a" }), row({ usageId: 3, outcome: "pending", inputTokens: null, outputTokens: null })],
    connections: [claude],
    usage: { requestsToday: { [CLAUDE]: 7 }, usdToday: {} } as never,
    providerUsage: [],
    slotFor: (missionId) => (missionId === "m-a" ? 2 : null),
  });
  const account = view.accounts[0];
  assert.deepEqual([account.session.completed, account.session.reserved, account.accountToday.requests], [1, 1, 7], "another run's row and account totals stay out of the session");
  assert.deepEqual(account.session.tokens, { input: 10, output: 5, unreported: 0 });
  assert.equal(account.session.estimatedCostUsd, "UNKNOWN");
  assert.equal(account.accountToday.usd, "UNKNOWN");
  assert.equal(account.remaining.state, "UNKNOWN", "a plan with no reported window never infers a remaining quota");
  assert.deepEqual(view.agents.map((agent) => [agent.slot, agent.session.completed + agent.session.reserved]), [[2, 1], [null, 1]]);
  const reported = allowanceFor(claude, [{ providerId: "claude", status: "current", observedAt: 1, windows: [{ label: "5h", percentUsed: 40, resetAt: 9 }], note: "" } as never]);
  assert.deepEqual(reported, { state: "reported", windows: [{ label: "5h", remainingPercent: 60, resetsAt: 9, status: "current" }] });
  assert.equal(allowanceFor({ ...claude, billing: "api_billed" } as ConnectionView, [{ providerId: "claude", status: "current", windows: [{ label: "5h", percentUsed: 40 }] } as never]).state, "UNKNOWN", "an API key is not a plan allowance");
  assert.equal(allowanceFor({ ...claude, billing: "local_device", catalog: "ollama" } as ConnectionView, []).state, "local");
  assert.deepEqual(knownCost("local_device"), { estimated: 0, observed: 0, source: "local_device" }, "only a local model is known to cost nothing");
  for (const billing of ["plan_included", "api_billed", "metered_credits", "unknown"] as const) assert.equal(knownCost(billing).estimated, null, billing);
  const local = sessionLedgerView({ sessionId: "s", rows: [row({ sessionId: "s", connectionId: OLLAMA, provider: "ollama", estimatedCostUsd: 0, observedCostUsd: 0, costSource: "local_device", inputTokens: null, outputTokens: null })], connections: [], usage: { requestsToday: {}, usdToday: {} } as never, providerUsage: [], slotFor: () => null });
  assert.deepEqual([local.accounts[0].session.estimatedCostUsd, local.accounts[0].session.tokens.unreported], [0, 1]);
});

test("T13.3 F Host: ledger rows, no double reservation under a shared cap, priority/fairness commands, device stripping", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bunny-t13-3-ledger-"));
  let h = await boot(directory);
  try {
    const tasks = h.host.manager.connections;
    // An earlier Host run used this account once today: it counts toward the account ceiling, not this session.
    tasks.settle(tasks.recordDispatch(CLAUDE, "earlier-run-task"), true);

    const first = ok(await h.command("submit", { prompt: "Explain photosynthesis briefly.", mode: "balanced", override: "claude" })).task;
    ok(await h.command("approve", { id: first.id }));
    await until(() => h.launched.length === 1, "claude launch");
    await h.launched[0].dispatched;
    h.launched[0].finish({ ok: true, output: "done" });
    await until(() => h.host.manager.db.get(first.id).state === "completed", "first completes");

    let ledger = (await h.state()).sessionLedger as Body;
    assert.equal(ledger.sessionId, h.host.manager.instanceId);
    const claude = ledger.accounts.find((row: Body) => row.connectionId === CLAUDE);
    assert.deepEqual([claude.session.completed, claude.session.reserved, claude.accountToday.requests], [1, 0, 2], "session 1 request; account 2 today including the earlier run");
    assert.deepEqual(claude.session.tokens, { input: 120, output: 30, unreported: 0 });
    assert.equal(ledger.agents[0].slot, null, "direct work no Personal Agent owns");
    assert.equal(claude.session.estimatedCostUsd, "UNKNOWN");
    assert.equal(claude.remaining.state, "UNKNOWN");
    assert.ok(ledger.recent.every((row: Body) => row.sessionId === h.host.manager.instanceId && row.taskId));

    // Shared daily cap with one request left: two concurrent dispatches race for it; exactly one may reserve.
    const used = tasks.usage().requestsToday[CLAUDE] ?? 0;
    const native = ((await h.state()).connections.accounts as ConnectionView[]).find((row) => row.id === CLAUDE)!;
    ok(await h.command("connections.consent.set", { id: CLAUDE, consent: { ...native.consent, maxRequestsPerDay: used + 1 } }));
    const a = ok(await h.command("submit", { prompt: "Explain atoms briefly.", mode: "balanced", override: "claude" })).task;
    const b = ok(await h.command("submit", { prompt: "Explain ions briefly.", mode: "balanced", override: "claude" })).task;
    const before = h.launched.length;
    const approvals = await Promise.all([h.command("approve", { id: a.id }), h.command("approve", { id: b.id })]);
    await until(() => h.launched.length >= before + 1, "racing dispatch");
    await new Promise((r) => setTimeout(r, 100));
    await Promise.all(h.launched.slice(before).map((entry) => entry.dispatched));
    const refusals = approvals.filter((reply) => reply.status !== 200).map((reply) => String(reply.body.error))
      .concat([a, b].map((task) => h.host.manager.db.get(task.id).error ?? "").filter((error) => /BUDGET_BLOCKED/.test(error)));
    assert.ok(refusals.some((error) => /BUDGET_BLOCKED/.test(error)), "the loser is refused by the daily cap");
    assert.equal(tasks.usage().requestsToday[CLAUDE], used + 1, "the cap admits exactly one more request; no double reservation");
    ledger = (await h.state()).sessionLedger as Body;
    assert.equal(ledger.accounts.find((row: Body) => row.connectionId === CLAUDE).session.reserved, 1);
    for (const entry of h.launched.slice(before)) entry.finish({ ok: true, output: "ok" });

    // Routing priority and fairness are workstation settings that persist.
    assert.equal((await h.state()).scheduler.priority, "balanced");
    assert.equal((await h.command("scheduler.priority", { priority: "free_please" })).status, 400);
    ok(await h.command("scheduler.priority", { priority: "local_only" }));
    const localOnly = ok(await h.command("submit", { prompt: "Summarize the tradeoffs of two approaches", mode: "balanced" })).task;
    assert.equal(localOnly.provider, "ollama", "local-only keeps work on this PC");
    assert.equal((await h.command("scheduler.fairness", { fairness: { sharedCeiling: 0 } })).status, 400);
    ok(await h.command("scheduler.fairness", { fairness: { sharedCeiling: 2, agents: { 1: { priority: "high" } } } }));
    const scheduler = (await h.state()).scheduler as Body;
    assert.deepEqual([scheduler.fairness.sharedCeiling, scheduler.fairness.agents["1"].priority], [2, "high"]);
    assert.equal(typeof scheduler.memoryUsedPercent, "number");

    const phone = await h.pair();
    const phoneState = await h.state(phone);
    assert.equal(phoneState.sessionLedger, undefined, "devices never see the ledger");
    assert.equal(phoneState.scheduler, undefined);
    for (const [action, data] of [["scheduler.priority", { priority: "balanced" }], ["scheduler.fairness", { fairness: { sharedCeiling: 4 } }]] as const)
      assert.equal((await h.command(action, data, phone)).body.code, "WORKSTATION_REQUIRED", action);

    await until(async () => ((await h.state()).sessionLedger.accounts.find((row: Body) => row.connectionId === CLAUDE).session.reserved) === 0, "settled")
      .catch(async () => assert.fail(JSON.stringify({ tasks: [a, b].map((task) => [h.host.manager.db.get(task.id).state, h.host.manager.db.get(task.id).error]), launched: h.launched.length, before, recent: (await h.state()).sessionLedger.recent.map((r: Body) => [r.taskId === a.id ? "a" : r.taskId === b.id ? "b" : "x", r.outcome]) })));
    await h.host.close();
    h = await boot(directory);
    const restarted = await h.state();
    assert.equal(restarted.scheduler.priority, "local_only", "priority persists");
    assert.equal(restarted.scheduler.fairness.sharedCeiling, 2, "fairness persists");
    assert.deepEqual(restarted.sessionLedger.accounts, [], "a new Host run starts a new session ledger");
    assert.equal((restarted.connections.accounts as ConnectionView[]).length > 0, true);
    assert.equal(h.host.manager.connections.usage().requestsToday[CLAUDE], used + 1, "account-wide totals carry across runs as the independent ceiling");
  } finally {
    await h.host.close();
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});
