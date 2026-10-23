/**
 * M-A-3 T13.2 Unified AI Account & Subscription Bridge: the pure, shared contract.
 *
 * BunnyRouter stays the only router. This module only describes provider connections (identity, native client,
 * delegated plan, API key, local runtime, view-only), decides whether ONE exact dispatch is allowed, and names the
 * child-environment variables that could silently change who is billed. It never holds or sees a credential value:
 * application state carries `credential: {present, updatedAt, protection}` only, and the opaque handle lives inside
 * the Host-owned registry (connections.server.ts).
 *
 * Pure: no node: imports, no I/O. The UI view model and the voice/chat intent parser may import values from here.
 * Provider facts below were read from official documentation on 2026-10-13 (sources on each catalog mode).
 */
import type { ProviderId } from "../orch/types.ts";

// ------------------------------------------------------------------ vocabulary ----

/** How a connection reaches a provider. A sign-in alone never implies inference rights. */
export type ConnectionMode =
  | "identity" // who signed in; no inference entitlement
  | "native_cli" // provider-authorized use through its own first-party client/CLI, signed in by the user there
  | "delegated_plan" // the user granted THIS application plan usage through a vendor-supported flow
  | "api_key" // independently metered/billed API access
  | "local_runtime" // on-device models; no account
  | "view_only"; // status and deep links only, never dispatch

/** Catalog entries (a provider family). Several may map onto one router ProviderId. */
export type CatalogId =
  | "openai"
  | "anthropic"
  | "cursor"
  | "cline"
  | "xai"
  | "ollama"
  | "opencode"
  | "gemini"
  | "copilot"
  | "openrouter";

/** The third party that receives Task data. "local" never leaves this PC. */
export type Vendor =
  | "openai"
  | "anthropic"
  | "cursor"
  | "cline"
  | "xai"
  | "ollama_cloud"
  | "opencode"
  | "google"
  | "github"
  | "openrouter"
  | "local";

/** Display status (one per mode card). The four underlying dimensions stay separate on the view. */
export type ConnectionStatus =
  | "not_connected"
  | "sign_in_required"
  | "connecting"
  | "connected"
  | "reconnect_required"
  | "unsupported"
  | "not_entitled"
  | "rate_limited"
  | "budget_blocked"
  | "offline"
  | "paused";

/** Who the provider says is signed in (or that it could not say). */
export type SessionState =
  "signed_in" | "signed_out" | "expired" | "account_switched" | "unknown" | "not_required";
/** What the plan/key is demonstrably good for. Never inferred from a sign-in, email, logo or model catalogue. */
export type EntitlementState =
  | "verified"
  | "plan_reported"
  | "unknown"
  | "not_entitled"
  | "exhausted"
  | "rate_limited"
  | "billing_problem"
  | "not_applicable";
/** The local client/runtime the mode depends on. */
export type ToolState =
  "ready" | "missing" | "version_changed" | "offline" | "unknown" | "not_applicable";

/** Who pays for a Task sent through this mode. "free" is never claimed without a verified entitlement. */
export type BillingProvenance =
  "plan_included" | "api_billed" | "metered_credits" | "local_device" | "unknown" | "no_execution";

export type SupportLevel =
  /** Bunny implements this mode end to end (connect, status, and dispatch when `dispatch` is true). */
  | "implemented"
  /** Bunny can detect/initiate the provider's own flow and show status, but does not send Tasks through it. */
  | "detect_only"
  /** Not offered: no official embeddable surface, or it needs a registration/approval Bunny does not hold. */
  | "unsupported";

export type SignInKind =
  | { kind: "native_cli"; args: readonly string[]; hintFlag?: string }
  | { kind: "oauth_pkce"; authorizeUrl: string; exchangeUrl: string; validateUrl: string }
  | {
      kind: "api_key";
      validateUrl: string | null;
      header: "bearer" | "x-api-key" | "x-goog-api-key";
    }
  | { kind: "none" };

export type CatalogMode = {
  mode: ConnectionMode;
  support: SupportLevel;
  /** True only when BunnyRouter may send Tasks through this mode in this release. */
  dispatch: boolean;
  billing: BillingProvenance;
  vendor: Vendor;
  label: string;
  detail: string;
  /** Why a mode is unsupported or detect-only. */
  reason?: string;
  signIn: SignInKind;
  /** Native read-only status argv (after the executable). Never login/logout, never a browser, never a secret file. */
  statusArgs?: readonly string[];
  sources: readonly string[];
};

export type CatalogEntry = {
  id: CatalogId;
  name: string;
  /** The BunnyRouter provider this family executes through, when it has an execution adapter. */
  providerId: ProviderId | null;
  /** Exact executable names to detect. A bare generic name (e.g. "agent") is never used. */
  executables: readonly string[];
  manageUrl: string;
  /** Official install page. Bunny never downloads or runs an installer; it only links here. */
  installUrl: string | null;
  termsNote: string;
  /** Configurations Bunny recognises but deliberately does not use (shown as non-interactive rows). */
  notes?: readonly string[];
  modes: readonly CatalogMode[];
};

const CHECKED = "2026-10-13";
const src = (url: string) => `${url} (read ${CHECKED})`;

/**
 * Manifest-driven catalogue. Adding a provider is a data change; a mode only becomes dispatchable when an execution
 * adapter exists AND its entry says `dispatch: true`. Unknown plugins are never installed.
 */
