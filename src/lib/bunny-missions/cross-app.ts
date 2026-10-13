import type { ReplaySafety } from "../bunny-host/agent-types.ts";
import type { JsonValue, RiskClass } from "./types.ts";

/** Additive Mission metadata. Identity, dependencies, attempts and artifacts keep their existing owners. */
export type CrossAppMetadata = {
  version: "ma3.cross-app.v1";
  inputs: { parameter: "content"; stepId: string; field: "text" }[];
};
export type CrossAppConsent = {
  version: "ma3.cross-app.v1";
  operations: { stepId: string; action: string; digest: string }[];
};
export type OperationContract = {
  authorizationCategory: string;
  resourceScope: string;
  sideEffect: RiskClass;
  verification: string;
  cancellation: string;
  replay: ReplaySafety;
};
const read = (family: string, verification: string): OperationContract => ({
  authorizationCategory: family, resourceScope: family === "browser" ? "Exact approved origin and Mission-owned session" : family === "computer" ? "Verified Calculator package and current native lifetime" : "Canonical approved root and current identity",
  sideEffect: "READ", verification, cancellation: "Abort before the next bounded operation; retain completed evidence", replay: "SAFE_TO_REPLAY",
});

/** Positive Host operation catalog. An unknown name never obtains execution semantics. */
export function operationContract(action: string): OperationContract | null {
  if (["filesystem.read", "filesystem.list", "filesystem.exists", "filesystem.search", "filesystem.metadata", "filesystem.compare", "filesystem.hash"].includes(action)) return read("filesystem", "Independent current disk observation/hash");
  if (action === "filesystem.write") return { ...read("filesystem", "Independent file hash/content check with before/after evidence"), sideEffect: "WRITE", replay: "VERIFY_BEFORE_REPLAY" };
  if (["git.status", "git.diff", "git.log", "git.tracked_files", "git.branch", "git.commit_info"].includes(action)) return read("git", "Fresh bounded Git observation with hooks/config/text conversion disabled");
  if (action === "terminal.exec") return { ...read("terminal", "Genuine owned-process exit and reviewed output assertion"), sideEffect: "EXECUTE", replay: "NOT_REPLAYABLE", cancellation: "Owned process group only; bounded timeout; no stale PID cleanup" };
  if (["browser.navigate", "browser.read", "browser.extract", "browser.metadata", "browser.wait", "browser.screenshot"].includes(action)) return read("browser", "Independent DOM/navigation observation in the same origin-bound session");
  if (action === "computer.read_calculator") return read("computer", "Fresh UIA arithmetic result with native lifetime/package corroboration");
  if (action === "computer.open_app") return { ...read("computer", "Fresh native identity and package observation; T9R acquisition/reuse ledger"), sideEffect: "EXECUTE", replay: "VERIFY_BEFORE_REPLAY" };
  if (["computer.focus_window", "computer.invoke_control"].includes(action)) return { ...read("computer", "Fresh UIA postcondition; target/focus uncertainty stops execution"), sideEffect: "EXECUTE", replay: "UNKNOWN" };
  return null;
}

export const CROSS_APP_FAILURES = ["CAPABILITY_UNAVAILABLE", "TARGET_UNAVAILABLE", "TARGET_CHANGED", "AUTHORIZATION_REQUIRED", "RESOURCE_OUT_OF_SCOPE", "FOCUS_DENIED", "VERIFICATION_FAILED", "EXECUTION_INTERRUPTED", "REPLAY_UNSAFE", "TIMEOUT"] as const;
export type CrossAppFailure = typeof CROSS_APP_FAILURES[number];
export function crossAppFailure(category: string, detail: string): CrossAppFailure {
  if (category === "verification_failed") return "VERIFICATION_FAILED";
  if (category === "timeout") return "TIMEOUT";
  if (/foreground|focus/i.test(detail)) return "FOCUS_DENIED";
  if (/lifetime|target.*changed|window.*changed|identity.*changed|stale.*target/i.test(detail)) return "TARGET_CHANGED";
  if (/no .*window|target.*unavailable|control.*not found/i.test(detail)) return "TARGET_UNAVAILABLE";
  if (/scope|outside|escape/i.test(detail)) return "RESOURCE_OUT_OF_SCOPE";
  if (category === "permission_required" || category === "permission_denied") return "AUTHORIZATION_REQUIRED";
  if (category === "host_restart" || category === "user_stopped") return "EXECUTION_INTERRUPTED";
  if (/replay|uncertain|ambiguous/i.test(detail)) return "REPLAY_UNSAFE";
  return "CAPABILITY_UNAVAILABLE";
}

const PRIVATE_TEXT = /\b(?:sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|Bearer\s+[A-Za-z0-9._~+/=-]{12,})\b|\b(?:api[_-]?key|secret|password|credential|session[_-]?cookie)["']?\s*[:=]\s*["']?[^\s"']+/gi;
export function safeSemanticText(value: string): string { return value.replace(PRIVATE_TEXT, "[redacted]"); }
/** Bounded data for canonical artifact handoffs. No OS handle, credential, cookie or provider reasoning. */
export function semanticOutput(action: string, output: unknown): Record<string, JsonValue> {
  if (!output || typeof output !== "object") return {};
  const value = output as Record<string, unknown>;
  const allowed: Record<string, string[]> = {
    "filesystem.read": ["path", "bytes", "text", "sha256"], "filesystem.write": ["path", "bytes", "created", "sha256", "beforeSha256"],
    "filesystem.hash": ["path", "sha256", "matches"], "filesystem.compare": ["path", "matches", "sha256"], "filesystem.exists": ["path", "exists", "kind"],
    "filesystem.metadata": ["path", "bytes", "kind", "modifiedAt"], "filesystem.search": ["path", "matches", "truncated"], "filesystem.list": ["path", "entries"],
    "git.status": ["branch", "changes", "clean"], "git.diff": ["stat", "empty", "against"], "git.log": ["commits"], "git.tracked_files": ["files"], "git.branch": ["branch", "head"], "git.commit_info": ["commit", "subject"],
    "terminal.exec": ["exitCode", "stdout", "stderr", "durationMs", "timedOut", "executionBoundary"],
    "browser.navigate": ["tabId", "sessionRef", "url", "title", "status"], "browser.read": ["tabId", "sessionRef", "url", "title", "text", "headings"], "browser.extract": ["tabId", "sessionRef", "url", "items"],
    "browser.metadata": ["tabId", "sessionRef", "url", "title"], "browser.wait": ["tabId", "sessionRef", "url"], "browser.screenshot": ["sessionRef", "url", "path"],
    "computer.open_app": ["decision", "newWindows"], "computer.read_calculator": ["result"], "computer.invoke_control": ["pattern"], "computer.focus_window": ["focused"],
  };
  const clean = (item: unknown, depth = 0): JsonValue => {
    if (item === null || typeof item === "boolean" || typeof item === "number" && Number.isFinite(item)) return item as JsonValue;
    if (typeof item === "string") return safeSemanticText(item).slice(0, 16_000);
    if (depth < 2 && Array.isArray(item)) return item.slice(0, 100).map(row => clean(row, depth + 1));
    if (depth < 2 && item && typeof item === "object") return Object.fromEntries(Object.entries(item).filter(([key]) => !/token|secret|password|credential|cookie|handle|pid|thinking/i.test(key)).slice(0, 10).map(([key, row]) => [key, clean(row, depth + 1)]));
    return null;
  };
  return Object.fromEntries((allowed[action] ?? []).filter(key => Object.hasOwn(value, key)).map(key => [key, clean(value[key])]));
}
