import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostDatabase } from "./persistence.server.ts";
import { TaskManager } from "./manager.server.ts";
import { providerBase } from "./adapters.server.ts";
import type { AdapterResult, ProviderAdapter } from "./contracts.ts";
import { HostContainment } from "./failure.server.ts";
import { MissionManager } from "../bunny-missions/manager.server.ts";
import { FilesystemCapability, NotificationsCapability } from "../bunny-missions/capabilities/local.server.ts";
import { LocalBetaFeedbackStore } from "./ma4/diagnostics-feedback.ts";
import {
  decideStoredNotification,
  readOnboarding,
  saveNotificationPrefs,
  saveOnboarding,
} from "./ma4/owner-product.server.ts";
import {
  deviceStatusPresentation,
  migrateLegacyOnboarding,
  parseAndroidBridgeMessage,
  projectDeviceDiagnostics,
} from "./ma4/native-notifications.ts";

test("T0R legacy onboarding cannot escalate background execution or keep a model name", () => {
  const skipped = migrateLegacyOnboarding({
    status: "skipped",
    step: 3,
    preferences: { backgroundExecutionOptIn: true, nativeNotificationsOptIn: true, selectedLocalModel: "qwen2.5-coder:7b" },
  });
  assert.equal(skipped.preferences.backgroundExecutionOptIn, false);
  assert.equal(skipped.preferences.nativeNotificationsOptIn, false);
  assert.equal(skipped.preferences.selectedLocalModel, null);
  assert.equal(skipped.implicitPermissionsGranted, 0);
  const db = new HostDatabase(":memory:");
  const saved = saveOnboarding(db.db, { status: "done", step: 6, preferences: { backgroundExecutionOptIn: true, selectedLocalModel: "qwen2.5-coder:7b" } }, {
    available: true,
    models: ["qwen2.5-coder:7b"],
    remoteModels: [],
  });
  assert.equal(saved.preferences.backgroundExecutionOptIn, false);
  assert.equal(saved.preferences.selectedLocalModel, null);
  assert.equal(readOnboarding(db.db)?.status, "done");
  const picked = saveOnboarding(db.db, {
    status: "active",
    stageIndex: 4,
    preferences: { selectedLocalModel: "missing:7b", backgroundExecutionOptIn: false },
  }, { available: true, models: ["qwen2.5-coder:7b"], remoteModels: ["deepseek:cloud"] });
  assert.equal(picked.preferences.selectedLocalModel, null);
  db.close();
});

test("T0R notification decisions use the Host journal, redact, and ignore forged sequences", () => {
  const db = new HostDatabase(":memory:");
  saveNotificationPrefs(db.db, { enabled: true, quietHours: { enabled: true, startHour: 22, endHour: 7 } });
  const event = db.event("task.completed", "task-1", "done C:\\Users\\ada\\notes.txt sk-abcdefghijklmnopqrstuvwxyz");
  const quiet = decideStoredNotification(db.db, { sequence: event.sequence, audience: "workstation", localHour: 23 });
  assert.equal(quiet.decision?.suppressedReason, "quiet_hours");
  assert.equal(quiet.decision?.bannerBody.includes("notes.txt"), false);
  assert.equal(quiet.decision?.bannerBody.includes("sk-"), false);
  saveNotificationPrefs(db.db, { enabled: true });
  const first = decideStoredNotification(db.db, { sequence: event.sequence, audience: "workstation", localHour: 10 });
  assert.equal(first.decision?.deliver, true);
  assert.equal(first.capability.osToast, false);
  assert.equal(first.capability.windowClosedDelivery, false);
  const again = decideStoredNotification(db.db, { sequence: event.sequence, audience: "workstation", localHour: 10 });
  assert.equal(again.decision?.suppressedReason, "duplicate");
  const forged = decideStoredNotification(db.db, { sequence: 999_999, audience: "workstation", localHour: 10 });
  assert.equal(forged.error, "forged_or_unknown_event");
  assert.equal(forged.decision, null);
  db.close();
});

test("T0R Android bridge rejects untrusted pages, extra fields and secrets", () => {
  assert.equal(parseAndroidBridgeMessage({ id: "a", title: "Hi", body: "There", category: "task_completed", command: "reboot" }, true).ok, false);
  assert.equal(parseAndroidBridgeMessage({ id: "a", title: "Hi", body: "There", category: "task_completed" }, false).ok, false);
  const parsed = parseAndroidBridgeMessage({ id: "task_completed:task-1:r1", title: "Path C:\\Users\\ada\\x", body: "Bearer abc.def", category: "task_completed" }, true);
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.title.includes("Users"), false);
    assert.equal(parsed.body.includes("Bearer"), false);
  }
});

test("T0R device status keeps revoked phones visible and does not invent reconnecting", () => {
  const now = 1_700_000_000_000;
  const revoked = deviceStatusPresentation(projectDeviceDiagnostics({ id: "d", name: "Phone", createdAt: now, revoked: true, token: "secret" }, now));
  assert.equal(revoked.label, "Revoked");
  assert.equal(revoked.authority, "revoked");
  const offline = deviceStatusPresentation(projectDeviceDiagnostics({ id: "d", name: "Phone", createdAt: now, lastSeenAt: now - 10 * 60_000, expiresAt: now + 60_000 }, now));
  assert.equal(offline.label, "Offline");
  const live = deviceStatusPresentation(projectDeviceDiagnostics({ id: "d", name: "Phone", createdAt: now, lastSeenAt: now - 1_000, expiresAt: now + 60_000 }, now), "reconnecting");
  assert.equal(live.label, "Reconnecting");
});

