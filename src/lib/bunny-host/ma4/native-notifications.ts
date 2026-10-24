/**
 * MA4-S2-T5 — Complete User Experience & Native Platform Integration:
 * - T5-A: Non-developer 10-step guided onboarding contract (skip/resume without hidden permission side effects).
 * - T5-B & T5-C: Native Windows & Android notification contract (opt-in, deduplicated, quiet hours, privacy-safe
 *   summaries, accurate pending-approval wording, revocation & offline suppression, no unapproved remote push relay).
 * - T5-E: Paired-device diagnostics & management projection with zero credential/token leakage.
 */

export const GUIDED_ONBOARDING_STAGE_IDS = [
  "welcome",
  "local-architecture",
  "preferences",
  "local-model-readiness",
  "model-selection",
  "permissions-boundary",
  "background-execution-opt-in",
  "phone-pairing-optional",
  "voice-check-optional",
  "first-safe-workflow",
] as const;

export type GuidedOnboardingStageId = (typeof GUIDED_ONBOARDING_STAGE_IDS)[number];

export type GuidedOnboardingPreferences = {
  preferredName: string;
  preferredLanguage: string;
  selectedLocalModel: string | null;
  backgroundExecutionOptIn: boolean;
  nativeNotificationsOptIn: boolean;
  pairedDeviceSkipped: boolean;
  voiceCheckSkipped: boolean;
};

export type GuidedOnboardingState = {
  status: "active" | "skipped" | "done";
  stageIndex: number;
  stageId: GuidedOnboardingStageId;
  preferences: GuidedOnboardingPreferences;
  implicitPermissionsGranted: 0;
  automaticStartupEnabled: false;
  cloudInferenceEnabled: false;
};

export const DEFAULT_ONBOARDING_PREFERENCES: GuidedOnboardingPreferences = {
  preferredName: "",
  preferredLanguage: "en-US",
  selectedLocalModel: null,
  backgroundExecutionOptIn: false,
  nativeNotificationsOptIn: false,
  pairedDeviceSkipped: true,
  voiceCheckSkipped: true,
};

/**
 * Evaluates or resumes guided onboarding state. Skipping or resuming onboarding never grants background execution,
 * file roots, connector permissions, automatic startup, or cloud inference.
 */
export function resolveGuidedOnboardingState(
  raw?: Partial<{
    status: "active" | "skipped" | "done";
    stageIndex: number;
    preferences: Partial<GuidedOnboardingPreferences>;
  }> | null,
): GuidedOnboardingState {
  const status = raw?.status === "skipped" || raw?.status === "done" ? raw.status : "active";
  const stageIndex = typeof raw?.stageIndex === "number" && Number.isInteger(raw.stageIndex)
    ? Math.max(0, Math.min(GUIDED_ONBOARDING_STAGE_IDS.length - 1, raw.stageIndex))
    : 0;
  const prefs: GuidedOnboardingPreferences = {
    preferredName: typeof raw?.preferences?.preferredName === "string"
      ? raw.preferences.preferredName.trim().slice(0, 60)
      : "",
    preferredLanguage: typeof raw?.preferences?.preferredLanguage === "string" && raw.preferences.preferredLanguage.trim()
      ? raw.preferences.preferredLanguage.trim().slice(0, 16)
      : "en-US",
    selectedLocalModel: typeof raw?.preferences?.selectedLocalModel === "string" && !raw.preferences.selectedLocalModel.endsWith(":cloud")
      ? raw.preferences.selectedLocalModel
      : null,
    // If onboarding was skipped, opt-in flags must remain false unless explicitly saved before skipping.
    backgroundExecutionOptIn: status === "skipped" ? false : Boolean(raw?.preferences?.backgroundExecutionOptIn),
    nativeNotificationsOptIn: status === "skipped" ? false : Boolean(raw?.preferences?.nativeNotificationsOptIn),
    pairedDeviceSkipped: raw?.preferences?.pairedDeviceSkipped ?? true,
    voiceCheckSkipped: raw?.preferences?.voiceCheckSkipped ?? true,
  };
  return {
    status,
    stageIndex,
    stageId: GUIDED_ONBOARDING_STAGE_IDS[stageIndex],
    preferences: prefs,
    implicitPermissionsGranted: 0,
    automaticStartupEnabled: false,
    cloudInferenceEnabled: false,
  };
}

export type LocalModelReadinessReport = {
  ollamaReachable: boolean;
  runnableLocalModels: string[];
  blockedRemoteModels: string[];
  ready: boolean;
  userGuidance: string;
};

/**
 * Inspects discovered Ollama models for non-developer onboarding without requiring a terminal.
 */
