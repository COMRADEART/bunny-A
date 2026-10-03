import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { TaskManager } from "../bunny-host/manager.server.ts";
import type { HostEvent } from "../bunny-host/contracts.ts";
import type { Mode, OrchTask, ProviderId, TaskConstraints, VerifySpec } from "../orch/types.ts";
import { ArtifactStore } from "./artifacts.server.ts";
import { envelopeFrom, MODE_BUDGET, providerScopeViolation, scopeFor, taskViolation } from "./authorization.server.ts";
import { CapabilityBus, type CapabilityAdapter, type CapabilityRequest } from "./capabilities/bus.server.ts";
import { BrowserCapability } from "./capabilities/browser.server.ts";
import { ComputerCapability } from "./capabilities/computer.server.ts";
import { communicationConnectors, GitHubCapability } from "./capabilities/connectors.server.ts";
import { FilesystemCapability, GitCapability, NotificationsCapability, TerminalCapability } from "./capabilities/local.server.ts";
import { agentPrompt, type DependencyResult } from "./context.ts";
import { Inbox } from "./inbox.server.ts";
import {
  assertMissionTransition, assertStepTransition, blockedBy, classifyTaskFailure, MISSION_ACTIVE, missionProgress, readySteps, retryVerdict, STEP_DONE, validateGraph,
} from "./machine.ts";
import { MissionMemory } from "./memory.server.ts";
import { scopedPath } from "./paths.server.ts";
import { runsLocally } from "../bunny-host/router.ts";
import { planMission, PLANNER_ID } from "./planner.server.ts";
import { SkillLibrary } from "./skills.server.ts";
import { MissionStore } from "./store.server.ts";
import { TriggerEngine } from "./triggers.server.ts";
import type {
  AuthorizationEnvelope, CapabilityResult, FailureCategory, Mission, MissionConfig, MissionSnapshot, MissionStep, MissionView,
  PermissionRequest, StepState, Trigger,
} from "./types.ts";
import { WorkspaceCoordinator } from "./workspace.server.ts";

const TASK_END = /^task\.(completed|failed|stopped)$/;
const STEP_LIVE: StepState[] = ["running", "verifying"];
const EMPTY_ACCOUNTING = { runtimeMs: 0, externalModelCalls: 0, localModelCalls: 0, deterministicSteps: 0, retries: 0, inputTokens: 0, outputTokens: 0, tokensReported: false };

export type MissionManagerOptions = {
  dataDirectory: string;
  /** Replaces the built-in capability set (tests). */
  adapters?: CapabilityAdapter[];
  browser?: { allowLoopback?: boolean };
};
export type CreateMission = { objective: string; title?: string; mode: Mode; projectId?: string | null; steps?: unknown; localOnly?: boolean; providers?: ProviderId[] | null; origin: string };

/**
 * MissionManager: the layer above TaskManager. It plans a bounded step graph, persists it, asks for one
 * scoped approval, then schedules steps — model steps as ordinary child tasks through TaskManager with a
 * delegated approval inside the envelope, deterministic steps through the Capability Bus. It never calls
 * a provider adapter itself.
 */
export class MissionManager {
  tasks: TaskManager; store: MissionStore; bus: CapabilityBus; artifacts: ArtifactStore; memory: MissionMemory; inbox: Inbox;
  skills: SkillLibrary; workspace: WorkspaceCoordinator; triggers: TriggerEngine; dataDirectory: string;
  cached: MissionConfig; recovered = false; ticking = new Set<string>(); again = new Set<string>(); pending = new Map<string, ReturnType<typeof setImmediate>>();
  watchdog: ReturnType<typeof setInterval> | null = null; healthTimer: ReturnType<typeof setInterval> | null = null; closed = false;
  stopping = new Set<string>();
  listener = (event: HostEvent) => this.onHostEvent(event);

  constructor(tasks: TaskManager, options: MissionManagerOptions) {
    this.tasks = tasks; this.dataDirectory = options.dataDirectory;
    this.store = new MissionStore(tasks.db);
    tasks.missionScopeCheck = (task) => {
      const mission = this.store.mission(task.mission!.missionId);
      const envelope = mission.authorizationId ? this.store.authorization(mission.authorizationId) : null;
      return envelope ? providerScopeViolation(task, envelope, this.store.step(task.mission!.stepId)) : "no approved mission envelope";
    };
    this.cached = this.store.config();
    this.artifacts = new ArtifactStore(this.store, options.dataDirectory);
    this.memory = new MissionMemory(this.store);
    this.inbox = new Inbox(this.store);
    this.bus = new CapabilityBus(this.store, this.artifacts, options.dataDirectory, (type, detail, missionId) => this.emit(type, detail, missionId));
    const adapters = options.adapters ?? [
      new FilesystemCapability(), new TerminalCapability(), new GitCapability(options.dataDirectory),
      new NotificationsCapability((title, detail, missionId) => this.emit("notification.sent", `${title}${detail ? `\n${detail}` : ""}`, missionId)),
      new BrowserCapability(options.dataDirectory, { headless: this.cached.browserHeadless, allowLoopback: options.browser?.allowLoopback }),
      new ComputerCapability(options.dataDirectory), new GitHubCapability(), ...communicationConnectors(),
    ];
    for (const adapter of adapters) this.bus.register(adapter);
    this.skills = new SkillLibrary(this.store, this.bus, (type, detail, missionId) => this.emit(type, detail, missionId));
    this.workspace = new WorkspaceCoordinator(this.store);
    this.triggers = new TriggerEngine(this.store, (type, detail) => this.emit(type, detail, null), (trigger, cause) => this.act(trigger, cause));
    tasks.workspaceRoots.push(join(options.dataDirectory, "worktrees"));
    tasks.bus.on("event", this.listener);
    if (this.cached.enabled) this.activate();
  }

  // ── configuration / feature flag ──────────────────────────────────────────
  config(): MissionConfig { return this.cached; }
  enabled() { return this.cached.enabled; }
  /** Starts the background parts. Called at construction when enabled, or when the workstation enables missions. */
  activate() {
    if (!this.recovered) { this.recovered = true; this.recover(); }
    void this.bus.refreshHealth();
    this.healthTimer ??= setInterval(() => void this.bus.refreshHealth(), 5 * 60_000);
    this.watchdog ??= setInterval(() => { for (const mission of this.store.missionsIn(["running"])) this.schedule(mission.id); }, 15_000);
    this.healthTimer.unref?.(); this.watchdog.unref?.();
    this.triggers.start(() => this.cached.enabled && this.cached.triggersEnabled);
  }
  deactivate() {
    if (this.healthTimer) clearInterval(this.healthTimer); if (this.watchdog) clearInterval(this.watchdog);
    this.healthTimer = null; this.watchdog = null; this.triggers.stop();
  }
  configure(patch: Record<string, unknown>, by: string): MissionConfig {
    const next: MissionConfig = { ...this.cached, limits: { ...this.cached.limits } };
    if (patch.enabled !== undefined) { if (typeof patch.enabled !== "boolean") throw new Error("enabled must be true or false."); next.enabled = patch.enabled; }
    if (patch.triggersEnabled !== undefined) { if (typeof patch.triggersEnabled !== "boolean") throw new Error("triggersEnabled must be true or false."); next.triggersEnabled = patch.triggersEnabled; }
    if (patch.browserHeadless !== undefined) { if (typeof patch.browserHeadless !== "boolean") throw new Error("browserHeadless must be true or false."); next.browserHeadless = patch.browserHeadless; }
    const bounds: Record<keyof MissionConfig["limits"], [number, number]> = { maxConcurrentAgents: [1, 6], maxSteps: [1, 20], maxRetriesPerStep: [0, 5], maxReplans: [0, 5], maxMissionRuntimeMs: [60_000, 6 * 3_600_000], maxActiveMissions: [1, 10] };
    const limits = (patch.limits ?? {}) as Record<string, unknown>;
    for (const [key, value] of Object.entries(limits)) {
      const range = bounds[key as keyof typeof bounds];
      if (!range) throw new Error(`Unknown mission limit ${key}.`);
      if (!Number.isInteger(value) || (value as number) < range[0] || (value as number) > range[1]) throw new Error(`${key} must be an integer from ${range[0]} to ${range[1]}.`);
      next.limits[key as keyof typeof bounds] = value as number;
    }
    if (process.env.BUNNY_MISSIONS === "0" || process.env.BUNNY_MISSIONS === "1") next.enabled = process.env.BUNNY_MISSIONS === "1";
    this.store.saveConfig(next); this.cached = next;
    const browser = this.bus.adapters.get("browser") as BrowserCapability | undefined; if (browser) browser.headless = next.browserHeadless;
    if (next.enabled) this.activate(); else this.deactivate();
    this.emit("mission.configured", `Missions ${next.enabled ? "enabled" : "disabled"}, triggers ${next.triggersEnabled ? "enabled" : "disabled"} by ${by}. Limits: ${JSON.stringify(next.limits)}.`, null);
    return next;
  }
  requireEnabled() { if (!this.cached.enabled) throw new Error("Missions are disabled on this Host. Direct tasks are unaffected; enable missions in Settings to use them."); }

