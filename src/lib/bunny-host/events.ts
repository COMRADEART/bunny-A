import type { TaskProgress, TokenUsage, UsageWindow } from "../orch/types.ts";

/** Normalized activity vocabulary. Adapters emit a type only when the provider's own event proves it. */
export const AGENT_EVENTS = [
  "agent.starting", "agent.started", "agent.thinking", "agent.planning", "agent.reading", "agent.searching",
  "agent.editing", "agent.command", "agent.tool", "agent.testing", "agent.building", "agent.rendering",
  "agent.output", "agent.waiting_for_input", "agent.waiting_for_approval", "agent.verifying",
  "agent.completed", "agent.failed", "agent.stopped",
] as const;

export type NormalizedEvent = {
  billingSource?: string;
  /** Empty when the provider event only carries output, a session id or a model. */
  type: string;
  detail: string;
  output?: string;
  sessionId?: string;
  model?: string;
  progress?: TaskProgress;
  usage?: TokenUsage;
  rateLimits?: UsageWindow[];
  /** Provider's own verdict for the current limit when it reports one (Claude Code: "allowed", "rejected", …). */
  limitStatus?: string;
};

const LABELS: Record<string, string> = {
  "agent.starting": "Starting…", "agent.started": "Working…", "agent.thinking": "Thinking", "agent.planning": "Planning",
  "agent.reading": "Reading", "agent.searching": "Searching", "agent.editing": "Editing", "agent.command": "Running command",
  "agent.tool": "Using a tool", "agent.testing": "Running tests", "agent.building": "Building", "agent.rendering": "Rendering",
  "agent.output": "Working…", "agent.waiting_for_input": "Waiting for input", "agent.waiting_for_approval": "Waiting for approval",
  "agent.verifying": "Verifying", "agent.completed": "Completed", "agent.failed": "Failed", "agent.stopped": "Stopped",
  "agent.warning": "Warning", "agent.error": "Error",
  "task.completed": "Completed", "task.failed": "Failed", "task.stopped": "Stopped",
};
export function activityLabel(type: string): string { return LABELS[type] ?? "Working…"; }

const TEST = /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b|\bnode\s+(?:--[\w-]+\s+)*--test\b|\b(?:pytest|vitest|jest|mocha)\b|\bpython\d*(?:\.exe)?\s+-m\s+(?:pytest|unittest)\b|\b(?:go|cargo|dotnet|mvn|gradle|deno)\s+test\b|\bplaywright\s+test\b/i;
const BUILD = /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?build\b|\btsc\b|\bvite(?:\.js)?\s+build\b|\b(?:cargo|go|dotnet|gradle)\s+build\b|\bmsbuild\b|\bmake\b|\bwebpack\b|\besbuild\b/i;
const RENDER = /\bplaywright\s+screenshot\b|\bbrowser-smoke\b|\bscreenshot\b|\bpuppeteer\b/i;
/** Classifies by the command text itself; anything unrecognised stays a plain command. */
export function classifyCommand(command: string): "agent.testing" | "agent.building" | "agent.rendering" | "agent.command" {
  if (TEST.test(command)) return "agent.testing";
  if (BUILD.test(command)) return "agent.building";
  if (RENDER.test(command)) return "agent.rendering";
  return "agent.command";
}

/**
 * Reads one POSIX shell word: '…' literal segments, "…" segments with \" \\ \$ \` escapes, and bare
 * characters, concatenated. Returns null if the text is not exactly one word.
 */
export function shellWord(input: string): string | null {
  let out = ""; let index = 0;
  while (index < input.length) {
    const char = input[index];
    if (char === "'") {
      const end = input.indexOf("'", index + 1); if (end < 0) return null;
      out += input.slice(index + 1, end); index = end + 1;
    } else if (char === '"') {
      index++;
      while (index < input.length && input[index] !== '"') {
        if (input[index] === "\\" && index + 1 < input.length && '"\\$`'.includes(input[index + 1])) { out += input[index + 1]; index += 2; }
        else out += input[index++];
      }
      if (input[index] !== '"') return null;
      index++;
    } else if (char === "\\" && index + 1 < input.length) { out += input[index + 1]; index += 2; }
    else if (/\s/.test(char)) return null;
    else out += input[index++];
  }
  return out;
}

