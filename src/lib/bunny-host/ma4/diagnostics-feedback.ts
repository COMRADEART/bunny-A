/**
 * MA4-S2-T7 — Operational Diagnostics, Support Bundle Redaction, Telemetry Governance, Corruption Recovery & Beta Feedback.
 * - T7-A: User-visible operational health summary & sanitized support bundle export.
 * - T7-B: Privacy & telemetry governance (optional telemetry OFF by default; prompts, file contents, tokens never collected).
 * - T7-C: Crash, hang, sleep/wake & corruption fail-closed recovery verification.
 * - T7-E: Local-first beta feedback store with full user preview, redaction, and history clearing.
 * MA4-S3-T0: optional durable file backing so opt-in feedback survives Host restart (no remote upload).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type OperationalHealthSummary = {
  schema: "bunny-operational-health/1";
  generatedAt: number;
  hostHealth: "healthy" | "degraded" | "recovering";
  connectedModelStatus: {
    ollamaReachable: boolean;
    runnableLocalModels: string[];
    externalCloudInferenceEnabled: false;
  };
  activeTaskCount: number;
  taskFailureCount: number;
  schedulerHealth: {
    activeSchedules: number;
    missedCount: number;
    duplicateDispatches: 0;
  };
  monitorHealth: {
    activeMonitors: number;
    unreadableMonitors: number;
  };
  connectedServiceStatus: {
    localFoldersCount: number;
    liveOAuthProvidersEnabled: false;
  };
  deviceConnectivity: {
    pairedDevices: number;
    connectedDevices: number;
  };
  resourceUsage: {
    rssMB: number;
    heapUsedMB: number;
    cpuMedianPct: number;
  };
  backgroundExecutionPolicy: {
    backgroundEnabled: boolean;
    resumeOnStartEnabled: boolean;
    automaticStartupEnabled: false;
  };
  lastRecoveryEvent: {
    at: number | null;
    recoveredTasks: number;
    reconciliationWaiting: number;
  };
  warnings: string[];
};

export function buildOperationalHealthSummary(input: {
  now: number;
  ollamaReachable: boolean;
  localModels: readonly string[];
  activeTaskCount: number;
  taskFailureCount: number;
  activeSchedules: number;
  missedSchedules: number;
  activeMonitors: number;
  unreadableMonitors: number;
  localFoldersCount: number;
  pairedDevices: number;
  connectedDevices: number;
  rssMB: number;
  heapUsedMB: number;
  cpuMedianPct: number;
  backgroundEnabled: boolean;
  resumeOnStartEnabled: boolean;
  lastRecoveryAt: number | null;
  recoveredTasks: number;
  reconciliationWaiting: number;
  corruptRecordCount?: number;
}): OperationalHealthSummary {
  const warnings: string[] = [];
  if (!input.ollamaReachable) warnings.push("Local Ollama runtime is unreachable; model-dependent tasks will wait or fail safely.");
  if (input.unreadableMonitors > 0) warnings.push(`${input.unreadableMonitors} monitor(s) cannot read their source.`);
  if (input.reconciliationWaiting > 0) warnings.push(`${input.reconciliationWaiting} interrupted task(s) await owner reconciliation.`);
  if ((input.corruptRecordCount ?? 0) > 0) warnings.push(`${input.corruptRecordCount} corrupted record(s) quarantined in read-only safe mode.`);

  const hostHealth = (input.corruptRecordCount ?? 0) > 0 || input.unreadableMonitors > 0
    ? "degraded"
    : input.reconciliationWaiting > 0
      ? "recovering"
      : "healthy";

  return {
    schema: "bunny-operational-health/1",
    generatedAt: input.now,
    hostHealth,
    connectedModelStatus: {
      ollamaReachable: input.ollamaReachable,
      runnableLocalModels: input.localModels.filter((m) => !m.endsWith(":cloud")),
      externalCloudInferenceEnabled: false,
    },
    activeTaskCount: input.activeTaskCount,
    taskFailureCount: input.taskFailureCount,
    schedulerHealth: {
      activeSchedules: input.activeSchedules,
      missedCount: input.missedSchedules,
      duplicateDispatches: 0,
    },
    monitorHealth: {
      activeMonitors: input.activeMonitors,
      unreadableMonitors: input.unreadableMonitors,
    },
    connectedServiceStatus: {
      localFoldersCount: input.localFoldersCount,
      liveOAuthProvidersEnabled: false,
    },
    deviceConnectivity: {
      pairedDevices: input.pairedDevices,
      connectedDevices: input.connectedDevices,
    },
    resourceUsage: {
      rssMB: Number(input.rssMB.toFixed(2)),
      heapUsedMB: Number(input.heapUsedMB.toFixed(2)),
      cpuMedianPct: Number(input.cpuMedianPct.toFixed(3)),
    },
    backgroundExecutionPolicy: {
      backgroundEnabled: input.backgroundEnabled,
      resumeOnStartEnabled: input.resumeOnStartEnabled,
      automaticStartupEnabled: false,
    },
    lastRecoveryEvent: {
      at: input.lastRecoveryAt,
      recoveredTasks: input.recoveredTasks,
      reconciliationWaiting: input.reconciliationWaiting,
    },
    warnings,
  };
}

const FORBIDDEN_FIELD_KEYS = new Set([
  "prompt",
  "rawPrompt",
  "content",
  "fileContent",
  "body",
  "emailBody",
  "token",
  "accessToken",
  "refreshToken",
  "pairingCode",
  "secret",
  "password",
]);

const REDACTION_REGEXES: readonly [RegExp, string][] = [
  [/\b(?:sk-[A-Za-z0-9]{16,}|gsk_[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16})\b/g, "[REDACTED_SECRET]"],
  [/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED_TOKEN]"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "[REDACTED_JWT]"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[REDACTED_PRIVATE_KEY]"],
  [/[A-Za-z]:\\Users\\[^\s"'\\]+(?:\\[^\s"']*)?/g, "[REDACTED_USER_PATH]"],
  [/\/Users\/[^\s"'/]+(?:\/[^\s"']*)?/g, "[REDACTED_USER_PATH]"],
  [/\/home\/[^\s"'/]+(?:\/[^\s"']*)?/g, "[REDACTED_USER_PATH]"],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[REDACTED_EMAIL]"],
];

export function redactDiagnosticString(value: string): string {
  let out = value;
  for (const [pattern, replacement] of REDACTION_REGEXES) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

export function scrubDiagnosticValue(value: unknown): unknown {
  if (typeof value === "string") return redactDiagnosticString(value);
  if (typeof value === "number" || typeof value === "boolean" || value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((item) => scrubDiagnosticValue(item));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_FIELD_KEYS.has(k)) {
        out[k] = "[OMITTED_SENSITIVE_FIELD]";
      } else {
        out[k] = scrubDiagnosticValue(v);
      }
    }
    return out;
  }
  return String(value);
}

export type SanitizedSupportBundle = {
  schema: "bunny-support-bundle/1";
  exportedAt: number;
  health: OperationalHealthSummary;
  recentEvents: unknown[];
  redactionGuarantee: {
    omitsPrompts: true;
    omitsFileContents: true;
    omitsTokensAndSecrets: true;
    omitsUserPathsAndEmails: true;
  };
};

export function exportSanitizedSupportBundle(input: {
  now: number;
  health: OperationalHealthSummary;
  rawEvents: readonly unknown[];
}): SanitizedSupportBundle {
  return {
    schema: "bunny-support-bundle/1",
    exportedAt: input.now,
    health: scrubDiagnosticValue(input.health) as OperationalHealthSummary,
    recentEvents: input.rawEvents.slice(-50).map((e) => scrubDiagnosticValue(e)),
    redactionGuarantee: {
      omitsPrompts: true,
      omitsFileContents: true,
      omitsTokensAndSecrets: true,
      omitsUserPathsAndEmails: true,
    },
  };
}

// ── T7-B: Privacy & Telemetry Governance ──────────────────────────────────────────────────────────────────────────

export type TelemetryGovernancePolicy = {
  telemetryOptIn: boolean;
  remoteUploadEnabled: false;
  prohibitedCategories: readonly [
    "raw_prompts",
    "file_contents",
    "email_bodies",
    "calendar_details",
    "document_contents",
    "oauth_tokens",
    "pairing_secrets",
  ];
};

export const DEFAULT_TELEMETRY_POLICY: TelemetryGovernancePolicy = {
  telemetryOptIn: false,
  remoteUploadEnabled: false,
  prohibitedCategories: [
    "raw_prompts",
    "file_contents",
    "email_bodies",
    "calendar_details",
    "document_contents",
    "oauth_tokens",
    "pairing_secrets",
  ],
};

// ── T7-E: Local-First Beta Feedback Store ─────────────────────────────────────────────────────────────────────────

export type BetaFeedbackCategory = "bug" | "usability" | "accessibility" | "model_quality" | "general";

export type BetaFeedbackEntry = {
  id: string;
  createdAt: number;
  category: BetaFeedbackCategory;
  summary: string;
  details: string;
  attachedSupportBundle: SanitizedSupportBundle | null;
  remoteUploadDispatched: false;
};

type DurableFeedbackFile = {
  schema: "bunny-beta-feedback/1";
  optIn: boolean;
  entries: BetaFeedbackEntry[];
};

export class LocalBetaFeedbackStore {
  private entries: BetaFeedbackEntry[] = [];
  private optIn = false;
  private readonly filePath: string | null;
  private readonly maxEntries: number;

  /** When `filePath` is set, opt-in and entries survive process restart. Default remains in-memory (tests). */
  constructor(options?: { filePath?: string | null; maxEntries?: number }) {
    this.filePath = options?.filePath ?? null;
    this.maxEntries = options?.maxEntries ?? 200;
    this.load();
  }

  isOptedIn(): boolean {
    return this.optIn;
  }

  setOptIn(enabled: boolean): void {
    this.optIn = Boolean(enabled);
    this.persist();
  }

  previewEntry(input: {
    now: number;
    category: BetaFeedbackCategory;
    summary: string;
    details: string;
    supportBundle?: SanitizedSupportBundle | null;
  }): BetaFeedbackEntry {
    return {
      id: `fb-${input.now}-${this.entries.length + 1}`,
      createdAt: input.now,
      category: input.category,
      summary: redactDiagnosticString(input.summary.trim().slice(0, 200)),
      details: redactDiagnosticString(input.details.trim().slice(0, 2_000)),
      attachedSupportBundle: input.supportBundle ? (scrubDiagnosticValue(input.supportBundle) as SanitizedSupportBundle) : null,
      remoteUploadDispatched: false,
    };
  }

  submit(input: {
    now: number;
    category: BetaFeedbackCategory;
    summary: string;
    details: string;
    supportBundle?: SanitizedSupportBundle | null;
  }): BetaFeedbackEntry {
    if (!this.optIn) {
      throw new Error("Beta feedback is disabled until the user explicitly opts in.");
    }
    const entry = this.previewEntry(input);
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) this.entries = this.entries.slice(-this.maxEntries);
    this.persist();
    return entry;
  }

  list(): readonly BetaFeedbackEntry[] {
    return [...this.entries];
  }

  /** Local export only — never uploads. Returns a sanitized JSON document the owner can copy. */
  exportLocal(): DurableFeedbackFile {
    return {
      schema: "bunny-beta-feedback/1",
      optIn: this.optIn,
      entries: this.entries.map((e) => ({
        ...e,
        summary: redactDiagnosticString(e.summary),
        details: redactDiagnosticString(e.details),
        attachedSupportBundle: e.attachedSupportBundle
          ? (scrubDiagnosticValue(e.attachedSupportBundle) as SanitizedSupportBundle)
          : null,
        remoteUploadDispatched: false as const,
      })),
    };
  }

  clearHistory(): void {
    this.entries = [];
    this.persist();
  }

  private load(): void {
    if (!this.filePath || !existsSync(this.filePath)) return;
    try {
      const raw = JSON.parse(readFileSync(this.filePath, "utf8")) as DurableFeedbackFile;
      if (raw?.schema !== "bunny-beta-feedback/1") return;
      this.optIn = Boolean(raw.optIn);
      this.entries = Array.isArray(raw.entries) ? raw.entries.slice(-this.maxEntries) : [];
    } catch {
      /* Corrupt file: start empty; never throw during Host boot. */
    }
  }

  private persist(): void {
    if (!this.filePath) return;
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      writeFileSync(this.filePath, JSON.stringify(this.exportLocal(), null, 2), "utf8");
    } catch {
      /* Persistence failure must not break submit/list in memory for this session. */
    }
  }
}
