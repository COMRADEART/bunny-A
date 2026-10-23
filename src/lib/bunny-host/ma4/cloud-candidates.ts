/**
 * MA4-S1R2 cloud candidates: documentation-verified DATA only. Every entry is disabled; listing a candidate never
 * activates it. Activation needs owner configuration, consent, credentials AND a scoped approval (hybrid.ts).
 */
import { ModelMetadataSchema, type ModelMetadata } from "./registry.ts";
import type { Chat, ChatResponse } from "./ollama-tools.server.ts";

export const CLOUD_DOCS_CHECKED_AT = "2026-10-21T00:00:00.000Z";
const candidate = (m: Omit<ModelMetadata, "enabled" | "health" | "evidence" | "verifiedAt" | "languages" | "license">): ModelMetadata =>
  ModelMetadataSchema.parse({ ...m, languages: [], license: null, evidence: "official-documentation", verifiedAt: CLOUD_DOCS_CHECKED_AT, enabled: false, health: "unknown" });

export const CLOUD_CANDIDATES: ModelMetadata[] = [
  candidate({ id: "openai/gpt-oss-120b", provider: "groq", compatibility: "openai-chat", endpoint: "https://api.groq.com/openai/v1", authentication: "bearer",
    input: ["text"], output: ["text"], contextTokens: null, maxOutputTokens: null, tools: true, structured: true, streaming: null, tier: "rate-limited-free",
    inputUsdPerToken: null, outputUsdPerToken: null,
    restrictions: ["Free-plan limits are organization-scoped and account-specific; the published table shows 30 RPM / 1K RPD / 8K TPM / 200K TPD as base values.", "No default retention of inference data, but inputs/outputs may be logged up to 30 days for reliability/abuse unless Zero Data Retention is enabled.", "Services Agreement s4.2: Groq may not train on Inputs/Outputs; services are not for consumer use.", "No parallel tool calls for gpt-oss models."],
    sources: ["https://console.groq.com/docs/rate-limits", "https://console.groq.com/docs/tool-use", "https://console.groq.com/docs/your-data", "https://console.groq.com/docs/legal/services-agreement"] }),
  candidate({ id: "qwen/qwen3.8-27b", provider: "groq", compatibility: "openai-chat", endpoint: "https://api.groq.com/openai/v1", authentication: "bearer",
    input: ["text"], output: ["text"], contextTokens: null, maxOutputTokens: null, tools: true, structured: true, streaming: null, tier: "rate-limited-free",
    inputUsdPerToken: null, outputUsdPerToken: null,
    restrictions: ["Same family as the local huihui_ai/Qwen3.8-abliterated:27b weights (abliterated variant differs).", "Same Groq retention, training and plan terms as gpt-oss-120b."],
    sources: ["https://console.groq.com/docs/rate-limits", "https://console.groq.com/docs/tool-use", "https://console.groq.com/docs/your-data"] }),
  candidate({ id: "gpt-oss-120b", provider: "ovhcloud", compatibility: "openai-chat", endpoint: "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1", authentication: "none",
    input: ["text"], output: ["text"], contextTokens: null, maxOutputTokens: null, tools: null, structured: null, streaming: null, tier: "rate-limited-free",
    inputUsdPerToken: null, outputUsdPerToken: null,
    restrictions: ["Anonymous access: 2 requests/minute per IP per model; API keys need a Public Cloud project with a payment method.", "Documentation states user data is not stored; EU hosting.", "Function calling is documented on this endpoint for other models (Mistral-Nemo chat completions, gpt-oss-20b Responses API), not verified for gpt-oss-120b: tools stays UNKNOWN."],
    sources: ["https://docs.ovhcloud.com/en/guides/public-cloud/ai-machine-learning/ai-endpoints-getting-started", "https://help.ovhcloud.com/csm/en-public-cloud-ai-endpoints-function-calling?id=kb_article_view&sysparm_article=KB0071906", "https://docs.ovhcloud.com/en/guides/public-cloud/ai-machine-learning/ai-endpoints-responses-api"] }),
];

/**
 * Adapts the provider-neutral tool loop (runToolLoop) to an OpenAI-compatible endpoint, offline-testable via `fetcher`.
 * Tool call ids are tracked so results map back; arguments stay strings and are validated by the loop's schemas.
 */
export function openAiChat(endpoint: string, key: () => Promise<string | null>, fetcher: typeof fetch): Chat {
  const url = new URL(endpoint);
  if (url.protocol !== "https:" || url.username || url.password || url.search) throw new Error("Cloud endpoint must be HTTPS without credentials or query parameters.");
  return async (body, signal) => {
    const pending: string[] = [];
    const messages = (body.messages as { role: string; content: string; tool_calls?: unknown[]; tool_name?: string }[]).map(m => {
      if (m.role === "assistant" && m.tool_calls) {
        pending.length = 0;
        return { role: "assistant", content: m.content || null, tool_calls: m.tool_calls.map((c, i) => { const call = c as { id?: string; function?: { name?: string; arguments?: unknown } }; const id = typeof call.id === "string" ? call.id : `call_${i}`; pending.push(id);
          return { id, type: "function", function: { name: call.function?.name, arguments: typeof call.function?.arguments === "string" ? call.function.arguments : JSON.stringify(call.function?.arguments ?? {}) } }; }) };
      }
      if (m.role === "tool") return { role: "tool", tool_call_id: pending.shift() ?? "unknown", content: m.content };
      return { role: m.role, content: m.content };
    });
    const token = await key();
    const response = await fetcher(`${endpoint.replace(/\/$/, "")}/chat/completions`, { method: "POST", signal, redirect: "error",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ model: body.model, messages, tools: body.tools, stream: false }) });
    if (!response.ok) { await response.body?.cancel(); throw new Error(`HTTP ${response.status}`); }
    const raw = await response.json() as { model?: string; choices?: { message?: { content?: string | null; tool_calls?: unknown } }[] };
    const message = raw.choices?.[0]?.message;
    if (!message) throw new Error("Malformed completion.");
    return { model: raw.model, done: true, message: { role: "assistant", content: message.content ?? "", ...(message.tool_calls !== undefined ? { tool_calls: message.tool_calls } : {}) } } satisfies ChatResponse;
  };
}
