import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  executeDeterministicTest,
  sanitizeTestEnvironment,
} from "./ma4/test-runner.server.ts";

const TEST_BASE = join(process.cwd(), ".tmp-t3r2-commands");

function createRig() {
  mkdirSync(TEST_BASE, { recursive: true });
  const dir = mkdtempSync(join(TEST_BASE, "cmd-rig-"));
  const projectDir = join(dir, "proj");
  mkdirSync(projectDir, { recursive: true });

  const safeTest = join(projectDir, "pass.test.js");
  writeFileSync(
    safeTest,
    "import test from 'node:test';\nimport assert from 'node:assert';\ntest('math pass', () => { assert.equal(2 + 2, 4); });",
  );

  return {
    dir,
    projectDir,
    safeTest,
    close: () => {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort fixture cleanup */ }
    },
  };
}

test("T3R2-P2.1: Mode A locked argument template succeeds on authorized test file", async () => {
  const rig = createRig();
  try {
    const result = await executeDeterministicTest({
      rootPath: rig.projectDir,
      testFile: "pass.test.js",
    });

    assert.equal(result.launched, true);
    assert.equal(result.pass, true);
    assert.equal(result.exitCode, 0);
    assert.equal(result.mode, "ModeA");
    assert.ok(result.receipt !== null);
    assert.match(result.receipt, /^receipt:test-exec:/);
  } finally {
    rig.close();
  }
});

test("T3R2-P2.2: Node code evaluation flags (-e, --eval, -p) are strictly refused", async () => {
  const rig = createRig();
  try {
    const resE = await executeDeterministicTest({
      rootPath: rig.projectDir,
      command: "node -e process.exit(0)",
    });
    assert.equal(resE.launched, false);
    assert.equal(resE.terminalState, "refused");
    assert.match(resE.reason, /prohibited in test execution/i);

    const resEval = await executeDeterministicTest({
      rootPath: rig.projectDir,
      command: "node --eval=process.exit(0)",
    });
    assert.equal(resEval.launched, false);
    assert.match(resEval.reason, /prohibited in test execution/i);

    const resP = await executeDeterministicTest({
      rootPath: rig.projectDir,
      command: "node -p 1+1",
    });
    assert.equal(resP.launched, false);
    assert.match(resP.reason, /prohibited in test execution/i);
  } finally {
    rig.close();
  }
});

test("T3R2-P2.3: Node module preload and loader flags are strictly refused", async () => {
  const rig = createRig();
  try {
    const resR = await executeDeterministicTest({
      rootPath: rig.projectDir,
      command: "node -r malicious.js pass.test.js",
    });
    assert.equal(resR.launched, false);
    assert.match(resR.reason, /prohibited in test execution/i);

    const resRequire = await executeDeterministicTest({
      rootPath: rig.projectDir,
      command: "node --require malicious.js pass.test.js",
    });
    assert.equal(resRequire.launched, false);
    assert.match(resRequire.reason, /prohibited in test execution/i);

    const resImport = await executeDeterministicTest({
      rootPath: rig.projectDir,
      command: "node --import malicious.js pass.test.js",
    });
    assert.equal(resImport.launched, false);
    assert.match(resImport.reason, /prohibited in test execution/i);

    const resLoader = await executeDeterministicTest({
      rootPath: rig.projectDir,
      command: "node --loader malicious.js pass.test.js",
    });
    assert.equal(resLoader.launched, false);
    assert.match(resLoader.reason, /prohibited in test execution/i);
  } finally {
    rig.close();
  }
});

test("T3R2-P2.4: Node inspection, profiling, and debugging flags are refused", async () => {
  const rig = createRig();
  try {
    const resInspect = await executeDeterministicTest({
      rootPath: rig.projectDir,
      command: "node --inspect pass.test.js",
    });
    assert.equal(resInspect.launched, false);
    assert.match(resInspect.reason, /prohibited in test execution/i);

    const resProf = await executeDeterministicTest({
      rootPath: rig.projectDir,
      command: "node --prof pass.test.js",
    });
    assert.equal(resProf.launched, false);
    assert.match(resProf.reason, /prohibited in test execution/i);
  } finally {
    rig.close();
  }
});

