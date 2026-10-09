import { basename, dirname, isAbsolute, resolve } from "node:path";
import { existsSync, realpathSync, statSync } from "node:fs";
import type { Mode, ProviderId, ProviderExecutionScope } from "../orch/types.ts";
import { withinAny } from "./paths.server.ts";
import { resolveCommand, type Resolved } from "./capabilities/process.server.ts";
import type { ActionManifest, AuthorizationEnvelope, Budget, DesktopGrant, DesktopOperation, EnvelopeAuthority, GitAction, GrantPolicy, MissionStep, PermissionDecision, RiskClass, ScopeRequest, SessionAuthority } from "./types.ts";
import type { AgenticAuthorizationEnvelope } from "./agentic-types.ts";
import { canonical } from "./paths.server.ts";
import { digest, fileDigest, rootIdentity } from "./agentic-store.server.ts";
import { boundedTestResources } from "./capabilities/bounded-terminal.server.ts";
import { operationDigest, calculatorOperation } from "./batches.server.ts";
import { operationContract } from "./cross-app.ts";

export const ALWAYS_ASK: RiskClass[] = ["EXTERNAL_SIDE_EFFECT", "DESTRUCTIVE"];
export const MODE_BUDGET: Record<Mode, Budget> = {
  fast: { maxExternalModelCalls: 2, maxRuntimeMs: 30 * 60_000, maxRetries: 2, maxTokens: null },
  balanced: { maxExternalModelCalls: 6, maxRuntimeMs: 60 * 60_000, maxRetries: 4, maxTokens: null },
  deep: { maxExternalModelCalls: 12, maxRuntimeMs: 2 * 60 * 60_000, maxRetries: 6, maxTokens: null },
};
const GIT_ACTION: Record<string, GitAction> = { "git.status": "status", "git.diff": "diff", "git.log": "log", "git.tracked_files": "status", "git.branch": "status", "git.commit_info": "log", "git.commit": "commit", "git.worktree_add": "worktree", "git.worktree_remove": "worktree", "git.merge": "merge" };