  // ── events ────────────────────────────────────────────────────────────────
  emit(type: string, detail: string, missionId: string | null) {
    if (this.closed) return;
    try { this.tasks.emit(this.tasks.db.event(type, null, detail, missionId)); } catch { /* Database closed during shutdown. */ }
  }
  onHostEvent(event: HostEvent) {
    if (!this.cached.enabled || this.closed) return;
    try { this.inbox.ingest(event); } catch { /* Inbox is advisory. */ }
    if (event.taskId && (TASK_END.test(event.type) || event.type === "approval.accepted")) {
      const step = this.store.stepForTask(event.taskId);
      if (step) setImmediate(() => { try { if (this.stopping.has(step.missionId)) return; if (event.type === "approval.accepted") this.childApprovedDirectly(step.id, event.taskId!); else void this.finishModelStep(step.id, event.taskId!); } catch (error) { this.emit("mission.error", `Step ${step.id}: ${error instanceof Error ? error.message : String(error)}`, step.missionId); } });
    }
    if (this.cached.triggersEnabled) void this.triggers.onEvent(event, true);
  }

  // ── records ───────────────────────────────────────────────────────────────
  mission(id: string) { return this.store.mission(id); }
  setMission(mission: Mission, patch: Partial<Mission>, type?: string, detail?: string): Mission {
    if (patch.state) assertMissionTransition(mission.state, patch.state);
    const next = { ...mission, ...patch, updatedAt: Date.now() };
    this.store.saveMission(next);
    if (type) this.emit(type, detail ?? "", mission.id);
    return next;
  }
  setStep(step: MissionStep, patch: Partial<MissionStep>, type?: string, detail?: string): MissionStep {
    if (patch.state) assertStepTransition(step.state, patch.state);
    const next = { ...step, ...patch };
    this.store.saveStep(next);
    if (type) this.emit(type, `${detail ?? ""} (step ${step.id})`, step.missionId);
    return next;
  }
  view(mission: Mission): MissionView {
    const steps = this.store.steps(mission.id);
    const requests = this.store.requests(mission.id).sort((a, b) => b.createdAt - a.createdAt).slice(0, 20);
    const artifacts = this.store.artifacts(mission.id).slice(-30);
    return { ...mission, steps, progress: missionProgress(steps), requests, artifacts };
  }
  get(id: string) {
    const mission = this.store.mission(id);
    return { mission: this.view(mission), events: this.store.missionEvents(id).slice(-200), memory: this.memory.entries(id).slice(-60), authorization: mission.authorizationId ? this.store.authorization(mission.authorizationId) : null, runs: this.store.runs({ missionId: id, limit: 50 }) };
  }
  snapshot(): MissionSnapshot {
    const capabilities = this.bus.list();
    if (!this.cached.enabled) return { enabled: false, config: this.cached, missions: [], inbox: [], capabilities, skills: [], triggers: [] };
    return {
      enabled: true, config: this.cached,
      missions: this.store.missions(15).map((mission) => this.view(mission)),
      inbox: this.inbox.recent(30), capabilities,
      skills: this.skills.list().map(({ id, version, name, description, status, reliability }) => ({ id, version, name, description, status, reliability })),
      triggers: this.store.triggers(),
    };
  }

