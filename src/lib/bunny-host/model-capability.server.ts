/**
 * M-A-3 T1: normalized per-model capability records.
 *
 * Facts come only from real probes. Anything the probes did not return stays
 * UNKNOWN (an absent row or a null field) and is never guessed: the same
 * "never invent availability" discipline the ProviderRegistry enforces.
 *
 * The registry owns its own table in its constructor — the exact pattern the
 * ProviderRegistry uses for the `providers` table. Rows are additive and
 * idempotent (no user_version change; the installed-state marker self-heals
 * at boot via refreshStateMarker). Usage stays provider-level (UsageWindow);
 * no per-model usage exists in any real probe, so none is invented here.
 */
import { probeOllama } from "../orch/exec.server.ts";
import type { ProviderId } from "../orch/types.ts";
import { probeCodexCatalog } from "./codex-probe.server.ts";
import { locate, systemContext, type Launchable } from "./discovery.server.ts";
import type { HostDatabase } from "./persistence.server.ts";

/** Probe source for tags as used by OllamaAdapter (same shape, injected for tests). */
export type OllamaTags = { up: boolean; models: string[]; remote?: string[] };
/** What `POST /api/show` returns for a model. Every capability field may be absent. */
export type OllamaShowRecord = { name?: string; family?: string; parameter_size?: string; capabilities?: string[]; context_length?: number };
/** What `GET /api/ps` returns: the models currently held in memory. */
export type OllamaPsRecord = { models?: { name?: string; context_length?: number; size_vram?: number }[] };
export type CodexCatalogLike = { model: string | null; models: string[]; limited: boolean; usageRead: boolean };

/** One normalized model fact set. Null/absent capability fields are UNKNOWN — never defaulted. */
export type ModelCapabilityRecord = {
  provider: ProviderId;
  /** The model tag/catalog id exactly as the provider reported it. */
  model: string;
  /** Tokens; null = UNKNOWN. Probed only through Ollama /api/show so far. */
  contextWindow?: number | null;
  /** null = UNKNOWN (probe returned no capability list). Probed through Ollama /api/show so far. */
  toolCalling?: boolean | null;
  vision?: boolean | null;
  embedding?: boolean | null;
  /** Ollama /api/ps this probe: the model is currently loaded in memory. null = UNKNOWN. */
  loaded?: boolean | null;
  /** Catalogue-preferred model, as reported by the Codex app-server model/list probe. null = UNKNOWN. */
  isDefault?: boolean | null;
  /** Deterministic, derived from probed data: Ollama local-service tags are local; Ollama cloud tags and every hosted-CLI catalogue model are not. */
  local: boolean;
  /** What actually produced these facts, e.g. "ollama /api/tags + /api/show + /api/ps" or "codex app-server model/list". */
  source: string;
  probedAt: number;
  evidence: string[];
};

export type ModelCapabilityProviderSnapshot = {
  provider: ProviderId;
  /** True once this Host instance ran model discovery for this provider on its own. Persisted rows never satisfy this. */
  probedThisRun: boolean;
  /** Newest record time, or null when nothing is known for this provider. */
  probedAt: number | null;
  models: ModelCapabilityRecord[];
};
export type ModelCapabilitySnapshot = { version: 1; providers: ModelCapabilityProviderSnapshot[] };

/** Providers whose real probe contracts can list models today. Claude Code reports its model only inside sessions; the detect-only providers (OpenCode/Cline/Cursor) are never routed. Absence of rows for those is UNKNOWN, not evidence of emptiness. */
const MODEL_SOURCE_PROVIDERS: ProviderId[] = ["ollama", "codex"];
/** The known provider set, in registry display order. */
export const MODEL_CAPABILITY_PROVIDERS: ProviderId[] = ["ollama", "codex", "claude", "opencode", "cline", "cursor"];

const display = (id: ProviderId): string => (id === "codex" ? "Codex" : id === "claude" ? "Claude Code" : id === "ollama" ? "Ollama" : id === "opencode" ? "OpenCode" : id === "cline" ? "Cline" : "Cursor Agent");

/** Real HTTP probes, in the exact failure discipline of probeOllama: a miss is null, never a guess. */
async function ollamaShowViaHttp(model: string): Promise<OllamaShowRecord | null> {
  try {
    const response = await fetch("http://127.0.0.1:11434/api/show", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model }), signal: AbortSignal.timeout(8000) });
    if (!response.ok) return null;
    return (await response.json()) as OllamaShowRecord;
  } catch { return null; }
}
async function ollamaPsViaHttp(): Promise<OllamaPsRecord | null> {
  try {
    const response = await fetch("http://127.0.0.1:11434/api/ps", { signal: AbortSignal.timeout(2000) });
    if (!response.ok) return null;
    return (await response.json()) as OllamaPsRecord;
  } catch { return null; }
}

