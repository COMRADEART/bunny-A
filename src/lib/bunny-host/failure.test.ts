import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import type { ServerResponse } from "node:http";
import {
  classifyFailure,
  HostContainment,
  registerDiagnosticSecret,
  safeError,
  supervisedLoop,
} from "./failure.server.ts";
import { HostDatabase } from "./persistence.server.ts";
import { TaskManager } from "./manager.server.ts";
import { providerBase, spawnSession } from "./adapters.server.ts";
import { streamSse, startHost } from "./http.server.ts";
import type { AdapterResult, ProviderAdapter } from "./contracts.ts";
import { MissionManager } from "../bunny-missions/manager.server.ts";
import { BrowserCapability } from "../bunny-missions/capabilities/browser.server.ts";
import { ComputerCapability } from "../bunny-missions/capabilities/computer.server.ts";
import {
  FilesystemCapability,
  NotificationsCapability,
} from "../bunny-missions/capabilities/local.server.ts";
import { developmentStateDirectory, hostStatePaths } from "./state-paths.server.ts";
import { retryVerdict } from "../bunny-missions/machine.ts";

const wait = (ms = 20) => new Promise<void>((done) => setTimeout(done, ms));
async function until(check: () => boolean) {
  for (let i = 0; i < 150; i++) {
    if (check()) return;
    await wait(10);
  }
  assert.ok(check(), "bounded condition did not arrive");
}
function harness() {
  const directory = mkdtempSync(join(tmpdir(), "bunny-t3-test-"));
  const root = join(directory, "workspace");
  mkdirSync(root);
  const db = new HostDatabase(":memory:");
  let finish!: (result: AdapterResult) => void;
  let reject!: (error: unknown) => void;
  const containment = new HostContainment({
    diagnosticDirectory: join(directory, "logs"),
    runtimeDirectory: join(directory, "runtime"),
    exit: () => assert.fail("operation-local test unexpectedly became fatal"),
  });
  const adapter: ProviderAdapter = {
    id: "claude",
    detect: async () => ({
      ...providerBase("claude"),
      installed: true,
      authenticated: true,
      availability: "ready",
      capabilities: ["text", "filesystem", "terminal"],
      models: ["fixture"],
      current_model: "fixture",
    }),
    launch: () => ({
      done: new Promise<AdapterResult>((resolve, fail) => {
        finish = resolve;
        reject = fail;
      }),
      stop: async () => finish({ ok: false, output: "", stopped: true }),
    }),
  };
  const tasks = new TaskManager(db, root, [adapter], { containment });
  containment.options.persist = (type, detail, owner) =>
    tasks.emit(db.event(type, owner.taskId ?? null, detail, owner.missionId ?? null));
  const missions = new MissionManager(tasks, {
    dataDirectory: directory,
    adapters: [new FilesystemCapability(), new NotificationsCapability(() => {})],
  });
  const cleanup = async () => {
    await missions.close();
    db.close();
    rmSync(directory, { recursive: true, force: true });
  };
  return {
    directory,
    root,
    db,
    containment,
    tasks,
    missions,
    adapter,
    finish: (result: AdapterResult) => finish(result),
    reject: (error: unknown) => reject(error),
    cleanup,
  };
}

