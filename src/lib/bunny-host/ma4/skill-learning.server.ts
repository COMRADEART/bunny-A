import { createHash } from "node:crypto";
import { z } from "zod";
import type { LotusScope } from "../lotus.ts";
import type { CodingTask, Guidance, ModelCall, WorkflowResult } from "./coding-workflow.server.ts";
import type { ExperienceMemory } from "./experience.server.ts";
import type { SkillRegistry } from "./skills.server.ts";
import { SkillProposalSchema, type Skill, type SkillProposal, type UseMode } from "./skills.ts";
import { eligibility, experienceEligibility, renderAdvisory, safeMemoryText, selectRelevant, signatureHash, taskSignature, type GateContext, type SignatureInput, type SkillDecision, type TaskSignature } from "./relevance.ts";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

/** What one task's retrieval did: the signature, every candidate's decision, what was selected, cost and latency. */
export type RetrievalDecision = {
  signature: TaskSignature; signatureSha256: string; latencyMs: number;
  skills: { inspected: number; eligible: number; rejected: number; selected: { id: string; name: string; version: number; score: number | null; excerptChars: number } | null; decisions: SkillDecision[] };
  experience: { inspected: number; selected: string | null; rejected: { memoryId: string; reasons: string[] }[] };
};

/**
 * MA4-S2R1 guidance. Lotus is the retrieval stem: it returns the Host-written skill pointers (and, unless
 * `experience` is false, verified experience records) from the authorized scopes only; the registry supplies the
 * pointed-to skills; relevance.ts decides — at most one skill, only if it is eligible for this task's signature, and
 * nothing when none is. The chosen skill is re-checked against the registry on every call, so a rollback, quarantine
 * or replaced text removes it from the next prompt. Memory disabled → no pointers → no guidance at all.
 */
export function buildGuidance(input: { registry: SkillRegistry; memory: ExperienceMemory; scopes: LotusScope[]; task: SignatureInput; mode: UseMode; experience?: boolean; now?: number; authorizedScopes?: string[]; grantedPermissions?: string[] }): { guidance: Guidance; skillIds: () => string[]; decision: RetrievalDecision } {
  const started = performance.now(), now = input.now ?? Date.now();
  const sig = taskSignature(input.task, { projectScope: input.scopes[0] ?? "" });
  const ctx: GateContext = { mode: input.mode, now, authorizedScopes: input.authorizedScopes, grantedPermissions: input.grantedPermissions };
  const pointed = input.memory.retrieve(input.scopes, [], { types: ["skill-pointer"], limit: 50, now })
    .map(p => /^skill:([a-z0-9-]+)@v(\d+)$/.exec(p.memory.key)).filter((m): m is RegExpExecArray => !!m);
  const candidates = input.registry.list().filter(s => pointed.some(m => m[1] === s.name && Number(m[2]) === s.version));
  const pick = selectRelevant(candidates, sig, ctx);
  let line = "", lineId: string | null = null;
  const records = input.experience === false ? [] : input.memory.retrieve(input.scopes, [], { types: ["experience"], limit: 50, now });
  const rejected: { memoryId: string; reasons: string[] }[] = [];
  for (const r of records) {
    const reasons = [...experienceEligibility(r.meta.tags, sig), ...(safeMemoryText(`${r.memory.key} ${r.memory.value}`) ? [] : ["unsafe content"])];
    if (reasons.length || lineId) { if (reasons.length) rejected.push({ memoryId: r.memory.id, reasons }); continue; }
    line = r.line; lineId = r.memory.id;
  }
  const chosen = pick.selected ? pick.decisions.find(d => d.skillId === pick.selected!.id)! : null;
  const decision: RetrievalDecision = { signature: sig, signatureSha256: signatureHash(sig), latencyMs: +(performance.now() - started).toFixed(2),
    skills: { inspected: candidates.length, eligible: pick.decisions.filter(d => d.eligible).length, rejected: pick.decisions.filter(d => !d.eligible).length,
      selected: chosen && { id: chosen.skillId, name: chosen.name, version: chosen.version, score: chosen.score, excerptChars: chosen.excerptChars }, decisions: pick.decisions },
    experience: { inspected: records.length, selected: lineId, rejected } };
  const used = new Set<string>();
  const guidance: Guidance = ({ role, phase }) => {
    const s = pick.selected;
    const current = s && (s.roles as readonly string[]).includes(role) ? input.registry.get(s.id) : null;
    const skillText = current && !eligibility(current, sig, { ...ctx, now: input.now ?? Date.now() }).length ? pick.text : "";
    const note = role === "Planner" || phase === "repair" ? line : "";
    const text = renderAdvisory(skillText, note);
    const sources = [...(skillText && text.includes("- procedure") ? [`skill:${s!.id}`] : []), ...(note && text.includes("- experience") ? [`memory:${lineId}`] : [])];
    if (sources.some(x => x.startsWith("skill:"))) used.add(s!.id);
    return { text, sources };
  };
  return { guidance, skillIds: () => [...used], decision };
}

