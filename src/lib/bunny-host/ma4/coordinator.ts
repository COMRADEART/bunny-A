/**
 * MA4-S2 Coordinator (trusted orchestration, not a model). It composes a bounded team from the task's required
 * capabilities, assigns a model per role with the existing S1R4 rules (pins never substituted, eligibility hard,
 * measured role evidence soft, abstain rather than guess), decides a memory-aware schedule, and admits every
 * handoff through the collaboration protocol. It never adds tools, permissions or providers.
 */
import { assignRole, type AgentRole, type RoleAssignment, type RoleCandidate, type RoleEvidence } from "./hybrid.ts";
import { admitHandoff, HANDOFF_VERSION, ROLE_CAPABILITIES, sha256, type Admission, type Capability, type Handoff, type S2Role } from "./collaboration.ts";
import type { ModelCall } from "./coding-workflow.server.ts";

/** Active model roles stay bounded at four (S1R4 bound). Host-executed roles (Coordinator, Researcher) run no model. */
export const MAX_ACTIVE_MODEL_ROLES = 4;
export type TeamNeeds = { capabilities: readonly Capability[]; memory: boolean };
export type Team = { members: S2Role[]; modelRoles: AgentRole[]; hostRoles: S2Role[]; reasons: string[] };

/**
 * Compose the smallest team that covers the needed capabilities. Retrieval is the Researcher's job and is executed by
 * the Host against Lotus Memory (no model call), so memory adds no inference and no active model role.
 */
export function composeTeam(needs: TeamNeeds): Team {
  const order: AgentRole[] = ["Planner", "Worker", "Tester", "Reviewer"];
  const modelRoles = order.filter(r => ROLE_CAPABILITIES[r].some(c => needs.capabilities.includes(c)));
  const hostRoles: S2Role[] = ["Coordinator", ...(needs.memory || needs.capabilities.includes("retrieval") ? ["Researcher" as const] : [])];
  if (modelRoles.length > MAX_ACTIVE_MODEL_ROLES) throw new Error(`A team may have at most ${MAX_ACTIVE_MODEL_ROLES} active model roles.`);
  const uncovered = needs.capabilities.filter(c => c !== "orchestration" && ![...modelRoles, ...hostRoles].some(r => ROLE_CAPABILITIES[r].includes(c)));
  if (uncovered.length) throw new Error(`No role covers: ${uncovered.join(", ")}.`);
  return { members: [...hostRoles.slice(0, 1), ...modelRoles, ...hostRoles.slice(1)], modelRoles, hostRoles,
    reasons: [...modelRoles.map(r => `${r}: ${ROLE_CAPABILITIES[r].filter(c => needs.capabilities.includes(c)).join(", ")}`), ...(hostRoles.includes("Researcher") ? ["Researcher: Host retrieval from Lotus Memory (no model)"] : [])] };
}

/** Coding tasks need plan, code, tests and review: the four S1R4 roles. */
export const CODING_NEEDS = (memory: boolean): TeamNeeds => ({ capabilities: ["planning", "code-generation", "test-generation", "review"], memory });

export type Assignment = { team: Team; roles: RoleAssignment[]; pins: Record<AgentRole, string> };
/** Every model role gets a model or the team is refused (no silent partial team, no substitution of a pin). */
export function assignTeam(team: Team, input: { candidates: readonly RoleCandidate[]; evidence: readonly RoleEvidence[]; pins?: Partial<Record<AgentRole, string>>; highRisk?: boolean }): Assignment {
  const roles = team.modelRoles.map(role => assignRole(role, input.candidates, input.evidence, { pin: input.pins?.[role] ?? null, highRisk: input.highRisk }));
  const missing = roles.filter(r => !r.model);
  if (missing.length) throw new Error(`Team not assigned: ${missing.map(r => `${r.role} (${r.reasons[0]})`).join("; ")}`);
  return { team, roles, pins: Object.fromEntries(roles.map(r => [r.role, r.model!])) as Record<AgentRole, string> };
}

export type Schedule = { mode: "parallel" | "grouped"; reason: string };
/**
 * Memory-aware schedule. Two different models in flight at once must both fit in VRAM; otherwise calls are grouped by
 * model (no concurrent loads), which avoids swap thrash on a 6 GiB GPU. Unknown sizes are treated as not fitting.
 */
export function planSchedule(pins: Record<AgentRole, string>, resources: { vramGiB: number; modelGiB: Record<string, number> }): Schedule {
  const concurrent = [...new Set([pins.Worker, pins.Tester].filter(Boolean))];
  if (concurrent.length < 2) return { mode: "parallel", reason: "Worker and Tester share one model; it is loaded once." };
  const need = concurrent.reduce((a, m) => a + (resources.modelGiB[m] ?? Infinity), 0);
  return need <= resources.vramGiB
    ? { mode: "parallel", reason: `Both models fit together (${need.toFixed(1)} of ${resources.vramGiB} GiB).` }
    : { mode: "grouped", reason: `Worker and Tester models need ${Number.isFinite(need) ? need.toFixed(1) : "unknown"} GiB together but ${resources.vramGiB} GiB of VRAM is available; calls are grouped by model.` };
}