  // ── create / plan / approve ───────────────────────────────────────────────
  create(input: CreateMission): MissionView {
    this.requireEnabled();
    const objective = input.objective.trim();
    if (!objective || objective.length > 8000) throw new Error("Mission objective must be 1–8,000 characters.");
    const project = input.projectId ? this.tasks.db.projects().find((p) => p.id === input.projectId) : null;
    if (input.projectId && !project) throw new Error("Project is not registered on this Host.");
    const now = Date.now();
    const mission: Mission = {
      id: crypto.randomUUID(), title: (input.title?.trim() || objective.split("\n")[0]).slice(0, 80), objective, request: input.objective, projectId: project?.id ?? null, root: project?.path ?? this.tasks.defaultRoot,
      mode: input.mode, state: "draft", origin: input.origin, createdAt: now, updatedAt: now, startedAt: null, finishedAt: null,
      planning: { planner: PLANNER_ID, complexity: "simple", rationale: [], replans: 0, plannedAt: null }, requestedScope: null, authorizationId: null, capabilityRequirements: [],
      providerConstraints: { allow: input.providers ?? undefined, localOnly: !!input.localOnly }, budget: MODE_BUDGET[input.mode],
      retryPolicy: { maxRetriesPerStep: this.cached.limits.maxRetriesPerStep }, verificationRequired: false, result: null, failure: null, recovery: null, accounting: { ...EMPTY_ACCOUNTING },
    };
    this.store.saveMission(mission);
    this.emit("mission.created", `Mission "${mission.title}" created by ${input.origin} (${mission.mode}).`, mission.id);
    return this.view(this.plan(mission, input.steps));
  }
  plan(mission: Mission, explicit?: unknown): Mission {
    let current = this.setMission(mission, { state: "planning" }, "mission.planning", `Planning with ${PLANNER_ID}.`);
    try {
      const plan = planMission({ objective: current.objective, mode: current.mode, root: current.root, localOnly: !!current.providerConstraints.localOnly, available: (action) => ["available", "degraded"].includes(this.bus.availability(action)), limits: this.cached.limits, explicit });
      const ids = new Map(plan.steps.map((step) => [step.key, crypto.randomUUID()]));
      const kept = this.store.steps(current.id).filter((step) => step.state === "completed");
      const steps: MissionStep[] = plan.steps.map((draft, index) => ({
        id: ids.get(draft.key)!, missionId: current.id, index: kept.length + index, role: draft.role, objective: draft.objective, dependsOn: draft.dependsOn.map((key) => ids.get(key)!),
        requiredCapabilities: draft.requiredCapabilities, reasoning: draft.reasoning, preferences: { ...draft.preferences, independentOf: draft.preferences.independentOf?.map((key) => ids.get(key)!).filter(Boolean) },
        scope: { root: current.root, access: draft.access, isolation: draft.isolation }, providerConstraints: draft.providerConstraints, modelConstraint: draft.modelConstraint, executor: draft.executor,
        expectedArtifacts: draft.expectedArtifacts, verification: draft.verification, maxRetries: Math.min(draft.maxRetries ?? this.cached.limits.maxRetriesPerStep, this.cached.limits.maxRetriesPerStep), timeoutMs: draft.timeoutMs, weight: draft.weight,
        state: "pending", taskId: null, capabilityRunId: null, workspace: null, attempts: [], result: null, evidence: [], failure: null,
        accounting: { runtimeMs: 0, local: null, provider: null, model: null, inputTokens: null, outputTokens: null, deterministic: draft.executor.kind !== "model" },
        pendingRequestId: null, pendingPhase: null, approvedOnce: null, startedAt: null, finishedAt: null,
      }));
      const problem = validateGraph([...kept, ...steps], this.cached.limits);
      if (problem) throw new Error(problem);
      for (const step of steps) {
        if (step.executor.kind === "skill") { const skill = this.skills.get(step.executor.skillId); if (skill.status !== "active") throw new Error(`Skill ${skill.id} is an unverified candidate.`); }
        if (step.executor.kind === "capability" && !this.bus.find(step.executor.action)) throw new Error(`Unknown capability action ${step.executor.action}.`);
      }
      this.store.replaceSteps(current.id, [...kept, ...steps]);
      const requestedScope = scopeFor(steps, current.root, current.mode, { localOnly: current.providerConstraints.localOnly, providers: current.providerConstraints.allow ?? null, skillSteps: (id) => this.skills.get(id).steps });
      current = this.setMission(current, {
        state: "waiting_for_approval", requestedScope, capabilityRequirements: requestedScope.capabilities, budget: requestedScope.budget,
        verificationRequired: steps.some((step) => step.verification.length > 0),
        planning: { ...current.planning, complexity: plan.complexity, rationale: plan.rationale, plannedAt: Date.now() },
      }, "mission.planned", `${steps.length} step(s): ${steps.map((step) => step.role).join(" → ")}. ${plan.rationale.join(" ")}`);
      this.emit("mission.approval_required", `Mission ${current.id} "${current.title}" needs approval: ${requestedScope.riskClasses.join(", ")}; capabilities ${requestedScope.capabilities.join(", ")}; ${requestedScope.providers.execution ? `up to ${requestedScope.budget.maxExternalModelCalls} external model call(s)` : "no model calls"}.`, current.id);
      return current;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return this.setMission(this.store.mission(current.id), { state: "failed", finishedAt: Date.now(), failure: { category: "invalid_plan", detail, stepId: null } }, "mission.failed", `Planning failed: ${detail}`);
    }
  }
  approve(id: string, by: string, start = true): MissionView {
    this.requireEnabled();
    let mission = this.store.mission(id);
    if (mission.state !== "waiting_for_approval" || !mission.requestedScope) throw new Error("Mission is not waiting for approval.");
    const active = this.store.missionsIn(MISSION_ACTIVE).length;
    if (active >= this.cached.limits.maxActiveMissions) throw new Error(`${active} missions are already active (limit ${this.cached.limits.maxActiveMissions}).`);
    const steps = this.store.steps(id);
    const requestedScope = mission.requestedScope;
    const plannedAuthority = steps.filter((step) => step.executor.kind === "model" && step.state !== "completed").map((step) => ({ stepId: step.id, scope: { access: step.scope.access } }));
    if (plannedAuthority.length && (!requestedScope.providers.sessions || JSON.stringify(requestedScope.providers.sessions.steps) !== JSON.stringify(plannedAuthority))) throw new Error("Provider execution scope changed or is missing; replan and review the new scope before approval.");
    const extra = steps.some((step) => step.scope.isolation === "worktree") ? [join(this.dataDirectory, "worktrees", id.slice(0, 8))] : [];
    const envelope = envelopeFrom(requestedScope, id, by, this.cached.limits.maxMissionRuntimeMs, extra);
    this.store.saveAuthorization(envelope);
    this.memory.record(id, "user_decision", "Mission approved", `${by} approved ${envelope.riskClasses.join("/")} in ${envelope.projectRoots.join(", ")} until ${new Date(envelope.expiresAt).toISOString()}.`, `user:${by}`, true);
    this.emit("approval.mission_envelope", `Mission envelope ${envelope.id} by ${by}; provider sessions ${JSON.stringify(envelope.providers.sessions)}.`, id);
    if (by.startsWith("device:")) this.emit("approval.remote_device", `Mission envelope ${envelope.id} approved by paired ${by}; same scope as workstation approval.`, id);
    mission = this.setMission(mission, { state: "ready", authorizationId: envelope.id }, "authorization.granted", `Mission authorization ${envelope.id} granted by ${by}: roots ${envelope.projectRoots.join(", ")}; ${envelope.riskClasses.join(", ")}; terminal [${envelope.terminal.commands.join(", ")}]; git [${envelope.git.actions.join(", ")}]; browser ${envelope.browser.enabled ? "on" : "off"}; computer ${envelope.computer.enabled ? "on" : "off"}; expires ${new Date(envelope.expiresAt).toISOString()}.`);
    this.inbox.resolve(id, { kinds: ["requires_approval"] });
    if (start) mission = this.start(mission);
    return this.view(mission);
  }
  start(mission: Mission): Mission {
    this.bus.clearCancellation(mission.id);
    const next = this.setMission(mission, { state: "running", startedAt: mission.startedAt ?? Date.now() }, "mission.started", `Mission "${mission.title}" started.`);
    this.schedule(next.id);
    return next;
  }

  // ── scheduling ────────────────────────────────────────────────────────────
  schedule(id: string) {
    if (this.closed || this.pending.has(id)) return;
    this.pending.set(id, setImmediate(() => { this.pending.delete(id); void this.tick(id); }));
  }
  async tick(id: string) {
    if (this.ticking.has(id)) { this.again.add(id); return; }
    this.ticking.add(id);
    try { await this.tickOnce(id); }
    catch (error) { this.emit("mission.error", `Scheduler: ${error instanceof Error ? error.message : String(error)}`, id); }
    finally { this.ticking.delete(id); if (this.again.delete(id)) this.schedule(id); }
  }
  async tickOnce(id: string) {
    let mission = this.store.mission(id);
    if (mission.state !== "running" || !this.cached.enabled || this.stopping.has(id)) return;
    const envelope = mission.authorizationId ? this.store.authorization(mission.authorizationId) : null;
    if (!envelope) { await this.failMission(mission, "permission_required", "Mission has no authorization.", null); return; }
    const limit = Math.min(envelope.budget.maxRuntimeMs, this.cached.limits.maxMissionRuntimeMs);
    if (mission.startedAt && Date.now() - mission.startedAt > limit) { await this.failMission(mission, "budget_exceeded", `Mission runtime limit (${Math.round(limit / 60_000)} min) reached.`, null); return; }
    let steps = this.store.steps(id);
    for (const step of readySteps(steps)) if (step.state === "pending") this.setStep(step, { state: "ready" }, "mission.step.ready", `${step.role} is ready.`);
    steps = this.store.steps(id);
    let busy = steps.filter((step) => STEP_LIVE.includes(step.state)).length;
    for (const step of steps.filter((item) => item.state === "ready")) {
      if (busy >= this.cached.limits.maxConcurrentAgents) break;
      if (await this.launch(mission, this.store.step(step.id), envelope)) busy++;
      mission = this.store.mission(id);
      if (mission.state !== "running" || this.stopping.has(id)) return;
    }
    this.evaluate(this.store.mission(id));
  }
  /** Decides whether the mission is finished, failed or waiting, from graph state only. */
  evaluate(mission: Mission) {
    if (mission.state !== "running") return;
    const steps = this.store.steps(mission.id);
    if (steps.every((step) => STEP_DONE.includes(step.state))) { this.completeMission(mission, steps); return; }
    // Pending steps can only be waiting on something; if nothing is running or ready, the mission cannot move by itself.
    const progressing = steps.some((step) => STEP_LIVE.includes(step.state) || step.state === "ready");
    const waiting = steps.filter((step) => step.state === "waiting_for_approval");
    if (progressing) return;
    if (waiting.length) { this.setMission(mission, { state: "waiting_for_user" }, "mission.waiting_for_user", `Mission ${mission.id} is waiting for ${waiting.length} permission decision(s).`); return; }
    const failed = steps.find((step) => step.state === "failed");
    void this.failMission(mission, failed?.failure?.category ?? "dependency_failed", failed ? `${failed.role} failed: ${failed.failure?.detail ?? "unknown"}` : "No step can run.", failed?.id ?? null);
  }
  completeMission(mission: Mission, steps: MissionStep[]) {
    let current = this.setMission(mission, { state: "verifying" }, "mission.verifying", "All steps finished; checking mission-level evidence.");
    const verified = steps.filter((step) => step.result?.verified === true).length;
    const unverified = steps.filter((step) => step.state === "completed" && step.result?.verified !== true).length;
    const artifactIds = this.store.artifacts(mission.id).map((artifact) => artifact.id);
    const summary = `${steps.length}/${steps.length} steps completed. ${verified} independently verified by Bunny${unverified ? `; ${unverified} completed without independent verification (provider or capability output only)` : ""}.`;
    current = this.setMission(current, { state: "completed", finishedAt: Date.now(), result: { summary, verifiedSteps: verified, unverifiedSteps: unverified, artifactIds }, accounting: this.accounting(current.id) }, "mission.completed", `Mission "${current.title}": ${summary}`);
    this.workspace.releaseMission(current.id);
    this.memory.record(current.id, "mission_state", "Mission completed", summary, "bunny:mission", true);
  }
  async failMission(mission: Mission, category: FailureCategory, detail: string, stepId: string | null) {
    await this.cancelChildren(mission.id, `Mission failed: ${detail}`);
    const fresh = this.store.mission(mission.id);
    if (!["running", "waiting_for_user", "verifying"].includes(fresh.state)) return;
    this.setMission(fresh, { state: "failed", finishedAt: Date.now(), failure: { category, detail, stepId }, accounting: this.accounting(fresh.id) }, "mission.failed", `Mission "${fresh.title}" failed (${category}): ${detail}`);
    this.workspace.releaseMission(fresh.id);
  }
  accounting(missionId: string): Mission["accounting"] {
    const steps = this.store.steps(missionId); const mission = this.store.mission(missionId);
    const tokens = steps.filter((step) => step.accounting.inputTokens !== null || step.accounting.outputTokens !== null);
    return {
      runtimeMs: steps.reduce((sum, step) => sum + step.accounting.runtimeMs, 0),
      externalModelCalls: mission.accounting.externalModelCalls, localModelCalls: mission.accounting.localModelCalls,
      deterministicSteps: steps.filter((step) => step.accounting.deterministic && step.state === "completed").length,
      retries: steps.reduce((sum, step) => sum + Math.max(0, step.attempts.length - 1), 0),
      inputTokens: tokens.reduce((sum, step) => sum + (step.accounting.inputTokens ?? 0), 0), outputTokens: tokens.reduce((sum, step) => sum + (step.accounting.outputTokens ?? 0), 0), tokensReported: tokens.length > 0,
    };
  }

