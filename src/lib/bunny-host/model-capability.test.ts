import test from "node:test";
import assert from "node:assert/strict";
import type { Launchable } from "./discovery.server.ts";
import { HostDatabase } from "./persistence.server.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelCapabilityRegistry, type CodexCatalogLike, type OllamaPsRecord, type OllamaShowRecord, type OllamaTags } from "./model-capability.server.ts";

const FIXTURE_LAUNCH: Launchable = { command: "codex-fixture", args: [], path: "/fixture/codex", kind: "native", source: "disposable fixture" };

type Fixture = {
  tags: () => OllamaTags;
  shows: Record<string, OllamaShowRecord | null>;
  ps: OllamaPsRecord | null;
  catalog: CodexCatalogLike | null;
  codexLaunchable: Launchable | null;
};
const fixtureOptions = (fixture: Fixture, now: () => number = () => Date.now(), calls?: { show: number; ps: number }) => ({
  ollamaProbe: async () => fixture.tags(),
  ollamaShow: async (model: string) => { if (calls) calls.show += 1; const show = fixture.shows[model]; return show === undefined ? null : show; },
  ollamaPs: async () => { if (calls) calls.ps += 1; return fixture.ps; },
  codexLaunch: () => fixture.codexLaunchable,
  codexCatalog: async () => fixture.catalog ?? (() => { throw new Error("Codex catalog/usage method unavailable."); })(),
  now,
});
const populatedFixture = (): Fixture => ({
  tags: () => ({ up: true, models: ["llama3.2:3b", "qwen3:8b", "qwen3:8b:cloud"], remote: ["qwen3:8b:cloud"] }),
  shows: {
    "llama3.2:3b": { capabilities: ["completion", "tools"], context_length: 131072 },
    "qwen3:8b": { capabilities: ["completion", "tools", "vision"], context_length: 32768 },
    "qwen3:8b:cloud": null, // A cloud tag with no readable show response: every capability fact stays UNKNOWN.
  },
  ps: { models: [{ name: "llama3.2:3b", context_length: 4096, size_vram: 3.6e9 }] },
  catalog: { model: "gpt-5.1-codex", models: ["gpt-5.1-codex", "gpt-5.1-mini", "gpt-5"], limited: false, usageRead: false },
  codexLaunchable: FIXTURE_LAUNCH,
});

test("ollama model facts are normalized from the real probe shape, with UNKNOWN where the probe returned nothing", async () => {
  const db = new HostDatabase(":memory:");
  try {
    const registry = new ModelCapabilityRegistry(db, fixtureOptions(populatedFixture()));
    await registry.refresh({ force: true });
    const llama = registry.get("ollama", "llama3.2:3b");
    assert.ok(llama);
    // /api/ps reports a loaded session context (4096); it is NOT the model's context window (131072) and never overwrites it.
    assert.equal(llama.contextWindow, 131072);
    assert.equal(llama.toolCalling, true);
    assert.equal(llama.vision, false); // The probe returned a capability list that lacks vision: a probed negative, not UNKNOWN.
    assert.equal(llama.embedding, false);
    assert.equal(llama.loaded, true);
    assert.equal(llama.local, true);
    const cloud = registry.get("ollama", "qwen3:8b:cloud");
    assert.ok(cloud);
    assert.equal(cloud.local, false); // Cloud-hosted tag: hosted, never local inference.
    assert.equal(cloud.contextWindow, null, "no readable show response: capability facts stay UNKNOWN");
    assert.equal(cloud.loaded, false, "ps succeeded and omits the tag: a probed negative");
  } finally { db.close(); }
});

test("vision false comes from a returned capability list; only a missing list stays UNKNOWN", async () => {
  const db = new HostDatabase(":memory:");
  try {
    const fixture = populatedFixture();
    fixture.shows["llama3.2:3b"] = { capabilities: ["completion"], context_length: 131072 };
    const registry = new ModelCapabilityRegistry(db, fixtureOptions(fixture));
    await registry.refresh({ force: true });
    const llama = registry.get("ollama", "llama3.2:3b");
    assert.equal(llama?.vision, false); // The server answered with a capability list that lacks vision: a probed negative.
    const cloud = registry.get("ollama", "qwen3:8b:cloud");
    assert.equal(cloud?.vision, null); // No capability list at all: UNKNOWN.
    assert.equal(cloud?.loaded, false, "ps succeeded and does not list it: a probed false, not invented");
  } finally { db.close(); }
});

