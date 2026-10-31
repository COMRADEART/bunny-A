import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { localTest } from "./ma4/task-executors.server.ts";
import { validatePathContainment } from "./ma4/test-runner.server.ts";
import { PersistentTaskRuntime } from "./ma4/task-runtime.server.ts";
import { TaskStore } from "./ma4/task-store.server.ts";
import { HostDatabase } from "./persistence.server.ts";
import { FileRootRegistry } from "./ma4/connectors/files.server.ts";
import { validateTask, type Envelope, type TaskSpec } from "./ma4/task-runtime.ts";

const TEST_BASE = join(process.cwd(), ".tmp-t3r2-roots");

function createRig() {
  mkdirSync(TEST_BASE, { recursive: true });
  const dir = mkdtempSync(join(TEST_BASE, "rig-"));
  const dataDir = join(dir, "data");
  const projectsDir = join(dir, "projects");
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(projectsDir, { recursive: true });

  const dbPath = join(dataDir, "host.db");
  const db = new HostDatabase(dbPath);
  const roots = new FileRootRegistry(db, [dataDir]);
  const store = new TaskStore(db);

  const testProjectDir = join(projectsDir, "authorized-project");
  mkdirSync(testProjectDir, { recursive: true });
  writeFileSync(join(testProjectDir, "math.test.js"), "import test from 'node:test';\nimport assert from 'node:assert';\ntest('ok', () => { assert.equal(1, 1); });");

  roots.set([
    { id: "proj-root", label: "Authorized Project", path: testProjectDir },
  ]);

  const ptasks = new PersistentTaskRuntime({
    store,
    executors: [localTest],
    call: async () => ({ ok: false, error: "Mock call", durationMs: 0 }),
    modelAvailable: async () => true,
    uiAttached: () => true,
    roots,
  });

  return {
    dir,
    dataDir,
    projectsDir,
    testProjectDir,
    db,
    roots,
    store,
    ptasks,
    close: () => {
      try { db.close(); } catch { /* the database may already be closed */ }
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort fixture cleanup */ }
    },
  };
}

test("T3R2-P1.1: Absolute path pointing outside the project is refused", () => {
  const rig = createRig();
  try {
    const res = validatePathContainment(rig.testProjectDir, "C:/Windows/System32/calc.exe");
    assert.equal(res.ok, false);
    assert.match(res.error, /relative to the registered project root/i);
  } finally {
    rig.close();
  }
});

test("T3R2-P1.2: Caller-supplied 'rootPath' is strictly rejected at preflight and execution", async () => {
  const rig = createRig();
  try {
    const envelope: Envelope = {
      capabilities: ["local.test"],
      providers: ["ollama"],
      localOnly: true,
      models: [],
      projectScopes: ["p1"],
      sideEffects: false,
      background: false,
      budgets: { maxModelCalls: 10, maxWallMs: 60_000 },
      expiresAt: Date.now() + 60_000,
      grants: {
        files: [{ root: "proj-root", access: "read" }],
        origins: [],
        services: [],
      },
    };

    const spec: TaskSpec = {
      title: "Adversarial rootPath task",
      projectId: "p1",
      steps: [
        {
          id: "step-test",
          kind: "local.test",
          input: {
            rootPath: "C:/Some/Arbitrary/Path",
            root: "proj-root",
            testFile: "math.test.js",
          },
          model: null,
          maxAttempts: 1,
        },
      ],
      dependsOn: [],
      acceptance: { requiredSteps: ["step-test"], description: "Pass test" },
      deadlineAt: null,
    };

    const problems = validateTask(spec, envelope, rig.ptasks.executorFacts(), Date.now());
    assert.ok(problems.length > 0, "validateTask must reject caller-provided rootPath");
    assert.match(problems.join(" "), /Caller-provided 'rootPath' is forbidden/);

    // Direct executor run also rejects rootPath
    const runResult = await localTest.run(
      { rootPath: "C:/Arbitrary/Path", root: "proj-root", testFile: "math.test.js" },
      {
        taskId: "t1",
        stepId: "step-test",
        attempt: 1,
        idempotencyKey: "t1:step-test",
        model: null,
        signal: new AbortController().signal,
        call: async () => ({ ok: false, error: "Mock call", durationMs: 0 }),
        track: () => {},
        envelope,
        approval: null,
        outputOf: () => null,
        now: () => Date.now(),
        resolveRoot: (r) => rig.ptasks.resolveRoot(r),
      },
    );

    assert.equal(runResult.ok, false);
    assert.match(runResult.error, /Caller-provided 'rootPath' is forbidden/);
  } finally {
    rig.close();
  }
});

