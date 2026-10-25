import test from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildProvenanceRecord,
  generateSbom,
  inspectAndroidReleaseArtifact,
  inspectWindowsReleaseArtifact,
} from "./bunny-sbom-provenance.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("T4-SBOM-1: generateSbom produces deterministic SBOM digest and zero copyleft production dependencies", () => {
  const sbomA = generateSbom(repoRoot);
  const sbomB = generateSbom(repoRoot);
  assert.equal(sbomA.schema, "bunny-sbom/1");
  assert.equal(sbomA.sbomSha256, sbomB.sbomSha256);
  assert.ok(sbomA.counts.directDependencies >= 10);
  assert.ok(sbomA.counts.productionLockComponents >= 100);
  assert.equal(sbomA.counts.standaloneHostRuntimePackages, 1);
  assert.equal(sbomA.counts.copyleftCount, 0);
  const zodEntry = sbomA.components.find((c) => c.name === "zod");
  assert.ok(zodEntry);
  assert.equal(zodEntry.bundledInStandaloneHost, true);
});

test("T4-ANDROID-1: inspectAndroidReleaseArtifact verifies AndroidManifest hardening and honest signing status", () => {
  delete process.env.BUNNY_ANDROID_RELEASE_KEYSTORE;
  const android = inspectAndroidReleaseArtifact(repoRoot);
  assert.equal(android.packageId, "com.routeragent.jev");
  assert.equal(android.versionCode, 3);
  assert.equal(android.versionName, "2.1");
  assert.equal(android.minSdkVersion, 26);
  assert.equal(android.targetSdkVersion, 35);
  assert.equal(android.securityHardening.allowBackup, false);
  assert.equal(android.securityHardening.usesCleartextTraffic, false);
  assert.deepEqual([...android.securityHardening.permissions].sort(), [
    "android.permission.INTERNET",
    "android.permission.POST_NOTIFICATIONS",
  ]);
  // Errata: the MA2/T4 internet-only claim is false after the notification permission was declared.
  assert.equal(android.securityHardening.leastPrivilegeInternetOnly, false);
  assert.equal(android.securityHardening.matchesDeclaredAllowlist, true);
  assert.equal(android.signing.productionReleaseGate, "BLOCKED");
  assert.ok(["UNSIGNED", "TEST_SIGNED"].includes(android.signing.status));
});

test("T4-WINDOWS-1: inspectWindowsReleaseArtifact never fabricates a trusted Authenticode signature", () => {
  delete process.env.BUNNY_WINDOWS_AUTHENTICODE_THUMBPRINT;
  const win = inspectWindowsReleaseArtifact(null);
  assert.equal(win.signing.status, "UNSIGNED");
  assert.equal(win.signing.productionReleaseGate, "BLOCKED");
  assert.ok(win.signing.blockerReason.includes("Authenticode"));
});

test("T4-PROV-1: buildProvenanceRecord combines git SHA, SBOM digest, and platform signing gates", () => {
  const rec = buildProvenanceRecord({ repoRoot });
  assert.equal(rec.schema, "bunny-provenance/1");
  assert.match(rec.git.commit, /^[0-9a-f]{40}$/);
  assert.match(rec.sbom.sbomSha256, /^[0-9a-f]{64}$/);
  assert.equal(rec.windows.signing.productionReleaseGate, "BLOCKED");
  assert.equal(rec.android.signing.productionReleaseGate, "BLOCKED");
});