/**
 * Bounded model-call gate: at most `maxConcurrent` calls in flight, a per-call timeout, cancellation.
 * It records peak concurrency and model switches so the schedule's effect is measured, not assumed.
 * MA4-S3-T4: wait states handle abort/cancellation immediately without slot acquisition or model-switch side effects.
 */
export function gateCalls(call: ModelCall, limits: { maxConcurrent: number; timeoutMs: number }) {
  let active = 0, peak = 0, switches = 0, last: string | null = null;
  type Waiter = { resolve: () => void; reject: (err: unknown) => void; signal: AbortSignal; onAbort?: () => void };
  const waiting: Waiter[] = [];

  const wakeNext = () => {
    while (waiting.length > 0) {
      const next = waiting.shift()!;
      if (next.onAbort) next.signal.removeEventListener("abort", next.onAbort);
      if (!next.signal.aborted) {
        next.resolve();
        return;
      }
    }
  };

  const gated: ModelCall = async request => {
    const started = Date.now();
    if (request.signal.aborted) return { ok: false, error: "Stopped.", stopped: true, durationMs: 0 };
    if (active >= limits.maxConcurrent) {
      try {
        await new Promise<void>((resolve, reject) => {
          const waiter: Waiter = { resolve, reject, signal: request.signal };
          const onAbort = () => {
            const idx = waiting.indexOf(waiter);
            if (idx >= 0) waiting.splice(idx, 1);
            reject(new Error("Stopped."));
          };
          waiter.onAbort = onAbort;
          request.signal.addEventListener("abort", onAbort, { once: true });
          waiting.push(waiter);
        });
      } catch {
        return { ok: false, error: "Stopped.", stopped: true, durationMs: Date.now() - started };
      }
    }
    if (request.signal.aborted) {
      wakeNext();
      return { ok: false, error: "Stopped.", stopped: true, durationMs: Date.now() - started };
    }
    active++; peak = Math.max(peak, active);
    if (last !== null && last !== request.model) switches++;
    last = request.model;
    const timeout = AbortSignal.timeout(limits.timeoutMs);
    try { return await call({ ...request, signal: AbortSignal.any([request.signal, timeout]) }); }
    finally { active--; wakeNext(); }
  };
  return {
    call: gated,
    stats: () => ({ peakConcurrent: peak, modelSwitches: switches }),
    waitingCount: () => waiting.length,
    activeCount: () => active,
  };
}

/**
 * The Coordinator's channel: the requirements hash is frozen when the team is formed; every message carries the hash the
 * sender computed from the task it is actually working on, so a changed task is refused. Builds a protocol message for every transfer between roles and admits it. Artifacts are
 * registered by the Host when it records them; a message can only reference registered hashes.
 */
export function coordinatorChannel(input: { taskId: string; requirementsSha256: string; members: readonly S2Role[]; deadlineAt: number; budget: Handoff["budget"]; now?: () => number }) {
  const known = new Map<string, number>(), log: { id: string; from: S2Role; to: S2Role; ok: boolean; reason: string | null; trust: Handoff["trust"] | null; artifacts: number }[] = [];
  const remaining = { ...input.budget };
  const now = input.now ?? Date.now;
  return {
    register(text: string) { const h = sha256(text); known.set(h, text.length); return { sha256: h, bytes: text.length }; },
    send(from: S2Role, to: S2Role, subtaskId: string, payload: { requirementsSha256: string; capabilities: Capability[]; content: string; artifacts?: Handoff["artifacts"]; trust: Handoff["trust"]; validation: Handoff["validation"]; cost?: Partial<Handoff["budget"]>; schemas?: Handoff["schemas"] }): Admission {
      const message = { version: HANDOFF_VERSION, id: `${input.taskId}:${log.length}`, taskId: input.taskId, subtaskId, from, to, capabilities: payload.capabilities, requirementsSha256: payload.requirementsSha256,
        schemas: payload.schemas ?? { input: "contract.v1", output: `${to.toLowerCase()}.v1` }, artifacts: payload.artifacts ?? [], deadlineAt: input.deadlineAt,
        budget: { modelCalls: payload.cost?.modelCalls ?? 0, toolCalls: payload.cost?.toolCalls ?? 0, tokens: payload.cost?.tokens ?? 0 }, trust: payload.trust, validation: payload.validation, content: payload.content };
      const admission = admitHandoff(message, { requirementsSha256: input.requirementsSha256, members: input.members, knownArtifacts: known, remaining, now: now() });
      if (admission.ok) for (const k of ["modelCalls", "toolCalls", "tokens"] as const) remaining[k] -= admission.message.budget[k];
      log.push({ id: message.id, from, to, ok: admission.ok, reason: admission.ok ? null : admission.reason, trust: admission.ok ? admission.message.trust : null, artifacts: message.artifacts.length });
      return admission;
    },
    log: () => log.slice(),
    remaining: () => ({ ...remaining }),
  };
}
export type CoordinatorChannel = ReturnType<typeof coordinatorChannel>;
