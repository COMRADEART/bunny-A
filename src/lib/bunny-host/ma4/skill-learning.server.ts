import { createHash } from "node:crypto";
import { z } from "zod";
import type { LotusScope } from "../lotus.ts";
import type { CodingTask, Guidance, ModelCall, WorkflowResult } from "./coding-workflow.server.ts";
import type { ExperienceMemory } from "./experience.server.ts";
import type { SkillRegistry } from "./skills.server.ts";
import { renderGuidance, selectSkills, SkillProposalSchema, taskTags, usable, type Skill, type SkillProposal, type UseMode } from "./skills.ts";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

/**
 * Arm C guidance. Lotus is the retrieval stem: it returns the Host-written skill pointers and verified experience
 * records for the task's Host-derived tags from the authorized scopes; the registry supplies the procedure text of
 * pointed-to skills that are usable in this mode. Memory disabled → no pointers → no guidance at all.
 */
export function buildGuidance(input: { registry: SkillRegistry; memory: ExperienceMemory; scopes: LotusScope[]; task: Pick<CodingTask, "spec" | "testerRule">; mode: UseMode; maxChars?: number; now?: number }): { guidance: Guidance; skillIds: () => string[] } {
  const tags = taskTags(input.task), max = input.maxChars ?? 1200, used = new Set<string>();
  const pointers = input.memory.retrieve(input.scopes, tags, { types: ["skill-pointer"], limit: 6, now: input.now });
  const pointed = pointers.map(p => /^skill:([a-z0-9-]+)@v(\d+)$/.exec(p.memory.key)).filter((m): m is RegExpExecArray => !!m);
  const skills = input.registry.list().filter(s => pointed.some(m => m[1] === s.name && Number(m[2]) === s.version) && usable(s, input.mode));
  const experiences = input.memory.retrieve(input.scopes, tags, { types: ["experience"], limit: 3, now: input.now });
  const guidance: Guidance = ({ role, phase, categories }) => {
    const chosen = selectSkills(skills, { role, tags, categories: phase === "repair" ? categories : undefined, mode: input.mode, limit: 3 });
    const notes = role === "Planner" || phase === "repair" ? experiences.map(e => `- ${e.line}`) : [];
    let text = renderGuidance(chosen, max);
    if (notes.length) {
      const block = ["VERIFIED EXPERIENCE (Host records of earlier outcomes on similar tasks; advisory):", ...notes].join("\n");
      if (text.length + block.length + 1 <= max) text = text ? `${text}\n${block}` : block;
    }
    for (const s of chosen) used.add(s.id);
    return { text, sources: [...chosen.map(s => `skill:${s.id}`), ...(notes.length && text.includes("VERIFIED EXPERIENCE") ? experiences.map(e => `memory:${e.memory.id}`) : [])] };
  };
  return { guidance, skillIds: () => [...used] };
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
