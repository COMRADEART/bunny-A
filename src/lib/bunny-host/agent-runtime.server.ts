import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { HostDatabase } from "./persistence.server.ts";
import type { CreateMission, MissionManager } from "../bunny-missions/manager.server.ts";
import type { JsonValue, MissionStep } from "../bunny-missions/types.ts";
import { CommandRefusedError } from "./failure.server.ts";
import { AgentStore } from "./agent-store.server.ts";
import { classifyReplay, type ReplayFacts } from "./agent-replay.ts";
import { operationContract } from "../bunny-missions/cross-app.ts";
import { AgentWorkspaceStore } from "./agent-workspace.server.ts";
import { ProjectContextResolver } from "./project-context.server.ts";
import {
  agentCanTransition, deriveAgentState, mapFailure, routingExhausted, type AgentFailure, type AgentProfile, type AgentRun, type AgentSnapshot, type AgentState, type CheckpointBoundary ,
} from "./agent-types.ts";

/**
 * M-A-3 T4 — the durable Agent runtime. Continuity authority only: durable identity, run generations,
 * checkpoints, pause/resume/stop, and the post-restart walk. It reads canonical truth through
 * MissionManager's public surface and writes through it; it never routes, launches, verifies, or grants
 * authority itself.
 */
export class AgentRuntime {
  workspaces: AgentWorkspaceStore;
  context: ProjectContextResolver;
  host: HostDatabase;
  missions: MissionManager;
  store: AgentStore;
  private profiles = new Map<string, AgentProfile>();
  private listener: (event: HostEventLike) => void;

  constructor(host: HostDatabase, missions: MissionManager) {
    this.host = host;
    this.missions = missions;
    this.store = new AgentStore(host);
    const scratchRoot = missions.tasks.workspaceRootConfigured
      ? missions.tasks.projects.workspaceRoot
      : join(missions.dataDirectory, "workspace");
    if (!missions.tasks.workspaceRootConfigured) mkdirSync(scratchRoot, { recursive: true });
    this.workspaces = new AgentWorkspaceStore(host, scratchRoot);
    this.context = new ProjectContextResolver(
      host,
      missions.tasks.projects,
      this.workspaces,
      missions.store,
      missions.dataDirectory,
    );
    missions.projectContext = this.context;
    for (const row of this.store.agentsIn(["CREATED", "PLANNING", "RUNNING", "WAITING_FOR_USER", "WAITING_FOR_DEPENDENCY", "PAUSED", "VERIFYING", "COMPLETED", "FAILED", "STOPPED",
    ])) this.profiles.set(row.record.id, row.record);
    this.listener = (event) => { try { this.onEvent(event); } catch (error) { this.contain(error, "agent-runtime", event.missionId ?? undefined); } };
    missions.tasks.bus.on("event", this.listener);
    // The walk runs once at construction, strictly AFTER MissionManager.recover() landed the mission rows.
    this.walk();
  }
  close(): void { this.missions.tasks.bus.off("event", this.listener); }

  /** Additive admission gate wired onto MissionManager by the Host: admission holds while the owning agent is paused. */
  private validateWorkspace(agent: AgentProfile): void {
    const workspace = agent.missionId ? this.workspaces.getForMission(agent.missionId) : null;
    if (workspace) this.workspaces.validate(workspace);
    const mission = agent.missionId ? this.missions.store.mission(agent.missionId) : null;
    if (mission?.projectId) {
      const project = this.missions.tasks.projects.forExecution(mission.projectId);
      if (project.path !== mission.root)
        throw new CommandRefusedError(
          "CONTEXT_CHANGED: Mission root requires replanning after relink.",
        );
    }
  }

  /** Additive admission gate wired onto MissionManager by the Host: admission holds while the owning agent is paused. */
  blockedForMission(missionId: string): boolean {
    const agent = [...this.profiles.values()].find((profile) => profile.missionId === missionId);
    if (!agent) return false;
    try { return this.store.agentFlags(agent.id).paused; } catch { return false; }
  }

