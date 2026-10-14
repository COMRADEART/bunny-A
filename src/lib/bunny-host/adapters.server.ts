import { execFile, spawn, type ChildProcess } from "node:child_process";
import { statSync } from "node:fs";
import { promisify } from "node:util";
import { execute, probeOllama, stopTask } from "../orch/exec.server.ts";
import type { OrchTask, ProviderFeatures, ProviderId, ProviderLive, UsageWindow } from "../orch/types.ts";
import { CODEX_COMPATIBILITY_MAX_AGE_MS, CODEX_SECURITY_POLICY_VERSION, codexMissionExclusion } from "../orch/compatibility.ts";
import type { AdapterHooks, AdapterResult, ProviderAdapter, RunningSession, SessionContainment } from "./contracts.ts";
import { probeCodexCatalog } from "./codex-probe.server.ts";
import { scrubChildEnvironment } from "./connections.ts";
import type { NativeAccount } from "./connections.server.ts";
import { CODEX_READ_DISABLED_FEATURES, CodexCompatibilityGate, emptyCodexCompatibility, executableStamp } from "./codex-compatibility.server.ts";
export { CODEX_READ_DISABLED_FEATURES } from "./codex-compatibility.server.ts";
import { hasTool, locate, systemContext, type DiscoveryContext, type Launchable } from "./discovery.server.ts";
import { ClaudeNormalizer, CodexNormalizer, normalizedTool as toolType } from "./events.ts";
import { safeError } from "./failure.server.ts";
import { trackOwnedChild } from "./owned-processes.server.ts";
import { OwnedProcessGroup, outputPipe, runWindowsOwnedProcess, type OwnedProcessRecord } from "./owned-process-group.server.ts";
import { systemTool } from "./system-tools.server.ts";

const exec = promisify(execFile);
export const normalizedTool = toolType;
const NAMES: Record<ProviderId, string> = { codex: "Codex", claude: "Claude Code", ollama: "Ollama", opencode: "OpenCode", cline: "Cline", cursor: "Cursor Agent" };

/** Compatibility helper: the resolved launch target for a provider id, or null. */
export function resolveExecutable(name: string): string | null {
  return name in NAMES ? locate(systemContext(), name as ProviderId).launch?.path ?? null : null;
}

function unsupported(note: string) { return { supported: false, note }; }
function supported(note: string) { return { supported: true, note }; }
const HEADLESS = "Headless session owned by Bunny-A Host: there is no console window or TTY to attach to.";
export const FEATURES: Record<ProviderId, ProviderFeatures> = {
  codex: {
    launch: supported("codex exec --json in the approved project folder (workspace-write sandbox)."),
    stop: supported("Ends the owned codex.exe process tree and verifies no recorded process remains."),
    sendInput: unsupported("codex exec reads the prompt once from stdin, which then closes."),
    approval: unsupported("Approval happens in Bunny-A before launch; codex exec does not surface mid-run approval requests."),
    resume: unsupported("Not implemented by Bunny-A."),
    modelSelection: supported("Model chosen from the installed CLI's app-server catalogue."),
    terminalAttachment: unsupported(HEADLESS),
    usageQuota: supported("Official short-window and weekly limits from codex app-server account/rateLimits/read."),
    projectAwareness: supported("Runs with --cd set to the approved project root."),
  },
  claude: {
    launch: supported("claude --print --output-format stream-json in the approved project folder."),
    stop: supported("Ends the owned claude.exe process tree and verifies no recorded process remains."),
    sendInput: unsupported("The prompt is written to stdin once, which then closes."),
    approval: unsupported("Read, Write, Edit, Bash and (on Windows) PowerShell are pre-authorized when you approve the task; anything else that would prompt is denied immediately (--permission-prompts none), never left waiting."),
    resume: unsupported("Not implemented by Bunny-A."),
    modelSelection: unsupported("Uses Claude Code's default model for the signed-in account; the session reports which model ran."),
    terminalAttachment: unsupported(HEADLESS),
    usageQuota: supported("Claude Code reports its 5-hour and weekly utilization inside each session stream (rate_limit_event); Bunny-A shows the latest report with its time."),
    projectAwareness: supported("Runs with its working directory set to the approved project root."),
  },
  ollama: {
    launch: supported("POST /api/generate on the local Ollama service."),
    stop: supported("Aborts the streaming HTTP generation."),
    sendInput: unsupported("A generation is a single request."),
    approval: unsupported("Text generation only; there are no tool calls to approve."),
    resume: unsupported("A stopped generation cannot be resumed."),
    modelSelection: supported("Installed models from /api/tags."),
    terminalAttachment: unsupported("Ollama runs as a local service; no per-task terminal exists."),
    usageQuota: unsupported("Local model: no subscription quota."),
    projectAwareness: unsupported("Text only; it does not read or write the project folder."),
  },
  opencode: detectOnly("OpenCode"),
  cline: detectOnly("Cline"),
  cursor: detectOnly("Cursor Agent"),
};
function detectOnly(name: string): ProviderFeatures {
  const none = unsupported(`Bunny-A has no ${name} execution adapter yet.`);
  return { launch: none, stop: none, sendInput: none, approval: none, resume: none, modelSelection: none, terminalAttachment: none, usageQuota: none, projectAwareness: none };
}

export function providerBase(id: ProviderId): ProviderLive {
  return {
    id, name: NAMES[id], availability: "not_installed", installed: false, authenticated: false, authenticatedState: "unknown",
    local_or_cloud: id === "ollama" ? "local" : "cloud", supported_task_types: ["coding", "debug", "writing", "ops", "research", "general"],
    current_model: null, models: [], usage: null, usage_note: "Usage unavailable", active_jobs: 0, latency_estimate_ms: null,
    extension: ["cline", "cursor", "opencode"].includes(id), detail: "Not detected on this workstation.", vram: null, tokens_per_sec: null,
    executable: null, version: null, capabilities: [], usageWindows: [], usageObservedAt: null, usage_failed_at: null, usage_error: null, features: FEATURES[id],
    usageCapabilities: { shortWindow: false, weekly: false, resetTime: false, tokenUsage: false, activeJobs: true, source: "none" },
    probedAt: null, evidence: [],
  };
}

