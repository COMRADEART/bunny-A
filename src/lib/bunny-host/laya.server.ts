/**
 * M-A-3 T13.1: Laya as a flexible local model resource.
 *
 * Laya has no discovery path of its own: it is whatever Laya-named model the
 * existing ModelCapabilityRegistry reports from the local runtime (Ollama
 * today). Capabilities are the registry's probed facts; anything unprobed stays
 * unknown. A model may route only for task classes it passed a deterministic
 * local benchmark on. No runtime or no Laya tag => a truthful Missing/Offline.
 */
import type { HostDatabase } from "./persistence.server.ts";
import type { ModelCapabilityRecord, ModelCapabilitySnapshot } from "./model-capability.server.ts";
import { isLayaModel, layaCapabilityMatrix, LAYA_BENCHMARK_COVERS, type LayaBenchmark } from "./intelligence.ts";

export type LayaStatus = "installed" | "missing" | "offline" | "unavailable";
export type LayaModelView = {
  model: string;
  runtime: string;
  local: boolean;
  capabilities: { capability: string; demonstrated: boolean | null }[];
  contextWindow: number | null;
  memoryRequirement: string | null;
  benchmarks: LayaBenchmark[];
  /** Routing task classes covered by a passed benchmark; empty means never auto-routed. */
  eligibleTaskClasses: string[];
  routingEligible: boolean;
};
export type LayaSnapshot = { status: LayaStatus; enabled: boolean; models: LayaModelView[]; probedAt: number | null; detail: string; apiKeyRequired: false; benchmarking: string | null };

export type LayaRuntime = {
  generate: (model: string, prompt: string, signal: AbortSignal) => Promise<{ ok: boolean; output: string }>;
  loadedBytes: (model: string) => Promise<number | null>;
  /** Installed model name → content digest, or null when the runtime cannot be read. */
  digests: () => Promise<Map<string, string> | null>;
};

async function ollamaGenerate(model: string, prompt: string, signal: AbortSignal) {
  try {
    const response = await fetch("http://127.0.0.1:11434/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, prompt, stream: false, options: { temperature: 0 } }),
      signal,
    });
    if (!response.ok) return { ok: false, output: "" };
    const body = (await response.json()) as { response?: unknown };
    return { ok: true, output: typeof body.response === "string" ? body.response.slice(0, 4000) : "" };
  } catch {
    return { ok: false, output: "" };
  }
}
async function ollamaLoadedBytes(model: string) {
  try {
    const response = await fetch("http://127.0.0.1:11434/api/ps", { signal: AbortSignal.timeout(2000) });
    if (!response.ok) return null;
    const body = (await response.json()) as { models?: { name?: string; size_vram?: number; size?: number }[] };
    const row = body.models?.find((entry) => entry.name === model);
    return typeof row?.size_vram === "number" && row.size_vram > 0 ? row.size_vram : typeof row?.size === "number" ? row.size : null;
  } catch {
    return null;
  }
}
async function ollamaDigests() {
  try {
    const response = await fetch("http://127.0.0.1:11434/api/tags", { signal: AbortSignal.timeout(3000) });
    if (!response.ok) return null;
    const body = (await response.json()) as { models?: { name?: unknown; digest?: unknown }[] };
    const digests = new Map<string, string>();
    for (const row of body.models ?? []) if (typeof row.name === "string" && typeof row.digest === "string" && row.digest) digests.set(row.name, row.digest);
    return digests;
  } catch {
    return null;
  }
}
export const OLLAMA_LAYA_RUNTIME: LayaRuntime = { generate: ollamaGenerate, loadedBytes: ollamaLoadedBytes, digests: ollamaDigests };

/**
 * Deterministic checks: the model's own output is compared, never trusted as proof of other work. A task class
 * passes only when every one of its checks passes.
 */
