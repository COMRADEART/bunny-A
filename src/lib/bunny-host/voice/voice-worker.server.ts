/**
 * M-A-3 T10: the Host side of the voice worker transport.
 *
 * The worker exe owns the microphone and speaker handles. It runs inside a Bunny-owned Windows job (OwnedProcessGroup,
 * kill-on-close) and speaks JSON lines: commands on stdin, events on stdout. This module verifies the exe before it
 * starts, frames stdout with bounded buffers, and accounts stdin bytes so the group's cumulative budget is respected.
 * Nothing here is reachable from HTTP; test-only worker flags come in through the constructor options.
 */
import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { cpus } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { OwnedProcessGroup, outputPipe, type OwnedSnapshot } from "../owned-process-group.server.ts";
import type { WorkerCommand, WorkerEvent } from "./voice-protocol.ts";

export const WORKER_RELATIVE = "native/voice/bunny-voice-worker.exe";
export const WORKER_RECORD_RELATIVE = "native/voice/bunny-voice-worker.json";
export const WORKER_SOURCE_RELATIVE = "native/voice/BunnyVoiceWorker.cs";
export const MAX_LINE_BYTES = 64 * 1024;
export const MAX_BUFFERED_BYTES = 256 * 1024;

export class VoiceWorkerError extends Error {
  readonly code: "WORKER_INTEGRITY" | "NOT_WINDOWS" | "WORKER_EXITED" | "INTERNAL";
  constructor(code: "WORKER_INTEGRITY" | "NOT_WINDOWS" | "WORKER_EXITED" | "INTERNAL", message: string) {
    super(message);
    this.name = "VoiceWorkerError";
    this.code = code;
  }
}

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function sourceSha256(path: string): string {
  const text = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
  return createHash("sha256").update(text).digest("hex");
}

/**
 * Refuses to launch unless the exe matches its build record. A release manifest, when present, must list the same hash.
 * Throws VoiceWorkerError("WORKER_INTEGRITY") and never starts a process.
 */
export function verifyWorkerIntegrity(root: string = repoRoot): { exePath: string; sha256: string } {
  const exePath = join(root, WORKER_RELATIVE);
  const recordPath = join(root, WORKER_RECORD_RELATIVE);
  const refuse = (detail: string) => new VoiceWorkerError("WORKER_INTEGRITY", `Voice worker integrity failed (${detail}); nothing was started.`);
  if (!existsSync(exePath) || !existsSync(recordPath)) throw refuse("worker or build record missing");
  let record: { binarySha256?: unknown; sourceSha256?: unknown; schema?: unknown };
  try {
    record = JSON.parse(readFileSync(recordPath, "utf8"));
  } catch {
    throw refuse("build record unreadable");
  }
  const actual = sha256(exePath);
  if (typeof record.binarySha256 !== "string" || record.binarySha256.toLowerCase() !== actual) throw refuse("binary hash differs from build record");
  // The record binds the LF source blob. A Windows checkout may rewrite it as CRLF.
  const sourcePath = join(root, WORKER_SOURCE_RELATIVE);
  if (typeof record.sourceSha256 !== "string" || !existsSync(sourcePath) || record.sourceSha256.toLowerCase() !== sourceSha256(sourcePath)) {
    throw refuse("worker source differs from build record");
  }
  // containment#0: a release folder carries release-manifest.json next to the Host root, and then the manifest entry is
  // checked as well. Dev layouts have no manifest: there the build record and the source hash are the only bind, and
  // this check says so instead of implying a release guarantee. Packaging (scripts/package-bunny-desktop.ps1) writes the
  // manifest; a release folder whose manifest was deleted is not refused here (it is a same-user write, out of F04 scope).
  const manifestPath = join(root, "release-manifest.json");
  if (existsSync(manifestPath)) {
    let manifest: { files?: { path: string; sha256: string }[] };
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch {
      throw refuse("release manifest unreadable");
    }
    const entry = manifest.files?.find((file) => file.path === WORKER_RELATIVE);
    if (!entry || entry.sha256.toLowerCase() !== actual) throw refuse("release manifest does not list this worker");
  }
  return { exePath, sha256: actual };
}