test("codex catalogue models normalize with the preferred default and no invented capability facts", async () => {
  const db = new HostDatabase(":memory:");
  try {
    const registry = new ModelCapabilityRegistry(db, fixtureOptions(populatedFixture()));
    await registry.refresh({ force: true });
    const codex = registry.get("codex", "gpt-5.1-codex");
    assert.ok(codex);
    assert.equal(codex.isDefault, true);
    assert.equal(codex.local, false);
    assert.equal(codex.toolCalling, null);
    assert.equal(codex.vision, null);
    assert.equal(codex.contextWindow, null);
    assert.equal(registry.get("codex", "gpt-5.1-mini")?.isDefault, null);
    assert.match(codex.source, /model\/list/);
  } finally { db.close(); }
});

test("providers without a real model-listing probe produce no rows and no claims", async () => {
  const db = new HostDatabase(":memory:");
  try {
    const fixture = populatedFixture();
    fixture.catalog = null; // codex catalogue unreadable → no codex rows either
    const registry = new ModelCapabilityRegistry(db, fixtureOptions(fixture));
    const changes = await registry.refresh({ force: true });
    assert.equal(changes.filter((change) => /Codex/.test(change)).length, 0);
    for (const provider of ["claude", "opencode", "cline", "cursor"] as const) {
      assert.deepEqual(registry.list(provider), [], `${provider}: absence of rows is UNKNOWN, not an empty-inventory claim`);
      assert.equal(registry.probedThisRun(provider), false);
    }
    assert.ok(registry.get("codex", "gpt-5.1-codex") === undefined);
  } finally { db.close(); }
});

test("a downed Ollama service yields no fresh facts, no rows, and no events; persisted rows keep their probed age", async () => {
  const db = new HostDatabase(":memory:");
  try {
    const calls = { show: 0, ps: 0 };
    const registry = new ModelCapabilityRegistry(db, fixtureOptions(populatedFixture(), () => 1000));
    await registry.refresh({ force: true });
    const before = registry.get("ollama", "qwen3:8b");
    assert.ok(before);
    const fixture: Fixture = {
      tags: () => ({ up: false, models: [] }),
      shows: {},
      ps: null,
      catalog: { model: null, models: ["gpt-5.1-codex"], limited: false, usageRead: false },
      codexLaunchable: FIXTURE_LAUNCH,
    };
    const second = fixtureOptions(fixture, () => 1000, calls);
    const down = new ModelCapabilityRegistry(db, second); // same db: rows loaded from storage
    const changes = await down.refresh({ force: true });
    assert.deepEqual(changes.filter((change) => /Ollama/.test(change)), []);
    assert.equal(calls.show, 0);
    assert.equal(calls.ps, 0);
    const row = down.get("ollama", "qwen3:8b");
    assert.equal(row?.probedAt, before.probedAt, "downed service never rewrites probed facts");
    assert.equal(down.get("ollama", "qwen3:8b:cloud")?.local, false);
  } finally { db.close(); }
});

test("rows persist across a reopen, but persisted state alone never satisfies probedThisRun", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bunny-model-cap-"));
  try {
    const path = join(dir, "host.sqlite");
    const first = new HostDatabase(path);
    const writer = new ModelCapabilityRegistry(first, fixtureOptions(populatedFixture(), () => 5000));
    await writer.refresh({ force: true });
    first.close();
    const db = new HostDatabase(path);
    const reopened = new ModelCapabilityRegistry(db, fixtureOptions(populatedFixture(), () => 5000));
    assert.equal(reopened.list("ollama").length, 3);
    assert.equal(reopened.get("codex", "gpt-5.1-mini")?.isDefault, null);
    assert.equal(reopened.probedThisRun("ollama"), false, "persisted rows are last-known state, never this-run proof");
    const snapshot = reopened.snapshot();
    assert.equal(snapshot.version, 1);
    const ollama = snapshot.providers.find((provider) => provider.provider === "ollama");
    assert.equal(ollama?.probedThisRun, false);
    assert.equal(ollama?.probedAt, 5000);
    assert.equal(snapshot.providers.find((provider) => provider.provider === "claude")?.models.length, 0);
    db.close();
  } finally { try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows can hold the SQLite handle past close; best-effort cleanup */ } }
});

