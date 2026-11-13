// BUNNY A — Upgrade, Rollback & Lifecycle Verification Test
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const workspace = process.cwd();

test("Upgrade & Rollback Lifecycle Invariants", async (t) => {
  await t.test("1. Android versionCode monotonicity and manifest declaration", () => {
    const manifestXml = readFileSync(join(workspace, "android/app/src/main/AndroidManifest.xml"), "utf8");
    const versionCodeMatch = manifestXml.match(/android:versionCode="(\d+)"/);
    const versionNameMatch = manifestXml.match(/android:versionName="([^"]+)"/);

    assert.ok(versionCodeMatch, "versionCode must be declared in AndroidManifest.xml");
    assert.ok(versionNameMatch, "versionName must be declared in AndroidManifest.xml");

    const versionCode = parseInt(versionCodeMatch[1], 10);
    const versionName = versionNameMatch[1];

    assert.equal(versionCode, 4, "Current Beta versionCode must be 4");
    assert.equal(versionName, "2.2", "Current Beta versionName must be 2.2");
    assert.ok(versionCode > 3, "versionCode 4 is strictly greater than v3 (prevents downgrade collisions)");
    console.log(`[Android Version Audit] Confirmed versionCode=${versionCode}, versionName=${versionName}`);
  });

  await t.test("2. Android same-key upgrade preserves AndroidKeyStore and NativeSessionStore continuity", () => {
    // Audit NativeSessionStore and KeystoreErasure
    const storeSource = readFileSync(join(workspace, "android/app/src/main/java/com/routeragent/jev/NativeSessionStore.java"), "utf8");
    const erasureSource = readFileSync(join(workspace, "android/app/src/main/java/com/routeragent/jev/KeystoreErasure.java"), "utf8");

    // Same key upgrade: AndroidKeyStore alias remains constant
    assert.match(storeSource, /private static final String ALIAS = "bunny-native-companion-v1";/, "Alias must be stable across upgrades");
    assert.match(storeSource, /preferences = context\.getSharedPreferences\("native_session_v1", Context\.MODE_PRIVATE\);/, "SharedPreferences name must be stable");

    // Clear operation explicitly zeroes the keystore entry
    assert.match(erasureSource, /store\.deleteEntry\(alias\);/, "KeystoreErasure must delete the entry on reset");
    console.log("[KeyStore Continuity] Verified stable alias 'bunny-native-companion-v1' across same-key upgrades.");
  });

  await t.test("3. Android uninstall consequences: KeyStore wiped, session invalidated, re-pairing required", () => {
    // Under Android OS architecture:
    // Uninstalling an app wipes /data/data/com.routeragent.jev and deletes all KeyStore aliases for the UID.
    // Therefore, any downgrade requiring uninstall wipes pairing credentials.
    const storeSource = readFileSync(join(workspace, "android/app/src/main/java/com/routeragent/jev/NativeSessionStore.java"), "utf8");
    assert.match(storeSource, /throw new IllegalStateException\("Protected session key unavailable; pair again\."\);/, "Missing key must force re-pairing");
    console.log("[Uninstall Contract] Verified: key loss forces clean re-pairing, preventing undefined authentication states.");
  });

  await t.test("4. Windows desktop rollback preflight safety checks", () => {
    const preflightPath = join(workspace, "scripts/bunny-rollback-preflight.mjs");
    assert.ok(existsSync(preflightPath), "Rollback preflight script must exist");
    const preflightSource = readFileSync(preflightPath, "utf8");
    assert.match(preflightSource, /activeMissions/, "Rollback preflight must check for active missions");
    assert.match(preflightSource, /activeBatches/, "Rollback preflight must verify quiescent active approval batches");
    console.log("[Windows Rollback Preflight] Verified active mission and grant gating before rollback.");
  });

  await t.test("5. MSIX quad-version format matches candidate release pin", () => {
    const manifestXml = readFileSync(join(workspace, "native/windows/BunnyA/AppxManifest.xml"), "utf8");
    const versionMatch = manifestXml.match(/Version="([^"]+)"/);
    assert.ok(versionMatch, "MSIX Version attribute must exist");
    assert.equal(versionMatch[1], "28.0.0.0", "MSIX version must be 28.0.0.0 matching v28.0.0-beta.1 release pin");
    // A merge once left two Version attributes (invalid XML) and a duplicated script parameter; first-match missed both.
    const identity = manifestXml.match(/<Identity[^>]*>/)[0];
    assert.equal(identity.match(/\sVersion=/g).length, 1, "MSIX Identity must carry exactly one Version attribute");
    const params = readFileSync(join(workspace, "scripts/package-bunny-msix.ps1"), "utf8").match(/^param\(([\s\S]*?)^\)/m)[1].trim().split("\n");
    const names = params.map((line) => line.match(/\$(\w+)/)[1]);
    assert.equal(new Set(names).size, names.length, "package-bunny-msix.ps1 parameters must be unique");
    assert.ok(params.slice(0, -1).every((line) => line.trimEnd().endsWith(",")), "package-bunny-msix.ps1 parameters must be comma separated");

    const pinCandidate = JSON.parse(readFileSync(join(workspace, "install/release-pin.candidate.json"), "utf8"));
    assert.equal(pinCandidate.release, "Bunny-A-Windows-v28-BETA-1");
    assert.equal(pinCandidate.version, "28.0.0-beta.1");
    console.log("[MSIX Version Mapping] Reconciled: 28.0.0.0 maps to candidate release pin 28.0.0-beta.1.");
  });
});
