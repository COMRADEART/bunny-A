import test from "node:test";
import assert from "node:assert/strict";
import {
  COORDINATION_NOT_CONFIGURED, fabricDeviceRows, fabricEvents, fabricOverview, fabricProfiles, fabricUsageRows,
} from "./fabric-model.ts";
import type { HostSnapshot } from "../../lib/bunny-host/contracts.ts";

/** E4 truth locks: Server Control renders only served fields; coordination is never shown as live; a cost is known
 *  only where the ledger calls it known; nothing invents a node, percentage or quota. */

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
      device({ id: "dev-4", lastSeenAt: now - 120_000 }),
    ],
    now,
  );
  assert.deepEqual(
    rows.map((row) => [row.id, row.state]),
    [
      ["dev-3", "revoked"],
      ["dev-1", "active"],
      ["dev-4", "idle"],
      ["dev-2", "expired"],
    ],
  );
  assert.deepEqual(fabricDeviceRows([], now), [], "an empty registry shows nothing; no sample device is ever drawn");
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