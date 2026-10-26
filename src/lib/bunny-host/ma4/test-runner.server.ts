import { randomUUID, createHash } from "node:crypto";
import { existsSync, lstatSync, realpathSync, readFileSync, statSync } from "node:fs";
import { resolve, relative, isAbsolute, extname, join, sep } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { resolveCommand } from "../../bunny-missions/capabilities/process.server.ts";
import { trackOwnedChild } from "../owned-processes.server.ts";
import { systemTool } from "../system-tools.server.ts";
import { execFile } from "node:child_process";

export const sha256 = (content: string | Buffer): string =>
  createHash("sha256").update(content).digest("hex");

/** Maximum permitted captured output per stream to prevent memory exhaustion and DoS. */
export const MAX_TEST_OUTPUT_BYTES = 200_000;

/** Maximum permitted test report size (1 MiB). */
export const MAX_TEST_REPORT_BYTES = 1024 * 1024;

/** Authorized test executables for Mode A and Mode B profiles. */
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

/**
 * Dangerous Node.js flags that allow arbitrary code evaluation or module preloads.
 * These are strictly prohibited in Mode A and verified test commands.
 */
export const PROHIBITED_NODE_FLAGS = new Set([
  "-e",
  "--eval",
  "-p",
  "--print",
  "-r",
  "--require",
  "--import",
  "--loader",
  "--experimental-loader",
  "--inspect",
  "--inspect-brk",
  "--inspect-port",
  "--prof",
  "--experimental-default-type",
  "--conditions",
  "--input-type",
  "-i",
  "--interactive",
  "--napi-modules",
  "--expose-internals",
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
  mode?: "ModeA" | "ModeB";
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
  requireAssertions?: boolean;
  authorizedProfile?: {
    executable: string;
    allowedArgs?: string[];
    scope?: string;
  };
};

const PROTECTED_DIRS = /^(\.git|\.ssh|\.aws|\.azure|\.gnupg|\.kube|\.docker|\.config|node_modules|\$recycle\.bin|system volume information)$/i;
const PROTECTED_FILES = /^(\.env(\..*)?|.*\.(pem|key|p12|pfx|kdbx|keychain|ppk|jks|keystore)|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|known_hosts|authorized_keys|\.npmrc|\.pypirc|\.netrc|_netrc|\.git-credentials|credentials(\..*)?|.*secrets?\.(json|ya?ml|toml|txt)|cookies(\..*)?|login data|web data|.*\.sqlite-wal)$/i;
const RESERVED_DEVICE_NAMES = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

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

/**
 * Validates path containment against a registered root with strict OS-level checks:
 * - Reject traversal ('.', '..'), absolute paths, drive letters, UNC shares.
 * - Reject Windows device names and 8.3 short aliases.
 * - Walk each component from the root down; reject any symlinks, junctions or reparse points.
 * - Verify that realpathSync.native matches the walked path exactly.
 * - Refuse credential or protected directories/files.
 */
export function validatePathContainment(
  rootPath: string,
  relativePath: string,
): { ok: true; resolved: string } | { ok: false; error: string } {
  if (typeof rootPath !== "string" || !rootPath.trim()) {
    return { ok: false, error: "Project root path must be specified." };
  }
  if (typeof relativePath !== "string" || !relativePath.trim()) {
    return { ok: false, error: "Target path must be a non-empty string." };
  }

  // 1. Root directory integrity
  if (!existsSync(rootPath)) {
    return { ok: false, error: `Project root does not exist: ${rootPath}` };
  }
  let rootStat;
  try {
    rootStat = lstatSync(rootPath);
  } catch (err) {
    return { ok: false, error: `Cannot stat project root: ${(err as Error).message}` };
  }
  if (!rootStat.isDirectory()) {
    return { ok: false, error: `Project root is not a directory: ${rootPath}` };
  }
  if (rootStat.isSymbolicLink()) {
    return { ok: false, error: "Project root must be a real directory, not a symbolic link." };
  }

  let canonicalRoot: string;
  try {
    canonicalRoot = realpathSync.native(rootPath);
  } catch (err) {
    return { ok: false, error: `Failed to canonicalize project root: ${(err as Error).message}` };
  }

  const same = (a: string, b: string) =>
    process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;

  if (!same(canonicalRoot, resolve(rootPath))) {
    return { ok: false, error: "Project root is reached through a link or reparse point; register its real location." };
  }

  // 2. Relative path parsing & safety
  const clean = relativePath.trim().replace(/\\/g, "/");
  if (clean === "" || clean === ".") {
    return { ok: false, error: "Target path cannot be the root itself." };
  }
  if (clean.startsWith("/") || /^[A-Za-z]:/.test(clean) || clean.startsWith("//") || clean.startsWith("\\\\")) {
    return { ok: false, error: "Target path must be relative to the registered project root (no drive or UNC paths)." };
  }

  const segments = clean.split("/").filter((s, i, all) => !(s === "" && i === all.length - 1));
  if (segments.length > 24) {
    return { ok: false, error: "Target path is too deep." };
  }

  for (const s of segments) {
    if (s === "" || s === "." || s === "..") {
      return { ok: false, error: "Path traversal components ('.', '..') are forbidden in target paths." };
    }
    // Check forbidden characters
    if (/[<>:"|?*\u0000-\u001f]/.test(s)) {
      return { ok: false, error: "Path segments may not contain invalid characters (: < > \" | ? * or control characters)." };
    }
    if (/[. ]$/.test(s)) {
      return { ok: false, error: "Path segments may not end with a dot or a space." };
    }
    if (RESERVED_DEVICE_NAMES.test(s)) {
      return { ok: false, error: `Reserved device name "${s}" is not a valid file.` };
    }
    if (/~\d/.test(s)) {
      return { ok: false, error: "Short (8.3) names are refused; use the canonical full name." };
    }
    if (PROTECTED_DIRS.test(s)) {
      return { ok: false, error: `Directory "${s}" is protected and cannot be accessed.` };
    }
  }

  const finalSegment = segments[segments.length - 1];
  if (PROTECTED_FILES.test(finalSegment)) {
    return { ok: false, error: `File "${finalSegment}" is protected; sensitive files cannot be targeted.` };
  }

  // 3. Walk from canonical root down component by component
  let currentAbs = canonicalRoot;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    currentAbs = join(currentAbs, seg);
    if (existsSync(currentAbs)) {
      let st;
      try {
        st = lstatSync(currentAbs);
      } catch (err) {
        return { ok: false, error: `Failed to inspect component "${seg}": ${(err as Error).message}` };
      }
      if (st.isSymbolicLink()) {
        return { ok: false, error: `Component "${seg}" is a symbolic link; links are not followed.` };
      }
      if (i < segments.length - 1 && !st.isDirectory()) {
        return { ok: false, error: `Intermediate component "${seg}" is not a directory.` };
      }
      // Check reparse point escape
      try {
        const realCurrent = realpathSync.native(currentAbs);
        if (!same(realCurrent, currentAbs)) {
          return { ok: false, error: `Component "${seg}" resolves outside its folder (reparse point or junction).` };
        }
      } catch (err) {
        return { ok: false, error: `Failed to resolve realpath for "${seg}": ${(err as Error).message}` };
      }
    }
  }

  // 4. Verify canonical containment
  const resolved = resolve(canonicalRoot, clean);
  const rel = relative(canonicalRoot, resolved);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    return { ok: false, error: "Target escapes the registered project root." };
  }

  if (existsSync(resolved)) {
    try {
      const realTarget = realpathSync.native(resolved);
      const relReal = relative(canonicalRoot, realTarget);
      if (relReal.startsWith("..") || isAbsolute(relReal)) {
        return { ok: false, error: "Target escapes the project root via symbolic link or junction." };
      }
      const finalStat = lstatSync(resolved);
      if (finalStat.isSymbolicLink()) {
        return { ok: false, error: "Target is a symbolic link; symbolic links are refused." };
      }
      if (finalStat.isFile() && finalStat.nlink > 1) {
        return { ok: false, error: "Target has multiple hard links; hard-linked files are refused." };
      }
    } catch (err) {
      return { ok: false, error: `Containment check failed: ${(err as Error).message}` };
    }
  }

  return { ok: true, resolved };
}