export function matches(patterns: string[], action: string) {
  return patterns.some((pattern) => pattern === "*" || pattern === action || (pattern.endsWith(".*") && action.startsWith(pattern.slice(0, -1))));
}
/** Command identity for allowlists: "C:\\x\\Node.EXE" → "node". */
export function commandName(command: string) { return basename(command.replaceAll("\\", "/")).toLowerCase().replace(/\.(exe|cmd|bat)$/, ""); }
export function domainOf(url: string): string | null { try { return new URL(url).hostname.toLowerCase(); } catch { return null; } }
function domainAllowed(domains: string[] | "public", host: string) {
  if (domains === "public") return true;
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

/**
 * The scope a mission asks for, derived from its planned steps. Nothing is granted until the user
 * approves the mission; approval turns this request into a persisted envelope.
 */
export function scopeFor(steps: (Pick<MissionStep, "executor" | "requiredCapabilities" | "verification" | "scope" | "providerConstraints" | "crossApp"> & { id?: string })[], root: string, mode: Mode, options: { localOnly?: boolean; providers?: ProviderId[] | null; budget?: Budget; skillSteps?: (skillId: string) => { action: string; params: Record<string, unknown> }[] } = {}): ScopeRequest {
  const actions = new Set<string>(["notifications.send", "filesystem.read", "filesystem.list", "filesystem.exists"]);
  const commands = new Set<string>(); const executables = new Map<string, { command: string; file: string; prefix: string[] }>();
  const approveCommand = (command: string) => {
    commands.add(commandName(command));
    const identity = resolveCommand(command, root);
    if (identity) executables.set(JSON.stringify([identity.file, identity.prefix]), { command, file: identity.file, prefix: identity.prefix });
  };
  const git = new Set<GitAction>(); const risks = new Set<RiskClass>(["READ"]);
  let browser = false; let computer = false; let network = false; let execution = false; let write = false;
  for (const step of steps) {
    for (const capability of step.requiredCapabilities) actions.add(capability);
    if (step.executor.kind === "model") { execution = true; if (step.scope.access === "write") write = true; }
    // A skill asks for exactly what its own steps will do, so its commands are in the envelope up front.
    const concrete = step.executor.kind === "capability" ? [{ action: step.executor.action, params: step.executor.params as Record<string, unknown> }] : step.executor.kind === "skill" ? options.skillSteps?.(step.executor.skillId) ?? [] : [];
    for (const item of concrete) {
      actions.add(item.action);
      if (item.action === "terminal.exec" && typeof item.params.command === "string") approveCommand(item.params.command);
    }
    for (const check of step.verification) if (check.kind === "command") { actions.add("terminal.exec"); approveCommand(check.command); }
    for (const check of step.verification) if (check.kind === "capability") actions.add(check.action);
    if (step.scope.access === "write") write = true;
    if (step.scope.isolation === "worktree") actions.add("git.worktree_add");
    if (step.verification.some((check) => check.kind === "git_diff_nonempty")) actions.add("git.diff");
  }
  for (const action of actions) {
    if (action.startsWith("browser.")) { browser = true; network = true; }
    if (action.startsWith("computer.")) computer = true;
    if (action.startsWith("github.")) network = true;
    if (GIT_ACTION[action]) git.add(GIT_ACTION[action]);
    if (steps.some(step => step.crossApp) && action.startsWith("computer.") && action !== "computer.read_calculator") risks.add("EXECUTE");
    if (action === "terminal.exec") risks.add("EXECUTE");
    if (action === "filesystem.write" || action === "git.commit" || action === "git.merge" || action.startsWith("git.worktree")) risks.add("WRITE");
    if (action === "filesystem.write" || action === "git.commit" || action === "git.merge") write = true;
  }
  if (write) risks.add("WRITE");
  if (execution) risks.add("EXECUTE");
  return {
    projectRoots: [root],
    riskClasses: [...risks],
    capabilities: [...actions].sort(),
    providers: { execution, allow: options.providers ?? null, localOnly: !!options.localOnly, sessions: {
      steps: steps.filter((step) => step.executor.kind === "model").map((step, index) => ({ stepId: step.id ?? `unbound:${index}`, scope: { access: step.scope.access } })),
      maxSessions: execution ? steps.filter((step) => step.executor.kind === "model").length + 2 * (options.budget ?? MODE_BUDGET[mode]).maxRetries : 0,
      writeIncludesShell: true,
    } },
    filesystem: { read: [root], write: write ? [root] : [] },
    browser: { enabled: browser, domains: "public" },
    terminal: { enabled: commands.size > 0, commands: [...commands].sort(), executables: [...executables.values()] },
    git: { actions: [...git].sort() },
    network: { allowed: network },
    computer: { enabled: computer },
    budget: options.budget ?? MODE_BUDGET[mode],
    alwaysAsk: [...ALWAYS_ASK],
  };
}

export function envelopeFrom(request: ScopeRequest, missionId: string, grantedBy: string, maxRuntimeMs: number, extraRoots: string[] = []): AuthorizationEnvelope {
  const now = Date.now();
  const authority = authorityFor(grantedBy);
  const providers = structuredClone(request.providers);
  // M-A-3 T9R-F01: a remote grant never carries shell-capable provider authority, whatever was displayed.
  if (authority.kind === "remote" && providers.sessions) providers.sessions.writeIncludesShell = false;
  return {
    ...structuredClone(request),
    providers,
    projectRoots: [...request.projectRoots, ...extraRoots],
    filesystem: { read: [...request.filesystem.read, ...extraRoots], write: request.filesystem.write.length ? [...request.filesystem.write, ...extraRoots] : [] },
    id: crypto.randomUUID(), missionId, grantedAt: now, grantedBy, expiresAt: now + Math.min(maxRuntimeMs, request.budget.maxRuntimeMs), revokedAt: null,
    authority,
  };
}

// ── M-A-3 T9R-F01: remote (paired-device) authority ceiling ─────────────────
/** The provider-session authority a paired device may grant. Anything else needs a trusted-desktop grant. */
export const REMOTE_SESSION_CEILING: readonly SessionAuthority[] = ["tool_free", "read_tools"];
export const DESKTOP_REQUIRED = "Approval required on Windows Host: a paired device cannot authorize command or code execution.";
/** Trusted-desktop grants are short-lived and single use. */
export const DESKTOP_GRANT_TTL_MS = 5 * 60_000;
export const DESKTOP_GRANT_MAX_USES = 1;

/** Only the authenticated workstation principal is trusted-local. Every other actor string is remote (fail closed). */
const GIT_MUTATIONS = ["git.commit", "git.merge", "git.worktree_add", "git.worktree_remove"];
/** `.git` and its Windows 8.3 alias (segments are normalized first: no stream suffix, trailing dots or spaces). */
const GIT_SEGMENT = /^(\.git|git~\d+)$/i;
/** Files and folders whose content configures programs that later run (Git drivers, package scripts, hooks, tasks). */
const EXECUTION_CONFIG_FILE = /^(\.gitattributes|\.gitmodules|\.gitconfig|package\.json|\.npmrc|\.yarnrc(\.yml)?|\.pnpmfile\.cjs|bunfig\.toml|makefile|gnumakefile|\.envrc|taskfile\.ya?ml|justfile|\.?lefthook\.ya?ml|\.pre-commit-config\.yaml|pyproject\.toml|setup\.py|setup\.cfg|conftest\.py|tox\.ini|noxfile\.py|build\.rs|rakefile|gemfile|[^/\\]+\.config\.[cm]?[jt]s|gulpfile\.[cm]?[jt]s|gruntfile\.[cm]?[jt]s|\.[\w-]+rc\.[cm]?[jt]s|[^/\\]+\.conf\.[cm]?[jt]s|nodemon\.json|deno\.jsonc?|composer\.json|cargo\.toml|\.?mise\.toml|\.tool-versions|wrangler\.toml|(docker-)?compose\.ya?ml|dockerfile|vagrantfile|procfile|pom\.xml|build\.gradle(\.kts)?|settings\.gradle(\.kts)?|gradle\.properties|cmakelists\.txt|[^/\\]+\.cmake|directory\.build\.(props|targets|rsp)|directory\.packages\.props|[^/\\]+\.(csproj|vbproj|fsproj|vcxproj|sln)|\.env(\.[\w.-]+)?|\.(babelrc|mocharc|prettierrc|eslintrc|stylelintrc|huskyrc|lintstagedrc|swcrc|aider[\w.-]*)(\.[\w]+)?|lint-staged\.config\.[\w]+|babel\.config\.[\w]+|[\w.-]*devcontainer\.json|vercel\.json|netlify\.toml|firebase\.json|\.gitlab-ci\.ya?ml|azure-pipelines\.ya?ml|bitbucket-pipelines\.ya?ml|\.travis\.ya?ml|appveyor\.ya?ml|\.drone\.ya?ml|docker-compose\.json|package-lock\.json|npm-shrinkwrap\.json|tsconfig([\w.-]*)\.json|jsconfig\.json)$/i;
const EXECUTION_CONFIG_DIR = /^(\.husky|\.vscode|\.github|\.devcontainer|node_modules|\.cargo|\.yarn|\.mvn|\.config|\.idea|\.claude|\.cursor|\.codex|\.gemini|\.continue|\.clinerules|\.windsurf|\.roo|\.kiro|\.aider|\.circleci|\.buildkite|\.azure|\.woodpecker|\.gitlab)$/i;
/** Data and document types a paired device may write (risk reduction; the content review is the authoritative control). */
const INERT_DATA_FILE = /\.(txt|text|md|markdown|csv|tsv|json|jsonl|ndjson|yaml|yml|log)$/i;
const AGENT_CONFIG_FILE = /^(\.mcp\.json|claude\.md|agents\.md|gemini\.md|\.clinerules|\.cursorrules|\.windsurfrules|copilot-instructions\.md)$/i;
const segmentsOf = (path: string) => path.split(/[\\/]+/).filter(Boolean);
/** A segment as Windows resolves it: no NTFS stream suffix (name:stream:$DATA), no trailing dots or spaces. */
const normalizeSegment = (segment: string) => segment.replace(/:.*$/, "").replace(/[. ]+$/, "");
/**
 * Every name a path can reach: its lexical segments and the native canonical segments of its longest existing
 * prefix (which expands 8.3 short names such as GIT~1 or PACKAG~1.JSO, links and junctions), all normalized.
 */
function resolvedNames(path: string): { segments: string[]; leaves: string[] } {
  // Network and device paths are never probed (a dead share blocks for seconds); callers fail closed.
  if (/^([\\/]{2})/.test(path)) throw new Error("Network or device path.");
  const lexical = segmentsOf(path).map(normalizeSegment);
  let probe = resolve(path);
  const rest: string[] = [];
  while (!existsSync(probe)) {
    const up = dirname(probe);
    if (up === probe) return { segments: lexical, leaves: [lexical.at(-1) ?? ""] };
    rest.unshift(basename(probe));
    probe = up;
  }
  const native = [...segmentsOf(realpathSync.native(probe)), ...rest].map(normalizeSegment);
  return { segments: [...lexical, ...native], leaves: [lexical.at(-1) ?? "", native.at(-1) ?? ""] };
}
/** Whether a path is inside Git metadata under any name it can reach. A path that cannot be resolved fails closed. */
export function touchesGitMetadata(path: string): boolean {
  try { return resolvedNames(path).segments.some((segment) => GIT_SEGMENT.test(segment)); } catch { return true; }
}
/** Whether writing this path can change what a later command, hook or Git driver executes. Fails closed. */
/** M-A-3 T9R-F01: what a paired device sees instead of any text that carries the workstation's review listing. */
export const DEVICE_REVIEW_REASON = "Approval required on Windows Host: changes made under paired-device authority are reviewed on the Windows Host before code runs.";
const REVIEW_TEXT = /under paired-device authority|paired-device change|a paired-device [\w.]+ of |trusted-desktop grant/i;
/** Records a paired device never receives: trusted-desktop grants, exact operations and their ask-time bindings. */
const DEVICE_HIDDEN_KEYS = new Set(["desktopGrant", "desktopOperation", "desktopBinding"]);
/** Replaces every string that carries review listings (changed paths, digests, content) for a paired-device view. */
export function redactReviewListing<T>(value: T): T {
  const walk = (item: unknown): unknown =>
    typeof item === "string" ? (REVIEW_TEXT.test(item) ? DEVICE_REVIEW_REASON : item)
      : Array.isArray(item) ? item.map(walk)
      : item && typeof item === "object" ? Object.fromEntries(Object.entries(item).filter(([key]) => !DEVICE_HIDDEN_KEYS.has(key)).map(([key, entry]) => [key, walk(entry)]))
      : item;
  return walk(value) as T;
}
/** Whether every name this path resolves to (lexical, 8.3 alias and real) is an inert data or document file. */
export function inertDataPath(path: string): boolean {
  // A named NTFS stream (name:stream) is never an inert document, whatever the visible name says.
  if ((path.split(/[\\/]/).pop() ?? "").includes(":")) return false;
  try {
    const { leaves } = resolvedNames(path);
    return leaves.length > 0 && leaves.every((leaf) => INERT_DATA_FILE.test(leaf) && !AGENT_CONFIG_FILE.test(leaf));
  } catch {
    return false;
  }
}
export function executionConfigPath(path: string): boolean {
  try {
    const { segments, leaves } = resolvedNames(path);
    return segments.some((segment) => GIT_SEGMENT.test(segment) || EXECUTION_CONFIG_DIR.test(segment)) || leaves.some((leaf) => EXECUTION_CONFIG_FILE.test(leaf));
  } catch { return true; }
}
/** An exact reviewed Calculator operation that also names the Calculator window (a pid alone is not an identity). */
function remoteCalculatorOperation(action: string, params: Record<string, unknown>) {
  return calculatorOperation(action, params) && (action === "computer.open_app" || params.title === "Calculator");
}
export function isTrustedLocalActor(actor: unknown): boolean { return actor === "workstation"; }
export function authorityFor(grantedBy: string): EnvelopeAuthority {
  return isTrustedLocalActor(grantedBy) ? { kind: "workstation" } : { kind: "remote", actor: grantedBy, sessionCeiling: [...REMOTE_SESSION_CEILING], codeExecution: "desktop_only" };
}
/**
 * Whether an envelope carries only remote authority. Older JSON without `authority` is judged by `grantedBy`
 * ("device:*" is remote). Any remote marker wins, so a stored "workstation" label cannot widen a remote grant.
 */
export function isRemoteEnvelope(envelope: Pick<AuthorizationEnvelope, "grantedBy" | "authority" | "providers">): boolean {
  if (envelope.authority?.kind === "remote") return true;
  if (envelope.providers.sessions?.writeIncludesShell === false) return true;
  if (envelope.authority && envelope.authority.kind !== "workstation") return true;
  // Only the authenticated workstation is trusted-local; every other or missing grantor is remote (fail closed).
  return !isTrustedLocalActor(envelope.grantedBy);
}
/**
 * The tool authority a provider session runs with, from the exact launch contracts (claudeLaunchArgs,
 * codexLaunchArgs, OllamaAdapter). Unknown providers or access values return null and fail closed.
 */
export function providerSessionAuthority(provider: unknown, access: unknown): SessionAuthority | null {
  if (access !== "read" && access !== "write") return null;
  if (provider === "ollama") return "tool_free";
  // Claude read: --restricted --tools Read; Write/Edit/Bash/PowerShell disallowed. Claude write: Bash and PowerShell.
  if (provider === "claude") return access === "read" ? "read_tools" : "shell";
  // Codex runs commands in both read-only and workspace-write sandboxes.
  if (provider === "codex") return "shell";
  return null;
}
/** Why a remote envelope may not launch this provider session on its own authority, or null. */
export function remoteSessionViolation(task: { provider?: unknown; executionScope?: { access?: unknown } }, envelope: Pick<AuthorizationEnvelope, "grantedBy" | "authority" | "providers">): string | null {
  if (!isRemoteEnvelope(envelope)) return null;
  const authority = providerSessionAuthority(task.provider, task.executionScope?.access);
  const ceiling = envelope.authority?.kind === "remote" ? envelope.authority.sessionCeiling.filter((item) => REMOTE_SESSION_CEILING.includes(item)) : REMOTE_SESSION_CEILING;
  if (authority && ceiling.includes(authority)) return null;
  return `${DESKTOP_REQUIRED} ${String(task.provider)} ${String(task.executionScope?.access)} sessions run with ${authority ?? "unclassified"} authority.`;
}
/**
 * Why a remote envelope may not run this capability action without a trusted-desktop grant, or null.
 * EXECUTE-risk actions are allowed remotely only as exact reviewed Calculator operations; Git metadata
 * writes are refused because Git config, hooks and filters can run commands. Unknown risk fails closed.
 */
export function remoteExecutionRefusal(action: string, params: Record<string, unknown>, risk: RiskClass, cwd?: string): string | null {
  if (!["READ", "WRITE", "EXECUTE", "EXTERNAL_SIDE_EFFECT", "DESTRUCTIVE"].includes(risk)) return `${DESKTOP_REQUIRED} Unknown action risk.`;
  if (action === "terminal.exec") return `${DESKTOP_REQUIRED} terminal.exec runs a program.`;
  if (action === "provider.execute") return `${DESKTOP_REQUIRED} provider sessions are judged by their tool authority.`;
  if (risk === "EXECUTE" && !remoteCalculatorOperation(action, params)) return `${DESKTOP_REQUIRED} ${action} is not an exact reviewed Calculator operation.`;
  // Commit, merge and worktree changes run repository hooks and merge drivers.
  if (GIT_MUTATIONS.includes(action)) return `${DESKTOP_REQUIRED} ${action} can run repository hooks.`;
  // A download can bring any program or script into the project; the workstation reviews it.
  if (action === "browser.download") return `${DESKTOP_REQUIRED} a download can bring executable content onto this computer.`;
  if (action === "filesystem.write" || action === "filesystem.delete") {
    if (typeof params.path !== "string") return `${DESKTOP_REQUIRED} ${action} has no concrete path.`;
    const path = isAbsolute(params.path) || !cwd ? params.path : resolve(cwd, params.path);
    if (executionConfigPath(path)) return `${DESKTOP_REQUIRED} ${params.path} configures Git, package scripts, hooks or tasks that run commands.`;
    // A device writes only data and document types (risk reduction: no recognized code or configuration). An
    // interpreter can still run any file it is pointed at, so the authoritative control is the Host-wide review: no
    // Bunny code run starts until the workstation reviews the content of every paired-device change.
    if (action === "filesystem.write" && !inertDataPath(path)) return `${DESKTOP_REQUIRED} ${params.path} is not a plain data or document file; a paired device writes only inert files (.txt, .md, .csv, .json, .yaml and similar).`;
  }
  return null;
}
/** Whether an action runs a program or repository hooks (terminal, Git mutations, non-Calculator UI automation). */
export function runsCode(action: string, params: Record<string, unknown>, risk: RiskClass): boolean {
  return action === "terminal.exec" || GIT_MUTATIONS.includes(action) || (risk === "EXECUTE" && !remoteCalculatorOperation(action, params));
}
/** Exact provider-session operation for a trusted-desktop grant. */
export function sessionOperation(task: { provider: string; model: string; effort?: string | null; cwd?: string; executionScope?: { access?: unknown } }): DesktopOperation {
  return { kind: "provider_session", provider: task.provider, model: task.model, effort: task.effort ?? null, access: String(task.executionScope?.access), cwd: task.cwd ?? "", sessionAuthority: providerSessionAuthority(task.provider, task.executionScope?.access) ?? "unknown" };
}
/** Content identity of the existing files a command names, so an approved script cannot change before it runs. */
function fileIdentities(params: Record<string, unknown>, base: string): Record<string, string> {
  const out: Record<string, string> = {};
  // Names resolve where the program actually starts: the command's own working folder, like the terminal adapter.
  const cwd = typeof params.cwd === "string" && params.cwd ? resolve(base, params.cwd) : base;
  // A file can be named directly or as an option value (--require=./x.js, --import=./x.mjs).
  const names = [params.command, ...(Array.isArray(params.args) ? params.args : [])]
    .filter((value): value is string => typeof value === "string" && !!value)
    .map((value) => value.startsWith("-") ? (value.includes("=") ? value.slice(value.indexOf("=") + 1) : "") : value)
    .filter(Boolean);
  for (const name of names)
    try {
      const path = resolve(cwd, name);
      if (!existsSync(path) || !statSync(path).isFile()) continue;
      const size = statSync(path).size;
      out[name] = size <= 8 * 1024 * 1024 ? fileDigest(path) : `large:${size}:${statSync(path).mtimeMs}`;
    } catch { out[name] = "unreadable"; }
  return out;
}
/** Exact capability operation for a trusted-desktop grant: action, every parameter, folder and resolved executable. */
export function capabilityOperation(action: string, params: Record<string, unknown>, cwd: string, executable?: Resolved | null): DesktopOperation {
  return { kind: "capability", action, digest: operationDigest(action, params), cwd, executable: executable ? { file: executable.file, prefix: [...executable.prefix] } : null, ...(action === "terminal.exec" ? { files: fileIdentities(params, cwd) } : {}) };
}
function sameOperation(a: DesktopOperation, b: DesktopOperation) {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([x], [y]) => x.localeCompare(y)).map(([key, item]) => [key, canonical(item)])) : value;
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}
export type DesktopGrantContext = {
  hostId: string; epoch: string; missionId: string; agentId: string | null; stepId: string; taskId: string | null;
  planReference: string; authorizationId: string; operation: DesktopOperation;
  /** Host-wide count of project-mutating capability runs; any change after approval voids the grant. */
  mutationSequence: number; now?: number;
};
/** Why this trusted-desktop grant cannot authorize this exact operation now, or null. Every binding is exact. */
export function desktopGrantViolation(grant: DesktopGrant | null | undefined, context: DesktopGrantContext): string | null {
  const now = context.now ?? Date.now();
  if (!grant) return "No trusted-desktop authorization covers this operation.";
  if (grant.grantedBy !== "workstation") return "Trusted-desktop authorization was not granted by the workstation.";
  if (grant.revokedAt !== null) return "Trusted-desktop authorization was revoked.";
  if (!(grant.expiresAt > now)) return "Trusted-desktop authorization expired.";
  if (!Number.isSafeInteger(grant.uses) || !Number.isSafeInteger(grant.maxUses) || grant.uses >= grant.maxUses || grant.maxUses > DESKTOP_GRANT_MAX_USES) return "Trusted-desktop authorization was already used.";
  if (grant.hostId !== context.hostId) return "Trusted-desktop authorization belongs to another Host.";
  if (grant.epoch !== context.epoch) return "Trusted-desktop authorization belongs to an earlier Host epoch.";
  if (grant.missionId !== context.missionId || grant.agentId !== context.agentId || grant.stepId !== context.stepId || grant.taskId !== context.taskId)
    return "Trusted-desktop authorization belongs to another Mission, Agent, step or Task.";
  if (grant.planReference !== context.planReference) return "The plan changed after trusted-desktop authorization.";
  if (grant.authorizationId !== context.authorizationId) return "The Mission authorization changed after trusted-desktop authorization.";
  // Imported modules, directory entry points and other project files are bound by the mutation sequence: any
  // file-changing capability run after the desktop approval means the approved code may differ.
  if (grant.mutationSequence !== context.mutationSequence) return "Project files changed after trusted-desktop authorization; review the action again.";
  if (!sameOperation(grant.operation, context.operation)) return "The operation differs from the one authorized on the desktop.";
  return null;
}

