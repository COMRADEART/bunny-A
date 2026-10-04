import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

export type FailureClass =
  "OPERATION_FAILURE" | "SUBSYSTEM_FAILURE" | "HOST_DEGRADED" | "HOST_FATAL";
export type FailureAction = "CONTINUE" | "DEGRADE" | "CONTROLLED_EXIT";
export type FailureSource = "boundary" | "unhandledRejection" | "uncaughtException";
export type FailureOwner = {
  subsystem: string;
  taskId?: string;
  missionId?: string;
  stepId?: string;
  capabilityRunId?: string;
  providerSessionId?: string;
  requestId?: string;
};
export type SafeError = {
  name: string;
  message: string;
  stack?: string;
  cause?: SafeError;
  errors?: SafeError[];
};
export type FailureIncident = {
  at: number;
  instanceId: string;
  owner: FailureOwner;
  failureClass: FailureClass;
  action: FailureAction;
  source: FailureSource;
  error: SafeError;
};
export type OperationalHealth = {
  operationalState: "healthy" | "degraded" | "draining" | "fatal";
  reason: string | null;
  unavailableSubsystems: string[];
  lastFatal: { at: number; instanceId: string; reason: string } | null;
};
const SECRET_KEY = /token|secret|password|passwd|api.?key|cookie|authorization|credential/i;
const MESSAGE_LIMIT = 1024,
  STACK_LIMIT = 4096;
const diagnosticSecrets = new Set<string>();
/** Registers only actual runtime credentials, never request payloads. The redaction inventory is bounded. */
export function registerDiagnosticSecret(secret: string) {
  if (secret.length < 4 || secret.length > 8192) return;
  if (diagnosticSecrets.size >= 512)
    diagnosticSecrets.delete(diagnosticSecrets.values().next().value!);
  diagnosticSecrets.add(secret);
}
function own(value: object, key: string): unknown {
  try {
    return Object.getOwnPropertyDescriptor(value, key)?.value;
  } catch {
    return undefined;
  }
}
/** Error payloads are never enumerated or JSON-stringified. Accessors and private connector bodies are omitted. */
export function safeError(value: unknown, secrets: readonly string[] = []): SafeError {
  try {
    const hidden = [...diagnosticSecrets, ...secrets];
    for (const [key, text] of Object.entries(process.env))
      if (SECRET_KEY.test(key) && text && text.length >= 4) hidden.push(text);
    let remaining = 8000;
    const clean = (text: string, limit: number) => {
      // Include enough lookahead to redact a credential crossing the output boundary.
      let safe = text.slice(0, limit * 2 + Math.max(0, ...hidden.map((secret) => secret.length)));
      for (const secret of hidden)
        if (secret.length >= 4) safe = safe.split(secret).join("[redacted]");
      safe = safe
        .replace(/\bBearer\s+[^\s,;"']+/gi, "Bearer [redacted]")
        .replace(/\b(?:authorization|cookie|set-cookie)\s*[:=][^\r\n]+/gi, "[redacted header]")
        .replace(
          /(["']?(?:[\w.-]*(?:token|secret|password|passwd|api[_-]?key|credential)[\w.-]*)["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}]+)/gi,
          "$1[redacted]",
        )
        .replace(/\b(?:sk-[\w-]+|gh[pousr]_[\w]+|github_pat_[\w]+)\b/g, "[redacted]")
        .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[redacted]@");
      safe = Array.from(safe)
        .filter((character) => {
          const code = character.charCodeAt(0);
          return code >= 32 || code === 9 || code === 10 || code === 13;
        })
        .join("");
      const bounded = safe.slice(0, Math.min(limit, Math.max(remaining, 0)));
      remaining -= bounded.length;
      return bounded;
    };
    const seen = new Set<object>();
    const serialize = (item: unknown, depth: number): SafeError => {
      if (item === null) return { name: "Rejection", message: "null" };
      if (item === undefined) return { name: "Rejection", message: "undefined" };
      if (typeof item !== "object")
        return {
          name: "Rejection",
          message: clean(
            typeof item === "string"
              ? item
              : ["number", "boolean", "bigint"].includes(typeof item)
                ? String(item)
                : "Non-error rejection",
            MESSAGE_LIMIT,
          ),
        };
      if (depth > 2 || seen.has(item))
        return { name: "Error", message: "[nested or circular cause omitted]" };
      seen.add(item);
      const message = own(item, "message"),
        stack = own(item, "stack"),
        name = own(item, "name") ?? own(Object.getPrototypeOf(item) ?? {}, "name"),
        cause = own(item, "cause"),
        errors = own(item, "errors");
      const result: SafeError = {
        name: clean(
          typeof name === "string" ? name : Array.isArray(errors) ? "AggregateError" : "Error",
          80,
        ),
        message:
          typeof message === "string"
            ? clean(message, MESSAGE_LIMIT)
            : "Object rejection; payload omitted.",
      };
      if (typeof stack === "string") result.stack = clean(stack, STACK_LIMIT);
      if (cause !== undefined) result.cause = serialize(cause, depth + 1);
      if (Array.isArray(errors))
        result.errors = errors.slice(0, depth ? 1 : 3).map((error) => serialize(error, depth + 1));
      return result;
    };
    return serialize(value, 0);
  } catch {
    return { name: "Error", message: "Unserializable error; payload omitted." };
  }
}

export function classifyFailure(
  source: FailureSource,
  ownedAndSafe = false,
  requested: FailureClass = "OPERATION_FAILURE",
): { failureClass: FailureClass; action: FailureAction } {
  const failureClass =
    source === "uncaughtException" || (source === "unhandledRejection" && !ownedAndSafe)
      ? "HOST_FATAL"
      : requested;
  return {
    failureClass,
    action:
      failureClass === "HOST_FATAL"
        ? "CONTROLLED_EXIT"
        : failureClass === "OPERATION_FAILURE"
          ? "CONTINUE"
          : "DEGRADE",
  };
}
export class HostUnavailableError extends Error {
  constructor() {
    super("Bunny-A cannot safely accept this operation. Inspect Host operational health.");
    this.name = "HostUnavailableError";
  }
}
/** Only intentional refusals may expose their bounded, redacted explanation over HTTP. */
export class CommandRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommandRefusedError";
  }
}
type Boundary = {
  owner: FailureOwner;
  failureClass?: FailureClass;
  fail?: (error: SafeError) => void | Promise<void>;
};
type ContainmentOptions = {
  instanceId?: string;
  diagnosticDirectory?: string;
  runtimeDirectory?: string;
  secrets?: string[];
  persist?: (type: string, detail: string, owner: FailureOwner) => void;
  shutdown?: () => Promise<void>;
  exit?: (code: number) => void;
  shutdownMs?: number;
};

