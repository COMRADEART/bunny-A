import type { ContextNeed, Mode, ProviderId, ProviderLive, RouteDecision, TaskType } from "./types";

type Cap = {
  coding: number;
  debug: number;
  research: number;
  writing: number;
  ops: number;
  general: number;
  context: number;
  speed: number;
  local: boolean;
};

const CAP: Record<ProviderId, Cap> = {
  openrouter: { coding: 0.5, debug: 0.5, research: 0.5, writing: 0.5, ops: 0.5, general: 0.5, context: 0.5, speed: 0.5, local: false },
  opencode: { coding: 0.8, debug: 0.8, research: 0.7, writing: 0.6, ops: 0.7, general: 0.7, context: 0.75, speed: 0.5, local: false },
  codex: { coding: 0.95, debug: 0.92, research: 0.72, writing: 0.6, ops: 0.7, general: 0.74, context: 0.9, speed: 0.42, local: false },
  claude: { coding: 0.86, debug: 0.84, research: 0.95, writing: 0.9, ops: 0.66, general: 0.88, context: 0.92, speed: 0.4, local: false },
  ollama: { coding: 0.58, debug: 0.52, research: 0.48, writing: 0.55, ops: 0.5, general: 0.56, context: 0.45, speed: 0.9, local: true },
  cline: { coding: 0.84, debug: 0.8, research: 0.5, writing: 0.4, ops: 0.6, general: 0.6, context: 0.7, speed: 0.5, local: false },
  cursor: { coding: 0.9, debug: 0.88, research: 0.55, writing: 0.45, ops: 0.62, general: 0.64, context: 0.78, speed: 0.52, local: false },
};

function clamp(n: number, lo = 0, hi = 1) {
  return Math.min(hi, Math.max(lo, n));
}

export function analyze(prompt: string, mode: Mode) {
  const text = prompt.toLowerCase();
  const coding = /code|implement|refactor|test|bug|repo|function|typescript|debug|api|harness/.test(text);
  const research = /research|compare|paper|explain|summar|why|analy/.test(text);
  const writing = /write|draft|email|docs?\b|readme/.test(text);
  const ops = /deploy|docker|install|server|infra/.test(text);
  let task_type: TaskType = "general";
  if (coding && /debug|bug|failing|error|broken/.test(text)) task_type = "debug";
  else if (coding) task_type = "coding";
  else if (research) task_type = "research";
  else if (writing) task_type = "writing";
  else if (ops) task_type = "ops";

  const complexity = clamp(
    0.22 +
      Math.min(0.3, prompt.length / 900) +
      (coding ? 0.12 : 0) +
      (/repo|distributed|harness|architecture|migration|suite/.test(text) ? 0.28 : 0) +
      (/typo|rename|one line|simple|quick/.test(text) ? -0.22 : 0),
  );
  const privacy_priority = /private|local only|offline|secret|on this machine|don't send|do not send/.test(text) ? 0.86 : 0.28;
  const latency_priority = mode === "fast" ? 0.86 : mode === "balanced" ? 0.5 : 0.22;
  const context_requirement: ContextNeed = complexity > 0.68 ? "high" : complexity > 0.4 ? "medium" : "low";
  return { task_type, complexity, latency_priority, privacy_priority, context_requirement };
}

export function weights(mode: Mode) {
  if (mode === "fast") return { fit: 0.22, speed: 0.4, local: 0.28, context: 0.1 };
  if (mode === "deep") return { fit: 0.48, speed: 0.05, local: 0.07, context: 0.4 };
  return { fit: 0.4, speed: 0.22, local: 0.13, context: 0.25 };
}

function availabilityFactor(live: ProviderLive) {
  if (live.availability === "offline" || live.availability === "unavailable" || live.availability === "not_installed" || live.availability === "unknown") return 0.32;
  if (live.availability === "rate_limited") return 0.45;
  if (live.availability === "busy") return 0.62;
  if (live.availability === "authentication_required") return 0.78;
  return 1;
}

