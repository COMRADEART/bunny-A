import type { ExecRequest, ExecResult, OllamaReceipt } from "./types";
import { localInference } from "./local-inference.ts";

const inflight = new Map<string, AbortController>();

const NOT_CONFIGURED: Record<string, string> = {
  codex: "Codex adapter is not configured. No Codex CLI or API credential is on this host. Usage unavailable.",
  claude: "Claude adapter is not configured. No Claude CLI or API credential is on this host. Usage unavailable.",
  cline: "Cline adapter is not installed. GUI automation is not used as a stand-in.",
  cursor: "Cursor adapter is not installed. GUI automation is not used as a stand-in.",
};

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)} second${Math.round(ms / 1000) === 1 ? "" : "s"}`;
  const minutes = Math.round(ms / 60_000);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

/** An Ollama tag that proxies to a hosted model (e.g. `name:cloud` with `remote_host: https://ollama.com`). */
export const isRemoteOllamaTag = (model: { name?: string; remote_host?: unknown; remote_model?: unknown }) =>
  !!model.remote_host || !!model.remote_model || /(:|-)cloud$/i.test(model.name ?? "");

/** `remote` lists installed tags whose generation runs on a hosted service, not on this machine. */
export async function probeOllama(): Promise<{ up: boolean; models: string[]; remote?: string[] }> {
  try {
    const response = await fetch("http://127.0.0.1:11434/api/tags", { signal: AbortSignal.timeout(800) });
    if (!response.ok) return { up: false, models: [] };
    const body = (await response.json()) as { models?: { name?: string; remote_host?: unknown; remote_model?: unknown }[] };
    const tags = (body.models ?? []).filter((model): model is { name: string } => !!model.name);
    return { up: true, models: tags.map((model) => model.name), remote: tags.filter(isRemoteOllamaTag).map((model) => model.name) };
  } catch {
    return { up: false, models: [] };
  }
}

/** The final `done` message of /api/generate: Ollama's own counts and durations. */
type DonePart = { done?: boolean; model?: string; done_reason?: string; prompt_eval_count?: number; eval_count?: number; total_duration?: number; load_duration?: number; prompt_eval_duration?: number; eval_duration?: number };
const count = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
function validateCompletion(part: DonePart | null, model: string, output: string, format: ExecRequest["format"]) {
  if (!part || part.done !== true) throw new Error("Local model stream ended without a completion receipt.");
  if (part.model !== model) throw new Error("Local model receipt does not match the requested model.");
  if (format) { try { JSON.parse(output); } catch { throw new Error("Local model returned invalid structured JSON."); } }
}
/** M-A-3 T11: a provider receipt taken from the provider's own final message; nothing here is estimated. */
function receiptOf(part: DonePart, requested: string, requestedAt: number, firstTokenAt: number | null): OllamaReceipt {
  return {
    model: typeof part.model === "string" && part.model ? part.model.slice(0, 200) : requested,
    doneReason: typeof part.done_reason === "string" ? part.done_reason.slice(0, 40) : null,
    promptEvalCount: count(part.prompt_eval_count), evalCount: count(part.eval_count),
    totalDurationNs: count(part.total_duration), loadDurationNs: count(part.load_duration),
    promptEvalDurationNs: count(part.prompt_eval_duration), evalDurationNs: count(part.eval_duration),
    requestedAt, firstTokenAt, finishedAt: Date.now(),
    digest: null,
  };
}

/** The runtime digest for this exact tag name. Two matches, or none, stay unobserved. */
export function digestFromTags(models: readonly { name?: unknown; digest?: unknown }[], name: string): string | null {
  const hits = models.filter((model) => model.name === name && typeof model.digest === "string" && model.digest);
  return hits.length === 1 && typeof hits[0]?.digest === "string" ? hits[0].digest : null;
}

async function observedDigest(name: string): Promise<string | null> {
  try {
    const response = await fetch("http://127.0.0.1:11434/api/tags", { signal: AbortSignal.timeout(3000) });
    if (!response.ok) return null;
    const body = (await response.json()) as { models?: { name?: unknown; digest?: unknown }[] };
    return digestFromTags(body.models ?? [], name);
  } catch {
    return null;
  }
}

export async function stopTask(taskId: string) {
  const controller = inflight.get(taskId);
  if (!controller) return { stopped: false };
  controller.abort();
  return { stopped: true };
}

/**
 * M-A-3 T11 fault injection, reachable only from an in-process test fixture (never from HTTP or a device): aborts one
 * in-flight local generation the way a dropped provider stream fails, so the Host's ordinary failure path handles it.
 */
export function interruptTask(taskId: string) {
  const controller = inflight.get(taskId);
  if (!controller) return { interrupted: false };
  controller.abort("interrupted");
  return { interrupted: true };
}

