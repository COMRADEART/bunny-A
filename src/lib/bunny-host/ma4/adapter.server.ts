import type { AdapterHooks, ProviderAdapter, RunningSession } from "../contracts.ts";
import type { OrchTask, ProviderLive } from "../../orch/types.ts";
import type { ModelCapabilityRecord } from "../model-capability.server.ts";
import { FEATURES, providerBase } from "../adapters.server.ts";
import { modelExclusion, parseOpenRouterModels, type ModelRequirements } from "./registry.ts";
import { IntelligenceStore } from "./store.server.ts";
import { CompatibleProvider, InferenceError, retryDelay } from "./transport.server.ts";

/** Queue is bounded and abortable; every admitted request rechecks Host consent after waiting. */
export class AdmissionQueue {
  active = 0;
  private waiting: { resolve: () => void; reject: (e: Error) => void; signal: AbortSignal; stop: () => void }[] = [];
  async enter(limit: () => number, signal: AbortSignal): Promise<() => void> {
    signal.throwIfAborted();
    while (this.active >= limit()) {
      if (this.waiting.length >= 32) throw new Error("Provider queue full.");
      await new Promise<void>((resolve, reject) => {
        const entry = { resolve, reject, signal, stop: () => { this.waiting = this.waiting.filter(e => e !== entry); reject(new Error("Cancelled while waiting.")); } };
        signal.addEventListener("abort", entry.stop, { once: true }); this.waiting.push(entry);
      });
      signal.throwIfAborted();
    }
    this.active++;
    let released = false;
    return () => {
      if (released) return; released = true; this.active--;
      const entry = this.waiting.shift();
      if (entry) { entry.signal.removeEventListener("abort", entry.stop); entry.resolve(); }
    };
  }
}