export function scoreProvider(id: ProviderId, prompt: string, mode: Mode, live: ProviderLive) {
  const features = analyze(prompt, mode);
  const cap = CAP[id];
  const fit = cap[features.task_type];
  const w = weights(mode);
  const contextBoost = features.context_requirement === "high" ? 1 : features.context_requirement === "medium" ? 0.72 : 0.5;
  let score =
    fit * w.fit +
    cap.speed * w.speed +
    (cap.local ? 1 : 0) * w.local * (0.35 + features.privacy_priority) +
    cap.context * w.context * contextBoost;
  if (mode === "deep" && features.complexity > 0.6) score += cap.context * 0.15 + fit * 0.1;
  if (mode === "fast" && features.complexity < 0.4) score += cap.speed * 0.08 + (cap.local ? 0.1 : 0);
  if (features.privacy_priority > 0.7 && !cap.local) score -= 0.1;
  if (features.privacy_priority > 0.7 && cap.local) score += 0.08;
  score *= availabilityFactor(live);
  score -= Math.min(0.18, live.active_jobs * 0.05);
  return score;
}

function noteFor(id: ProviderId, winner: ProviderId, live: ProviderLive) {
  if (id === winner) return "Selected";
  if (live.availability === "offline") return "Offline on this host";
  if (live.availability === "authentication_required") return "Suitable, but this host has no credential yet";
  if (live.availability === "not_installed") return "Not installed on this host";
  if (live.availability === "unavailable" || live.availability === "unknown") return "Not usable on this host right now";
  if (CAP[id].local && !CAP[winner].local) return "Local and faster, weaker fit for this task";
  if (!CAP[id].local && CAP[winner].local) return "Stronger model, higher latency, leaves the machine";
  if (CAP[id].context > CAP[winner].context) return "More context headroom, lower task fit";
  return "Lower score on this task, mode, and host state";
}

export function routeTask(input: {
  prompt: string;
  mode: Mode;
  providers: ProviderLive[];
  override?: ProviderId | "auto";
}): RouteDecision {
  const features = analyze(input.prompt, input.mode);
  const pool = input.providers.filter((provider) => !provider.extension || provider.installed);
  const ranked = pool
    .map((provider) => ({ provider: provider.id, score: scoreProvider(provider.id, input.prompt, input.mode, provider), live: provider }))
    .sort((a, b) => b.score - a.score);
  const auto = ranked[0];
  const chosenId = input.override && input.override !== "auto" ? input.override : auto?.provider ?? "ollama";
  const chosen = ranked.find((row) => row.provider === chosenId) ?? ranked[0];
  const second = ranked.find((row) => row.provider !== chosen?.provider);
  const margin = chosen && second ? chosen.score - second.score : 0.2;
  const confidence = clamp(0.58 + margin * 1.4);
  const live = input.providers.find((provider) => provider.id === chosenId);
  const fit = CAP[chosenId][features.task_type];
  const reason = [
    input.override && input.override !== "auto" ? "Manual override." : "Auto route.",
    `${features.task_type} task, complexity ${features.complexity.toFixed(2)}, mode ${input.mode}.`,
    CAP[chosenId].local ? "Stays on this machine." : "Cloud executor.",
    live?.availability === "ready" ? "Provider is ready." : `Provider status: ${live?.availability ?? "unknown"}.`,
    fit >= 0.85 ? "Strong fit for this task type." : "Best available tradeoff of fit, latency, and privacy.",
  ].join(" ");

  return {
    ...features,
    recommended_provider: chosenId,
    recommended_model: live?.current_model ?? "auto",
    confidence,
    reason,
    alternatives: ranked
      .filter((row) => row.provider !== chosenId)
      .slice(0, 3)
      .map((row) => ({ provider: row.provider, score: Number(row.score.toFixed(3)), note: noteFor(row.provider, chosenId, row.live) })),
    scores: ranked.map((row) => ({ provider: row.provider, score: Number(row.score.toFixed(3)) })),
  };
}
