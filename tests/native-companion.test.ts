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

// R1R2: former tests 4–7 were removed. 4–6 asserted on local variables (no product code ran); 7 was a source regex.
// Keystore erasure is now exercised against real java.security.KeyStore behaviour in android/tests/KeystoreErasureTest.java
// (run by scripts/build-android.ps1 in CI). Physical Android Keystore deletion remains NOT TESTED.

// MA5-S1: former test 8 asserted, by source text, that the WebView MainActivity stayed the launcher. The launcher is now
// the native companion; android/tests/ManifestLauncherTest.java parses the manifest as XML and resolves the one launcher
// to NativeCompanionActivity, and scripts/build-android.ps1 checks the same on the signed APK (CI: native-android-preview).

test("Android Companion 9 (source check): session storage source uses AES/GCM and no plaintext token key", () => {
  const storeSource = readFileSync(join(process.cwd(), "android/app/src/main/java/com/routeragent/jev/NativeSessionStore.java"), "utf8");
  assert.match(storeSource, /AES\/GCM\/NoPadding/, "Must use AES/GCM encryption for stored session tokens");
  assert.doesNotMatch(storeSource, /preferences\.edit\(\)\.putString\("token"/, "Plaintext token must never be written to SharedPreferences");
});