// ---------------------------------------------------------------------------------------------------------------------
// Speech recognizer selection (whisper.cpp when the pinned runtime is staged and verified; Windows SAPI otherwise).
// ---------------------------------------------------------------------------------------------------------------------

export const WHISPER_PIN_RELATIVE = "native/voice/whisper-pin.json";
export const WHISPER_RUNTIME_RELATIVE = "native/voice/vendor/runtime";
export const WHISPER_SHIM_FILE = "bunny-whisper-shim.dll";
export const WHISPER_MODEL_DIRECTORY = "models";
const RELEASE_MANIFEST = "release-manifest.json";
const HEX64 = /^[0-9a-fA-F]{64}$/;
const SAFE_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** The committed pin (native/voice/whisper-pin.json, written by the native lane's stage script). */
export type WhisperPin = {
  schema: "bunny-whisper-pin/1";
  version: string;
  commit: string;
  model: { name: string; sha256: string; size: number };
  runtimeFiles: Record<string, string>;
};

export type SpeechEngineSelection = { engine: "whisper"; args: string[] } | { engine: "sapi"; reason: string | null };

/** The notice the Host shows when whisper was configured but cannot be used. Never silent. */
export function whisperFallbackMessage(reason: string): string {
  return `whisper unavailable: ${reason}; using Windows SAPI`;
}

/** Threads for whisper: half the logical processors, clamped to 2..4. */
export function whisperThreads(cpuCount: number): number {
  return Math.min(4, Math.max(2, Math.floor(cpuCount / 2)));
}

function sha256File(path: string): string {
  const hash = createHash("sha256");
  const fd = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(1024 * 1024);
    for (;;) {
      const read = readSync(fd, buffer, 0, buffer.length, null);
      if (read === 0) break;
      hash.update(buffer.subarray(0, read));
    }
  } finally {
    closeSync(fd);
  }
  return hash.digest("hex");
}

/** The model is large (about 148 MB): its hash is kept per Host run, keyed by path, size and mtime. */
const modelHashes = new Map<string, { size: number; mtimeMs: number; sha256: string }>();
function modelSha256(path: string): { sha256: string; size: number } {
  const stat = statSync(path);
  const cached = modelHashes.get(path);
  if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) return { sha256: cached.sha256, size: stat.size };
  const sha256 = sha256File(path);
  modelHashes.set(path, { size: stat.size, mtimeMs: stat.mtimeMs, sha256 });
  return { sha256, size: stat.size };
}

function readPin(path: string): WhisperPin {
  const value = JSON.parse(readFileSync(path, "utf8")) as Partial<WhisperPin>;
  if (value.schema !== "bunny-whisper-pin/1") throw new Error("schema");
  const model = value.model;
  if (!model || typeof model.name !== "string" || !SAFE_FILE_NAME.test(model.name) || typeof model.sha256 !== "string" || !HEX64.test(model.sha256) || typeof model.size !== "number") {
    throw new Error("model entry");
  }
  const runtime = value.runtimeFiles;
  if (!runtime || typeof runtime !== "object" || Array.isArray(runtime) || Object.keys(runtime).length === 0) throw new Error("runtimeFiles");
  for (const [name, sha] of Object.entries(runtime)) {
    if (!SAFE_FILE_NAME.test(name) || name === WHISPER_SHIM_FILE || typeof sha !== "string" || !HEX64.test(sha)) throw new Error(`runtime entry ${name}`);
  }
  return value as WhisperPin;
}

/**
 * Chooses the recognizer for the next worker launch. whisper is selected only when every pinned file matches: the runtime
 * DLLs, the shim (against the build record) and the model. In a release layout (release-manifest.json present) every
 * whisper file must also be listed there with the same hash. Any other state returns SAPI with a reason. Never throws.
 * Without a pin (a source that predates whisper) the answer is SAPI with no reason.
 */