  snapshot(ids?: string[]): AgentSnapshot {
    const snapshot = this.store.snapshot(ids);
    return { ...snapshot, agents: snapshot.agents.map((agent ) => {
      try {
        const mission = agent.missionId ? this.missions.get(agent.missionId).mission : null;
        const crossApp = mission?.steps.some((step ) => step.crossApp);
        const current = mission?.steps.find((step ) => ["running", "verifying", "waiting_for_approval"].includes(step.state),
            ) ?? mission?.steps.find((step ) => step.failure) ?? mission?.steps.find((step ) => step.state !== "completed") ?? mission?.steps.at(-1);
        const action = current?.executor.kind === "capability" ? current.executor.action : null;
        return { ...agent, authorization: agent.missionId ? this.missions.agentic.projection(agent.missionId) : null,
          ...(crossApp && mission ? { activity: { application: action?.startsWith("computer.") ? "Microsoft Calculator" : action?.startsWith("browser.") ? "Mission browser" : (action?.split(".")[0] ?? null), action, step: current?.role ?? null, completed: mission.steps.filter((step ) => step.state === "completed").length, total: mission.steps.length, verification: current?.failure?.category === "verification_failed" ? "Verification failed" : current?.state === "verifying" ? "Checking postconditions" : current?.result?.verified ? "Verified" : "Pending verification", artifacts: this.missions.store.artifacts(mission.id).filter((artifact ) => artifact.verification === "verified").slice(-6).map((artifact ) => ({ id: artifact.id, title: artifact.title, verified: true ,
                      })), history: mission.steps.slice(-12).map((step ) => ({ step: step.role, action: step.executor.kind === "capability" ? step.executor.action : "provider", state: step.state ,
                      })) ,
                  } ,
                } : {}) ,
          };
      }
      catch { return { ...agent, authorization: null, authorizationError: "Authorization evidence is invalid; all new work is blocked. Stop remains available." ,
          }; }
    }) ,
    };
  }

  // ── commands (§7/§11/§12) ─────────────────────────────────────────────────
  create(input: { objective?: unknown; name?: unknown; title?: unknown; mode?: unknown; projectId?: unknown; steps?: unknown; localOnly?: unknown; providers?: unknown ;
    }, actor: string,
  ): AgentSnapshot {
    this.missions.requireEnabled();
    if (typeof input.objective !== "string" || !input.objective.trim() || input.objective.length > 4000) throw new CommandRefusedError("An agent needs a non-empty objective of at most 4000 characters.",
      );
    if (this.store.countActive() >= AGENT_LIMITS.maxActiveAgents) throw new CommandRefusedError(`Only ${AGENT_LIMITS.maxActiveAgents} agents may be active at once.`,
      );
    const now = Date.now();
    const name =
      typeof input.name === "string" && input.name.trim() && input.name.trim().length <= 100
        ? input.name.trim()
        : `Agent ${new Date(now).toISOString().slice(0, 16).replace("T", " ")}`;
    const mission = this.missions.create({
      objective: input.objective,
      title: input.title === undefined ? undefined : String(input.title).slice(0, 200),
      mode: "balanced",
      projectId: input.projectId == null ? null : String(input.projectId),
      steps: input.steps,
      localOnly: input.localOnly === true,
      providers: Array.isArray(input.providers)
        ? (input.providers as CreateMission["providers"])
        : null,
      origin: `agent:${actor}`,
    });
    const profile: AgentProfile = {
      id: randomUUID(),
      name,
      missionId: mission.id,
      createdAt: now,
      createdBy: actor,
      pausedAt: null,
      stoppedAt: null,
      failure: null,
      completedAt: null,
      updatedAt: now,
    };
    this.store.saveAgent(profile, "CREATED", { paused: false, stopped: false });
    try { this.workspaces.acquire(profile.id, mission.id, mission.projectId); }
    catch (error) {
      this.store.saveAgent({ ...profile, failure: { category: "RECOVERY_AMBIGUOUS", detail: "Workspace allocation requires review; no work was admitted." } }, "INTERRUPTED", { paused: false, stopped: false });
      throw new CommandRefusedError(error instanceof Error ? error.message : "Workspace allocation failed closed.");
    }
    this.profiles.set(profile.id, profile);
    this.emitLifecycle("agent.created", profile, null, null);
    return this.snapshot();
  }

  start(agentId: string, actor: string, revision?: number): AgentSnapshot {
    this.missions.requireEnabled();
    const agent = this.require(agentId);
    this.validateWorkspace(agent);
    if (agent.stoppedAt) throw new CommandRefusedError("A stopped agent cannot be started again.");
    const view = this.missions.mission(agent.missionId!);
    if (view.state !== "waiting_for_approval")
      throw new CommandRefusedError(
        `The agent's mission is ${view.state}, not waiting for plan approval.`,
      );
    const delegation = this.missions.agentic.forMission(agent.missionId!);
    if (delegation) this.missions.agentic.assertRevision(delegation.id, revision ?? -1);
    // Run open before approval so the first mission events land under a live run (A09 lineage).
    const run = this.openRun(agent.id, null, null);
    const prior = this.rowState(agent.id);
    if (prior && agentCanTransition(prior, "RUNNING")) this.transition(agent, "RUNNING", run);
    this.missions.approve(agent.missionId!, actor, true, revision);
    this.emitLifecycle("agent.started", agent, null, run.id);
    return this.snapshot();
  }

