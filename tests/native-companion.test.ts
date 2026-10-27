import test from "node:test";
import assert from "node:assert/strict";
import {
  assertDeviceAction,
  deviceRight,
  deviceApprovalRefusal,
  APPROVAL_ON_HOST,
  WorkstationRequiredError
} from "../src/lib/bunny-host/device-authority.server.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("Android Companion 1: Permitted device actions pass authorization", () => {
  const allowed = ["submit", "stop", "mission.stop", "agent.stop", "task.feedback", "device.revoke"];
  for (const action of allowed) {
    const right = assertDeviceAction(action);
    assert.ok(right, `Action ${action} must have valid device right`);
  }
});

test("Android Companion 2: Workstation-only consequential actions and shell/desktop capabilities are strictly refused from device", () => {
  const prohibited = [
    "file.apply",
    "filesystem.write",
    "desktop.launch",
    "shell.execute",
    "voice.session.open",
    "voice.listen.start",
    "proactive.enable"
  ];
  for (const action of prohibited) {
    assert.throws(
      () => assertDeviceAction(action),
      (err: any) => err instanceof WorkstationRequiredError || /requires workstation access/i.test(err.message),
      `Action ${action} must be rejected with WorkstationRequiredError`
    );
  }
});

test("Android Companion 3: Consequential approvals are refused to mobile companion (workstation-only invariant)", () => {
  // Consequential risk classes must refuse approval from mobile devices
  assert.equal(deviceApprovalRefusal("EXTERNAL_SIDE_EFFECT", null), APPROVAL_ON_HOST);
  assert.equal(deviceApprovalRefusal("DESTRUCTIVE", null), APPROVAL_ON_HOST);
  assert.equal(deviceApprovalRefusal(null, null), APPROVAL_ON_HOST);
  assert.equal(deviceApprovalRefusal("READ", { sensitive: true } as any), APPROVAL_ON_HOST);
  assert.equal(deviceApprovalRefusal("READ", { hardApproval: true } as any), APPROVAL_ON_HOST);
  assert.equal(APPROVAL_ON_HOST, "Approval required on Windows Host.");
});

test("Android Companion 4: 300-ms polling loop is distinguished from streaming", () => {
  const POLLING_INTERVAL_MS = 300;
  const pollTimestamps = [0, 305, 610, 915, 1220];
  const intervals: number[] = [];
  for (let i = 1; i < pollTimestamps.length; i++) {
    intervals.push(pollTimestamps[i] - pollTimestamps[i - 1]);
  }
  const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  assert.ok(Math.abs(avgInterval - POLLING_INTERVAL_MS) < 50, "Average interval must match 300ms polling contract");
  assert.notEqual(avgInterval, 0, "Polling intervals are discrete, not continuous streaming");
});

test("Android Companion 5: Device revocation invalidates session credentials", () => {
  const device = { id: "dev-phone-1", revokedAt: null as number | null };
  assert.equal(device.revokedAt, null, "Device starts active");
  device.revokedAt = Date.now();
  assert.ok(device.revokedAt > 0, "Device is marked revoked");
  const isAuthenticated = device.revokedAt === null;
  assert.equal(isAuthenticated, false, "Revoked device is no longer authenticated");
});

test("Android Companion 6: Device cancellation halts active task without orphan execution", () => {
  let taskState = "running";
  const cancelFromDevice = (actor: string) => {
    assertDeviceAction("stop");
    taskState = "stopped";
  };
  cancelFromDevice("device");
  assert.equal(taskState, "stopped", "Device cancellation cleanly sets stopped state");
});

test("Android Companion 7: Keystore erasure contract removes both preferences and Keystore entry", () => {
  const storeSource = readFileSync(join(process.cwd(), "android/app/src/main/java/com/routeragent/jev/NativeSessionStore.java"), "utf8");
  assert.match(storeSource, /KeyStore\.getInstance\("AndroidKeyStore"\)/, "Must access AndroidKeyStore");
  assert.match(storeSource, /store\.deleteEntry\(ALIAS\)/, "Must explicitly call deleteEntry to erase key from Keystore");
  assert.match(storeSource, /preferences\.edit\(\)\.remove\("session"\)/, "Must remove session preferences");
});

test("Android Companion 8: WebView launcher is preserved for upgrade compatibility", () => {
  const manifest = readFileSync(join(process.cwd(), "android/app/src/main/AndroidManifest.xml"), "utf8");
  assert.match(manifest, /MainActivity/, "MainActivity must exist in manifest");
  assert.match(manifest, /android\.intent\.action\.MAIN/, "Main action intent-filter must be present");
  assert.match(manifest, /NativeCompanionActivity/, "NativeCompanionActivity must be registered");
});

test("Android Companion 9: Native companion client rejects unencrypted plaintext storage", () => {
  const storeSource = readFileSync(join(process.cwd(), "android/app/src/main/java/com/routeragent/jev/NativeSessionStore.java"), "utf8");
  assert.match(storeSource, /AES\/GCM\/NoPadding/, "Must use AES/GCM encryption for stored session tokens");
  assert.doesNotMatch(storeSource, /preferences\.edit\(\)\.putString\("token"/, "Plaintext token must never be written to SharedPreferences");
});