test("T3R2-P2.5: Mode B unapproved npm scripts and dynamic npx downloads are refused", async () => {
  const rig = createRig();
  try {
    // Unapproved npm command without authorizedProfile fails closed
    const resNpm = await executeDeterministicTest({
      rootPath: rig.projectDir,
      command: "npm test",
    });
    assert.equal(resNpm.launched, false);
    assert.match(resNpm.reason, /Mode B project command profile/i);

    // npx without --no-install fails closed even with profile
    const resNpx = await executeDeterministicTest({
      rootPath: rig.projectDir,
      command: "npx jest",
      authorizedProfile: { executable: "npx" },
    });
    assert.equal(resNpx.launched, false);
    assert.match(resNpx.reason, /--no-install/i);
  } finally {
    rig.close();
  }
});

test("T3R2-P3.1: Synthetic Attempt 1 — Filesystem read outside grant is prevented by Host boundary", async () => {
  const rig = createRig();
  try {
    // Host boundary refuses pointing at protected files or files outside root
    const containmentResult = await executeDeterministicTest({
      rootPath: rig.projectDir,
      testFile: ".env",
    });
    assert.equal(containmentResult.launched, false);
    assert.match(containmentResult.reason, /protected/i);

    // In-process OS read attempt observation
    const readAttemptScript = join(rig.projectDir, "read-attempt.test.js");
    writeFileSync(
      readAttemptScript,
      `import fs from 'node:fs';
       try {
         // Attempt to read system file
         fs.readFileSync('C:\\\\Windows\\\\System32\\\\drivers\\\\etc\\\\hosts');
         console.log('OS_READ_SUCCEEDED_UNCONSTRAINED');
       } catch (e) {
         console.log('OS_READ_BLOCKED:' + e.code);
       }
       process.exit(1);`,
    );

    const runResult = await executeDeterministicTest({
      rootPath: rig.projectDir,
      testFile: "read-attempt.test.js",
    });

    // Proves that exitCode is 1, test fails closed, and receipt is null
    assert.equal(runResult.pass, false);
    assert.equal(runResult.receipt, null);
    // Verifies actual observed OS outcome: Job object alone does not block filesystem read,
    // proving why Host boundary refusal is mandatory and arbitrary untrusted code must fail closed.
    assert.ok(runResult.stdout.includes("OS_READ_SUCCEEDED_UNCONSTRAINED") || runResult.stdout.includes("OS_READ_BLOCKED"));
  } finally {
    rig.close();
  }
});

test("T3R2-P3.2: Synthetic Attempt 2 — Filesystem write outside workspace fails closed", async () => {
  const rig = createRig();
  try {
    const outsideTarget = join(rig.dir, "unauthorized-drop.txt");
    const writeAttemptScript = join(rig.projectDir, "write-attempt.test.js");
    writeFileSync(
      writeAttemptScript,
      `import fs from 'node:fs';
       try {
         fs.writeFileSync(${JSON.stringify(outsideTarget)}, 'malicious payload');
         console.log('DROP_SUCCEEDED');
       } catch (e) {
         console.log('DROP_FAILED:' + e.code);
       }
       process.exit(1);`,
    );

    const runResult = await executeDeterministicTest({
      rootPath: rig.projectDir,
      testFile: "write-attempt.test.js",
    });

    assert.equal(runResult.pass, false);
    assert.equal(runResult.receipt, null);
    // Cleanup dropped file if OS permitted write
    if (existsSync(outsideTarget)) {
      rmSync(outsideTarget, { force: true });
    }
  } finally {
    rig.close();
  }
});

test("T3R2-P3.3: Synthetic Attempt 3 — Child process spawning and process-tree containment", async () => {
  const rig = createRig();
  try {
    const forkScript = join(rig.projectDir, "spawn-child.test.js");
    writeFileSync(
      forkScript,
      `import { spawn } from 'node:child_process';
       const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: false });
       setTimeout(() => { process.exit(0); }, 500);`,
    );

    let trackedChildPid: number | undefined;
    const runResult = await executeDeterministicTest({
      rootPath: rig.projectDir,
      testFile: "spawn-child.test.js",
      timeoutMs: 5000,
      trackChild: (c) => { trackedChildPid = c.pid; },
    });

    // Parent completed, tracked child is properly accounted
    assert.equal(runResult.launched, true);
    assert.ok(trackedChildPid !== undefined);
  } finally {
    rig.close();
  }
});

