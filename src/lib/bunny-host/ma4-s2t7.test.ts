import test from "node:test";
import assert from "node:assert/strict";
import {
  buildOperationalHealthSummary,
  DEFAULT_TELEMETRY_POLICY,
  exportSanitizedSupportBundle,
  LocalBetaFeedbackStore,
} from "./ma4/diagnostics-feedback.ts";

test("T7-A: buildOperationalHealthSummary accurately reports healthy, recovering, and degraded Host states", () => {
  const base = {
    now: 1_700_000_000_000,
    ollamaReachable: true,
    localModels: ["qwen2.5-coder:7b", "deepseek-r1:7b", "kimi-k2:cloud"],
    activeTaskCount: 1,
    taskFailureCount: 0,
    activeSchedules: 2,
    missedSchedules: 0,
    activeMonitors: 1,
    unreadableMonitors: 0,
    localFoldersCount: 1,
    pairedDevices: 1,
    connectedDevices: 1,
    rssMB: 86.9,
    heapUsedMB: 28.4,
    cpuMedianPct: 0.49,
    backgroundEnabled: true,
    resumeOnStartEnabled: true,
    lastRecoveryAt: null,
    recoveredTasks: 0,
    reconciliationWaiting: 0,
  };

  const healthy = buildOperationalHealthSummary(base);
  assert.equal(healthy.hostHealth, "healthy");
  assert.deepEqual(healthy.connectedModelStatus.runnableLocalModels, ["qwen2.5-coder:7b", "deepseek-r1:7b"]);
  assert.equal(healthy.connectedModelStatus.externalCloudInferenceEnabled, false);
  assert.equal(healthy.backgroundExecutionPolicy.automaticStartupEnabled, false);
  assert.equal(healthy.warnings.length, 0);

  const recovering = buildOperationalHealthSummary({ ...base, reconciliationWaiting: 1 });
  assert.equal(recovering.hostHealth, "recovering");
  assert.equal(recovering.warnings.length, 1);

  const degraded = buildOperationalHealthSummary({ ...base, unreadableMonitors: 1, corruptRecordCount: 1 });
  assert.equal(degraded.hostHealth, "degraded");
  assert.equal(degraded.warnings.length, 2);
});

test("T7-A2 & T7-B: exportSanitizedSupportBundle scrubs prompts, file contents, tokens, user paths, and emails", () => {
  assert.equal(DEFAULT_TELEMETRY_POLICY.telemetryOptIn, false);
  assert.equal(DEFAULT_TELEMETRY_POLICY.remoteUploadEnabled, false);

  const health = buildOperationalHealthSummary({
    now: 1_700_000_000_000,
    ollamaReachable: true,
    localModels: ["qwen2.5-coder:7b"],
    activeTaskCount: 0,
    taskFailureCount: 0,
    activeSchedules: 1,
    missedSchedules: 0,
    activeMonitors: 1,
    unreadableMonitors: 0,
    localFoldersCount: 1,
    pairedDevices: 0,
    connectedDevices: 0,
    rssMB: 84.4,
    heapUsedMB: 27.3,
    cpuMedianPct: 0.49,
    backgroundEnabled: false,
    resumeOnStartEnabled: true,
    lastRecoveryAt: null,
    recoveredTasks: 0,
    reconciliationWaiting: 0,
  });

  const bundle = exportSanitizedSupportBundle({
    now: 1_700_000_000_000,
    health,
    rawEvents: [
      {
        type: "task.step",
        detail: "Read C:\\Users\\allam\\Documents\\secret.md for owner@example.com with Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjMifQ.sig and sk-1234567890abcdefghij",
        prompt: "My private prompt",
        fileContent: "Private file body",
        accessToken: "oauth-secret-token",
      },
    ],
  });

  const serialized = JSON.stringify(bundle);
  assert.equal(serialized.includes("C:\\Users\\allam"), false, "Windows user path scrubbed");
  assert.equal(serialized.includes("owner@example.com"), false, "email scrubbed");
  assert.equal(serialized.includes("sk-1234567890"), false, "API key scrubbed");
  assert.equal(serialized.includes("eyJhbGci"), false, "JWT scrubbed");
  assert.equal(serialized.includes("My private prompt"), false, "prompt omitted");
  assert.equal(serialized.includes("Private file body"), false, "fileContent omitted");
  assert.equal(serialized.includes("oauth-secret-token"), false, "accessToken omitted");
});

test("T7-E: LocalBetaFeedbackStore requires opt-in, redacts details on preview/submit, and supports clearHistory", () => {
  const store = new LocalBetaFeedbackStore();
  assert.equal(store.isOptedIn(), false);
  assert.throws(() =>
    store.submit({
      now: 1_700_000_000_000,
      category: "bug",
      summary: "Test",
      details: "Details",
    }),
  );

  store.setOptIn(true);
  const entry = store.submit({
    now: 1_700_000_000_000,
    category: "usability",
    summary: "Issue in C:\\Users\\allam\\AppData\\Local\\Bunny-A",
    details: "Contact me at tester@example.org with token gsk_1234567890abcdefghij",
  });
  assert.equal(entry.remoteUploadDispatched, false);
  assert.equal(entry.summary.includes("C:\\Users\\allam"), false);
  assert.equal(entry.details.includes("tester@example.org"), false);
  assert.equal(entry.details.includes("gsk_1234567890"), false);
  assert.equal(store.list().length, 1);
  const exported = store.exportLocal();
  assert.equal(exported.schema, "bunny-beta-feedback/1");
  assert.equal(exported.entries.length, 1);
  assert.equal(exported.optIn, true);

  store.clearHistory();
  assert.equal(store.list().length, 0);
});

test("S3-T0: LocalBetaFeedbackStore with filePath survives a new instance (Host restart)", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const dir = mkdtempSync(join(tmpdir(), "bunny-fb-"));
  const filePath = join(dir, "beta-feedback.json");
  try {
    const first = new LocalBetaFeedbackStore({ filePath });
    first.setOptIn(true);
    first.submit({ now: 1_700_000_000_100, category: "bug", summary: "Restart check", details: "must persist" });
    const second = new LocalBetaFeedbackStore({ filePath });
    assert.equal(second.isOptedIn(), true);
    assert.equal(second.list().length, 1);
    assert.equal(second.list()[0]?.summary, "Restart check");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