/**
 * Executes a deterministic test suite within a constrained project root.
 * Produces an immutable execution receipt ONLY if:
 * 1. Process launched under verified mode (Mode A or Mode B).
 * 2. Process exited normally with exitCode === 0.
 * 3. Output was not truncated.
 * 4. Required reports are present, freshly created, schema-valid, and satisfied.
 * 5. Not timed out or aborted.
 * 6. Non-zero tests executed when assertion verification is required.
 */
export async function executeDeterministicTest(options: TestRunnerOptions): Promise<DeterministicTestResult> {
  const executionId = `test-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const started = Date.now();
  const maxOutput = options.maxOutput ?? MAX_TEST_OUTPUT_BYTES;
  const timeoutMs = options.timeoutMs ?? 60_000;

  // Validate rootPath exists and is clean
  if (!existsSync(options.rootPath)) {
    return makeRefusal(executionId, `Project root does not exist: ${options.rootPath}`);
  }
  let rootStat;
  try {
    rootStat = lstatSync(options.rootPath);
  } catch (err) {
    return makeRefusal(executionId, `Failed to inspect project root: ${(err as Error).message}`);
  }
  if (!rootStat.isDirectory()) {
    return makeRefusal(executionId, `Project root is not a directory: ${options.rootPath}`);
  }
  if (rootStat.isSymbolicLink()) {
    return makeRefusal(executionId, "Project root cannot be a symbolic link.");
  }
  const canonicalRoot = realpathSync.native(options.rootPath);

  // Ensure a test file or authorized command is provided
  if (!options.testFile && !options.command) {
    return makeRefusal(executionId, "No test file or authorized test command was specified for deterministic test execution.");
  }

  let executionMode: "ModeA" | "ModeB" = "ModeA";
  let executableFile: string = realpathSync(process.execPath);
  let childArgs: string[] = [];
  let targetArtifactSha256: string | null = null;

  // Handle Command / Argument Policy (Mode A vs Mode B)
  if (options.command) {
    const trimmedCommand = options.command.trim();
    // Refuse shell metacharacters, redirection, or interpolation
    if (/[&|;<>^`$\r\n]/.test(trimmedCommand)) {
      return makeRefusal(executionId, "Command contains prohibited shell characters or interpolation.");
    }
    const tokens = trimmedCommand.split(/\s+/).filter(Boolean);
    const cmdBase = tokens[0]?.toLowerCase().replace(/\.exe$/, "");

    if (!cmdBase || !AUTHORIZED_TEST_EXECUTABLES.has(cmdBase)) {
      return makeRefusal(
        executionId,
        `Executable "${cmdBase}" is not an authorized test runner (authorized: ${[...AUTHORIZED_TEST_EXECUTABLES].join(", ")}).`,
      );
    }

    if (cmdBase === "npm" || cmdBase === "npx") {
      // Mode B explicitly authorized project execution profile check
      if (!options.authorizedProfile) {
        return makeRefusal(
          executionId,
          `Direct execution of "${cmdBase}" requires an owner-authorized Mode B project command profile. Arbitrary package or script execution is disallowed.`,
        );
      }
      executionMode = "ModeB";
      // Refuse dynamic package download/execution via npx without --no-install
      if (cmdBase === "npx" && !tokens.includes("--no-install")) {
        return makeRefusal(executionId, "Dynamic package execution via npx without '--no-install' is strictly forbidden.");
      }
    }

    // Refuse dangerous Node flags
    for (const token of tokens.slice(1)) {
      const lower = token.toLowerCase();
      if (PROHIBITED_NODE_FLAGS.has(lower) || lower.startsWith("-e=") || lower.startsWith("--eval=")) {
        return makeRefusal(executionId, `Node.js evaluation/preload flag "${token}" is prohibited in test execution.`);
      }
    }

    const resolved = resolveCommand(cmdBase, canonicalRoot);
    if (!resolved) {
      return makeRefusal(executionId, `Failed to resolve authorized executable "${cmdBase}".`);
    }
    executableFile = resolved.file;
    childArgs = [...resolved.prefix, ...tokens.slice(1)];
  }

  // Handle Test File Target
  if (options.testFile) {
    const containment = validatePathContainment(canonicalRoot, options.testFile);
    if (!containment.ok) {
      return makeRefusal(executionId, containment.error);
    }
    if (!existsSync(containment.resolved)) {
      return makeRefusal(executionId, `Test file does not exist: ${options.testFile}`);
    }

    // Extension check
    const hasAuthorizedExt = [...AUTHORIZED_TEST_EXTENSIONS].some(e =>
      containment.resolved.toLowerCase().endsWith(e),
    );
    const ext = extname(containment.resolved).toLowerCase();
    if (!hasAuthorizedExt && ext !== ".js" && ext !== ".ts") {
      return makeRefusal(executionId, `Target file "${options.testFile}" does not have an authorized test extension.`);
    }

    // Hash source test file
    try {
      const fileBytes = readFileSync(containment.resolved);
      targetArtifactSha256 = sha256(fileBytes);
    } catch (err) {
      return makeRefusal(executionId, `Failed to hash test target artifact: ${(err as Error).message}`);
    }

    // Mode A: Default to Node with locked argument template
    if (!options.command) {
      executionMode = "ModeA";
      executableFile = realpathSync(process.execPath);
      childArgs = ["--experimental-strip-types", "--test", containment.resolved];
    }
  }

  // Pre-execution report baseline tracking (for freshness verification)
  let preLaunchReportExists = false;
  let preLaunchReportSha256: string | null = null;
  let preLaunchReportMtimeMs = 0;
  let validatedReportPath: string | null = null;

  if (options.reportFile) {
    const reportContainment = validatePathContainment(canonicalRoot, options.reportFile);
    if (!reportContainment.ok) {
      return makeRefusal(executionId, `Report path invalid: ${reportContainment.error}`);
    }
    validatedReportPath = reportContainment.resolved;
    if (existsSync(validatedReportPath)) {
      preLaunchReportExists = true;
      try {
        const rStat = statSync(validatedReportPath);
        preLaunchReportMtimeMs = rStat.mtimeMs;
        preLaunchReportSha256 = sha256(readFileSync(validatedReportPath));
      } catch {}
    }
  }

  // Signal check prior to launch
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
      mode: executionMode,
    };
  }

  // Environment sanitization
  const cleanEnv = sanitizeTestEnvironment(options.env ?? process.env);

  // Execute process with strict stdio pipe capture
  return new Promise<DeterministicTestResult>((resolvePromise) => {
    let child: ChildProcess;
    try {
      child = spawn(executableFile, childArgs, {
        cwd: canonicalRoot,
        shell: false,
        windowsHide: true,
        env: cleanEnv,
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
        mode: executionMode,
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
        mode: executionMode,
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

      // Report file post-execution evaluation
      let reportSha256: string | null = null;
      let reportMissing = false;
      let reportFailureReason: string | null = null;

      if (options.reportFile && validatedReportPath) {
        if (!existsSync(validatedReportPath)) {
          reportMissing = true;
          reportFailureReason = `Required test report file "${options.reportFile}" was missing.`;
        } else {
          try {
            const reportStat = statSync(validatedReportPath);
            if (reportStat.size === 0) {
              reportMissing = true;
              reportFailureReason = `Required test report file "${options.reportFile}" was empty (0 bytes).`;
            } else if (reportStat.size > MAX_TEST_REPORT_BYTES) {
              reportMissing = true;
              reportFailureReason = `Required test report file "${options.reportFile}" exceeds maximum limit (${MAX_TEST_REPORT_BYTES} bytes).`;
            } else {
              const reportBytes = readFileSync(validatedReportPath);
              const currentHash = sha256(reportBytes);

              // Freshness check: must have been modified or created during this execution
              const isStale =
                preLaunchReportExists &&
                currentHash === preLaunchReportSha256 &&
                reportStat.mtimeMs <= preLaunchReportMtimeMs;

              if (isStale) {
                reportMissing = true;
                reportFailureReason = `Test report "${options.reportFile}" was not created or updated by this run (stale evidence).`;
              } else {
                // Validate report schema if JSON
                if (options.reportFile.toLowerCase().endsWith(".json")) {
                  try {
                    const parsed = JSON.parse(reportBytes.toString("utf8"));
                    if (!parsed || typeof parsed !== "object") {
                      reportMissing = true;
                      reportFailureReason = `Test report "${options.reportFile}" is malformed JSON.`;
                    } else if (typeof parsed.failed === "number" && parsed.failed > 0) {
                      reportMissing = true;
                      reportFailureReason = `Test report indicates ${parsed.failed} failed test(s).`;
                    } else if (options.requireAssertions && typeof parsed.passed === "number" && parsed.passed === 0) {
                      reportMissing = true;
                      reportFailureReason = `Test report specifies 0 passed assertions; acceptance contract requires executed assertions.`;
                    }
                  } catch (e) {
                    reportMissing = true;
                    reportFailureReason = `Failed to parse test report JSON: ${(e as Error).message}`;
                  }
                }
                if (!reportMissing) {
                  reportSha256 = currentHash;
                }
              }
            }
          } catch (err) {
            reportMissing = true;
            reportFailureReason = `Failed to read report file: ${(err as Error).message}`;
          }
        }
      }

      // Check for zero assertions / zero tests discovered when assertions are required
      let zeroAssertionsDetected = false;
      if (options.requireAssertions) {
        const combinedOut = stdout + "\n" + stderr;
        if (/ℹ\s*tests\s+0\b/i.test(combinedOut) || /ℹ\s*pass\s+0\b/i.test(combinedOut)) {
          zeroAssertionsDetected = true;
        }
      }

      const stdoutSha256 = sha256(stdout);
      const stderrSha256 = sha256(stderr);

      // Strict acceptance rules
      const pass =
        terminalState === "exited" &&
        code === 0 &&
        !truncated &&
        !reportMissing &&
        !zeroAssertionsDetected;

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
        reason = reportFailureReason ?? `Required test report file "${options.reportFile}" was missing or invalid.`;
      } else if (zeroAssertionsDetected) {
        reason = "Test process discovered and executed zero assertions; acceptance contract requires executed tests.";
      }

      const receipt = pass
        ? `receipt:test-exec:${executionId}:${stdoutSha256}${reportSha256 ? `:${reportSha256}` : ""}`
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
        mode: executionMode,
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

/** Verifies that a persisted test receipt remains fresh against the target artifact hash and report hash. */
export function verifyTestReceipt(params: {
  receipt: string | null;
  recordedArtifactHash?: string | null;
  currentArtifactHash?: string | null;
  recordedReportHash?: string | null;
  currentReportHash?: string | null;
}): { verified: boolean; reason: string } {
  if (!params.receipt || !params.receipt.startsWith("receipt:test-exec:")) {
    return { verified: false, reason: "Missing or invalid test execution receipt format." };
  }
  if (params.recordedArtifactHash && params.currentArtifactHash) {
    if (params.recordedArtifactHash !== params.currentArtifactHash) {
      return { verified: false, reason: "Receipt artifact version is stale; target file was modified." };
    }
  }
  if (params.recordedReportHash && params.currentReportHash) {
    if (params.recordedReportHash !== params.currentReportHash) {
      return { verified: false, reason: "Receipt report version is stale; report file was modified." };
    }
  }
  return { verified: true, reason: "Test execution receipt verified against artifact hash." };
}