/**
 * The agent's own command without the wrapper Codex adds on Windows (`"…\powershell.exe" -Command '…'`,
 * POSIX-quoted) or elsewhere (`bash -lc '…'`). Multi-line scripts show their first line and a line count.
 */
export function unwrapCommand(raw: string): string {
  const text = raw.trim();
  const wrapped = /^(?:"[^"]*(?:powershell|pwsh)(?:\.exe)?"|\S*(?:powershell|pwsh)(?:\.exe)?)\s+(?:-\w+\s+)*?-Command\s+([\s\S]+)$/i.exec(text)
    ?? /^(?:"[^"]*(?:bash|sh)(?:\.exe)?"|\S*(?:bash|sh)(?:\.exe)?)\s+-l?c\s+([\s\S]+)$/i.exec(text);
  if (!wrapped) return text;
  const inner = wrapped[1].trim();
  return shellWord(inner) ?? ((inner.startsWith("'") && inner.endsWith("'")) || (inner.startsWith('"') && inner.endsWith('"')) ? inner.slice(1, -1) : inner);
}
/** Classifies the whole script; shows the line that earned the classification (or the first line). */
export function commandActivity(raw: string): { type: ReturnType<typeof classifyCommand>; detail: string } {
  const full = unwrapCommand(raw);
  const lines = full.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const type = classifyCommand(full);
  const shown = (type === "agent.command" ? lines[0] : lines.find((line) => classifyCommand(line) === type) ?? lines[0]) ?? full;
  const more = lines.length - 1;
  return { type, detail: more > 0 ? `${shown} (+${more} more line${more === 1 ? "" : "s"})` : shown };
}
export function displayCommand(raw: string): string { return commandActivity(raw).detail; }

const clip = (text: string, max = 400) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const firstLine = (text: string) => text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "";
const record = (value: unknown) => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined);
const str = (value: unknown) => (typeof value === "string" ? value : "");
const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);

function plan(items: { text: string; done: boolean; active?: boolean }[], source: string): { progress: TaskProgress; detail: string } {
  const completed = items.filter((item) => item.done).length;
  const current = items.find((item) => item.active)?.text ?? items.find((item) => !item.done)?.text ?? null;
  return {
    progress: { kind: "determinate", completed, total: items.length, source, current },
    detail: `${completed} / ${items.length} steps complete${current ? ` · ${clip(current, 160)}` : ""}`,
  };
}

/** Codex `exec --json` events. Stateful so a command reported on both item.started and item.completed appears once. */
export class CodexNormalizer {
  seen = new Set<string>();
  normalize(event: Record<string, unknown>): NormalizedEvent[] {
    const out: NormalizedEvent[] = [];
    if (typeof event.thread_id === "string") out.push({ type: "", detail: "", sessionId: event.thread_id });
    const item = record(event.item);
    if (item) {
      const type = str(item.type), id = str(item.id), phase = str(event.type);
      if (type === "agent_message") {
        if (phase === "item.completed") out.push({ type: "", detail: "", output: str(item.text) });
      } else if (type === "reasoning") {
        if (phase === "item.completed") out.push({ type: "agent.thinking", detail: clip(firstLine(str(item.text)).replace(/^\*\*|\*\*$/g, "")) || "Codex reported a reasoning step." });
      } else if (type === "command_execution") {
        const command = commandActivity(str(item.command));
        const exit = typeof item.exit_code === "number" ? item.exit_code : null;
        if (!this.seen.has(id)) out.push({ type: command.type, detail: clip(command.detail) });
        else if (phase === "item.completed" && exit !== null && exit !== 0) out.push({ type: "agent.command", detail: clip(`Exited ${exit}: ${command.detail}`) });
        if (id) this.seen.add(id);
      } else if (type === "file_change") {
        const changes = Array.isArray(item.changes) ? item.changes.map(record).filter(Boolean) as Record<string, unknown>[] : [];
        if (!this.seen.has(id)) out.push({ type: "agent.editing", detail: clip(changes.map((change) => `${str(change.kind) || "update"} ${str(change.path)}`).join(", ") || "Codex reported a file change.") });
        if (id) this.seen.add(id);
      } else if (type === "todo_list") {
        const items = (Array.isArray(item.items) ? item.items : []).map(record).filter(Boolean).map((row) => ({ text: str(row!.text), done: row!.completed === true }));
        if (items.length) out.push({ type: "agent.planning", ...plan(items, "Codex todo list") });
      } else if (type === "mcp_tool_call") {
        if (!this.seen.has(id)) out.push({ type: "agent.tool", detail: clip([str(item.server), str(item.tool)].filter(Boolean).join(".") || "MCP tool call") });
        if (id) this.seen.add(id);
      } else if (type === "web_search") {
        if (!this.seen.has(id)) out.push({ type: "agent.searching", detail: clip(str(item.query) || "Web search") });
        if (id) this.seen.add(id);
      } else if (type === "error") {
        out.push({ type: "agent.warning", detail: clip(str(item.message) || "Codex reported an item error.") });
      } else if (!this.seen.has(id)) {
        out.push({ type: "agent.tool", detail: type || "Provider event" });
        if (id) this.seen.add(id);
      }
    }
    // Codex emits non-fatal `error` events (reconnects, stream retries) during runs that still succeed;
    // only a failed turn or a non-zero exit decides the outcome.
    if (event.type === "error") out.push({ type: "agent.warning", detail: str(event.message) || "Provider reported a recoverable error." });
    else if (event.type === "turn.failed") out.push({ type: "agent.error", detail: str(record(event.error)?.message) || str(event.message) || JSON.stringify(event.error) });
    else if (event.type === "turn.completed") {
      const usage = record(event.usage);
      out.push({
        type: "agent.completed",
        detail: usage ? `Codex turn completed · ${num(usage.input_tokens)} input / ${num(usage.output_tokens)} output tokens` : "Codex turn completed.",
        usage: usage ? { inputTokens: num(usage.input_tokens), outputTokens: num(usage.output_tokens), cachedInputTokens: num(usage.cached_input_tokens), source: "codex turn.completed" } : undefined,
      });
    }
    return out;
  }
}