export const CONNECTION_CATALOG: readonly CatalogEntry[] = [
  {
    id: "openai",
    name: "ChatGPT / Codex",
    providerId: "codex",
    executables: ["codex"],
    manageUrl: "https://chatgpt.com/#settings",
    installUrl: "https://learn.chatgpt.com/docs/auth",
    notes: [
      'Bunny pins Codex to its built-in OpenAI provider (model_provider="openai"); custom model providers in config.toml are not used.',
      "A custom CODEX_HOME is ignored; Bunny uses the default Codex sign-in of this Windows account.",
      "Codex credits beyond the plan's included usage are not used: a plan reported as exhausted blocks new Tasks.",
    ],
    termsNote:
      "Codex signed in with ChatGPT uses your plan's included usage; an OpenAI API key is billed separately at API rates. Bunny never reads Codex's auth file.",
    modes: [
      {
        mode: "native_cli",
        support: "implemented",
        dispatch: true,
        billing: "plan_included",
        vendor: "openai",
        label: "ChatGPT plan through Codex CLI",
        detail:
          "You sign in inside Codex (codex login). Bunny runs your installed Codex and checks which sign-in it uses before every Task.",
        signIn: { kind: "native_cli", args: ["login"] },
        statusArgs: ["login", "status"],
        sources: [
          src("https://learn.chatgpt.com/docs/auth"),
          src("https://learn.chatgpt.com/docs/non-interactive-mode"),
          src("https://learn.chatgpt.com/docs/app-server"),
        ],
      },
      {
        mode: "api_key",
        support: "detect_only",
        dispatch: false,
        billing: "api_billed",
        vendor: "openai",
        label: "OpenAI API key",
        detail: "Billed by OpenAI Platform at standard API rates, separate from any ChatGPT plan.",
        reason:
          "Bunny stores and validates the key, but does not yet send Tasks through it: Codex shell tools inherit the process environment, so a key in the child could be read by the model.",
        signIn: {
          kind: "api_key",
          validateUrl: "https://api.openai.com/v1/models",
          header: "bearer",
        },
        sources: [
          src("https://learn.chatgpt.com/docs/auth"),
          src("https://learn.chatgpt.com/docs/pricing"),
        ],
      },
      {
        mode: "delegated_plan",
        support: "unsupported",
        dispatch: false,
        billing: "plan_included",
        vendor: "openai",
        label: "Sign in with ChatGPT plan sharing",
        detail:
          "OpenAI lets eligible open-source, locally hosted apps use a ChatGPT plan through a user-approved grant.",
        reason:
          "Bunny is a private, unlicensed app; OpenAI documents this flow for open-source apps and sends others to an interest form. Not offered until OpenAI confirms eligibility.",
        signIn: { kind: "none" },
        sources: [
          src("https://developers.openai.com/siwc/token-sharing-open-source"),
          src("https://developers.openai.com/siwc/token-sharing-open-source/sign-in"),
        ],
      },
      {
        mode: "identity",
        support: "unsupported",
        dispatch: false,
        billing: "no_execution",
        vendor: "openai",
        label: "Sign in with ChatGPT (identity)",
        detail: "Identity-only sign-in grants no ChatGPT or API access.",
        reason:
          "Offered by OpenAI only to selected commercial partners with a pre-issued client ID.",
        signIn: { kind: "none" },
        sources: [
          src("https://developers.openai.com/siwc/quickstart"),
          src("https://developers.openai.com/siwc/request-client-id"),
        ],
      },
    ],
  },
  {
    id: "anthropic",
    name: "Claude / Claude Code",
    providerId: "claude",
    executables: ["claude"],
    manageUrl: "https://claude.ai/settings/usage",
    installUrl: "https://code.claude.com/docs/en/setup",
    notes: [
      "Claude Code configured for Amazon Bedrock, Google Vertex or Microsoft Foundry (CLAUDE_CODE_USE_*) bills that cloud account; Bunny removes those variables and does not use that route.",
      'Claude "extra usage" (paid overage after the plan limit) is never used by Bunny: a session that reports overage is stopped.',
      "A custom CLAUDE_CONFIG_DIR is ignored; Bunny uses the default Claude Code sign-in of this Windows account.",
    ],
    termsNote:
      "Claude Pro/Max usage is for the unmodified Claude Code on your own account. Bunny never reads Claude's credentials or offers Claude sign-in itself; an Anthropic API key is the route Anthropic prefers for third-party software and is billed separately.",
    modes: [
      {
        mode: "native_cli",
        support: "implemented",
        dispatch: true,
        billing: "plan_included",
        vendor: "anthropic",
        label: "Claude subscription through Claude Code",
        detail:
          "You sign in inside Claude Code (claude auth login). Bunny runs your installed Claude Code with every API-key variable removed and refuses the Task if it would bill an API key.",
        signIn: { kind: "native_cli", args: ["auth", "login"], hintFlag: "--email" },
        statusArgs: ["auth", "status"],
        sources: [
          src("https://code.claude.com/docs/en/authentication"),
          src("https://code.claude.com/docs/en/legal-and-compliance"),
          src(
            "https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan",
          ),
        ],
      },
      {
        mode: "api_key",
        support: "detect_only",
        dispatch: false,
        billing: "api_billed",
        vendor: "anthropic",
        reason:
          "Encrypted key storage and metadata checks only. Task dispatch is unavailable until credential isolation from native tools and hooks is independently verified.",
        label: "Anthropic API key (Claude Console)",
        detail:
          "Billed by Anthropic at API rates to the key's Console account. Off until you opt in to paid use; Tasks run without shell tools so the model cannot read the key.",
        signIn: {
          kind: "api_key",
          validateUrl: "https://api.anthropic.com/v1/models",
          header: "x-api-key",
        },
        sources: [
          src(
            "https://support.claude.com/en/articles/12304248-manage-api-key-environment-variables-in-claude-code",
          ),
          src("https://code.claude.com/docs/en/env-vars"),
        ],
      },
      {
        mode: "delegated_plan",
        support: "unsupported",
        dispatch: false,
        billing: "plan_included",
        vendor: "anthropic",
        label: "Claude sign-in inside Bunny",
        detail: "Using a Claude subscription from another app.",
        reason:
          "Anthropic does not permit third-party apps to offer Claude.ai login, route plan credentials, or store Claude session tokens.",
        signIn: { kind: "none" },
        sources: [
          src("https://code.claude.com/docs/en/legal-and-compliance"),
          src("https://support.claude.com/en/articles/13189465-log-in-to-your-claude-account"),
        ],
      },
    ],
  },
  {
    id: "cursor",
    name: "Cursor",
    providerId: "cursor",
    executables: ["cursor-agent"],
    manageUrl: "https://cursor.com/dashboard",
    installUrl: "https://cursor.com/docs/cli/installation",
    termsNote:
      'Cursor CLI sign-in and Cursor user API keys both bill the same Cursor account and plan. Bunny never resolves Cursor by the generic name "agent".',
    modes: [
      {
        mode: "native_cli",
        support: "detect_only",
        dispatch: false,
        billing: "plan_included",
        vendor: "cursor",
        label: "Cursor plan through Cursor CLI",
        detail: "You sign in inside Cursor CLI (cursor-agent login). Bunny shows its status.",
        reason:
          "Cursor CLI's headless mode is documented, but Bunny has no certified Cursor execution adapter yet; use Open in Cursor.",
        signIn: { kind: "native_cli", args: ["login"] },
        statusArgs: ["status"],
        sources: [
          src("https://cursor.com/docs/cli/reference/authentication"),
          src("https://cursor.com/docs/cli/headless"),
        ],
      },
    ],
  },
  {
    id: "cline",
    name: "Cline / ClinePass",
    providerId: "cline",
    executables: ["cline"],
    manageUrl: "https://app.cline.bot/dashboard",
    installUrl: "https://docs.cline.bot/cline-cli/installation",
    termsNote:
      "ClinePass is a Cline subscription for Cline's interfaces and the Cline API; it is not a general-purpose API for other providers. BYOK and local Ollama stay separate options.",
    modes: [
      {
        mode: "native_cli",
        support: "detect_only",
        dispatch: false,
        billing: "plan_included",
        vendor: "cline",
        label: "Cline account / ClinePass in Cline",
        detail: "You sign in inside Cline (cline auth) and choose ClinePass there.",
        reason:
          "Cline CLI auto-approves tools by default and has no documented status command; Bunny does not dispatch through it. Use Cline directly.",
        signIn: { kind: "native_cli", args: ["auth"] },
        sources: [
          src(
            "https://github.com/cline/cline/blob/main/docs/getting-started/authorizing-with-cline.mdx",
          ),
          src("https://github.com/cline/cline/blob/main/docs/getting-started/clinepass.mdx"),
          src("https://docs.cline.bot/cli/cli-reference"),
        ],
      },
      {
        mode: "delegated_plan",
        support: "unsupported",
        dispatch: false,
        billing: "plan_included",
        vendor: "cline",
        label: "ClinePass through the Cline API",
        detail:
          "Cline documents ClinePass models for your own scripts through its OpenAI-compatible API.",
        reason:
          "Bunny has no OpenAI-compatible chat adapter in this release, and the Cline API's key-check endpoint is undocumented.",
        signIn: { kind: "none" },
        sources: [
          src("https://github.com/cline/cline/blob/main/docs/getting-started/clinepass.mdx"),
          src("https://docs.cline.bot/api/overview"),
        ],
      },
    ],
  },
  {
    id: "xai",
    name: "Grok / xAI",
    providerId: null,
    executables: ["grok"],
    manageUrl: "https://console.x.ai",
    installUrl: "https://docs.x.ai/build/overview",
    termsNote:
      "A Grok or X subscription and the xAI API share an account but are billed separately; a subscription does not include api.x.ai access.",
    modes: [
      {
        mode: "native_cli",
        support: "detect_only",
        dispatch: false,
        billing: "plan_included",
        vendor: "xai",
        label: "Grok subscription through Grok Build",
        detail: "You sign in inside Grok Build (grok login).",
        reason:
          "Grok Build has no documented status command and Bunny has no Grok execution adapter; sign-in state stays unknown.",
        signIn: { kind: "native_cli", args: ["login"] },
        sources: [
          src("https://docs.x.ai/build/cli/reference"),
          src("https://docs.x.ai/build/cli/headless-scripting"),
        ],
      },
      {
        mode: "api_key",
        support: "detect_only",
        dispatch: false,
        billing: "api_billed",
        vendor: "xai",
        label: "xAI API key",
        detail:
          "Billed in the xAI Console, separate from Grok subscriptions. Bunny can store the key and check it without inference.",
        reason:
          "Bunny has no xAI chat adapter in this release, so the key cannot be used for Tasks yet.",
        signIn: { kind: "api_key", validateUrl: "https://api.x.ai/v1/api-key", header: "bearer" },
        sources: [
          src("https://docs.x.ai/developers/faq/accounts"),
          src("https://docs.x.ai/developers/rest-api-reference/inference/other"),
        ],
      },
    ],
  },
  {
    id: "ollama",
    name: "Ollama",
    providerId: "ollama",
    executables: ["ollama"],
    manageUrl: "https://ollama.com/settings",
    installUrl: "https://ollama.com/download",
    termsNote:
      'Local Ollama models run on this PC with no account. Cloud models (":cloud" tags) send prompts to ollama.com and use your Ollama account\'s usage credits.',
    modes: [
      {
        mode: "local_runtime",
        support: "implemented",
        dispatch: true,
        billing: "local_device",
        vendor: "local",
        label: "Local models on this PC",
        detail: "No sign-in. Data stays on this PC.",
        signIn: { kind: "none" },
        sources: [src("https://docs.ollama.com/faq"), src("https://docs.ollama.com/api/tags")],
      },
      {
        mode: "native_cli",
        support: "detect_only",
        dispatch: false,
        billing: "metered_credits",
        vendor: "ollama_cloud",
        reason:
          "Cloud tags are detected, but the daemon does not expose a verified account or enforceable per-Task spending ceiling. Use Ollama's own cloud workflow.",
        label: "Ollama cloud models (your Ollama account)",
        detail:
          "Signed in inside Ollama (ollama signin). Prompts leave this PC and use usage credits. Off until you allow it.",
        signIn: { kind: "native_cli", args: ["signin"] },
        sources: [src("https://docs.ollama.com/cloud"), src("https://ollama.com/pricing")],
      },
    ],
  },
  {
    id: "opencode",
    name: "OpenCode",
    providerId: "opencode",
    executables: ["opencode"],
    manageUrl: "https://opencode.ai/docs/providers/",
    installUrl: "https://opencode.ai/docs/",
    notes: [
      "Providers listed inside OpenCode are shown for information only; their keys stay in OpenCode and Bunny never reads them. An Anthropic subscription (OAuth) entry inside OpenCode is flagged as prohibited by Anthropic.",
    ],
    termsNote:
      "OpenCode bills through whichever provider you connected inside it. Bunny never routes a Claude subscription through OpenCode, which Anthropic prohibits.",
    modes: [
      {
        mode: "native_cli",
        support: "detect_only",
        dispatch: false,
        billing: "unknown",
        vendor: "opencode",
        label: "Providers connected inside OpenCode",
        detail: "Bunny lists which providers OpenCode has credentials for (names and types only).",
        reason:
          "OpenCode's headless run is documented, but Bunny has no certified OpenCode execution adapter and billing depends on the inner provider.",
        signIn: { kind: "native_cli", args: ["auth", "login"] },
        statusArgs: ["auth", "list"],
        sources: [src("https://opencode.ai/docs/cli/"), src("https://opencode.ai/docs/providers/")],
      },
    ],
  },
  {
    id: "gemini",
    name: "Google Gemini",
    providerId: null,
    executables: ["gemini", "agy"],
    manageUrl: "https://aistudio.google.com/apikey",
    installUrl: "https://antigravity.google/docs/cli/install",
    termsNote:
      "Gemini CLI was replaced by Antigravity CLI for unpaid and Google One accounts on 2026-06-18. A Gemini API key is billed per token once billing is enabled.",
    modes: [
      {
        mode: "native_cli",
        support: "detect_only",
        dispatch: false,
        billing: "unknown",
        vendor: "google",
        label: "Google account through Gemini / Antigravity CLI",
        detail: "Sign-in happens inside the Gemini or Antigravity CLI.",
        reason:
          "Neither CLI has a machine-readable status command, and Bunny has no Gemini execution adapter.",
        signIn: { kind: "native_cli", args: [] },
        sources: [
          src("https://geminicli.com/docs/get-started/authentication/"),
          src("https://antigravity.google/docs/cli/install"),
        ],
      },
      {
        mode: "api_key",
        support: "detect_only",
        dispatch: false,
        billing: "api_billed",
        vendor: "google",
        label: "Gemini API key",
        detail: "Bunny can store the key and check it by listing models (no inference).",
        reason: "Bunny has no Gemini chat adapter in this release.",
        signIn: {
          kind: "api_key",
          validateUrl: "https://generativelanguage.googleapis.com/v1beta/models",
          header: "x-goog-api-key",
        },
        sources: [
          src("https://ai.google.dev/api/models"),
          src("https://geminicli.com/docs/resources/quota-and-pricing/"),
        ],
      },
    ],
  },
  {
    id: "copilot",
    name: "GitHub Copilot",
    providerId: null,
    executables: ["copilot", "gh"],
    manageUrl: "https://github.com/settings/copilot",
    installUrl: "https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli",
    termsNote:
      'Since 2026-06-01 every Copilot CLI prompt spends metered GitHub AI Credits. A GitHub sign-in is identity only and grants no Copilot model access by itself. Bunny never runs "gh copilot", which downloads software.',
    modes: [
      {
        mode: "identity",
        support: "detect_only",
        dispatch: false,
        billing: "no_execution",
        vendor: "github",
        label: "GitHub sign-in (gh)",
        detail: "Shows which GitHub account gh is signed in to. Identity only.",
        signIn: { kind: "native_cli", args: ["auth", "login"] },
        statusArgs: ["auth", "status"],
        sources: [src("https://cli.github.com/manual/gh_auth_status")],
      },
      {
        mode: "native_cli",
        support: "detect_only",
        dispatch: false,
        billing: "metered_credits",
        vendor: "github",
        label: "Copilot CLI",
        detail: "Requires an active Copilot subscription; each prompt uses AI Credits.",
        reason:
          "Bunny has no Copilot execution adapter, and Copilot has no documented seat-check endpoint.",
        signIn: { kind: "native_cli", args: [] },
        sources: [
          src("https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli"),
          src(
            "https://github.blog/changelog/2026/04/27/github-copilot-is-moving-to-usage-based-billing/",
          ),
        ],
      },
    ],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    providerId: "openrouter",
    executables: [],
    manageUrl: "https://openrouter.ai/settings/keys",
    installUrl: null,
    termsNote:
      "OpenRouter keys spend OpenRouter credits. With BYOK, OpenRouter falls back to paid shared capacity by default unless you turn that off on OpenRouter.",
    modes: [
      {
        mode: "api_key",
        support: "implemented",
        dispatch: true,
        billing: "api_billed",
        vendor: "openrouter",
        label: "OpenRouter API key",
        detail:
          "Create a key on OpenRouter, then enter it here. Bunny encrypts it and can check key metadata without inference. OpenRouter browser authorization is not implemented in this release.",
        reason:
          "Inference requires MA4 model/upstream approval, current catalogue facts, account consent and bounded budgets. Off by default.",
        signIn: {
          kind: "api_key",
          validateUrl: "https://openrouter.ai/api/v1/key",
          header: "bearer",
        },
        sources: [
          src("https://openrouter.ai/docs/guides/overview/auth/oauth"),
          src("https://openrouter.ai/docs/api/reference/limits"),
        ],
      },
    ],
  },
];