export function selectSpeechEngine(root: string = repoRoot, options: { cpuCount?: number } = {}): SpeechEngineSelection {
  const pinPath = join(root, WHISPER_PIN_RELATIVE);
  if (!existsSync(pinPath)) return { engine: "sapi", reason: null };
  const fail = (reason: string): SpeechEngineSelection => ({ engine: "sapi", reason });
  try {
    const runtimeDir = join(root, WHISPER_RUNTIME_RELATIVE);
    if (!existsSync(runtimeDir)) return fail("runtime not staged");
    let pin: WhisperPin;
    try {
      pin = readPin(pinPath);
    } catch {
      return fail("pin unreadable");
    }
    let record: { whisperShim?: { binarySha256?: unknown } };
    try {
      record = JSON.parse(readFileSync(join(root, WORKER_RECORD_RELATIVE), "utf8"));
    } catch {
      return fail("worker build record unreadable");
    }
    const shimExpected = record.whisperShim?.binarySha256;
    if (typeof shimExpected !== "string" || !HEX64.test(shimExpected)) return fail("shim not recorded in the build record");

    // Nothing unlisted may sit in the runtime folder: an extra DLL would be loaded by name.
    const expected = new Set([...Object.keys(pin.runtimeFiles), WHISPER_SHIM_FILE, WHISPER_MODEL_DIRECTORY]);
    for (const name of readdirSync(runtimeDir)) if (!expected.has(name)) return fail(`unlisted runtime file ${name}`);

    type Check = { name: string; relative: string; path: string; sha256: string };
    const runtimeRelative = (name: string) => `${WHISPER_RUNTIME_RELATIVE}/${name}`;
    const checks: Check[] = [
      { name: "whisper pin", relative: WHISPER_PIN_RELATIVE, path: pinPath, sha256: "" },
      ...Object.entries(pin.runtimeFiles).map(([name, sha256]) => ({ name, relative: runtimeRelative(name), path: join(runtimeDir, name), sha256 })),
      { name: WHISPER_SHIM_FILE, relative: runtimeRelative(WHISPER_SHIM_FILE), path: join(runtimeDir, WHISPER_SHIM_FILE), sha256: shimExpected },
    ];
    const hashes = new Map<string, string>();
    for (const check of checks) {
      if (!existsSync(check.path)) return fail(`${check.name} missing`);
      const actual = sha256File(check.path);
      if (check.sha256 && actual !== check.sha256.toLowerCase()) return fail(`${check.name} differs from the pin`);
      hashes.set(check.relative, actual);
    }
    // The model comes last so a broken DLL never costs a 148 MB hash.
    const modelPath = join(runtimeDir, WHISPER_MODEL_DIRECTORY, pin.model.name);
    if (!existsSync(modelPath)) return fail("model missing");
    const model = modelSha256(modelPath);
    if (model.size !== pin.model.size) return fail("model size differs from the pin");
    if (model.sha256 !== pin.model.sha256.toLowerCase()) return fail("model differs from the pin");
    hashes.set(runtimeRelative(`${WHISPER_MODEL_DIRECTORY}/${pin.model.name}`), model.sha256);

    // containment#0 for whisper: a release folder lists every whisper file with the same hash, or whisper is refused.
    const manifestPath = join(root, RELEASE_MANIFEST);
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { files?: { path: string; sha256: string }[] };
      const listed = new Map((manifest.files ?? []).map((file) => [file.path, String(file.sha256).toLowerCase()]));
      for (const [relative, sha256] of hashes) {
        if (listed.get(relative) !== sha256) return fail(`release manifest does not list ${relative.split("/").pop()} with this hash`);
      }
    }

    const threads = whisperThreads(options.cpuCount ?? cpus().length);
    return {
      engine: "whisper",
      args: ["--stt", "whisper", "--whisper-dir", resolve(runtimeDir), "--whisper-model", resolve(modelPath), "--whisper-threads", String(threads)],
    };
  } catch (error) {
    return fail(`verification error (${error instanceof Error ? error.name : "unknown"})`);
  }
}