export type ModelCapabilityOptions = {
  /** Min age before a provider's model listing is re-probed. Model catalogues change rarely. */
  intervalMs?: number;
  /** User-configured provider executable paths (settings key provider_paths). */
  providerPaths?: () => Partial<Record<ProviderId, string>>;
  /** Providers this Host actually manages (its adapter set). Model discovery probes only those. Defaults to the full set for standalone use. */
  availableProviders?: () => ProviderId[];
  /** Test seams only; defaults are the real probe implementations. */
  ollamaProbe?: () => Promise<OllamaTags>;
  ollamaShow?: (model: string) => Promise<OllamaShowRecord | null>;
  ollamaPs?: () => Promise<OllamaPsRecord | null>;
  codexLaunch?: () => Launchable | null;
  codexCatalog?: (command: string, prefix?: string[]) => Promise<CodexCatalogLike>;
  now?: () => number;
};
const DEFAULT_INTERVAL_MS = 30 * 60_000;

/** Fields whose change is a real model fact change. Timestamps and evidence text are not. */
function recordSignature(record: ModelCapabilityRecord): string {
  return JSON.stringify([record.model, record.local, record.toolCalling ?? null, record.vision ?? null, record.embedding ?? null, record.contextWindow ?? null, record.loaded ?? null, record.isDefault ?? null]);
}

/**
 * Host-owned per-model capability state. UIs read it from snapshots and never infer
 * model facts themselves. Rows persist so a Host restart neither forgets them nor
 * silently trusts them: probedThisRun stays false until this instance probes.
 */
export class ModelCapabilityRegistry {
  private readonly db: HostDatabase;
  private readonly intervalMs: number;
  private readonly opts: Required<Pick<ModelCapabilityOptions, "ollamaProbe" | "ollamaShow" | "ollamaPs" | "codexLaunch" | "codexCatalog" | "now" | "availableProviders">> & Pick<ModelCapabilityOptions, "providerPaths">;
  private readonly records = new Map<ProviderId, Map<string, ModelCapabilityRecord>>();
  private readonly probeAt = new Map<ProviderId, number>();
  private readonly signatures = new Map<ProviderId, string>();
  private refreshing: Promise<string[]> | null = null;

  constructor(db: HostDatabase, options: ModelCapabilityOptions = {}) {
    this.db = db;
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.opts = {
      providerPaths: options.providerPaths,
      availableProviders: options.availableProviders ?? (() => MODEL_CAPABILITY_PROVIDERS),
      ollamaProbe: options.ollamaProbe ?? probeOllama,
      ollamaShow: options.ollamaShow ?? ollamaShowViaHttp,
      ollamaPs: options.ollamaPs ?? ollamaPsViaHttp,
      codexLaunch: options.codexLaunch ?? (() => {
        try { return locate(systemContext(options.providerPaths?.() ?? {}), "codex").launch ?? null; } catch { return null; }
      }),
      codexCatalog: options.codexCatalog ?? (probeCodexCatalog as unknown as (command: string, prefix?: string[]) => Promise<CodexCatalogLike>),
      now: options.now ?? (() => Date.now()),
    };
    // Additive table, created by its owner like the providers table. Idempotent;
    // never touches PRAGMA user_version; the installed-state marker reconciles at boot.
    this.db.db.exec("CREATE TABLE IF NOT EXISTS model_capabilities(provider TEXT NOT NULL, model TEXT NOT NULL, probed_at INTEGER, record TEXT NOT NULL, PRIMARY KEY(provider, model))");
    this.db.db.exec("CREATE INDEX IF NOT EXISTS idx_model_capabilities_provider ON model_capabilities(provider)");
    type Row = { provider: string; model: string; record: string };
    for (const row of this.db.db.prepare("SELECT provider, model, record FROM model_capabilities").all() as Row[]) {
      try {
        const parsed = JSON.parse(row.record) as ModelCapabilityRecord;
        if (!MODEL_CAPABILITY_PROVIDERS.includes(parsed.provider) || typeof parsed.model !== "string" || parsed.model !== row.model) continue; // Corrupt rows are re-probed.
        if (!this.records.has(parsed.provider)) this.records.set(parsed.provider, new Map());
        this.records.get(parsed.provider)!.set(parsed.model, parsed);
      } catch { /* Corrupt rows are re-probed. */ }
    }
  }

