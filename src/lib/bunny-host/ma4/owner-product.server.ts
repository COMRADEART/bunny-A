import type { DatabaseSync } from "node:sqlite";
import {
  WINDOWS_NOTIFICATION_CAPABILITY,
  claimNativeNotification,
  evaluateLocalModelReadiness,
  hostNotificationEvent,
  migrateLegacyOnboarding,
  normalizeNotificationPrefs,
  resolveGuidedOnboardingState,
  type GuidedOnboardingState,
  type NativeNotificationCategory,
  type NativeNotificationDecision,
  type NativeNotificationPrefs,
} from "./native-notifications.ts";

const ONBOARDING_KEY = "guided_onboarding_v1";
const PREFS_KEY = "native_notification_prefs_v1";
const LEDGER_LIMIT = 400;

function ensureSettings(db: DatabaseSync) {
  db.exec("CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL)");
}

function readSetting(db: DatabaseSync, key: string): string | null {
  ensureSettings(db);
  const row = db.prepare("SELECT value FROM settings WHERE key=?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

function writeSetting(db: DatabaseSync, key: string, value: string) {
  ensureSettings(db);
  db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, value);
}

export function readOnboarding(db: DatabaseSync): GuidedOnboardingState | null {
  const raw = readSetting(db, ONBOARDING_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { schema?: unknown; state?: unknown };
    if (parsed.schema !== 1) return null;
    return resolveGuidedOnboardingState(parsed.state as never);
  } catch {
    return null;
  }
}

export function saveOnboarding(
  db: DatabaseSync,
  raw: unknown,
  catalog: { available: boolean; models: readonly string[]; remoteModels: readonly string[] },
): GuidedOnboardingState {
  const record = raw && typeof raw === "object" ? raw as { step?: unknown; stageIndex?: unknown } : null;
  const migrated = record && typeof record.step === "number" && typeof record.stageIndex !== "number"
    ? migrateLegacyOnboarding(raw)
    : resolveGuidedOnboardingState(raw as never);
  const report = evaluateLocalModelReadiness({
    ollamaAvailable: catalog.available,
    models: catalog.models,
    remoteModels: catalog.remoteModels,
  });
  const selected = migrated.preferences.selectedLocalModel;
  const state = resolveGuidedOnboardingState({
    status: migrated.status,
    stageIndex: migrated.stageIndex,
    preferences: {
      ...migrated.preferences,
      selectedLocalModel: selected && report.runnableLocalModels.includes(selected) ? selected : null,
    },
  });
  writeSetting(db, ONBOARDING_KEY, JSON.stringify({ schema: 1, state }));
  return state;
}

export function readNotificationPrefs(db: DatabaseSync): NativeNotificationPrefs {
  const raw = readSetting(db, PREFS_KEY);
  if (!raw) return normalizeNotificationPrefs(null);
  try { return normalizeNotificationPrefs(JSON.parse(raw)); } catch { return normalizeNotificationPrefs(null); }
}

export function saveNotificationPrefs(db: DatabaseSync, raw: unknown): NativeNotificationPrefs {
  const prefs = normalizeNotificationPrefs(raw);
  writeSetting(db, PREFS_KEY, JSON.stringify(prefs));
  return prefs;
}

function ledgerKey(audience: string) {
  const safe = audience.replace(/[^A-Za-z0-9_.:-]/g, "").slice(0, 80);
  return `native_notification_ledger_v1:${safe || "workstation"}`;
}

function readLedger(db: DatabaseSync, audience: string): string[] {
  const raw = readSetting(db, ledgerKey(audience));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string").slice(-LEDGER_LIMIT) : [];
  } catch {
    return [];
  }
}

export type StoredHostEvent = { sequence: number; type: string; taskId: string | null; detail: string; missionId: string | null };

/** Decides a banner from a journal row. Unknown sequences are refused, so a client cannot mint an event id. */
export function decideStoredNotification(
  db: DatabaseSync,
  input: {
    sequence: number;
    audience: string;
    localHour: number;
    deviceContext?: { isPairedDevice: boolean; revoked: boolean; connected: boolean };
  },
): { error: string | null; decision: NativeNotificationDecision | null; category: NativeNotificationCategory | null; capability: typeof WINDOWS_NOTIFICATION_CAPABILITY } {
  const row = db.prepare(
    "SELECT sequence, type, task_id AS taskId, detail, mission_id AS missionId FROM events WHERE sequence=?",
  ).get(input.sequence) as StoredHostEvent | undefined;
  if (!row) return { error: "forged_or_unknown_event", decision: null, category: null, capability: WINDOWS_NOTIFICATION_CAPABILITY };
  const parsed = hostNotificationEvent({
    type: row.type,
    sequence: row.sequence,
    taskId: row.taskId,
    missionId: row.missionId,
    detail: row.detail,
    localHour: input.localHour,
  });
  if (!parsed.ok) return { error: parsed.reason, decision: null, category: null, capability: WINDOWS_NOTIFICATION_CAPABILITY };
  const claimed = claimNativeNotification(
    parsed.event,
    readNotificationPrefs(db),
    readLedger(db, input.audience),
    input.deviceContext,
  );
  if (claimed.decision.deliver) writeSetting(db, ledgerKey(input.audience), JSON.stringify(claimed.deliveredKeys.slice(-LEDGER_LIMIT)));
  return { error: null, decision: claimed.decision, category: parsed.event.category, capability: WINDOWS_NOTIFICATION_CAPABILITY };
}
