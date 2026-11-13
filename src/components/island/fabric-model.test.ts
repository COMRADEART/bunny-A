import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  COORDINATION_NOT_CONFIGURED, devicePresenceNotes, fabricDeviceRows, fabricEvents, fabricLedgerRows, fabricOverview, fabricProfiles, fabricUsageRows,
} from "./fabric-model.ts";
import type { HostSnapshot } from "../../lib/bunny-host/contracts.ts";
import { deviceStatusPresentation, projectDeviceDiagnostics } from "../../lib/bunny-host/ma4/native-notifications.ts";

/** E4 truth locks: Server Control renders only served fields; coordination is never shown as live; a cost is known
 *  only where the ledger calls it known; nothing invents a node, percentage or quota. */

/* F04 locks read the sources themselves (like glass-contrast reads its tokens): the surfaces carry the token
 * gutters, every table gets its overflow wrapper, and the narrow composition is container-driven. */
const fabricCss = readFileSync(fileURLToPath(new URL("./fabric.css", import.meta.url)), "utf8");
const fabricTsx = readFileSync(fileURLToPath(new URL("./fabric.tsx", import.meta.url)), "utf8");

const now = 1_800_000_000_000;
type AnyDevice = NonNullable<HostSnapshot["devices"]>[number];

const device = (patch: Partial<AnyDevice> & { id: string }): AnyDevice => ({
  id: patch.id,
  name: patch.name ?? patch.id,
  createdAt: patch.createdAt ?? now - 10_000,
  expiresAt: patch.expiresAt,
  lastSeenAt: patch.lastSeenAt,
  revoked: patch.revoked,
});

test("device rows label their own truth; revoked beats expiry; newest presence sorts first", () => {
  const rows = fabricDeviceRows(
    [
      device({ id: "dev-2", expiresAt: now - 1000, lastSeenAt: now - 200_000, revoked: false }),
      device({ id: "dev-1", lastSeenAt: now - 30_000 }),
      device({ id: "dev-3", revoked: true, lastSeenAt: now - 5_000 }),
      device({ id: "dev-4", lastSeenAt: now - 130_000 }),
      device({ id: "dev-5" }),
    ],
    now,
  );
  // The state and the label come from the Devices page's own rule, so the two lists read the same.
  assert.deepEqual(
    rows.map((row) => [row.id, row.state, row.label]),
    [
      ["dev-3", "revoked", "Revoked"],
      ["dev-5", "idle", "Offline"],
      ["dev-1", "active", "Connected"],
      ["dev-4", "idle", "Offline"],
      ["dev-2", "expired", "Pairing expired"],
    ],
  );
  for (const row of rows)
    assert.equal(row.label, deviceStatusPresentation(projectDeviceDiagnostics({ ...row, revoked: row.revoked === true }, now)).label, row.id);
  assert.deepEqual(fabricDeviceRows([], now), [], "an empty registry shows nothing; no sample device is ever drawn");
});

test("a paired device going offline or coming back is said once, and only for devices still allowed to connect", () => {
  const phone = (lastSeenAt: number, patch: Partial<AnyDevice> = {}) => device({ id: "phone", name: "Pixel", lastSeenAt, ...patch });
  const first = devicePresenceNotes(null, [phone(now - 1_000)], now);
  assert.deepEqual(first, { presence: { phone: true }, notes: [] }, "the first look only seeds");
  const same = devicePresenceNotes(first.presence, [phone(now - 5_000)], now);
  assert.deepEqual(same.notes, [], "no change, nothing said");
  const dropped = devicePresenceNotes(same.presence, [phone(now - 500_000)], now);
  assert.deepEqual(dropped, { presence: { phone: false }, notes: ["Pixel went offline"] });
  assert.deepEqual(devicePresenceNotes(dropped.presence, [phone(now - 500_000)], now).notes, [], "said once, not on every snapshot");
  const back = devicePresenceNotes(dropped.presence, [phone(now - 2_000), device({ id: "new", name: "Laptop", lastSeenAt: now })], now);
  assert.deepEqual(back.notes, ["Pixel is back online"], "a device seen for the first time says nothing");
  assert.deepEqual(back.presence, { phone: true, new: true });
  // Revoked and expired devices are not tracked: their row already says why they are gone.
  const revoked = devicePresenceNotes(back.presence, [phone(now - 500_000, { revoked: true }), device({ id: "new", name: "Laptop", lastSeenAt: now - 500_000, expiresAt: now - 1 })], now);
  assert.deepEqual(revoked, { presence: {}, notes: [] });
  assert.deepEqual(devicePresenceNotes({ phone: true }, [phone(now - 500_000, { name: "  " })], now).notes, ["A paired device went offline"]);
});

test("the overview counts exactly what the snapshot carries and nothing else", () => {
  const overview = fabricOverview({
    hostIdentity: { hostId: "0123456789abcdef", epoch: "fedcba9876543210", startedAt: now - 60_000 },
    tasks: [{} as never, {} as never],
    agents: { agents: [{}, {}] } as never,
    devices: [device({ id: "d1" })],
    projects: [],
  });
  assert.deepEqual(overview, {
    hostId: "0123456789abcdef", epoch: "fedcba9876543210", startedAt: now - 60_000,
    tasks: 2, agents: 2, devices: 1, projects: 0,
  });
  const bare = fabricOverview({ hostIdentity: null, tasks: [], agents: undefined, devices: undefined, projects: [] });
  assert.deepEqual(bare, { hostId: null, epoch: null, startedAt: null, tasks: 0, agents: 0, devices: 0, projects: 0 });
});