type ProbeResult = { code: number | null; stdout: string; stderr: string; timedOut: boolean; error?: string };
/** Runs a provider CLI directly (no shell) with a hard timeout and closed stdin. */
export function probe(launch: Launchable, args: string[], timeout = 15000): Promise<ProbeResult> {
  const env = scrubChildEnvironment(process.env).env;
  // M-A-3 T9R-F04: on Windows a probe runs in its own Bunny-owned job (NUL stdin); refused if containment is unavailable.
  if (process.platform === "win32") return runWindowsOwnedProcess(launch.command, [...launch.args, ...args], { cwd: process.cwd(), signal: new AbortController().signal, timeoutMs: timeout, maxOutput: 64 * 1024, env, owner: { action: "provider.probe" } })
    .then((result): ProbeResult => ({ code: result.timedOut ? null : result.exitCode, stdout: result.stdout, stderr: result.stderr, timedOut: result.timedOut }))
    .catch((error: unknown): ProbeResult => ({ code: null, stdout: "", stderr: "", timedOut: false, error: `Containment unavailable — probe refused: ${safeError(error).message}` }));
  return new Promise((resolve) => {
    const child = trackOwnedChild(execFile(launch.command, [...launch.args, ...args], { timeout, windowsHide: true, maxBuffer: 1024 * 1024, env }, (error, stdout, stderr) => {
      const failure = error as (NodeJS.ErrnoException & { killed?: boolean; code?: number | string }) | null;
      resolve({
        code: failure ? (typeof failure.code === "number" ? failure.code : null) : 0,
        stdout: String(stdout), stderr: String(stderr), timedOut: !!failure?.killed,
        error: failure && typeof failure.code !== "number" ? failure.message.split("\n")[0] : undefined,
      });
    }));
    child.stdin?.end();
  });
}
const firstLine = (text: string) => text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "";
const ESC = String.fromCharCode(27);
/** Removes terminal colour codes (ESC [ … m) that some CLIs print even when piped. */
const stripAnsi = (text: string) => text.split(ESC).map((part, index) => (index ? part.replace(/^\[[0-9;]*m/, "") : part)).join("");
function fingerprint(path: string | null | undefined): string | null {
  if (!path) return null;
  try { const stat = statSync(path); return `${stat.size}:${stat.mtimeMs}`; } catch { return null; }
}

/** Shared by CLI adapters: cheap health keeps the last full probe while the executable is unchanged. */
abstract class CliBase {
  ctx: () => DiscoveryContext;
  launchTarget: Launchable | null = null;
  print: string | null = null;
  constructor(ctx: () => DiscoveryContext) { this.ctx = ctx; }
  async health(previous: ProviderLive): Promise<ProviderLive | null> {
    const located = locate(this.ctx(), previous.id).launch;
    if (!located || located.path !== previous.executable || fingerprint(located.path) !== this.print) return null;
    return previous;
  }
  /** Coding-agent capabilities; git only when git itself is on this workstation's PATH. */
  agentCapabilities(): string[] {
    return ["text", "filesystem", "terminal", "tests", ...(hasTool(this.ctx(), "git") ? ["git"] : [])];
  }
  located(live: ProviderLive): Launchable | null {
    const found = locate(this.ctx(), live.id);
    live.evidence = found.checked.slice(-6);
    this.launchTarget = found.launch;
    if (!found.launch) return null;
    live.installed = true; live.executable = found.launch.path; this.print = fingerprint(found.launch.path);
    live.evidence = [...live.evidence, `Resolved via ${found.launch.source}: ${found.launch.path}`];
    return found.launch;
  }
}

export class OllamaAdapter implements ProviderAdapter {
  id = "ollama" as const;
  ctx: () => DiscoveryContext;
  constructor(ctx: () => DiscoveryContext = () => systemContext()) { this.ctx = ctx; }
  capabilities() { return FEATURES.ollama; }
  async health() { return this.detect(); }
  async detect() {
    const live = providerBase(this.id); const found = await probeOllama(); live.probedAt = Date.now();
    const located = locate(this.ctx(), this.id);
    live.executable = located.launch?.path ?? null; live.installed = found.up || !!live.executable;
    live.authenticated = found.up; live.authenticatedState = "not_required";
    live.availability = found.up && found.models.length ? "ready" : found.up ? "unavailable" : live.installed ? "offline" : "not_installed";
    live.models = found.models; live.current_model = found.models[0] ?? null; live.remoteModels = found.remote ?? [];
    live.evidence = [`GET http://127.0.0.1:11434/api/tags → ${found.up ? `${found.models.length} models${live.remoteModels.length ? `, cloud-hosted: ${live.remoteModels.join(", ")}` : ""}` : "unreachable"}`];
    live.detail = found.up ? found.models.join(", ") || "Service reachable; no models installed." : live.installed ? "Installed, but the service is unreachable at 127.0.0.1:11434." : "Not detected on this workstation.";
    if (found.up) {
      try {
        const version = await fetch("http://127.0.0.1:11434/api/version", { signal: AbortSignal.timeout(2000) });
        if (version.ok) live.version = ((await version.json()) as { version?: string }).version ?? null;
      } catch { /* Version is informational. */ }
      try {
        const response = await fetch("http://127.0.0.1:11434/api/ps", { signal: AbortSignal.timeout(2000) });
        if (response.ok) {
          const loaded = await response.json() as { models?: { name?: string; size_vram?: number; context_length?: number }[] };
          const current = loaded.models?.find((model) => model.name && found.models.includes(model.name));
          if (current) { live.current_model = current.name!; live.vram = typeof current.size_vram === "number" ? `${(current.size_vram / 1024 ** 3).toFixed(2)} GB loaded VRAM` : null; live.detail += ` Loaded: ${current.name}${typeof current.context_length === "number" ? `; context ${current.context_length}` : ""}.`; }
        }
      } catch { /* Service/model discovery remains available when /api/ps is unsupported. */ }
    }
    live.capabilities = ["text"]; live.usage_note = "Local generation; no subscription quota";
    live.usageCapabilities = { shortWindow: false, weekly: false, resetTime: false, tokenUsage: false, activeJobs: true, source: "Local model: no quota" };
    return live;
  }
  launch(task: OrchTask, hooks: AdapterHooks): RunningSession {
    const controller = new AbortController();
    const done = Promise.resolve().then(async()=>{await hooks.beforeDispatch?.();if(controller.signal.aborted)return {ok:false,stopped:true,output:"",error:"Stopped before local inference.",log:"Stopped before local inference.",receipt:null};hooks.event("agent.started", `Ollama generation requested · ${task.model}.`);return execute({ taskId: task.id, provider: this.id, model: task.model, prompt: task.prompt, localOnly: !!(task.constraints?.localOnly || task.constraints?.offlineOnly), ...(task.constraints?.contextTokens ? { numCtx: task.constraints.contextTokens } : {}), ...(task.constraints?.outputTokens ? { numPredict: task.constraints.outputTokens } : {}), ...(task.constraints?.responseFormat ? { format: task.constraints.responseFormat } : {}) }, { stream: (text) => hooks.output(text), signal: controller.signal, timeoutMs: task.maxRuntimeMs });}).then((result) => {
      // M-A-3 T11: Ollama's own final message is the receipt: served model, token counts and durations. Counts are
      // provider-reported, never estimated; when the provider sends no final message nothing is recorded.
      if (result.ok && result.receipt) {
        hooks.event("provider.receipt", JSON.stringify({ kind: "ollama-generate", ...result.receipt }));
        if (result.receipt.promptEvalCount !== null && result.receipt.evalCount !== null)
          hooks.usage?.({ inputTokens: result.receipt.promptEvalCount, outputTokens: result.receipt.evalCount, cachedInputTokens: 0, source: "ollama /api/generate final message (provider-reported counts; no cost)" });
      }
      if (result.ok) hooks.event("agent.completed", result.log); else if (!result.stopped) hooks.event("agent.error", result.error ?? result.log);
      return { ...result, output: result.output ?? "" };
    });
    return { done, stop: async () => { controller.abort(); await stopTask(task.id); }, pid: () => null };
  }
}

/**
 * Applies a normalizer's events to adapter hooks. Kept for callers that parse one event at a time;
 * live sessions keep a normalizer per session so repeated item events are not double-counted.
 */
export function parseAgentEvent(provider: ProviderId, event: Record<string, unknown>, hooks: AdapterHooks, normalizer: CodexNormalizer | ClaudeNormalizer = provider === "codex" ? new CodexNormalizer() : new ClaudeNormalizer()) {
  for (const item of normalizer.normalize(event)) {
    if (item.sessionId) hooks.session(item.sessionId, null);
    if (item.model) hooks.model?.(item.model);
    if (item.output) hooks.output(item.output);
    if (item.progress) hooks.progress?.(item.progress);
    if (item.usage) hooks.usage?.(item.usage);
    if (item.rateLimits) hooks.rateLimits?.(item.rateLimits, item.limitStatus);
    if (item.billingSource) hooks.billingSource?.(item.billingSource);
    if (item.type) hooks.event(item.type, item.detail);
  }
}

/**
 * M-A-3 T9R-F04: on Windows every Codex/Claude session runs inside a Bunny-owned Job Object, assigned at kernel
 * process creation before the root can run (native JOB_LIST + CREATE_SUSPENDED). A containment failure refuses
 * the session; it never falls back to an unowned spawn. `spawnChild` exists only for tests that inject stream
 * faults into the legacy child-process path; production callers never pass it.
 */
export function spawnSession(id: "codex" | "claude", launch: Launchable, args: string[], task: OrchTask, hooks: AdapterHooks, sessionId: string, normalizer:CodexNormalizer|ClaudeNormalizer=id === "codex" ? new CodexNormalizer() : new ClaudeNormalizer(), spawnChild:typeof spawn=spawn): RunningSession {
  if(hooks.beforeDispatch){
    let owned: RunningSession|null=null,stopped=false;
    const done=(async()=>{await hooks.beforeDispatch!();if(stopped)return {ok:false,stopped:true,output:"",error:"Stopped before provider dispatch."};owned=spawnUnwrappedSession(id,launch,args,task,{...hooks,beforeDispatch:undefined},sessionId,normalizer,spawnChild);return owned.done;})().catch(()=>({ok:false,output:"",error:"Provider dispatch refused: connection authority changed or could not be freshly verified."}));
    return {done,stop:async()=>{stopped=true;await owned?.stop();},pid:()=>owned?.pid?.()??null,
      get sendInput(){return owned?.sendInput;},
      ...(process.platform==="win32"&&spawnChild===spawn?{containment:()=>owned?.containment?.()??{mechanism:"windows-job-object" as const,state:stopped?"empty" as const:"launching" as const,admitted:false,operationId:null,rootPid:null,rootCreatedAt:null,activeProcesses:0,totalProcesses:0,terminatedAtEnd:0,detail:stopped?"Stopped before any provider process was admitted.":"Waiting for a fresh account authorization check; no provider process admitted."}}:{}),
    };
  }
  return spawnUnwrappedSession(id,launch,args,task,hooks,sessionId,normalizer,spawnChild);
}
function spawnUnwrappedSession(id: "codex" | "claude", launch: Launchable, args: string[], task: OrchTask, hooks: AdapterHooks, sessionId: string, normalizer:CodexNormalizer|ClaudeNormalizer, spawnChild:typeof spawn): RunningSession {
  if (process.platform === "win32" && spawnChild === spawn) return containedSession(id, launch, args, task, hooks, sessionId, normalizer);
  let child: ChildProcess | null = null; let stopped = false; let output = ""; let stderr = ""; let buffer = ""; let providerError: string | null = null;
  const terminate = async (userStop=false) => {
    if(userStop) stopped=true;
    if (!child || child.exitCode !== null || child.signalCode !== null || !child.pid) return;
    if (process.platform === "win32") await exec(systemTool("taskkill.exe"), ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, timeout: 2000 }).catch(() => { child?.kill(); });
    else child.kill("SIGTERM");
  };
  const fail=(error:unknown)=>{
    providerError ??= safeError(error).message;
    terminate().catch(()=>{try {child?.kill();} catch { /* Owned child already gone. */ }});
  };
  const boundary=(work:()=>void)=>{try {work();} catch(error) {fail(error);}};
  const done = new Promise<AdapterResult>((resolve) => {
    const env = hooks.childEnvironment?.() ?? scrubChildEnvironment(process.env).env;
    child = trackOwnedChild(spawnChild(launch.command, [...launch.args, ...args], { cwd: task.cwd, windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"], env }));
    const capture: AdapterHooks = {
      ...hooks,
      output: (text) => { output = (output + text + "\n").slice(-2_000_000); hooks.output(text + "\n"); },
      event: (type, detail) => { if (type === "agent.error") providerError = detail; hooks.event(type, detail); },
    };
    child.once("spawn", () => boundary(() => {
      hooks.session(id === "claude" ? sessionId : null, child!.pid ?? null);
      hooks.event("agent.started", `${NAMES[id]} process started (PID ${child!.pid}).`);
    }));
    child.stdout!.on("data", (chunk) => boundary(() => {
      if(providerError) return;
      buffer += chunk.toString(); let index: number;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index).replace(/\r$/, ""); buffer = buffer.slice(index + 1);
        if (!line.trim()) continue;
        hooks.raw?.("stdout", line);
        let parsed: Record<string, unknown> | null = null;
        try { parsed = JSON.parse(line) as Record<string, unknown>; } catch { parsed = null; }
        if (parsed) parseAgentEvent(id, parsed, capture, normalizer); else capture.output(line.slice(0, 4000));
      }
      if (buffer.length > 2_000_000) { fail(new Error("Provider event exceeds the log limit.")); buffer = ""; }
    }));
    child.stderr!.on("data", (chunk) => boundary(() => { const text = chunk.toString(); stderr = (stderr + text).slice(-16000); hooks.raw?.("stderr", text); }));
    child.stdout!.on("error",fail);child.stderr!.on("error",fail);
    child.once("error", (error) => resolve({ ok: false, output, error: safeError(error).message }));
    child.once("close", (code) => resolve({ ok: code === 0 && !stopped && !providerError, output, error: stopped ? "Stopped." : providerError ?? (code === 0 ? undefined : safeError(firstLine(stderr) || `Process exited ${code}`).message), stopped, exitCode: code }));
    child.stdin!.on("error", fail);
    child.stdin!.end(task.prompt);
  });
  const stop = () => terminate(true);
  return { done, stop, pid: () => child?.pid ?? null };
}

const CONTAINMENT_CONFIRM_MS = 30_000;
const pause = (ms: number) => new Promise<void>((done) => { setTimeout(done, ms).unref?.(); });
/**
 * M-A-3 T9R-F04 job-contained provider session. Order: Host authority was checked by the caller; the native helper
 * creates the job (KILL_ON_JOB_CLOSE, no breakaway), creates the root suspended and already assigned, verifies
 * membership, resumes it, then writes the prompt over an unnamed pipe. Root exit or Stop terminates the WHOLE job
 * (descendants of exited parents included) and the session ends only on kernel accounting, never on a sample.
 */
function containedSession(id: "codex" | "claude", launch: Launchable, args: string[], task: OrchTask, hooks: AdapterHooks, sessionId: string, normalizer: CodexNormalizer | ClaudeNormalizer): RunningSession {
  let group: OwnedProcessGroup | null = null; let stopped = false; let output = ""; let stderr = ""; let buffer = ""; let providerError: string | null = null;
  let outcome: OwnedProcessRecord["state"] = "failed"; let ending: Promise<void> | null = null; let wake: (() => void) | null = null;
  let containment: SessionContainment = { mechanism: "windows-job-object", state: "launching", admitted: false, operationId: null, rootPid: null, rootCreatedAt: null, activeProcesses: null, totalProcesses: null, terminatedAtEnd: null, detail: "Creating the Windows job before any provider process exists." };
  const settle = (patch: Partial<SessionContainment>) => { containment = { ...containment, ...patch }; };
  const fail = (error: unknown) => { providerError ??= safeError(error).message; wake?.(); };
  const boundary = (work: () => void) => { try { work(); } catch (error) { fail(error); } };
  const capture: AdapterHooks = {
    ...hooks,
    output: (text) => { output = (output + text + "\n").slice(-2_000_000); hooks.output(text + "\n"); },
    event: (type, detail) => { if (type === "agent.error") providerError = detail; hooks.event(type, detail); },
  };
  const onStdout = (chunk: Buffer) => boundary(() => {
    if (providerError) return;
    buffer += chunk.toString(); let index: number;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index).replace(/\r$/, ""); buffer = buffer.slice(index + 1);
      if (!line.trim()) continue;
      hooks.raw?.("stdout", line);
      let parsed: Record<string, unknown> | null = null;
      try { parsed = JSON.parse(line) as Record<string, unknown>; } catch { parsed = null; }
      if (parsed) parseAgentEvent(id, parsed, capture, normalizer); else capture.output(line.slice(0, 4000));
    }
    if (buffer.length > 2_000_000) { fail(new Error("Provider event exceeds the log limit.")); buffer = ""; }
  });
  const onStderr = (chunk: Buffer) => boundary(() => { const text = chunk.toString(); stderr = (stderr + text).slice(-16000); hooks.raw?.("stderr", text); });
  /**
   * Terminates every job member until kernel ActiveProcesses is 0. Native terminate never blocks: it issues
   * TerminateJobObject and returns accounting at once; this loop polls (review round 1, NATIVE-1). Unconfirmed after
   * 30 s: the handle stays held, termination is retried with backoff, and `emptied` stays pending, so the session's
   * `done` (completion, verification, retry) waits for kernel accounting (STOP-1).
   */
  let markEmpty: () => void = () => {};
  const emptied = new Promise<void>((resolve) => { markEmpty = resolve; });
  /** Review round 4 (F04-R3-1/FINAL-1): a native or record failure is an unreadable count (-1), never an escape. */
  const quiet = (type: string, detail: string) => { try { hooks.event(type, detail); } catch { /* the in-memory containment state stays authoritative */ } };
  const terminateJob = (reason: string): Promise<void> => {
    if (ending) return ending;
    ending = (async () => {
      const owned = group;
      if (!owned) { markEmpty(); return; }
      const sweep = () => { try { return owned.terminate(); } catch { return -1; } };
      let present: number | null = null;
      try { present = owned.inspect().activeProcesses; } catch { present = null; }
      settle({ state: "terminating", detail: reason, terminatedAtEnd: present });
      const deadline = Date.now() + CONTAINMENT_CONFIRM_MS;
      let active = sweep();
      while (active !== 0 && Date.now() < deadline) { await pause(100); active = sweep(); }
      try { const last = owned.inspect(); settle({ totalProcesses: last.totalProcesses }); } catch { /* accounting below decides */ }
      const counted = present === null ? "an unknown number of" : String(present);
      if (active === 0) {
        // Accounting reached 0: bookkeeping failures are recorded in the detail but never keep the session pending.
        // Separate guards: a failed annotate never skips the close that releases the handle (review round 5).
        try { owned.annotate({ terminatedAtEnd: present }); } catch (error) { quiet("provider.containment_record_failed", safeError(error).message); }
        try { owned.close(outcome); } catch (error) { quiet("provider.containment_record_failed", safeError(error).message); }
        settle({ state: "empty", activeProcesses: 0, detail: `${reason} Windows job accounting reports 0 active processes; ${counted} process(es) present at the end were terminated with the job.` });
        markEmpty();
        return;
      }
      try { owned.annotate({ terminatedAtEnd: present, containment: "unconfirmed", activeProcesses: active }); } catch { /* in-memory state below stays authoritative */ }
      settle({ state: "unconfirmed", activeProcesses: active, detail: `${reason} Windows job termination is unconfirmed: kernel accounting still reports ${active < 0 ? "an unreadable count of" : active} active process(es). The job handle stays held and termination is retried; this session remains live code.` });
      quiet("provider.containment_unconfirmed", containment.detail);
      let delay = 1000;
      const retry = () => {
        const now = sweep();
        if (now === 0) { try { owned.close(outcome); } catch { /* accounting is already 0 */ } settle({ state: "empty", activeProcesses: 0, detail: "Windows job accounting reached 0 active processes after a delayed termination." }); quiet("provider.containment_confirmed", containment.detail); markEmpty(); return; }
        settle({ activeProcesses: now });
        delay = Math.min(delay * 2, 30_000);
        setTimeout(retry, delay).unref?.();
      };
      setTimeout(retry, delay).unref?.();
    })();
    return ending;
  };
  const done = (async (): Promise<AdapterResult> => {
    if (stopped) { settle({ state: "empty", admitted: false, activeProcesses: 0, detail: "Stopped before any provider process existed." }); markEmpty(); return { ok: false, output: "", error: "Stopped.", stopped: true }; }
    let out: Awaited<ReturnType<typeof outputPipe>> | null = null; let err: Awaited<ReturnType<typeof outputPipe>> | null = null;
    const closePipes = async () => { await Promise.all([out?.close(), err?.close()]); };
    try {
      out = await outputPipe(onStdout); err = await outputPipe(onStderr);
      if (stopped) throw new Error("Stopped before launch.");
      const env = hooks.childEnvironment?.() ?? scrubChildEnvironment(process.env).env;
      const owner = hooks.owner;
      group = new OwnedProcessGroup(launch.command, task.cwd ?? process.cwd(), {
        action: `provider.${id}`, missionId: owner?.missionId ?? null, ...(owner?.dataDirectory ? { dataDirectory: owner.dataDirectory } : {}),
        provider: { taskId: owner?.taskId ?? task.id ?? null, agentId: owner?.agentId ?? null, sessionId: id === "claude" ? sessionId : null, provider: id, hostGeneration: owner?.hostGeneration ?? null },
      });
      group.onStop(() => { stop().catch(() => { /* terminateJob never rejects; a throw here must not escape a timer */ }); });
      group.spawn(launch.command, [...launch.args, ...args], task.cwd ?? process.cwd(), env, out.name, err.name, Buffer.from(task.prompt, "utf8"));
    } catch (error) {
      const reason = `Containment unavailable — execution refused: ${safeError(error).message}`;
      // The root ran briefly when admission verification failed after launch (review round 1, STOP-2): settle the job
      // by kernel accounting like any other end; only a launch that never produced a process is "refused".
      if ((error as { launched?: boolean }).launched) {
        outcome = "failed";
        if (group?.live) { settle({ admitted: true }); await terminateJob(`${reason} The admitted root was terminated with its job.`); await emptied; }
        else { settle({ state: "empty", admitted: true, activeProcesses: 0, detail: `${reason} The admitted root was terminated with its job; kernel accounting reported 0.` }); markEmpty(); }
        await closePipes().catch(() => {});
        hooks.event("provider.containment_refused", reason);
        return { ok: false, output: "", error: reason };
      }
      try { group?.close("failed"); } catch { /* the refusal below stands */ }
      await closePipes().catch(() => {});
      markEmpty();
      if (stopped) { settle({ state: "empty", admitted: false, activeProcesses: 0, detail: "Stopped before the provider process was admitted." }); return { ok: false, output: "", error: "Stopped.", stopped: true }; }
      settle({ state: "refused", admitted: false, detail: reason });
      hooks.event("provider.containment_refused", reason);
      return { ok: false, output: "", error: reason };
    }
    const record = group.inspectHistory();
    settle({ state: "running", admitted: true, operationId: record.operationId, rootPid: record.launcherPid, rootCreatedAt: record.launcherCreatedAt, detail: "Provider process tree is running inside its Bunny-owned Windows job." });
    boundary(() => {
      hooks.session(id === "claude" ? sessionId : null, record.launcherPid);
      hooks.event("agent.started", `${NAMES[id]} process started (PID ${record.launcherPid}) inside a Bunny-owned Windows job.`);
    });
    let exitCode: number | null = null;
    for (;;) {
      try {
        const snapshot = group.inspect();
        settle({ activeProcesses: snapshot.activeProcesses, totalProcesses: snapshot.totalProcesses });
        if (snapshot.exitCode !== null) { exitCode = snapshot.exitCode; break; }
      } catch (error) { fail(new Error(`Windows job inspection failed: ${safeError(error).message}`)); }
      if (stopped || providerError) break;
      await new Promise<void>((resume) => { wake = resume; setTimeout(resume, 200).unref?.(); });
      wake = null;
    }
    outcome = stopped ? "stopped" : providerError ? "failed" : exitCode === 0 ? "succeeded" : "failed";
    await terminateJob(stopped ? "Stop requested: the provider's Windows job was terminated." : exitCode === null ? "Provider failure: the provider's Windows job was terminated." : "Provider root process ended: its Windows job was terminated so no descendant outlives the session.");
    // Completion, verification and any retry wait for kernel accounting, however long termination takes (STOP-1).
    await emptied;
    exitCode ??= group.inspectHistory().exitCode;
    await closePipes();
    return { ok: exitCode === 0 && !stopped && !providerError, output, error: stopped ? "Stopped." : providerError ?? (exitCode === 0 ? undefined : safeError(firstLine(stderr) || `Process exited ${exitCode}`).message), stopped, exitCode };
  })();
  const stop = async () => {
    stopped = true; outcome = "stopped"; wake?.();
    if (group?.live) await terminateJob("Stop requested: the provider's Windows job was terminated.");
  };
  return { done, stop, pid: () => containment.rootPid, containment: () => ({ ...containment }) };
}