function claudeTool(name: string, input: Record<string, unknown>): NormalizedEvent {
  const path = str(input.file_path) || str(input.notebook_path) || str(input.path);
  if (name === "TodoWrite") {
    const todos = (Array.isArray(input.todos) ? input.todos : []).map(record).filter(Boolean).map((todo) => ({ text: str(todo!.content) || str(todo!.activeForm), done: todo!.status === "completed", active: todo!.status === "in_progress" }));
    return todos.length ? { type: "agent.planning", ...plan(todos, "Claude Code todo list") } : { type: "agent.planning", detail: "Claude Code updated its todo list." };
  }
  if (/^(Read|NotebookRead|LS)$/.test(name)) return { type: "agent.reading", detail: clip(path || name) };
  if (/^(Glob|Grep)$/.test(name)) return { type: "agent.searching", detail: clip([str(input.pattern), str(input.path)].filter(Boolean).join(" in ") || name) };
  if (name === "WebSearch") return { type: "agent.searching", detail: clip(str(input.query) || name) };
  if (name === "WebFetch") return { type: "agent.searching", detail: clip(str(input.url) || name) };
  if (/^(Write|Edit|MultiEdit|NotebookEdit)$/.test(name)) return { type: "agent.editing", detail: clip(path || name) };
  if (/^(Bash|PowerShell)$/.test(name)) { const command = commandActivity(str(input.command)); return { type: command.type, detail: clip(command.detail || name) }; }
  if (/^(Task|Agent)$/.test(name)) return { type: "agent.tool", detail: clip(`Subagent: ${str(input.description) || str(input.subagent_type) || name}`) };
  return { type: normalizedTool(name), detail: clip(name) };
}

/** Name-only fallback for tools Bunny-A has no specific rule for. */
export function normalizedTool(name: string): string {
  if (/todo/i.test(name)) return "agent.planning";
  if (/read|list|file_search/i.test(name)) return "agent.reading";
  if (/grep|glob|search|fetch/i.test(name)) return "agent.searching";
  if (/edit|write|patch/i.test(name)) return "agent.editing";
  if (/bash|powershell|command|exec/i.test(name)) return "agent.command";
  return "agent.tool";
}

