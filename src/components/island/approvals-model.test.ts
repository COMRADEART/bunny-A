import test from "node:test";
import assert from "node:assert/strict";
import { answerableHere, approvalAnswer, approvalCount, pendingApprovalItems, type ApprovalInput } from "./approvals-model.ts";

type Input = Omit<ApprovalInput, "tasks" | "missions" | "agents"> & {
  tasks?: Partial<ApprovalInput["tasks"][number]>[];
  missions?: unknown[];
  agents?: unknown[];
};
const run = (input: Input) => pendingApprovalItems({ tasks: [], missions: [], agents: [], ...input } as unknown as ApprovalInput);
const task = (id: string, state: string, extra: Record<string, unknown> = {}) => ({
  id,
  state,
  provider: "codex",
  title: `Task ${id}`,
  createdAt: 100,
  ...extra,
});
const request = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  reason: `reason ${id}`,
  createdAt: 200,
  resolvedAt: null,
  remote: { answerable: true, reason: null },
  ...extra,
});
const mission = (id: string, requests: unknown[] = []) => ({ id, title: `Mission ${id}`, requests });
const agent = (id: string, state: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: `Agent ${id}`,
  state,
  missionId: null,
  authorization: null,
  ...extra,
});

test("T13 approvals: a task waiting for approval outside a Mission is one ask, answered in the Task decision view", () => {
  const items = run({ tasks: [task("t1", "waiting_for_approval"), task("t2", "running")], viewer: "workstation" } as Input);
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, "task");
  assert.deepEqual(items[0].target, { sheet: "decision", taskId: "t1" });
  assert.equal(items[0].title, "Codex task needs approval");
});

test("T13 approvals: a task inside a Mission is not listed here; the Mission owns its ask", () => {
  const items = run({ tasks: [task("t1", "waiting_for_approval", { mission: { missionId: "m1" } })], viewer: "workstation" } as Input);
  assert.equal(items.length, 0);
});

test("T13 approvals: only unresolved Mission permission requests count", () => {
  const items = run({
    missions: [mission("m1", [request("r1"), request("r2", { resolvedAt: 300 })])],
    viewer: "workstation",
  } as Input);
  assert.deepEqual(items.map((item) => item.id), ["r1"]);
  assert.deepEqual(items[0].target, { sheet: "missions", missionId: "m1", agentId: null });
});

test("T13 approvals: an Agent waiting on the same Mission request is that one ask, not two", () => {
  const items = run({
    missions: [mission("m1", [request("r1")])],
    agents: [agent("a1", "WAITING_FOR_USER", { missionId: "m1" })],
    viewer: "workstation",
  } as Input);
  assert.equal(items.length, 1, "the Mission request is the single ask");
  assert.equal(items[0].id, "r1");
});

test("T13 approvals: a consent offer is its own ask even while the Agent reads RUNNING", () => {
  const items = run({
    agents: [agent("a1", "RUNNING", { authorization: { state: "WAITING_FOR_USER" } })],
    viewer: "workstation",
  } as Input);
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, "agent_consent");
  assert.equal(items[0].id, "consent:a1");
  assert.deepEqual(items[0].target, { sheet: "missions", missionId: null, agentId: "a1" });
});

test("T13 approvals: a waiting Agent with no Mission request is still a listed ask, answered in its Agent panel", () => {
  const items = run({ agents: [agent("a1", "WAITING_FOR_USER", { missionId: "m9" })], viewer: "workstation" } as Input);
  assert.equal(items.length, 1);
  // Never a mission_request: that kind gets Allow/Deny buttons, and its id is not a Mission request id.
  assert.equal(items[0].kind, "agent_consent");
  assert.equal(items[0].id, "consent:a1");
});

test("T13 approvals: a paired device answers only what the Host marks answerable; the rest carry the reason", () => {
  const items = run({
    missions: [mission("m1", [request("ok"), request("no", { remote: { answerable: false, reason: "Desktop-only ask." } })])],
    viewer: "device",
  } as Input);
  const byId = Object.fromEntries(items.map((item) => [item.id, item.answer]));
  assert.deepEqual(byId.ok, { kind: "answerable" });
  assert.deepEqual(byId.no, { kind: "not-answerable", reason: "Desktop-only ask." });
  assert.equal(answerableHere(items).length, 1);
});

test("T13 approvals: a device with no remote reason still gets a plain instruction, never a control", () => {
  assert.deepEqual(approvalAnswer({ remote: undefined, desktopRequired: true } as never, "device"), {
    kind: "not-answerable",
    reason: "Answer this one on your workstation.",
  });
  assert.deepEqual(approvalAnswer({ remote: { answerable: false, reason: "" } } as never, "device"), {
    kind: "not-answerable",
    reason: "Answer this one on your workstation.",
  });
  assert.deepEqual(approvalAnswer({ remote: undefined } as never, "workstation"), { kind: "answerable" });
});

test("T13 approvals: the union counts every kind once and orders newest first", () => {
  const items = run({
    tasks: [task("t1", "waiting_for_approval", { createdAt: 50 })],
    missions: [mission("m1", [request("r1", { createdAt: 300 }), request("r2", { createdAt: 100 })])],
    agents: [agent("a1", "RUNNING", { authorization: { state: "WAITING_FOR_USER" } })],
    viewer: "workstation",
  } as Input);
  assert.equal(approvalCount(items), 4);
  assert.deepEqual(items.map((item) => item.id), ["r1", "r2", "t1", "consent:a1"], "newest first; an ask with no timestamp sorts last");
});

test("T13 approvals: an empty Host has no approvals", () => {
  assert.deepEqual(run({ viewer: "workstation" } as Input), []);
});

test("T13 approvals: a device does not claim it can answer a waiting task; the workstation can", () => {
  const task = { id: "t1", state: "waiting_for_approval", provider: "codex", title: "Write", createdAt: 5 };
  const device = pendingApprovalItems({ tasks: [task], missions: [], agents: [], viewer: "device" } as never);
  assert.equal(device[0].answer.kind, "not-answerable");
  const workstation = pendingApprovalItems({ tasks: [task], missions: [], agents: [], viewer: "workstation" } as never);
  assert.equal(workstation[0].answer.kind, "answerable");
});