  pause(agentId: string, actor: string): AgentSnapshot {
    const agent = this.require(agentId);
    const flags = this.store.agentFlags(agent.id);
    if (flags.paused) throw new CommandRefusedError("The agent is already paused.");
    if (agent.stoppedAt || agent.completedAt) throw new CommandRefusedError("A finished agent cannot be paused.");
    const mission = this.mission(agent);
    if (["completed", "failed", "stopped"].includes(mission.state)) throw new CommandRefusedError("A finished agent cannot be paused.");
    const delegation = this.missions.agentic.forMission(agent.missionId!);
    if (delegation && delegation.current_state !== "ACTIVE") throw new CommandRefusedError("Pause requires current active Agentic consent; review pending access first.",
      );
    const now = Date.now();
    // Pause persists BEFORE anything else: a crash mid-pause must still leave the pause in place (§11).
    this.saveProfile({ ...agent, pausedAt: now, updatedAt: now }, "PAUSED", { ...flags, paused: true ,
    });
    if (delegation?.current_state === "ACTIVE") this.missions.syncAgentic(this.missions.agentic.state(delegation.id, "PAUSED"));
    this.emitLifecycle("agent.paused", agent, null, this.store.latestRun(agent.id)?.id ?? null);
    const run = this.store.latestRun(agent.id);
    if (run && run.endedAt === null) this.store.closeRun(run.id, "PAUSED", `Paused by ${actor}; new admissions hold, already-admitted steps finish.`,
        now,
      );
    return this.snapshot();
  }

  resume(agentId: string, actor: string): AgentSnapshot {
    const agent = this.require(agentId);
    this.validateWorkspace(agent);
    const flags = this.store.agentFlags(agent.id);
    if (!flags.paused) throw new CommandRefusedError("The agent is not paused.");
    // Resume revalidates from the canonical store, never from cached memory (§11).
    const envelope = this.missions.get(agent.missionId!)?.authorization ?? null;
    if (!envelope)
      throw new CommandRefusedError("The agent's authorization is missing; resume is refused.");
    if (envelope.revokedAt)
      throw new CommandRefusedError("The agent's authorization was revoked; resume is refused.");
    if (envelope.expiresAt !== null && envelope.expiresAt <= Date.now())
      throw new CommandRefusedError("The agent's authorization expired; resume is refused.");
    const delegation = this.missions.agentic.forMission(agent.missionId!);
    if (delegation) {
      if (delegation.current_state !== "PAUSED")
        throw new CommandRefusedError("Current Agentic consent does not permit Resume.");
      this.missions.syncAgentic(this.missions.agentic.state(delegation.id, "ACTIVE"));
    }
    const mission = this.mission(agent);
    if (mission.state === "stopped" || mission.state === "failed")
      throw new CommandRefusedError(
        `The agent's mission already ${mission.state}; nothing to resume.`,
      );
    const now = Date.now();
    this.saveProfile({ ...agent, pausedAt: null, updatedAt: now }, this.rowState(agent.id) ?? "PAUSED", { ...flags, paused: false },
    );
    const run = this.store.latestRun(agent.id);
    if (run && run.endedAt !== null && run.state === "PAUSED") this.store.openRun({ ...run, state: "RUNNING", endedAt: null, endReason: null });
    this.deriveTransition(agent);
    this.missions.schedule(agent.missionId!);
    this.emitLifecycle("agent.resumed", agent, null, run?.id ?? null);
    return this.snapshot();
  }

  async stop(agentId: string, actor: string): Promise<AgentSnapshot> {
    const agent = this.require(agentId);
    if (agent.completedAt) throw new CommandRefusedError("The agent already completed; nothing to stop.");
    if (agent.stoppedAt) throw new CommandRefusedError("The agent is already stopped; nothing is resurrected.");
    const now = Date.now();
    const flags = this.store.agentFlags(agent.id);
    // The durable stop flag persists BEFORE the stop runs: a crash mid-stop cannot resurrect the agent (§12).
    this.saveProfile({ ...agent, stoppedAt: now, updatedAt: now }, "STOPPED", { ...flags, stopped: true ,
    });
    const run = this.store.latestRun(agent.id);
    if (run && run.endedAt === null) this.store.closeRun(run.id, "STOPPED", `Stopped by ${actor}.`, now);
    try {
      await this.missions.stop(agent.missionId!, actor);
    } catch {
      /* mission may already be terminal; the stop flag is authoritative. */
    }
    this.emitLifecycle(
      "agent.stopped",
      agent,
      "STOP_REQUESTED",
      this.store.latestRun(agent.id)?.id ?? null,
    );
    return this.snapshot();
  }

  // ── derivation ────────────────────────────────────────────────────────────
  /** The full mission VIEW (Mission + steps); canonical facts for derivation and replay facts. */
  private mission(agent: AgentProfile) {
    return this.missions.get(agent.missionId!).mission;
  }
  private rowState(agentId: string): AgentState | null {
    const row = this.host.db.prepare("SELECT state FROM agents WHERE id=?").get(agentId) as
      { state: string } | undefined;
    return row ? (row.state as AgentState) : null;
  }
  private require(agentId: string): AgentProfile {
    const profile = this.profiles.get(agentId) ?? this.store.agent(agentId);
    if (!profile) throw new CommandRefusedError("Unknown agent.");
    this.profiles.set(profile.id, profile);
    return profile;
  }
  private saveProfile(
    profile: AgentProfile,
    state: AgentState,
    flags: { paused: boolean; stopped: boolean },
  ): void {
    this.store.saveAgent(profile, state, flags);
    this.profiles.set(profile.id, profile);
  }

