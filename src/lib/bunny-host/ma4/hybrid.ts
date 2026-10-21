/**
 * MA4-S1R2 hybrid routing policy: routing modes, scoped external-provider approvals and measured
 * task-category reliability. Pure functions; the Host store persists records. Nothing here activates
 * a provider: an approval only REMOVES one exclusion, every other gate (consent, configuration,
 * budget, privacy, pins) still applies.
 */
import { z } from "zod";
import type { TaskConstraints } from "../../orch/types.ts";
import type { TaskAnalysis } from "./analyzer.ts";

export const ROUTING_MODES = ["AUTO_LOCAL", "AUTO_HYBRID", "MODEL_PINNED", "AGENT_HYBRID", "OFFLINE_ONLY"] as const;
export type RoutingMode = (typeof ROUTING_MODES)[number];
export const DATA_CATEGORIES = ["synthetic", "public", "code", "personal", "unclassified"] as const;
export type DataCategory = (typeof DATA_CATEGORIES)[number];

/**
 * Mode → hard constraints. Absent mode keeps the established behaviour, where MA4 API providers still need
 * an approval record (see approvalExclusion). Modes only ever ADD restrictions; none removes one.
 */
export function applyRoutingMode(constraints: TaskConstraints): TaskConstraints {
  switch (constraints.routingMode) {
    case undefined: case "AUTO_HYBRID": case "AGENT_HYBRID": return constraints;
    case "AUTO_LOCAL": return { ...constraints, localOnly: true };
    case "OFFLINE_ONLY": return { ...constraints, localOnly: true, offlineOnly: true };
    case "MODEL_PINNED":
      if (!constraints.modelExact) throw new Error("MODEL_PINNED requires an exact model; Bunny will not choose one for you.");
      return constraints;
    default: throw new Error("Unknown routing mode.");
  }
}

const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,179}$/);
export const PURPOSES = ["reasoning", "coding", "debugging", "research", "summarization", "planning", "mathematics", "multimodal", "tool-execution", "general"] as const;
export const ApprovalSchema = z.object({
  provider_id: z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/), model_id: id,
  approval_status: z.enum(["pending", "approved", "revoked"]),
  approved_purpose: z.array(z.enum(PURPOSES)).min(1).max(PURPOSES.length).nullable(),
  data_categories: z.array(z.enum(DATA_CATEGORIES)).max(DATA_CATEGORIES.length),
  spending_limit_usd: z.number().finite().nonnegative().max(100),
  expiry: z.string().datetime().nullable(),
}).strict();
export type Approval = z.infer<typeof ApprovalSchema>;
/** Persisted form: who issued it is stamped by the Host, never taken from the record's own text. */
export type IssuedApproval = Approval & { issued_by: "workstation"; issued_at: string };

/** Imported files, configuration and agent/model output are data: they can only ever propose a PENDING record. */
export function importApproval(raw: unknown): Approval {
  return { ...ApprovalSchema.parse(raw), approval_status: "pending" };
}

/** Null means this approval covers the request. Exact provider+model; an approved provider never implies its other models. */
export function approvalExclusion(approvals: readonly IssuedApproval[], request: { provider: string; model: string; purpose: TaskAnalysis["category"]; dataCategory: DataCategory; estimatedUsd: number; spentUsd: number; now?: number }): string | null {
  const now = request.now ?? Date.now();
  const match = approvals.filter(a => a.provider_id === request.provider && a.model_id === request.model && a.issued_by === "workstation");
  const active = match.filter(a => a.approval_status === "approved");
  if (!active.length) return match.some(a => a.approval_status === "revoked") ? "External model approval was revoked." : "External inference needs an owner-issued approval for this exact provider and model.";
  for (const a of active) {
    if (!a.expiry || Date.parse(a.expiry) <= now) continue;
    if (!a.approved_purpose?.includes(request.purpose)) continue;
    if (!a.data_categories.includes(request.dataCategory)) continue;
    if (request.spentUsd + request.estimatedUsd > a.spending_limit_usd) return "The approved spending limit for this model would be exceeded.";
    return null;
  }
  return `No unexpired approval covers purpose "${request.purpose}" with data category "${request.dataCategory}" for this model.`;
}

/** Benchmark categories the reliability evidence is recorded under (bench-tasks.mjs CATEGORIES). */
export type ReliabilityCategory = "programming" | "debugging" | "planning" | "json-schema" | "math" | "tool-call" | "instruction-following" | "code-review" | "multi-agent";
export type ReliabilityEvidence = { provider: string; model: string; category: ReliabilityCategory; passes: number; samples: number; source: string };

export function reliabilityCategory(analysis: TaskAnalysis | undefined): ReliabilityCategory | null {
  if (!analysis) return null;
  const map: Partial<Record<TaskAnalysis["category"], ReliabilityCategory>> = { coding: "programming", debugging: "debugging", planning: "planning", mathematics: "math", "tool-execution": "tool-call" };
  return map[analysis.category] ?? (analysis.required.structured ? "json-schema" : null);
}

/** Wilson score lower bound (95%): small samples are penalized instead of trusted. */
export function wilsonLower(passes: number, samples: number, z = 1.96): number {
  if (!Number.isInteger(passes) || !Number.isInteger(samples) || samples <= 0 || passes < 0 || passes > samples) return 0;
  const p = passes / samples, d = 1 + z * z / samples;
  return Math.max(0, (p + z * z / (2 * samples) - z * Math.sqrt(p * (1 - p) / samples + z * z / (4 * samples * samples))) / d);
}

export const RELIABILITY_WEIGHT = 20;
/** Points in [-10, +10]: ~0 at a 50% lower bound. Missing evidence is UNPROVEN and earns nothing, never a bonus. */
export function reliabilityPoints(evidence: Pick<ReliabilityEvidence, "passes" | "samples"> | null): { points: number; detail: string } {
  if (!evidence || evidence.samples < 3) return { points: 0, detail: "Task-category reliability UNPROVEN (fewer than 3 measured samples); no bonus." };
  const lower = wilsonLower(evidence.passes, evidence.samples);
  return { points: Math.round((lower - 0.5) * RELIABILITY_WEIGHT * 10) / 10, detail: `Measured ${evidence.passes}/${evidence.samples} correct in this task category (95% lower bound ${(lower * 100).toFixed(0)}%).` };
}
