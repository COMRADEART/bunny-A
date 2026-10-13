/**
 * M-A-3 T13.1: presentation helpers for Settings → AI & Models. Pure naming of the Host's
 * secret-free IntelligenceSnapshot; nothing here claims a connection the Host did not report.
 * "Saved" means encrypted on this PC; only a Host-recorded test makes anything "tested".
 */
import type { IntelligenceSnapshot } from "../../lib/bunny-host/intelligence-snapshot.ts";
import { isLayaModel, type JevConnectionState, type JevPolicy } from "../../lib/bunny-host/intelligence.ts";
import type { OrchTask } from "../../lib/orch/types.ts";

export const JEV_STATE_LABEL: Record<JevConnectionState, string> = {
  DISABLED: "Off",
  NO_CREDENTIAL: "No API key",
  SAVED_NOT_VERIFIED: "Saved, not tested",
  CONNECTING: "Connecting…",
  CONNECTED: "Connected",
  AUTH_FAILED: "Key refused",
  RATE_LIMITED: "Rate limited",
  BUDGET_EXHAUSTED: "Allowance used",
  NETWORK_UNAVAILABLE: "Network unavailable",
  PROVIDER_ERROR: "Provider error",
};
export type Tone = "ok" | "warn" | "off" | "bad";
export function jevTone(state: JevConnectionState): Tone {
  if (state === "CONNECTED") return "ok";
  if (state === "DISABLED" || state === "NO_CREDENTIAL") return "off";
  if (state === "AUTH_FAILED" || state === "PROVIDER_ERROR") return "bad";
  return "warn";
}

export const LAYA_STATUS_LABEL: Record<IntelligenceSnapshot["laya"]["status"], string> = {
  installed: "Installed",
  missing: "Missing",
  offline: "Runtime offline",
  unavailable: "Unavailable",
};

const ACTIVE: ReadonlySet<OrchTask["state"]> = new Set(["queued", "routing", "waiting_for_approval", "launching", "running", "waiting_for_input", "waiting_for_agent_approval", "verifying", "paused"]);

export type Distinction = { key: string; label: string; value: boolean; detail: string };

/** The six facts Settings must keep apart, each read from Host state. */
export function layaDistinctions(snapshot: IntelligenceSnapshot, tasks: readonly OrchTask[]): Distinction[] {
  const laya = snapshot.laya;
  const eligible = laya.enabled && laya.models.some((model) => model.routingEligible);
  const selected = tasks.filter((task) => ACTIVE.has(task.state) && task.provider === "ollama" && isLayaModel(task.model)).length;
  return [
    { key: "local", label: "Available locally", value: laya.status === "installed", detail: laya.detail },
    { key: "enabled", label: "Allowed by you", value: laya.enabled, detail: laya.enabled ? "BunnyRouter may consider Laya." : "Laya is turned off in Settings." },
    { key: "benchmarked", label: "Benchmarked", value: laya.models.some((model) => model.benchmarks.some((row) => row.passed)), detail: "Only task classes with a passed local benchmark can route to Laya." },
    { key: "eligible", label: "Eligible for routing", value: eligible, detail: eligible ? "At least one benchmarked task class." : "Not eligible for automatic routing." },
    { key: "selected", label: "Selected for a Task", value: selected > 0, detail: selected ? `${selected} active Task${selected === 1 ? "" : "s"}.` : "No active Task uses Laya." },
  ];
}

export function jevDistinctions(snapshot: IntelligenceSnapshot, tasks: readonly OrchTask[]): Distinction[] {
  const jev = snapshot.jev;
  const tested = jev.lastTest?.ok === true;
  const assisted = tasks.filter((task) => ACTIVE.has(task.state) && task.decision.decision_assistance?.action === "accept" && task.decision.decision_assistance.changed === true).length;
  return [
    { key: "enabled", label: "Remote enabled", value: jev.enabled, detail: jev.enabled ? "You turned hosted decisions on." : "Off by default. No request is sent." },
    { key: "credential", label: "API key saved", value: jev.hasCredential, detail: jev.hasCredential ? `Encrypted with ${jev.credentialProtection}. Saving does not test the key.` : "No key saved." },
    { key: "tested", label: "Remote tested", value: tested, detail: tested ? (jev.lastTest!.inferenceVerified ? "Model discovery and a decision request succeeded." : "Model discovery succeeded; decision inference not tested.") : "Not tested since the key was saved." },
    { key: "eligible", label: "Eligible for routing", value: jev.usable, detail: jev.usable ? "BunnyRouter may ask for advice on the next automatic Task." : "BunnyRouter decides locally." },
    { key: "selected", label: "Advice used for a Task", value: assisted > 0, detail: assisted ? `${assisted} active Task${assisted === 1 ? "" : "s"} switched model on hosted advice.` : "No active Task switched model on hosted advice." },
  ];
}

/** Display mask: never derived from the key itself, so nothing about it (not even its length) is shown. */
export const MASKED_KEY = "••••••••••••";

/** Client-side shape check that mirrors the Host's; the Host re-validates. */
export function apiKeyProblem(input: string): string | null {
  const key = input.trim();
  if (!key) return "Enter an API key.";
  if (key.length < 8) return "That key is too short.";
  if (key.length > 512) return "That key is too long.";
  if (!/^[\x21-\x7e]+$/.test(key)) return "API keys contain no spaces or special characters.";
  return null;
}

export function usageLine(usage: IntelligenceSnapshot["jev"]["usage"], limits: JevPolicy["limits"]): string {
  const parts = [`${usage.dayRequests} of ${limits.maxRequestsPerDay} requests today`, `${usage.sessionRequests} of ${limits.maxRequestsPerSession} this session`];
  parts.push(usage.dayInputTokens === null ? "tokens unknown" : `${usage.dayInputTokens.toLocaleString()} input tokens`);
  parts.push(usage.dayCostUsd === null ? "cost unknown" : `$${usage.dayCostUsd.toFixed(4)} estimated`);
  return parts.join(" · ");
}

export function lastTestLine(lastTest: IntelligenceSnapshot["jev"]["lastTest"], now = Date.now()): string {
  if (!lastTest) return "Never tested.";
  const ago = Math.max(0, Math.round((now - lastTest.at) / 60_000));
  const when = ago < 1 ? "just now" : ago < 60 ? `${ago} min ago` : `${Math.round(ago / 60)} h ago`;
  return `${lastTest.ok ? "Passed" : "Failed"} ${when}${lastTest.latencyMs !== null ? ` · ${lastTest.latencyMs} ms` : ""}. ${lastTest.detail}`;
}

export function assistanceLine(last: IntelligenceSnapshot["lastAssistance"]): string {
  if (!last) return "No routing decision has used assistance yet.";
  const who = last.source === "jev" ? "TypeSafe Jev" : "Local Decision Policy";
  return `${who}: ${last.action}${last.confidence !== null ? ` (confidence ${Math.round(last.confidence * 100)}%)` : ""}. ${last.detail}`;
}

/** Bounded numeric edit; returns null when out of range so the field keeps its last valid value. */
export function boundedNumber(raw: string, min: number, max: number): number | null {
  if (raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= min && value <= max ? value : null;
}
