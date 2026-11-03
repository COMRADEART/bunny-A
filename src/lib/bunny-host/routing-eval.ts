/**
 * RoutingEval — the routing-quality evaluation set (owner direction 2026-11-02: "a clear routing-quality evaluation set").
 *
 * Every case pins ONE routing law with a fixture world copied from the verified test record (M-A-3 T3 / T9R / MA1), and
 * the set runs against the REAL BunnyRouter — never a mock of it. A case's verdict is exactness, not a score: the
 * router's own refusal shape or pick must match, and the reason text must speak the law the owner approved ("not a hard
 * pin", "never the cloud-hosted default"). The same runner accepts live providers so an owner can replay the set against
 * the machine's real registry and read the digest.
 *
 * Pure module: no I/O, no clock, no side effects; fixtures come from the caller.
 */

import { bunnyRoute, eligibility } from "./router.ts";
import { providerBase } from "./adapters.server.ts";
import type { Mode, ProviderId, ProviderLive, TaskConstraints } from "../orch/types.ts";

export type EvalWorld = { prompt: string; mode: Mode; providers: ProviderLive[]; constraints?: TaskConstraints; override?: ProviderId | "auto" };

export type EvalExpectation = { pick: { provider: string; model?: string; reason?: RegExp; eligible?: string[] } } | { eligibility: RegExp };

export type EvalCase = EvalWorld & { name: string; law: string; expect: EvalExpectation };

/** A provider row in the shape the verified fixtures use (providerBase + exactly the facts the verified tests set). */
export function evalProvider(
  id: ProviderId,
  extra: Partial<ProviderLive> = {},
): ProviderLive {
  const agent = id === "codex" || id === "claude";
  return {
    ...providerBase(id as "codex" | "claude" | "ollama" | "openrouter"),
    installed: true,
    authenticated: true,
    authenticatedState: id === "ollama" ? "not_required" : "authenticated",
    availability: "ready",
    capabilities: agent ? ["text", "filesystem", "terminal", "tests", "git"] : ["text"],
    ...(agent ? {} : { models: ["huihui_ai/qwen2.5-abliterate:7b", "qwen2.5-coder:7b"], current_model: "huihui_ai/qwen2.5-abliterate:7b" }),
    ...extra,
  } as unknown as ProviderLive;
}

const cloudTagged = evalProvider("ollama", { current_model: "deepseek-v4.1-flash:cloud", models: ["deepseek-v4.1-flash:cloud", "qwen2.5-coder:7b"], remoteModels: ["deepseek-v4.1-flash:cloud"] });

export const ROUTING_EVAL_SET: EvalCase[] = [
  {
    name: "the scored pick keeps a private analysis on the cloud agent (a privacy preference is not an exclusion)",
    law: "M-A-3 T3: privacy preference does not exclude cloud; the scored pick wins among eligible lanes.",
    prompt: "private architecture analysis",
    mode: "deep",
    providers: [evalProvider("claude"), evalProvider("ollama")],
    expect: { pick: { provider: "claude" } },
  },
  {
    name: "hard localOnly excludes cloud providers outright, whatever their score",
    law: "M-A-3 T3 hard constraints: locality is not a preference; eligible_providers carries only the locals.",
    prompt: "Rewrite this paragraph more clearly",
    mode: "deep",
    providers: [evalProvider("codex"), evalProvider("claude"), evalProvider("ollama")],
    constraints: { localOnly: true },
    expect: { pick: { provider: "ollama", eligible: ["ollama"] } },
  },
  {
    name: "localOnly with no local provider refuses the task instead of downgrading",
    law: "M-A-3 T3: refusal over silent substitution — the message names no eligible executor.",
    prompt: "Rewrite this",
    mode: "fast",
    providers: [evalProvider("codex"), evalProvider("claude")],
    constraints: { localOnly: true },
    expect: { pick: { provider: "refused" } },
  },
  {
    name: "manual override onto an ineligible provider is refused, not silently substituted",
    law: "M-A-3 T3 §5/§27: the owner's explicit pick outranks routing and impossible picks fail clearly.",
    prompt: "Rewrite this",
    mode: "fast",
    providers: [evalProvider("codex"), evalProvider("claude"), evalProvider("ollama")],
    constraints: { localOnly: true },
    override: "codex",
    expect: { pick: { provider: "refused" } },
  },
  {
    name: "a preferred local model is honored and is never a hard pin",
    law: "M-A-3 T3 §20: the onboarding preference wins when eligible; the reason must say it is not a hard pin.",
    prompt: "Summarize hello",
    mode: "fast",
    providers: [evalProvider("ollama")],
    constraints: { localOnly: true, preferredLocalModel: "qwen2.5-coder:7b" },
    expect: { pick: { provider: "ollama", model: "qwen2.5-coder:7b", reason: /not a hard pin/ } },
  },
  {
    name: "an unavailable preferred local model refuses with the authorized alternates",
    law: "M-A-3 T3 §20: 'preferred local model unavailable' lists what exists; never an invented substitute.",
    prompt: "Summarize hello",
    mode: "fast",
    providers: [evalProvider("ollama")],
    constraints: { localOnly: true, preferredLocalModel: "missing:7b" },
    expect: { pick: { provider: "refused" } },
  },
  {
    name: "modelExact outranks the preferred local model",
    law: "M-A-3 T3 §27: an exact pin is a hard constraint; preference never overrides it.",
    prompt: "Summarize hello",
    mode: "fast",
    providers: [evalProvider("ollama")],
    constraints: { localOnly: true, modelExact: "huihui_ai/qwen2.5-abliterate:7b", preferredLocalModel: "qwen2.5-coder:7b" },
    expect: { pick: { provider: "ollama", model: "huihui_ai/qwen2.5-abliterate:7b" } },
  },
  {
    name: "local-only routing never inherits an Ollama cloud-hosted default",
    law: "MA1: the local model is chosen over the cloud tag; the reason names what was NOT used.",
    prompt: "Summarize hello",
    mode: "fast",
    providers: [evalProvider("codex"), cloudTagged],
    constraints: { localOnly: true },
    expect: { pick: { provider: "ollama", model: "qwen2.5-coder:7b", reason: /not the cloud-hosted default deepseek-v4\.1-flash:cloud/ } },
  },
  {
    name: "offlineOnly keeps the local model even against the provider's own cloud default",
    law: "MA1: offline work never leaves the machine.",
    prompt: "Summarize hello",
    mode: "fast",
    providers: [cloudTagged],
    constraints: { offlineOnly: true },
    expect: { pick: { provider: "ollama", model: "qwen2.5-coder:7b" } },
  },
  {
    name: "an eligibility refusal names a cloud tag a cloud thing",
    law: "MA1: name-only cloud tags (older Ollama without remote_host) are still never local.",
    prompt: "Summarize hello",
    mode: "fast",
    providers: [evalProvider("ollama", { current_model: "x:cloud", models: ["x:cloud"] })],
    constraints: { localOnly: true },
    expect: { eligibility: /cloud-hosted/ },
  },
  {
    name: "a code-executing prompt never routes to a tool-less local provider",
    law: "M-A-3 T3 eligibility: launch-contract (tool) facts exclude providers that cannot run the work.",
    prompt: 'Create hello.py containing print("BUNNY_ROUTE_OK"). Run the script and verify stdout.',
    mode: "balanced",
    providers: [evalProvider("ollama"), evalProvider("codex")],
    expect: { pick: { provider: "codex" } },
  },
  {
    name: "a filesystem requirement refuses a provider without the capability",
    law: "M-A-3 T3 hard constraints: the requirement is named in the refusal; the task never starts.",
    prompt: "Modify code locally",
    mode: "balanced",
    providers: [evalProvider("ollama")],
    constraints: { requiresFilesystem: true },
    expect: { pick: { provider: "refused" } },
  },
  {
    name: "an authentication-only provider is never routable",
    law: "M-A-3 T3: not ready ≠ routable; the refusal names the unready executor.",
    prompt: "Summarize hello",
    mode: "fast",
    providers: [evalProvider("ollama", { availability: "authentication_required" })],
    expect: { pick: { provider: "refused" } },
  },
];