/** Parameter-level scope check for one action against an envelope. Returns why it is outside, or null. */
export function scopeViolation(action: string, params: Record<string, unknown>, envelope: AuthorizationEnvelope, base?: string, executable?: Resolved | null): string | null {
  // Relative paths are judged where they will actually resolve: the step's working folder.
  const at = (value: unknown) => typeof value === "string" && value ? (isAbsolute(value) || !base ? value : resolve(base, value)) : null;
  const path = at(params.path);
  const cwd = at(params.cwd);
  if (action.startsWith("filesystem.")) {
    if (!path) return null;
    const roots = action === "filesystem.write" || action === "filesystem.delete" ? envelope.filesystem.write : [...envelope.filesystem.read, ...envelope.filesystem.write];
    return withinAny(roots, path) ? null : `${path} is outside the approved ${action === "filesystem.write" || action === "filesystem.delete" ? "write" : "read"} scope.`;
  }
  if (action === "terminal.exec") {
    if (!envelope.terminal.enabled) return "Terminal execution was not approved for this mission.";
    const command = typeof params.command === "string" ? commandName(params.command) : "";
    if (!envelope.terminal.commands.includes(command)) return `Command "${command}" is not in the approved command list (${envelope.terminal.commands.join(", ") || "none"}).`;
    const identity = executable === undefined ? resolveCommand(String(params.command ?? ""), base) : executable;
    if (!identity || !envelope.terminal.executables?.some((entry) => entry.file === identity.file && JSON.stringify(entry.prefix) === JSON.stringify(identity.prefix))) return `Resolved executable for "${command}" is not the approved executable identity; approve the new path explicitly.`;
    if (cwd && !withinAny(envelope.projectRoots, cwd)) return `Working folder ${cwd} is outside the approved project roots.`;
    return null;
  }
  if (GIT_ACTION[action]) {
    if (!envelope.git.actions.includes(GIT_ACTION[action])) return `Git ${GIT_ACTION[action]} was not approved for this mission.`;
    if (cwd && !withinAny(envelope.projectRoots, cwd)) return `Repository ${cwd} is outside the approved project roots.`;
    return null;
  }
  if (action.startsWith("browser.")) {
    if (!envelope.browser.enabled || !envelope.network.allowed) return "Browser use was not approved for this mission.";
    const url = typeof params.url === "string" ? params.url : null;
    if (url) { const host = domainOf(url); if (!host || !domainAllowed(envelope.browser.domains, host)) return `Domain ${host ?? url} is outside the approved browser scope.`; }
    return null;
  }
  if (action.startsWith("computer.")) return envelope.computer.enabled ? null : "Computer control was not approved for this mission.";
  if (action.startsWith("github.")) return envelope.network.allowed ? null : "Network access was not approved for this mission.";
  return null;
}

