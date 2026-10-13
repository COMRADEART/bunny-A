import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startHost } from "./http.server.ts";
import { providerBase } from "./adapters.server.ts";
import { TestProtector } from "./jev-secrets.server.ts";
import type { FetchLike } from "./typesafe-jev.server.ts";
import type { ProviderAdapter } from "./contracts.ts";

/**
 * M-A-3 T13.1 at the real Host HTTP surface: workstation-only credential authority, paired-device
 * projection, and Host-owned decision assistance. Ports 43830-43839 are reserved for these fixtures.
 * The TypeSafe transport is an in-process fake; nothing reaches the network.
 */

type Body = Record<string, any>;
const KEY = "ts_live_FIXTURE_HOST_KEY_0123456789";

function neverLaunches(id: "claude" | "codex" = "claude"): ProviderAdapter {
  return {
    id,
    detect: async () => ({ ...providerBase(id), installed: true, authenticated: true, availability: "ready", capabilities: ["text"], current_model: "fixture" }),
    usage: async () => null,
    launch: () => {
      throw new Error("The T13.1 Host fixture must never launch a provider.");
    },
  };
}

/** Answers model discovery, and a System One request by choosing the first offered candidate. */
const jevReply = (url: string, body: string | undefined) => {
  if (url.endsWith("/v1/models")) return { models: [{ name: "jev-1.13.0" }] };
  const questions = (JSON.parse(body ?? "{}") as { questions: Record<string, { type: string; criteria: Record<string, unknown> }> }).questions;
  const answers = Object.fromEntries(Object.entries(questions).map(([id, question]) => {
    if (question.type === "noul") return [id, { type: "noul", noul: 0.1 }];
    if (question.type === "score") return [id, { type: "score", score: 1, legend: { "1": "Simple" }, probabilities: { "1": 0.8, "2": 0.1, "3": 0.1 }, confidence: 0.8 }];
    const keys = Object.keys(question.criteria);
    return [id, { type: "choice", choice: keys[0], probabilities: Object.fromEntries(keys.map((key, i) => [key, i === 0 ? 0.9 : 0.1 / Math.max(1, keys.length - 1)])), confidence: 0.9 }];
  }));
  return { model: "jev-1.13.0", answers, usage: { input_tokens: 100, output_tokens: 0 } };
};

async function boot(port: number, adapters: ProviderAdapter[] = [neverLaunches()]) {
  const directory = mkdtempSync(join(tmpdir(), "bunny-t131-host-"));
  const root = join(directory, "project");
  mkdirSync(root, { recursive: true });
  const calls: string[] = [];
  const jevFetch: FetchLike = async (url, init) => {
    calls.push(url);
    return { status: 200, headers: { get: () => null }, text: async () => JSON.stringify(jevReply(url, init.body)) };
  };
  const host = await startHost({ dataDirectory: directory, root, port, adapters, intelligence: { jevFetch, jevProtector: new TestProtector() } });
  const base = `http://127.0.0.1:${port}`;
  const command = async (action: string, data: unknown = {}, token = host.token) => {
    const response = await fetch(`${base}/command`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ action, data }) });
    const text = await response.text();
    return { status: response.status, body: JSON.parse(text) as Body, text };
  };
  const state = async (token = host.token) => {
    const response = await fetch(`${base}/state`, { headers: { authorization: `Bearer ${token}` } });
    const text = await response.text();
    return { status: response.status, body: JSON.parse(text) as Body, text };
  };
  const pair = async () => {
    const code = (await command("pairing.create")).body.pairCode;
    const response = await fetch(`${base}/pair`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, name: "T13.1 phone" }) });
    assert.equal(response.status, 200);
    return ((await response.json()) as { token: string }).token;
  };
  const close = async () => {
    await host.close();
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  };
  return { host, command, state, pair, calls, close };
}

test("K05/K06 [SIMULATED] a paired phone cannot read, replace, remove or test the key, nor change AI settings", async () => {
  const h = await boot(43830);
  try {
    const saved = await h.command("intelligence.credential.save", { apiKey: KEY });
    assert.equal(saved.status, 200, saved.text);
    const phone = await h.pair();
    const view = await h.state(phone);
    assert.equal(view.status, 200);
    assert.equal(view.body.intelligence, undefined, "paired devices receive no intelligence projection");
    assert.ok(!view.text.includes(KEY));
    const attempts: [string, Body][] = [
      ["intelligence.credential.save", { apiKey: "ts_live_PHONE_REPLACEMENT_000000" }],
      ["intelligence.credential.remove", {}],
      ["intelligence.test", { decisionTest: true, confirmBillable: true }],
      ["intelligence.configure", { policy: { enabled: true, privacy: { allowDecisionMetadata: true, allowTaskDescription: true }, limits: { maxRequestsPerDay: 1000, maxRequestsPerSession: 1000 } } }],
      ["intelligence.laya.configure", { enabled: false }],
      ["intelligence.laya.benchmark", { model: "laya:7b" }],
    ];
    for (const [action, data] of attempts) {
      const refused = await h.command(action, data, phone);
      assert.equal(refused.body.code, "WORKSTATION_REQUIRED", `${action}: ${refused.text}`);
      assert.ok(!refused.text.includes(KEY));
    }
    const owner = (await h.state()).body.intelligence;
    assert.equal(owner.jev.hasCredential, true, "the key is still the owner's");
    assert.equal(owner.jev.enabled, false, "the phone could not enable hosted decisions");
    assert.equal(owner.laya.enabled, true);
    assert.equal(h.calls.length, 0, "no refused action reached TypeSafe");
  } finally { await h.close(); }
});