test("T3: policy classifies local, subsystem, unknown rejection and uncaught exception by safety", () => {
  assert.deepEqual(classifyFailure("boundary"), {
    failureClass: "OPERATION_FAILURE",
    action: "CONTINUE",
  });
  assert.deepEqual(classifyFailure("boundary", false, "SUBSYSTEM_FAILURE"), {
    failureClass: "SUBSYSTEM_FAILURE",
    action: "DEGRADE",
  });
  assert.equal(classifyFailure("unhandledRejection").action, "CONTROLLED_EXIT");
  assert.equal(classifyFailure("unhandledRejection", true).action, "CONTINUE");
  assert.equal(classifyFailure("uncaughtException", true).action, "CONTROLLED_EXIT");
});
test("T3: serializer handles all rejection shapes, cycles and aggregate causes without invoking accessors", () => {
  const circular: Record<string, unknown> = { privateConnectorPayload: "PRIVATE" };
  circular.self = circular;
  let accessed = false;
  const hostile = Object.create(null);
  Object.defineProperty(hostile, "message", {
    get: () => {
      accessed = true;
      throw new Error("getter");
    },
  });
  const values = [
    new Error("ordinary"),
    new AggregateError([new Error("inner"), circular], "aggregate"),
    "text",
    12,
    null,
    undefined,
    circular,
    hostile,
    new Proxy(
      {},
      {
        getOwnPropertyDescriptor: () => {
          throw 1;
        },
        getPrototypeOf: () => {
          throw 2;
        },
      },
    ),
  ];
  for (const value of values) {
    const serialized = safeError(value);
    assert.equal(typeof serialized.message, "string");
    assert.ok(JSON.stringify(serialized).length < 16000);
    assert.ok(!JSON.stringify(serialized).includes("PRIVATE"));
  }
  assert.equal(accessed, false);
  const error = new Error("x".repeat(20000));
  error.cause = error;
  assert.equal(safeError(error).message.length, 1024);
  assert.ok((safeError(error).stack?.length ?? 0) <= 4096);
});
test("T3: error evidence redacts credentials, headers, cookies, known secrets and environment values", () => {
  const old = process.env.BUNNY_TEST_SECRET;
  process.env.BUNNY_TEST_SECRET = "environment-private-value";
  try {
    const error = new Error(
      'Bearer private-bearer\nAuthorization: Basic private-header\ncookie=session-private\napi_key="private-key" password=private-pass\nenvironment-private-value known-token-value sk-privatekey',
    );
    const encoded = JSON.stringify(safeError(error, ["known-token-value"]));
    for (const secret of [
      "private-bearer",
      "private-header",
      "session-private",
      "private-key",
      "private-pass",
      "environment-private-value",
      "known-token-value",
      "sk-privatekey",
    ])
      assert.ok(!encoded.includes(secret), secret);
  } finally {
    if (old === undefined) delete process.env.BUNNY_TEST_SECRET;
    else process.env.BUNNY_TEST_SECRET = old;
  }
});
test("T3: redaction includes credentials crossing a serializer truncation boundary", () => {
  const secret = "sensitive".repeat(300);
  const encoded = JSON.stringify(safeError("x".repeat(1020) + secret, [secret]));
  assert.ok(!encoded.includes("sensitive"));
});
test("T3: subsystem degradation refuses dependent work and leaves independent tasks eligible", async () => {
  const h = harness();
  try {
    await h.tasks.discover();
    h.containment.degrade("browser", "Browser unavailable.");
    assert.equal(h.tasks.snapshot().health?.operationalState, "degraded");
    assert.throws(() => h.containment.assertAccepting("browser"));
    assert.doesNotThrow(() => h.tasks.submit({ prompt: "Independent text", mode: "fast" }));
    h.containment.degrade("*", "Unknown scope.");
    assert.throws(() => h.tasks.submit({ prompt: "Unsafe", mode: "fast" }));
  } finally {
    await h.cleanup();
  }
});
test("T3: local session rejection fails exactly one task and preserves Host health", async () => {
  const h = harness();
  try {
    await h.tasks.discover();
    const task = h.tasks.submit({ prompt: "Fixture", mode: "fast" });
    h.tasks.approve(task.id);
    h.reject(new Error("Unexpected adapter rejection"));
    await until(() => h.db.get(task.id).state === "failed");
    assert.equal(h.containment.health.operationalState, "healthy");
    assert.equal(
      h.db
        .taskEvents(task.id)
        .filter((event) => /^task\.(failed|completed|stopped)$/.test(event.type)).length,
      1,
    );
    await until(() => !h.tasks.sessions.has(task.id));
  } finally {
    await h.cleanup();
  }
});
test("T3: stale updates cannot produce both completed and failed terminal events", async () => {
  const h = harness();
  try {
    await h.tasks.discover();
    const task = h.tasks.submit({ prompt: "Race", mode: "fast" });
    const running = h.tasks.approve(task.id);
    h.finish({ ok: true, output: "done" });
    await until(() => h.db.get(task.id).state === "completed");
    h.tasks.update(running, { state: "failed" }, "task.failed", "late failure");
    assert.equal(h.db.get(task.id).state, "completed");
    assert.deepEqual(
      h.db
        .taskEvents(task.id)
        .filter((event) => /^task\.(completed|failed|stopped)$/.test(event.type))
        .map((event) => event.type),
      ["task.completed"],
    );
  } finally {
    await h.cleanup();
  }
});
test("T3: user Stop races a rejected session without retry or resurrection", async () => {
  const h = harness();
  try {
    await h.tasks.discover();
    const task = h.tasks.submit({ prompt: "Stop race", mode: "fast" });
    h.tasks.approve(task.id);
    const stopped = h.tasks.stop(task.id);
    h.reject(new Error("failure races stop"));
    await stopped;
    await until(() => !h.tasks.sessions.has(task.id));
    assert.equal(h.db.get(task.id).state, "stopped");
    assert.deepEqual(
      h.db
        .taskEvents(task.id)
        .filter((event) => /^task\.(completed|failed|stopped)$/.test(event.type))
        .map((event) => event.type),
      ["task.stopped"],
    );
  } finally {
    await h.cleanup();
  }
});
test("T3: scheduler failure ends its Mission and leaves an unrelated Mission schedulable", async () => {
  const h = harness();
  try {
    await h.tasks.discover();
    h.missions.configure({ enabled: true }, "fixture");
    await h.missions.bus.refreshHealth();
    const first = h.missions.create({
      objective: "Fail scheduler",
      mode: "fast",
      origin: "test",
      steps: [
        {
          role: "A",
          objective: "notice",
          executor: { kind: "capability", action: "notifications.send", params: { title: "one" } },
        },
      ],
    });
    const other = h.missions.create({
      objective: "Independent",
      mode: "fast",
      origin: "test",
      steps: [
        {
          role: "A",
          objective: "notice",
          executor: { kind: "capability", action: "notifications.send", params: { title: "two" } },
        },
      ],
    });
    const tick = h.missions.tickOnce.bind(h.missions);
    h.missions.tickOnce = async (id) => {
      if (id === first.id) throw new Error("Injected scheduler failure");
      await tick(id);
    };
    h.missions.approve(first.id, "fixture");
    h.missions.approve(other.id, "fixture");
    await until(
      () =>
        h.missions.mission(first.id).state === "failed" &&
        h.missions.mission(other.id).state === "completed",
    );
    assert.equal(h.missions.mission(first.id).failure?.category, "host_failure");
    assert.equal(h.containment.health.operationalState, "healthy");
    await h.missions.tick(first.id);
    assert.equal(h.missions.store.steps(first.id)[0].attempts.length, 0);
    assert.equal(retryVerdict("host_failure", 1, 5, 0, 10).retry, false);
  } finally {
    await h.cleanup();
  }
});
test("T3: capability rejection records a failed run and no fabricated postcondition", async () => {
  const h = harness();
  try {
    h.missions.bus.register({
      manifest: {
        ...new NotificationsCapability(() => {}).manifest,
        id: "fixture",
        actions: [
          { ...new NotificationsCapability(() => {}).manifest.actions[0], id: "fixture.fail" },
        ],
      },
      health: async () => ({ availability: "available", detail: "fixture" }),
      execute: async () => {
        throw new Error("async action exception");
      },
    });
    await h.missions.bus.refreshHealth();
    const result = await h.missions.bus.request({
      action: "fixture.fail",
      params: {},
      missionId: null,
      stepId: null,
      envelope: null,
      origin: "test",
      cwd: h.root,
      roots: [h.root],
      direct: { confirmed: true },
    });
    assert.equal(result.run?.status, "failed");
    assert.equal(result.result?.output, null);
    assert.equal(h.missions.bus.settling.size, 0);
    assert.equal(h.missions.bus.inFlight.size, 0);
    assert.equal(h.containment.health.operationalState, "healthy");
  } finally {
    await h.cleanup();
  }
});
test("T3: malformed capability result cannot strand cancellation or publish success", async () => {
  const h = harness();
  try {
    const adapter = new NotificationsCapability(() => {});
    adapter.execute = async () => null as any;
    h.missions.bus.adapters.set("notifications", adapter);
    await h.missions.bus.refreshHealth();
    const result = await h.missions.bus.request({
      action: "notifications.send",
      params: { title: "fixture" },
      missionId: null,
      stepId: null,
      envelope: null,
      origin: "test",
      cwd: h.root,
      roots: [h.root],
      direct: { confirmed: true },
    });
    assert.equal(result.run?.status, "failed");
    assert.equal(h.missions.bus.settling.size, 0);
    await h.missions.bus.close();
  } finally {
    await h.cleanup();
  }
});
test("T3: browser async action throw is owned by its capability run", async () => {
  const h = harness();
  try {
    const browser = new BrowserCapability(h.directory, { containment: h.containment });
    browser.ensure = async () => {
      throw new Error("browser async fixture");
    };
    browser.health = async () => ({ availability: "available", detail: "fixture" });
    h.missions.bus.register(browser);
    await h.missions.bus.refreshHealth();
    const result = await h.missions.bus.request({
      action: "browser.navigate",
      params: { url: "https://example.com" },
      missionId: null,
      stepId: null,
      envelope: null,
      origin: "test",
      cwd: h.root,
      roots: [h.root],
      direct: { confirmed: true },
    });
    assert.equal(result.run?.status, "failed");
    assert.equal(h.containment.health.operationalState, "healthy");
  } finally {
    await h.cleanup();
  }
});
test("T3: computer UI action exception is failed with no fabricated output", async () => {
  const h = harness();
  try {
    const computer = new ComputerCapability(h.directory);
    computer.execute = async () => {
      throw new Error("UI Automation exception");
    };
    computer.health = async () => ({ availability: "available", detail: "fixture" });
    h.missions.bus.register(computer);
    await h.missions.bus.refreshHealth();
    const result = await h.missions.bus.request({
      action: "computer.list_windows",
      params: {},
      missionId: null,
      stepId: null,
      envelope: null,
      origin: "test",
      cwd: h.root,
      roots: [h.root],
      direct: { confirmed: true },
    });
    assert.equal(result.run?.status, "failed");
    assert.equal(result.result?.output, null);
    assert.equal(h.containment.health.operationalState, "healthy");
  } finally {
    await h.cleanup();
  }
});
test("T13.3 N-C 6: the real adapter certifies dispatched:false only when no provider process started", async () => {
  const h = harness();
  try {
    await h.tasks.discover();
    const task = h.tasks.submit({ prompt: "Fixture", mode: "fast" });
    const node = { command: process.execPath, args: [] as string[], path: process.execPath, source: "fixture", kind: "native" as const };
    const hooks = { event: () => {}, session: () => {}, output: () => {} };
    // 1. The fresh authority check refuses before any process exists.
    const refused = await spawnSession("claude", node, ["-e", "process.exit(0)"], { ...task, cwd: h.root }, { ...hooks, beforeDispatch: async () => { throw new Error("CONNECTION_PAUSED"); } }, "fixture").done;
    assert.equal(refused.ok, false);
    assert.equal(refused.dispatched, false);
    // 2. The executable does not exist: nothing was ever started.
    const missing = { ...node, command: join(h.root, "no-such-provider.exe"), path: join(h.root, "no-such-provider.exe") };
    const absent = await spawnSession("claude", missing, [], { ...task, cwd: h.root }, hooks, "fixture").done;
    assert.equal(absent.ok, false);
    assert.equal(absent.dispatched, false, absent.error);
    // 3. A process that started and then failed is never certified: its outcome may include side effects.
    const started = await spawnSession("claude", node, ["-e", "process.stdin.resume();process.stdin.on('end',()=>process.exit(3))"], { ...task, cwd: h.root }, hooks, "fixture").done;
    assert.equal(started.ok, false);
    assert.equal(started.dispatched, undefined);
    // 4. The unwrapped (non-job) spawn path follows the same rule: only an error before "spawn" certifies nothing started.
    const injected = ((...args: Parameters<typeof spawn>) => spawn(...args)) as typeof spawn;
    const unwrappedAbsent = await spawnSession("claude", missing, [], { ...task, cwd: h.root }, hooks, "fixture", undefined, injected).done;
    assert.equal(unwrappedAbsent.dispatched, false, unwrappedAbsent.error);
    const unwrappedStarted = await spawnSession("claude", node, ["-e", "process.stdin.resume();process.stdin.on('end',()=>process.exit(3))"], { ...task, cwd: h.root }, hooks, "fixture", undefined, injected).done;
    assert.deepEqual([unwrappedStarted.ok, unwrappedStarted.dispatched], [false, undefined]);
    // An "error" event AFTER "spawn" (a failed kill or pipe) is not proof that nothing started.
    let late: ReturnType<typeof spawn> | null = null;
    const lateError = ((...args: Parameters<typeof spawn>) => {
      const child = (late = spawn(...args));
      child.once("spawn", () => setImmediate(() => child.emit("error", new Error("pipe failed after start"))));
      return child;
    }) as typeof spawn;
    const errored = await spawnSession("claude", node, ["-e", "setTimeout(()=>{},300)"], { ...task, cwd: h.root }, hooks, "fixture", undefined, lateError).done;
    assert.deepEqual([errored.ok, errored.dispatched, errored.error], [false, undefined, "pipe failed after start"]);
    if (late!.exitCode === null) await new Promise((resolve) => late!.once("exit", resolve)); // the real child still holds the folder
  } finally {
    await h.cleanup();
  }
});
test("T3: a provider stdout hook throw ends the owned native process as a failed session", async () => {
  const h = harness();
  try {
    await h.tasks.discover();
    const task = h.tasks.submit({ prompt: "Fixture", mode: "fast" });
    const session = spawnSession(
      "claude",
      {
        command: process.execPath,
        args: [],
        path: process.execPath,
        source: "fixture",
        kind: "native",
      },
      [
        "-e",
        "process.stdin.resume();process.stdin.on('end',()=>{console.log('raw output');setInterval(()=>{},1000);});",
      ],
      { ...task, cwd: h.root },
      {
        event: () => {},
        session: () => {},
        output: () => {
          throw new Error("stdout parser hook throw");
        },
      },
      "fixture",
    );
    const result = await session.done;
    assert.equal(result.ok, false);
    assert.match(result.error!, /stdout parser/);
    assert.equal(result.stopped, false);
    assert.ok(session.pid?.());
    await session.stop();
  } finally {
    await h.cleanup();
  }
});
test("T3: provider normalization throw cannot escape the adapter", async () => {
  const h = harness();
  try {
    await h.tasks.discover();
    const task = h.tasks.submit({ prompt: "Fixture", mode: "fast" });
    const hooks = { event: () => {}, session: () => {}, output: () => {} };
    const { ClaudeNormalizer } = await import("./events.ts");
    const normalizer = new ClaudeNormalizer();
    normalizer.normalize = () => {
      throw new Error("normalizer fixture");
    };
    const session = spawnSession(
      "claude",
      {
        command: process.execPath,
        args: [],
        path: process.execPath,
        source: "fixture",
        kind: "native",
      },
      [
        "-e",
        "process.stdin.resume();process.stdin.on('end',()=>{console.log('{}');setInterval(()=>{},1000);});",
      ],
      { ...task, cwd: h.root },
      hooks,
      "fixture",
      normalizer,
    );
    assert.equal((await session.done).ok, false);
  } finally {
    await h.cleanup();
  }
});
test("T3: native provider stream error closes its owned process and unexpected exit cannot succeed", async () => {
  const h = harness();
  try {
    await h.tasks.discover();
    const task = h.tasks.submit({ prompt: "Stream fixture", mode: "fast" });
    const launch = {
      command: process.execPath,
      args: [],
      path: process.execPath,
      source: "fixture",
      kind: "native" as const,
    };
    const hooks = { event: () => {}, session: () => {}, output: () => {} };
    const session = spawnSession(
      "claude",
      launch,
      [
        "-e",
        "process.stdin.resume();process.stdin.on('end',()=>{console.log('ready');setInterval(()=>{},1000);});",
      ],
      { ...task, cwd: h.root },
      hooks,
      "fixture",
      undefined,
      ((...args: Parameters<typeof spawn>) => {
        const child = spawn(...args);
        child.stdout!.once("data", () =>
          child.stdout!.emit("error", new Error("stream fixture failure")),
        );
        return child;
      }) as typeof spawn,
    );
    const result = await session.done;
    assert.equal(result.ok, false);
    assert.match(result.error!, /stream fixture failure/);
    assert.equal(result.stopped, false);
    const exited = spawnSession(
      "claude",
      launch,
      ["-e", "process.exit(23)"],
      { ...task, cwd: h.root },
      hooks,
      "fixture",
    );
    const unexpected = await exited.done;
    assert.equal(unexpected.ok, false);
    assert.equal(unexpected.exitCode, 23);
  } finally {
    await h.cleanup();
  }
});
test("T3: capability rejection fails its Mission within the configured retry ceiling", async () => {
  const h = harness();
  try {
    let executions = 0;
    const adapter = new NotificationsCapability(() => {});
    adapter.execute = async () => {
      executions++;
      throw new Error("mission rejection fixture");
    };
    h.missions.bus.adapters.set("notifications", adapter);
    h.missions.configure({ enabled: true, limits: { maxRetriesPerStep: 1 } }, "fixture");
    await h.missions.bus.refreshHealth();
    const mission = h.missions.create({
      objective: "Bounded failing notice",
      mode: "fast",
      origin: "test",
      steps: [
        {
          role: "Notice",
          objective: "notify",
          executor: {
            kind: "capability",
            action: "notifications.send",
            params: { title: "fixture" },
          },
          maxRetries: 1,
        },
      ],
    });
    h.missions.approve(mission.id, "fixture");
    await until(() => h.missions.mission(mission.id).state === "failed");
    const step = h.missions.store.steps(mission.id)[0];
    assert.ok(executions <= 2);
    assert.equal(step.state, "failed");
    assert.ok(
      h.missions.store
        .runs({ missionId: mission.id, limit: 10 })
        .every((run) => run.status === "failed"),
    );
    assert.equal(h.containment.health.operationalState, "healthy");
  } finally {
    await h.cleanup();
  }
});
test("T3: disabled Missions reconcile interrupted execution without scheduling or resuming", async () => {
  const h = harness();
  try {
    h.missions.configure({ enabled: true }, "fixture");
    await h.missions.bus.refreshHealth();
    const mission = h.missions.create({
      objective: "Interrupted notice",
      mode: "fast",
      origin: "test",
      steps: [
        {
          role: "Notice",
          objective: "notify",
          executor: {
            kind: "capability",
            action: "notifications.send",
            params: { title: "fixture" },
          },
        },
      ],
    });
    h.missions.approve(mission.id, "fixture", false);
    const step = h.missions.store.steps(mission.id)[0];
    h.missions.setMission(h.missions.mission(mission.id), { state: "running" });
    h.missions.setStep(step, { state: "ready" });
    h.missions.setStep(h.missions.store.step(step.id), { state: "running" });
    h.missions.configure({ enabled: false }, "fixture");
    await h.missions.close();
    const restarted = new MissionManager(h.tasks, { dataDirectory: h.directory, adapters: [] });
    assert.equal(restarted.enabled(), false);
    assert.equal(restarted.mission(mission.id).state, "waiting_for_user");
    assert.equal(restarted.store.step(step.id).failure?.category, "host_restart");
    assert.equal(restarted.pending.size, 0);
    await restarted.close();
  } finally {
    await h.cleanup();
  }
});
test("T3: provider discovery rejection marks unknown provider while Host stays healthy", async () => {
  const h = harness();
  try {
    h.adapter.detect = async () => {
      throw new Error("Transient probe");
    };
    await h.tasks.discover();
    assert.equal(h.tasks.providers[0].availability, "unknown");
    assert.equal(h.containment.health.operationalState, "healthy");
  } finally {
    await h.cleanup();
  }
});
test("T3: failed SQLite terminal persistence rolls back task, event and outcome", async () => {
  const h = harness();
  try {
    await h.tasks.discover();
    const task = h.tasks.submit({ prompt: "Atomic", mode: "fast" });
    const running = h.tasks.approve(task.id);
    h.db.db.exec(
      "CREATE TRIGGER fail_outcome BEFORE INSERT ON outcomes BEGIN SELECT RAISE(ABORT,'injected persistence failure'); END;",
    );
    assert.throws(
      () => h.tasks.update(running, { state: "completed" }, "task.completed", "should roll back"),
      /injected/,
    );
    assert.equal(h.db.get(task.id).state, "running");
    assert.equal(
      h.db.taskEvents(task.id).filter((event) => event.type === "task.completed").length,
      0,
    );
    assert.equal(h.db.db.prepare("SELECT COUNT(*) AS n FROM outcomes").get()?.n, 0);
    h.db.db.exec("DROP TRIGGER fail_outcome");
    await h.tasks.stop(task.id);
    await until(() => !h.tasks.sessions.has(task.id));
  } finally {
    await h.cleanup();
  }
});
test("T3: Mission state and event persistence roll back together", async () => {
  const h = harness();
  try {
    h.missions.configure({ enabled: true }, "fixture");
    const mission = h.missions.create({
      objective: "Atomic Mission",
      mode: "fast",
      origin: "test",
    });
    h.db.db.exec(
      "CREATE TRIGGER fail_event BEFORE INSERT ON events WHEN NEW.type='authorization.granted' BEGIN SELECT RAISE(ABORT,'mission persistence failure'); END;",
    );
    assert.throws(
      () =>
        h.missions.setMission(
          mission,
          { state: "ready" },
          "authorization.granted",
          "not committed",
        ),
      /persistence/,
    );
    assert.equal(h.missions.mission(mission.id).state, "waiting_for_approval");
    h.db.db.exec("DROP TRIGGER fail_event");
  } finally {
    await h.cleanup();
  }
});
test("T3: diagnostic persistence failure falls back once and refuses execution globally", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bunny-t3-evidence-"));
  let attempts = 0;
  try {
    const containment = new HostContainment({
      diagnosticDirectory: directory,
      persist: () => {
        attempts++;
        throw new Error("db broken");
      },
    });
    await containment.contain(new Error("api_key=private-value"));
    assert.equal(attempts, 1);
    assert.equal(containment.allows("tasks"), false);
    const evidence = readFileSync(join(directory, "host-failures.jsonl"), "utf8");
    assert.ok(!evidence.includes("private-value"));
    assert.equal(JSON.parse(evidence).type, "host.operation_failed");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
test("T3: SSE write and serialization failure clean up client resources while Host remains healthy", () => {
  for (const serialization of [false, true]) {
    const bus = new EventEmitter();
    const response = new EventEmitter() as ServerResponse;
    Object.assign(response, {
      destroyed: false,
      writableEnded: false,
      write: () => {
        if (!serialization) throw new Error("socket write failed");
        return true;
      },
      destroy: () => {
        Object.assign(response, { destroyed: true });
      },
    });
    const containment = new HostContainment();
    const event: any = { sequence: 1, at: 1, type: "fixture", taskId: null, detail: "" };
    if (serialization) event.self = event;
    streamSse(response, bus, () => [event], 0, containment);
    assert.equal(bus.listenerCount("event"), 0);
    assert.equal(response.destroyed, true);
    assert.equal(containment.health.operationalState, "healthy");
  }
});
test("T3: background timer iterations never overlap and recover with bounded backoff", async () => {
  const containment = new HostContainment();
  let running = 0,
    max = 0,
    iterations = 0;
  const loop = supervisedLoop(
    containment,
    { subsystem: "telemetry" },
    async () => {
      running++;
      max = Math.max(max, running);
      iterations++;
      try {
        await wait(10);
        if (iterations === 1) throw new Error("iteration failure");
      } finally {
        running--;
      }
    },
    5,
  );
  await until(() => iterations >= 3);
  loop.stop();
  assert.equal(max, 1);
  const stopped = iterations;
  await wait(40);
  assert.equal(iterations, stopped);
  assert.equal(containment.health.operationalState, "healthy");
});
test("T3: HTTP unexpected command failure returns safe text and telemetry failure stays local", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bunny-t3-http-"));
  const host = await startHost({
    dataDirectory: directory,
    port: 43142,
    root: directory,
    adapters: [],
    sample: async () => {
      throw new Error("sensor fixture");
    },
  });
  try {
    host.manager.submit = () => {
      throw new Error(`Bearer ${host.token} authorization=PRIVATE`);
    };
    const response = await fetch("http://127.0.0.1:43142/command", {
      method: "POST",
      headers: { authorization: `Bearer ${host.token}`, "content-type": "application/json" },
      body: JSON.stringify({ action: "submit", data: { prompt: "test", mode: "fast" } }),
    });
    const body = await response.text();
    assert.equal(response.status, 400);
    assert.ok(!body.includes(host.token));
    assert.ok(!body.includes("PRIVATE"));
    assert.equal(host.containment.health.operationalState, "healthy");
    host.containment.degrade("*", "fixture");
    const refused = await fetch("http://127.0.0.1:43142/command", {
      method: "POST",
      headers: { authorization: `Bearer ${host.token}`, "content-type": "application/json" },
      body: JSON.stringify({ action: "submit", data: { prompt: "test", mode: "fast" } }),
    });
    assert.equal(refused.status, 503);
    assert.equal(
      (await fetch("http://127.0.0.1:43142/health").then((r) => r.json())).operationalState,
      "degraded",
    );
  } finally {
    await host.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
test("T3: fatal transition is single-winner, refuses new work and has a hard shutdown deadline", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bunny-t3-fatal-"));
  let exits = 0;
  try {
    const containment = new HostContainment({
      diagnosticDirectory: directory,
      runtimeDirectory: directory,
      shutdown: () => new Promise(() => {}),
      shutdownMs: 60,
      exit: (code) => {
        assert.equal(code, 70);
        exits++;
      },
    });
    const winner = containment.fatal(new Error("fatal fixture"));
    assert.equal(containment.health.operationalState, "draining");
    assert.throws(() => containment.assertAccepting("tasks"));
    assert.equal(containment.fatal(new Error("second")), winner);
    await winner;
    assert.equal(exits, 1);
    assert.equal(containment.health.operationalState, "fatal");
    assert.equal(
      readFileSync(join(directory, "host-failures.jsonl"), "utf8")
        .trim()
        .split("\n")
        .filter((line) => JSON.parse(line).type === "host.fatal").length,
      1,
    );
    const restarted = new HostContainment({
      runtimeDirectory: directory,
      diagnosticDirectory: directory,
    });
    restarted.recoverMarker();
    assert.ok(restarted.health.lastFatal);
    assert.equal(restarted.health.operationalState, "healthy");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
test(
  "T3: real source entry contains process rejection and exception without a test global handler",
  { timeout: 20000 },
  async () => {
    for (const kind of ["rejection", "exception"]) {
      const directory = mkdtempSync(join(tmpdir(), "bunny-t3-process-"));
      const entry = fileURLToPath(new URL("entry.server.ts", import.meta.url));
      const script = join(directory, "fixture.mjs");
      writeFileSync(
        script,
        `import {runHostEntry} from ${JSON.stringify(pathToFileURL(entry).href)};\nconst host=await runHostEntry({dataDirectory:${JSON.stringify(directory)},root:${JSON.stringify(directory)},port:43143,adapters:[],sample:async()=>{throw new Error('unavailable sensor');}});\nsetTimeout(()=>{${kind === "rejection" ? "Promise.reject(new Error('process rejection fixture'));" : "throw new Error('process exception fixture');"}},20);\n`,
      );
      try {
        const code = await new Promise<number | null>((done, fail) => {
          const child = spawn(process.execPath, ["--experimental-strip-types", script], {
            windowsHide: true,
            stdio: "ignore",
            env: { ...process.env, BUNNY_STATE_LAYOUT: "", BUNNY_HOST_DATA_DIRECTORY: directory },
          });
          const timer = setTimeout(() => {
            child.kill();
            fail(new Error("fatal process did not exit"));
          }, 10000);
          child.once("error", fail);
          child.once("exit", (code) => {
            clearTimeout(timer);
            done(code);
          });
        });
        assert.equal(code, 70);
        const marker = JSON.parse(readFileSync(join(directory, "runtime/host-fatal.json"), "utf8"));
        assert.equal(marker.failureClass, "HOST_FATAL");
        assert.equal(
          marker.source,
          kind === "rejection" ? "unhandledRejection" : "uncaughtException",
        );
        assert.ok(readdirSync(join(directory, "logs")).includes("host-failures.jsonl"));
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    }
  },
);
test("T3: canonical development defaults never recreate retired repo credentials", () => {
  const root = mkdtempSync(join(tmpdir(), "bunny-t3-state-"));
  try {
    const paths = hostStatePaths(undefined, { LOCALAPPDATA: root });
    assert.equal(paths.data, developmentStateDirectory({ LOCALAPPDATA: root }));
    assert.ok(!paths.credentials.includes(".bunny-a"));
    assert.ok(!paths.diagnostics.includes(".bunny-a"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("T3: Host restart marks active task failed and never claims session recovery", async () => {
  const h = harness();
  try {
    await h.tasks.discover();
    const task = h.tasks.submit({ prompt: "Recovery", mode: "fast" });
    h.tasks.approve(task.id);
    const restarted = new TaskManager(h.db, h.root, [h.adapter], { containment: h.containment });
    assert.equal(restarted.db.get(task.id).state, "failed");
    assert.match(restarted.db.get(task.id).error!, /cannot reattach/);
    assert.equal(restarted.sessions.size, 0);
    h.finish({ ok: true, output: "late" });
    await until(() => !h.tasks.sessions.has(task.id));
    assert.equal(h.db.get(task.id).state, "failed");
  } finally {
    await h.cleanup();
  }
});
test("T3: registered runtime credentials are redacted at every error boundary", () => {
  const secret = "registered-runtime-credential-fixture";
  registerDiagnosticSecret(secret);
  assert.ok(!JSON.stringify(safeError(new Error(secret))).includes(secret));
});
test("T3: fatal drain cannot publish late task success", async () => {
  const h = harness();
  try {
    await h.tasks.discover();
    const task = h.tasks.submit({ prompt: "Late success", mode: "fast" });
    h.tasks.approve(task.id);
    h.containment.health.operationalState = "draining";
    h.containment.health.unavailableSubsystems = ["*"];
    h.finish({ ok: true, output: "late result" });
    await until(() => !h.tasks.sessions.has(task.id));
    assert.equal(h.db.get(task.id).state, "failed");
    assert.equal(
      h.db.taskEvents(task.id).filter((event) => event.type === "task.completed").length,
      0,
    );
  } finally {
    await h.cleanup();
  }
});
test("T3: failed capability terminal event rolls back success before fatal containment", async () => {
  const h = harness();
  try {
    h.containment.options.exit = () => {};
    await h.missions.bus.refreshHealth();
    h.db.db.exec(
      "CREATE TRIGGER reject_cap_success BEFORE INSERT ON events WHEN NEW.type='capability.completed' BEGIN SELECT RAISE(ABORT,'injected terminal event failure'); END;",
    );
    const outcome = await h.missions.bus.request({
      action: "notifications.send",
      params: { title: "fixture" },
      missionId: null,
      stepId: null,
      envelope: null,
      origin: "test",
      cwd: h.root,
      roots: [h.root],
      direct: { confirmed: true },
    });
    assert.equal(outcome.run?.status, "failed");
    assert.equal(h.missions.store.run(outcome.run!.id).status, "failed");
    assert.equal(
      h.db.recentEvents().filter((event) => event.type === "capability.completed").length,
      0,
    );
    await h.containment.fatalExit;
    assert.equal(h.containment.health.operationalState, "fatal");
  } finally {
    await h.cleanup();
  }
});
test("T3: Mission Stop wins over a concurrent rejected capability with no automatic retry", async () => {
  const h = harness();
  try {
    let reject!: (error: Error) => void;
    let executions = 0;
    const adapter = new NotificationsCapability(() => {});
    adapter.execute = async () => {
      executions++;
      return await new Promise((_, fail) => {
        reject = fail;
      });
    };
    h.missions.bus.adapters.set("notifications", adapter);
    h.missions.configure({ enabled: true }, "fixture");
    await h.missions.bus.refreshHealth();
    const mission = h.missions.create({
      objective: "Stop notice",
      mode: "fast",
      origin: "test",
      steps: [
        {
          role: "Notice",
          objective: "notify",
          executor: {
            kind: "capability",
            action: "notifications.send",
            params: { title: "fixture" },
          },
        },
      ],
    });
    h.missions.approve(mission.id, "fixture");
    await until(() => executions === 1);
    const stopping = h.missions.stop(mission.id, "fixture");
    reject(new Error("failure racing Stop"));
    await stopping;
    await wait(30);
    assert.equal(h.missions.mission(mission.id).state, "stopped");
    assert.equal(executions, 1);
    assert.equal(h.missions.store.steps(mission.id)[0].state, "stopped");
    assert.equal(
      h.db
        .missionEvents(mission.id, [])
        .filter((event) => /^mission\.(completed|failed|stopped)$/.test(event.type)).length,
      1,
    );
  } finally {
    await h.cleanup();
  }
});