/** Claude Code `--output-format stream-json` events. */
export class ClaudeNormalizer {
  normalize(event: Record<string, unknown>): NormalizedEvent[] {
    const out: NormalizedEvent[] = [];
    if (event.type === "system" && event.subtype === "init") out.push({ type: "", detail: "", billingSource: typeof event.apiKeySource === "string" ? event.apiKeySource : "unknown" });
    if (typeof event.session_id === "string") out.push({ type: "", detail: "", sessionId: event.session_id });
    // The init message names the model; the process spawn already produced agent.started.
    if (typeof event.model === "string") out.push({ type: "", detail: "", model: event.model });
    const message = record(event.message);
    const content = Array.isArray(message?.content) ? message!.content.map(record).filter(Boolean) as Record<string, unknown>[] : [];
    for (const part of content) {
      if (part.type === "text" && str(part.text)) out.push({ type: "", detail: "", output: str(part.text) });
      else if (part.type === "tool_use") out.push(claudeTool(str(part.name), record(part.input) ?? {}));
      else if (part.type === "thinking") out.push({ type: "agent.thinking", detail: "Claude Code reported a thinking step." });
      else if (part.type === "tool_result" && part.is_error === true) {
        const text = typeof part.content === "string" ? part.content : Array.isArray(part.content) ? part.content.map((row) => str(record(row)?.text)).join(" ") : "";
        out.push({ type: "agent.warning", detail: clip(firstLine(text) || "A tool call returned an error.") });
      }
    }
    if (event.type === "rate_limit_event") {
      const info = record(event.rate_limit_info);
      const windows = claudeRateLimits(info);
      if (windows.length) out.push({ type: "", detail: "", rateLimits: windows, limitStatus: claudeLimitStatus(info) ?? undefined });
    }
    if (event.type === "result") {
      const denials = Array.isArray(event.permission_denials) ? event.permission_denials : [];
      if (denials.length) {
        const tools = [...new Set(denials.map((denial) => str(record(denial)?.tool_name)).filter(Boolean))];
        // Print mode denies immediately; nothing is left waiting for approval.
        out.push({ type: "agent.warning", detail: `Permission denied in this non-interactive session: ${tools.join(", ") || "tool"}.` });
      }
      const usage = record(event.usage);
      const tokens = usage ? { inputTokens: num(usage.input_tokens) + num(usage.cache_creation_input_tokens), outputTokens: num(usage.output_tokens), cachedInputTokens: num(usage.cache_read_input_tokens), source: "claude result" } : undefined;
      if (event.is_error) out.push({ type: "agent.error", detail: str(event.result) || str(event.subtype) || "Provider reported a failed turn.", usage: tokens });
      else out.push({ type: "agent.completed", detail: `Claude Code finished${typeof event.num_turns === "number" ? ` after ${event.num_turns} turns` : ""}.`, usage: tokens });
    }
    return out;
  }
}

/**
 * Claude Code reports its subscription limits inside the session stream. Observed shape (Claude Code
 * 2.1.287): `rate_limit_info.unifiedWindows = { five_hour: { utilization: 0.62, resetsAt: <epoch s> },
 * seven_day: { utilization: 0.33, resetsAt } }`, utilization being a 0–1 fraction. Only windows that
 * carry a numeric utilization are returned; nothing is inferred for missing ones.
 */
export function claudeRateLimits(info: Record<string, unknown> | undefined): UsageWindow[] {
  const windows = record(info?.unifiedWindows);
  if (!windows) return [];
  const known: Record<string, { label: string; kind: "short" | "weekly"; minutes: number }> = {
    five_hour: { label: "5 hour window", kind: "short", minutes: 300 },
    seven_day: { label: "Weekly", kind: "weekly", minutes: 10080 },
  };
  const out: UsageWindow[] = [];
  for (const [key, shape] of Object.entries(known)) {
    const window = record(windows[key]);
    const fraction = window?.utilization;
    if (typeof fraction !== "number" || !Number.isFinite(fraction)) continue;
    const resetsAt = typeof window!.resetsAt === "number" ? window!.resetsAt * 1000 : null;
    out.push({ label: shape.label, usedPercent: Math.max(0, Math.min(100, Math.round(fraction * 1000) / 10)), resetsAt, kind: shape.kind, windowMinutes: shape.minutes });
  }
  return out;
}
/** Claude Code's own verdict for the current limit ("allowed", or a refusal such as "rejected"). */
export function claudeLimitStatus(info: Record<string, unknown> | undefined): string | null {
  return typeof info?.status === "string" ? info.status : null;
}
