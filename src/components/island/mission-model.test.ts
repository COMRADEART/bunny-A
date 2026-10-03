import test from "node:test";
import assert from "node:assert/strict";
import { agentDetail, agentRows, focusMission, justFinished, permissionLabel, progressFraction, progressLabel, scopeSummary } from "./mission-model.ts";
import type { MissionSnapshot, MissionStep, MissionView } from "../../lib/bunny-missions/types.ts";
import type { OrchTask } from "../../lib/orch/types.ts";

const step = (id: string, role: string, state: MissionStep["state"], extra: Partial<MissionStep> = {}): MissionStep => ({
  id, missionId: "m", index: 0, role, objective: `${role} objective`, dependsOn: [], requiredCapabilities: [], reasoning: "standard", preferences: {},
  scope: { root: "C:/p", access: "read", isolation: "shared" }, providerConstraints: {}, modelConstraint: null, executor: { kind: "model" }, expectedArtifacts: [], verification: [],
  maxRetries: 2, timeoutMs: 1000, weight: null, state, taskId: null, capabilityRunId: null, workspace: null, attempts: [], result: null, evidence: [], failure: null,
  accounting: { runtimeMs: 0, local: null, provider: null, model: null, inputTokens: null, outputTokens: null, deterministic: false }, pendingRequestId: null, pendingPhase: null, approvedOnce: null, startedAt: null, finishedAt: null, ...extra,
});
const mission = (id: string, state: MissionView["state"], steps: MissionStep[], extra: Partial<MissionView> = {}): MissionView => ({
  id, title: `Mission ${id}`, objective: "o", request: "o", projectId: null, root: "C:/p", mode: "balanced", state, origin: "workstation", createdAt: 1, updatedAt: 1, startedAt: 1, finishedAt: null,
  planning: { planner: "p", complexity: "medium", rationale: [], replans: 0, plannedAt: 1 }, requestedScope: null, authorizationId: null, capabilityRequirements: [], providerConstraints: {},
  budget: { maxExternalModelCalls: 6, maxRuntimeMs: 3_600_000, maxRetries: 4, maxTokens: null }, retryPolicy: { maxRetriesPerStep: 2 }, verificationRequired: false, result: null, failure: null, recovery: null,
  accounting: { runtimeMs: 0, externalModelCalls: 0, localModelCalls: 0, deterministicSteps: 0, retries: 0, inputTokens: 0, outputTokens: 0, tokensReported: false },
  steps, progress: { kind: "steps", completed: steps.filter((s) => s.state === "completed").length, total: steps.length, failed: 0, running: steps.filter((s) => s.state === "running").length }, requests: [], artifacts: [], ...extra,
});
const snapshot = (missions: MissionView[], enabled = true): MissionSnapshot => ({ enabled, config: { enabled, triggersEnabled: false, browserHeadless: true, limits: { maxConcurrentAgents: 3, maxSteps: 12, maxRetriesPerStep: 2, maxReplans: 2, maxMissionRuntimeMs: 1, maxActiveMissions: 3 } }, missions, inbox: [], capabilities: [], skills: [], triggers: [] });