export function evaluateLocalModelReadiness(input: {
  ollamaAvailable: boolean;
  models: readonly string[];
  remoteModels?: readonly string[];
}): LocalModelReadinessReport {
  const remoteSet = new Set(input.remoteModels ?? []);
  const runnableLocalModels = input.models.filter((m) => !remoteSet.has(m) && !m.endsWith(":cloud"));
  const blockedRemoteModels = input.models.filter((m) => remoteSet.has(m) || m.endsWith(":cloud"));
  if (!input.ollamaAvailable) {
    return {
      ollamaReachable: false,
      runnableLocalModels: [],
      blockedRemoteModels,
      ready: false,
      userGuidance: "Local Ollama runtime is not running yet. Start Ollama on this PC to enable local model tasks, or continue with non-model file checks and reminders.",
    };
  }
  if (!runnableLocalModels.length) {
    return {
      ollamaReachable: true,
      runnableLocalModels: [],
      blockedRemoteModels,
      ready: false,
      userGuidance: "Ollama is running, but no local model is installed yet. Install a local model such as qwen2.5-coder:7b in Models.",
    };
  }
  return {
    ollamaReachable: true,
    runnableLocalModels,
    blockedRemoteModels,
    ready: true,
    userGuidance: `Ready: ${runnableLocalModels.length} local model${runnableLocalModels.length === 1 ? "" : "s"} available (${runnableLocalModels.join(", ")}).`,
  };
}

// ── T5-B & T5-C: Native Windows & Android Notification Policy ────────────────────────────────────────────────────

export const NATIVE_NOTIFICATION_CATEGORIES = [
  "approval_needed",
  "task_completed",
  "task_failed",
  "schedule_triggered",
  "source_changed",
  "recovery_needed",
] as const;

export type NativeNotificationCategory = (typeof NATIVE_NOTIFICATION_CATEGORIES)[number];

export type NativeNotificationPrefs = {
  enabled: boolean;
  categories: Record<NativeNotificationCategory, boolean>;
  quietHours: {
    enabled: boolean;
    startHour: number;
    endHour: number;
  };
};

export const DEFAULT_NATIVE_NOTIFICATION_PREFS: NativeNotificationPrefs = {
  enabled: false,
  categories: {
    approval_needed: true,
    task_completed: true,
    task_failed: true,
    schedule_triggered: false,
    source_changed: true,
    recovery_needed: true,
  },
  quietHours: {
    enabled: false,
    startHour: 22,
    endHour: 7,
  },
};