export function catalogEntry(id: CatalogId): CatalogEntry {
  const entry = CONNECTION_CATALOG.find((row) => row.id === id);
  if (!entry) throw new Error(`Unknown catalog id ${id}`);
  return entry;
}

export function catalogMode(id: CatalogId, mode: ConnectionMode): CatalogMode | null {
  return catalogEntry(id).modes.find((row) => row.mode === mode) ?? null;
}

/** Stable connection id. One native/local connection per family; API keys may hold several slots. */
export function connectionId(catalog: CatalogId, mode: ConnectionMode, slot = "default"): string {
  if (!/^[a-z0-9-]{1,32}$/.test(slot)) throw new Error("Invalid connection slot.");
  return `${catalog}:${mode}:${slot}`;
}

export function parseConnectionId(
  id: string,
): { catalog: CatalogId; mode: ConnectionMode; slot: string } | null {
  const match = /^([a-z]+):([a-z_]+):([a-z0-9-]{1,32})$/.exec(id);
  if (!match) return null;
  const catalog = match[1] as CatalogId;
  const mode = match[2] as ConnectionMode;
  if (
    !CONNECTION_CATALOG.some((row) => row.id === catalog && row.modes.some((m) => m.mode === mode))
  )
    return null;
  return { catalog, mode, slot: match[3] };
}

