import test from "node:test";
import assert from "node:assert/strict";
import {
  allowVerdict,
  APPROVAL_ON_HOST,
  attentionCount,
  attentionLabel,
  controlCaption,
  isDevice,
  missionApproveVerdict,
  offerVerdict,
  OUTCOME_UNKNOWN,
  pendingAsks,
  RECONNECT_CAPTION,
  rightsSummary,
} from "./remote-view-model.ts";
import type { SnapshotViewer } from "../../lib/bunny-host/contracts.ts";
import type { AgenticProjection } from "../../lib/bunny-missions/agentic-types.ts";
import type { MissionView, PermissionRequest } from "../../lib/bunny-missions/types.ts";

const device: SnapshotViewer = {
  kind: "device",
  deviceId: "d1",
  name: "Phone",
  role: "paired-device",
  pairedAt: 0,
  expiresAt: 1,
  lastSeenAt: null,
  rights: ["agent.get", "agent.pause", "agent.stop", "mission.respond", "submit", "device.revoke"],
};
const workstation: SnapshotViewer = { kind: "workstation" };
const request = (id: string, extra: Partial<PermissionRequest> = {}): PermissionRequest => ({
  id,
  missionId: "m1",
  stepId: "s1",
  action: "filesystem.write",
  risk: "WRITE",
  reason: "Outside the approved capability list.",
  createdAt: 0,
  resolvedAt: null,
  resolution: null,
  resolvedBy: null,
  batchOffer: null,
  ...extra,
});
const authorization = (extra: Partial<AgenticProjection> = {}) =>
  ({ state: "ACTIVE", revision: 4, pending: [], ...extra }) as unknown as AgenticProjection;
const mission = (requests: PermissionRequest[], extra: Partial<MissionView> = {}) =>
  ({ id: "m1", state: "running", requests, ...extra }) as unknown as MissionView;

test("T9 view: only the Host's own verdict lets a device allow an ask; Deny is never hidden", () => {
  assert.deepEqual(allowVerdict({ remote: { answerable: true, reason: null } }, device), { allowed: true, caption: null });
  assert.deepEqual(allowVerdict({ remote: { answerable: false, reason: APPROVAL_ON_HOST } }, device), { allowed: false, caption: APPROVAL_ON_HOST });
  assert.deepEqual(allowVerdict({}, device), { allowed: false, caption: APPROVAL_ON_HOST }, "no verdict is never permission");
  assert.deepEqual(allowVerdict({ remote: { answerable: false, reason: "x" } }, workstation), { allowed: true, caption: null });
  assert.equal(isDevice(device), true);
  assert.equal(isDevice(null), false);
});
test("T9 view: an Agentic consent offer is approvable remotely only with the Host's remoteOffer", () => {
  assert.equal(offerVerdict(authorization({ state: "ACTIVE" }), device).allowed, false);
  assert.deepEqual(offerVerdict(authorization({ state: "WAITING_FOR_USER", remoteOffer: { answerable: false, reason: "Starting an Agent's first delegation requires approval on the Windows Host." } }), device), {
    allowed: false,
    caption: "Starting an Agent's first delegation requires approval on the Windows Host.",
  });
  assert.equal(offerVerdict(authorization({ state: "WAITING_FOR_USER", remoteOffer: { answerable: true, reason: null } }), device).allowed, true);
  assert.equal(offerVerdict(authorization({ state: "WAITING_FOR_USER" }), workstation).allowed, true);
  assert.equal(offerVerdict(authorization({ state: "WAITING_FOR_USER" }), device).caption, APPROVAL_ON_HOST);
});
test("T9 view: Mission plan approval follows the Host's mission verdict", () => {
  assert.equal(missionApproveVerdict(mission([], { state: "running" }), workstation).allowed, false);
  assert.equal(missionApproveVerdict(mission([], { state: "waiting_for_approval", remote: { answerable: true, reason: null } }), device).allowed, true);
  assert.deepEqual(missionApproveVerdict(mission([], { state: "waiting_for_approval", remote: { answerable: false, reason: APPROVAL_ON_HOST } }), device), { allowed: false, caption: APPROVAL_ON_HOST });
});
test("T9 view: pending asks merge Agentic items and unresolved Mission requests once each", () => {
  const asks = pendingAsks(
    authorization({ pending: [{ id: "r1", action: "filesystem.write", risk: "WRITE", reason: "agentic", resource: "result.txt in C:/p", remote: { answerable: true, reason: null } }] }),
    mission([request("r1"), request("r2", { risk: "DESTRUCTIVE", action: "filesystem.delete" }), request("r3", { resolvedAt: 5 })]),
  );
  assert.deepEqual(asks.map((ask) => ask.id), ["r1", "r2"]);
  assert.equal(asks[0].resource, "result.txt in C:/p", "the Agentic item carries the exact resource");
  assert.equal(asks[0].revision, 4);
  assert.equal(asks[1].revision, null);
  assert.deepEqual(pendingAsks(null, undefined), []);
});
test("T9 view: control captions put an unknown outcome before everything else", () => {
  const base = { canAct: true, targetId: "a1", pending: {}, uncertain: [] as { targetId: string | null }[] };
  assert.equal(controlCaption(base), null);
  assert.equal(controlCaption({ ...base, canAct: false }), RECONNECT_CAPTION);
  assert.equal(controlCaption({ ...base, pending: { a1: "agent.stop" } }), "Waiting for the Host…");
  assert.equal(controlCaption({ ...base, canAct: false, uncertain: [{ targetId: "a1" }] }), OUTCOME_UNKNOWN);
  assert.equal(controlCaption({ ...base, uncertain: [{ targetId: "other" }] }), null);
});
test("T9 view: the mobile attention count covers Agents and unowned Mission asks without double counting", () => {
  const agents = [
    { state: "RUNNING", missionId: "m1", authorization: { state: "ACTIVE" as const, pending: [{ id: "r1" }] as never } },
    { state: "PAUSED", missionId: "m2", authorization: null },
    { state: "FAILED", missionId: null, authorization: null },
  ];
  const missions = [mission([request("r1")]), { id: "m9", requests: [request("x"), request("y", { resolvedAt: 1 })] } as unknown as MissionView];
  assert.equal(attentionCount(agents, missions), 3, "two Agents need attention; m1's ask is the Agent's; m9 adds one");
  assert.equal(attentionLabel(1), "1 item needs attention");
  assert.equal(attentionLabel(3), "3 items need attention");
});
test("T9 view: the device rights summary comes from the Host's rights list only", () => {
  assert.deepEqual(rightsSummary(workstation), []);
  const lines = rightsSummary(device);
  assert.equal(lines.length, 5);
  assert.ok(lines.some((line) => /stay on the Windows Host/.test(line)));
  assert.deepEqual(rightsSummary({ ...device, rights: ["agent.get"] } as SnapshotViewer), ["Read Agents, Missions, Projects and verified artifacts"]);
});