/** Installed Host policy. Unknown global failures always drain and exit; no fatal retry in this process. */
export class HostContainment {
  instanceId: string;
  health: OperationalHealth = {
    operationalState: "healthy",
    reason: null,
    unavailableSubsystems: [],
    lastFatal: null,
  };
  options: ContainmentOptions;
  context = new AsyncLocalStorage<Boundary>();
  owners = new WeakMap<Promise<unknown>, Boundary>();
  fatalExit: Promise<void> | null = null;
  recording = false;
  records = 0;
  lastReports = new Map<string, number>();
  pendingRecovery: {
    path: string;
    saved: Record<string, unknown>;
    incident: FailureIncident;
  } | null = null;
  constructor(options: ContainmentOptions = {}) {
    this.options = options;
    this.instanceId = options.instanceId ?? randomUUID();
  }
  snapshot(): OperationalHealth {
    return {
      ...this.health,
      unavailableSubsystems: [...this.health.unavailableSubsystems],
      lastFatal: this.health.lastFatal ? { ...this.health.lastFatal } : null,
    };
  }
  allows(subsystem?: string) {
    return (
      this.health.operationalState === "healthy" ||
      (this.health.operationalState === "degraded" &&
        !this.health.unavailableSubsystems.includes("*") &&
        !!subsystem &&
        !this.health.unavailableSubsystems.includes(subsystem))
    );
  }
  assertAccepting(subsystem?: string) {
    if (!this.allows(subsystem)) throw new HostUnavailableError();
  }
  /** Trusted in-process association only. Request bodies never supply failure policy or callbacks. */
  ownPromise<T>(promise: Promise<T>, boundary: Boundary): Promise<T> {
    this.owners.set(promise, boundary);
    return promise;
  }
  background(
    owner: FailureOwner,
    work: () => unknown | Promise<unknown>,
    fail?: Boundary["fail"],
    failureClass: FailureClass = "OPERATION_FAILURE",
  ): void {
    const boundary = { owner, fail, failureClass };
    const pending = this.context.run(boundary, async () => {
      try {
        await work();
      } catch (error) {
        await this.contain(error, "boundary", boundary);
      }
    });
    // contain() never rejects, but guard the wrapper itself as a final backstop.
    pending.catch((error) => {
      this.fatal(error, owner);
    });
  }
  guard<T extends unknown[]>(
    owner: FailureOwner,
    work: (...args: T) => void,
    fail?: Boundary["fail"],
  ): (...args: T) => void {
    return (...args) => {
      try {
        this.context.run({ owner, fail }, () => work(...args));
      } catch (error) {
        this.background(owner, () => this.contain(error, "boundary", { owner, fail }));
      }
    };
  }
  async contain(
    error: unknown,
    source: FailureSource = "boundary",
    boundary: Boundary = { owner: { subsystem: "unknown" } },
  ): Promise<FailureIncident> {
    const policy = classifyFailure(source, !!boundary.fail, boundary.failureClass);
    const incident: FailureIncident = {
      ...policy,
      at: Date.now(),
      instanceId: this.instanceId,
      owner: { ...boundary.owner },
      source,
      error: safeError(error, this.options.secrets),
    };
    try {
      if (policy.action === "CONTROLLED_EXIT") {
        this.fatal(error, boundary.owner, source);
        return incident;
      }
      if (policy.action === "DEGRADE")
        this.degrade(
          boundary.owner.subsystem,
          "A Host subsystem is unavailable; dependent execution is refused.",
        );
      if (boundary.fail) await boundary.fail(incident.error);
      this.record(
        source === "unhandledRejection"
          ? "host.unhandled_rejection"
          : policy.failureClass === "OPERATION_FAILURE"
            ? "host.operation_failed"
            : "host.subsystem_failed",
        incident,
      );
    } catch (containmentError) {
      this.fatal(containmentError, { ...boundary.owner, subsystem: "persistence-or-containment" });
    }
    return incident;
  }
  degrade(subsystem: string, reason: string) {
    if (["draining", "fatal"].includes(this.health.operationalState)) return;
    const scope = !subsystem || subsystem === "unknown" ? "*" : subsystem;
    if (this.health.unavailableSubsystems.includes(scope)) return;
    this.health = {
      ...this.health,
      operationalState: "degraded",
      reason,
      unavailableSubsystems: [...this.health.unavailableSubsystems, scope],
    };
    this.record("host.degraded", {
      at: Date.now(),
      instanceId: this.instanceId,
      owner: { subsystem: scope },
      failureClass: "HOST_DEGRADED",
      action: "DEGRADE",
      source: "boundary",
      error: { name: "HostDegraded", message: reason },
    });
  }
  record(type: string, incident: FailureIncident) {
    const key = `${type}:${incident.owner.subsystem}:${incident.owner.taskId ?? incident.owner.missionId ?? incident.owner.capabilityRunId ?? "system"}`;
    if (type !== "host.fatal" && Date.now() - (this.lastReports.get(key) ?? 0) < 60_000) return;
    if (this.lastReports.size >= 256) this.lastReports.clear();
    this.lastReports.set(key, Date.now());
    // Ordinary event history / remote snapshots expose correlation and policy, never stacks or error payloads.
    const summary = JSON.stringify({
      ...incident,
      error: {
        name: incident.error.name,
        message: "Operation failed; details retained in local diagnostics.",
      },
    });
    if (!this.recording && this.options.persist) {
      this.recording = true;
      try {
        this.options.persist(type, summary, incident.owner);
      } catch {
        this.health = {
          ...this.health,
          operationalState: "degraded",
          reason: "Diagnostic persistence failed; execution is refused until Host recovery.",
          unavailableSubsystems: ["*"],
        };
      } finally {
        this.recording = false;
      }
    }
    this.fallback(type, incident);
  }
  private fallback(type: string, incident: FailureIncident) {
    if (++this.records > 128) return;
    try {
      if (!this.options.diagnosticDirectory) {
        process.stderr.write(
          JSON.stringify({
            type,
            at: incident.at,
            failureClass: incident.failureClass,
            action: incident.action,
            error: "Failure evidence unavailable locally.",
          }) + "\n",
        );
        return;
      }
      const file = join(this.options.diagnosticDirectory, "host-failures.jsonl");
      mkdirSync(dirname(file), { recursive: true });
      if (existsSync(file) && (lstatSync(file).isSymbolicLink() || lstatSync(file).nlink > 1))
        return;
      if (existsSync(file) && statSync(file).size > 512 * 1024) {
        const previous = file + ".previous";
        if (existsSync(previous)) unlinkSync(previous);
        renameSync(file, previous);
      }
      appendFileSync(file, JSON.stringify({ type, ...incident }).slice(0, 16000) + "\n", {
        mode: 0o600,
      });
    } catch {
      try {
        process.stderr.write(
          JSON.stringify({
            type,
            at: incident.at,
            failureClass: incident.failureClass,
            action: incident.action,
            error: "Local diagnostics unavailable.",
          }) + "\n",
        );
      } catch {
        /* No usable output channel. */
      }
    }
  }
  fatal(
    error: unknown,
    owner: FailureOwner = { subsystem: "unknown" },
    source: FailureSource = "boundary",
  ) {
    if (this.fatalExit) return this.fatalExit;
    const incident: FailureIncident = {
      at: Date.now(),
      instanceId: this.instanceId,
      owner,
      source,
      failureClass: "HOST_FATAL",
      action: "CONTROLLED_EXIT",
      error: safeError(error, this.options.secrets),
    };
    this.health = {
      ...this.health,
      operationalState: "draining",
      reason: "A fatal Host failure requires a controlled restart.",
      unavailableSubsystems: ["*"],
      lastFatal: {
        at: incident.at,
        instanceId: this.instanceId,
        reason: "Previous Host terminated after a fatal failure; execution was not resumed.",
      },
    };
    // Reserve the winner before any observer/logging/cleanup can recursively call fatal().
    let finish!: () => void;
    this.fatalExit = new Promise<void>((done) => {
      finish = done;
    });
    let exited = false;
    const exit = () => {
      if (exited) return;
      exited = true;
      this.health.operationalState = "fatal";
      finish();
      (this.options.exit ?? process.exit)(70);
    };
    const timeout = setTimeout(exit, Math.min(Math.max(this.options.shutdownMs ?? 3000, 50), 5000));
    this.record(
      source === "uncaughtException"
        ? "host.uncaught_exception"
        : source === "unhandledRejection"
          ? "host.unhandled_rejection"
          : "host.draining",
      incident,
    );
    this.record("host.fatal", incident);
    this.health.operationalState = "draining"; // Persistence failure cannot reopen a fatal Host.
    this.writeMarker(incident);
    Promise.resolve()
      .then(() => this.options.shutdown?.())
      .catch(() => {
        this.fallback("host.shutdown_failed", incident);
      })
      .finally(() => {
        clearTimeout(timeout);
        exit();
      })
      .catch(() => {
        /* exit() may be replaced by a throwing test double. */
      });
    return this.fatalExit;
  }
  private writeMarker(incident: FailureIncident) {
    try {
      if (!this.options.runtimeDirectory) return;
      const marker = join(this.options.runtimeDirectory, "host-fatal.json");
      mkdirSync(dirname(marker), { recursive: true });
      if (existsSync(marker) && (lstatSync(marker).isSymbolicLink() || lstatSync(marker).nlink > 1))
        return;
      writeFileSync(
        marker,
        JSON.stringify({
          schema: "bunny-host-fatal/1",
          ...incident,
          error: {
            name: incident.error.name,
            message: "Fatal failure; inspect local diagnostics.",
          },
        }),
        { mode: 0o600 },
      );
    } catch {
      this.fallback("host.marker_failed", incident);
    }
  }
  recoverMarker(completed = true) {
    try {
      if (!this.options.runtimeDirectory) return;
      const path = join(this.options.runtimeDirectory, "host-fatal.json");
      if (
        !existsSync(path) ||
        statSync(path).size > 16000 ||
        lstatSync(path).isSymbolicLink() ||
        lstatSync(path).nlink > 1
      )
        return;
      const saved = JSON.parse(readFileSync(path, "utf8"));
      if (
        saved.schema !== "bunny-host-fatal/1" ||
        !Number.isFinite(saved.at) ||
        typeof saved.instanceId !== "string" ||
        !/^[a-f0-9-]{36}$/i.test(saved.instanceId)
      )
        return;
      this.health.lastFatal = {
        at: saved.at,
        instanceId: saved.instanceId.slice(0, 100),
        reason: "Previous Host terminated after a fatal failure; old sessions were not resumed.",
      };
      if (saved.acknowledged) return;
      const incident: FailureIncident = {
        at: Date.now(),
        instanceId: this.instanceId,
        owner: { subsystem: "recovery" },
        source: "boundary",
        failureClass: "OPERATION_FAILURE",
        action: "CONTINUE",
        error: { name: "HostRecovery", message: this.health.lastFatal.reason },
      };
      this.record("host.recovery_started", incident);
      this.pendingRecovery = { path, saved, incident };
      if (completed) this.finishRecovery();
      // Preserve lastFatal across subsequent ordinary restarts, without replaying recovery events.
    } catch {
      this.degrade("*", "Previous crash evidence could not be read; recovery requires inspection.");
    }
  }
  finishRecovery() {
    const recovery = this.pendingRecovery;
    if (!recovery || !this.allows("recovery")) return;
    this.record("host.recovered", recovery.incident);
    if (!this.allows("recovery")) return;
    try {
      writeFileSync(recovery.path, JSON.stringify({ ...recovery.saved, acknowledged: true }), {
        mode: 0o600,
      });
      this.pendingRecovery = null;
    } catch {
      this.degrade("*", "Crash recovery evidence could not be acknowledged; inspect Host state.");
    }
  }
  installProcessHandlers() {
    const rejection = (error: unknown, promise: Promise<unknown>) => {
      const boundary = this.owners.get(promise);
      const context = this.context.getStore();
      this.background(boundary?.owner ?? context?.owner ?? { subsystem: "unknown" }, () =>
        this.contain(
          error,
          "unhandledRejection",
          boundary ?? { owner: context?.owner ?? { subsystem: "unknown" } },
        ),
      );
    };
    const exception = (error: Error) => {
      this.fatal(
        error,
        this.context.getStore()?.owner ?? { subsystem: "unknown" },
        "uncaughtException",
      );
    };
    process.on("unhandledRejection", rejection);
    process.on("uncaughtException", exception);
    return () => {
      process.off("unhandledRejection", rejection);
      process.off("uncaughtException", exception);
    };
  }
}

/** Serial, self-scheduling polling with bounded backoff. A failed iteration never overlaps or dies silently. */
export function supervisedLoop(
  containment: HostContainment,
  owner: FailureOwner,
  work: () => Promise<void> | void,
  intervalMs: number,
  onFailure?: (error: SafeError) => void,
  failureClass: FailureClass = "OPERATION_FAILURE",
) {
  let stopped = false,
    failures = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const tick = async () => {
    if (stopped) return;
    try {
      await work();
      failures = 0;
    } catch (error) {
      failures = Math.min(failures + 1, 6);
      await containment.contain(error, "boundary", { owner, fail: onFailure, failureClass });
    }
    if (!stopped) {
      timer = setTimeout(
        () => containment.background(owner, tick, onFailure, failureClass),
        intervalMs * 2 ** failures,
      );
      timer.unref?.();
    }
  };
  timer = setTimeout(
    () => containment.background(owner, tick, onFailure, failureClass),
    intervalMs,
  );
  timer.unref?.();
  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
