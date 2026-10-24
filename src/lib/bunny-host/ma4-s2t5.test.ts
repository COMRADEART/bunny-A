import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_NATIVE_NOTIFICATION_PREFS,
  evaluateLocalModelReadiness,
  evaluateNativeNotification,
  GUIDED_ONBOARDING_STAGE_IDS,
  projectDeviceDiagnostics,
  resolveGuidedOnboardingState,
  sanitizeNotificationText,
} from "./ma4/native-notifications.ts";
import { buildSchedule, type ScheduleDraft } from "../../components/island/proactive-forms.ts";
import { ScheduleSpecSchema } from "./ma4/proactive.ts";

test("T5-A: 10-step guided onboarding preserves safe defaults and grants zero implicit permissions on skip", () => {
  assert.equal(GUIDED_ONBOARDING_STAGE_IDS.length, 10);
  const initial = resolveGuidedOnboardingState(null);
  assert.equal(initial.status, "active");
  assert.equal(initial.stageId, "welcome");
  assert.equal(initial.preferences.backgroundExecutionOptIn, false);
  assert.equal(initial.preferences.nativeNotificationsOptIn, false);
  assert.equal(initial.implicitPermissionsGranted, 0);
  assert.equal(initial.automaticStartupEnabled, false);
  assert.equal(initial.cloudInferenceEnabled, false);

  const skipped = resolveGuidedOnboardingState({
    status: "skipped",
    stageIndex: 6,
    preferences: {
      preferredName: "Comrade",
      selectedLocalModel: "deepseek-v3:cloud",
      backgroundExecutionOptIn: true,
      nativeNotificationsOptIn: true,
    },
  });
  assert.equal(skipped.status, "skipped");
  assert.equal(skipped.preferences.selectedLocalModel, null, "cloud models rejected");
  assert.equal(skipped.preferences.backgroundExecutionOptIn, false, "skipping never enables background execution");
  assert.equal(skipped.preferences.nativeNotificationsOptIn, false, "skipping never enables native notifications");
});

test("T5-A2: evaluateLocalModelReadiness distinguishes offline Ollama, empty models, and runnable local models", () => {
  const down = evaluateLocalModelReadiness({ ollamaAvailable: false, models: [] });
  assert.equal(down.ready, false);
  assert.equal(down.ollamaReachable, false);

  const cloudOnly = evaluateLocalModelReadiness({
    ollamaAvailable: true,
    models: ["kimi-k2:cloud", "glm-5:cloud"],
    remoteModels: ["kimi-k2:cloud"],
  });
  assert.equal(cloudOnly.ready, false);
  assert.deepEqual(cloudOnly.runnableLocalModels, []);
  assert.equal(cloudOnly.blockedRemoteModels.length, 2);

  const ready = evaluateLocalModelReadiness({
    ollamaAvailable: true,
    models: ["qwen2.5-coder:7b", "deepseek-r1:7b", "kimi-k2:cloud"],
  });
  assert.equal(ready.ready, true);
  assert.deepEqual(ready.runnableLocalModels, ["qwen2.5-coder:7b", "deepseek-r1:7b"]);
});

