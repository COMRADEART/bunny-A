/** MA4 metadata is data, never executable provider discovery or authority. */
import { z } from "zod";

export const DOCS_CHECKED_AT = "2026-10-20T00:00:00.000Z";
export const REFERENCES = {
  discovery: "https://github.com/mnfst/awesome-free-llm-apis",
  limits: "https://openrouter.ai/docs/api/reference/limits",
  free: "https://openrouter.ai/docs/guides/routing/model-variants/free",
  routing: "https://openrouter.ai/docs/guides/routing/provider-selection",
  models: "https://openrouter.ai/docs/api/api-reference/models/get-models",
  ollama: "https://docs.ollama.com/api/introduction",
} as const;
const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,179}$/);
const positive = z.number().int().positive().max(10_000_000);
export const ModelMetadataSchema = z.object({
  id, provider: z.string().min(1).max(80),
  compatibility: z.enum(["ollama", "openai-chat", "provider-specific"]),
  endpoint: z.string().url(), authentication: z.enum(["none", "bearer", "provider-specific"]),
  input: z.array(z.enum(["text", "image", "audio"])), output: z.array(z.enum(["text", "image", "audio"])),
  contextTokens: positive.nullable(), maxOutputTokens: positive.nullable(),
  tools: z.boolean().nullable(), structured: z.boolean().nullable(), streaming: z.boolean().nullable(),
  languages: z.array(z.string().min(1).max(40)).max(100),
  tier: z.enum(["local", "rate-limited-free", "trial-credit", "promotional", "paid", "unknown"]),
  inputUsdPerToken: z.number().finite().nonnegative().nullable(), outputUsdPerToken: z.number().finite().nonnegative().nullable(),
  license: z.string().max(1000).nullable(), restrictions: z.array(z.string().max(1000)).max(30),
  evidence: z.enum(["unverified", "official-documentation", "provider-reported"]),
  sources: z.array(z.string().url()).min(1).max(20), verifiedAt: z.string().datetime().nullable(),
  enabled: z.boolean().default(false), health: z.enum(["unknown", "available", "unavailable", "rate-limited"]).default("unknown"),
}).strict();
export type ModelMetadata = z.infer<typeof ModelMetadataSchema>;

export const ConfigurationSchema = z.object({
  version: z.literal(1), enabled: z.boolean(),
  models: z.array(id).max(32),
  // An aggregator's downstream hosts are external processors too. No unrestricted routing.
  upstreams: z.array(z.string().regex(/^[a-z0-9][a-z0-9_./-]{0,99}$/)).min(1).max(16),
  maxConcurrent: z.number().int().min(1).max(4),
  requestsPerMinute: z.number().int().min(1).max(20), requestsPerDay: z.number().int().min(1).max(50),
  tokensPerMinute: positive, maxOutputTokens: positive.max(32768),
  allowPaid: z.boolean(), maxUsdPerRequest: z.number().finite().nonnegative().max(10),
  maxUsdPerDay: z.number().finite().nonnegative().max(100),
  evaluationsAllowed: z.boolean(),
}).strict();
export type Configuration = z.infer<typeof ConfigurationSchema>;
export const DEFAULT_CONFIGURATION: Configuration = {
  version: 1, enabled: false, models: [], upstreams: ["openai"], maxConcurrent: 1,
  requestsPerMinute: 20, requestsPerDay: 50, tokensPerMinute: 10000,
  maxOutputTokens: 1024, allowPaid: false, maxUsdPerRequest: 0, maxUsdPerDay: 0, evaluationsAllowed: false,
};
export function loadConfiguration(raw: unknown): Configuration {
  return ConfigurationSchema.parse(raw);
}

/** Only publicly reported model facts are parsed. Listing never enables a new model. */
export function parseOpenRouterModels(raw: unknown, now = new Date().toISOString()): ModelMetadata[] {
  const body = z.object({ data: z.array(z.unknown()).max(10000) }).parse(raw);
  const rows: ModelMetadata[] = [];
  for (const value of body.data) {
    const parsed = z.object({ id, context_length: positive.nullish(),
      top_provider: z.object({ max_completion_tokens: positive.nullish() }).nullish(),
      architecture: z.object({ input_modalities: z.array(z.string()).optional(), output_modalities: z.array(z.string()).optional() }).nullish(),
      supported_parameters: z.array(z.string()).nullish(),
      pricing: z.object({ prompt: z.string(), completion: z.string() }).nullish(),
    }).safeParse(value);
    if (!parsed.success) continue;
    const r = parsed.data;
    const price = (v: string | undefined) => v !== undefined && v.trim() !== "" && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : null;
    const inputPrice = price(r.pricing?.prompt), outputPrice = price(r.pricing?.completion);
    const modalities = (v: string[] | undefined) => (v ?? []).filter((m): m is "text" | "image" | "audio" => ["text", "image", "audio"].includes(m));
    rows.push(ModelMetadataSchema.parse({
      id: r.id, provider: "openrouter", compatibility: "openai-chat", endpoint: "https://openrouter.ai/api/v1", authentication: "bearer",
      input: modalities(r.architecture?.input_modalities), output: modalities(r.architecture?.output_modalities),
      contextTokens: r.context_length ?? null, maxOutputTokens: r.top_provider?.max_completion_tokens ?? null,
      tools: r.supported_parameters ? r.supported_parameters.includes("tools") : null,
      structured: r.supported_parameters ? r.supported_parameters.includes("response_format") : null, streaming: null, languages: [],
      tier: r.id.endsWith(":free") && inputPrice === 0 && outputPrice === 0 ? "rate-limited-free" : inputPrice !== null && outputPrice !== null ? "paid" : "unknown",
      inputUsdPerToken: inputPrice, outputUsdPerToken: outputPrice,
      license: null, restrictions: ["Model license and downstream retention terms require separate review.", "Free quotas are account-dependent; no permanent availability guarantee."],
      evidence: "provider-reported", sources: [REFERENCES.models, REFERENCES.free, REFERENCES.limits], verifiedAt: now,
      enabled: false, health: "unknown",
    }));
  }
  return rows;
}

export type ModelRequirements = {
  contextTokens: number; outputTokens: number; structured: boolean; tools: boolean;
  input: ("text" | "image" | "audio")[]; language: string | null; sensitive: boolean;
};
export const RequirementsSchema = z.object({
  contextTokens: positive, outputTokens: positive, structured: z.boolean(), tools: z.boolean(),
  input: z.array(z.enum(["text", "image", "audio"])).min(1), language: z.string().max(40).nullable(), sensitive: z.boolean(),
}).strict();
export function modelExclusion(model: ModelMetadata, requirements: ModelRequirements): string | null {
  const r = RequirementsSchema.parse(requirements);
  if (!model.enabled) return "Model disabled pending explicit owner approval.";
  if (model.evidence === "unverified" || !model.verifiedAt) return "Model metadata is unverified.";
  if (r.sensitive && model.tier !== "local") return "Sensitive data requires local inference.";
  if (model.contextTokens === null || model.contextTokens < r.contextTokens + r.outputTokens) return "Verified context capacity is insufficient or unknown.";
  if (model.maxOutputTokens === null || model.maxOutputTokens < r.outputTokens) return "Output limit is insufficient or unknown.";
  if (r.structured && model.structured !== true) return "Structured output is unsupported or unknown.";
  if (r.tools && model.tools !== true) return "Tool-call capability is unsupported or unknown.";
  if (r.input.some(m => !model.input.includes(m))) return "Required input modality unavailable.";
  if (r.language && !model.languages.includes(r.language)) return "Required language support is unverified.";
  return null;
}
