import type { AgentCheckpoint } from "./agent-types.ts";

/**
 * §9 checkpoint material guard. A checkpoint is a safe reconstruction point: canonical references
 * and whitelisted facts only. Prohibited material (live process handles, stale PID authority, raw
 * HWND authority, browser cookie material, provider hidden state, provider private chain-of-thought)
 * is refused before anything is written; credentials never pass. The scanner returns structural
 * findings — pattern names and key names — never the matched secret text itself.
 */
export const CHECKPOINT_SECRET_PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: "api-key:sk-style", pattern: /\bsk-[A-Za-z0-9_-]{16,}\b/ },
  { name: "auth:bearer-header", pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/i },
  { name: "creds:key-value", pattern: /\b(api[_-]?key|apikey|secret|passwd|password|credential|bearer|session[_-]?cookie)["']?\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{8,}/i },
  { name: "creds:provider-token-shape", pattern: /\b(ghp_[A-Za-z0-9]{20,}|xox[bap]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|eyJhbGciOi[A-Za-z0-9._-]{20,})\b/ },
];
/** Field names that may never appear in a checkpoint, at any depth. */
const FORBIDDEN_KEY = /(^pid$|^hpid$|^hwnd$|handle|cookie|token|secret|passw|apikey|api[_-]?key|chain[_-]?of[_-]?thought|hidden[_-]?state|thinking|scratchpad|cwd_secret)/i;
const FORCED_LIMIT = 400;

export type CheckpointScan = { safe: boolean; findings: string[] };
export function scanCheckpointJson(json: string): CheckpointScan {
  const findings: string[] = [];
  for (const rule of CHECKPOINT_SECRET_PATTERNS) if (rule.pattern.test(json)) findings.push(`secret-pattern:${rule.name}`);
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { findings.push("structure:unparseable-json"); return { safe: false, findings }; }
  const walk = (value: unknown, at: string) => {
    if (value && typeof value === "object") {
      for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        if (FORBIDDEN_KEY.test(key)) findings.push(`forbidden-key:${key}`); else walk(item, `${at}.${key}`);
      }
    } else if (typeof value === "string" && value.length > FORCED_LIMIT) findings.push("oversized-string");
  };
  walk(parsed, "");
  return { safe: findings.length === 0, findings: [...new Set(findings)] };
}

/** Throws with structural findings only; the caller treats any throw as CHECKPOINT_INVALID. */
export function assertCheckpointSafe(checkpoint: AgentCheckpoint): void {
  const scan = scanCheckpointJson(JSON.stringify(checkpoint));
  if (!scan.safe) throw new Error(`Checkpoint refused by material guard: ${scan.findings.join(", ")}`);
}
/** Canonical checkpoint rows: parse on read fails closed (same recipe as routing decisions). */
export function parseCheckpoint(record: string): AgentCheckpoint {
  const parsed = JSON.parse(record) as AgentCheckpoint;
  const required = parsed && typeof parsed === "object" && typeof parsed.id === "string" && typeof parsed.runId === "string";
  const boundary = (parsed as { boundary?: unknown }).boundary;
  if (!required || typeof boundary !== "string") throw new Error("Checkpoint record is corrupt.");
  return parsed;
}