  /** A stopped agent records no further continuity work; admission and events never resurrect it (§12, A21). */
  private onEvent(event: HostEventLike): void {
    let missionId = event.missionId ?? null;
    try {
      if (!missionId && event.taskId) {
        const task = this.missions.tasks.db.get(event.taskId);
        if (task?.mission?.missionId) missionId = task.mission.missionId;
      }
    } catch {
      /* attribution by missionId only */
    }
    if (!missionId) return;
    const agent = [...this.profiles.values()].find((profile) => profile.missionId === missionId);
    if (!agent) return;
    if (this.store.agentFlags(agent.id).stopped) return;
    const run = this.store.latestRun(agent.id);
    if (!run || run.endedAt !== null) return;
    if (event.type === "agent.capability_selected" || event.type === "agent.application_handoff") {
      const detail = JSON.parse(event.detail) as { stepId?: string };
      const step = this.missions.store
        .steps(missionId)
        .find((step) => step.id === detail.stepId && step.crossApp);
      if (step)
        this.checkpoint(
          agent,
          run,
          event.type === "agent.application_handoff"
            ? "before_application_handoff"
            : "before_capability_admission",
          { stepId: step.id },
          "Before the next reviewed cross-app capability.",
        );
    } else if (event.type === "capability.completed") {
      const capability = this.missions.store.runs({ missionId, limit: 1 })[0];
      if (
        capability?.stepId &&
        capability.status === "succeeded" &&
        this.missions.store.step(capability.stepId).crossApp
      )
        this.checkpoint(
          agent,
          run,
          "after_capability_completion",
          {
            stepId: capability.stepId,
            capabilityRunId: capability.id,
            outputRef: capability.outputRef ?? null,
          },
          "Canonical capability output committed; postconditions remain independent.",
        );
    }
    this.captureBoundaries(agent, run, event.type, event.taskId);
    this.deriveTransition(agent);
  }

  /** §8 checkpoint boundaries, captured on canonical mission events. Refs are canonical rows only. */
  private captureBoundaries(
    agent: AgentProfile,
    run: AgentRun,
    type: string,
    taskId: string | null,
  ): void {
    const stepsOf = (predicate: (step: MissionStep) => boolean): MissionStep[] => {
      try {
        return this.mission(agent).steps.filter(predicate);
      } catch {
        return [];
      }
    };
    if (type === "mission.step.ready") {
      const ready = stepsOf((step) => step.state === "ready");
      this.checkpoint(
        agent,
        run,
        "before_task_admission",
        refsForStep(ready),
        "Before next admission (step ready, nothing admitted).",
      );
    } else if (type === "mission.step.started") {
      const started = stepsOf((step) => step.attempts.at(-1)?.outcome === "running");
      this.checkpoint(
        agent,
        run,
        "before_task_admission",
        { ...refsForStep(started), ...(taskId ? { taskId } : {}) },
        "Child admitted for a step.",
      );
      for (const step of started)
        this.emitLifecycle("agent.task_started", agent, null, run.id, {
          stepId: step.id,
          ...(taskId ? { taskId } : {}),
        });
    } else if (type === "mission.step.completed") {
      const done = stepsOf((step) => step.attempts.at(-1)?.outcome === "completed");
      const verified = done.length > 0 && done.every((step) => step.result?.verified === true);
      this.checkpoint(
        agent,
        run,
        verified ? "after_verification" : "after_task_completion",
        refsForStep(done),
        verified
          ? "Bunny independently verified the result."
          : "Task finished; nothing was independently verified at this point.",
      );
      if (verified)
        for (const step of done)
          this.emitLifecycle("agent.task_completed", agent, null, run.id, {
            stepId: step.id,
            ...(taskId ? { taskId } : {}),
          });
    } else if (type === "mission.step.failed") {
      const failed = stepsOf((step) => step.attempts.at(-1)?.outcome === "failed");
      this.checkpoint(
        agent,
        run,
        "after_task_completion",
        refsForStep(failed),
        "An attempt failed; retry verdict follows canonical truth.",
      );
      for (const step of failed)
        this.emitLifecycle("agent.task_failed", agent, null, run.id, {
          stepId: step.id,
          ...(taskId ? { taskId } : {}),
        });
    } else if (type === "approval.mission_envelope") {
      const envelopeId = this.missions.get(agent.missionId!)?.authorization?.id ?? null;
      this.checkpoint(
        agent,
        run,
        "after_approval_decision",
        { ...(envelopeId ? { envelopeId } : {}) },
        "A scoped mission envelope decision was recorded.",
      );
    } else if (type === "routing.rerouted" || type === "routing.retrying") {
      this.checkpoint(
        agent,
        run,
        "before_provider_reroute",
        { ...(taskId ? { taskId } : {}) },
        "A provider reroute was recorded; the router owns the trail.",
      );
    } else if (type === "mission.waiting_for_user") {
      this.checkpoint(
        agent,
        run,
        "before_waiting_for_user",
        {},
        "The mission needs a user decision.",
      );
    }
  }