  // ── launching steps ───────────────────────────────────────────────────────
  /** Returns true when the step now occupies an agent slot. */
  async launch(mission: Mission, step: MissionStep, envelope: AuthorizationEnvelope): Promise<boolean> {
    let workspace = step.workspace ?? mission.root;
    if (step.scope.isolation === "worktree" && !step.workspace && step.scope.access === "write") {
      if (!existsSync(join(mission.root, ".git"))) workspace = mission.root;
      else {
        const outcome = await this.bus.request(this.capabilityRequest(mission, step, envelope, "git.worktree_add", { name: `${step.role.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 20)}-${step.id.slice(0, 6)}` }, mission.root));
        if (this.stopping.has(mission.id) || this.store.mission(mission.id).state !== "running") return false;
        if (outcome.decision.decision === "ask") { this.askPermission(mission, step, "git.worktree_add", outcome.decision.risk, outcome.decision.reason, "execute"); return false; }
        const path = (outcome.result?.output as { path?: string } | null)?.path;
        if (!outcome.run || outcome.run.status !== "succeeded" || !path) { this.stepFailed(mission, this.markRunning(step, null, null), "workspace_conflict", `Could not create an isolated worktree: ${outcome.run?.summary ?? "no result"}`); return false; }
        workspace = path; step = this.setStep(step, { workspace: path }, "mission.step.workspace", `${step.role} isolated in worktree ${path}.`);
      }
    }
    const lock = this.workspace.acquire(mission.id, step.id, workspace, step.scope.access === "write" ? "exclusive" : "shared");
    if (!lock.ok) {
      if (!step.evidence.includes(`waiting for workspace ${lock.conflict.root}`)) this.setStep(step, { evidence: [...step.evidence, `waiting for workspace ${lock.conflict.root}`] }, "mission.step.waiting_workspace", `${step.role} waits: ${lock.conflict.root} is held ${lock.conflict.mode} by step ${lock.conflict.stepId}.`);
      return false;
    }
    if (step.executor.kind === "model") return this.launchModel(mission, step, envelope, workspace);
    const running = this.markRunning(step, null, null, workspace);
    void this.runDeterministic(mission.id, running.id, envelope, workspace);
    return true;
  }
  markRunning(step: MissionStep, taskId: string | null, provider: ProviderId | null, workspace?: string): MissionStep {
    const attempt = { attempt: step.attempts.length + 1, startedAt: Date.now(), finishedAt: null, taskId, capabilityRunId: null, provider, outcome: "running" as const, category: null, detail: "" };
    return this.setStep(step, { state: "running", startedAt: step.startedAt ?? Date.now(), taskId, workspace: workspace ?? step.workspace, attempts: [...step.attempts, attempt], pendingRequestId: null, pendingPhase: null }, "mission.step.started", `${step.role} started (attempt ${attempt.attempt}${provider ? `, ${provider}` : step.executor.kind !== "model" ? ", deterministic" : ""}).`);
  }
  dependencyResults(step: MissionStep): DependencyResult[] {
    return step.dependsOn.map((dep) => this.store.step(dep)).map((dep) => {
      const artifactIds = dep.result?.artifactIds ?? [];
      for (const artifactId of artifactIds) { try { this.artifacts.consume(artifactId, step.id); } catch { /* artifact pruned */ } }
      return { role: dep.role, objective: dep.objective, summary: dep.result?.summary ?? "(no summary)", verified: dep.result?.verified ?? null, artifacts: artifactIds.slice(0, 4).map((artifactId) => { try { return this.artifacts.excerpt(artifactId, 900); } catch { return `[artifact ${artifactId} unavailable]`; } }) };
    });
  }
  launchModel(mission: Mission, step: MissionStep, envelope: AuthorizationEnvelope, workspace: string): boolean {
    const usedExternal = mission.accounting.externalModelCalls;
    const budgetLocal = usedExternal >= envelope.budget.maxExternalModelCalls;
    const deny = new Set<ProviderId>(step.providerConstraints.deny ?? []);
    for (const dep of step.preferences.independentOf ?? []) {
      // Independent review: avoid the producing provider when another provider is eligible; recorded either way.
      const producer = this.store.step(dep).accounting.provider;
      if (producer) deny.add(producer);
    }
    const allow = envelope.providers.allow && step.providerConstraints.allow ? step.providerConstraints.allow.filter((id) => envelope.providers.allow!.includes(id)) : envelope.providers.allow ?? step.providerConstraints.allow;
    const repair = step.attempts.at(-1)?.category === "verification_failed" ? step.attempts.at(-1)!.detail : null;
    const prompt = agentPrompt({ mission, step, cwd: workspace, dependencies: this.dependencyResults(step), facts: this.memory.context(mission.id), repair });
    const constraints: TaskConstraints = {
      // An agent step works in the approved folder, so it needs a filesystem-capable provider. Only when local
      // execution is required do the step's declared capabilities and its objective decide (text-only local models).
      requiresFilesystem: step.scope.access === "write" || step.requiredCapabilities.some((cap) => cap.startsWith("filesystem.")) || !(envelope.providers.localOnly || step.preferences.local || budgetLocal),
      localOnly: envelope.providers.localOnly || !!step.preferences.local || budgetLocal || undefined,
      ...(allow?.length ? { providerAllowlist: allow } : {}),
      ...(deny.size ? { providerDenylist: [...deny] } : {}),
      maxRuntimeMs: Math.max(1000, Math.min(step.timeoutMs, 3_600_000)),
    };
    const spec = step.verification.find((check) => check.kind === "task_spec") as { kind: "task_spec"; spec: VerifySpec } | undefined;
    const mode: Mode = step.reasoning === "deep" ? "deep" : step.reasoning === "light" ? "fast" : mission.mode;
    let task: OrchTask;
    const submit = (input: TaskConstraints) => this.tasks.submit({ prompt, routingPrompt: step.objective, mode, projectId: mission.projectId, override: "auto", constraints: input, verify: spec?.spec ?? null }, { missionId: mission.id, stepId: step.id, cwd: workspace, executionScope: { access: step.scope.access } });
    try { task = submit(constraints); }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // An independence preference never makes a step impossible: fall back to any eligible provider and say so.
      if (deny.size > (step.providerConstraints.deny?.length ?? 0) && /hard constraints|not eligible/.test(message)) {
        try {
          task = submit({ ...constraints, providerDenylist: step.providerConstraints.deny?.length ? step.providerConstraints.deny : undefined });
          step = this.setStep(step, { evidence: [...step.evidence, "Reviewer independence not possible: no other eligible provider; reviewed by the same provider."] });
        } catch (second) { this.stepFailed(mission, this.markRunning(step, null, null, workspace), budgetLocal ? "budget_exceeded" : "provider_unavailable", second instanceof Error ? second.message : String(second)); return false; }
      } else { this.stepFailed(mission, this.markRunning(step, null, null, workspace), budgetLocal ? "budget_exceeded" : "provider_unavailable", budgetLocal ? `External model budget exhausted and no local provider can do this step: ${message}` : message); return false; }
    }
    if (step.modelConstraint && task.model !== step.modelConstraint) {
      void this.tasks.stop(task.id, "Mission step requires a specific model that routing did not select.").catch(() => {});
      this.stepFailed(mission, this.markRunning(step, task.id, task.provider, workspace), "provider_unavailable", `Step requires model ${step.modelConstraint}; routing selected ${task.model}.`);
      return false;
    }
    const local = runsLocally(this.tasks.live().find((provider) => provider.id === task.provider), task.model);
    const sessionsUsed = mission.accounting.externalModelCalls + mission.accounting.localModelCalls;
    const violation = taskViolation(task, envelope, local, usedExternal, Date.now(), step, sessionsUsed);
    if (violation) {
      // The child stays waiting_for_approval: the user may approve it directly or through the request.
      this.setStep(step, { taskId: task.id, workspace }, "mission.step.child_created", `${step.role} child task ${task.id} routed to ${task.provider}.`);
      this.askPermission(mission, this.store.step(step.id), "provider.execute", "EXECUTE", `${task.provider} for ${step.role}: ${violation}`, "execute");
      return false;
    }
    try {
      this.tasks.approveDelegated(task.id, { missionId: mission.id, stepId: step.id, authorizationId: envelope.id, check: (child) => taskViolation(child, envelope, runsLocally(this.tasks.live().find((provider) => provider.id === child.provider), child.model), usedExternal, Date.now(), this.store.step(step.id), sessionsUsed) });
    } catch (error) {
      this.stepFailed(mission, this.markRunning(step, task.id, task.provider, workspace), "provider_unavailable", error instanceof Error ? error.message : String(error));
      return false;
    }
    this.countModelCall(mission.id, local);
    this.markRunning(step, task.id, task.provider, workspace);
    return true;
  }
  countModelCall(missionId: string, local: boolean) {
    const mission = this.store.mission(missionId);
    this.setMission(mission, { accounting: { ...mission.accounting, externalModelCalls: mission.accounting.externalModelCalls + (local ? 0 : 1), localModelCalls: mission.accounting.localModelCalls + (local ? 1 : 0) } });
  }
  capabilityRequest(mission: Mission, step: MissionStep, envelope: AuthorizationEnvelope, action: string, params: Record<string, unknown>, cwd: string): CapabilityRequest {
    // A one-time allowance covers exactly the path the user saw in the request, nothing around it.
    const once = step.approvedOnce?.action === action && typeof params.path === "string";
    const roots = once ? [...envelope.projectRoots, dirname(resolve(cwd, params.path as string))] : envelope.projectRoots;
    return { action, params, missionId: mission.id, stepId: step.id, envelope, origin: `mission:${mission.id}`, cwd, roots, oneTimeAction: step.approvedOnce?.action ?? null, timeoutMs: step.timeoutMs };
  }
  async runDeterministic(missionId: string, stepId: string, envelope: AuthorizationEnvelope, workspace: string) {
    const mission = this.store.mission(missionId); let step = this.store.step(stepId);
    const started = Date.now();
    try {
      let result: { ok: boolean; summary: string; artifactIds: string[]; runId: string | null; category: FailureCategory | null; output: unknown; permission: { action: string; risk: string; reason: string } | null };
      if (step.executor.kind === "capability") {
        const outcome = await this.bus.request(this.capabilityRequest(mission, step, envelope, step.executor.action, step.executor.params, workspace));
        const status = outcome.run?.status;
        result = {
          ok: status === "succeeded", summary: outcome.run?.summary ?? outcome.decision.reason, artifactIds: outcome.artifactIds, runId: outcome.run?.id ?? null, output: outcome.result?.output ?? null,
          permission: outcome.decision.decision === "ask" ? { action: step.executor.action, risk: outcome.decision.risk, reason: outcome.decision.reason } : null,
          category: status === "succeeded" ? null : outcome.result?.cleanup?.ok === false ? "permission_required" : this.capabilityCategory(outcome.result, status),
        };
      } else if (step.executor.kind === "skill") {
        const run = await this.skills.run(step.executor.skillId, step.executor.params, { missionId, stepId, envelope, origin: `mission:${missionId}`, cwd: workspace, roots: envelope.projectRoots, oneTimeAction: step.approvedOnce?.action ?? null, timeoutMs: step.timeoutMs });
        result = {
          ok: run.ok, summary: run.ok ? `Skill ${run.skill} v${run.version} passed: ${run.runs.map((r) => r.summary).join(" · ").slice(0, 600)}` : run.permission ? run.permission.reason : `Skill ${run.skill} v${run.version} failed at ${run.failure?.label}: ${run.failure?.summary}`,
          artifactIds: run.artifactIds, runId: run.runs.at(-1)?.id ?? null, output: run.outputs.at(-1) ?? null,
          permission: run.permission ? { action: run.permission.action, risk: this.bus.riskOf(run.permission.action, {}) ?? "EXECUTE", reason: run.permission.reason } : null,
          category: run.ok ? null : run.failure && ["unavailable", "unconfigured", "unsupported"].includes(run.failure.status) ? "capability_unavailable" : run.failure?.status === "denied" ? "permission_denied" : run.failure?.status === "timeout" ? "timeout" : "capability_failed",
        };
      } else return;
      step = this.store.step(stepId);
      if (step.state !== "running" || this.stopping.has(missionId)) return; // stopped meanwhile
      const runtimeMs = Date.now() - started;
      step = this.setStep(step, { capabilityRunId: result.runId, accounting: { ...step.accounting, runtimeMs: step.accounting.runtimeMs + runtimeMs, deterministic: true, local: true }, attempts: step.attempts.map((attempt, index) => index === step.attempts.length - 1 ? { ...attempt, capabilityRunId: result.runId } : attempt) });
      if (result.permission) { this.workspace.release(stepId); this.askPermission(this.store.mission(missionId), step, result.permission.action, result.permission.risk as PermissionRequest["risk"], result.permission.reason, "execute"); return; }
      if (!result.ok) { this.stepFailed(this.store.mission(missionId), step, result.category ?? "capability_failed", result.summary); return; }
      await this.verifyAndComplete(this.store.mission(missionId), step, { summary: result.summary, artifactIds: result.artifactIds, output: result.output, task: null });
    } catch (error) {
      const current = this.store.step(stepId);
      if (current.state === "running") this.stepFailed(this.store.mission(missionId), current, "capability_failed", error instanceof Error ? error.message : String(error));
    }
  }
  capabilityCategory(result: CapabilityResult | null, status: string | undefined): FailureCategory {
    if (result?.errorCategory) return result.errorCategory;
    if (status === "denied") return "permission_denied";
    if (status === "timeout") return "timeout";
    if (status === "unavailable" || status === "unconfigured" || status === "unsupported") return "capability_unavailable";
    return "capability_failed";
  }

  // ── finishing steps ───────────────────────────────────────────────────────
  childApprovedDirectly(stepId: string, taskId: string) {
    const step = this.store.step(stepId);
    if (step.state !== "waiting_for_approval" || step.taskId !== taskId) return;
    const task = this.tasks.db.get(taskId);
    if (task.approval?.kind === "mission") return;
    if (step.pendingRequestId) {
      const request = this.store.request(step.pendingRequestId);
      if (!request.resolvedAt) this.store.saveRequest({ ...request, resolvedAt: Date.now(), resolution: "allow_once", resolvedBy: "workstation or device (direct task approval)" });
    }
    const local = runsLocally(this.tasks.live().find((provider) => provider.id === task.provider), task.model);
    this.countModelCall(step.missionId, local);
    const lock = this.workspace.acquire(step.missionId, step.id, step.workspace ?? task.cwd ?? this.store.mission(step.missionId).root, step.scope.access === "write" ? "exclusive" : "shared");
    if (!lock.ok) this.emit("mission.step.workspace_warning", `${step.role} was approved directly while ${lock.conflict.root} is held ${lock.conflict.mode} by step ${lock.conflict.stepId}; it runs without exclusive ownership (step ${step.id}).`, step.missionId);
    this.markRunning(step, taskId, task.provider);
    const mission = this.store.mission(step.missionId);
    if (this.stopping.has(mission.id)) return;
    if (mission.state === "waiting_for_user") this.setMission(mission, { state: "running" }, "mission.resumed", "A pending child task was approved directly by the user.");
  }
  async finishModelStep(stepId: string, taskId: string) {
    const step = this.store.step(stepId);
    if (step.taskId !== taskId || !["running", "waiting_for_approval"].includes(step.state)) return;
    const mission = this.store.mission(step.missionId);
    const task = this.tasks.db.get(taskId);
    const runtimeMs = Math.max(0, (task.finishedAt ?? Date.now()) - (task.startedAt ?? task.finishedAt ?? Date.now()));
    const local = runsLocally(this.tasks.live().find((provider) => provider.id === task.provider), task.model);
    let current = this.setStep(step.state === "waiting_for_approval" ? this.setStep(step, { state: "running" }) : step, {
      accounting: { ...step.accounting, runtimeMs: step.accounting.runtimeMs + runtimeMs, provider: task.provider, model: task.model, local, deterministic: false, inputTokens: task.usage ? (step.accounting.inputTokens ?? 0) + task.usage.inputTokens : step.accounting.inputTokens, outputTokens: task.usage ? (step.accounting.outputTokens ?? 0) + task.usage.outputTokens : step.accounting.outputTokens },
    });
    if (mission.budget.maxTokens !== null) {
      const used = this.accounting(mission.id);
      if (used.tokensReported && used.inputTokens + used.outputTokens > mission.budget.maxTokens) { await this.failMission(mission, "budget_exceeded", `Provider-reported tokens (${used.inputTokens + used.outputTokens}) exceeded the mission ceiling of ${mission.budget.maxTokens}.`, step.id); return; }
    }
    if (task.state !== "completed") { this.stepFailed(mission, current, classifyTaskFailure(task.error ?? task.stopReason, task.state), task.error ?? task.stopReason ?? `Child task ${task.state}.`); return; }
    const output = task.output.trim();
    const artifact = await this.artifacts.create({ missionId: mission.id, stepId: step.id, type: step.expectedArtifacts[0] ?? "text", title: `${step.role} output`, inline: output || "(no output)", mediaType: "text/plain", provenance: `provider:${task.provider}:${task.id}`, verification: "unverified" });
    this.memory.record(mission.id, "agent_conclusion", `${step.role} conclusion`, output.split(/\r?\n/).filter(Boolean).slice(-6).join(" ").slice(0, 1500), `provider:${task.provider}:${task.id}`, false);
    current = this.store.step(step.id);
    if (this.stopping.has(mission.id) || current.state !== "running") return;
    const summary = (output.split(/\r?\n/).filter(Boolean).slice(-4).join(" ") || "Provider produced no output.").slice(0, 1500);
    await this.verifyAndComplete(mission, current, { summary, artifactIds: [artifact.id], output, task });
  }
  /** Bunny's own checks after a step reports success. Provider prose is never a check. */
  async verifyAndComplete(mission: Mission, step: MissionStep, result: { summary: string; artifactIds: string[]; output: unknown; task: OrchTask | null }) {
    const envelope = mission.authorizationId ? this.store.authorization(mission.authorizationId) : null;
    if (!envelope) { this.stepFailed(mission, step, "permission_required", "Authorization missing."); return; }
    const checks: string[] = []; let passed = true;
    const cwd = step.workspace ?? mission.root;
    if (step.verification.length) step = this.setStep(step, { state: "verifying" }, "mission.step.verifying", `Bunny is checking ${step.role}'s result itself.`);
    for (const check of step.verification) {
      if (check.kind === "task_spec") {
        const verification = result.task?.verification;
        const ok = !!verification?.passed; passed &&= ok;
        checks.push(`task_spec ${check.spec.name}: ${ok ? "passed" : "failed"} — ${verification?.detail ?? "TaskManager did not verify"}`);
      } else if (check.kind === "file_exists") {
        let ok = false; let detail = "";
        try { const path = scopedPath(cwd, check.path, envelope.projectRoots); ok = existsSync(path) && (!check.contains || readFileSync(path, "utf8").includes(check.contains)); detail = `${path} ${ok ? "present" : "missing or without the expected text"}`; } catch (error) { detail = error instanceof Error ? error.message : String(error); }
        passed &&= ok; checks.push(`file ${check.path}: ${detail}`);
      } else if (check.kind === "command" || check.kind === "git_diff_nonempty") {
        const action = check.kind === "command" ? "terminal.exec" : "git.diff";
        const params = check.kind === "command" ? { command: check.command, args: check.args, timeoutMs: check.timeoutMs } : {};
        const outcome = await this.bus.request({ ...this.capabilityRequest(mission, step, envelope, action, params, cwd), timeoutMs: check.kind === "command" ? check.timeoutMs ?? 15 * 60_000 : 60_000 });
        if (outcome.decision.decision === "ask") { this.askPermission(mission, this.store.step(step.id), action, outcome.decision.risk, `Verification: ${outcome.decision.reason}`, "verify"); return; }
        const ok = check.kind === "command" ? (outcome.result?.output as { exitCode?: number } | null)?.exitCode === check.expectExit : outcome.run?.status === "succeeded" && (outcome.result?.output as { empty?: boolean } | null)?.empty === false;
        passed &&= ok; result.artifactIds.push(...outcome.artifactIds);
        checks.push(check.kind === "command" ? `${check.command} ${check.args.join(" ")}: exit ${(outcome.result?.output as { exitCode?: number } | null)?.exitCode ?? outcome.run?.status ?? "none"} (expected ${check.expectExit})` : `git diff: ${ok ? "changes present" : "no changes"}`);
      } else if (check.kind === "artifact") {
        const ok = this.store.artifacts(mission.id).some((artifact) => artifact.stepId === step.id && artifact.type === check.type);
        passed &&= ok; checks.push(`artifact ${check.type}: ${ok ? "present" : "missing"}`);
      }
    }
    step = this.store.step(step.id);
    if (!["running", "verifying"].includes(step.state)) return;
    if (!passed) {
      for (const id of result.artifactIds) { try { this.artifacts.mark(id, "failed"); } catch { /* pruned */ } }
      this.stepFailed(mission, step, "verification_failed", checks.filter((line) => !/passed|present|changes present/.test(line) || /failed|missing/.test(line)).join("; ") || checks.join("; "));
      return;
    }
    const verified = step.verification.length ? true : null;
    if (verified) {
      for (const id of result.artifactIds) { try { this.artifacts.mark(id, "verified"); } catch { /* pruned */ } }
      this.memory.record(mission.id, "verified_fact", `${step.role} verified`, checks.join("; "), `bunny:verification:${step.id}`, true);
    }
    const attempts = step.attempts.map((attempt, index) => index === step.attempts.length - 1 ? { ...attempt, finishedAt: Date.now(), outcome: "completed" as const, detail: "completed" } : attempt);
    this.setStep(step, { state: "completed", finishedAt: Date.now(), attempts, result: { summary: result.summary, artifactIds: result.artifactIds, verified, verification: checks }, failure: null, approvedOnce: null }, "mission.step.completed", `${step.role} completed${verified ? " and verified by Bunny" : " (no independent check requested)"}.`);
    this.workspace.release(step.id);
    this.schedule(mission.id);
  }
  stepFailed(mission: Mission, step: MissionStep, category: FailureCategory, detail: string) {
    this.workspace.release(step.id);
    const attempts = step.attempts.length ? step.attempts.map((attempt, index) => index === step.attempts.length - 1 ? { ...attempt, finishedAt: Date.now(), outcome: (category === "user_stopped" ? "stopped" : category === "host_restart" ? "interrupted" : "failed") as "failed", category, detail: detail.slice(0, 1500) } : attempt) : step.attempts;
    const verdict = retryVerdict(category, attempts.length, step.maxRetries, this.accounting(mission.id).retries, mission.budget.maxRetries);
    if (verdict.retry) {
      // Reroute only when another provider could take the step; otherwise retry where it is.
      const failedProvider = step.accounting.provider ?? step.attempts.at(-1)?.provider ?? null;
      const alternative = failedProvider && this.tasks.live().some((p) => p.id !== failedProvider && ["ready", "busy"].includes(p.availability) && p.installed && p.authenticated && !(step.providerConstraints.deny ?? []).includes(p.id));
      const deny = verdict.reroute && failedProvider && alternative ? [...new Set([...(step.providerConstraints.deny ?? []), failedProvider])] : step.providerConstraints.deny;
      this.setStep(step, { state: step.state === "running" || step.state === "verifying" ? "failed" : step.state, attempts });
      this.setStep(this.store.step(step.id), { state: "ready", taskId: null, failure: null, providerConstraints: { ...step.providerConstraints, deny }, approvedOnce: null }, "mission.step.retrying", `${step.role} attempt ${attempts.length} failed (${category}): ${detail.slice(0, 300)}. ${verdict.reason}`);
      this.schedule(mission.id);
      return;
    }
    const failed = this.setStep(step, { state: "failed", finishedAt: Date.now(), attempts, failure: { category, detail: detail.slice(0, 2000) }, approvedOnce: null }, "mission.step.failed", `${step.role} failed (${category}): ${detail.slice(0, 500)}. ${verdict.reason}`);
    if (verdict.waitForUser) {
      const current = this.store.mission(mission.id);
      if (current.state === "running") this.setMission(current, { state: "waiting_for_user" }, "mission.waiting_for_user", `Mission ${mission.id}: ${failed.role} needs you — ${verdict.reason}`);
      return;
    }
    const steps = this.store.steps(mission.id);
    for (const id of blockedBy(steps, failed.id)) {
      const dependent = this.store.step(id);
      if (["pending", "ready"].includes(dependent.state)) this.setStep(dependent, { state: "blocked", failure: { category: "dependency_failed", detail: `${failed.role} failed.` } }, "mission.step.blocked", `${dependent.role} blocked: ${failed.role} failed.`);
    }
    this.schedule(mission.id);
  }

  // ── permission requests ───────────────────────────────────────────────────
  askPermission(mission: Mission, step: MissionStep, action: string, risk: PermissionRequest["risk"], reason: string, phase: "execute" | "verify") {
    const request: PermissionRequest = { id: crypto.randomUUID(), missionId: mission.id, stepId: step.id, action, risk, reason, createdAt: Date.now(), resolvedAt: null, resolution: null, resolvedBy: null };
    this.store.saveRequest(request);
    this.workspace.release(step.id);
    this.setStep(step, { state: "waiting_for_approval", pendingRequestId: request.id, pendingPhase: phase }, "mission.permission_required", `Mission ${mission.id} request ${request.id}: ${step.role} needs permission for ${action} (${risk}): ${reason}`);
    this.schedule(mission.id);
  }
  async respond(requestId: string, decision: "allow_once" | "deny", by: string) {
    this.requireEnabled();
    const request = this.store.request(requestId);
    if (request.resolvedAt) throw new Error("This request was already answered.");
    const step = this.store.step(request.stepId);
    if (step.state !== "waiting_for_approval" || step.pendingRequestId !== requestId) throw new Error("The step is no longer waiting for this request.");
    this.store.saveRequest({ ...request, resolvedAt: Date.now(), resolution: decision, resolvedBy: by });
    this.inbox.resolve(request.missionId, { requestId });
    this.inbox.resolve(request.missionId, { kinds: ["requires_attention"] });
    this.memory.record(request.missionId, "user_decision", `${request.action} ${decision === "allow_once" ? (step.executor.kind === "skill" ? "allowed for this skill run" : "allowed once") : "denied"}`, `${by}: ${request.reason}`, `user:${by}`, true);
    this.emit("approval.additional_capability", `${request.action} ${decision} by ${by}; request ${requestId}; scope ${step.executor.kind === "skill" ? "this skill run, matching action within approved roots" : "this action"}.`, request.missionId);
    if (by.startsWith("device:")) this.emit("approval.remote_device", `Additional request ${requestId} answered by paired ${by}: ${decision}.`, request.missionId);
    let mission = this.store.mission(request.missionId);
    if (mission.state === "waiting_for_user") mission = this.setMission(mission, { state: "running" }, "mission.resumed", `${by} answered request ${requestId}.`);
    this.emit(decision === "allow_once" ? "authorization.granted" : "authorization.denied", `${request.action} for step ${step.id}: ${decision} by ${by} (request ${requestId}).`, request.missionId);
    if (decision === "deny") {
      // The step is failed first, so the child's own stop event finds nothing left to finalize.
      this.stepFailed(mission, this.setStep(step, { state: "running" }), "permission_denied", `${by} denied ${request.action}.`);
      if (step.taskId && this.tasks.db.get(step.taskId).state === "waiting_for_approval") await this.tasks.stop(step.taskId, "Mission permission denied by the user.").catch(() => {});
      return this.view(this.store.mission(mission.id));
    }
    if (request.action === "provider.execute" && step.taskId) {
      // Explicit user approval of that child task. If the provider stopped being eligible meanwhile,
      // the step fails honestly instead of staying stuck behind an answered request.
      try { this.tasks.approve(step.taskId, by); }
      catch (error) {
        const current = this.store.step(step.id);
        if (current.state === "waiting_for_approval") this.stepFailed(this.store.mission(mission.id), this.markRunning(current, step.taskId, this.tasks.db.get(step.taskId).provider), "provider_unavailable", error instanceof Error ? error.message : String(error));
      }
      return this.view(this.store.mission(mission.id));
    }
    if (step.pendingPhase === "verify") {
      const running = this.setStep(step, { state: "running", approvedOnce: { requestId, action: request.action }, pendingRequestId: null, pendingPhase: null });
      const task = running.taskId ? this.tasks.db.get(running.taskId) : null;
      const previous = running.result;
      void this.verifyAndComplete(mission, running, { summary: previous?.summary ?? running.evidence.at(-1) ?? "", artifactIds: previous?.artifactIds ?? this.store.artifacts(mission.id).filter((a) => a.stepId === running.id).map((a) => a.id), output: null, task });
      return this.view(this.store.mission(mission.id));
    }
    this.setStep(step, { state: "ready", approvedOnce: { requestId, action: request.action }, pendingRequestId: null, pendingPhase: null });
    this.schedule(mission.id);
    return this.view(this.store.mission(mission.id));
  }

  // ── stop / retry / replan ─────────────────────────────────────────────────
  async cancelChildren(missionId: string, detail: string) {
    await this.bus.cancel({ missionId });
    for (const step of this.store.steps(missionId)) {
      if (step.taskId) {
        const task = (() => { try { return this.tasks.db.get(step.taskId!); } catch { return null; } })();
        // Only this mission's own child tasks are stopped; Stop isolation of the TaskManager is reused unchanged.
        if (task && task.mission?.missionId === missionId && !["completed", "failed", "stopped"].includes(task.state)) await this.tasks.stop(task.id, detail).catch(() => {});
      }
    }
  }
  async stop(id: string, by: string): Promise<MissionView> {
    const mission = this.store.mission(id);
    if (["completed", "stopped"].includes(mission.state)) throw new Error("Mission has already ended.");
    if (this.stopping.has(id)) throw new Error("Mission Stop is already in progress.");
    this.stopping.add(id);
    const activeRuns = new Set(this.store.runs({ missionId: id, status: "running", limit: 500 }).map((run) => run.id));
    try {
    await this.cancelChildren(id, `Mission stopped by ${by}.`);
    for (const step of this.store.steps(id)) if (!["completed", "skipped", "stopped", "failed"].includes(step.state)) {
      const attempts = step.attempts.map((attempt, index) => index === step.attempts.length - 1 && attempt.outcome === "running" ? { ...attempt, finishedAt: Date.now(), outcome: "stopped" as const, category: "user_stopped" as const, detail: `Stopped by ${by}` } : attempt);
      this.setStep(step, { state: "stopped", finishedAt: Date.now(), attempts, failure: { category: "user_stopped", detail: `Stopped by ${by}.` } });
    }
    for (const request of this.store.requests(id)) if (!request.resolvedAt) this.store.saveRequest({ ...request, resolvedAt: Date.now(), resolution: "deny", resolvedBy: `${by} (mission stopped)` });
    this.workspace.releaseMission(id);
    this.inbox.resolve(id);
    const cleanupFailures = this.store.runs({ missionId: id, limit: 500 }).filter((run) => activeRuns.has(run.id) && run.cleanup?.ok === false);
    const cleanupDetail = cleanupFailures.length ? ` Cleanup needs attention: ${cleanupFailures.map((run) => run.cleanup!.detail).join(" ")}` : " Active capability cleanup finished.";
    const stopped = this.setMission(this.store.mission(id), { state: "stopped", finishedAt: Date.now(), failure: { category: "user_stopped", detail: `Stopped by ${by}.${cleanupDetail}`, stepId: null }, accounting: this.accounting(id) }, "mission.stopped", `Mission "${mission.title}" stopped by ${by}; child tasks stopped, nothing will be retried.${cleanupDetail}`);
    return this.view(stopped);
    } finally { this.stopping.delete(id); }
  }
  retry(id: string, by: string): MissionView {
    this.requireEnabled();
    let mission = this.store.mission(id);
    if (!["failed", "waiting_for_user"].includes(mission.state)) throw new Error("Only failed or waiting missions can be retried.");
    const envelope = mission.authorizationId ? this.store.authorization(mission.authorizationId) : null;
    if (!envelope || envelope.revokedAt || envelope.expiresAt <= Date.now()) throw new Error("The mission authorization expired or was revoked; replan to approve it again.");
    const steps = this.store.steps(id);
    const failed = steps.filter((step) => step.state === "failed");
    if (!failed.length && !steps.some((step) => step.state === "blocked")) throw new Error("No failed step to retry.");
    for (const step of failed) {
      // Explicit retries are still bounded: at most twice the automatic per-step limit plus one.
      if (step.attempts.length > step.maxRetries * 2 + 1) throw new Error(`${step.role} reached its attempt ceiling (${step.attempts.length}); replan instead.`);
      this.setStep(step, { state: "ready", failure: null, taskId: null, approvedOnce: null }, "mission.step.retrying", `${by} retried ${step.role}${step.failure?.category === "host_restart" ? " as a fresh child task (the interrupted provider stream is not resumed)" : ""}.`);
    }
    for (const step of this.store.steps(id)) if (step.state === "blocked") this.setStep(step, { state: "pending", failure: null });
    if (mission.state === "failed") mission = this.setMission(mission, { state: "ready", failure: null, finishedAt: null }, "mission.retry", `${by} retried ${failed.length} failed step(s).`);
    if (mission.state === "ready") mission = this.start(mission);
    else { this.bus.clearCancellation(id); mission = this.setMission(mission, { state: "running", failure: null }, "mission.retry", `${by} retried ${failed.length} failed step(s).`); this.schedule(id); }
    return this.view(mission);
  }
  async replan(id: string, by: string, explicit?: unknown, objective?: string): Promise<MissionView> {
    this.requireEnabled();
    const mission = this.store.mission(id);
    if (!["waiting_for_approval", "waiting_for_user", "failed"].includes(mission.state)) throw new Error("Replanning is possible while waiting for approval, waiting for you, or after a failure.");
    if (this.store.steps(id).some((step) => STEP_LIVE.includes(step.state))) throw new Error("Steps are still running; stop them first.");
    if (mission.planning.replans >= this.cached.limits.maxReplans) throw new Error(`Replan limit (${this.cached.limits.maxReplans}) reached.`);
    await this.cancelChildren(id, "Mission is being replanned.");
    if (mission.authorizationId) { const envelope = this.store.authorization(mission.authorizationId); if (envelope && !envelope.revokedAt) this.store.saveAuthorization({ ...envelope, revokedAt: Date.now() }); }
    for (const request of this.store.requests(id)) if (!request.resolvedAt) this.store.saveRequest({ ...request, resolvedAt: Date.now(), resolution: "deny", resolvedBy: `${by} (replanned)` });
    this.workspace.releaseMission(id);
    const base = this.setMission(mission, { objective: objective?.trim() || mission.objective, authorizationId: null, failure: null, finishedAt: null, planning: { ...mission.planning, replans: mission.planning.replans + 1 } }, "mission.replanning", `${by} replanned the mission; the previous authorization was revoked and a new approval is required.`);
    return this.view(this.plan(base, explicit));
  }

  // ── recovery after a Host restart ─────────────────────────────────────────
  recover() {
    const now = Date.now();
    for (const run of this.store.runs({ status: "running", limit: 500 })) this.store.saveRun({ ...run, status: "interrupted", summary: "Host restarted while this capability ran; it was not resumed.", finishedAt: now });
    for (const mission of this.store.missionsIn(["running", "verifying", "waiting_for_user", "ready", "planning"])) {
      this.workspace.releaseMission(mission.id);
      if (mission.state === "planning") { this.setMission(mission, { state: "failed", finishedAt: now, failure: { category: "host_restart", detail: "Host restarted during planning.", stepId: null } }, "mission.failed", "Host restarted during planning; replan to continue."); continue; }
      const interrupted: string[] = [];
      for (const step of this.store.steps(mission.id)) {
        if (!STEP_LIVE.includes(step.state)) continue;
        const task = step.taskId ? (() => { try { return this.tasks.db.get(step.taskId!); } catch { return null; } })() : null;
        const detail = task ? `Child task ${task.id} (${task.provider}) was ${task.state} after the Host restart; its non-interactive provider stream cannot be reattached and was not resumed. Previous PID ${task.pid ?? "none"} retained.` : "A deterministic capability was running when the Host restarted; it was not resumed.";
        const attempts = step.attempts.map((attempt, index) => index === step.attempts.length - 1 ? { ...attempt, finishedAt: now, outcome: "interrupted" as const, category: "host_restart" as const, detail } : attempt);
        this.setStep(step, { state: "failed", finishedAt: now, attempts, failure: { category: "host_restart", detail } }, "mission.step.failed", `${step.role} interrupted by Host restart: ${detail}`);
        interrupted.push(step.id);
      }
      if (!interrupted.length) {
        if (mission.state === "ready") { this.start(mission); continue; }
        if (mission.state === "running") this.emit("mission.recovered", `Mission ${mission.id} restored after a Host restart; no step was executing, scheduling continues.`, mission.id);
        if (mission.state === "running" || mission.state === "verifying") this.schedule(mission.id);
        continue;
      }
      const current = mission.state === "verifying" ? this.setMission(mission, { state: "running" }) : mission.state === "ready" ? this.setMission(mission, { state: "running" }) : mission;
      this.setMission(current, { state: "waiting_for_user", recovery: { at: now, detail: `${interrupted.length} step(s) were interrupted by a Host restart and were not resumed. Retry starts fresh child tasks under the same authorization.`, interruptedSteps: interrupted } }, "mission.recovered", `Mission ${mission.id} "${mission.title}": ${interrupted.length} step(s) interrupted by a Host restart; nothing was resumed. Retry to start fresh child tasks, or stop the mission.`);
    }
  }

  // ── triggers ──────────────────────────────────────────────────────────────
  async act(trigger: Trigger, cause: string) {
    if (trigger.action.kind === "notify") { this.inbox.add({ source: "trigger", kind: "external_event", title: trigger.action.title, detail: `${trigger.name}: ${cause}`, missionId: null, taskId: null, stepId: null, requestId: null }); return; }
    // A trigger can only draft: the mission stops at waiting_for_approval for a person to approve.
    this.create({ objective: trigger.action.objective, mode: trigger.action.mode, projectId: trigger.action.projectId, origin: `trigger:${trigger.id}` });
  }

  async close() {
    this.closed = true; this.deactivate();
    this.tasks.bus.off("event", this.listener);
    for (const handle of this.pending.values()) clearImmediate(handle);
    this.pending.clear();
    await this.bus.close();
  }
}