/**
 * H6: the least-privilege environment the worker inherits. Nothing else from the Host environment reaches it: no API
 * keys, tokens, provider settings or Bunny data paths. Names are matched case-insensitively (Windows semantics).
 * PATH is replaced by the Windows system directories only.
 * privacy#2: narrowed empirically against the real worker (voice-worker-containment.test.ts, synthesized fixture turn).
 * SystemRoot and windir are the set that passed reliably; profile, user, temp and drive variables were not needed by the
 * worker's recognition path. Dropped: USERPROFILE, APPDATA, LOCALAPPDATA, HOMEDRIVE, HOMEPATH, USERNAME, COMPUTERNAME,
 * PUBLIC, TEMP, TMP, SystemDrive and the rest. Playback to a real device was not exercised (test fixtures use --output null).
 */
export const WORKER_ENV_ALLOWLIST = ["SystemRoot", "windir"] as const;

export function workerEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const byName = new Map<string, string>();
  for (const [key, value] of Object.entries(source)) if (typeof value === "string") byName.set(key.toUpperCase(), value);
  const env: NodeJS.ProcessEnv = {};
  for (const name of WORKER_ENV_ALLOWLIST) {
    const value = byName.get(name.toUpperCase());
    if (value !== undefined) env[name] = value;
  }
  const systemRoot = env.SystemRoot ?? env.windir ?? "C:\\Windows";
  env.PATH = [`${systemRoot}\\System32`, systemRoot, `${systemRoot}\\System32\\Wbem`, `${systemRoot}\\System32\\WindowsPowerShell\\v1.0`].join(";");
  return env;
}

/** Parses one stdout line into a WorkerEvent. Unknown or malformed lines return null (counted by the caller). */
export function parseWorkerEvent(line: string): WorkerEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const event = value as Record<string, unknown>;
  if (typeof event.ev !== "string" || typeof event.t !== "number" || typeof event.mono !== "number") return null;
  return event as WorkerEvent;
}

/** Bounded line framer for stdout bytes. Overlong lines and an overfull buffer are reported once and dropped. */
export class LineFramer {
  private buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  /** True between an overflow and the newline that ends the overlong line (containment#4). */
  private discarding = false;
  overflowed = 0;

  private readonly onLine: (line: string) => void;
  private readonly maxLine: number;
  private readonly maxBuffered: number;

  constructor(onLine: (line: string) => void, maxLine = MAX_LINE_BYTES, maxBuffered = MAX_BUFFERED_BYTES) {
    this.onLine = onLine;
    this.maxLine = maxLine;
    this.maxBuffered = maxBuffered;
  }

  push(chunk: Buffer) {
    let rest = chunk;
    while (rest.length > 0) {
      const index = rest.indexOf(0x0a);
      if (this.discarding) {
        // containment#4: the tail of an overlong line is dropped up to its newline, across chunks, never framed as a line.
        if (index < 0) return;
        this.discarding = false;
        rest = rest.subarray(index + 1);
        continue;
      }
      if (index < 0) {
        this.buffer = this.buffer.length === 0 ? Buffer.from(rest) : Buffer.concat([this.buffer, rest]);
        if (this.buffer.length > this.maxLine || this.buffer.length > this.maxBuffered) {
          this.overflowed += 1;
          this.buffer = Buffer.alloc(0);
          this.discarding = true;
        }
        return;
      }
      let line = Buffer.concat([this.buffer, rest.subarray(0, index)]);
      this.buffer = Buffer.alloc(0);
      rest = rest.subarray(index + 1);
      if (line.length > this.maxLine) {
        this.overflowed += 1;
        continue;
      }
      if (line.length && line[line.length - 1] === 0x0d) line = line.subarray(0, -1);
      if (line.length) this.onLine(line.toString("utf8"));
    }
  }
}

/** The worker surface the session manager uses. Tests implement it with a fake; production uses VoiceWorkerProcess. */
export interface VoiceWorkerPort {
  readonly id: string;
  /** Cumulative stdin bytes written to this worker process. */
  readonly stdinBytes: number;
  send(command: WorkerCommand): void;
  onEvent(listener: (event: WorkerEvent) => void): void;
  /** Resolves with the exit code once the process is gone (or null when unknown). */
  readonly exited: Promise<number | null>;
  /** Set when whisper was configured but this launch runs Windows SAPI: the notice the session shows after ready. */
  readonly sttNotice?: string | null;
  /** Graceful shutdown, bounded wait, then forced termination of the whole job. Idempotent. */
  close(): Promise<void>;
}