  private checkpoint(
    agent: AgentProfile,
    run: AgentRun,
    boundary: CheckpointBoundary,
    refs: Record<string, string | number | boolean | null>,
    summary: string,
  ): void {
    const revision = this.store.checkpointCount(run.id) + 1;
    this.store.saveCheckpoint({
      id: randomUUID(),
      agentId: agent.id,
      runId: run.id,
      boundary,
      at: Date.now(),
      revision,
      replaySafety: BOUNDARY_REPLAY[boundary],
      summary,
      refs: { missionId: agent.missionId, generation: run.generation, ...refs },
      facts: { revision, generation: run.generation },
    });
    this.store.trimCheckpoints(run.id);
    this.emitLifecycle("agent.checkpointed", agent, null, run.id, { boundary, revision });
  }

  /** Emits a §25 lifecycle row: taskId=null + missionId + kind marker, distinct from provider activity events. */
  private emitLifecycle(
    type: AgentLifecycleType,
    profile: AgentProfile | null,
    category: AgentFailure | null,
    runId: string | null,
    extra: Record<string, unknown> = {},
  ): void {
    if (!profile) return;
    const detail = JSON.stringify({
      kind: "agent-lifecycle",
      agentId: profile.id,
      ...(runId ? { runId: runId.slice(0, 64) } : {}),
      ...(category ? { category } : {}),
      ...clipExtras(extra),
    });
    this.missions.emit(type, detail, profile.missionId);
  }

  /** Legal transition only; a repeated derived state is a no-op, so recovery cannot duplicate history. */
  private transition(
    agent: AgentProfile,
    next: AgentState,
    run: AgentRun,
    failure: AgentProfile["failure"] = null,
  ): void {
    const prior = this.rowState(agent.id);
    if (!prior || next === prior || !agentCanTransition(prior, next)) return;
    const flags = this.store.agentFlags(agent.id);
    const now = Date.now();
    const profile: AgentProfile = {
      ...agent,
      failure:
        next === "FAILED"
          ? (failure ?? {
              category: "TASK_FAILED",
              detail:
                "The mission recorded this failure category; full diagnostics stay on the Host.",
            })
          : agent.failure,
      completedAt: next === "COMPLETED" ? now : agent.completedAt,
      updatedAt: now,
    };
    this.saveProfile(profile, next, flags);
    if (run.endedAt === null) this.store.openRun({ ...run, state: next });
    if (next === "COMPLETED" || next === "FAILED")
      this.store.closeRun(
        run.id,
        next,
        next === "COMPLETED"
          ? "Mission completed under its envelope."
          : (profile.failure?.category ?? "FAILED"),
        now,
      );
    this.emitLifecycle("agent.state_changed", profile, null, run.id, { from: prior, to: next });
    if (next === "WAITING_FOR_USER")
      this.emitLifecycle("agent.waiting_for_user", profile, null, run.id);
    if (next === "COMPLETED") this.emitLifecycle("agent.completed", profile, null, run.id);
    else if (next === "FAILED")
      this.emitLifecycle(
        "agent.failed",
        profile,
        profile.failure?.category ?? "TASK_FAILED",
        run.id,
      );
  }

  /** Derives from canonical rows and persists the legal transition; event-driven transitions end here. */
  private deriveTransition(agent: AgentProfile): void {
    try {
      const mission = this.mission(agent);
      const flags = this.store.agentFlags(agent.id);
      const failure = mission.state === "failed" ? this.failureOf(mission) : null;
      const next = deriveAgentState(mission, mission.steps, flags);
      const run = this.store.latestRun(agent.id);
      if (run && run.endedAt === null) this.transition(agent, next, run, failure);
    } catch {
      /* mission row unreadable — nothing to derive; recovery's fail-closed landing covers it. */
    }
  }

  private failureOf(mission: {
    state: string;
    failure: { category: string; detail: string | null } | null;
    steps: MissionStep[];
  }): AgentProfile["failure"] {
    const failedStep = mission.steps.find((step) => step.failure);
    if (failedStep?.failure)
      return mapFailure(failedStep.failure.category, failedStep.failure.detail ?? "");
    if (mission.failure) {
      if (
        mapFailure(mission.failure.category, mission.failure.detail ?? "").category ===
          "TASK_FAILED" &&
        routingExhausted(mission.failure.detail ?? "")
      )
        return {
          category: "ROUTING_EXHAUSTED",
          detail:
            "All eligible provider routing attempts were exhausted before this failure; the trail stays with the router.",
        };
      return mapFailure(mission.failure.category, mission.failure.detail ?? "");
    }
    return null;
  }