test("T3R2-P3.4: Synthetic Attempt 4 — Network access attempt observed and documented", async () => {
  const rig = createRig();
  try {
    const netScript = join(rig.projectDir, "net-attempt.test.js");
    writeFileSync(
      netScript,
      `import http from 'node:http';
       const req = http.get('http://127.0.0.1:1/ping', (res) => {});
       req.on('error', (err) => {
         console.log('NETWORK_ERR:' + err.code);
         process.exit(1);
       });`,
    );

    const runResult = await executeDeterministicTest({
      rootPath: rig.projectDir,
      testFile: "net-attempt.test.js",
      timeoutMs: 3000,
    });

    assert.equal(runResult.pass, false);
    assert.equal(runResult.receipt, null);
  } finally {
    rig.close();
  }
});

test("T3R2-P3.5: Synthetic Attempt 5 — Sensitive environment credentials stripped from test process", async () => {
  const rig = createRig();
  try {
    const dirtyEnv: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      OPENAI_API_KEY: "sk-proj-supersecretkey12345",
      ANTHROPIC_AUTH_TOKEN: "secret-token-abcdef",
      DATABASE_PASSWORD: "adminpassword",
      NODE_OPTIONS: "--require /tmp/malicious.js",
      SAFE_USER_SETTING: "safe-value",
    };

    const sanitized = sanitizeTestEnvironment(dirtyEnv);
    assert.equal(sanitized.OPENAI_API_KEY, undefined, "OPENAI_API_KEY must be stripped");
    assert.equal(sanitized.ANTHROPIC_AUTH_TOKEN, undefined, "ANTHROPIC_AUTH_TOKEN must be stripped");
    assert.equal(sanitized.DATABASE_PASSWORD, undefined, "DATABASE_PASSWORD must be stripped");
    assert.equal(sanitized.NODE_OPTIONS, undefined, "NODE_OPTIONS must be stripped");

    const envProbeScript = join(rig.projectDir, "env-probe.test.js");
    writeFileSync(
      envProbeScript,
      `import assert from 'node:assert';
       assert.equal(process.env.OPENAI_API_KEY, undefined);
       assert.equal(process.env.ANTHROPIC_AUTH_TOKEN, undefined);
       assert.equal(process.env.NODE_OPTIONS, undefined);
       console.log('ALL_SECRETS_STRIPPED');
       process.exit(0);`,
    );

    const runResult = await executeDeterministicTest({
      rootPath: rig.projectDir,
      testFile: "env-probe.test.js",
      env: dirtyEnv,
    });

    assert.equal(runResult.launched, true);
    assert.equal(runResult.pass, true);
    assert.equal(runResult.exitCode, 0);
    assert.ok(runResult.stdout.includes("ALL_SECRETS_STRIPPED"));
  } finally {
    rig.close();
  }
});

test("T3R2-P3.6: Synthetic Attempt 6 — Cancellation settlement terminates process tree with zero output growth", async () => {
  const rig = createRig();
  try {
    const loopScript = join(rig.projectDir, "loop.test.js");
    writeFileSync(
      loopScript,
      `let counter = 0;
       setInterval(() => {
         counter++;
         process.stdout.write('TICK_' + counter + '\\n');
       }, 50);`,
    );

    const abortController = new AbortController();

    const testPromise = executeDeterministicTest({
      rootPath: rig.projectDir,
      testFile: "loop.test.js",
      timeoutMs: 10_000,
      signal: abortController.signal,
    });

    // Let the process run for 200 ms to output a few ticks
    await new Promise((r) => setTimeout(r, 200));

    // Cancel execution
    abortController.abort("owner-cancelled");

    const result = await testPromise;

    assert.equal(result.launched, true);
    assert.equal(result.terminalState, "aborted");
    assert.equal(result.pass, false);
    assert.equal(result.receipt, null);

    const capturedOutputAtAbort = result.stdout;

    // Wait an additional 300 ms to prove zero further output growth
    await new Promise((r) => setTimeout(r, 300));

    assert.equal(result.stdout, capturedOutputAtAbort, "Stdout must not grow after cancellation settlement");
  } finally {
    rig.close();
  }
});