export type VoiceWorkerLaunchOptions = {
  dataDirectory: string;
  /** Extra worker args. Test-only (fixture input, output sink). Never derived from HTTP. */
  extraArgs?: string[];
  root?: string;
  /** Milliseconds to wait for a graceful shutdown before termination. */
  shutdownGraceMs?: number;
  /** Failures in the Windows containment layer are surfaced as INTERNAL. */
  onProtocolError?: (detail: string) => void;
};

/** One contained worker process. Construct only through `launchVoiceWorker`. */
export class VoiceWorkerProcess implements VoiceWorkerPort {
  readonly id = randomUUID();
  stdinBytes = 0;
  /** H9: kernel accounting of the job taken at close, before the group drops its handle. Null when it could not be read. */
  closeAccounting: { activeProcesses: number | null; graceful: boolean } | null = null;
  readonly exited: Promise<number | null>;
  /** See VoiceWorkerPort.sttNotice. Null when whisper is in use or was never configured. */
  sttNotice: string | null = null;
  private listeners: ((event: WorkerEvent) => void)[] = [];
  private closed = false;
  private resolveExit!: (code: number | null) => void;
  private poll: ReturnType<typeof setInterval> | null = null;

  private readonly group: OwnedProcessGroup;
  private readonly shutdownGraceMs: number;
  private readonly report: (detail: string) => void;

  constructor(group: OwnedProcessGroup, shutdownGraceMs: number, report: (detail: string) => void) {
    this.group = group;
    this.shutdownGraceMs = shutdownGraceMs;
    this.report = report;
    this.exited = new Promise((resolve) => (this.resolveExit = resolve));
    this.poll = setInterval(() => {
      let snapshot: OwnedSnapshot;
      try {
        snapshot = this.group.inspect();
      } catch (error) {
        // containment#0: an unreadable job is unknown state, not an exit. The root may still hold the microphone, so the
        // job is terminated and its handle closed before the exit is reported.
        this.report(`poll failed: ${error instanceof Error ? error.message : String(error)}`);
        this.settleUnknown();
        return;
      }
      if (snapshot.exitCode !== null) this.finish(snapshot.exitCode);
    }, 250);
    this.poll.unref?.();
  }

  onEvent(listener: (event: WorkerEvent) => void) {
    this.listeners.push(listener);
  }

  /** Writes one JSON line. Refused once the process is gone; stdin accounting is checked by the session before sending. */
  send(command: WorkerCommand) {
    if (this.closed) throw new VoiceWorkerError("WORKER_EXITED", "The voice worker is not running.");
    const line = Buffer.from(JSON.stringify(command) + "\n", "utf8");
    this.group.writeInput(line);
    this.stdinBytes += line.length;
  }