/** Existing Host adapter/session contract; no tool interpreter, scheduler, UI or memory reader. */
export class OpenRouterAdapter implements ProviderAdapter {
  id = "openrouter" as const;
  store: IntelligenceStore; transport: CompatibleProvider; queue = new AdmissionQueue();
  private authenticated: () => boolean;
  constructor(store: IntelligenceStore, key: () => Promise<string | null>, authenticated: () => boolean, fetcher?: typeof fetch) {
    this.store = store; this.authenticated = authenticated;
    this.transport = new CompatibleProvider("https://openrouter.ai/api/v1", key, fetcher);
  }
  capabilities() { return FEATURES.openrouter; }
  async discover() { const models = parseOpenRouterModels(await this.transport.listModels()); this.store.replaceModels(models); return models.length; }
  async health() { return this.detect(); }
  async detect(): Promise<ProviderLive> {
    const c = this.store.configuration(); const models = this.store.models().filter(m => m.enabled);
    const ready = c.enabled && models.length > 0 && this.authenticated();
    return { ...providerBase(this.id), installed: true, authenticated: this.authenticated(), authenticatedState: this.authenticated() ? "authenticated" : "not_authenticated",
      availability: Date.now() < this.store.cooldownUntil() ? "rate_limited" : ready ? "ready" : "unavailable",
      current_model: models[0]?.id ?? null, models: models.map(m => m.id), capabilities: ["text"], active_jobs: this.queue.active,
      detail: ready ? "Configured inference; catalogue/auth metadata checked. Inference connectivity untested until a task runs." : "Enable approved models and account consent on the Host before inference.",
      probedAt: Date.now(), usage_note: "Bunny request/token reservations; upstream free quotas may be lower.",
    };
  }
  modelRecords(): ModelCapabilityRecord[] {
    return this.store.models().filter(m => m.enabled).map(m => ({ provider: this.id, model: m.id, contextWindow: m.contextTokens,
      toolCalling: false, vision: false, embedding: false, isDefault: false, local: false,
      structuredOutput: m.structured, outputTokens: m.maxOutputTokens, languages: m.languages,
      source: "OpenRouter public model catalogue (provider-reported, not measured)", probedAt: Date.parse(m.verifiedAt!), evidence: m.sources }));
  }
  exclusion(model: string, r: ModelRequirements, maximumUsd?: number): string | null {
    const m = this.store.models().find(m => m.id === model);
    if (!m) return "Model unavailable or not discovered.";
    const reason = modelExclusion(m, r); if (reason) return reason;
    const c = this.store.configuration();
    if (!["rate-limited-free", "paid"].includes(m.tier)) return "Unverified pricing/tier; dispatch denied.";
    if (m.tier === "paid" && (!c.allowPaid || c.maxUsdPerRequest <= 0 || c.maxUsdPerDay <= 0)) return "Paid inference disabled or no finite budget.";
    const cost = r.contextTokens * m.inputUsdPerToken! + r.outputTokens * m.outputUsdPerToken!;
    if (cost > c.maxUsdPerRequest || maximumUsd !== undefined && cost > maximumUsd) return "Task/request monetary budget exceeded.";
    return null;
  }
  launch(task: OrchTask, hooks: AdapterHooks): RunningSession {
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(Math.max(1, Math.min(task.maxRuntimeMs ?? 60000, 300000)))]);
    const done = (async () => {
      let release: (() => void) | undefined; let dispatched = false;
      try {
        release = await this.queue.enter(() => this.store.configuration().maxConcurrent, signal);
        signal.throwIfAborted();
        const c = this.store.configuration();
        if (task.inferencePolicy !== this.store.fingerprint()) throw new Error("Inference policy changed; approve the task again.");
        // UTF-8 byte count is deliberately a conservative upper bound; no tokenizer dependency or undercounted ASCII estimate.
        const contextTokens = Math.max(task.constraints?.contextTokens ?? 0, new TextEncoder().encode(task.prompt).length + 256);
        const outputTokens = task.constraints?.outputTokens ?? c.maxOutputTokens;
        const reason = this.exclusion(task.model, { contextTokens, outputTokens, structured: !!task.constraints?.responseFormat,
          tools: !!(task.constraints?.requiresFilesystem || task.constraints?.requiresTerminal || task.constraints?.requiresGit),
          input: ["text"], language: task.constraints?.language ?? null,
          sensitive: !!(task.constraints?.sensitive || task.constraints?.privacyLocal || task.constraints?.localOnly || task.constraints?.offlineOnly) }, task.constraints?.maxCostUsd);
        if (reason) throw new Error(reason);
        const m = this.store.models().find(m => m.id === task.model)!;
        if (outputTokens > c.maxOutputTokens) throw new Error("Output budget exceeded.");
        const usd = contextTokens * m.inputUsdPerToken! + outputTokens * m.outputUsdPerToken!;
        await hooks.beforeDispatch?.();
        signal.throwIfAborted();
        const reservation = this.store.reserve(task.model, contextTokens + outputTokens, usd);
        dispatched = true;
        hooks.event("agent.working", "Approved tool-free OpenRouter inference.");
        const result = await this.transport.generate({ requestId: task.id, model: task.model, prompt: task.prompt, maxTokens: outputTokens,
          timeoutMs: task.maxRuntimeMs ?? 60000, signal, structured: !!task.constraints?.responseFormat,
          providerOptions: { only: c.upstreams, allow_fallbacks: false, require_parameters: true, data_collection: "deny",
            max_price: { prompt: m.inputUsdPerToken! * 1_000_000, completion: m.outputUsdPerToken! * 1_000_000 } } });
        signal.throwIfAborted();
        this.store.recordUsage(reservation, result.inputTokens, result.outputTokens);
        this.store.recordFailure(true);
        if (result.inputTokens !== null && result.outputTokens !== null) hooks.usage?.({ inputTokens: result.inputTokens, outputTokens: result.outputTokens, cachedInputTokens: 0, source: "OpenRouter provider-reported; no estimated usage substituted" });
        hooks.output(result.text); hooks.event("agent.completed", "Model output validated; Host task verification still applies.");
        return { ok: true, output: result.text };
      } catch (e) {
        if (controller.signal.aborted) return { ok: false, stopped: true, output: "", error: "Cancelled.", ...(!dispatched ? { dispatched: false as const } : {}) };
        if (e instanceof InferenceError && [429, 402, 503, 408].includes(e.status)) {
          // Persist cooldown; MA3 owns the one bounded retry/fallback loop. Never sleep then multiply retries here.
          this.store.cooldown(Date.now() + retryDelay(this.store.failureStreak(), e.status === 402 ? 24 * 60 * 60_000 : e.retryAfterMs));
          this.store.recordFailure();
          hooks.event(e.status === 429 ? "provider.rate_limited" : "provider.failed", e.message);
        }
        return { ok: false, output: "", error: signal.aborted ? "Provider timeout." : e instanceof InferenceError ? e.message : "Provider preflight or output validation failed; no successful result.", ...(!dispatched ? { dispatched: false as const } : {}) };
      } finally { release?.(); }
    })();
    return { done, stop: async () => { controller.abort(); this.transport.cancel(task.id); await done; }, pid: () => null };
  }
}
