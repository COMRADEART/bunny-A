import test from "node:test";
import assert from "node:assert/strict";
import { agentDetail, agentRows, autonomyLabel, stepActivity, batchButtonLabel, batchOfferLines, batchStatusLabel, focusMission, justFinished, permissionLabel, progressFraction, progressLabel, scopeSummary, stepDependencyLabel, stepResourceTrail } from "./mission-model.ts";
import type { BatchView, MissionSnapshot, MissionStep, MissionView } from "../../lib/bunny-missions/types.ts";
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
  steps, progress: { kind: "steps", completed: steps.filter((s) => s.state === "completed").length, total: steps.length, failed: 0, running: steps.filter((s) => s.state === "running").length }, requests: [], artifacts: [], batch: null, ...extra,
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

// Gate T9: the batch display is product language only — the shape, the count and the clock are the
// Host's truth; no selectors, no capability JSON, no raw policy.
test("T9: the batch button states what it allows, how many, where and how long", () => {
  assert.equal(batchButtonLabel({ maxActions: 8, targetLabel: "Calculator", ttlMs: 120_000 }), "Allow this small batch · 8 actions · Calculator only · 2 min");
  assert.equal(batchButtonLabel({ maxActions: 1, targetLabel: "Calculator", ttlMs: 120_000 }), "Allow this small batch · 1 action · Calculator only · 2 min");
});
test("T9: the offer lines name covered actions with truthful counts and what is never covered", () => {
  const lines = batchOfferLines({ actions: ["computer.open_app", "computer.type", "computer.list_windows"], counts: { "computer.open_app": 1, "computer.type": 3 }, readOnly: ["computer.list_windows"], maxActions: 8, targetLabel: "Calculator", ttlMs: 120_000 });
  assert.equal(lines.length, 3);
  assert.match(lines[0], /Open its app, Enter text into a field ×3, List windows \(read-only, never counted\)/);
  assert.doesNotMatch(lines[0], /\(read-only\) \(read-only/, "no doubled read-only wording");
  assert.match(lines[1], /At most 8 desktop actions within 2 min/);
  assert.match(lines[2], /never covers shell commands, files, installs, payments, secrets or anything destructive/);
});
test("T9: the batch status line reports the canonical count and each ended reason truthfully", () => {
  const active: Pick<BatchView, "status" | "endReason" | "usedCount" | "maxActions" | "expiresAt" | "targetLabel"> = { status: "active", endReason: null, usedCount: 3, maxActions: 8, expiresAt: 180_000, targetLabel: "Calculator" };
  assert.equal(batchStatusLabel(active, 120_000), "Small approval batch for Calculator: 3 of 8 actions used · 1:00 left.");
  const ended = (reason: typeof active.endReason, phrase: RegExp) => {
    assert.match(batchStatusLabel({ ...active, status: "ended", endReason: reason }, 999_999), phrase);
  };
  ended("exhausted", /all its actions were used after 3 of 8/);
  ended("expired", /it expired after 3 of 8/);
  ended("revoked", /it was revoked after 3 of 8/);
  ended("scope_mismatch", /it reached a window outside its approval after 3 of 8/);
  ended("mission_ended", /the mission ended after 3 of 8/);
  ended("host_restart", /the Host restarted after 3 of 8/);
});

test("T13.3 N-C: a step whose outcome is uncertain shows reconciliation required, never retry available", () => {
  const failed = step("1", "Writer", "failed", { failure: { category: "host_restart", detail: "x" }, reconciliation: { required: true, reason: "OUTCOME_UNCERTAIN: x", at: 1 } });
  assert.equal(stepActivity(failed, null), "Outcome uncertain — reconciliation required");
  assert.equal(stepActivity({ ...failed, reconciliation: undefined }, null), "Interrupted · retry available");
});

test("Visual Experience 2.0: a step names what it waits on and shows each attempt's resource", () => {
  const build = step("b", "build", "completed");
  const review = step("r", "review", "running");
  const ship = step("s", "ship", "pending", { dependsOn: ["b", "r"] });
  assert.equal(stepDependencyLabel(build, [build, review, ship]), "No dependencies");
  assert.equal(stepDependencyLabel(ship, [build, review, ship]), "After build, review (waiting for review)");
  assert.equal(stepDependencyLabel(ship, [build, { ...review, state: "completed" }, ship]), "After build, review (done)");
  assert.equal(stepDependencyLabel(step("x", "x", "pending", { dependsOn: ["gone"] }), []), "After step gone (waiting for an unknown step)");
  const attempt = (n: number, provider: "claude" | "codex" | null, outcome: "failed" | "running") => ({ attempt: n, startedAt: n, finishedAt: null, taskId: null, capabilityRunId: null, provider, outcome, category: null } as MissionStep["attempts"][number]);
  assert.equal(stepResourceTrail(step("a", "a", "running", { attempts: [attempt(1, "claude", "failed")] })), null);
  assert.equal(stepResourceTrail(step("a", "a", "running", { attempts: [attempt(1, "claude", "failed"), attempt(2, "codex", "running")] })), "1: claude (failed) → 2: codex (running)");
  assert.equal(stepResourceTrail(step("a", "a", "running", { attempts: [attempt(1, null, "failed"), attempt(2, null, "running")] })), "1: model (failed) → 2: model (running)");
});

test("M-A-3 T14: the autonomy caption never calls unverified work verified", () => {
  assert.equal(autonomyLabel({ phase: "COMPLETE", basis: "", verified: true }), "Done — verified by Bunny");
  assert.equal(autonomyLabel({ phase: "COMPLETE", basis: "", verified: false }), "Done — not independently verified");
  assert.equal(autonomyLabel({ phase: "RECONCILIATION_REQUIRED", basis: "", verified: null }), "Outcome uncertain — reconciliation required");
  assert.equal(autonomyLabel({ phase: "REPAIR", basis: "", verified: null }), "Repairing a failed check");
});