test("the Bar focuses a mission that needs the user, then a running one; nothing when disabled", () => {
  const running = mission("a", "running", [step("1", "Code", "running")]);
  const asking = mission("b", "waiting_for_user", [step("2", "Test", "waiting_for_approval")]);
  assert.equal(focusMission(snapshot([running, asking]))?.id, "b");
  assert.equal(focusMission(snapshot([running, mission("c", "completed", [])]))?.id, "a");
  assert.equal(focusMission(snapshot([running], false)), null);
  assert.equal(focusMission(null), null);
});
test("completion state shows briefly, then the Bar collapses back", () => {
  const done = mission("a", "completed", [step("1", "Code", "completed")], { finishedAt: 10_000 });
  assert.equal(justFinished(snapshot([done]), 12_000)?.id, "a");
  assert.equal(justFinished(snapshot([done]), 30_000), null);
  assert.equal(justFinished(snapshot([done]), 0), null, "no clock, no completion state");
});
test("progress text comes from step counts only, never elapsed time", () => {
  assert.equal(progressLabel({ kind: "steps", completed: 5, total: 8, failed: 0, running: 1 }), "5 / 8 steps");
  assert.equal(progressFraction({ kind: "steps", completed: 0, total: 0, failed: 0, running: 0 }), null);
  assert.equal(progressLabel({ kind: "weighted", completedWeight: 3, totalWeight: 4, completed: 1, total: 2, failed: 0, running: 1 }), "3 / 4 weighted · 1 / 2 steps");
});
test("agent rows: glyphs per role, at most four with +N, attention first when truncated", () => {
  const steps = [step("1", "Research", "completed"), step("2", "Architecture", "completed"), step("3", "Code", "running"), step("4", "Test", "pending"), step("5", "Review", "pending"), step("6", "Docs", "waiting_for_approval")];
  const { rows, more } = agentRows(mission("a", "running", steps), [], 4);
  assert.equal(more, 2);
  assert.ok(rows.some((r) => r.role === "Docs" && r.glyph === "!"), "a step waiting for permission is never hidden");
  assert.ok(rows.some((r) => r.role === "Code" && r.glyph === "●"));
  assert.deepEqual(rows.map((r) => r.role), steps.map((s) => s.role).filter((role) => rows.some((r) => r.role === role)), "plan order is kept");
  assert.deepEqual(agentRows(mission("a", "running", steps.slice(0, 3)), [], 4).rows.map((r) => r.glyph), ["✓", "✓", "●"]);
});
test("agent detail: provider activity from the child task; progress only from a published finite plan", () => {
  const task = { id: "t1", provider: "codex", model: "gpt-x", latestEvent: { type: "agent.editing", detail: "x", at: 1, label: "Editing" }, progress: { kind: "indeterminate" } } as unknown as OrchTask;
  const m = mission("a", "running", [step("1", "Code", "running", { taskId: "t1", startedAt: 1 })]);
  const detail = agentDetail(m, "1", [task])!;
  assert.equal(detail.activity, "Editing"); assert.equal(detail.provider, "codex"); assert.equal(detail.progress, null, "indeterminate stays indeterminate");
  const planned = { ...task, progress: { kind: "determinate", completed: 2, total: 5, source: "todo" } } as unknown as OrchTask;
  assert.deepEqual(agentDetail(m, "1", [planned])!.progress, { completed: 2, total: 5 });
  const capability = mission("b", "running", [step("9", "Search", "running", { executor: { kind: "capability", action: "browser.search", params: {} } })]);
  assert.equal(agentDetail(capability, "9", [])!.capability, "browser.search");
  assert.equal(agentDetail(capability, "9", [])!.progress, null);
});
test("approval card summarizes the requested scope truthfully", () => {
  const m = mission("a", "waiting_for_approval", [step("1", "Code", "pending")], { requestedScope: {
    projectRoots: ["C:/p"], riskClasses: ["READ", "WRITE", "EXECUTE"], capabilities: ["terminal.exec"], providers: { execution: true, allow: null, localOnly: false },
    filesystem: { read: ["C:/p"], write: ["C:/p"] }, browser: { enabled: false, domains: "public" }, terminal: { enabled: true, commands: ["npm"] }, git: { actions: [] }, network: { allowed: false }, computer: { enabled: false },
    budget: { maxExternalModelCalls: 6, maxRuntimeMs: 3_600_000, maxRetries: 4, maxTokens: null }, alwaysAsk: ["EXTERNAL_SIDE_EFFECT", "DESTRUCTIVE"] } });
  const lines = scopeSummary(m);
  assert.ok(lines.includes("Folder: C:/p (read & write)"));
  assert.ok(lines.includes("AI agents: up to 6 cloud calls"));
  assert.ok(lines.includes("Commands: npm"));
  assert.ok(lines.some((line) => /always asks for external side effect and destructive/.test(line)));
  assert.ok(!lines.some((line) => /browser/i.test(line)), "nothing is claimed that was not requested");
});

test("MA0R: approval explains read/write agent authority, shell access, bounded sessions and separate external approval", () => {
  const steps = [step("r", "Custom inspector", "pending"), step("w", "Research", "pending", { scope: { root: "C:/p", access: "write", isolation: "shared" } })];
  const m = mission("a", "waiting_for_approval", steps, { requestedScope: {
    projectRoots: ["C:/p"], riskClasses: ["READ", "WRITE", "EXECUTE"], capabilities: [], providers: { execution: true, allow: ["codex", "claude"], localOnly: false, sessions: { steps: steps.map((step) => ({ stepId: step.id, scope: { access: step.scope.access } })), maxSessions: 10, writeIncludesShell: true } },
    filesystem: { read: ["C:/p"], write: ["C:/p"] }, browser: { enabled: false, domains: "public" }, terminal: { enabled: false, commands: [] }, git: { actions: [] }, network: { allowed: false }, computer: { enabled: false },
    budget: { maxExternalModelCalls: 6, maxRuntimeMs: 3_600_000, maxRetries: 4, maxTokens: null }, alwaysAsk: ["EXTERNAL_SIDE_EFFECT", "DESTRUCTIVE"] } });
  const text = scopeSummary(m).join("\n");
  assert.match(text, /Custom inspector \(read only\)/); assert.match(text, /Research \(write & shell capable\)/);
  assert.match(text, /up to 10, including retries/); assert.match(text, /provider permissions/);
  assert.match(text, /External effects inside an agent session are governed by the provider/);
});
test("MA0R: approval wording distinguishes one capability action from matching actions in this skill run", () => {
  const m = mission("a", "waiting_for_user", [step("s", "Skill", "waiting_for_approval", { executor: { kind: "skill", skillId: "two", params: {} } }), step("c", "Capability", "waiting_for_approval", { executor: { kind: "capability", action: "filesystem.write", params: {} } })]);
  assert.equal(permissionLabel(m, "s"), "Allow this skill run");
  assert.equal(permissionLabel(m, "c"), "Allow once");
});
test("MA1: a stopped or skipped step never reads as running", () => {
  const stopped = mission("a", "stopped", [
    step("1", "Test", "stopped", { executor: { kind: "skill", skillId: "project.test", params: {} } }),
    step("2", "Run", "stopped", { executor: { kind: "capability", action: "terminal.exec", params: {} } }),
    step("3", "Code", "stopped", { taskId: "t1" }),
    step("4", "Docs", "skipped"),
  ]);
  const task = { id: "t1", provider: "codex", latestEvent: { type: "agent.editing", detail: "x", at: 1, label: "Editing" } } as unknown as OrchTask;
  assert.deepEqual(agentRows(stopped, [task], 4).rows.map((r) => r.activity), ["Stopped", "Stopped", "Stopped", "Skipped"]);
  assert.equal(agentDetail(stopped, "1", [task])!.activity, "Stopped");
});