test("T3R2-P1.3: Missing registered root identifier fails closed and never defaults to first registered root", async () => {
  const rig = createRig();
  try {
    const envelope: Envelope = {
      capabilities: ["local.test"],
      providers: ["ollama"],
      localOnly: true,
      models: [],
      projectScopes: ["p1"],
      sideEffects: false,
      background: false,
      budgets: { maxModelCalls: 10, maxWallMs: 60_000 },
      expiresAt: Date.now() + 60_000,
      grants: {
        files: [{ root: "proj-root", access: "read" }],
        origins: [],
        services: [],
      },
    };

    const runResult = await localTest.run(
      { testFile: "math.test.js" }, // No root specified!
      {
        taskId: "t1",
        stepId: "step-test",
        attempt: 1,
        idempotencyKey: "t1:step-test",
        model: null,
        signal: new AbortController().signal,
        call: async () => ({ ok: false, error: "Mock call", durationMs: 0 }),
        track: () => {},
        envelope,
        approval: null,
        outputOf: () => null,
        now: () => Date.now(),
        resolveRoot: (r) => rig.ptasks.resolveRoot(r),
      },
    );

    assert.equal(runResult.ok, false);
    assert.equal("fatal" in runResult ? runResult.fatal : undefined, "PERMISSION_DENIED");
    assert.match(runResult.error, /No registered root was specified/i);
  } finally {
    rig.close();
  }
});

test("T3R2-P1.4: Registered root without envelope grant fails closed", async () => {
  const rig = createRig();
  try {
    const envelope: Envelope = {
      capabilities: ["local.test"],
      providers: ["ollama"],
      localOnly: true,
      models: [],
      projectScopes: ["p1"],
      sideEffects: false,
      background: false,
      budgets: { maxModelCalls: 10, maxWallMs: 60_000 },
      expiresAt: Date.now() + 60_000,
      grants: {
        files: [], // Zero grants!
        origins: [],
        services: [],
      },
    };

    const runResult = await localTest.run(
      { root: "proj-root", testFile: "math.test.js" },
      {
        taskId: "t1",
        stepId: "step-test",
        attempt: 1,
        idempotencyKey: "t1:step-test",
        model: null,
        signal: new AbortController().signal,
        call: async () => ({ ok: false, error: "Mock call", durationMs: 0 }),
        track: () => {},
        envelope,
        approval: null,
        outputOf: () => null,
        now: () => Date.now(),
        resolveRoot: (r) => rig.ptasks.resolveRoot(r),
      },
    );

    assert.equal(runResult.ok, false);
    assert.equal("fatal" in runResult ? runResult.fatal : undefined, "PERMISSION_DENIED");
    assert.match(runResult.error, /Folder "proj-root" is not authorized by the task envelope/);
  } finally {
    rig.close();
  }
});

test("T3R2-P1.5: Relative '..' path traversal is strictly refused", () => {
  const rig = createRig();
  try {
    const res = validatePathContainment(rig.testProjectDir, "../../secret.txt");
    assert.equal(res.ok, false);
    assert.match(res.error, /traversal components/i);
  } finally {
    rig.close();
  }
});

test("T3R2-P1.6: Windows drive-qualified path is strictly refused", () => {
  const rig = createRig();
  try {
    const res = validatePathContainment(rig.testProjectDir, "D:\\data\\test.js");
    assert.equal(res.ok, false);
    assert.match(res.error, /relative to the registered project root/i);
  } finally {
    rig.close();
  }
});

test("T3R2-P1.7: UNC network share path is strictly refused", () => {
  const rig = createRig();
  try {
    const res = validatePathContainment(rig.testProjectDir, "\\\\attacker\\share\\test.js");
    assert.equal(res.ok, false);
    assert.match(res.error, /relative to the registered project root/i);
  } finally {
    rig.close();
  }
});