  private openRun(
    agentId: string,
    resumedFromRunId: string | null,
    resumedFromCheckpointId: string | null,
  ): AgentRun {
    const prior = this.store.latestRun(agentId);
    const run: AgentRun = {
      id: randomUUID(),
      agentId,
      generation: (prior?.generation ?? 0) + 1,
      state: "RUNNING",
      startedAt: Date.now(),
      endedAt: null,
      endReason: null,
      resumedFromRunId,
      resumedFromCheckpointId,
    };
    this.store.openRun(run);
    return run;
  }

  // ── §13 recovery walk ─────────────────────────────────────────────────────
  private walk(): void {
    for (const row of this.store.agentsIn([
      "CREATED",
      "PLANNING",
      "RUNNING",
      "WAITING_FOR_USER",
      "WAITING_FOR_DEPENDENCY",
      "PAUSED",
      "VERIFYING",
    ])) {
      const agent = row.record;
      const flags = this.store.agentFlags(agent.id);
      // Pause survives the restart and never auto-unpauses (A07/A08). A stopped agent is never resurrected or reused (A09).
      if (flags.paused) {
        this.saveProfile(agent, "PAUSED", flags);
        continue;
      }
      if (flags.stopped) continue;
      const claim = randomUUID();
      const claimed = this.store.claimRecovery(
        agent.id,
        claim,
        0,
        `host:${process.pid}`,
        Date.now(),
      );
      if (!claimed.ok) continue; // A20: exactly one worker recovers each agent; this worker skips.
      try {
        const priorRun = this.store.latestRun(agent.id);
        this.validateWorkspace(agent);
        if (priorRun && priorRun.endedAt === null) {
          this.store.closeRun(
            priorRun.id,
            "INTERRUPTED",
            `Host restarted during generation ${priorRun.generation}.`,
            Date.now(),
          );
          this.emitLifecycle("agent.interrupted", agent, "HOST_INTERRUPTED", priorRun.id);
        }
        // The predecessor is whatever run preceded this one — we just closed it above, or an
        // earlier walk closed it before dying. Either way the new generation names the link (§38).
        const nextRun = this.openRun(agent.id, priorRun?.id ?? null, null);
        const verdicts = this.classifyInterruptedSteps(agent, nextRun, priorRun?.id ?? null);
        const instructions = verdicts
          .filter((verdict) => verdict.instruction)
          .map((verdict) => verdict.instruction!);
        this.missions.tasks.containment.background(
          {
            subsystem: "agent-runtime",
            ...(agent.missionId ? { missionId: agent.missionId } : {}),
          },
          async () => {
            try {
              if (instructions.length)
                await this.missions.reconcileInterrupted(agent.missionId!, instructions);
            } finally {
              this.store.releaseClaim(agent.id, claim);
            }
            // Re-derive from canonical rows AFTER reconciliation landed its writes.
            this.deriveTransition(agent);
            for (const verdict of verdicts)
              this.emitLifecycle(
                "agent.checkpointed",
                agent,
                verdict.decision.category,
                nextRun.id,
                {
                  stepId: verdict.stepId,
                  replay: verdict.decision.action,
                  safety: verdict.decision.safety,
                  reason: verdict.decision.reason,
                },
              );
            this.emitLifecycle("agent.recovered", agent, null, nextRun.id, {
              generation: nextRun.generation,
              resumedFromRunId: priorRun?.id ?? null,
            });
          },
          (error) => {
            // Fail closed: reconciliation never improvises — the agent lands interrupted for the user (A19).
            const reason = error instanceof Error ? error.message : String(error);
            this.saveProfile(
              {
                ...agent,
                failure: {
                  category: "RECOVERY_AMBIGUOUS",
                  detail:
                    "Recovery reconciliation could not complete; the agent waits for the user.",
                },
                updatedAt: Date.now(),
              },
              "INTERRUPTED",
              { paused: false, stopped: false },
            );
            this.emitLifecycle("agent.interrupted", agent, "RECOVERY_AMBIGUOUS", nextRun.id, {
              reason: reason.slice(0, 300),
            });
            this.store.releaseClaim(agent.id, claim);
          },
          "SUBSYSTEM_FAILURE",
        );
      } catch (error) {
        this.store.releaseClaim(agent.id, claim);
        const message = error instanceof Error ? error.message : String(error);
        if (/workspace|CONTEXT_CHANGED|relink|inactive/i.test(message)) {
          const run = this.store.latestRun(agent.id);
          if (run && run.endedAt === null) this.store.closeRun(run.id,"INTERRUPTED","Workspace context needs review.",Date.now());
          this.saveProfile({ ...agent, updatedAt: Date.now(), failure: { category: "RECOVERY_AMBIGUOUS", detail: "Workspace context changed; review the Project root before continuing." } }, "INTERRUPTED", { paused: false, stopped: false });
          this.emitLifecycle("agent.interrupted",agent,"RECOVERY_AMBIGUOUS",run?.id ?? null);
        } else this.contain(error, "agent-runtime-walk", agent.missionId ?? undefined);
      }
    }
  }

