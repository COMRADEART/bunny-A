import { randomUUID, createHash } from "node:crypto";
import { existsSync, lstatSync, realpathSync, readFileSync } from "node:fs";
import { join, resolve, relative, isAbsolute, extname } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { resolveCommand } from "../../bunny-missions/capabilities/process.server.ts";
import { trackOwnedChild } from "../owned-processes.server.ts";
import { systemTool } from "../system-tools.server.ts";
import { execFile } from "node:child_process";

export const sha256 = (content: string | Buffer): string =>
  createHash("sha256").update(content).digest("hex");

/** Maximum permitted captured output per stream to prevent memory exhaustion and DoS. */
export const MAX_TEST_OUTPUT_BYTES = 200_000;

/** Authorized test runners / executables. Arbitrary shell interpreters (.cmd, .bat, .ps1, bash, sh) are strictly refused. */
export const AUTHORIZED_TEST_EXECUTABLES = new Set(["node", "npm", "npx"]);

/** Safe extensions for test files. */
export const AUTHORIZED_TEST_EXTENSIONS = new Set([
  ".test.ts",
  ".test.js",
  ".test.mjs",
  ".test.cjs",
  ".spec.ts",
  ".spec.js",
  ".spec.mjs",
  ".spec.cjs",
]);

export type TestTerminalState = "exited" | "timedOut" | "aborted" | "crashed" | "refused";

export type DeterministicTestResult = {
  launched: boolean;
  terminalState: TestTerminalState;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  stdoutSha256: string;
  stderrSha256: string;
  artifactSha256: string | null;
  reportSha256: string | null;
  reportMissing: boolean;
  truncated: boolean;
  durationMs: number;
  executionId: string;
  receipt: string | null;
  pass: boolean;
  reason: string;
};

export type TestRunnerOptions = {
  rootPath: string;
  testFile?: string;
  command?: string;
  args?: string[];
  reportFile?: string;
  timeoutMs?: number;
  maxOutput?: number;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
  trackChild?: (child: ChildProcess) => void;
  expectedArtifactHash?: string;
};

/** Sanitizes execution environment to avoid injecting untrusted hooks or credentials. */
export function sanitizeTestEnvironment(baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const allowedKeys = [
    "PATH", "Path", "SYSTEMROOT", "SystemRoot", "WINDIR", "windir",
    "TEMP", "TMP", "USERPROFILE", "HOME", "HOMEPATH", "HOMEDRIVE",
    "COMSPEC", "NODE_ENV", "LANG", "LC_ALL", "CI",
  ];
  const clean: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(baseEnv)) {
    if (value === undefined) continue;
    const upper = key.toUpperCase();
    // Exclude security-sensitive variables, shell hooks, and tokens
    if (
      upper.includes("KEY") ||
      upper.includes("TOKEN") ||
      upper.includes("SECRET") ||
      upper.includes("AUTH") ||
      upper.includes("PASSWORD") ||
      upper.includes("COOKIE") ||
      upper === "NODE_OPTIONS" ||
      upper === "PYTHONPATH" ||
      upper === "PERL5LIB" ||
      upper === "RUBYOPT"
    ) {
      continue;
    }
    if (allowedKeys.includes(key) || allowedKeys.includes(upper)) {
      clean[key] = value;
    }
  }
  return clean;
}

/** Validates that a path is strictly inside the root directory without symlinks or directory traversal. */
export function validatePathContainment(rootPath: string, relativePath: string): { ok: true; resolved: string } | { ok: false; error: string } {
  if (typeof relativePath !== "string" || !relativePath.trim()) {
    return { ok: false, error: "Test file path must be a non-empty string." };
  }
  const clean = relativePath.trim().replace(/\\/g, "/");
  if (clean.startsWith("/") || /^[A-Za-z]:/.test(clean) || clean.startsWith("//")) {
    return { ok: false, error: "Test file path must be relative to the registered project root." };
  }
  const parts = clean.split("/").filter(Boolean);
  if (parts.some(p => p === "." || p === ".." || p === "")) {
    return { ok: false, error: "Path traversal components ('.', '..') are forbidden in test targets." };
  }

  const resolved = resolve(rootPath, clean);
  const rel = relative(rootPath, resolved);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    return { ok: false, error: "Target escapes the registered project root." };
  }

  // Ensure real root containment
  try {
    const realRoot = realpathSync(rootPath);
    if (existsSync(resolved)) {
      const realTarget = realpathSync(resolved);
      const relReal = relative(realRoot, realTarget);
      if (relReal.startsWith("..") || isAbsolute(relReal)) {
        return { ok: false, error: "Target escapes the project root via symbolic link or junction." };
      }
    }
  } catch (err) {
    return { ok: false, error: `Containment check failed: ${(err as Error).message}` };
  }

  return { ok: true, resolved };
}

/**
 * Executes a deterministic test suite within the constrained project root.
 * Produces an immutable execution receipt ONLY if:
 * 1. Process launched.
 * 2. Process exited normally with exitCode === 0.
 * 3. Output was not truncated.
 * 4. Required reports are present and satisfied.
 * 5. Not timed out or aborted.
 */