export function catalogForProvider(provider: ProviderId): CatalogEntry | null {
  return CONNECTION_CATALOG.find((row) => row.providerId === provider) ?? null;
}

// --------------------------------------------------------------- model locality ----

/** Ollama cloud tags and remote models leave the PC (the router's runsLocally rule, restated without I/O). */
export function isRemoteModelName(
  model: string | null | undefined,
  remoteModels: readonly string[] = [],
): boolean {
  if (!model) return false;
  return remoteModels.includes(model) || /(?::|-)cloud$/i.test(model);
}

/** The vendor that receives Task data for one exact (provider, model). */
export function vendorFor(
  provider: ProviderId,
  model: string | null | undefined,
  remoteModels: readonly string[] = [],
): Vendor {
  switch (provider) {
    case "openrouter":
      return "openrouter";
    case "codex":
      return "openai";
    case "claude":
      return "anthropic";
    case "ollama":
      return isRemoteModelName(model, remoteModels) ? "ollama_cloud" : "local";
    case "opencode":
      return "opencode";
    case "cline":
      return "cline";
    case "cursor":
      return "cursor";
  }
}

/** The connection mode family a dispatch of (provider, model) would need when no explicit selection exists. */
export function defaultModeFor(
  provider: ProviderId,
  model: string | null | undefined,
  remoteModels: readonly string[] = [],
): { catalog: CatalogId; mode: ConnectionMode } | null {
  const entry = catalogForProvider(provider);
  if (!entry) return null;
  if (provider === "openrouter") return { catalog: "openrouter", mode: "api_key" };
  if (provider === "ollama")
    return {
      catalog: "ollama",
      mode: isRemoteModelName(model, remoteModels) ? "native_cli" : "local_runtime",
    };
  return { catalog: entry.id, mode: "native_cli" };
}

// ------------------------------------------------------------- consent & policy ----

/** Per-connection consent. Host-owned; only the Windows owner changes it. Defaults never enable paid use. */
export type ConnectionConsent = {
  /** "Allow Bunny to send Tasks" through this connection. */
  allowTasks: boolean;
  /** Project scope: every project, or only these project ids (null project = direct chat without a project). */
  projects: "all" | readonly string[];
  /** Explicit opt-in to chargeable use (API key / metered credits). Never set by a default. */
  billingOptIn: boolean;
  /** Request ceiling per local day; 0 blocks. Null = no request ceiling (included-plan and local modes only). */
  maxRequestsPerDay: number | null;
  /** Monetary ceiling per local day in USD; null = none. Strict + unknown pricing fails closed. */
  maxUsdPerDay: number | null;
  /** Strict budget: unknown usage/price counts as over budget. */
  strictBudget: boolean;
  /** Incremented on every change; a Task bound to an older revision is re-checked against the current one. */
  revision: number;
  grantedAt: number | null;
  provenance: "default_included" | "default_local" | "default_off" | "owner";
};

export function defaultConsent(mode: CatalogMode): ConnectionConsent {
  const base = {
    projects: "all" as const,
    billingOptIn: false,
    maxUsdPerDay: null,
    strictBudget: true,
    revision: 1,
    grantedAt: null,
  };
  if (!mode.dispatch)
    return { ...base, allowTasks: false, maxRequestsPerDay: 0, provenance: "default_off" };
  if (mode.billing === "local_device")
    return { ...base, allowTasks: true, maxRequestsPerDay: null, provenance: "default_local" };
  // Included-plan native clients keep the pre-T13.2 behaviour: every Task still needs the owner's approval card.
  if (mode.billing === "plan_included" && mode.mode === "native_cli")
    return { ...base, allowTasks: true, maxRequestsPerDay: null, provenance: "default_included" };
  // API keys and metered credits are always off until the owner opts in.
  return { ...base, allowTasks: false, maxRequestsPerDay: 0, provenance: "default_off" };
}