  /** Known records, all ids or one provider. Rows are facts with their own probedAt age. */
  list(provider?: ProviderId): ModelCapabilityRecord[] {
    const ids = provider ? [provider] : MODEL_CAPABILITY_PROVIDERS;
    return ids.flatMap((id) => [...(this.records.get(id)?.values() ?? [])]).sort((a, b) => a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model));
  }
  get(provider: ProviderId, model: string): ModelCapabilityRecord | undefined {return this.records.get(provider)?.get(model);}
  probedThisRun(provider: ProviderId): boolean {return this.probeAt.has(provider);}

  /** Single-flight, like ProviderRegistry.refresh. Returns human-readable material change descriptions. */
  refresh(options: { force?: boolean } = {}): Promise<string[]> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.run(options).finally(() => { this.refreshing = null; });
    return this.refreshing;
  }

  private async run({ force = false }: { force?: boolean }): Promise<string[]> {
    const now = this.opts.now();
    const results = await Promise.all(MODEL_CAPABILITY_PROVIDERS.map((id) => this.discover(id, force, now)));
    return results.flat();
  }

  private async discover(id: ProviderId, force: boolean, now: number): Promise<string[]> {
    // Only providers with a real model-listing probe AND present in this Host's adapter set are probed.
    if (!MODEL_SOURCE_PROVIDERS.includes(id) || !this.opts.availableProviders().includes(id)) return [];
    const due = force || !this.probeAt.has(id) || now - (this.probeAt.get(id) ?? 0) >= this.intervalMs;
    if (!due) return [];
    const records = id === "ollama" ? await this.probeOllamaModels(now) : await this.probeCodexModels(now);
    this.probeAt.set(id, now);
    if (records === null) return []; // The probe produced no facts (service down, CLI missing, catalogue unreadable): say nothing; persisted rows keep their original probed age.
    this.persist(id, records);
    return this.describe(id, records);
  }

  /** Ollama: tags first; a downed service yields no fresh facts and no rows (persisted ones keep their original age). */
  private async probeOllamaModels(now: number): Promise<ModelCapabilityRecord[] | null> {
    const tags = await this.opts.ollamaProbe();
    if (!tags.up || !tags.models.length) return null;
    const ps = await this.opts.ollamaPs();
    const loaded = new Set((ps?.models ?? []).map((entry) => entry.name).filter((name): name is string => typeof name === "string"));
    const psRead = Array.isArray(ps?.models);
    const remote = new Set(tags.remote ?? []);
    const evidence: string[] = [`GET http://127.0.0.1:11434/api/tags → ${tags.models.length} models, cloud-hosted: ${(tags.remote ?? []).join(", ") || "none"}`];
    if (psRead) evidence.push(`GET http://127.0.0.1:11434/api/ps → loaded: ${(ps?.models ?? []).map((entry) => entry.name ?? "?").join(", ") || "none"}`);
    const records: ModelCapabilityRecord[] = [];
    for (const tag of tags.models) {
      const show = await this.opts.ollamaShow(tag);
      const capabilities = Array.isArray(show?.capabilities) ? show?.capabilities : null; // Older servers omit it: UNKNOWN, not a negative.
      records.push({
        provider: "ollama",
        model: tag,
        local: !remote.has(tag),
        toolCalling: capabilities === null ? null : capabilities.includes("tools"), vision: capabilities === null ? null : capabilities.includes("vision"), embedding: capabilities === null ? null : capabilities.includes("embedding"),
        contextWindow: typeof show?.context_length === "number" && Number.isFinite(show.context_length) ? show.context_length : null,
        loaded: psRead ? loaded.has(tag) : null,
        isDefault: null,
        source: ["ollama /api/tags", show ? "ollama /api/show" : null, ...(psRead ? ["ollama /api/ps"] : [])].filter(Boolean).join(" + "),
        probedAt: now,
        evidence: [...evidence, show ? `POST /api/show ${tag} → ${capabilities ? `capabilities: ${capabilities.join("; ")}` : "no capability list"}${typeof show?.context_length === "number" ? `; context ${show.context_length}` : ""}` : `POST /api/show ${tag} → no metadata`],
      });
    }
    return records;
  }

  /** Codex: the installed CLI's own app-server catalogue. Nothing beyond it is invented. */
  private async probeCodexModels(now: number): Promise<ModelCapabilityRecord[] | null> {
    const launch = this.opts.codexLaunch();
    if (!launch) return null;
    const catalog = await this.opts.codexCatalog(launch.command, launch.args).catch(() => null);
    if (!catalog || !catalog.models.length) return null;
    const preferred = catalog.model;
    return catalog.models.map((model) => ({
      provider: "codex" as const,
      model,
      local: false,
      toolCalling: null,
      vision: null,
      embedding: null,
      contextWindow: null,
      loaded: null,
      isDefault: preferred === model ? true : null, // The catalogue's preferred pick; other entries stay UNKNOWN as provider-marked defaults.
      source: "codex app-server model/list",
      probedAt: now,
      evidence: [`codex app-server model/list (includeHidden:false) → ${catalog.models.length} models, preferred: ${preferred ?? "none"}`],
    }));
  }

  /** Upsert only. Models that disappear from a probe stay with their last probed facts; nothing is deleted and nothing is rewritten without a probe. */
  private persist(id: ProviderId, records: ModelCapabilityRecord[]) {
    if (!this.records.has(id)) this.records.set(id, new Map());
    for (const record of records) {this.records.get(id)!.set(record.model, record);}
    const upsert = this.db.db.prepare("INSERT INTO model_capabilities(provider,model,probed_at,record) VALUES(?,?,?,?) ON CONFLICT(provider,model) DO UPDATE SET probed_at=excluded.probed_at, record=excluded.record");
    for (const record of records) upsert.run(record.provider, record.model, record.probedAt, JSON.stringify(record));
  }

  /** Material-change strings in the describeChange spirit: additions, removals, changed facts; identical facts change nothing. */
  private describe(id: ProviderId, current: ModelCapabilityRecord[]): string[] {
    const signature = JSON.stringify(current.map(recordSignature).sort());
    const before = this.signatures.get(id);
    this.signatures.set(id, signature);
    if (before === undefined) return current.length ? [`${display(id)}: ${current.length} model${current.length === 1 ? "" : "s"} discovered`] : [];
    if (before === signature) return [];
    const had = this.baselineFacts(id, before);
    const added: string[] = [];
    const removed: string[] = [];
    const changed: string[] = [];
    const nowFacts = new Map(current.map((record) => [record.model, record]));
    const wasFacts = new Map(had.map((record) => [record.model, record]));
    for (const [model] of nowFacts) if (!wasFacts.has(model)) added.push(model);
    for (const [model] of wasFacts) if (!nowFacts.has(model)) removed.push(model);
    for (const [model, after] of nowFacts) {
      const was = wasFacts.get(model);
      if (!was) continue;
      const diffs = (["contextWindow", "toolCalling", "vision", "embedding", "loaded", "isDefault"] as const).map((field) => {
        const a = was[field] ?? null; const b = after[field] ?? null;
        return a === b ? null : `${field.replace(/[A-Z]/g, (c) => ` ${c.toLowerCase()}`)} ${JSON.stringify(a)}→${JSON.stringify(b)}`;
      }).filter(Boolean);
      if (diffs.length) changed.push(`${model} (${diffs.join("; ")})`);
      if (was.local !== after.local) changed.push(model);
    }
    const name = display(id);
    const parts: string[] = [];
    if (added.length) parts.push(`${added.length} model${added.length === 1 ? "" : "s"} added: ${added.join(", ")}`);
    if (removed.length) parts.push(`${removed.length} model${removed.length === 1 ? "" : "s"} no longer listed: ${removed.join(", ")}`);
    if (changed.length) parts.push(`capability facts changed: ${changed.join(", ")}`);
    return parts.length ? [`${name}: ${parts.join("; ")}`] : [];
  }
  /** Parse the previous signature back into its per-model facts (the signature already excludes timestamps/evidence). */
  private baselineFacts(id: ProviderId, signature: string): ModelCapabilityRecord[] {
    try {
      const rows = JSON.parse(signature) as string[];
      return rows.map((row) => {
        const [model, local, toolCalling, vision, embedding, contextWindow, loaded, isDefault] = JSON.parse(row) as (string | number | boolean | null)[];
        return { provider: id, model: model as string, local: local as boolean, toolCalling: toolCalling as boolean | null, vision: vision as boolean | null, embedding: embedding as boolean | null, contextWindow: contextWindow as number | null, loaded: loaded as boolean | null, isDefault: isDefault as boolean | null, source: "previous facts", probedAt: 0, evidence: [] } satisfies ModelCapabilityRecord;
      });
    } catch { return []; }
  }

  snapshot(): ModelCapabilitySnapshot {
    return {
      version: 1,
      providers: MODEL_CAPABILITY_PROVIDERS.map((provider) => {
        const models = [...(this.records.get(provider)?.values() ?? [])];
        return { provider, probedThisRun: this.probeAt.has(provider), probedAt: models.length ? Math.max(...models.map((r) => r.probedAt)) : null, models };
      }),
    };
  }
}