test("coordination is pinned not-configured while its owner-gated slice is pending", () => {
  assert.equal(
    COORDINATION_NOT_CONFIGURED,
    "Not configured — coordinator wiring (leases, epochs, topology, takeover) is a later, owner-gated slice.",
  );
});

test("a cost is known only where the ledger says so; provider-reported estimates never become shown costs", () => {
  const ledger = {
    recent: [
      { provider: "ollama", model: "qwen2.5-coder:7b", outcome: "completed", inputTokens: 12, outputTokens: 34, estimatedCostUsd: 0, observedCostUsd: 0, costSource: "local_device" },
      { provider: "openrouter", model: "vendor/x", outcome: "completed", inputTokens: 9, outputTokens: 20, estimatedCostUsd: 0.02, observedCostUsd: null, costSource: "provider_unknown" },
    ],
  } as unknown as NonNullable<HostSnapshot["sessionLedger"]>;
  const rows = fabricUsageRows(ledger);
  assert.deepEqual(rows, [
    { provider: "ollama", model: "qwen2.5-coder:7b", outcome: "completed", input: 12, output: 34, costKnown: true, cost: 0 },
    { provider: "openrouter", model: "vendor/x", outcome: "completed", input: 9, output: 20, costKnown: false, cost: null },
  ]);
  assert.deepEqual(fabricUsageRows(null), [], "no ledger, no rows, no invention");
});

test("the event and profile windows are bounded; profiles pass through unchanged", () => {
  const events = Array.from({ length: 30 }, (_, index) => ({ sequence: 30 - index, at: now - index, type: "x", taskId: null, detail: "d" })) as HostSnapshot["events"];
  const bounded = fabricEvents(events, 12);
  assert.equal(bounded.length, 12);
  assert.equal(bounded[0].sequence, 30, "newest first");
  const performance = [{ provider: "ollama", taskType: "coding", count: 3, completed: 3, verified: 3, durationMs: 1200, sufficient: true }] as HostSnapshot["performance"];
  assert.deepEqual(fabricProfiles(performance), performance);
  assert.deepEqual(fabricProfiles(undefined), []);
});

test("the routing ledger rows are bounded and absent when the Host does not serve them", () => {
  const decision: import("../../lib/bunny-host/routing-store.server.ts").RoutingLedgerDecision = {
    id: "decision-x", taskId: "task-x", missionId: null, createdAt: now, policyVersion: "routing-policy-ma4-s1-v1",
    mode: "auto", taskClass: "general",
    selected: { provider: "ollama", model: "qwen3:8b", kind: "DISCOVERED_MODEL", reason: "verified local" },
    candidates: 2, reroutes: 0, attempts: [{ index: 0, provider: "codex", model: null, taxonomy: "TRANSIENT_TRANSPORT", detail: "", createdAt: now }],
  };
  const many = Array.from({ length: 40 }, () => decision);
  const bounded = fabricLedgerRows({ schema: "bunny-a.routing-ledger.v1", decisions: many });
  assert.equal(bounded.length, 10, "the fabric shows a bounded window");
  assert.deepEqual(bounded[0], decision, "rows pass through unchanged");
  assert.deepEqual(fabricLedgerRows(null), [], "no host, no rows, no invention");
});

test("F04: every direct Server Control surface carries the token gutter, not the material's 0px", () => {
  assert.match(fabricCss, /\.fabric > \.t8-surface \{[^}]*padding: var\(--s4\);/, "desk gutter is var(--s4)");
  assert.match(
    fabricCss,
    /@media \(max-width: 720px\) \{\s*\.fabric > \.t8-surface \{[^}]*padding: var\(--s3\);/,
    "the compressed phone shell narrows the gutter to the next token",
  );
});

test("F04: every fabric-table sits in an explicit overflow wrapper that scrolls in-panel, never past it", () => {
  assert.match(fabricCss, /\.fabric-scroll \{[^}]*overflow-x: auto;/, "the wrapper owns the overflow");
  const tables = fabricTsx.match(/<table className="fabric-table"/g)?.length ?? 0;
  const wrappers = fabricTsx.match(/<div className="fabric-scroll">/g)?.length ?? 0;
  assert.ok(tables > 0 && wrappers === tables, `each of the ${tables} tables is wrapped (${wrappers} wrappers)`);
});

test("F04: the panels are composition containers; narrow panels reflow cells before the wrapper scrolls", () => {
  assert.match(fabricCss, /\.fabric > \.t8-surface \{[^}]*container-type: inline-size;/, "panel-width container per the a548456 pattern");
  assert.match(
    fabricCss,
    /@container \(max-width: 560px\) \{[\s\S]*?\.bunny-app \.fabric-table :is\(th, td\) \{[^}]*padding: var\(--s2\) var\(--s1\);/,
    "narrow cells drop to the small token gutters",
  );
  assert.match(
    fabricCss,
    /@container \(max-width: 560px\) \{[\s\S]*?\.bunny-app \.fabric-table :is\(th, td\) \{[^}]*overflow-wrap: anywhere;/,
    "long tokens wrap before the table widens",
  );
});