/** Routing & Privacy policy (settings row connections_policy_v1). */
export type RoutingPrivacyPolicy = {
  version: 1;
  /** Vendors a Task may be MOVED TO from another vendor without a new owner review (advice, reroute, fallback). Default none. */
  switchAllowlist: readonly Vendor[];
  /** On failure/outage: stay on the same vendor or local, otherwise stop and ask. */
  failover: "same_vendor_or_local" | "ask";
  /** Per-router-provider selected connection id; dispatch never picks another mode on its own. */
  selected: Partial<Record<ProviderId, string>>;
  /** Detail rows for usage accounting older than this are rolled up into daily totals and pruned. */
  retentionDays: number;
  revision: number;
};

export const DEFAULT_ROUTING_POLICY: RoutingPrivacyPolicy = {
  version: 1,
  switchAllowlist: [],
  failover: "same_vendor_or_local",
  selected: {},
  retentionDays: 30,
  revision: 1,
};

export const RETENTION_DAYS_MIN = 7;
export const RETENTION_DAYS_MAX = 365;

/** What a Task's approval bound it to. Persisted on the Task (no secret, no handle). */
export type ApprovedRoute = {
  /** Exact destination accounts included in the proposal. Vendor consent alone never changes account identity. */
  destinationBindings?: readonly {
    connectionId: string;
    mode: ConnectionMode;
    accountFingerprint: string | null;
    connectionEpoch: number;
    consentRevision: number;
  }[];
  provider: ProviderId;
  vendor: Vendor;
  connectionId: string;
  mode: ConnectionMode;
  /** Salted hash of the provider-reported principal at approval time; null when the mode has no account. */
  accountFingerprint: string | null;
  /** Bumped by Disconnect/Reconnect; an older epoch never dispatches. */
  connectionEpoch: number;
  consentRevision: number;
  /** Vendors this Task may run on without a new review: the approved one, plus a Mission's explicit allow list. */
  consentedVendors: readonly Vendor[];
  approvedAt: number;
  approvedBy: "workstation" | "device" | "voice" | "mission";
};

// ------------------------------------------------------------ connection views ----

/** One mode of one provider family as the Host currently knows it. Secret-free. */
export type ConnectionView = {
  id: string;
  catalog: CatalogId;
  mode: ConnectionMode;
  vendor: Vendor;
  support: SupportLevel;
  dispatch: boolean;
  billing: BillingProvenance;
  status: ConnectionStatus;
  session: SessionState;
  entitlement: EntitlementState;
  tool: ToolState;
  /** Bunny-side lifecycle: paused/disconnected are owner choices that only an owner action reverses. */
  lifecycle: "active" | "paused" | "disconnected";
  epoch: number;
  accountFingerprint: string | null;
  /** Masked principal for the workstation only (e.g. "al***@gmail.com"); never sent to a phone or an Agent. */
  maskedIdentity: string | null;
  maskedWorkspace: string | null;
  plan: { label: string | null; source: "provider_reported" | "unknown" };
  consent: ConnectionConsent;
  credential: { present: boolean; updatedAt: number | null; protection: string | null } | null;
  /** Provider-reported auth method facts (e.g. Claude "claude.ai", Codex "chatgpt"); no secrets. */
  authMethod: string | null;
  lastCheckedAt: number | null;
  authVerifiedAt: number | null;
  entitlementVerifiedAt: number | null;
  /** First-line, secret-free reason for the current status. */
  detail: string;
  /** Installed client/runtime facts (workstation only). Signature: Authenticode status for .exe, "unsigned-shim" for npm/cmd shims. */
  toolInfo: {
    version: string | null;
    path: string | null;
    signature: "valid" | "invalid" | "unsigned-shim" | "unknown" | "not_applicable";
  } | null;
  /** Capabilities the Host demonstrated (never a catalogue claim). */
  capabilities: readonly string[];
  /** Provider-reported usage windows (T2 ProviderUsageService facts), never estimates. */
  usageWindows: readonly { label: string; usedPercent: number; resetsAt: number | null }[];
  usageObservedAt: number | null;
  lastUsedAt: number | null;
  tasksToday: number;
  /** Where the identity came from: a provider status command, or a legacy adapter that reports none (tests). */
  identitySource: "provider_status" | "legacy_adapter" | "none";
};

/** Display eligibility only; actual dispatch always goes through the Host gate with Task/project consent. */
export function connectionDisplayEligibility(row: ConnectionView): boolean {
  return (
    row.dispatch &&
    row.lifecycle === "active" &&
    row.consent.allowTasks &&
    row.tool === "ready" &&
    ["signed_in", "not_required"].includes(row.session) &&
    (row.vendor === "local" || !!row.accountFingerprint) &&
    !["rate_limited", "exhausted", "not_entitled", "billing_problem"].includes(row.entitlement) &&
    ![
      "budget_blocked",
      "rate_limited",
      "not_entitled",
      "reconnect_required",
      "unsupported",
    ].includes(row.status)
  );
}
/** Explicit nonsecret projection shared by registry/voice and the actual paired-phone HTTP snapshot. */
export function connectionDeviceView(row: ConnectionView): DeviceConnectionView {
  return {
    catalog: row.catalog,
    name: catalogEntry(row.catalog).name,
    mode: row.mode,
    label: catalogMode(row.catalog, row.mode)!.label,
    status: row.status,
    usableForTasks: connectionDisplayEligibility(row),
    billing: row.billing,
    lastCheckedAt: row.lastCheckedAt,
  };
}

/** A cross-vendor (or cross-account) move Bunny refused to make on its own. Nothing is sent to `to` until the owner approves. */
export type ProposedSwitch = {
  from: { provider: ProviderId; vendor: Vendor };
  to: { provider: ProviderId; model: string | null; vendor: Vendor };
  source: "advice" | "launch_reroute" | "recovery";
  reason: string;
  at: number;
};

export type UsageView = {
  /** Requests reserved or sent today per connection (local day), including unknown outcomes. */
  requestsToday: Readonly<Record<string, number>>;
  /** USD spent today per connection, or null when any of today's rows has unknown cost. */
  usdToday: Readonly<Record<string, number | null>>;
};

// ------------------------------------------------------------------ the gate ----

export type DispatchKind =
  "launch" | "retry" | "reroute" | "escalate" | "advice" | "entitlement_test";

export type DispatchRequest = {
  kind: DispatchKind;
  provider: ProviderId;
  model: string | null;
  remoteModels?: readonly string[];
  projectId: string | null;
  origin: "workstation" | "device" | "voice" | "mission";
  /** The binding shown on the approval card. Required for every actual dispatch. */
  route: ApprovedRoute | null;
  /** The vendor BunnyRouter (or the owner's manual pick) chose before any advice. */
  routerVendor?: Vendor | null;
  /** A Mission envelope's explicit provider allow list (null = no explicit list). */
  missionAllow?: readonly ProviderId[] | null;
  /** entitlement_test only: the owner confirmed the check may use a little of the plan's included usage. */
  confirmIncludedUsage?: boolean;
  /** entitlement_test only: the owner confirmed a billable check. */
  confirmBillable?: boolean;
};

