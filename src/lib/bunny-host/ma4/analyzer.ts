import { z } from "zod";
import { classifyRequirements } from "../../orch/router-requirements.ts";
import type { Mode, TaskConstraints } from "../../orch/types.ts";
import { RequirementsSchema } from "./registry.ts";

export const TaskAnalysisSchema = z.object({
  category: z.enum(["reasoning", "coding", "debugging", "research", "summarization", "planning", "mathematics", "multimodal", "tool-execution", "general"]),
  complexity: z.enum(["low", "medium", "high", "maximum"]), latency: z.enum(["fast", "balanced", "quality"]),
  sensitivity: z.enum(["local-only", "ordinary"]),
  multipleAgentsSuggested: z.boolean(),
  required: RequirementsSchema,
  providerAllowlist: z.array(z.string()).nullable(), modelExact: z.string().nullable(),
  // Null is UNKNOWN: never describe unpriced work as free.
  maximumUsd: z.number().finite().nonnegative().nullable(),
}).strict();
export type TaskAnalysis = z.infer<typeof TaskAnalysisSchema>;

/** Normalize existing MA3 analysis, with validated MA4 requirements. This never decomposes, launches, or grants tools. */
export function analyzeModelTask(input: { prompt: string; mode?: Mode | null; constraints?: TaskConstraints | null }) {
  const legacy = classifyRequirements(input), c = input.constraints ?? {}, text = input.prompt;
  const category: TaskAnalysis["category"] = legacy.needs_tools ? "tool-execution" : legacy.needs_vision || c.requiresAudio ? "multimodal"
    : /\b(?:debug|debugging|bug|failing)\b/i.test(text) ? "debugging"
    : /\b(?:summarize|summarise|summary|summarization)\b/i.test(text) ? "summarization"
    : /\b(?:plan|planning|roadmap)\b/i.test(text) ? "planning"
    : legacy.task_class === "math" ? "mathematics" : legacy.task_class === "coding" ? "coding"
    : legacy.task_class === "research" ? "research" : legacy.task_class === "reasoning" ? "reasoning" : "general";
  const analysis = TaskAnalysisSchema.parse({ category,
    complexity: legacy.reasoning_complexity === "MAX" ? "maximum" : legacy.reasoning_complexity.toLowerCase(),
    latency: input.mode === "fast" ? "fast" : input.mode === "deep" ? "quality" : "balanced",
    sensitivity: legacy.privacy_requirement === "local_only" || c.sensitive ? "local-only" : "ordinary",
    multipleAgentsSuggested: /\b(?:multi.agent|independent review|build and test|code and test)\b/i.test(text),
    required: { contextTokens: Math.max(c.contextTokens ?? 0, new TextEncoder().encode(text).length + 256), outputTokens: c.outputTokens ?? 1024,
      structured: !!c.responseFormat || legacy.task_class === "structured_generation", tools: legacy.needs_tools,
      input: c.requiresAudio ? ["audio"] : legacy.needs_vision ? ["image"] : ["text"], language: c.language ?? null,
      sensitive: legacy.privacy_requirement === "local_only" || !!c.sensitive },
    providerAllowlist: c.providerAllowlist ?? null, modelExact: c.modelExact ?? null, maximumUsd: c.maxCostUsd ?? null,
  });
  return { legacy, analysis };
}