export const LAYA_BENCHMARKS: { taskClass: keyof typeof LAYA_BENCHMARK_COVERS; prompt: string; expect: RegExp }[] = [
  { taskClass: "general", prompt: "Reply with exactly this text and nothing else: BUNNY-LAYA-OK", expect: /^\W*BUNNY-LAYA-OK\W*$/ },
  { taskClass: "general", prompt: "Reply with only the single word READY in capital letters.", expect: /^\W*READY\W*$/ },
  { taskClass: "math", prompt: "What is 17 multiplied by 3, plus 9? Reply with only the number.", expect: /^\D*60\D*$/ },
  { taskClass: "math", prompt: "What is 144 divided by 12, minus 5? Reply with only the number.", expect: /^\D*7\D*$/ },
  { taskClass: "extraction", prompt: "From the text 'Invoice 4471 was paid on 2026-03-14 by Ana.' reply with only the invoice number.", expect: /^\D*4471\D*$/ },
  { taskClass: "extraction", prompt: "From the text 'Order A-2291 ships to Lisbon on 4 May.' reply with only the destination city.", expect: /^\W*lisbon\W*$/i },
  { taskClass: "reasoning", prompt: "Mira is older than Jun. Jun is older than Ola. Who is the youngest? Reply with only the name.", expect: /^\W*ola\W*$/i },
  { taskClass: "reasoning", prompt: "A box is heavier than a ball. The ball is heavier than a pen. Which is the lightest? Reply with only that one word.", expect: /^\W*(?:the\s+)?pen\W*$/i },
];

const ENABLED_KEY = "laya_enabled_v1";
const MEMORY_KEY = "laya_memory_v1";

export class LayaRegistry {
  private readonly db: HostDatabase;
  private readonly runtime: LayaRuntime;
  private benchmarking: string | null = null;
  /** Digests the local runtime last reported. A benchmark counts only for the exact build it measured. */
  private installed = new Map<string, string>();
  enabled = true;

  constructor(db: HostDatabase, runtime: LayaRuntime = OLLAMA_LAYA_RUNTIME) {
    this.db = db;
    this.runtime = runtime;
    this.db.db.exec("CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL)");
    this.db.db.exec("CREATE TABLE IF NOT EXISTS laya_benchmarks(model TEXT NOT NULL, task_class TEXT NOT NULL, passed INTEGER NOT NULL, detail TEXT NOT NULL, latency_ms INTEGER, at INTEGER NOT NULL, digest TEXT, PRIMARY KEY(model, task_class))");
    const columns = this.db.db.prepare("PRAGMA table_info(laya_benchmarks)").all() as { name: string }[];
    if (!columns.some((column) => column.name === "digest")) this.db.db.exec("ALTER TABLE laya_benchmarks ADD COLUMN digest TEXT");
    const row = this.db.db.prepare("SELECT value FROM settings WHERE key=?").get(ENABLED_KEY) as { value: string } | undefined;
    if (row) this.enabled = row.value !== "false";
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    this.db.db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(ENABLED_KEY, String(enabled));
  }

  /** Reads installed digests from the local runtime (no model is loaded). An unreadable runtime keeps the last view. */
  async refreshDigests(): Promise<void> {
    const digests = await this.runtime.digests();
    if (digests) this.installed = digests;
  }

  /** Benchmarks for the build currently installed under each name; results for a replaced build no longer count. */
  benchmarks(model?: string): LayaBenchmark[] {
    const rows = (model
      ? this.db.db.prepare("SELECT model, task_class AS taskClass, passed, detail, latency_ms AS latencyMs, at, digest FROM laya_benchmarks WHERE model=? ORDER BY task_class").all(model)
      : this.db.db.prepare("SELECT model, task_class AS taskClass, passed, detail, latency_ms AS latencyMs, at, digest FROM laya_benchmarks ORDER BY model, task_class").all()) as { model: string; taskClass: string; passed: number; detail: string; latencyMs: number | null; at: number; digest: string | null }[];
    return rows
      .filter((row) => row.digest !== null && row.digest === this.installed.get(row.model))
      .map((row) => ({ model: row.model, taskClass: row.taskClass, passed: !!row.passed, detail: row.detail, latencyMs: row.latencyMs, at: row.at }));
  }