export class CodexAdapter extends CliBase implements ProviderAdapter {
  private account: NativeAccount | null = null;
  connectionIdentity() { return this.account; }
  id = "codex" as const;
  detected: ProviderLive | null = null;
  security: CodexCompatibilityGate;
  compatibilityDirty = false;
  constructor(ctx: () => DiscoveryContext = () => systemContext(), security?: CodexCompatibilityGate) {
    super(ctx); this.security = security ?? new CodexCompatibilityGate({ probe });
  }
  capabilities() { return FEATURES.codex; }
  async health(previous: ProviderLive): Promise<ProviderLive | null> {
    const launch = locate(this.ctx(), this.id).launch;
    const profile = previous.securityCompatibility;
    if (!launch || this.compatibilityDirty || !profile || profile.policyVersion !== CODEX_SECURITY_POLICY_VERSION || Date.now() - profile.checkedAt >= CODEX_COMPATIBILITY_MAX_AGE_MS) return null;
    try { if (executableStamp(launch).stamp !== profile.executable?.stamp) return null; } catch { return null; }
    return super.health(previous);
  }
  async detect() {
    const live = providerBase(this.id); live.probedAt = Date.now();
    live.usageCapabilities = { shortWindow: false, weekly: false, resetTime: false, tokenUsage: true, activeJobs: true, source: "codex app-server account/rateLimits/read" };
    const launch = this.located(live);
    this.compatibilityDirty = false;
    if (!launch) { live.securityCompatibility = emptyCodexCompatibility("Codex executable was not found."); live.detail = "Codex CLI not found on PATH or in known install locations."; return this.detected = live; }
    live.securityCompatibility = await this.security.inspect(launch, this.ctx());
    const version = await probe(launch, ["--version"]);
    if (version.code !== 0) { live.availability = "unavailable"; live.detail = `Codex found at ${launch.path}, but \`codex --version\` failed: ${version.timedOut ? "timed out" : version.error || firstLine(version.stderr) || `exit ${version.code}`}.`; return this.detected = live; }
    live.version = firstLine(version.stdout);
    const login = await probe(launch, ["login", "status"]);
    live.evidence = [...(live.evidence ?? []), `codex login status → exit ${login.code ?? (login.timedOut ? "timeout" : "error")}`];
    if (login.code !== 0) {
      live.authenticatedState = login.code === null ? "unknown" : "not_authenticated";
      live.availability = login.code === null ? "unknown" : "authentication_required";
      live.detail = login.code === null ? `Could not determine Codex sign-in (\`codex login status\` ${login.timedOut ? "timed out" : "failed to run"}).` : `Codex reports it is not signed in (\`codex login status\` exit ${login.code}: ${firstLine(login.stderr) || firstLine(login.stdout) || "no detail"}). Run \`codex login\`.`;
      return this.detected = live;
    }
    live.authenticated = true; live.authenticatedState = "authenticated";
    const catalogue = await probeCodexCatalog(launch.command, launch.args, true).catch(() => null);
    this.account = catalogue?.account ? { principal:catalogue.account.email, method:catalogue.account.type, plan:catalogue.account.planType } : null;
    live.capabilities = this.agentCapabilities();
    if (!catalogue || !catalogue.model) {
      live.availability = "unavailable";
      live.detail = "Codex is signed in, but its model catalogue (codex app-server model/list) could not be read. Launch is refused until a supported model can be selected.";
      return this.detected = live;
    }
    live.models = catalogue.models; live.current_model = catalogue.model;
    this.applyUsage(live, catalogue.usageRead ? { windows: catalogue.usageWindows, observedAt: Date.now() } : null);
    if (catalogue.limited) { live.availability = "rate_limited"; live.detail = "Codex reports ordinary usage is not allowed right now (usage limit)."; return this.detected = live; }
    live.availability = "ready";
    live.detail = `${live.version} · signed in (\`codex login status\`) · ${catalogue.models.length} models · owned headless sessions.`;
    return this.detected = live;
  }
  applyUsage(live: ProviderLive, usage: { windows: UsageWindow[]; observedAt: number } | null) {
    live.usageWindows = usage?.windows ?? []; live.usageObservedAt = usage ? usage.observedAt : null;
    const kinds = new Set(live.usageWindows.map((window) => window.kind));
    live.usageCapabilities = { ...live.usageCapabilities!, shortWindow: kinds.has("short"), weekly: kinds.has("weekly"), resetTime: live.usageWindows.some((window) => window.resetsAt !== null) };
    live.usage_note = live.usageWindows.length ? "Official Codex usage limits" : "Usage unavailable";
  }
  async usage() {
    if (!this.launchTarget) return null;
    const catalogue = await probeCodexCatalog(this.launchTarget.command, this.launchTarget.args).catch(() => null);
    return catalogue?.usageRead ? { windows: catalogue.usageWindows, observedAt: Date.now() } : null;
  }
  launch(task: OrchTask, hooks: AdapterHooks): RunningSession {
    const launch = this.launchTarget;
    if (!launch || !this.detected?.authenticated) throw new Error("Codex is not ready for execution.");
    const args = codexLaunchArgs(task);
    if (!task.executionScope && !task.mission) return spawnSession("codex", launch, args, task, hooks, task.sessionId ?? crypto.randomUUID());
    const access = task.executionScope?.access;
    if (!access) throw new Error("Codex Mission launch has no approved execution scope.");
    const exclusion = codexMissionExclusion(this.detected, access);
    if (exclusion) throw new Error(exclusion);
    const current = locate(this.ctx(), this.id).launch;
    if (!current || current.path !== launch.path || current.command !== launch.command || JSON.stringify(current.args) !== JSON.stringify(launch.args)) throw new Error("Codex excluded: resolved executable changed before Mission launch; refresh providers.");
    let owned: RunningSession | null = null; let stopped = false;
    const done = (async (): Promise<AdapterResult> => {
      // Re-probe version and controls, then hash again immediately before spawn. No model has started here.
      const profile = await this.security.inspect(current, this.ctx(), true);
      this.compatibilityDirty = JSON.stringify([profile.compatibilityClass, profile.executable, profile.reason]) !== JSON.stringify([this.detected?.securityCompatibility?.compatibilityClass, this.detected?.securityCompatibility?.executable, this.detected?.securityCompatibility?.reason]);
      this.detected = { ...this.detected!, securityCompatibility: profile };
      if (stopped) return { ok: false, stopped: true, output: "", error: "Stopped before Codex Mission launch." };
      const reason = codexMissionExclusion({ id: "codex", securityCompatibility: profile }, access);
      if (reason) throw new Error(reason);
      // Re-resolve after async probes so an alias or provider setting change cannot redirect spawn.
      const final = locate(this.ctx(), this.id).launch;
      if (!final || final.path !== current.path || final.command !== current.command || JSON.stringify(final.args) !== JSON.stringify(current.args)) throw new Error("Codex excluded: resolved executable changed during Mission compatibility checks.");
      const authorized = this.security.authorize(final, profile, access);
      owned = spawnSession("codex", authorized, args, task, hooks, task.sessionId ?? crypto.randomUUID());
      return owned.done;
    })().catch((error: unknown): AdapterResult => {
      this.compatibilityDirty = true;
      const reason = error instanceof Error ? error.message : "Codex Mission compatibility check failed.";
      hooks.event("provider.compatibility_rejected", reason);
      return { ok: false, output: "", error: reason };
    });
    return { done, stop: async () => { stopped = true; await owned?.stop(); }, pid: () => owned?.pid?.() ?? null };
  }
}

