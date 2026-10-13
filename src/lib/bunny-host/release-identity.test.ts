import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { releaseIdentity } from "./release-identity.server.ts";
test("T5: installed dashboard and Host identities use manifest evidence, not inferred SHAs", () => {
  const root = mkdtempSync(join(tmpdir(), "bunny-build-identity-"));
  try {
    const path = join(root, "release-manifest.json"),
      manifest = {
        release: "fixture",
        version: "test",
        sourceCommit: "a".repeat(40),
        toolingCommit: "b".repeat(40),
        builtAt: "2026-01-01",
        dashboard: {
          sourceCommit: "a".repeat(40),
          builtAt: "2026-01-01",
          assetManifestSha256: "c".repeat(64),
          assets: 2,
        },
      };
    const content = JSON.stringify(manifest);
    writeFileSync(path, content);
    assert.deepEqual(releaseIdentity(path), {
      ...manifest,
      manifestSha256: createHash("sha256").update(content).digest("hex"),
    });
    assert.equal(releaseIdentity(join(root, "missing.json")), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