  private memory(): Record<string, number> {
    const row = this.db.db.prepare("SELECT value FROM settings WHERE key=?").get(MEMORY_KEY) as { value: string } | undefined;
    try {
      const parsed = JSON.parse(row?.value ?? "{}") as Record<string, unknown>;
      return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, number] => typeof entry[1] === "number"));
    } catch {
      return {};
    }
  }

  /** Laya-named records from the existing registry snapshot. Pure projection; makes no call. */
  static layaRecords(snapshot: ModelCapabilitySnapshot): ModelCapabilityRecord[] {
    return snapshot.providers.flatMap((provider) => provider.models).filter((record) => isLayaModel(record.model));
  }

  /** Truthful projection over the capability snapshot and the local runtime's availability. */
  snapshot(capabilities: ModelCapabilitySnapshot, runtimeUp: boolean): LayaSnapshot {
    const ollama = capabilities.providers.find((provider) => provider.provider === "ollama");
    const records = LayaRegistry.layaRecords(capabilities);
    const memory = this.memory();
    const models: LayaModelView[] = records.map((record) => {
      const benchmarks = this.benchmarks(record.model);
      const eligibleTaskClasses = [...new Set(benchmarks.filter((row) => row.passed).flatMap((row) => [...(LAYA_BENCHMARK_COVERS[row.taskClass] ?? [])]))];
      return {
        model: record.model,
        runtime: record.provider === "ollama" ? "Ollama (local runtime)" : record.provider,
        local: record.local,
        capabilities: layaCapabilityMatrix(record),
        contextWindow: record.contextWindow ?? null,
        memoryRequirement: benchmarks.length && typeof memory[record.model] === "number" ? `${(memory[record.model] / 1024 ** 3).toFixed(1)} GB while loaded (measured)` : null,
        benchmarks,
        eligibleTaskClasses,
        routingEligible: this.enabled && record.local && runtimeUp && eligibleTaskClasses.length > 0,
      };
    });
    const status: LayaStatus = !runtimeUp ? "offline" : !records.length ? "missing" : models.some((model) => model.local) ? "installed" : "unavailable";
    const detail =
      status === "offline" ? "The local model runtime is offline, so Laya's availability is unknown."
      : status === "missing" ? "No Laya model is installed in the local runtime. Bunny keeps routing with the other models."
      : status === "unavailable" ? "A Laya model is listed but only as a hosted tag; it is not a local resource."
      : `${models.length} Laya model(s) found in the local runtime.`;
    return { status, enabled: this.enabled, models, probedAt: ollama?.probedAt ?? null, detail, apiKeyRequired: false, benchmarking: this.benchmarking };
  }

  /**
   * User-initiated local benchmark of one discovered Laya model. Nothing leaves this computer.
   * Refusals (not installed, not local, already running) throw before this returns; the run itself is the promise.
   */
  startBenchmark(model: string, capabilities: ModelCapabilitySnapshot): Promise<LayaBenchmark[]> {
    const record = LayaRegistry.layaRecords(capabilities).find((row) => row.model === model);
    if (!record) throw new Error("That Laya model is not installed in the local runtime.");
    if (!record.local) throw new Error("Only a local Laya model can be benchmarked.");
    if (this.benchmarking) throw new Error("A Laya benchmark is already running.");
    this.benchmarking = model;
    return this.run(model);
  }

  private async run(model: string): Promise<LayaBenchmark[]> {
    try {
      await this.refreshDigests();
      const digest = this.installed.get(model);
      if (!digest) throw new Error("The local runtime did not report this model's digest; the benchmark was not run.");
      const classes = [...new Set(LAYA_BENCHMARKS.map((task) => task.taskClass))];
      for (const taskClass of classes) {
        const checks = LAYA_BENCHMARKS.filter((task) => task.taskClass === taskClass);
        let matched = 0;
        let silent = false;
        let totalMs = 0;
        for (const task of checks) {
          const started = performance.now();
          const result = await this.runtime.generate(model, task.prompt, AbortSignal.timeout(120_000));
          totalMs += performance.now() - started;
          if (!result.ok) silent = true;
          else if (task.expect.test(result.output.trim())) matched++;
        }
        const passed = matched === checks.length;
        const detail = silent ? "The local runtime did not answer every check." : `${matched} of ${checks.length} checks matched the expected answer.`;
        this.record(model, digest, taskClass, passed, detail, Math.round(totalMs / checks.length));
      }
      const bytes = await this.runtime.loadedBytes(model);
      if (bytes !== null) {
        const memory = { ...this.memory(), [model]: bytes };
        this.db.db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(MEMORY_KEY, JSON.stringify(memory));
      }
      return this.benchmarks(model);
    } finally {
      this.benchmarking = null;
    }
  }

  private record(model: string, digest: string, taskClass: string, passed: boolean, detail: string, latencyMs: number) {
    this.db.db
      .prepare("INSERT INTO laya_benchmarks(model,task_class,passed,detail,latency_ms,at,digest) VALUES(?,?,?,?,?,?,?) ON CONFLICT(model,task_class) DO UPDATE SET passed=excluded.passed, detail=excluded.detail, latency_ms=excluded.latency_ms, at=excluded.at, digest=excluded.digest")
      .run(model, taskClass, passed ? 1 : 0, detail.slice(0, 300), latencyMs, Date.now(), digest);
  }
}