export class ClaudeAdapter extends CliBase implements ProviderAdapter {
  private account: NativeAccount | null = null;
  connectionIdentity() { return this.account; }
  id = "claude" as const;
  detected: ProviderLive | null = null;
  capabilities() { return FEATURES.claude; }
  async detect() {
    const live = providerBase(this.id); live.probedAt = Date.now();
    live.usageCapabilities = { shortWindow: false, weekly: false, resetTime: false, tokenUsage: true, activeJobs: true, source: "Claude Code rate_limit_event, reported during Bunny-A sessions" };
    const launch = this.located(live);
    if (!launch) { live.detail = "Claude Code not found on PATH or in known install locations."; return this.detected = live; }
    const version = await probe(launch, ["--version"]);
    if (version.code !== 0) { live.availability = "unavailable"; live.detail = `Claude Code found at ${launch.path}, but \`claude --version\` failed: ${version.timedOut ? "timed out" : version.error || firstLine(version.stderr) || `exit ${version.code}`}.`; return this.detected = live; }
    live.version = firstLine(version.stdout);
    const auth = await probe(launch, ["auth", "status"]);
    let state: { loggedIn?: unknown; authMethod?: unknown; apiProvider?: unknown; email?: unknown; orgId?: unknown; subscriptionType?: unknown } | null = null;
    try { state = JSON.parse(auth.stdout); } catch { state = null; }
    this.account = state ? {principal:typeof state.email==="string"?state.email:null,workspace:typeof state.orgId==="string"?state.orgId:null,method:state.authMethod==="claude.ai"&&state.apiProvider==="firstParty"?"claude.ai":"other",plan:typeof state.subscriptionType==="string"?state.subscriptionType:null}:null;
    live.evidence = [...(live.evidence ?? []), `claude auth status → exit ${auth.code ?? "error"}${state ? `, loggedIn=${String(state.loggedIn)}` : ", unreadable"}`];
    if (!state || typeof state.loggedIn !== "boolean") {
      live.authenticatedState = "unknown"; live.availability = "unknown";
      live.detail = "Claude Code is installed, but its sign-in state could not be read safely (`claude auth status`). Shown as Unknown until a real run settles it.";
      return this.detected = live;
    }
    if (!state.loggedIn) {
      live.authenticatedState = "not_authenticated"; live.availability = "authentication_required";
      live.detail = "Claude Code reports it is not signed in (`claude auth status`: loggedIn=false). Run `claude` and sign in.";
      return this.detected = live;
    }
    live.authenticated = true; live.authenticatedState = "authenticated"; live.availability = "ready";
    live.capabilities = this.agentCapabilities();
    live.detail = `${live.version} · signed in${typeof state.authMethod === "string" ? ` (${state.authMethod})` : ""} · owned headless sessions.`;
    return this.detected = live;
  }
  launch(task: OrchTask, hooks: AdapterHooks): RunningSession {
    const launch = this.launchTarget;
    if (!launch || !this.detected?.authenticated) throw new Error("Claude Code is not ready for execution.");
    const sessionId = task.sessionId ?? crypto.randomUUID();
    // PowerShell is Claude Code's native shell tool on Windows; it carries the same authority as Bash, which is already allowed.
    const args = claudeLaunchArgs(task, sessionId);
    return spawnSession("claude", launch, args, task, hooks, sessionId);
  }
}

