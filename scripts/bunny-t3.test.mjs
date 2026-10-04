import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { superviseTunnel } from "./bunny-tunnel-worker.mjs";
import { HostContainment } from "../src/lib/bunny-host/failure.server.ts";
import { tunnelPaths } from "./bunny-tunnel-paths.mjs";

test("T3: disposable tunnel worker crash has three bounded attempts and no Host failure", async () => {
  let launches = 0,
    unavailable = 0;
  const containment = new HostContainment();
  const result = await superviseTunnel({
    start: () => {
      launches++;
      return spawn(process.execPath, ["-e", "process.exit(12)"], {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    },
    output: () => {},
    unavailable: async () => {
      unavailable++;
    },
    containment,
    delayMs: 5,
  });
  assert.equal(launches, 3);
  assert.equal(unavailable, 3);
  assert.equal(result.recoveryRequired, true);
  assert.equal(containment.health.operationalState, "healthy");
});
test("T3: tunnel output callback rejection is contained and marks transport unavailable", async () => {
  const containment = new HostContainment();
  let unavailable = false;
  const result = await superviseTunnel({
    start: () =>
      spawn(process.execPath, ["-e", "console.log('fixture');setInterval(()=>{},1000)"], {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      }),
    output: async () => {
      throw new Error("fixture callback failure");
    },
    unavailable: async () => {
      unavailable = true;
    },
    containment,
    maxAttempts: 1,
  });
  assert.equal(result.attempts, 1);
  assert.equal(unavailable, true);
  assert.equal(containment.health.operationalState, "degraded");
  assert.deepEqual(containment.health.unavailableSubsystems, ["tunnel"]);
  assert.doesNotThrow(() => containment.assertAccepting("tasks"));
});
test("T3: cancelling tunnel backoff never revives stopped work", async () => {
  const controller = new AbortController();
  let launches = 0;
  const result = await superviseTunnel({
    start: () => {
      launches++;
      return spawn(process.execPath, ["-e", "process.exit(1)"], {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    },
    output: () => {},
    unavailable: async () => controller.abort(),
    signal: controller.signal,
    delayMs: 5,
  });
  assert.equal(launches, 1);
  assert.equal(result.recoveryRequired, false);
});
test("T3: tunnel development state has no retired checkout fallback", () => {
  const temporary = mkdtempSync(join(tmpdir(), "bunny-t3-tunnel-paths-"));
  try {
    const paths = tunnelPaths({ LOCALAPPDATA: temporary }, process.cwd());
    assert.equal(paths.root, join(temporary, "Bunny-A/development"));
    assert.ok(!paths.credentials.includes(".bunny-a"));
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
test("T3: installed entry uses actual global policy and launcher has no crash retry loop", () => {
  const entry = readFileSync(new URL("../install/Bunny-Host.mjs", import.meta.url), "utf8");
  assert.match(entry, /runHostEntry/);
  const policy = readFileSync(
    new URL("../src/lib/bunny-host/entry.server.ts", import.meta.url),
    "utf8",
  );
  assert.match(policy, /installProcessHandlers/);
  const launcher = readFileSync(
    new URL("../install/Start-Bunny-Release.ps1", import.meta.url),
    "utf8",
  );
  assert.equal((launcher.match(/\$hostProcess=Start-Process/g) ?? []).length, 1);
  assert.match(launcher, /if\(\$hostProcess.HasExited\) \{throw/);
  assert.doesNotMatch(launcher, /while\s*\(\$true\)/i);
});
test("T3: every retired credential launcher refuses before starting a process or creating state", () => {
  for (const file of [
    "start-bunny-gateway.ps1",
    "start-bunny-island.ps1",
    "start-bunny-remote.ps1",
    "restart-bunny-host.ps1",
  ]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.match(source, /retired/i);
    assert.doesNotMatch(source, /Start-Process|New-Item|WriteAllText|Set-Content/);
  }
  for (const file of [
    "start-bunny-host.ps1",
    "validate-bunny-agents.mjs",
    "validate-bunny-real-host.mjs",
    "stop-bunny-host.mjs",
  ])
    assert.ok(!readFileSync(new URL(file, import.meta.url), "utf8").includes(".bunny-a"));
});