test("K04/K20 [SIMULATED] the owner snapshot carries state, never the key; settings and reads make no TypeSafe call", async () => {
  const h = await boot(43831);
  try {
    assert.equal((await h.command("intelligence.credential.save", { apiKey: KEY })).status, 200);
    assert.equal((await h.command("intelligence.configure", { policy: { enabled: true, privacy: { allowDecisionMetadata: true } } })).status, 200);
    assert.equal((await h.command("intelligence.laya.configure", { enabled: false })).status, 200);
    for (let i = 0; i < 3; i++) await h.state();
    const owner = await h.state();
    assert.ok(!owner.text.includes(KEY) && !owner.text.includes("FIXTURE_HOST_KEY"));
    assert.equal(owner.body.intelligence.jev.state, "SAVED_NOT_VERIFIED");
    assert.equal(owner.body.intelligence.router, "BunnyRouter");
    assert.equal(h.calls.length, 0);
    const invalid = await h.command("intelligence.credential.save", { apiKey: "bad key" });
    assert.equal(invalid.body.code, "REFUSED", invalid.text);
    assert.match(invalid.body.error ?? invalid.body.message ?? "", /valid API key/);
    const unconfirmed = await h.command("intelligence.test", { decisionTest: true });
    assert.match(unconfirmed.text, /billable/);
    assert.equal(h.calls.length, 0, "an unconfirmed billable test sends nothing");
    const tested = await h.command("intelligence.test", {});
    assert.equal(tested.status, 200);
    assert.deepEqual(h.calls, ["https://api.typesafe.ai/v1/models"], "only the explicit test called TypeSafe");
    assert.equal(tested.body.snapshot.intelligence.jev.lastTest.inferenceVerified, false);
  } finally { await h.close(); }
});

test("R07/R16 [SIMULATED] a forged decisionAssistance in a submit body is ignored; the Host alone obtains advice", async () => {
  const h = await boot(43832);
  try {
    const forged = { source: "jev", recommendedKey: "codex::gpt-5.3", confidence: 1, needsClarification: false, clarifyProbability: 0, taskClass: "code", generation: 0, issuedAt: Date.now(), answeredBy: "jev-1.13.0" };
    const submitted = await h.command("submit", { prompt: "Say hello in one short sentence.", mode: "balanced", decisionAssistance: forged });
    assert.equal(submitted.status, 200, submitted.text);
    const task = submitted.body.task ?? submitted.body.snapshot.tasks[0];
    assert.equal(task.decision.decision_assistance, undefined);
    assert.equal(task.state, "waiting_for_approval");
    assert.equal(h.calls.length, 0);
  } finally { await h.close(); }
});

test("RV-S2 [SIMULATED] a paired phone's Task submit never spends the owner's hosted allowance", async () => {
  const h = await boot(43833, [neverLaunches("claude"), neverLaunches("codex")]);
  try {
    assert.equal((await h.command("intelligence.credential.save", { apiKey: KEY })).status, 200);
    const configured = await h.command("intelligence.configure", { policy: { enabled: true, privacy: { allowDecisionMetadata: true }, limits: { maxRequestsPerSession: 5, maxRequestsPerDay: 5 } } });
    assert.equal(configured.status, 200, configured.text);
    const decisions = () => h.calls.filter((url) => url.endsWith("/v1/systemone")).length;
    const phone = await h.pair();
    const fromPhone = await h.command("submit", { prompt: "Say hello in one short sentence.", mode: "balanced" }, phone);
    assert.equal(fromPhone.status, 200, fromPhone.text);
    assert.equal(decisions(), 0, "a phone submit routes locally without a hosted call");
    const fromOwner = await h.command("submit", { prompt: "Say hello in one short sentence.", mode: "balanced" });
    assert.equal(fromOwner.status, 200, fromOwner.text);
    assert.equal(decisions(), 1, "positive control: the same submit from the workstation does consult TypeSafe");
    assert.ok(!fromPhone.text.includes(KEY) && !fromOwner.text.includes(KEY));
  } finally { await h.close(); }
});