/**
 * Default-on codex-cli 0.153.4 features that register tools without any config.toml entry, so
 * --ignore-user-config leaves them on: ChatGPT connector apps (the codex_apps MCP server, e.g. Gmail
 * send, GitHub merge, deploys), local/remote plugins and their MCP servers, browser and computer control,
 * image generation, plugin-install suggestions, hooks and skill MCP installs. M-A-1 observed 228 connector
 * tools in a read session before these were disabled.
 */
/**
 * Isolation flags verified with Bunny-resolved codex-cli 0.153.4 exec --help and live sessions. They apply to
 * every scoped (mission) session: M-A-1 observed a write step launching the user's unsandboxed node_repl and
 * computer-use REPL MCP servers and account connectors, which exceed "write files and run sandboxed shell
 * commands in the approved folder". Unscoped direct tasks keep their exact legacy argv.
 */
export function codexLaunchArgs(task: OrchTask, platform = process.platform): string[] {
  const read = task.executionScope?.access === "read";
  // Ignore extensions and execpolicy from user config; restore only trusted native Windows sandbox policy;
  // switch off tool-adding defaults and web search, which do not come from user config.
  const isolation = ["--ignore-user-config", "--ignore-rules", ...(platform === "win32" ? ["-c", 'windows.sandbox="elevated"'] : []), ...CODEX_READ_DISABLED_FEATURES.flatMap((feature) => ["--disable", feature]), "-c", 'web_search="disabled"'];
  // M-A-3 T3 §11: the Task's contracted reasoning-effort knob (router-selected). Scoped (mission)
  // sessions keep their exact verified argv; an effort override there is a documented T3 limitation.
  const effort = task.executionScope || !task.effort ? [] : ["-c", `model_reasoning_effort="${task.effort}"`];
  return ["exec", "--json", "-c", 'model_provider="openai"', "--sandbox", read ? "read-only" : "workspace-write", ...isolation, ...effort, "--skip-git-repo-check", "--cd", task.cwd!, "--model", task.model, "-"];
}
/** Claude read/write contracts verified with installed Claude Code 2.1.288 help. */
export function claudeLaunchArgs(task: OrchTask, sessionId: string, platform = process.platform): string[] {
  const read = task.executionScope?.access === "read";
  const tools = read ? "Read" : platform === "win32" ? "Read,Write,Edit,Bash,PowerShell" : "Read,Write,Edit,Bash";
  return ["--print", "--verbose", "--output-format", "stream-json", "--session-id", sessionId, "--safe-mode", "--strict-mcp-config",
    "--setting-sources", "", "--settings", '{"disableAllHooks":true}',
    ...(read ? ["--restricted", "--tools", "Read", "--disallowedTools", "Write,Edit,Bash,PowerShell"] : []),
    "--permission-mode", read ? "dontAsk" : "acceptEdits", "--permission-prompts", "none", "--allowedTools", tools, "--"];
}