const SENSITIVE_PATTERNS: readonly RegExp[] = [
  /[A-Za-z]:\\[^\s"']+/g,
  /\/(?:home|Users|var|etc|tmp)\/[^\s"']+/g,
  /\b(?:sk-[A-Za-z0-9]{16,}|Bearer\s+[A-Za-z0-9._-]+|eyJ[A-Za-z0-9_-]{10,})\b/g,
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
];

/**
 * Redacts file paths, tokens, and email addresses from lock-screen / native notification banners.
 */
export function sanitizeNotificationText(raw: string, maxLength = 140): string {
  let cleaned = raw;
  for (const pat of SENSITIVE_PATTERNS) {
    cleaned = cleaned.replace(pat, "[redacted]");
  }
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1)}…` : cleaned;
}

export function isWithinQuietHours(localHour: number, quiet: NativeNotificationPrefs["quietHours"]): boolean {
  if (!quiet.enabled) return false;
  if (quiet.startHour === quiet.endHour) return false;
  if (quiet.startHour < quiet.endHour) {
    return localHour >= quiet.startHour && localHour < quiet.endHour;
  }
  return localHour >= quiet.startHour || localHour < quiet.endHour;
}

export type NativeNotificationEvent = {
  category: NativeNotificationCategory;
  sourceId: string;
  revision: number;
  title: string;
  detail: string;
  localHour: number;
};

export type NativeNotificationDecision = {
  deliver: boolean;
  dedupKey: string;
  suppressedReason: "disabled_globally" | "category_disabled" | "quiet_hours" | "duplicate" | "revoked_device" | "device_offline" | null;
  bannerTitle: string;
  bannerBody: string;
  targetRoute: string;
  impliesCompleted: boolean;
  remotePushRelayUsed: false;
};

/**
 * Evaluates whether a Windows or paired-Android native notification may be delivered, with strict deduplication,
 * privacy redaction, accurate pending wording, and zero remote push relay usage.
 */
export function evaluateNativeNotification(
  event: NativeNotificationEvent,
  prefs: NativeNotificationPrefs,
  deliveredKeys: Set<string>,
  deviceContext?: { isPairedDevice: boolean; revoked: boolean; connected: boolean },
): NativeNotificationDecision {
  const dedupKey = `${event.category}:${event.sourceId}:r${event.revision}`;
  const cleanTitle = sanitizeNotificationText(event.title, 80);
  const cleanDetail = sanitizeNotificationText(event.detail, 140);

  const bannerTitle = event.category === "approval_needed"
    ? `Approval waiting (not started): ${cleanTitle}`
    : event.category === "recovery_needed"
      ? `Recovery needed (paused): ${cleanTitle}`
      : cleanTitle;

  const impliesCompleted = event.category === "task_completed";
  const targetRoute = `/?view=tasks&focus=${encodeURIComponent(event.sourceId)}`;

  if (deviceContext?.isPairedDevice) {
    if (deviceContext.revoked) {
      return {
        deliver: false,
        dedupKey,
        suppressedReason: "revoked_device",
        bannerTitle,
        bannerBody: cleanDetail,
        targetRoute,
        impliesCompleted,
        remotePushRelayUsed: false,
      };
    }
    if (!deviceContext.connected) {
      return {
        deliver: false,
        dedupKey,
        suppressedReason: "device_offline",
        bannerTitle,
        bannerBody: cleanDetail,
        targetRoute,
        impliesCompleted,
        remotePushRelayUsed: false,
      };
    }
  }

  if (!prefs.enabled) {
    return {
      deliver: false,
      dedupKey,
      suppressedReason: "disabled_globally",
      bannerTitle,
      bannerBody: cleanDetail,
      targetRoute,
      impliesCompleted,
      remotePushRelayUsed: false,
    };
  }
  if (!prefs.categories[event.category]) {
    return {
      deliver: false,
      dedupKey,
      suppressedReason: "category_disabled",
      bannerTitle,
      bannerBody: cleanDetail,
      targetRoute,
      impliesCompleted,
      remotePushRelayUsed: false,
    };
  }
  if (isWithinQuietHours(event.localHour, prefs.quietHours)) {
    return {
      deliver: false,
      dedupKey,
      suppressedReason: "quiet_hours",
      bannerTitle,
      bannerBody: cleanDetail,
      targetRoute,
      impliesCompleted,
      remotePushRelayUsed: false,
    };
  }
  if (deliveredKeys.has(dedupKey)) {
    return {
      deliver: false,
      dedupKey,
      suppressedReason: "duplicate",
      bannerTitle,
      bannerBody: cleanDetail,
      targetRoute,
      impliesCompleted,
      remotePushRelayUsed: false,
    };
  }

  deliveredKeys.add(dedupKey);
  return {
    deliver: true,
    dedupKey,
    suppressedReason: null,
    bannerTitle,
    bannerBody: cleanDetail,
    targetRoute,
    impliesCompleted,
    remotePushRelayUsed: false,
  };
}

// ── T5-E: Paired-Device Management & Diagnostics Projection ──────────────────────────────────────────────────────

export type DeviceDiagnosticsView = {
  deviceId: string;
  name: string;
  connectionStatus: "connected" | "disconnected" | "expired" | "revoked";
  pairedAt: number;
  lastSeenAt: number | null;
  expiresAt: number | null;
  transportSecurity: "https-pinned-tls" | "loopback-only";
  canSuperviseTasks: boolean;
  canGrantWorkstationPermissions: false;
  exposedSecretsOrTokens: 0;
};

export function projectDeviceDiagnostics(
  device: {
    id: string;
    name: string;
    createdAt: number;
    lastSeenAt?: number | null;
    expiresAt?: number | null;
    revoked?: boolean;
    token?: string;
    tokenHash?: string;
  },
  now: number,
  activeWindowMs = 120_000,
): DeviceDiagnosticsView {
  const isExpired = typeof device.expiresAt === "number" && device.expiresAt <= now;
  const isConnected = !device.revoked && !isExpired && typeof device.lastSeenAt === "number" && now - device.lastSeenAt <= activeWindowMs;
  const connectionStatus = device.revoked
    ? "revoked"
    : isExpired
      ? "expired"
      : isConnected
        ? "connected"
        : "disconnected";

  return {
    deviceId: device.id,
    name: device.name.trim().slice(0, 60) || "Paired Android phone",
    connectionStatus,
    pairedAt: device.createdAt,
    lastSeenAt: device.lastSeenAt ?? null,
    expiresAt: device.expiresAt ?? null,
    transportSecurity: "https-pinned-tls",
    canSuperviseTasks: connectionStatus === "connected",
    canGrantWorkstationPermissions: false,
    exposedSecretsOrTokens: 0,
  };
}