export async function execute(request: ExecRequest, options: { stream?: (text: string) => void; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<ExecResult> {
  if (request.provider !== "ollama") {
    return { ok: false, error: NOT_CONFIGURED[request.provider] ?? "Provider adapter is not installed.", log: "Launch refused." };
  }
  const probe = await probeOllama();
  if (options.signal?.aborted) return { ok: false, stopped: true, error: "Stopped before launch.", log: "Launch cancelled." };
  if (!probe.up) {
    return { ok: false, error: "Ollama is offline at 127.0.0.1:11434.", log: "Probe failed." };
  }
  const model = request.model || probe.models[0];
  if (!model) return { ok: false, error: "Ollama is up but has no models.", log: "No model." };
  if (!probe.models.includes(model)) return { ok: false, error: `Model ${model} is no longer available. Route the task again.`, log: "Model missing." };
  // M-A-3 T10: a local-only task (every voice turn) never reaches a hosted tag, even if it became hosted after routing.
  if (request.localOnly && (probe.remote?.includes(model) || isRemoteOllamaTag({ name: model })))
    return { ok: false, error: `Model ${model} runs on a hosted service; this task requires local execution.`, log: "Hosted model refused for a local-only task." };
  if (inflight.has(request.taskId)) return { ok: false, error: "This task is already running.", log: "Duplicate launch refused." };

  const controller = new AbortController();
  const externalAbort = () => controller.abort();
  options.signal?.addEventListener("abort", externalAbort, { once: true });
  inflight.set(request.taskId, controller);
  const timeoutMs = options.timeoutMs ?? 120_000;
  const timeout = setTimeout(() => controller.abort("timeout"), timeoutMs);
  const requestedAt = Date.now();
  let release: (() => void) | undefined;
  try {
    // MA5-S2 P4-2: admission by class (voice first, never pre-empting). Queue time counts toward the timeout, as it did inside Ollama.
    release = await localInference.acquire(request.taskId, request.priority ?? "background", controller.signal);
    const response = await fetch("http://127.0.0.1:11434/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      // MA4-S2-FIX-D: structured output is requested with `think: false`. A reasoning model (deepseek-r1) otherwise spends
      // its token budget on a <think> preamble that the JSON grammar cannot hold; Ollama accepts `think: false` for every
      // model (non-reasoning models ignore it). A <think> block that still appears fails JSON validation: refused, never parsed.
      body: JSON.stringify({ model, prompt: request.prompt, stream: !!options.stream, ...(request.format ? { format: request.format, think: false } : {}), ...(request.numCtx || request.numPredict || request.temperature !== undefined ? { options: { ...(request.numCtx ? { num_ctx: request.numCtx } : {}), ...(request.numPredict ? { num_predict: request.numPredict } : {}), ...(request.temperature !== undefined ? { temperature: request.temperature } : {}) } } : {}) }),
      signal: controller.signal,
    });
    if (!response.ok) {
      return { ok: false, error: `Ollama returned HTTP ${response.status}.`, log: `POST /api/generate ${response.status}` };
    }
    if (options.stream && response.body) {
      const reader=response.body.getReader();const decoder=new TextDecoder();let buffer="",output="";
      let firstTokenAt:number|null=null;let done:DonePart|null=null;
      const consume=(line:string)=>{if(!line.trim()) return;const part=JSON.parse(line) as {response?:string;error?:string}&DonePart;if(part.error) throw new Error("Local model reported a generation error.");if(part.model !== model) throw new Error("Local model response does not match the requested model.");if(done) throw new Error("Local model sent data after its completion receipt.");if(part.response) {firstTokenAt??=Date.now();output+=part.response;options.stream!(part.response);if(output.length>2_000_000) throw new Error("Model output exceeds the log limit.");}if(part.done===true) done=part;};
      try {while(true) {const chunk=await reader.read();if(chunk.done) break;buffer+=decoder.decode(chunk.value,{stream:true});let index:number;while((index=buffer.indexOf("\n"))>=0) {consume(buffer.slice(0,index));buffer=buffer.slice(index+1);}}buffer+=decoder.decode();consume(buffer);}
      finally {await reader.cancel().catch(()=>{});}
      validateCompletion(done, model, output, request.format);
      const receipt=done?receiptOf(done,model,requestedAt,firstTokenAt):null;
      if (receipt) receipt.digest = await observedDigest(receipt.model);
      return {ok:true,output,log:`Ollama ${model} finished.`,...(receipt?{receipt}:{})};
    }
    const body = (await response.json()) as { response?: string } & DonePart;
    validateCompletion(body, model, body.response ?? "", request.format);
    const receipt = body.done === true ? receiptOf(body, model, requestedAt, null) : null;
    if (receipt) receipt.digest = await observedDigest(receipt.model);
    return { ok: true, output: body.response ?? "", log: `Ollama ${model} finished.`, ...(receipt ? { receipt } : {}) };
  } catch (error) {
    if (controller.signal.reason === "interrupted") return { ok: false, error: "The local model stream was interrupted before it finished.", log: "Stream interrupted." };
    if (controller.signal.reason === "timeout") return { ok: false, error: `The model did not finish within ${formatDuration(timeoutMs)}. Try a shorter task or a faster model.`, log: "Execution timed out." };
    if (controller.signal.aborted) return { ok: false, stopped: true, error: "Stopped.", log: "Abort." };
    const message = error instanceof Error ? error.message : "Ollama request failed.";
    return { ok: false, error: message, log: message };
  } finally {
    release?.();
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort",externalAbort);
    inflight.delete(request.taskId);
  }
}