export type GrantRow = { action: string; scope: string; policy: GrantPolicy };
function grantFor(grants: GrantRow[], action: string, missionId: string | null): GrantPolicy | null {
  const scoped = missionId ? grants.filter((grant) => grant.scope === `mission:${missionId}` && matches([grant.action], action)) : [];
  const global = grants.filter((grant) => grant.scope === "global" && matches([grant.action], action));
  // Most restrictive applicable policy wins.
  const order: GrantPolicy[] = ["never_allow", "read_only", "ask_every_time", "allow_for_mission", "always_allow"];
  const all = [...scoped, ...global].map((grant) => grant.policy).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return all[0] ?? null;
}

/**
 * The single permission decision every capability execution passes through.
 * - `oneTime`: the user allowed this invocation or matching action within this skill run.
 * - `direct`: a workstation user invoked the action explicitly outside any mission (still asks for
 *   EXTERNAL_SIDE_EFFECT / DESTRUCTIVE / hard-approval actions unless `confirmed`).
 */
export function decide(manifest: ActionManifest, params: Record<string, unknown>, context: { envelope: AuthorizationEnvelope | null; missionId: string | null; grants: GrantRow[]; oneTime?: boolean; direct?: { confirmed: boolean }; now?: number; base?: string; executable?: Resolved | null; agenticViolation?: string | null; desktopGrant?: boolean }): PermissionDecision {
  const risk = manifest.risk; const now = context.now ?? Date.now();
  const deny = (reason: string): PermissionDecision => ({ decision: "deny", reason, risk });
  if (context.envelope && context.envelope.missionId !== context.missionId) return deny("Authorization belongs to a different Mission; it cannot authorize this request.");
  const ask = (reason: string): PermissionDecision => ({ decision: "ask", reason, risk });
  const allow = (reason: string): PermissionDecision => ({ decision: "allow", reason, risk });
  if (!["READ", "WRITE", "EXECUTE", "EXTERNAL_SIDE_EFFECT", "DESTRUCTIVE"].includes(risk)) return deny("Unknown action risk fails closed.");
  if (!manifest.implemented) return deny(`${manifest.id} is not implemented on this Host.`);
  const grant = grantFor(context.grants, manifest.id, context.missionId);
  if (grant === "never_allow") return deny(`A persistent "never allow" rule covers ${manifest.id}.`);
  if (grant === "read_only" && risk !== "READ") return deny(`A persistent "read only" rule covers ${manifest.id}.`);
  // M-A-3 T9R-F01: remote authority never runs code. Only a trusted-desktop grant for this exact operation
  // lifts the ceiling; a one-time answer, a batch or a standing grant cannot. Never a direct workstation call.
  if (context.envelope && !context.direct && isRemoteEnvelope(context.envelope)) {
    const remote = remoteExecutionRefusal(manifest.id, params, risk, context.base);
    if (remote && !context.desktopGrant) return { decision: "ask", reason: remote, risk, desktopRequired: true };
  }
  if (context.agenticViolation) return ask(context.agenticViolation);
  // M-A-3 T9R-F01: a one-time allowance never outlives its envelope's revocation.
  if (context.envelope?.revokedAt && !context.direct) return deny("The mission authorization was revoked.");
  // A remote (paired-device) envelope is never extended by a one-time answer once it expired.
  if (context.envelope && !context.direct && isRemoteEnvelope(context.envelope) && context.envelope.expiresAt <= now) return ask("The remote mission authorization expired.");
  if (context.oneTime) return allow("The user allowed this invocation or the matching action in this skill run.");
  if (context.direct) {
    if ((manifest.hardApproval || ALWAYS_ASK.includes(risk) || manifest.sensitive) && !context.direct.confirmed) return ask(`${manifest.id} is ${risk.toLowerCase().replaceAll("_", " ")}${manifest.sensitive ? " and privacy-sensitive" : ""}; explicit confirmation required.`);
    return allow("Invoked directly by the workstation user.");
  }
  const envelope = context.envelope;
  if (!envelope) return ask("No mission authorization covers this action.");
  if (envelope.revokedAt) return deny("The mission authorization was revoked.");
  if (envelope.expiresAt <= now) return ask("The mission authorization expired.");
  if (manifest.hardApproval) return ask(`${manifest.id} always needs explicit approval.`);
  if (grant === "ask_every_time") return ask(`A persistent "ask every time" rule covers ${manifest.id}.`);
  if (!matches(envelope.capabilities, manifest.id)) return ask(`${manifest.id} is outside the approved capability list.`);
  if (!envelope.riskClasses.includes(risk)) return ask(`${risk} actions were not approved for this mission.`);
  const violation = scopeViolation(manifest.id, params, envelope, context.base, context.executable);
  if (violation) return ask(violation);
  const elevated = grant === "always_allow" || grant === "allow_for_mission";
  if (envelope.alwaysAsk.includes(risk) && !(elevated && risk !== "DESTRUCTIVE")) return ask(`${risk.replaceAll("_", " ").toLowerCase()} actions always ask.`);
  if (manifest.sensitive && !elevated) return ask(`${manifest.id} is privacy-sensitive and asks each time.`);
  return allow(`Inside mission authorization ${envelope.id}.`);
}

