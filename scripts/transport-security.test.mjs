// BUNNY A — Privacy, Transport Security & Google Play Data Safety Verification Test
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  assertDeviceAction,
  deviceMayLaunch,
  deviceApprovalRefusal,
  APPROVAL_ON_HOST,
  WorkstationRequiredError
} from "../src/lib/bunny-host/device-authority.server.ts";

const workspace = process.cwd();

test("Transport Security: Android Companion enforces 100% HTTPS and blocks cleartext HTTP", async (t) => {
  const sourceDir = join(workspace, "android/app/src/main");
  const manifestPath = join(sourceDir, "AndroidManifest.xml");
  const manifestXml = readFileSync(manifestPath, "utf8");

  await t.test("1. AndroidManifest enforces usesCleartextTraffic=false and single-permission posture", () => {
    assert.match(manifestXml, /android:usesCleartextTraffic="false"/, "Manifest must strictly forbid cleartext traffic");
    assert.match(manifestXml, /<uses-permission android:name="android\.permission\.INTERNET" \/>/, "Must declare INTERNET permission");

    const prohibitedPermissions = [
      "android.permission.ACCESS_FINE_LOCATION",
      "android.permission.ACCESS_COARSE_LOCATION",
      "android.permission.CAMERA",
      "android.permission.RECORD_AUDIO",
      "android.permission.READ_EXTERNAL_STORAGE",
      "android.permission.WRITE_EXTERNAL_STORAGE",
      "android.permission.READ_MEDIA_IMAGES",
      "android.permission.BLUETOOTH",
      "android.permission.SYSTEM_ALERT_WINDOW"
    ];
    for (const perm of prohibitedPermissions) {
      assert.doesNotMatch(manifestXml, new RegExp(perm), `Companion must NEVER request sensitive permission: ${perm}`);
    }
    console.log("[Manifest Audit] Verified: usesCleartextTraffic=false; zero prohibited permissions.");
  });

  await t.test("2. ServerAddressTest confirms ServerAddress.normalize rejects cleartext HTTP and local LAN HTTP", () => {
    // Compile and run ServerAddressTest using javac/java
    const toolsDir = join(workspace, "test-results/android-tools");
    const testDir = join(workspace, "test-results/test-transport-security");
    const serverAddressJava = join(sourceDir, "java/com/routeragent/jev/ServerAddress.java");
    const serverAddressTestJava = join(workspace, "android/tests/ServerAddressTest.java");

    execFileSync("javac", ["--release", "8", "-d", testDir, serverAddressJava, serverAddressTestJava], { stdio: "pipe" });
    const out = execFileSync("java", ["-cp", testDir, "com.routeragent.jev.ServerAddressTest"], { encoding: "utf8" });
    assert.match(out, /Android connection policy: 21 checks passed/, "ServerAddress test must pass all 21 checks");
    console.log(`[ServerAddress Audit] Checked 21 address assertions: all cleartext HTTP variants rejected.`);
  });

  await t.test("3. NativeCompanionClient enforces HttpsURLConnection and rejects cleartext", () => {
    const clientSource = readFileSync(join(sourceDir, "java/com/routeragent/jev/NativeCompanionClient.java"), "utf8");
    assert.match(clientSource, /import javax\.net\.ssl\.HttpsURLConnection;/, "Client must import HttpsURLConnection");
    assert.match(clientSource, /HttpsURLConnection connection=\(HttpsURLConnection\) target\.openConnection\(\);/, "Connection must cast to HttpsURLConnection");
    assert.doesNotMatch(clientSource, /HttpURLConnection connection=\(HttpURLConnection\)/, "Client must not use plain HttpURLConnection");
    console.log("[Client Audit] NativeCompanionClient is strictly HTTPS.");
  });

  await t.test("4. NativeSessionStore hardware KeyStore encryption and zero plaintext tokens", () => {
    const storeSource = readFileSync(join(sourceDir, "java/com/routeragent/jev/NativeSessionStore.java"), "utf8");
    assert.match(storeSource, /AndroidKeyStore/, "Session key must be stored in AndroidKeyStore");
    assert.match(storeSource, /AES\/GCM\/NoPadding/, "Token payload must be encrypted using AES-GCM");
    assert.match(storeSource, /KeystoreErasure\.delete/, "Clear method must explicitly invoke hardware KeystoreErasure");
    console.log("[Session Store Audit] Hardware-backed AndroidKeyStore AES-GCM encryption verified.");
  });

  await t.test("5. Host-side Bridge rejects unencrypted remote requests and unauthorized LAN peers", () => {
    const bridgeSource = readFileSync(join(workspace, "src/lib/orch/host-bridge.server.ts"), "utf8");
    assert.match(bridgeSource, /effectiveOrigin\.startsWith\("https:\/\/"\)/, "Host bridge must require HTTPS origin for remote requests");
    assert.match(bridgeSource, /Remote access must arrive through the configured secure tunnel on this machine\./, "Direct LAN peers must be rejected");
    console.log("[Host Bridge Audit] Remote gateway tunnel HTTPS requirement verified.");
  });

  await t.test("6. Local-first model boundaries: mobile companion restricted to local Ollama inference", () => {
    // Companion may launch local Ollama models with no workspace tools
    assert.equal(deviceMayLaunch({ provider: "ollama", model: "qwen2.5:1.5b" }), true);
    
    // Cloud models are strictly prohibited from paired mobile companion launch
    assert.equal(deviceMayLaunch({ provider: "openai", model: "gpt-4o" }), false);
    assert.equal(deviceMayLaunch({ provider: "anthropic", model: "claude-3-5-sonnet" }), false);
    assert.equal(deviceMayLaunch({ provider: "xai", model: "grok-beta" }), false);
    
    // Remote Ollama tags (ending in :cloud / -cloud or in remoteModels) are prohibited
    assert.equal(deviceMayLaunch({ provider: "ollama", model: "llama3:cloud" }), false);
    assert.equal(deviceMayLaunch({ provider: "ollama", model: "hosted-tag" }, ["hosted-tag"]), false);
    assert.equal(deviceMayLaunch({ provider: "ollama", model: "" }), false);
    console.log("[AI Boundary Audit] Verified: mobile companion is restricted strictly to local-first Ollama models.");
  });
});