/** Real discovery for providers Bunny-A cannot execute yet; they are listed honestly and never routed. */
export class DetectOnlyAdapter extends CliBase implements ProviderAdapter {
  id: "opencode" | "cline" | "cursor";
  constructor(id: "opencode" | "cline" | "cursor", ctx: () => DiscoveryContext) { super(ctx); this.id = id; }
  capabilities() { return FEATURES[this.id]; }
  async detect() {
    const live = providerBase(this.id); live.probedAt = Date.now();
    const found = locate(this.ctx(), this.id);
    live.evidence = found.checked.slice(-6);
    if (!found.launch) { live.detail = `${NAMES[this.id]} not found on PATH or in known install locations.`; return live; }
    live.installed = true; live.executable = found.launch.path; this.print = fingerprint(found.launch.path); this.launchTarget = found.launch;
    live.evidence.push(`Resolved via ${found.launch.source}: ${found.launch.path}`);
    live.version = found.version ?? null;
    if (this.id === "opencode") {
      const version = await probe(found.launch, ["--version"]);
      if (version.code === 0) live.version = firstLine(version.stdout);
      const auth = await probe(found.launch, ["auth", "list"]);
      const count = /(\d+)\s+credentials?/i.exec(stripAnsi(auth.stdout))?.[1];
      live.evidence.push(`opencode auth list → ${count ? `${count} stored credentials` : `exit ${auth.code}`}`);
      live.detail = `OpenCode ${live.version ?? ""} is installed${count ? ` with ${count} stored provider credentials (not validated)` : ""}.`;
    } else if (this.id === "cursor") {
      const status = await probe(found.launch, ["status"]);
      const text = stripAnsi(`${status.stdout}\n${status.stderr}`);
      live.authenticatedState = /not logged in/i.test(text) ? "not_authenticated" : /logged in/i.test(text) ? "authenticated" : "unknown";
      live.authenticated = live.authenticatedState === "authenticated";
      live.evidence.push(`cursor-agent status → ${live.authenticatedState === "not_authenticated" ? "Not logged in" : live.authenticatedState === "authenticated" ? "Logged in" : `unrecognised (exit ${status.code})`}`);
      live.detail = `Cursor Agent ${live.version ?? ""} is installed; ${live.authenticatedState === "not_authenticated" ? "it reports Not logged in" : live.authenticatedState === "authenticated" ? "it reports a signed-in account" : "its sign-in state is unknown"}.`;
    } else {
      live.detail = `Cline ${live.version ?? ""} is installed (npm). ${found.note ?? ""}`;
    }
    live.availability = "unavailable";
    live.detail = `${live.detail.replace(/\s+/g, " ").trim()} Bunny-A has no ${NAMES[this.id]} execution adapter yet, so it is never routed.`;
    return live;
  }
  launch(): RunningSession { throw new Error(`Bunny-A has no ${NAMES[this.id]} execution adapter.`); }
}

/** Production adapter set. `paths` supplies user-configured executable paths from Host settings. */
export function defaultAdapters(paths: () => Partial<Record<ProviderId, string>> = () => ({})): ProviderAdapter[] {
  const ctx = () => systemContext(paths());
  return [new OllamaAdapter(ctx), new CodexAdapter(ctx), new ClaudeAdapter(ctx), new DetectOnlyAdapter("opencode", ctx), new DetectOnlyAdapter("cline", ctx), new DetectOnlyAdapter("cursor", ctx)];
}