  /** Builds ReplayFacts from canonical rows only and classifies each interrupted step (§9). */
  private classifyInterruptedSteps(
    agent: AgentProfile,
    nextRun: AgentRun,
    priorRunId: string | null,
  ): {
    stepId: string;
    decision: ReturnType<typeof classifyReplay>;
    instruction: { stepId: string; mode: "consume" | "resubmit" } | null;
  }[] {
    const out: {
      stepId: string;
      decision: ReturnType<typeof classifyReplay>;
      instruction: { stepId: string; mode: "consume" | "resubmit" } | null;
    }[] = [];
    let steps: MissionStep[] = [];
    let interruptedSteps: string[] = [];
    try {
      const mission = this.mission(agent);
      steps = mission.steps;
      interruptedSteps = mission.recovery?.interruptedSteps ?? [];
    } catch {
      /* mission unreadable: every verdict lands on the user below */
    }
    const targets = steps.filter((step) => interruptedSteps.includes(step.id));
    for (const step of targets) {
      const attempt = step.attempts.at(-1);
      const task = (() => {
        try {
          return attempt?.taskId ? this.missions.tasks.db.get(attempt.taskId) : null;
        } catch {
          return null;
        }
      })();
      let checkpointValid = true;
      try {
        if (priorRunId) this.store.checkpoints(priorRunId);
      } catch {
        checkpointValid = false;
      }
      const facts: ReplayFacts = {
        ...(step.crossApp && step.executor.kind === "capability"
          ? {
              capability: {
                replay: operationContract(step.executor.action)?.replay ?? "UNKNOWN",
                status: step.capabilityRunId
                  ? this.missions.store.run(step.capabilityRunId).status
                  : null,
                hasOutput: !!(
                  step.capabilityRunId && this.missions.store.run(step.capabilityRunId).outputRef
                ),
              },
            }
          : {}),
        stepId: step.id,
        scope: step.scope.access,
        attempt: { taskId: attempt?.taskId ?? null, outcome: attempt?.outcome ?? null },
        task: task
          ? {
              state: task.state as
                | "queued"
                | "waiting_for_approval"
                | "running"
                | "verifying"
                | "completed"
                | "failed"
                | "stopped",
              failureDetail: task.error ?? task.stopReason ?? null,
            }
          : null,
        verify: {
          hasSpec: step.verification.length > 0,
          recorded: !!task?.verification,
          passed: task?.verification?.passed ?? null,
        },
        checkpoint: {
          boundary: priorRunId ? (this.store.lastCheckpoint(priorRunId)?.boundary ?? null) : null,
          valid: checkpointValid,
        },
        attemptsUsed: step.attempts.length,
        maxAttempts: step.maxRetries * 2 + 2,
      };
      const decision = classifyReplay(facts);
      out.push({
        stepId: step.id,
        decision,
        instruction:
          decision.action === "consume_result" || decision.action === "verify_then_consume"
            ? { stepId: step.id, mode: "consume" as const }
            : decision.action === "requeue_once"
              ? { stepId: step.id, mode: "resubmit" as const }
              : null,
      });
    }
    return out;
  }

  private contain(error: unknown, subsystem: string, missionId?: string): void {
    this.missions.tasks.containment.background(
      { subsystem, ...(missionId ? { missionId } : {}) },
      () => {
        throw error;
      },
      undefined,
      "SUBSYSTEM_FAILURE",
    );
  }
}

const BOUNDARY_REPLAY: Record<
  CheckpointBoundary,
  "SAFE_TO_REPLAY" | "VERIFY_BEFORE_REPLAY" | "NOT_REPLAYABLE"
> = {
  before_capability_admission: "SAFE_TO_REPLAY",
  after_capability_completion: "VERIFY_BEFORE_REPLAY",
  before_application_handoff: "NOT_REPLAYABLE",
  before_task_admission: "SAFE_TO_REPLAY",
  after_task_completion: "VERIFY_BEFORE_REPLAY",
  after_verification: "VERIFY_BEFORE_REPLAY",
  before_waiting_for_user: "NOT_REPLAYABLE",
  after_approval_decision: "NOT_REPLAYABLE",
  before_provider_reroute: "NOT_REPLAYABLE",
  after_artifact_commit: "NOT_REPLAYABLE",
  before_terminal_state: "NOT_REPLAYABLE",
};

/** §7 bounded runtime resources. Constants for this gate, not user knobs. */
export const AGENT_LIMITS = { maxActiveAgents: 10 } as const;

