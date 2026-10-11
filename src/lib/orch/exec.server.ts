import type { ExecRequest, ExecResult } from "./types";

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

export async function stopTask(taskId: string) {
  const controller = inflight.get(taskId);
  if (!controller) return { stopped: false };
  controller.abort();
  return { stopped: true };
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
  try {
    const response = await fetch("http://127.0.0.1:11434/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, prompt: request.prompt, stream: !!options.stream }),
      signal: controller.signal,
    });
    if (!response.ok) {
      return { ok: false, error: `Ollama returned HTTP ${response.status}.`, log: `POST /api/generate ${response.status}` };
    }
    if (options.stream && response.body) {
      const reader=response.body.getReader();const decoder=new TextDecoder();let buffer="",output="";
      const consume=(line:string)=>{if(!line.trim()) return;const part=JSON.parse(line) as {response?:string;error?:string};if(part.error) throw new Error(part.error);if(part.response) {output+=part.response;options.stream!(part.response);if(output.length>2_000_000) throw new Error("Model output exceeds the log limit.");}};
      try {while(true) {const chunk=await reader.read();if(chunk.done) break;buffer+=decoder.decode(chunk.value,{stream:true});let index:number;while((index=buffer.indexOf("\n"))>=0) {consume(buffer.slice(0,index));buffer=buffer.slice(index+1);}}buffer+=decoder.decode();consume(buffer);}
      finally {await reader.cancel().catch(()=>{});}
      return {ok:true,output,log:`Ollama ${model} finished.`};
    }
    const body = (await response.json()) as { response?: string };
    return { ok: true, output: body.response ?? "", log: `Ollama ${model} finished.` };
  } catch (error) {
    if (controller.signal.reason === "timeout") return { ok: false, error: `The model did not finish within ${formatDuration(timeoutMs)}. Try a shorter task or a faster model.`, log: "Execution timed out." };
    if (controller.signal.aborted) return { ok: false, stopped: true, error: "Stopped.", log: "Abort." };
    const message = error instanceof Error ? error.message : "Ollama request failed.";
    return { ok: false, error: message, log: message };
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort",externalAbort);
    inflight.delete(request.taskId);
  }
}
