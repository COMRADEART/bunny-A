import { analyze, routeTask, scoreProvider, weights } from "../orch/router.ts";
import type { Mode, ProviderId, ProviderLive, RouteDecision, TaskConstraints } from "../orch/types.ts";
import { codexMissionExclusion } from "../orch/compatibility.ts";

export function inferredConstraints(prompt: string, constraints: TaskConstraints = {}): TaskConstraints {
  const filesystem=/\b(create|write|read|modify|edit|fix|debug|refactor|repair)\b[\s\S]*\b(file|repository|repo|script|test|code|folder)\b|\b[\w-]+\.(py|ts|tsx|js|mjs|txt)\b/i.test(prompt);
  const terminal=/\b(run|execute)\b[\s\S]*\b(test|command|script|python|npm|build|shell)\b/i.test(prompt);
  const git=/\bgit\s+(status|diff|log|commit|branch|checkout|switch|rebase|merge|pull|push|add|stash|init|clone|blame)\b|\b(commit|stage)\s+(the\s+|these\s+|my\s+|all\s+)?changes\b/i.test(prompt);
  return { ...constraints, requiresFilesystem:constraints.requiresFilesystem || filesystem || !!constraints.workingDirectory,requiresTerminal:constraints.requiresTerminal || terminal || git || constraints.requiresGit,requiresGit:constraints.requiresGit || git,localOnly: constraints.localOnly || constraints.sensitive || constraints.privacyLocal || /\blocal[- ]only\b|\bdon't send\b|\bdo not send\b|\b(?:social security number|patient record|private key|confidential|sensitive data)\b/i.test(prompt), offlineOnly: constraints.offlineOnly || /\boffline[- ]only\b/i.test(prompt) };
}
const STATUS: Record<string,string>={not_installed:"is not installed",authentication_required:"needs sign-in",rate_limited:"has reached its usage limit",offline:"is offline",unavailable:"is unavailable",unknown:"has an unknown status"};
/**
 * Locality is per model: a local service (Ollama) can proxy a tag to a hosted model, whose generation leaves
 * this machine. Mission accounting, local-only envelopes and local-only launches use this, never the provider label alone.
 */
export function runsLocally(provider: Pick<ProviderLive,"local_or_cloud"|"remoteModels"> | undefined, model: string | null | undefined): boolean {
  return !!provider && provider.local_or_cloud === "local" && !!model && !(provider.remoteModels ?? []).includes(model) && !/(:|-)cloud$/i.test(model);
}
/** The model a local-only task should use. A listed local preference wins. Otherwise the current local model, otherwise the first local model. */
export function localModel(provider: ProviderLive, preference?: string | null): string | null {
  if (preference && (provider.models ?? []).includes(preference) && runsLocally(provider, preference)) return preference;
  return runsLocally(provider, provider.current_model) ? provider.current_model : (provider.models ?? []).find((model) => runsLocally(provider, model)) ?? null;
}
/** Hard eligibility. A provider failing any rule is excluded outright; scores never override it. */
export function eligibility(provider: ProviderLive, constraints: TaskConstraints): string | null {
  if (!["ready","busy"].includes(provider.availability)) return `${provider.name} ${STATUS[provider.availability] ?? provider.availability}.`;
  if (!provider.installed) return `${provider.name} is not installed.`;
  if (!provider.authenticated) return `${provider.name} is not signed in.`;
  if (constraints.missionAccess) {
    const compatibility = codexMissionExclusion(provider, constraints.missionAccess);
    if (compatibility) return compatibility;
  }
  if ((constraints.localOnly || constraints.offlineOnly) && provider.local_or_cloud !== "local") return "Requires local execution; this provider runs in the cloud.";
  if ((constraints.localOnly || constraints.offlineOnly) && !localModel(provider)) return "Requires local execution; every installed model of this provider is cloud-hosted.";
  if (constraints.providerAllowlist && !constraints.providerAllowlist.includes(provider.id)) return "Outside provider allowlist.";
  if (constraints.providerDenylist?.includes(provider.id)) return "Provider denied.";
  if (constraints.requiresFilesystem && !provider.capabilities?.includes("filesystem")) return constraints.workingDirectory ? "Cannot work inside a specific folder (text generation only)." : "Filesystem capability unavailable.";
  if (constraints.requiresTerminal && !provider.capabilities?.includes("terminal")) return "Terminal capability unavailable.";
  if (constraints.requiresGit && !provider.capabilities?.includes("git")) return "Git unavailable to this provider (needs terminal access and git on this workstation).";
  if (constraints.requiresGPU && !provider.capabilities?.includes("gpu")) return "GPU execution capability unproven.";
  return null;
}
export function requirementsOf(constraints: TaskConstraints): string[] {
  return [
    constraints.missionAccess && `validated Mission ${constraints.missionAccess} security`,
    constraints.requiresFilesystem && "filesystem", constraints.requiresTerminal && "terminal", constraints.requiresGit && "git", constraints.requiresGPU && "gpu",
    constraints.localOnly && "local only", constraints.offlineOnly && "offline only", constraints.workingDirectory && `working directory ${constraints.workingDirectory}`,
    constraints.providerAllowlist?.length && `only ${constraints.providerAllowlist.join(", ")}`, constraints.providerDenylist?.length && `never ${constraints.providerDenylist.join(", ")}`,
  ].filter((value): value is string => typeof value === "string");
}
function usageNote(provider: ProviderLive): string | null {
  const windows = provider.usageWindows ?? [];
  if (!windows.length) return null;
  return `${provider.name} provider-reported usage: ${windows.map((window) => `${window.label} ${window.usedPercent}% used`).join(", ")}.`;
}
export function bunnyRoute(input: { prompt: string; mode: Mode; providers: ProviderLive[]; override?: ProviderId | "auto"; constraints?: TaskConstraints; learned?: (provider: ProviderId, type: string) => number; policyId?: string }): RouteDecision {
  const constraints = inferredConstraints(input.prompt,input.constraints);
  let pool = input.providers.filter(provider => !eligibility(provider,constraints));
  if (!pool.length) throw new Error(`No ready executor can satisfy this task's hard constraints. ${input.providers.map(provider => eligibility(provider, constraints)).filter(Boolean).join(" ")}`);
  const exactLocal = constraints.modelExact && pool.some((provider) => (provider.models ?? []).includes(constraints.modelExact!) && runsLocally(provider, constraints.modelExact)) ? constraints.modelExact : null;
  const preference = constraints.modelExact ? null : constraints.preferredLocalModel ?? null;
  const requestedLocal = exactLocal ?? preference;
  if (requestedLocal && (constraints.localOnly || constraints.offlineOnly)) {
    const holders = pool.filter((provider) => (provider.models ?? []).includes(requestedLocal) && runsLocally(provider, requestedLocal));
    if (!holders.length) throw new Error(exactLocal ? `Hard-pinned local model ${exactLocal} is unavailable. No substitute was selected.` : `Preferred local model ${preference} is unavailable. No authorized alternate was selected.`);
    pool = holders;
  }
  if (input.override && input.override !== "auto" && !pool.some(provider=>provider.id===input.override)) throw new Error(`Selected executor is not eligible for this task. ${input.providers.find(provider => provider.id === input.override) ? eligibility(input.providers.find(provider => provider.id === input.override)!, constraints) : "Provider was not found."}`);
  const features = analyze(input.prompt,input.mode);
  const learned = new Map(pool.map(live=>[live.id,input.learned?.(live.id,features.task_type) ?? 0]));
  const ranked = pool.map(live=>({provider: live.id, score: scoreProvider(live.id,input.prompt,input.mode,live)+learned.get(live.id)!})).sort((a,b)=>b.score-a.score || a.provider.localeCompare(b.provider));
  const manual = !!input.override && input.override !== "auto";
  const chosen = manual ? input.override as ProviderId : ranked[0].provider;
  const chosenLive = pool.find(provider=>provider.id===chosen)!;
  const decision = routeTask({...input,providers:pool,override: chosen});
  // A local-only task never inherits a cloud-hosted default model from a local service.
  const local = constraints.localOnly || constraints.offlineOnly ? localModel(chosenLive, requestedLocal) : null;
  if (requestedLocal && (constraints.localOnly || constraints.offlineOnly) && local !== requestedLocal) {
    throw new Error(exactLocal ? `Hard-pinned local model ${exactLocal} is unavailable. No substitute was selected.` : `Preferred local model ${preference} is unavailable. No authorized alternate was selected.`);
  }
  const substituted = local && local!==decision.recommended_model ? decision.recommended_model : null;
  if (local) decision.recommended_model = local;
  const excluded = input.providers.filter(provider=>!pool.includes(provider)).map(provider=>({provider:provider.id,reason:eligibility(provider,constraints) ?? (preference ? `Preferred local model ${preference} is not served by this provider.` : "Not eligible.")}));
  const requirements = requirementsOf(constraints);
  const delta = learned.get(chosen) ?? 0;
  const reasons = [
    manual ? `Manual override: ${chosenLive.name}.` : `${chosenLive.name} has the highest score of ${pool.length} eligible provider${pool.length === 1 ? "" : "s"}.`,
    `${chosenLive.name} is installed and ${chosenLive.availability} (probed on this Host).`,
    requirements.length ? `Hard requirements met: ${requirements.join(", ")}.` : "No hard requirements beyond a ready provider.",
    substituted ? `Local only: using local model ${decision.recommended_model}, not the cloud-hosted default ${substituted}.` : null,
    preference && local === preference ? `Preferred local model ${preference}. This onboarding choice is not a hard pin.` : null,
    `${features.task_type} task, complexity ${features.complexity.toFixed(2)}, ${input.mode} weights.`,
    delta ? `Verified history adjusts ${chosenLive.name} by ${delta >= 0 ? "+" : ""}${delta.toFixed(3)}.` : "No history weight yet (needs at least 5 recorded outcomes for this task type).",
    usageNote(chosenLive),
    "Confidence is an uncalibrated routing score, not a probability.",
  ].filter((value): value is string => !!value);
  return {
    ...decision,
    reason: `${manual ? "Manual override." : "BunnyRouter."} ${decision.reason.replace("Manual override. ","").replace("Auto route. ","")} Hard constraints checked. Confidence is an uncalibrated routing score.`,
    scores: ranked,
    alternatives: [...ranked.filter(row=>row.provider!==chosen).map(row=>({ ...row,note:"Eligible alternative; scored on task fit, workload and measured history." })),...excluded.map(row=>({provider:row.provider,score:0,note:row.reason}))].slice(0,5),
    mode: input.mode,
    requirements,
    eligible_providers: ranked.map(row=>row.provider),
    excluded,
    reasons,
    confidence_kind: "uncalibrated_score",
    policy_id: input.policyId,
    inputs: {
      weights: weights(input.mode), latency_priority: features.latency_priority, privacy_priority: features.privacy_priority, context_requirement: features.context_requirement,
      workload: Object.fromEntries(pool.map(provider=>[provider.id,provider.active_jobs])), history: Object.fromEntries([...learned].map(([id,value])=>[id,Number(value.toFixed(4))])),
      quota: Object.fromEntries(pool.filter(provider=>provider.usageWindows?.length).map(provider=>[provider.id,provider.usageWindows!.map(window=>({label:window.label,usedPercent:window.usedPercent}))])),
    },
  };
}
/** The routing result in the camelCase shape used by reports and the M2 specification. */
export function structuredDecision(decision: RouteDecision) {
  return {
    taskType: decision.task_type, complexity: Number(decision.complexity.toFixed(2)), mode: decision.mode ?? null, requirements: decision.requirements ?? [],
    eligibleProviders: decision.eligible_providers ?? decision.scores.map(row=>row.provider), recommendedProvider: decision.recommended_provider,
    confidenceScore: Number(decision.confidence.toFixed(2)), confidenceKind: decision.confidence_kind ?? "uncalibrated_score",
    reasons: decision.reasons ?? [decision.reason], scores: decision.scores.map(row=>({provider:row.provider,score:Number(row.score.toFixed(3))})),
    alternatives: decision.alternatives.map(row=>({provider:row.provider,reason:row.note})),
  };
}