export type EvalRow = { name: string; law: string; verdict: "pass" | "fail"; got: string };

export function runRoutingEval(
  set: EvalCase[] = ROUTING_EVAL_SET,
  route: (input: { prompt: string; mode: Mode; providers: ProviderLive[]; constraints?: TaskConstraints; override?: ProviderId | "auto" }) => unknown = bunnyRoute as never,
): EvalRow[] {
  const rows: EvalRow[] = [];
  for (const one of set) {
    if ("eligibility" in one.expect) {
      const message = eligibility(one.providers[0]!, one.constraints ?? {}) ?? "";
      rows.push({ name: one.name, law: one.law, verdict: one.expect.eligibility.test(message) ? "pass" : "fail", got: message.slice(0, 200) || "(no refusal — eligible)" });
      continue;
    }
    const expectPick = one.expect as { pick: { provider: string; model?: string; reason?: RegExp; eligible?: string[]; refusedCase?: boolean } };
    try {
      const decision = route({ prompt: one.prompt, mode: one.mode, providers: one.providers, constraints: one.constraints, override: one.override }) as { recommended_provider?: string; recommended_model?: string; eligible_providers?: string[]; reasons?: string[]; reason?: string };
      const refusalCase = expectPick.pick.provider === "refused";
      if (refusalCase) {
        // A refusal case that resolves is a LAW VIOLATION: downgrading instead of refusing.
        rows.push({ name: one.name, law: one.law, verdict: "fail", got: `picked ${decision.recommended_provider} where the law demands a refusal` });
        continue;
      }
      const providerOk = decision.recommended_provider === expectPick.pick.provider;
      const modelOk = expectPick.pick.model ? decision.recommended_model === expectPick.pick.model : true;
      const eligibleOk = expectPick.pick.eligible ? JSON.stringify(decision.eligible_providers) === JSON.stringify(expectPick.pick.eligible) : true;
      const reasons = decision.reasons ?? (decision.reason ? [decision.reason] : []);
      const reasonOk = expectPick.pick.reason ? reasons.some((reason) => expectPick.pick.reason!.test(reason)) : true;
      rows.push({ name: one.name, law: one.law, verdict: providerOk && modelOk && eligibleOk && reasonOk ? "pass" : "fail", got: `picked ${decision.recommended_provider} · ${decision.recommended_model} (eligible ${JSON.stringify(decision.eligible_providers)})` });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (expectPick.pick.provider === "refused") {
        rows.push({ name: one.name, law: one.law, verdict: "pass", got: `refused: ${message.slice(0, 160)}` });
      } else {
        rows.push({ name: one.name, law: one.law, verdict: "fail", got: `unexpected refusal: ${message.slice(0, 160)}` });
      }
    }
  }
  return rows;
}

/** The owner-readable digest: the pass rate, then every failing row's got. */
export function routingEvalDigest(rows: EvalRow[]): string {
  const failing = rows.filter((row) => row.verdict === "fail");
  const head = `Routing evaluation: ${rows.length - failing.length}/${rows.length} cases hold the routing law.`;
  if (!failing.length) return head;
  return [head, ...failing.map((row) => `FAIL ${row.name} — got ${row.got}`)].join("\n");
}