export type DispatchRefusalCode =
  | "NO_CONNECTION"
  | "MODE_NOT_DISPATCHABLE"
  | "CONNECTION_PAUSED"
  | "CONNECTION_DISCONNECTED"
  | "SIGN_IN_REQUIRED"
  | "ACCOUNT_CHANGED"
  | "NOT_ALLOWED"
  | "PROJECT_NOT_ALLOWED"
  | "BILLING_NOT_OPTED_IN"
  | "BUDGET_BLOCKED"
  | "CROSS_VENDOR_SWITCH"
  | "DEVICE_CANNOT_AUTHORIZE"
  | "STALE_AUTHORITY"
  | "TOOL_UNAVAILABLE";

export type DispatchVerdict =
  | {
      ok: true;
      connectionId: string;
      mode: ConnectionMode;
      vendor: Vendor;
      billing: BillingProvenance;
      accountFingerprint: string | null;
      epoch: number;
      consentRevision: number;
    }
  | { ok: false; code: DispatchRefusalCode; reason: string; connectionId: string | null };

const refuse = (
  code: DispatchRefusalCode,
  reason: string,
  id: string | null = null,
): DispatchVerdict => ({ ok: false, code, reason, connectionId: id });

/** Local-day start for a timestamp (ceilings are per local day, like the T13.1 Jev budgets). */
export function localDayStart(now: number): number {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

export const VENDOR_LABEL: Record<Vendor, string> = {
  openai: "OpenAI (ChatGPT/Codex)",
  anthropic: "Anthropic (Claude)",
  cursor: "Cursor",
  cline: "Cline",
  xai: "xAI (Grok)",
  ollama_cloud: "Ollama cloud",
  opencode: "OpenCode",
  google: "Google (Gemini)",
  github: "GitHub",
  openrouter: "OpenRouter",
  local: "This PC",
};

/**
 * Decides ONE exact dispatch. Called at approval/launch, before every retry, reroute and escalation, and by the
 * routing exclusion so advice and fallbacks never see a candidate the gate would refuse. Fails closed.
 *
 * Rules:
 *  1. The provider's selected connection (or the default mode for the model) must exist, be dispatchable, active,
 *     signed in, allowed for Tasks and allowed for the Task's project.
 *  2. Chargeable modes need an explicit billing opt-in and a request ceiling above zero; a strict monetary ceiling
 *     with unknown usage fails closed. Nothing switches modes on its own (no subscription -> API escalation).
 *  3. A paired device never authorizes new chargeable or cloud access: device-originated Tasks only reach local models.
 *  4. Stickiness: after approval, the vendor may change only to a vendor the Task's binding already consents to, or to
 *     one on the owner's switch allow list, or to the local runtime. "Cloud allowed" is not cross-vendor consent.
 *  5. Revocation wins: a Disconnect/Reconnect (epoch), an account switch, or a consent change that no longer allows
 *     the Task refuses queued work, retries and post-restart approvals alike.
 */
export function evaluateDispatch(
  request: DispatchRequest,
  connections: readonly ConnectionView[],
  policy: RoutingPrivacyPolicy,
  usage: UsageView,
): DispatchVerdict {
  const vendor = vendorFor(request.provider, request.model, request.remoteModels ?? []);
  if (policy.failover === "ask" && ["retry", "reroute", "escalate"].includes(request.kind))
    return refuse(
      "STALE_AUTHORITY",
      "Your failure policy requires a new owner review before another attempt.",
    );
  if (!["advice", "entitlement_test"].includes(request.kind) && !request.route)
    return refuse(
      "STALE_AUTHORITY",
      "The Task has no account approval binding; route and approve it again.",
    );
  const family = defaultModeFor(request.provider, request.model, request.remoteModels ?? []);
  if (!family)
    return refuse("NO_CONNECTION", `No connection catalogue entry exists for ${request.provider}.`);
  const selectedId =
    request.provider === "ollama"
      ? connectionId("ollama", family.mode)
      : (policy.selected[request.provider] ?? connectionId(family.catalog, family.mode));
  const connection = connections.find((row) => row.id === selectedId) ?? null;
  if (!connection)
    return refuse(
      "NO_CONNECTION",
      `${VENDOR_LABEL[vendor]} has no connection Bunny can use.`,
      selectedId,
    );
  if (connection.vendor !== vendor)
    return refuse(
      "NO_CONNECTION",
      "The selected connection does not reach this provider.",
      selectedId,
    );
  if (!connection.dispatch || connection.support !== "implemented")
    return refuse(
      "MODE_NOT_DISPATCHABLE",
      `${connection.id} cannot run Tasks in this release.`,
      selectedId,
    );
  if (connection.lifecycle === "disconnected")
    return refuse(
      "CONNECTION_DISCONNECTED",
      "You disconnected this account; reconnect it before sending Tasks.",
      selectedId,
    );
  if (connection.lifecycle === "paused")
    return refuse(
      "CONNECTION_PAUSED",
      "You paused this account; resume it before sending Tasks.",
      selectedId,
    );
  if (connection.tool === "missing" || connection.tool === "offline")
    return refuse(
      "TOOL_UNAVAILABLE",
      `${VENDOR_LABEL[vendor]} is not available on this PC right now.`,
      selectedId,
    );
  if (connection.session === "account_switched")
    return refuse(
      "ACCOUNT_CHANGED",
      "The signed-in account changed; confirm the new account in Connected Accounts.",
      selectedId,
    );
  if (connection.session !== "signed_in" && connection.session !== "not_required")
    return refuse("SIGN_IN_REQUIRED", "Sign in with the provider first.", selectedId);
  if (connection.tool !== "ready" && connection.tool !== "not_applicable")
    return refuse("TOOL_UNAVAILABLE", "The provider runtime needs a fresh check.", selectedId);
  if (
    ["exhausted", "rate_limited", "billing_problem", "not_entitled"].includes(
      connection.entitlement,
    )
  )
    return refuse(
      "BUDGET_BLOCKED",
      "The provider reports no usable entitlement right now.",
      selectedId,
    );
  if (vendor !== "local" && !connection.accountFingerprint)
    return refuse(
      "SIGN_IN_REQUIRED",
      "The provider has not identified the account safely.",
      selectedId,
    );
  const consent = connection.consent;
  if (request.kind === "entitlement_test") {
    if (request.origin !== "workstation")
      return refuse(
        "DEVICE_CANNOT_AUTHORIZE",
        "Entitlement checks run only from the Windows PC.",
        selectedId,
      );
    const billable =
      connection.billing === "api_billed" ||
      connection.billing === "metered_credits" ||
      connection.billing === "unknown";
    if (billable) {
      if (!request.confirmBillable)
        return refuse(
          "BILLING_NOT_OPTED_IN",
          "This check is billable; confirm it explicitly.",
          selectedId,
        );
      if (!consent.billingOptIn)
        return refuse(
          "BILLING_NOT_OPTED_IN",
          `${VENDOR_LABEL[vendor]} is billed separately; opt in to paid use first.`,
          selectedId,
        );
    } else if (connection.billing === "plan_included" && !request.confirmIncludedUsage)
      return refuse(
        "NOT_ALLOWED",
        "This check uses a little of your plan's included usage; confirm it first.",
        selectedId,
      );
    return {
      ok: true,
      connectionId: selectedId,
      mode: connection.mode,
      vendor,
      billing: connection.billing,
      accountFingerprint: connection.accountFingerprint,
      epoch: connection.epoch,
      consentRevision: consent.revision,
    };
  }
  if (
    consent.maxRequestsPerDay !== null &&
    (consent.maxRequestsPerDay <= 0 ||
      (usage.requestsToday[selectedId] ?? 0) >= consent.maxRequestsPerDay)
  )
    return refuse(
      "BUDGET_BLOCKED",
      "This connection's daily Task allowance is zero or used up.",
      selectedId,
    );
  if (
    !["api_billed", "metered_credits", "unknown"].includes(connection.billing) &&
    consent.maxUsdPerDay !== null
  )
    return refuse(
      "BUDGET_BLOCKED",
      "The native plan does not expose reliable per-Task pricing, so a strict spending ceiling cannot be enforced. No Task is sent.",
      selectedId,
    );
  if (!consent.allowTasks)
    return refuse(
      "NOT_ALLOWED",
      `Sending Tasks to ${VENDOR_LABEL[vendor]} is off in Connected Accounts.`,
      selectedId,
    );
  if (consent.projects !== "all" && !consent.projects.includes(request.projectId ?? ""))
    return refuse(
      "PROJECT_NOT_ALLOWED",
      `${VENDOR_LABEL[vendor]} is not allowed for this project.`,
      selectedId,
    );
  const chargeable =
    connection.billing === "api_billed" ||
    connection.billing === "metered_credits" ||
    connection.billing === "unknown";
  if (request.origin === "device" && vendor !== "local")
    return refuse(
      "DEVICE_CANNOT_AUTHORIZE",
      "A paired device cannot authorize cloud or paid access; approve on the Windows PC.",
      selectedId,
    );
  if (chargeable) {
    if (!consent.billingOptIn)
      return refuse(
        "BILLING_NOT_OPTED_IN",
        `${VENDOR_LABEL[vendor]} is billed separately; opt in to paid use first.`,
        selectedId,
      );
    const ceiling = consent.maxRequestsPerDay;
    const used = usage.requestsToday[selectedId] ?? 0;
    if (ceiling === null || ceiling <= 0 || used >= ceiling)
      return refuse(
        "BUDGET_BLOCKED",
        "The daily request allowance for this paid connection is used up or zero.",
        selectedId,
      );
    if (consent.maxUsdPerDay !== null) {
      const usd = usage.usdToday[selectedId];
      if (usd === null || usd === undefined) {
        if (consent.strictBudget)
          return refuse(
            "BUDGET_BLOCKED",
            "Today's spend is unknown and the budget is strict, so nothing more is sent.",
            selectedId,
          );
      } else if (usd >= consent.maxUsdPerDay)
        return refuse("BUDGET_BLOCKED", "The daily spending ceiling is reached.", selectedId);
    }
  }
  const route = request.route;
  if (route) {
    if (
      vendor === route.vendor &&
      (route.connectionId !== selectedId || route.mode !== connection.mode)
    )
      return refuse(
        "STALE_AUTHORITY",
        "The selected account or billing mode changed; approve this Task again.",
        selectedId,
      );
    if (route.connectionId === selectedId) {
      if (route.connectionEpoch !== connection.epoch)
        return refuse(
          "STALE_AUTHORITY",
          "This account was disconnected or reconnected after the Task was approved.",
          selectedId,
        );
      if (connection.accountFingerprint !== route.accountFingerprint)
        return refuse(
          "ACCOUNT_CHANGED",
          "A different account is signed in than the one this Task was approved for.",
          selectedId,
        );
      if (route.consentRevision !== consent.revision)
        return refuse(
          "STALE_AUTHORITY",
          "Connection consent changed; review this Task again.",
          selectedId,
        );
    }
    if (vendor !== route.vendor && vendor !== "local") {
      const consented =
        route.consentedVendors.includes(vendor) || policy.switchAllowlist.includes(vendor);
      if (!consented)
        return refuse(
          "CROSS_VENDOR_SWITCH",
          `This Task was approved for ${VENDOR_LABEL[route.vendor]}; moving it to ${VENDOR_LABEL[vendor]} needs your approval.`,
          selectedId,
        );
      const pin = route.destinationBindings?.find((binding) => binding.connectionId === selectedId);
      if (
        !pin ||
        pin.mode !== connection.mode ||
        pin.connectionEpoch !== connection.epoch ||
        pin.accountFingerprint !== connection.accountFingerprint ||
        pin.consentRevision !== consent.revision
      )
        return refuse(
          "STALE_AUTHORITY",
          "This destination account was not included in the reviewed Task, or its authorization changed. Review a new Task before switching.",
          selectedId,
        );
    }
  } else if (request.routerVendor && request.routerVendor !== vendor && vendor !== "local") {
    // Advice applied before approval: moving to another vendor than BunnyRouter's pick needs the allow list.
    const missionConsents =
      request.missionAllow?.some((provider) => vendorFor(provider, null) === vendor) ?? false;
    if (!missionConsents && !policy.switchAllowlist.includes(vendor))
      return refuse(
        "CROSS_VENDOR_SWITCH",
        `Moving this Task from ${VENDOR_LABEL[request.routerVendor]} to ${VENDOR_LABEL[vendor]} needs your approval.`,
        selectedId,
      );
  }
  return {
    ok: true,
    connectionId: selectedId,
    mode: connection.mode,
    vendor,
    billing: connection.billing,
    accountFingerprint: connection.accountFingerprint,
    epoch: connection.epoch,
    consentRevision: consent.revision,
  };
}

/** The vendors an approval consents to: the approved vendor plus a Mission envelope's explicit allow list. */
export function consentedVendorsFor(
  approvedVendor: Vendor,
  missionAllow: readonly ProviderId[] | null | undefined,
): Vendor[] {
  const set = new Set<Vendor>([approvedVendor]);
  for (const provider of missionAllow ?? []) {
    const v = vendorFor(provider, null);
    if (v !== "local") set.add(v);
  }
  return [...set];
}

// ------------------------------------------------------------ child environment ----

/**
 * Environment variables that can change which account or billing path a provider CLI uses, or inject code into it.
 * They are removed from every provider child process (sessions and status probes) unless the selected connection is
 * an API-key mode that injects exactly one of them from the Host vault.
 */
export const BILLING_ENV_EXACT: readonly string[] = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_PROFILE",
  "ANTHROPIC_FEDERATION_RULE_ID",
  "ANTHROPIC_ORGANIZATION_ID",
  "ANTHROPIC_BEDROCK_BASE_URL",
  "ANTHROPIC_VERTEX_PROJECT_ID",
  "ANTHROPIC_MODEL",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
  "CLAUDE_CODE_USE_ANTHROPIC_AWS",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CLAUDE_CONFIG_DIR",
  "CLAUDECODE",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_ORG_ID",
  "OPENAI_PROJECT_ID",
  "CODEX_API_KEY",
  "CODEX_ACCESS_TOKEN",
  "CODEX_HOME",
  "CURSOR_API_KEY",
  "XAI_API_KEY",
  "GROK_XAI_API_BASE_URL",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_GENAI_USE_VERTEXAI",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "GOOGLE_CLOUD_PROJECT",
  "GOOGLE_GEMINI_BASE_URL",
  "CLOUD_ML_REGION",
  "COPILOT_GITHUB_TOKEN",
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "OPENROUTER_API_KEY",
  "OLLAMA_API_KEY",
  "CLINE_API_KEY",
  "OPENCODE_SERVER_PASSWORD",
  "AZURE_OPENAI_API_KEY",
  "NODE_OPTIONS",
  "WSLENV",
];
export const BILLING_ENV_PREFIXES: readonly string[] = [
  "AWS_",
  "AZURE_",
  "VERTEX_",
  "ANTHROPIC_",
  "CLAUDE_CODE_USE_",
];
/** Generic credential shapes (…_API_KEY, …_TOKEN, …_SECRET, …PASSWORD) are removed too. */
const CREDENTIAL_SHAPE =
  /(?:^|_)(?:API_?KEY|ACCESS_?KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?)(?:_|$)/i;