const EXTRACT_SCHEMA = z.toJSONSchema(SkillProposalSchema) as Record<string, unknown>;
/**
 * Asks the (local) extraction model for one declarative procedure from a trial the deterministic gate PASSED. Its
 * input is only public material: the task specification, the attributed failure categories and the final source the
 * Worker itself wrote. Never hidden tests, references, hidden-test details or oracle messages.
 */
export async function extractSkill(input: { call: ModelCall; model: string; task: CodingTask; result: WorkflowResult; signal: AbortSignal }): Promise<{ proposal: SkillProposal | null; promptSha256: string; error: string | null; durationMs: number }> {
  const categories = [...new Set(input.result.failures.map(f => `${f.failureCategory} (${f.suspectedComponent})`))];
  const prompt = `You are the Reviewer agent. A coding task below was solved and passed deterministic checks${categories.length ? ` after these problems were found and repaired: ${categories.join(", ")}` : " on the first attempt"}.
Write ONE reusable procedure that would help a Planner, Worker or Tester solve DIFFERENT future tasks of the same kind. Rules: general steps only; do not copy function names, literal values or examples from this task; do not mention any model or provider; never suggest skipping, weakening or editing tests or checks; tools may only be ma4.static_check, ma4.import_smoke or ma4.run_tests (or none).
categories must be chosen from: strict-parsing, validation-errors, string-processing, collections, algorithm, debugging, stateful-class, numeric.
TASK:
${input.task.spec}
FINAL PASSING SOURCE:
${(input.result.finalSource ?? "").slice(0, 4000)}
Return JSON: name (lowercase-hyphenated), description, categories, preconditions, procedure (1-6 short steps), roles (Planner/Worker/Tester), tools, limitations.`;
  const started = Date.now();
  const r = await input.call({ role: "Reviewer", model: input.model, prompt, schema: EXTRACT_SCHEMA, signal: input.signal, attempt: 0, options: { temperature: 0.2, numPredict: 1024 } });
  if (!r.ok) return { proposal: null, promptSha256: sha(prompt), error: r.error, durationMs: Date.now() - started };
  if (r.servedModel !== input.model) return { proposal: null, promptSha256: sha(prompt), error: `served by ${r.servedModel}, not ${input.model}`, durationMs: Date.now() - started };
  try {
    const parsed = SkillProposalSchema.safeParse(JSON.parse(r.text));
    return { proposal: parsed.success ? parsed.data : null, promptSha256: sha(prompt), error: parsed.success ? null : parsed.error.issues.slice(0, 2).map(i => `${i.path.join(".")} ${i.message}`).join("; "), durationMs: Date.now() - started };
  } catch { return { proposal: null, promptSha256: sha(prompt), error: "not JSON", durationMs: Date.now() - started }; }
}

/** Skills a qualification or evaluation trial actually saw, from the workflow's guidance record. */
export const skillsSeen = (result: WorkflowResult): string[] => [...new Set((result.guidance ?? []).flatMap(g => g.sources).filter(s => s.startsWith("skill:")).map(s => s.slice(6)))];
export type { Skill };