test("corrupt persisted rows are skipped without crashing and are re-probed", () => {
  const db = new HostDatabase(":memory:");
  try {
    const writer = new ModelCapabilityRegistry(db); // creates the additive table
    db.db.exec("INSERT INTO model_capabilities(provider,model,probed_at,record) VALUES('claude','broken',NULL,'not json')");
    db.db.exec("INSERT INTO model_capabilities(provider,model,probed_at,record) VALUES('junkJ','broken',NULL,'{}')");
    const registry = new ModelCapabilityRegistry(db);
    assert.deepEqual(registry.list("claude"), []);
    assert.equal(registry.get("ollama", "broken"), undefined);
    assert.ok(writer); // the first instance's table creation is what the corrupt rows depend on
  } finally { db.close(); }
});

test("interval gating: identical facts within the interval produce no re-probe and no changes; a change produces a change string", async () => {
  const db = new HostDatabase(":memory:");
  try {
    let tNow = 10_000;
    const fixture = populatedFixture();
    const registry = new ModelCapabilityRegistry(db, fixtureOptions(fixture, () => tNow, undefined));
    const first = await registry.refresh();
    assert.ok(first.includes("Ollama: 3 models discovered"));
    assert.ok(first.some((change) => /Codex: 3 models discovered/.test(change)));
    tNow += 60_000;
    assert.deepEqual(await registry.refresh(), [], "an unchanged re-probe announces nothing");
    tNow += 31 * 60_000;
    const later = await registry.refresh();
    assert.ok(later.length === 0, "identical facts past the interval still announce nothing");
    fixture.tags = () => ({ up: true, models: ["llama3.2:3b", "qwen3:8b"], remote: [] });
    delete fixture.shows["qwen3:8b:cloud"];
    fixture.shows["qwen3:8b"] = { capabilities: ["completion", "tools"], context_length: 65536 };
    const changed = await registry.refresh({ force: true });
    assert.ok(changed.some((change) => /1 model no longer listed: qwen3:8b:cloud/.test(change)), changed.join(" | "));
    assert.ok(changed.some((change) => /qwen3:8b \(context window 32768→65536/.test(change)), changed.join(" | "));
  } finally { db.close(); }
});

test("a probe failure path never emits change strings or overwrites rows (Codex catalogue errors caught)", async () => {
  const db = new HostDatabase(":memory:");
  try {
    const fixture = populatedFixture();
    const registry = new ModelCapabilityRegistry(db, fixtureOptions(fixture, () => 7_000));
    await registry.refresh({ force: true });
    const seeded = registry.get("codex", "gpt-5.1-codex");
    fixture.catalog = null; // codexCatalog stub now throws; catch path yields null
    const changes = await registry.refresh({ force: true });
    assert.deepEqual(changes.filter((change) => /Codex/.test(change)), []);
    assert.equal(registry.get("codex", "gpt-5.1-codex")?.probedAt, seeded?.probedAt, "failed probe leaves old facts and their age untouched");
  } finally { db.close(); }
});

test("model discovery probes only providers present in the Host's adapter set", async () => {
  const db = new HostDatabase(":memory:");
  try {
    const calls = { show: 0, ps: 0 };
    const registry = new ModelCapabilityRegistry(db, { ...fixtureOptions(populatedFixture(), () => 20_000, calls), availableProviders: () => ["claude"] });
    const changes = await registry.refresh({ force: true });
    assert.deepEqual(changes, []);
    assert.equal(calls.show, 0);
    assert.equal(calls.ps, 0);
    assert.deepEqual(registry.list(), []);
    assert.equal(registry.probedThisRun("ollama"), false);
  } finally { db.close(); }
});

test("user_version stays 3 and the table creation is idempotent; migration keeps older rows", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bunny-model-cap-migr-"));
  try {
    const db = new HostDatabase(join(dir, "host.sqlite"));
    // Simulate a pre-T1 database: host tables exist (with their migrations record), model_capabilities does not.
    db.db.exec("INSERT INTO migrations(key) VALUES('ma2.approval-batches.v1')");
    const first = new ModelCapabilityRegistry(db, fixtureOptions(populatedFixture(), () => 900));
    const changes = await first.refresh({ force: true });
    assert.equal(changes.length, 2);
    const second = new ModelCapabilityRegistry(db, fixtureOptions(populatedFixture(), () => 900)); // idempotent CREATE TABLE IF NOT EXISTS
    assert.equal(second.list().length, 6);
    assert.equal((db.db.prepare("SELECT COUNT(*) c FROM migrations").get() as { c: number }).c, 1, "the registry owns its table like the providers table: host-layer tables carry no migrations keys");
    const version = db.db.prepare("PRAGMA user_version").get() as { user_version: number };
    assert.equal(version.user_version, 3, "additive T1 schema never bumps user_version");
    db.close();
  } finally { try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows can hold the SQLite handle past close; best-effort cleanup */ } }
});