/** T5 constraints inside the existing permission engine; this function never grants execution. */
export function agenticScopeViolation(e: AgenticAuthorizationEnvelope, action: string, params: Record<string, unknown>, risk: RiskClass, cwd: string, executable?: Resolved | null, stepId?: string | null): string | null {
  const rank: RiskClass[] = ["READ", "WRITE", "EXECUTE", "EXTERNAL_SIDE_EFFECT", "DESTRUCTIVE"];
  if (!rank.includes(risk)) return "Unknown action risk; explicit review required.";
  if (!e.permitted_capabilities.includes(action)) return "Action is outside the explicitly approved Agent capability list.";
  if (rank.indexOf(risk) > rank.indexOf(e.risk_ceiling) || ALWAYS_ASK.includes(risk)) return "Sensitive/high-risk actions require a separate specific authorization.";
  if (e.cross_app && action !== "provider.execute" && (!operationContract(action) || !stepId || !e.cross_app.operations.some(op => op.stepId === stepId && op.action === action && op.digest === agenticOperationDigest(action, params)))) return "Cross-app operation differs from the exact reviewed Mission step or postcondition.";
  try {
    const roots = e.permitted_resource_scopes;
    for (const root of roots) if (canonical(root.root) !== root.root || rootIdentity(root.root) !== root.identity) return "Approved root identity changed; fresh review required.";
    if (!withinAny(roots.map(r => r.root), cwd)) return "Agent working directory escaped the approved project.";
    if (action.startsWith("filesystem.")) {
      if (typeof params.path !== "string" && action !== "filesystem.list") return "Filesystem action has no concrete resource.";
      const path = canonical(resolve(cwd, typeof params.path === "string" ? params.path : "."));
      if (touchesGitMetadata(path) && action !== "filesystem.read" && action !== "filesystem.list" && action !== "filesystem.exists") return "Git metadata requires specific Git authority.";
      return roots.some(r => r.kind === "filesystem" && r.operations.includes(action) && withinAny([r.root], path)) ? null : "Filesystem resource or operation exceeds approved roots.";
    }
    if (action === "terminal.exec") {
      if (Object.keys(params).some(k => !["command", "args", "cwd", "timeoutMs"].includes(k))) return "Terminal environment or wrapper parameters were not approved.";
      const args = params.args ?? [];
      if (!Array.isArray(args) || args.some(a => typeof a !== "string")) return "Invalid terminal argv.";
      const at = typeof params.cwd === "string" ? canonical(resolve(cwd, params.cwd)) : canonical(cwd);
      const bound = e.commands.find(c => c.command === params.command && c.cwd === at && JSON.stringify(c.args) === JSON.stringify(args));
      if (!bound || !executable || executable.file !== bound.executable || JSON.stringify(executable.prefix) !== JSON.stringify(bound.prefix)
        || fileDigest(bound.executable) !== bound.executable_hash || fileDigest(bound.script) !== bound.script_hash
        || canonical(bound.script) !== bound.script || !withinAny(roots.map(r => r.root), bound.script)
        || bound.boundary !== "pure-read-check-v1" || JSON.stringify(boundedTestResources(bound.script, at, roots.map(r => r.root))) !== JSON.stringify(bound.test_resources)
        || !Number.isSafeInteger(params.timeoutMs ?? bound.timeout_ms) || Number(params.timeoutMs ?? bound.timeout_ms) < 1 || Number(params.timeoutMs ?? bound.timeout_ms) > bound.timeout_ms) return "Terminal executable, exact arguments, script identity, cwd or execution limit exceeds consent.";
      return null;
    }
    if (action.startsWith("git.")) {
      if (!["git.status", "git.diff", "git.log", ...(e.cross_app ? ["git.tracked_files", "git.branch", "git.commit_info"] : [])].includes(action)) return "Git mutation/hooks, push and branch changes require specific review.";
      if (Object.keys(params).some(k => !["cwd", "limit", ...(e.cross_app ? ["against", "ref"] : [])].includes(k))) return "Unapproved Git arguments.";
      const at = typeof params.cwd === "string" ? canonical(resolve(cwd, params.cwd)) : canonical(cwd);
      return roots.some(r => r.kind === "git" && r.root === at && r.operations.includes(action)) ? null : "Different repository or operation is outside consent.";
    }
    if (e.cross_app && action.startsWith("browser.")) {
      if (!e.browser_origins.length || !["browser.navigate", "browser.read", "browser.extract", "browser.metadata", "browser.wait", "browser.screenshot"].includes(action)) return "No bounded browser operation was approved; mutation/download requires separate review.";
      if (typeof params.url === "string") {
        const url = new URL(params.url);
        if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || !e.browser_origins.includes(url.origin)) return "Browser origin exceeds exact consent.";
      }
      return null;
    }
    if (e.cross_app && action.startsWith("computer.")) return calculatorOperation(action, params) ? null : "Only exact reviewed Calculator arithmetic operations are delegated.";
    if (action === "provider.execute") return params.provider === "ollama" && params.access === "read" && params.filesystem === false ? null : "Workspace provider tools cannot enforce this exact Agent resource/terminal scope; separate review required.";
    // Browser/desktop target validation stays with their existing specific approval path.
    return "This operation requires its existing specific resource/target approval boundary.";
  } catch { return "Resource identity could not be revalidated; authority fails closed."; }
}