export function isBillingEnvName(name: string): boolean {
  const upper = name.toUpperCase();
  if (BILLING_ENV_EXACT.includes(upper)) return true;
  if (BILLING_ENV_PREFIXES.some((prefix) => upper.startsWith(prefix))) return true;
  return CREDENTIAL_SHAPE.test(upper);
}

/** The single variable an API-key mode injects for a router provider (null: no injected credential). */
export function injectedCredentialEnv(provider: ProviderId, mode: ConnectionMode): string | null {
  if (mode !== "api_key") return null;
  if (provider === "claude") return "ANTHROPIC_API_KEY";
  return null;
}

/**
 * Builds a child environment from `source` with every billing/credential variable removed (case-insensitive, as
 * Windows treats names). Returns the removed NAMES only, never values. The caller injects a vault secret afterwards
 * when `injectedCredentialEnv` names one.
 */
export function scrubChildEnvironment(source: Readonly<Record<string, string | undefined>>): {
  env: Record<string, string>;
  stripped: string[];
} {
  const env: Record<string, string> = {};
  const stripped: string[] = [];
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (isBillingEnvName(name)) {
      stripped.push(name);
      continue;
    }
    env[name] = value;
  }
  return { env, stripped: stripped.sort() };
}

// ------------------------------------------------------------- argv safety ----

