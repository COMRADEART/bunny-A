import { CONNECTION_CATALOG, type BillingProvenance, type CatalogId, type ConnectionView, type SessionState, type SupportLevel, type Vendor } from "./connections.ts";
import type { ProviderLive } from "../orch/types.ts";

/**
 * M-A-3 T13.3 Gate E — Harness Manager (pure, browser-safe).
 *
 * A harness is the client program a model runs through (Codex CLI, Claude Code, Ollama, …). It is not a model, not a
 * subscription, and being installed or signed in authorizes nothing: every Task still passes the T13.2 dispatch gate
 * with the owner's account consent. This module only describes harnesses, judges capability tests and gives install
 * guidance. Bunny never runs an installer; the owner runs the pinned command and Bunny re-tests afterwards.
 */

export const HARNESS_SCHEMA = "bunny-a.harnesses.v1";

export const HARNESS_IDS = CONNECTION_CATALOG.filter((entry) => entry.executables.length).map((entry) => entry.id);
export type HarnessId = CatalogId;

/** The client programs that are the harness. `gh` is GitHub's identity CLI, not the Copilot harness. */
export const harnessExecutables = (id: HarnessId) =>
  id === "copilot" ? ["copilot"] : CONNECTION_CATALOG.find((entry) => entry.id === id)?.executables ?? [];

export type GuidedInstall = {
  kind: "npm" | "winget" | "script" | "link";
  version: string | null;
  install: string | null;
  uninstall: string | null;
  integrity: string | null;
  source: string;
  note: string;
};

const npm = (pkg: string, version: string, integrity: string, source: string): GuidedInstall => ({
  kind: "npm",
  version,
  install: `npm install -g ${pkg}@${version}`,
  uninstall: `npm uninstall -g ${pkg}`,
  integrity,
  source,
  note: "npm checks the downloaded package against this registry integrity hash. Run it yourself in a terminal; Bunny never runs installers.",
});

/** Pinned from the npm registry and the winget manifest on 2026-10-13. */
export const GUIDED_INSTALL: Record<HarnessId, GuidedInstall> = {
  openai: npm("@openai/codex", "0.162.1", "sha512-NWZdi/kxyjv/8EUGFupziGU38YyleugZRM4JXgY5XFH7FUmaFA33NZS2Bmq0HPazf7S3jJQQWsZ/jAK9jsrV3Q==", "https://www.npmjs.com/package/@openai/codex"),
  anthropic: npm("@anthropic-ai/claude-code", "2.1.299", "sha512-7pI5Pi+q0GHtX429SHGT0+IZgQ/2VlgcwRAHeDcH0vsumkF3tCHFp2vzKxp0uh8aytskZWHhmJ3kBi7ZfabywQ==", "https://www.npmjs.com/package/@anthropic-ai/claude-code"),
  cline: npm("cline", "3.0.71", "sha512-THSCuQrVPi5w48tyXaZrdUr4EnPQMMgsQN0moYxODl0LJveOeRytMyHx+WfzCY5NdPi1TzjDozFGn0uNVbK/fg==", "https://docs.cline.bot/cline-cli/installation"),
  opencode: npm("opencode-ai", "1.19.0", "sha512-lddJhFwZI3GLlw8VyOo4yNwBVGeVN/mxH6ORh60h69zAXL7QhjSWY9orj10rwO2kxVnxH9dh45uDCWNuiqPb8A==", "https://opencode.ai/docs/"),
  gemini: npm("@google/gemini-cli", "0.64.0", "sha512-FHrZ1NPf9QszyVMaa/BP3SsPy40ogBLnbZNWkv/PMi1Uz2zoDNMLGiBzBGmx4Bl7iLRq01K9PY/5kmloXFTpsA==", "https://www.npmjs.com/package/@google/gemini-cli"),
  copilot: npm("@github/copilot", "1.0.97", "sha512-Uh1li820BxT6yS8/bDCf7KC6Rn9jb/J1rWs2z9JpdfIyGHEWeyUS0rA6/tEV7FDc/5AOWS64dYJe8QF+w/mWqg==", "https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli"),
  ollama: {
    kind: "winget",
    version: "0.40.3",
    install: "winget install --id Ollama.Ollama --exact --version 0.40.3",
    uninstall: "winget uninstall --id Ollama.Ollama --exact",
    integrity: "sha256:ab81db6c6f4f65547242d1b2912e854da660ab3bc1dbd5ae3483831cf7668c80",
    source: "https://ollama.com/download",
    note: "winget checks the installer against this SHA-256 from its manifest before running it. Run it yourself; Bunny never runs installers.",
  },
  cursor: {
    kind: "script",
    version: null,
    install: null,
    uninstall: null,
    integrity: null,
    source: "https://cursor.com/docs/cli/installation",
    note: "Cursor publishes only an install script, with no pinned version or hash. Read the script on Cursor's page before running it.",
  },
  xai: {
    kind: "link",
    version: null,
    install: null,
    uninstall: null,
    integrity: null,
    source: "https://docs.x.ai/build/overview",
    note: "xAI publishes no command-line package Bunny can pin. Follow xAI's own documentation.",
  },
  openrouter: { kind: "link", version: null, install: null, uninstall: null, integrity: null, source: "https://openrouter.ai/docs", note: "OpenRouter is an API, not a harness." },
};

/** The result of running the harness's own `--version`, never a model call. */
export type HarnessProbe = { path: string | null; version: string | null; runs: boolean | null; detail: string };

export type HarnessVerdict = "not_found" | "found_not_running" | "runs_not_signed_in" | "runs" | "task_completed";