/** Referenced file data is not executable identity; all resource/control parameters stay exact. */
export function agenticOperationDigest(action: string, params: Record<string, unknown>): string {
  const bound = { ...params };
  if (action === "filesystem.write") delete bound.content;
  return operationDigest(action, bound);
}

export function agenticFingerprint(action: string, params: Record<string, unknown>, cwd: string): string {
  const safe = { ...params };
  // Contents/model identity are not a new authorization boundary for the same resource/operation.
  for (const key of ["content", "text", "provider", "model", "prompt"]) delete safe[key];
  if (typeof safe.path === "string") safe.path = canonical(resolve(cwd, safe.path));
  return digest({ action, cwd: canonical(cwd), params: Object.fromEntries(Object.entries(safe).sort(([a], [b]) => a.localeCompare(b))) });
}

/** Extra approval can change provider/budget consent, never the child's declared access. */
export function providerScopeViolation(task: { provider?: ProviderId; mission?: { missionId: string; stepId: string } | null; executionScope?: ProviderExecutionScope; cwd?: string }, envelope: AuthorizationEnvelope, step?: Pick<MissionStep, "id" | "scope">, options: { desktopGrant?: boolean } = {}): string | null {
  if (!task.mission || task.mission.missionId !== envelope.missionId) return "child belongs to another mission";
  const authority = envelope.providers.sessions?.steps.find((item) => item.stepId === task.mission!.stepId);
  if (!authority || !task.executionScope) return "provider-session authority is missing; replan and approve again";
  if (step && (step.id !== task.mission.stepId || step.scope.access === "write" && authority.scope.access !== "write")) return "step exceeds approved provider-session authority";
  if (task.executionScope.access === "write" && (authority.scope.access !== "write" || step && step.scope.access !== "write")) return "child exceeds step or mission provider-session authority";
  if (!["read", "write"].includes(task.executionScope.access)) return "invalid child provider-session authority";
  if (task.executionScope.access === "write" && (!task.cwd || !withinAny(envelope.filesystem.write, task.cwd))) return "provider write authority exceeds approved write roots";
  // M-A-3 T9R-F01: the provider/tool actually launched decides, so no reroute, retry or model switch widens it.
  if (!options.desktopGrant) return remoteSessionViolation(task, envelope);
  return null;
}