  /** Called by the stdout framer for each complete line. */
  dispatchLine(line: string) {
    const event = parseWorkerEvent(line);
    if (!event) {
      this.report("unparseable worker line");
      return;
    }
    for (const listener of this.listeners) {
      // containment#5: a malformed or unexpected event must not throw into the stdout data handler (the Host's fatal path).
      try {
        listener(event);
      } catch (error) {
        this.report(`worker event rejected (${event.ev}): ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  async close(): Promise<void> {
    if (this.closed) return this.exited.then(() => undefined);
    try {
      const shutdown = Buffer.from(JSON.stringify({ op: "shutdown" }) + "\n", "utf8");
      this.group.writeInput(shutdown);
      this.stdinBytes += shutdown.length;
    } catch {
      /* stdin already gone: fall through to termination */
    }
    const graceful = await Promise.race([this.exited.then(() => true), new Promise<false>((done) => setTimeout(() => done(false), this.shutdownGraceMs))]);
    if (!graceful) this.group.terminate();
    this.closed = true;
    this.closeAccounting = { activeProcesses: this.readActiveProcesses(), graceful };
    try {
      this.group.close(graceful ? "succeeded" : "stopped");
    } catch (error) {
      this.report(`close failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    this.finish(this.group.inspectHistory().exitCode);
  }

  /** Kills every member of the job now, orphaned descendants included. Returns kernel ActiveProcesses. Not HTTP-reachable. */
  terminateJob(): number {
    return this.group.terminate();
  }

  /** Test and diagnostics surface: kernel accounting of the job, or null if it cannot be read. */
  inspectJob(): OwnedSnapshot | null {
    try {
      return this.group.inspect();
    } catch {
      return null;
    }
  }

  private readActiveProcesses(): number | null {
    try {
      return this.group.inspect().activeProcesses;
    } catch {
      return null;
    }
  }

  /** Kernel-level settle when the job cannot be inspected: terminate every member, close the handle, then report the exit. */
  private settleUnknown() {
    this.closed = true;
    try {
      this.group.terminate();
    } catch {
      /* the close below still releases the handle; kill-on-close ends the job */
    }
    try {
      this.group.close("failed");
    } catch (error) {
      this.report(`close after unknown state failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    this.finish(null);
  }

  private finish(code: number | null) {
    if (this.poll) clearInterval(this.poll);
    this.poll = null;
    this.resolveExit(code);
  }
}

/**
 * Verifies the exe, then starts it contained (suspended admission into the job, interactive stdin, two output pipes).
 * Refused on non-Windows: there is no uncontained fallback.
 */
export async function launchVoiceWorker(options: VoiceWorkerLaunchOptions): Promise<VoiceWorkerProcess> {
  if (process.platform !== "win32") throw new VoiceWorkerError("NOT_WINDOWS", "Voice requires the Windows Host; no uncontained worker is started.");
  // Early refusal before any pipe exists. The exe is verified again below, after the awaits, and spawned in the same tick.
  verifyWorkerIntegrity(options.root);
  const report = options.onProtocolError ?? (() => {});
  let worker: VoiceWorkerProcess | null = null;
  const framer = new LineFramer((line) => worker?.dispatchLine(line));
  let stderrTail = "";
  const out = await outputPipe((chunk) => framer.push(chunk));
  const err = await outputPipe((chunk) => {
    stderrTail = (stderrTail + chunk.toString("utf8")).slice(-4000);
  });
  // native#1: the hash is taken after the awaits, and the spawn follows with no await in between, so a swap during the
  // pipe setup cannot reach the process. Residual: a same-user writer racing the synchronous hash-to-CreateProcess gap is
  // the same-user class that F04 places out of contract.
  const { exePath } = verifyWorkerIntegrity(options.root);
  // The recognizer is chosen after the awaits too: the whisper DLLs and shim are re-hashed right before the spawn, and the
  // model is re-checked by its cached stat. Any failure selects SAPI with a reason; it never blocks the launch.
  const speech = selectSpeechEngine(options.root ?? repoRoot);
  const group = new OwnedProcessGroup(exePath, options.root ?? repoRoot, { action: "voice.worker", dataDirectory: options.dataDirectory });
  const contained = new VoiceWorkerProcess(group, options.shutdownGraceMs ?? 2_000, report);
  contained.sttNotice = speech.engine === "sapi" && speech.reason !== null ? whisperFallbackMessage(speech.reason) : null;
  worker = contained;
  const speechArgs = speech.engine === "whisper" ? speech.args : [];
  try {
    group.spawn(exePath, [...(options.extraArgs ?? []), ...speechArgs], options.root ?? repoRoot, workerEnvironment(process.env), out.name, err.name, true);
  } catch (error) {
    // containment#1: a post-launch failure leaves the root running inside the job. It is settled here by terminating the job
    // and closing the handle (kill-on-close), so no contained process outlives the refused launch.
    if (error && typeof error === "object" && (error as { launched?: unknown }).launched === true) {
      try {
        group.terminate();
      } catch {
        /* close below still releases the handle */
      }
      try {
        group.close("failed");
      } catch (closeError) {
        report(`settle after failed launch: ${closeError instanceof Error ? closeError.message : String(closeError)}`);
      }
    }
    await Promise.all([out.close(), err.close()]);
    throw new VoiceWorkerError("INTERNAL", `Voice worker could not be contained: ${error instanceof Error ? error.message : String(error)}`);
  }
  contained.exited.then(() => {
    void Promise.all([out.close(), err.close()]);
  });
  return contained;
}