test("T0R feedback delete and export survive a new store on the same file", () => {
  const directory = mkdtempSync(join(tmpdir(), "bunny-feedback-"));
  const file = join(directory, "beta-feedback.json");
  try {
    const first = new LocalBetaFeedbackStore({ filePath: file, maxEntries: 2 });
    first.setOptIn(true);
    const saved = first.submit({ now: 10, category: "bug", summary: "ok", details: "token sk-abcdefghijklmnopqrstuvwxyz" });
    assert.equal(saved.details.includes("sk-"), false);
    const preview = first.previewEntry({ now: 11, category: "bug", summary: "C:\\Users\\ada\\a.txt", details: "nope" });
    assert.equal(preview.summary.includes("Users"), false);
    assert.equal(first.deleteEntry(saved.id), true);
    assert.equal(first.list().length, 0);
    first.submit({ now: 12, category: "general", summary: "kept", details: "local" });
    const reopened = new LocalBetaFeedbackStore({ filePath: file });
    assert.equal(reopened.isOptedIn(), true);
    assert.equal(reopened.list().length, 1);
    assert.equal(reopened.exportLocal().entries[0]?.remoteUploadDispatched, false);
    const raw = readFileSync(file, "utf8");
    assert.equal(raw.includes("sk-abcdefghijklmnopqrstuvwxyz"), false);
    reopened.clearHistory();
    assert.equal(new LocalBetaFeedbackStore({ filePath: file }).list().length, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("T0R a short runtime deadline still stops the live task", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bunny-t0r-deadline-"));
  const root = join(directory, "workspace");
  mkdirSync(root);
  const db = new HostDatabase(":memory:");
  let finish: (result: AdapterResult) => void = () => {};
  const containment = new HostContainment({
    diagnosticDirectory: join(directory, "logs"),
    runtimeDirectory: join(directory, "runtime"),
    exit: () => assert.fail("deadline test became fatal"),
  });
  const adapter: ProviderAdapter = {
    id: "claude",
    detect: async () => ({ ...providerBase("claude"), installed: true, authenticated: true, availability: "ready", capabilities: ["text"], models: ["fixture"], current_model: "fixture" }),
    launch: () => ({
      done: new Promise<AdapterResult>((resolve) => { finish = resolve; }),
      stop: async () => finish({ ok: false, output: "", stopped: true }),
    }),
  };
  const tasks = new TaskManager(db, root, [adapter], { containment });
  containment.options.persist = (type, detail, owner) => tasks.emit(db.event(type, owner.taskId ?? null, detail, owner.missionId ?? null));
  const missions = new MissionManager(tasks, { dataDirectory: directory, adapters: [new FilesystemCapability(), new NotificationsCapability(() => {})] });
  try {
    await tasks.discover();
    const task = tasks.submit({ prompt: "Deadline", mode: "fast", constraints: { maxRuntimeMs: 30 } });
    tasks.approve(task.id);
    for (let i = 0; i < 40 && db.get(task.id).state !== "stopped"; i++) await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(db.get(task.id).state, "stopped");
    assert.match(db.get(task.id).stopReason ?? "", /Runtime limit/);
    await missions.close();
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("T0R shutdown clears the runtime deadline and refuses another task", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bunny-t0r-"));
  const root = join(directory, "workspace");
  mkdirSync(root);
  const db = new HostDatabase(":memory:");
  let finish: (result: AdapterResult) => void = () => {};
  const containment = new HostContainment({
    diagnosticDirectory: join(directory, "logs"),
    runtimeDirectory: join(directory, "runtime"),
    exit: () => assert.fail("shutdown test became fatal"),
  });
  const adapter: ProviderAdapter = {
    id: "claude",
    detect: async () => ({ ...providerBase("claude"), installed: true, authenticated: true, availability: "ready", capabilities: ["text"], models: ["fixture"], current_model: "fixture" }),
    launch: () => ({
      done: new Promise<AdapterResult>((resolve) => { finish = resolve; }),
      stop: async () => finish({ ok: false, output: "", stopped: true }),
    }),
  };
  const tasks = new TaskManager(db, root, [adapter], { containment });
  containment.options.persist = (type, detail, owner) => tasks.emit(db.event(type, owner.taskId ?? null, detail, owner.missionId ?? null));
  const missions = new MissionManager(tasks, { dataDirectory: directory, adapters: [new FilesystemCapability(), new NotificationsCapability(() => {})] });
  try {
    await tasks.discover();
    const task = tasks.submit({ prompt: "Hold open", mode: "fast", constraints: { maxRuntimeMs: 20 * 60_000 } });
    tasks.approve(task.id);
    assert.equal(tasks.runtimeTimers.size, 1);
    const result = await missions.close();
    assert.equal(result, undefined);
    assert.equal(tasks.runtimeTimers.size, 0);
    assert.equal(tasks.shutdownState, "complete");
    assert.equal(tasks.sessions.size, 0);
    assert.equal(db.get(task.id).state, "running", "shutdown detaches the session and leaves the restart walk to record the interruption");
    assert.throws(() => tasks.submit({ prompt: "after", mode: "fast" }), /shutting down/);
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