/** Checks a child model task against the envelope before a delegated launch. */
export function taskViolation(task: { provider: ProviderId; cwd?: string; decision: { recommended_provider: ProviderId }; mission?: { missionId: string; stepId: string } | null; executionScope?: ProviderExecutionScope }, envelope: AuthorizationEnvelope, local: boolean, externalCallsUsed: number, now = Date.now(), step?: Pick<MissionStep, "id" | "scope">, sessionsUsed = 0): string | null {
  if (envelope.revokedAt) return "authorization revoked";
  if (envelope.expiresAt <= now) return "authorization expired";
  if (!envelope.providers.execution) return "provider execution was not approved";
  if (envelope.providers.allow && !envelope.providers.allow.includes(task.provider)) return `${task.provider} is outside the approved providers`;
  if (envelope.providers.localOnly && !local) return "mission is local-only and this provider runs in the cloud";
  if (!local && externalCallsUsed >= envelope.budget.maxExternalModelCalls) return `external model call budget (${envelope.budget.maxExternalModelCalls}) exhausted`;
  if (!task.cwd || !withinAny(envelope.projectRoots, task.cwd)) return `working folder ${task.cwd ?? "unknown"} is outside the approved project roots`;
  if (task.mission) {
    const outside = providerScopeViolation(task, envelope, step);
    if (outside) return outside;
    if (sessionsUsed >= envelope.providers.sessions!.maxSessions) return "provider-session budget exhausted";
  }
  return null;
}