test("T3R2-P1.8: Windows device names and 8.3 short names are strictly refused", () => {
  const rig = createRig();
  try {
    const resDevice = validatePathContainment(rig.testProjectDir, "CON.test.js");
    assert.equal(resDevice.ok, false);
    assert.match(resDevice.error, /Reserved device name/i);

    const resNul = validatePathContainment(rig.testProjectDir, "NUL");
    assert.equal(resNul.ok, false);
    assert.match(resNul.error, /Reserved device name/i);

    const res83 = validatePathContainment(rig.testProjectDir, "PROGRA~1/test.js");
    assert.equal(res83.ok, false);
    assert.match(res83.error, /Short \(8\.3\) names are refused/i);
  } finally {
    rig.close();
  }
});

test("T3R2-P1.9: Symbolic link escaping root directory is strictly refused", () => {
  const rig = createRig();
  try {
    const outsideTarget = join(rig.dir, "outside-secret.test.js");
    writeFileSync(outsideTarget, "process.exit(0);");

    const linkPath = join(rig.testProjectDir, "link.test.js");
    let linkCreated = false;
    try {
      symlinkSync(outsideTarget, linkPath);
      linkCreated = true;
    } catch {
      // If OS privilege lacks symlink creation in unprivileged context
    }

    if (linkCreated) {
      const res = validatePathContainment(rig.testProjectDir, "link.test.js");
      assert.equal(res.ok, false);
      assert.match(res.error, /symbolic link|escapes/i);
    }
  } finally {
    rig.close();
  }
});

test("T3R2-P1.10: Resource revoked while queued fails closed", async () => {
  const rig = createRig();
  try {
    // Revoke the root by removing it from the registry
    rig.roots.set([]);

    const envelope: Envelope = {
      capabilities: ["local.test"],
      providers: ["ollama"],
      localOnly: true,
      models: [],
      projectScopes: ["p1"],
      sideEffects: false,
      background: false,
      budgets: { maxModelCalls: 10, maxWallMs: 60_000 },
      expiresAt: Date.now() + 60_000,
      grants: {
        files: [{ root: "proj-root", access: "read" }],
        origins: [],
        services: [],
      },
    };

    const runResult = await localTest.run(
      { root: "proj-root", testFile: "math.test.js" },
      {
        taskId: "t1",
        stepId: "step-test",
        attempt: 1,
        idempotencyKey: "t1:step-test",
        model: null,
        signal: new AbortController().signal,
        call: async () => ({ ok: false, error: "Mock call", durationMs: 0 }),
        track: () => {},
        envelope,
        approval: null,
        outputOf: () => null,
        now: () => Date.now(),
        resolveRoot: (r) => rig.ptasks.resolveRoot(r),
      },
    );

    assert.equal(runResult.ok, false);
    assert.equal("fatal" in runResult ? runResult.fatal : undefined, "VALIDATION");
    assert.match(runResult.error, /not registered on this PC or its registration has been revoked/i);
  } finally {
    rig.close();
  }
});

test("T3R2-P1.11: Resource deleted on disk between validation and execution fails closed", async () => {
  const rig = createRig();
  try {
    // Physically delete the directory on disk
    rmSync(rig.testProjectDir, { recursive: true, force: true });

    const envelope: Envelope = {
      capabilities: ["local.test"],
      providers: ["ollama"],
      localOnly: true,
      models: [],
      projectScopes: ["p1"],
      sideEffects: false,
      background: false,
      budgets: { maxModelCalls: 10, maxWallMs: 60_000 },
      expiresAt: Date.now() + 60_000,
      grants: {
        files: [{ root: "proj-root", access: "read" }],
        origins: [],
        services: [],
      },
    };

    const runResult = await localTest.run(
      { root: "proj-root", testFile: "math.test.js" },
      {
        taskId: "t1",
        stepId: "step-test",
        attempt: 1,
        idempotencyKey: "t1:step-test",
        model: null,
        signal: new AbortController().signal,
        call: async () => ({ ok: false, error: "Mock call", durationMs: 0 }),
        track: () => {},
        envelope,
        approval: null,
        outputOf: () => null,
        now: () => Date.now(),
        resolveRoot: (r) => rig.ptasks.resolveRoot(r),
      },
    );

    assert.equal(runResult.ok, false);
    assert.equal("fatal" in runResult ? runResult.fatal : undefined, "VALIDATION");
    assert.match(runResult.error, /not registered on this PC or its registration has been revoked|does not exist/i);
  } finally {
    rig.close();
  }
});