export type HarnessTest = {
  harness: HarnessId;
  at: number;
  path: string | null;
  version: string | null;
  runs: boolean | null;
  signedIn: boolean | null;
  completedTasks: number;
  verdict: HarnessVerdict;
  detail: string;
};

/**
 * Stepped capability test: found → runs (reports a version) → signed in → a real routed Task completed. Presence of a
 * binary is never evidence of inference; only a Task the Host recorded as completed through this harness is.
 */
export function judgeHarness(probe: HarnessProbe, signedIn: boolean | null, completedTasks: number): { verdict: HarnessVerdict; detail: string } {
  if (!probe.path) return { verdict: "not_found", detail: probe.detail };
  if (!probe.runs) return { verdict: "found_not_running", detail: `Found at ${probe.path}, but it did not run: ${probe.detail}` };
  if (signedIn === false) return { verdict: "runs_not_signed_in", detail: `Runs (${probe.version ?? "no version"}), but it is not signed in.` };
  if (completedTasks > 0)
    return { verdict: "task_completed", detail: `Runs (${probe.version ?? "no version"}); ${completedTasks} Task${completedTasks === 1 ? "" : "s"} routed through it completed on this Host.` };
  return { verdict: "runs", detail: `Runs (${probe.version ?? "no version"}). No Task has completed through it yet, so model inference is not demonstrated.` };
}

export type HarnessRoute = {
  connectionId: string;
  label: string;
  vendor: Vendor;
  billing: BillingProvenance;
  support: SupportLevel;
  dispatch: boolean;
  status: ConnectionView["status"];
  session: SessionState;
  lifecycle: ConnectionView["lifecycle"];
};

export type HarnessView = {
  id: HarnessId;
  name: string;
  executables: readonly string[];
  platform: string;
  found: boolean;
  path: string | null;
  version: string | null;
  signature: NonNullable<ConnectionView["toolInfo"]>["signature"] | null;
  models: string[];
  routes: HarnessRoute[];
  execution: "routable" | "disabled" | "detect_only" | "unsupported";
  authentication: SessionState;
  billingNote: string;
  completedTasks: number;
  lastTest: HarnessTest | null;
  install: GuidedInstall;
  manageUrl: string;
  warnings: string[];
};

export function harnessViews(input: {
  accounts: readonly ConnectionView[];
  providers: readonly ProviderLive[];
  tests: readonly HarnessTest[];
  completed: Readonly<Record<string, number>>;
  platform: string;
}): HarnessView[] {
  return CONNECTION_CATALOG.filter((entry) => entry.executables.length).map((entry) => {
    const rows = input.accounts.filter((row) => row.catalog === entry.id);
    const live = entry.providerId ? input.providers.find((provider) => provider.id === entry.providerId) ?? null : null;
    const test = input.tests.find((row) => row.harness === entry.id) ?? null;
    const tool = rows.find((row) => row.toolInfo)?.toolInfo ?? null;
    const routes: HarnessRoute[] = rows.map((row) => ({
      connectionId: row.id,
      label: entry.modes.find((mode) => mode.mode === row.mode)?.label ?? row.mode,
      vendor: row.vendor,
      billing: row.billing,
      support: row.support,
      dispatch: row.dispatch,
      status: row.status,
      session: row.session,
      lifecycle: row.lifecycle,
    }));
    const dispatchable = routes.filter((route) => route.dispatch && route.support === "implemented");
    const execution: HarnessView["execution"] = dispatchable.length
      ? dispatchable.some((route) => route.lifecycle === "active") ? "routable" : "disabled"
      : routes.some((route) => route.support === "detect_only") ? "detect_only" : "unsupported";
    const path = test?.path ?? live?.executable ?? tool?.path ?? null;
    const version = test?.version ?? live?.version ?? tool?.version ?? null;
    const install = GUIDED_INSTALL[entry.id];
    const signature = tool?.signature ?? null;
    const warnings = [
      ...(signature === "invalid" ? ["Its digital signature is invalid. Reinstall it from the official source before using it."] : []),
      ...(signature === "unsigned-shim" ? ["It runs through an npm script shim, so Windows cannot check a publisher signature; the package's registry integrity is the check."] : []),
      ...(execution === "detect_only" ? ["Bunny can detect this harness but does not send Tasks through it in this release."] : []),
      ...(execution === "unsupported" ? ["Bunny does not support Tasks through this harness."] : []),
      ...(execution === "disabled" ? ["You disabled this harness; Tasks are refused until you enable it."] : []),
      ...(install.kind === "script" ? ["Its official installer is an unpinned script. Read it before running it."] : []),
      ...(path && version && install.version && !version.includes(install.version) ? [`The installed version differs from the pinned ${install.version}.`] : []),
      ...(test?.verdict === "found_not_running" ? ["The last test found it but it did not run."] : []),
    ];
    return {
      id: entry.id,
      name: entry.name,
      executables: harnessExecutables(entry.id),
      platform: input.platform,
      found: !!path,
      path,
      version,
      signature,
      models: live ? [...new Set([...(live.current_model ? [live.current_model] : []), ...(live.models ?? [])])].slice(0, 12) : [],
      routes,
      execution,
      authentication: (dispatchable[0] ?? routes[0])?.session ?? "unknown",
      billingNote: entry.termsNote,
      completedTasks: rows.reduce((sum, row) => sum + (input.completed[row.id] ?? 0), 0),
      lastTest: test,
      install,
      manageUrl: entry.manageUrl,
      warnings,
    };
  });
}