/**
 * Argument fragments Bunny never passes to any provider executable (probe, sign-in or session). Checked against every
 * catalogue argv in tests and at runtime before a spawn. Covers token printing, credential import, unattended
 * approval/force/bypass, self-update/downloads, browser dashboards and login-method enforcement that can delete a login.
 */
export const FORBIDDEN_ARGV: readonly RegExp[] = [
  /^--show-token$/i,
  /^token$/i,
  /^setup-token$/i,
  /^--with-api-key$/i,
  /^--api-key/i,
  /^-k$/,
  /^--apikey$/i,
  /^--key$/i,
  /^--dangerously/i,
  /^--yolo$/i,
  /^-f$/,
  /^--force$/i,
  /^--full-auto$/i,
  /^--always-approve$/i,
  /^--allow-all-tools$/i,
  /^--auto-approve$/i,
  /^--bypass/i,
  /^danger-full-access$/i,
  /^--update$/i,
  /^update$/i,
  /^upgrade$/i,
  /^dashboard$/i,
  /forced_login_method/i,
  /^copilot$/i,
  /^--bare$/i,
];

export function forbiddenArgument(args: readonly string[]): string | null {
  for (const arg of args) if (FORBIDDEN_ARGV.some((rule) => rule.test(arg))) return arg;
  return null;
}

/** Sign-in transaction progress (journaled as connections.signin.<state>). */
export type SignInState =
  | "opened"
  | "waiting"
  | "verifying"
  | "connected"
  | "account_mismatch"
  | "failed"
  | "cancelled"
  | "expired";

// ------------------------------------------------------------------ redaction ----

/** "allamsetti@gmail.com" -> "al***@gmail.com"; anything else shaped like an id -> first 2 chars + "***". */
export function maskIdentity(value: string | null | undefined): string | null {
  if (!value) return null;
  const text = value.trim();
  if (!text) return null;
  const at = text.indexOf("@");
  if (at > 0)
    return `${text.slice(0, Math.min(2, at - 1))}***${text.slice(at).replace(/['s]+ Organization$/i, "")}`;
  return `${text.slice(0, Math.min(2, text.length - 1))}***`;
}

/** The phone sees only this: no identity, no workspace, no consent internals, no error text, no credential facts. */
export type DeviceConnectionView = {
  catalog: CatalogId;
  name: string;
  mode: ConnectionMode;
  label: string;
  status: ConnectionStatus;
  usableForTasks: boolean;
  billing: BillingProvenance;
  lastCheckedAt: number | null;
};

// ------------------------------------------------------------- intent parsing ----

const INTENT_NAMES: readonly [RegExp, CatalogId][] = [
  [/\b(?:chat\s?gpt|codex|open\s?ai)\b/, "openai"],
  [/\b(?:claude(?:\s+code)?|anthropic)\b/, "anthropic"],
  [/\bcursor\b/, "cursor"],
  [/\b(?:cline|cline\s?pass)\b/, "cline"],
  [/\b(?:grok|x\.?ai)\b/, "xai"],
  [/\bollama\b/, "ollama"],
  [/\bopen\s?code\b/, "opencode"],
  [/\b(?:gemini|google|antigravity)\b/, "gemini"],
  [/\b(?:copilot|github)\b/, "copilot"],
  [/\bopen\s?router\b/, "openrouter"],
];

/**
 * "Bunny, connect my Claude account" -> {verb: "connect", catalog: "anthropic"}. Deterministic and narrow: the whole
 * utterance must be the request (no trailing instructions), so "connect my claude account and delete files" is not an
 * account intent. It only opens the owner's Settings card; it never starts a sign-in and never asks for a secret.
 */
export function parseAccountIntent(
  text: string,
): { verb: "connect" | "status"; catalog: CatalogId } | null {
  const t = text
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:(?:hey|ok|okay)\s+)?bunny\b[\s,.!?:]*/, "")
    .replace(/^please\s+/, "")
    .replace(/[\s.!?]+$/, "");
  const connect =
    /^(?:connect|link|sign (?:me )?in(?:to| to)?|log (?:me )?in(?:to| to)?|set up|add)\s+(?:my\s+|the\s+|a\s+)?(.{2,40}?)(?:\s+(?:account|subscription|plan|login))?$/.exec(
      t,
    );
  const status =
    /^(?:is|are)\s+(?:my\s+)?(.{2,40}?)\s+(?:account\s+)?(?:connected|working|signed in)$/.exec(
      t,
    ) ??
    /^(?:how is|check|what(?:'s| is) the status of)\s+(?:my\s+)?(.{2,40}?)(?:\s+(?:account|connection))?$/.exec(
      t,
    );
  const match = connect ?? status;
  if (!match) return null;
  const subject = match[1];
  if (
    /\b(?:and|then|also|delete|remove|run|send|pay|buy|password|key|token|otp)\b|\b(?:verification|one-time|auth(?:entication)?)\s+code\b/.test(
      subject,
    )
  )
    return null;
  const found = INTENT_NAMES.find(([pattern]) => pattern.test(subject));
  if (!found) return null;
  return { verb: connect ? "connect" : "status", catalog: found[1] };
}
