import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { importClosure } from "./bunny-release.mjs";
import { packageBrowserRuntime } from "./package-browser-runtime.mjs";

test("T6 release closure refuses a cross-app package without its browser API and licenses", () => {
  const root = mkdtempSync(join(tmpdir(), "bunny-t6-closure-"));
  try {
    mkdirSync(join(root, "scripts")); mkdirSync(join(root, "src/lib/bunny-missions"), { recursive: true });
    for (const path of ["Bunny-Host.mjs", "scripts/bunny-tunnel.mjs", "src/lib/bunny-missions/cross-app.ts"]) writeFileSync(join(root, path), "");
    const result = importClosure(root); assert.equal(result.ok, false);
    assert.equal(result.missing.filter(path => path.startsWith("node_modules/")).length, 4);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test("T6 browser dependency export refuses an installed version outside the source lockfile", () => {
  const root = mkdtempSync(join(tmpdir(), "bunny-t6-deps-"));
  try {
    mkdirSync(join(root, "node_modules/playwright"), { recursive: true });
    writeFileSync(join(root, "node_modules/playwright/package.json"), JSON.stringify({ name: "playwright", version: "wrong" }));
    writeFileSync(join(root, "package-lock.json"), JSON.stringify({ packages: { "node_modules/playwright": { version: "pinned", integrity: "fixture" } } }));
    assert.throws(() => packageBrowserRuntime(root, root, join(root, "out")), /does not match pinned/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
