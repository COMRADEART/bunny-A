export type GpuTelemetry = {
  name: string;
  totalVramBytes: number;
  availableVramBytes: number;
  usedVramBytes: number;
};

export type NpuTelemetry = {
  detected: boolean;
  name: string | null;
  supportedByOllama: boolean;
  qualifiedForT4: boolean;
  detail: string;
};

export type SystemResourceTelemetry = {
  totalRamBytes: number;
  availableRamBytes: number;
  gpu: GpuTelemetry | null;
  npu: NpuTelemetry;
  timestamp: number;
};

export const REFERENCE_RTX_4050_VRAM_BYTES = 6_141 * 1024 * 1024; // ~6.14 GiB
export const VRAM_SAFETY_MARGIN_BYTES = 1_500 * 1024 * 1024; // 1.5 GiB floor for KV cache + desktop
export const MODEL_FOOTPRINT_BYTES: Record<string, number> = {
  "qwen2.5-coder:7b": 4_683_087_561, // ~4.68 GB
  "huihui_ai/qwen2.5-abliterate:7b": 4_683_087_428,
  "huihui_ai/Qwen3.8-abliterated:27b": 17_741_871_954,
  "huihui_ai/qwen3-abliterated:30b": 18_556_699_290,
};

/**
 * Checks whether two models can safely execute in parallel within dedicated VRAM.
 * Strict Invariant: On 6 GiB GPU hardware, unknown models or distinct large models
 * MUST NOT be scheduled in parallel. Safe fallback is grouped / sequential execution.
 */
export function canRunInParallel(
  modelA: string,
  modelB: string,
  vramBytes: number = REFERENCE_RTX_4050_VRAM_BYTES,
): { allowed: boolean; reason: string; fallbackMode: "grouped" | "sequential" } {
  // If Worker and Tester share the exact same model, it is resident once
  if (modelA === modelB) {
    const footprint = MODEL_FOOTPRINT_BYTES[modelA] ?? Infinity;
    if (footprint + VRAM_SAFETY_MARGIN_BYTES <= vramBytes) {
      return {
        allowed: true,
        reason: `Both roles share ${modelA}; resident once (${(footprint / 1024 ** 3).toFixed(1)} GiB fits ${ (vramBytes / 1024 ** 3).toFixed(1)} GiB VRAM).`,
        fallbackMode: "grouped",
      };
    }
  }

  const footA = MODEL_FOOTPRINT_BYTES[modelA] ?? Infinity;
  const footB = MODEL_FOOTPRINT_BYTES[modelB] ?? Infinity;

  if (!Number.isFinite(footA) || !Number.isFinite(footB)) {
    return {
      allowed: false,
      reason: `Unknown model sizes for ${modelA} or ${modelB}. Unmeasured memory never assumed to fit in VRAM.`,
      fallbackMode: "sequential",
    };
  }

  const combined = footA + footB + VRAM_SAFETY_MARGIN_BYTES;
  if (combined > vramBytes) {
    return {
      allowed: false,
      reason: `Combined footprint (${((footA + footB) / 1024 ** 3).toFixed(1)} GiB + 1.5 GiB margin) exceeds dedicated VRAM (${(vramBytes / 1024 ** 3).toFixed(1)} GiB). Grouping calls by model to prevent swap thrashing.`,
      fallbackMode: "grouped",
    };
  }

  return {
    allowed: true,
    reason: `Both models fit dedicated VRAM (${((footA + footB) / 1024 ** 3).toFixed(1)} GiB of ${(vramBytes / 1024 ** 3).toFixed(1)} GiB).`,
    fallbackMode: "grouped",
  };
}

/**
 * Reports NPU qualification status for local inference.
 */
export function reportNpuStatus(probeNpuName?: string | null): NpuTelemetry {
  const detected = Boolean(probeNpuName);
  return {
    detected,
    name: probeNpuName ?? (detected ? "Intel(R) AI Boost" : null),
    supportedByOllama: false, // Standard Ollama lacks Intel NPU runner
    qualifiedForT4: false, // Cannot be qualified without upstream GGUF NPU execution backend
    detail: detected
      ? "Intel(R) AI Boost hardware detected, but standard Ollama inference lacks NPU GGUF execution support. Safe fallback retains CUDA GPU/CPU execution path."
      : "No NPU compute accelerator detected. Retaining standard CUDA GPU/CPU inference path.",
  };
}

export type LatencyMetric = {
  model: string;
  coldMs: number | null;
  warmMs: number | null;
  lastUsedAt: number;
  callCount: number;
};

/**
 * Intelligent scheduler that tracks model residency, latency, and prevents starvation.
 */
export class ResourceAwareModelScheduler {
  private residentModel: string | null = null;
  private latencyMap = new Map<string, LatencyMetric>();
  private activeCalls = 0;
  private readonly maxConcurrent: number;
  private readonly maxVramBytes: number;

  constructor(options: { maxConcurrent?: number; maxVramBytes?: number } = {}) {
    this.maxConcurrent = options.maxConcurrent ?? 1;
    this.maxVramBytes = options.maxVramBytes ?? REFERENCE_RTX_4050_VRAM_BYTES;
  }

  getResidentModel(): string | null {
    return this.residentModel;
  }

  getLatencyMetrics(model: string): LatencyMetric | null {
    return this.latencyMap.get(model) ?? null;
  }

  recordCallDuration(model: string, durationMs: number, loadDurationMs?: number): void {
    const isCold = (loadDurationMs ?? 0) > 1000 || !this.latencyMap.has(model);
    const existing = this.latencyMap.get(model);

    if (!existing) {
      this.latencyMap.set(model, {
        model,
        coldMs: isCold ? durationMs : null,
        warmMs: isCold ? null : durationMs,
        lastUsedAt: Date.now(),
        callCount: 1,
      });
    } else {
      existing.lastUsedAt = Date.now();
      existing.callCount++;
      if (isCold && existing.coldMs === null) {
        existing.coldMs = durationMs;
      } else if (!isCold) {
        existing.warmMs = existing.warmMs === null ? durationMs : Math.round(existing.warmMs * 0.7 + durationMs * 0.3);
      }
    }
    this.residentModel = model;
  }

  /**
   * Safe retention decision:
   * Keep model loaded if warm start saves latency and idle time is under 2 minutes.
   */
  shouldRetainResident(model: string, now = Date.now()): boolean {
    const m = this.latencyMap.get(model);
    if (!m) return false;
    const idleMs = now - m.lastUsedAt;
    if (idleMs > 120_000) return false; // Evict after 2 minutes of inactivity
    if (m.coldMs !== null && m.warmMs !== null && m.warmMs < m.coldMs) return true;
    return true;
  }
}
