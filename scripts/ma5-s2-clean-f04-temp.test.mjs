import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { providerSource, verdict } from "./ma5-s2/clean-f04-temp.mjs";

// MA5-S2 P4-6: the cleanup removes only proven F04 fixture workspaces. Decoys built from a real fixture are kept.
test("P4-6 the F04 temp cleanup proves ownership and keeps anything that is not exactly the fixture workspace", { skip: process.platform !== "win32" }, () => {
  const base = mkdtempSync(join(tmpdir(), "bunny-p4-clean-test-"));
  try {
    // A workspace as workspace() leaves it: the provider stand-in and a small PE image for the fixture.
    const decoy = (name, change) => {
      const d = join(base, name);
      mkdirSync(d);
      writeFileSync(join(d, "provider.cjs"), providerSource);
      copyFileSync(join(process.env.SystemRoot ?? "C:\Windows", "System32", "whoami.exe"), join(d, "f04-fixture.exe"));
      change?.(d);
      return verdict(d, name);
    };
    assert.equal(decoy("bunny-f04-AbC123"), null, "an intact fixture copy is proven");
    assert.match(decoy("bunny-f04-notmkdtemp"), /name/);
    assert.match(decoy("bunny-f04-AbC124", (d) => writeFileSync(join(d, "notes.txt"), "user file")), /unexpected entry/);
    assert.match(decoy("bunny-f04-AbC125", (d) => writeFileSync(join(d, "provider.cjs"), "edited")), /provider\.cjs/);
    assert.match(decoy("bunny-f04-AbC126", (d) => writeFileSync(join(d, "f04-fixture.exe"), "not a PE")), /PE image/);
    assert.match(decoy("bunny-f04-AbC127", (d) => writeFileSync(join(d, "host.mjs"), "const { spawnSession } = await import(x); cwd: \"C:\\elsewhere\"")), /host\.mjs/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