test("T5-B & T5-C: native notifications enforce opt-in, deduplication, quiet hours, redaction, and device revocation", () => {
  const delivered = new Set<string>();
  const event = {
    category: "approval_needed" as const,
    sourceId: "ptask-42",
    revision: 1,
    title: "Write C:\\Users\\allam\\Documents\\secret.txt",
    detail: "Contact owner@example.com with token sk-1234567890abcdefghijklmnop",
    localHour: 14,
  };

  // Default OFF
  const offDecision = evaluateNativeNotification(event, DEFAULT_NATIVE_NOTIFICATION_PREFS, delivered);
  assert.equal(offDecision.deliver, false);
  assert.equal(offDecision.suppressedReason, "disabled_globally");

  // Opt-in enabled
  const activePrefs = {
    ...DEFAULT_NATIVE_NOTIFICATION_PREFS,
    enabled: true,
    quietHours: { enabled: true, startHour: 22, endHour: 7 },
  };
  const first = evaluateNativeNotification(event, activePrefs, delivered);
  assert.equal(first.deliver, true);
  assert.equal(first.impliesCompleted, false, "approval_needed never implies completion");
  assert.ok(first.bannerTitle.startsWith("Approval waiting (not started):"));
  assert.ok(!first.bannerTitle.includes("C:\\Users\\allam"), "Windows path redacted");
  assert.ok(!first.bannerBody.includes("owner@example.com"), "email redacted");
  assert.ok(!first.bannerBody.includes("sk-1234567890"), "secret token redacted");
  assert.equal(first.remotePushRelayUsed, false);

  // Duplicate suppressed
  const dup = evaluateNativeNotification(event, activePrefs, delivered);
  assert.equal(dup.deliver, false);
  assert.equal(dup.suppressedReason, "duplicate");

  // Quiet hours suppressed
  const quietEvent = { ...event, revision: 2, localHour: 23 };
  const quiet = evaluateNativeNotification(quietEvent, activePrefs, delivered);
  assert.equal(quiet.deliver, false);
  assert.equal(quiet.suppressedReason, "quiet_hours");

  // Revoked or offline Android device suppressed
  const revoked = evaluateNativeNotification(
    { ...event, revision: 3 },
    activePrefs,
    delivered,
    { isPairedDevice: true, revoked: true, connected: true },
  );
  assert.equal(revoked.deliver, false);
  assert.equal(revoked.suppressedReason, "revoked_device");

  const offline = evaluateNativeNotification(
    { ...event, revision: 4 },
    activePrefs,
    delivered,
    { isPairedDevice: true, revoked: false, connected: false },
  );
  assert.equal(offline.deliver, false);
  assert.equal(offline.suppressedReason, "device_offline");
});

test("T5-D: ScheduleDraft supports linking a task schedule to a Goal Criterion (closing BLK-T3R1-03)", () => {
  const now = new Date(2026, 9, 24, 12, 0).getTime();
  const baseDraft: ScheduleDraft = {
    title: "Atlas status check",
    projectId: "personal",
    when: "daily",
    date: "",
    time: "18:00",
    timeZone: "UTC",
    days: [],
    monitorId: "",
    starts: "",
    expires: "2026-11-30",
    task: "check",
    text: "",
    root: "atlas-project",
    paths: "STATUS.md",
    model: "",
    review: false,
    missedPolicy: "skip",
    background: false,
    maxModelCalls: 0,
    maxMinutes: 15,
    maxRunsPerDay: 2,
    notifyCompleted: true,
    notifyFailed: true,
    goalId: "goal-atlas-beta",
    criterionId: "status-verified-1",
  };
  const built = buildSchedule(baseDraft, now);
  assert.equal(built.ok, true);
  if (built.ok) {
    assert.deepEqual(built.spec.goal, { id: "goal-atlas-beta", criterionId: "status-verified-1" });
    assert.equal(ScheduleSpecSchema.safeParse(built.spec).success, true);
  }

  const missingCrit = buildSchedule({ ...baseDraft, criterionId: "" }, now);
  assert.equal(missingCrit.ok, false);
  if (!missingCrit.ok) {
    assert.equal(missingCrit.errors.criterionId, "Choose the goal criterion this schedule serves.");
  }
});

test("T5-E: projectDeviceDiagnostics reports connection state accurately and leaks zero tokens", () => {
  const now = 1_700_000_000_000;
  const diag = projectDeviceDiagnostics(
    {
      id: "dev-sm-s948u",
      name: "Samsung SM-S948U",
      createdAt: now - 3_600_000,
      lastSeenAt: now - 15_000,
      expiresAt: now + 86_400_000,
      token: "secret-raw-token",
      tokenHash: "sha256-secret-hash",
    },
    now,
  );
  assert.equal(diag.connectionStatus, "connected");
  assert.equal(diag.canSuperviseTasks, true);
  assert.equal(diag.canGrantWorkstationPermissions, false);
  assert.equal(diag.exposedSecretsOrTokens, 0);
  assert.equal("token" in diag, false);
  assert.equal("tokenHash" in diag, false);
  assert.equal(sanitizeNotificationText("Path C:\\Users\\allam\\secret.json"), "Path [redacted]");
});