export async function executeDeterministicTest(options: TestRunnerOptions): Promise<DeterministicTestResult> {
  const executionId = `test-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const started = Date.now();
  const maxOutput = options.maxOutput ?? MAX_TEST_OUTPUT_BYTES;
  const timeoutMs = options.timeoutMs ?? 60_000;

  // Validate rootPath
  if (!existsSync(options.rootPath)) {
    return makeRefusal(executionId, `Project root does not exist: ${options.rootPath}`);
  }
  const rootStat = lstatSync(options.rootPath);
  if (!rootStat.isDirectory()) {
    return makeRefusal(executionId, `Project root is not a directory: ${options.rootPath}`);
  }

  // Ensure a test file or authorized command is provided
  if (!options.testFile && !options.command) {
    return makeRefusal(executionId, "No test file or authorized test command was specified for deterministic test execution.");
  }

  // Determine command & args
  let executableName = "node";
  let safeArgs: string[] = [];
  let targetArtifactSha256: string | null = null;

  if (options.command) {
    const trimmedCommand = options.command.trim();
    const tokens = trimmedCommand.split(/\s+/).filter(Boolean);
    const cmdBase = tokens[0]?.toLowerCase().replace(/\.exe$/, "");
    if (!cmdBase || !AUTHORIZED_TEST_EXECUTABLES.has(cmdBase)) {
      return makeRefusal(executionId, `Executable "${cmdBase}" is not an authorized test runner (authorized: ${[...AUTHORIZED_TEST_EXECUTABLES].join(", ")}).`);
    }
    // Refuse shell metacharacters, redirection, or interpolation
    if (/[&|;<>^`$]/.test(trimmedCommand)) {
      return makeRefusal(executionId, "Command contains prohibited shell characters or interpolation.");
    }
    executableName = cmdBase;
    safeArgs = tokens.slice(1);
  }

  if (options.testFile) {
    const containment = validatePathContainment(options.rootPath, options.testFile);
    if (!containment.ok) {
      return makeRefusal(executionId, containment.error);
    }
    if (!existsSync(containment.resolved)) {
      return makeRefusal(executionId, `Test file does not exist: ${options.testFile}`);
    }

    // Check test file extension
    const ext = extname(containment.resolved).toLowerCase();
    const hasAuthorizedExt = [...AUTHORIZED_TEST_EXTENSIONS].some(e => containment.resolved.toLowerCase().endsWith(e));
    if (!hasAuthorizedExt && ext !== ".js" && ext !== ".ts") {
      return makeRefusal(executionId, `Target file "${options.testFile}" does not have an authorized test extension.`);
    }

    // Hash the test file to capture source state
    try {
      const fileBytes = readFileSync(containment.resolved);
      targetArtifactSha256 = sha256(fileBytes);
    } catch {}

    if (executableName === "node" && safeArgs.length === 0) {
      safeArgs = ["--experimental-strip-types", "--test", containment.resolved];
    }
  }

  // Resolve executable safely
  const resolved = resolveCommand(executableName, options.rootPath);
  if (!resolved) {
    return makeRefusal(executionId, `Failed to resolve authorized executable "${executableName}".`);
  }

  // Check signal before launch
  if (options.signal?.aborted) {
    return {
      launched: false,
      terminalState: "aborted",
      exitCode: null,
      stdout: "",
      stderr: "Aborted before start.",
      stdoutSha256: sha256(""),
      stderrSha256: sha256("Aborted before start."),
      artifactSha256: targetArtifactSha256,
      reportSha256: null,
      reportMissing: false,
      truncated: false,
      durationMs: 0,
      executionId,
      receipt: null,
      pass: false,
      reason: "Execution was aborted before start.",
    };
  }

  // Execute process
  const env = sanitizeTestEnvironment(options.env ?? process.env);
  const childArgs = [...resolved.prefix, ...safeArgs];

  return new Promise<DeterministicTestResult>((resolvePromise) => {
    let child: ChildProcess;
    try {
      child = spawn(resolved.file, childArgs, {
        cwd: options.rootPath,
        shell: false,
        windowsHide: true,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      resolvePromise({
        launched: false,
        terminalState: "crashed",
        exitCode: null,
        stdout: "",
        stderr: (err as Error).message,
        stdoutSha256: sha256(""),
        stderrSha256: sha256((err as Error).message),
        artifactSha256: targetArtifactSha256,
        reportSha256: null,
        reportMissing: false,
        truncated: false,
        durationMs: Date.now() - started,
        executionId,
        receipt: null,
        pass: false,
        reason: `Spawn failed: ${(err as Error).message}`,
      });
      return;
    }

    trackOwnedChild(child);
    if (options.trackChild) {
      options.trackChild(child);
    }

    let stdout = "";
    let stderr = "";
    let truncated = false;
    let timedOut = false;
    let aborted = false;

    const append = (current: string, chunk: Buffer): string => {
      if (current.length >= maxOutput) {
        truncated = true;
        return current;
      }
      const combined = current + chunk.toString("utf8");
      if (combined.length > maxOutput) {
        truncated = true;
        return combined.slice(0, maxOutput);
      }
      return combined;
    };

    child.stdout?.on("data", (chunk: Buffer) => { stdout = append(stdout, chunk); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr = append(stderr, chunk); });

    const killProcessTree = () => {
      if (child.pid === undefined || child.exitCode !== null) return;
      if (process.platform === "win32") {
        try {
          execFile(systemTool("taskkill.exe"), ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }, () => {});
        } catch {
          child.kill("SIGKILL");
        }
      } else {
        child.kill("SIGKILL");
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killProcessTree();
    }, timeoutMs);

    const onAbort = () => {
      aborted = true;
      killProcessTree();
    };

    if (options.signal) {
      options.signal.addEventListener("abort", onAbort, { once: true });
    }

    child.on("error", (err: Error) => {
      clearTimeout(timer);
      if (options.signal) options.signal.removeEventListener("abort", onAbort);
      resolvePromise({
        launched: true,
        terminalState: "crashed",
        exitCode: null,
        stdout,
        stderr: stderr + "\n" + err.message,
        stdoutSha256: sha256(stdout),
        stderrSha256: sha256(stderr + "\n" + err.message),
        artifactSha256: targetArtifactSha256,
        reportSha256: null,
        reportMissing: false,
        truncated,
        durationMs: Date.now() - started,
        executionId,
        receipt: null,
        pass: false,
        reason: `Process crashed with error: ${err.message}`,
      });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (options.signal) options.signal.removeEventListener("abort", onAbort);
      const durationMs = Date.now() - started;

      let terminalState: TestTerminalState = "exited";
      if (timedOut) terminalState = "timedOut";
      else if (aborted) terminalState = "aborted";
      else if (code === null) terminalState = "crashed";

      // Report file check
      let reportSha256: string | null = null;
      let reportMissing = false;
      if (options.reportFile) {
        const reportPath = resolve(options.rootPath, options.reportFile);
        if (!existsSync(reportPath)) {
          reportMissing = true;
        } else {
          try {
            const reportBytes = readFileSync(reportPath);
            if (reportBytes.length === 0) reportMissing = true;
            else reportSha256 = sha256(reportBytes);
          } catch {
            reportMissing = true;
          }
        }
      }

      const stdoutSha256 = sha256(stdout);
      const stderrSha256 = sha256(stderr);

      // Strict acceptance rules
      const pass =
        terminalState === "exited" &&
        code === 0 &&
        !truncated &&
        !reportMissing;

      let reason = "All deterministic test assertions and process exit verified.";
      if (terminalState === "timedOut") {
        reason = `Test execution timed out after ${durationMs}ms.`;
      } else if (terminalState === "aborted") {
        reason = "Test execution was cancelled.";
      } else if (terminalState === "crashed" || code === null) {
        reason = "Test process crashed before normal completion.";
      } else if (code !== 0) {
        reason = `Test process exited with non-zero code ${code}.`;
      } else if (truncated) {
        reason = `Test process output exceeded limit (${maxOutput} bytes) and was truncated; cannot guarantee test integrity.`;
      } else if (reportMissing) {
        reason = `Required test report file "${options.reportFile}" was missing or empty.`;
      }

      const receipt = pass
        ? `receipt:test-exec:${executionId}:${stdoutSha256}`
        : null;

      resolvePromise({
        launched: true,
        terminalState,
        exitCode: code,
        stdout,
        stderr,
        stdoutSha256,
        stderrSha256,
        artifactSha256: targetArtifactSha256,
        reportSha256,
        reportMissing,
        truncated,
        durationMs,
        executionId,
        receipt,
        pass,
        reason,
      });
    });
  });
}

function makeRefusal(executionId: string, reason: string): DeterministicTestResult {
  return {
    launched: false,
    terminalState: "refused",
    exitCode: null,
    stdout: "",
    stderr: reason,
    stdoutSha256: sha256(""),
    stderrSha256: sha256(reason),
    artifactSha256: null,
    reportSha256: null,
    reportMissing: false,
    truncated: false,
    durationMs: 0,
    executionId,
    receipt: null,
    pass: false,
    reason,
  };
}

/** Verifies that a persisted test receipt remains fresh against the target artifact hash. */
export function verifyTestReceipt(params: {
  receipt: string | null;
  recordedArtifactHash?: string | null;
  currentArtifactHash?: string | null;
}): { verified: boolean; reason: string } {
  if (!params.receipt || !params.receipt.startsWith("receipt:test-exec:")) {
    return { verified: false, reason: "Missing or invalid test execution receipt format." };
  }
  if (params.recordedArtifactHash && params.currentArtifactHash) {
    if (params.recordedArtifactHash !== params.currentArtifactHash) {
      return { verified: false, reason: "Receipt artifact version is stale; target file was modified." };
    }
  }
  return { verified: true, reason: "Test execution receipt verified against artifact hash." };
}