export const AGENT_ACTIONS = new Set([
  "agent.create",
  "agent.start",
  "agent.pause",
  "agent.resume",
  "agent.stop",
  "agent.list",
  "agent.get",
]);
for (const action of [
  "agent.authorization.propose",
  "agent.authorization.approve",
  "agent.authorization.adjust",
  "agent.authorization.deny",
  "agent.authorization.revoke",
])
  AGENT_ACTIONS.add(action);

/** Same dispatch boundary as missionCommand: validated actions only, honest refusals otherwise (§26). */
export async function agentCommand(
  agents: AgentRuntime,
  action: string,
  data: Record<string, unknown>,
  actor: string,
): Promise<Record<string, unknown>> {
  if (!AGENT_ACTIONS.has(action)) throw new Error("Unknown agent action.");
  const agentId = typeof data.id === "string" ? data.id.slice(0, 200) : "";
  switch (action) {
    case "agent.create":
      return { agents: agents.create(data, actor) };
    case "agent.start":
      return { agents: agents.start(agentId, actor, Number(data.revision)) };
    case "agent.authorization.propose": {
      if (actor.startsWith("device:"))
        throw new CommandRefusedError("A remote device cannot invent Agentic scope.");
      const profile = agents.store.agent(agentId);
      if (!profile?.missionId) throw new CommandRefusedError("Unknown Agent.");
      agents.missions.proposeAgentAuthorization(agentId);
      return { agents: agents.snapshot() };
    }
    case "agent.authorization.approve": {
      const profile = agents.store.agent(agentId);
      if (!profile?.missionId) throw new CommandRefusedError("Unknown Agent.");
      const mission = agents.missions.mission(profile.missionId);
      if (mission.state === "waiting_for_approval")
        return { agents: agents.start(agentId, actor, Number(data.revision)) };
      agents.missions.reauthorizeAgent(profile.missionId, Number(data.revision), actor);
      return { agents: agents.snapshot() };
    }
    case "agent.authorization.adjust": {
      if (actor.startsWith("device:"))
        throw new CommandRefusedError(
          "Scope edits require the authenticated workstation owner flow.",
        );
      const profile = agents.store.agent(agentId);
      if (!profile?.missionId) throw new CommandRefusedError("Unknown Agent.");
      const patch = data.patch;
      if (!patch || typeof patch !== "object" || Array.isArray(patch))
        throw new CommandRefusedError("Expected a scope reduction patch.");
      agents.missions.adjustAgentAuthorization(profile.missionId, Number(data.revision), patch);
      return { agents: agents.snapshot() };
    }
    case "agent.authorization.deny":
    case "agent.authorization.revoke": {
      const profile = agents.store.agent(agentId);
      if (!profile?.missionId) throw new CommandRefusedError("Unknown Agent.");
      const e = agents.missions.agentic.forMission(profile.missionId);
      if (!e) throw new CommandRefusedError("No Agentic consent record.");
      agents.missions.syncAgentic(
        agents.missions.agentic.state(e.id, "REVOKED", Number(data.revision)),
      );
      if (!profile.stoppedAt && !profile.completedAt) await agents.stop(agentId, actor);
      return { agents: agents.snapshot() };
    }
    case "agent.pause":
      return { agents: agents.pause(agentId, actor) };
    case "agent.resume":
      return { agents: agents.resume(agentId, actor) };
    case "agent.stop":
      return { agents: await agents.stop(agentId, actor) };
    case "agent.list":
      return { agents: agents.snapshot() };
    case "agent.get": {
      const agents2 = agents.snapshot();
      const agent = agents2.agents.find((item) => item.id === agentId);
      if (!agent) throw new CommandRefusedError("Unknown agent.");
      return { agents: agents2, agent };
    }
    default:
      throw new Error("Unknown agent action.");
  }
}

function refsForStep(steps: MissionStep[]): Record<string, string | number | boolean | null> {
  return {
    steps: steps.length,
    ...(steps.length === 1 ? { stepId: steps[0].id, taskId: steps[0].taskId ?? null } : {}),
  };
}
function clipExtras(extra: Record<string, unknown>): Record<string, JsonValue> {
  const out: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(extra as Record<string, unknown>)) {
    if (typeof value === "string") {
      out[key] = value.length > 300 ? value.slice(0, 300) : value;
      continue;
    }
    if (value === null || typeof value === "boolean" || typeof value === "number") out[key] = value;
  }
  return out;
}
type HostEventLike = {
  sequence: number;
  type: string;
  taskId: string | null;
  detail: string;
  missionId?: string | null;
};
type AgentLifecycleType =
  | "agent.created"
  | "agent.started"
  | "agent.state_changed"
  | "agent.task_started"
  | "agent.task_completed"
  | "agent.task_failed"
  | "agent.checkpointed"
  | "agent.waiting_for_user"
  | "agent.paused"
  | "agent.resumed"
  | "agent.interrupted"
  | "agent.recovered"
  | "agent.completed"
  | "agent.failed"
  | "agent.stopped";
