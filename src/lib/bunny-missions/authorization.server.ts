import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { closeSync, existsSync, lstatSync, openSync, readdirSync, readFileSync, readSync, realpathSync, statSync, type Dirent } from "node:fs";
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
const DEVICE_HIDDEN_KEYS = new Set(["desktopGrant", "desktopOperation", "desktopBinding", "promotion"]);
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
    // M-A-3 T9R-F02 (D1): the extension is only the first filter; the destination's purpose decides (configuration,
    // agent instructions, execution-relevant or unknown roles need the Windows Host).
    const purpose = deviceWriteClassRefusal(params.path, cwd ?? dirname(path), action === "filesystem.write" ? "write" : "delete", typeof params.content === "string" ? params.content : null);
    if (purpose) return purpose;
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

// ── M-A-3 T9R-F02 (D1): purpose-aware classification of paired-device file writes ─────────────────────────
/**
 * What a paired device may write into a project. Only the two PHONE_SAFE classes ever receive phone-write
 * authority; everything else needs the Windows Host. The classification judges the destination's verified
 * context (canonical path, directory roles, link and hard-link state, existing content and project metadata)
 * and the new content's leading bytes. It is risk reduction, never a proof that content is harmless: any
 * program can be pointed at any file, which is why device changes also go through inert staging (D2).
 */
export type DeviceWriteClass = "PHONE_SAFE_DOCUMENT" | "PHONE_SAFE_DATA" | "EXECUTION_RELEVANT" | "CONFIGURATION" | "AGENT_INSTRUCTIONS" | "UNKNOWN";
export type DeviceWriteClassification = { classification: DeviceWriteClass; reasons: string[]; warnings: string[] };
export const PHONE_SAFE_CLASSES: readonly DeviceWriteClass[] = ["PHONE_SAFE_DOCUMENT", "PHONE_SAFE_DATA"];
const DOCUMENT_FILE = /\.(md|markdown|txt|text)$/i;
const DATA_FILE = /\.(csv|tsv|jsonl|ndjson|log)$/i;
const STRUCTURED_DATA_FILE = /\.(json|ya?ml)$/i;
const AGENT_INSTRUCTION_FILE = /^(agents?(\.override)?\.md|claude(\.local)?\.md|gemini\.md|qwen\.md|warp\.md|crush\.md|opencode\.md|kilocode\.md|cody\.md|conventions\.md|skill\.md|copilot-instructions\.md|\.mcp\.json|\.cursorrules|\.windsurfrules|\.clinerules|\.goosehints|\.aider[\w.-]*|llms(-full)?\.txt|[^/\\]+\.(prompt|instructions|chatmode|agent)\.md|[^/\\]+\.mdc)$/i;
const AGENT_INSTRUCTION_DIR = /^(\.claude|\.cursor|\.codex|\.gemini|\.continue|\.clinerules|\.windsurf|\.roo|\.kiro|\.aider|\.grok|\.agents?|agents?|\.?skills|\.?prompts|\.?rules|\.?instructions|\.?chatmodes|\.amazonq|\.junie|\.opencode|\.cline|\.augment|\.qwen|\.warp|\.trae|\.crush|\.goose|\.agent|\.specify|\.amp|\.zed|\.codebuddy|\.kilocode|\.tabnine|\.sourcegraph|\.copilot)$/i;
const EXECUTION_DIR = /^(\.git|git~\d+|\.husky|\.githooks|hooks|bin|scripts?|node_modules|\.github|\.gitlab|\.circleci|\.buildkite|\.azure-pipelines|\.woodpecker|\.forgejo|\.gitea|\.vscode|\.devcontainer|\.idea|\.cargo|\.yarn|\.mvn|\.gradle|\.venv|venv|__pycache__)$/i;
/** Folders a running dev server, bundler, test runner or framework watches, serves or imports from. */
const WATCHED_SOURCE_DIR = /^(src|app|lib|pages|components|server|api|public|static|assets|routes|test|tests|__tests__|spec|e2e|fixtures|migrations|prisma|db|include|cmd|pkg|internal|content|plugins|middleware|functions|netlify|supabase|layouts|styles|views|templates)$/i;
const CONFIG_DIR = /^(config|\.config|configs|settings|conf|\.settings|etc|env|environments)$/i;
const DATA_DIR = /^(data|datasets|docs|doc|notes|reports|exports|documents|journal|inbox|records|logs)$/i;
const CONSUMED_TEXT_FILE = /^([\w.-]*(requirements|constraints)[\w.-]*\.txt|runtime\.txt|cmakelists\.txt|dependencies\.txt|packages\.txt|apt\.txt|robots\.txt|ads\.txt|security\.txt|humans\.txt)$/i;
/**
 * Files whose text names the commands, includes and inputs that tools, CI pipelines and agents use (bounded read,
 * never executed). Review round 4: agent instruction files (@-imports), CI pipeline roots and nested package
 * manifests are consumers too.
 */
const CONSUMER_FILE = /^(package\.json|makefile|gnumakefile|justfile|taskfile\.ya?ml|pyproject\.toml|setup\.cfg|setup\.py|tox\.ini|noxfile\.py|pipfile|gemfile|rakefile|cargo\.toml|go\.mod|pom\.xml|build\.gradle(\.kts)?|settings\.gradle(\.kts)?|cmakelists\.txt|dockerfile|containerfile|(docker-)?compose\.ya?ml|vercel\.json|netlify\.toml|firebase\.json|wrangler\.toml|deno\.jsonc?|tsconfig[\w.-]*\.json|jsconfig\.json|turbo\.json|nx\.json|project\.json|lerna\.json|pnpm-workspace\.yaml|jenkinsfile|\.gitlab-ci\.ya?ml|azure-pipelines\.ya?ml|bitbucket-pipelines\.ya?ml|\.travis\.ya?ml|appveyor\.ya?ml|\.drone\.ya?ml|buildspec\.ya?ml|appspec\.ya?ml|cloudbuild\.ya?ml|codemagic\.ya?ml|\.woodpecker\.ya?ml|\.pre-commit-config\.ya?ml|\.?lefthook\.ya?ml|mkdocs\.ya?ml|_config\.ya?ml|hugo\.(toml|ya?ml|json)|book\.toml|[^/\\]+\.config\.[cm]?[jt]s|[^/\\]+\.conf\.[cm]?[jt]s|\.[\w-]+rc(\.[\w]+)?|\.env(\.[\w.-]+)?|[^/\\]+\.(csproj|vbproj|fsproj|vcxproj|sln|props|targets))$/i;
/** Dot-folders that hold caches, environments, downloaded tools or build output rather than instructions (not scanned). */
const CACHE_DIR = /^(\.git|\.venv|\.tox|\.nox|\.mypy_cache|\.pytest_cache|\.ruff_cache|\.cache|\.parcel-cache|\.next|\.nuxt|\.svelte-kit|\.turbo|\.angular|\.expo|\.output|\.docusaurus|\.vercel|\.netlify|\.wrangler|\.serverless|\.terraform|\.gradle|\.yarn|\.pnpm-store|\.vs|\.vscode-test|\.nyc_output|\.hypothesis|\.ipynb_checkpoints|\.trash|\.stversions|\.godot|\.stack-work|\.build|\.nx|\.dart_tool|\.sass-cache|\.hg|\.svn|\.cxx|\.zig-cache|\.kotlin|\.m2|\.npm|\.pub-cache|\.bundle)$/i;
/** Folders anywhere in the project that hold dependencies or build output (not scanned for consumers). */
const SKIPPED_DIR = /^(node_modules|bower_components|jspm_packages|vendor|site-packages|__pycache__|venv|dist|out|build|target|coverage|test-results|playwright-report|artifacts|releases?)$/i;
/** Files that are not text a tool reads as instructions: binaries, media, databases and lock files (not scanned). */
const OPAQUE_FILE = /(\.(png|jpe?g|gif|ico|icns|webp|bmp|tiff?|svgz|pdf|zip|gz|tgz|bz2|xz|7z|rar|jar|war|whl|woff2?|ttf|otf|eot|mp[34]|wav|ogg|flac|mov|avi|mkv|webm|exe|dll|so|dylib|bin|obj|o|a|lib|pdb|class|pyc|wasm|node|sqlite3?|db|mdb|accdb|docx?|xlsx?|pptx?|odt|ods|parquet|feather|h5|npy|npz|pkl|heic|heif|avif|m4a|aac|opus|amr|epub|mobi|psd|ai|eps|indd|key|pages|numbers|one|kdbx|gpg|msi|dmg|pkg|deb|rpm|apk|ipa|appx|msix|iso|sketch|fig|html?|svg)(-wal|-shm|-journal)?|\.lock|-lock\.ya?ml|-lock\.json|shrinkwrap\.json|\.sample|^\.ds_store|^thumbs\.db|^desktop\.ini)$/i;
/** Files whose presence in a folder means a tool runs or is configured there, so it may process the folder's documents. */
const PROGRAM_OR_TOOL_FILE = /(\.(py|pyw|[cm]?[jt]sx?|rb|sh|bash|zsh|ps1|psm1|bat|cmd|go|rs|java|kt|cs|fs|vb|php|pl|lua|r|ipynb|toml|ini|cfg|conf|mk|gradle|props|targets|csproj|sln)|^(makefile|gnumakefile|justfile|dockerfile[\w.-]*|containerfile|procfile[\w.-]*|rakefile|gemfile|jenkinsfile|earthfile|tiltfile|caddyfile|vagrantfile))$/i;
/** Shell, CI, build and install files that are read wherever they are in the project (review F03 round 1). */
const TREE_CONSUMER = /(\.(sh|bash|zsh|ps1|psm1|bat|cmd|mk|ya?ml|toml|cfg|ini)|^(makefile|gnumakefile|justfile|dockerfile[\w.-]*|containerfile|procfile[\w.-]*|jenkinsfile|earthfile|tiltfile|package\.json|[\w.-]*(requirements|constraints)[\w.-]*\.(txt|in)))$/i;
/** Consumers whose text is run by a shell (where a bare argument or a computed glob means a path). */
const SHELL_RUN = /^(makefile|gnumakefile|justfile|taskfile\.ya?ml|dockerfile[\w.-]*|containerfile|procfile[\w.-]*|jenkinsfile|earthfile|package\.json|[^/]*\.(ya?ml|sh|bash|zsh|ps1|psm1|cmd|bat|mk)|[^.]*)$/i;
/** Ignore lists and editor state name paths but run nothing, so they are not consumers. */
const NON_CONSUMER = /^(\.gitignore|\.dockerignore|\.npmignore|\.prettierignore|\.eslintignore|\.stylelintignore|\.gitattributes|\.obsidian)$/i;
const CONFIG_TEXT = /\.(ya?ml|json|jsonc|toml|md|mdc|txt|sh|bash|ps1|psm1|cmd|bat|[cm]?[jt]s|py|cfg|ini|xml|conf|env|properties|rules)$/i;
const CONSUMER_READ_LIMIT = 1024 * 1024;
/** Notebooks carry large outputs; their cell sources are read up to this size. */
const NOTEBOOK_READ_LIMIT = 64 * 1024 * 1024;
const CONSUMER_BUDGET = 2000;
const CONSUMER_DEPTH = 32;
type Consumer = { by: string; agent: boolean; folder?: boolean } | { unknown: string };
/** Lowercased, "/"-separated, with "./", repeated separators and percent-encoded separators collapsed. */
function referenceText(text: string): string {
  // JSON and JavaScript escapes (\u002f) spell the same path.
  const decode = (hex: string) => { const code = parseInt(hex, 16); return code <= 0x10ffff ? String.fromCodePoint(code) : ""; };
  let out = text.replace(/\\u\{([0-9a-fA-F]{1,6})\}|\\u([0-9a-fA-F]{4})|\\x([0-9a-fA-F]{2})/g, (_, braced?: string, four?: string, two?: string) => decode(braced ?? four ?? two ?? "")).toLowerCase().replaceAll("\\\\", "/").replaceAll("\\", "/").replace(/%2f|%5c/g, "/");
  for (let previous = ""; previous !== out;) { previous = out; out = out.replaceAll("/./", "/").replace(/\/{2,}/g, "/"); }
  return out;
}
const NUL = String.fromCharCode(0);
/** UTF-8, or UTF-16 with or without a BOM; UTF-32 and any other NUL-bearing text cannot be checked (null). */
function consumerText(bytes: Buffer): string | null {
  const wide = (text: string) => (text.includes(NUL) ? null : text);
  if (bytes.length >= 4 && ((bytes[0] === 0xff && bytes[1] === 0xfe && bytes[2] === 0 && bytes[3] === 0) || (bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 0xfe && bytes[3] === 0xff))) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return wide(bytes.subarray(2).toString("utf16le"));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) { const body = Buffer.from(bytes.subarray(2, 2 + ((bytes.length - 2) & ~1))); return wide(body.swap16().toString("utf16le")); }
  if (!bytes.includes(0)) return bytes.toString("utf8");
  // UTF-16 without a BOM: every other byte is zero.
  const even = bytes.length & ~1; let oddZero = 0; let evenZero = 0;
  for (let i = 0; i < even; i += 2) { if (bytes[i] === 0) evenZero++; if (bytes[i + 1] === 0) oddZero++; }
  if (even >= 4 && oddZero * 2 >= even / 2 * 1.8) return wide(bytes.subarray(0, even).toString("utf16le"));
  if (even >= 4 && evenZero * 2 >= even / 2 * 1.8) return wide(Buffer.from(bytes.subarray(0, even)).swap16().toString("utf16le"));
  return null;
}
/** True when `token` occurs in `text` with no name character (letter, digit, _ or -) directly before or after it. */
function tokenIn(text: string, token: string): boolean {
  if (!token) return false;
  for (let at = text.indexOf(token); at >= 0; at = text.indexOf(token, at + 1))
    if (!/[a-z0-9_-]/.test(text[at - 1] ?? "") && !/[a-z0-9_-]/.test(text[at + token.length] ?? "")) return true;
  return false;
}
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&");
/**
 * Whether `text` names `folder` as a folder (review F03 round 1). Counted: a path into it with a glob, variable,
 * quote or command part (docs/*.txt, ci/reqs-$(ENV).txt, docs/'x.txt'), the folder path itself (docs/, docs/**), a
 * whole quoted value that is not a key ("docs", but not "docs": ...), an option or setting value (--source=site,
 * testpaths = docs, D: docs), a list item ([docs], {ci,tests}, - docs), and, in shell-run text, a bare argument.
 * Not counted: a bare word in prose, comments or descriptions, or a path to another literal file in the folder.
 */
function folderRef(text: string, folder: string, shell: boolean): boolean {
  const f = escapeRegExp(folder);
  const name = "(?<![a-z0-9_.-])";
  const forms = [
    // A glob, variable or command part, or a quote that splits the path (docs/'x.txt'); a closing quote is not one.
    String.raw`${name}${f}/[^\s'"\x60]*?(?:[*?\[{$%]|['"\x60](?=[^\s,;)\]}'"\x60]))`,
    String.raw`${name}${f}(?:/(?=[\s'",;)\]}]|$)|(?=[*?\[]))`,
    String.raw`['"\x60]${f}/?['"\x60](?![ \t]*:)`,
    String.raw`(?:=|:)[ \t]*['"]?${f}/?['"]?(?=[\s,;)\]}]|$)`,
    String.raw`[\[{,(][ \t]*['"]?${f}/?['"]?[ \t]*(?=[,\])}])`,
    String.raw`^[ \t]*-[ \t]+['"]?${f}/?['"]?[ \t]*$`,
  ];
  // A bare shell argument; a word followed by = or : is an assignment or a key, not an argument.
  if (shell) forms.push(String.raw`(?<=[ \t])${f}(?=[ \t]|$)(?![ \t]*[=:])`);
  return forms.some((source) => new RegExp(source, "m").test(text));
}
/** Tools that only read, format or lint files: a glob of the extension on their line does not run anything. */
const READ_ONLY_PROGRAM = /^(prettier|markdownlint(-cli2?)?|eslint|stylelint|cspell|remark(-cli)?|alex|write-good|vale|textlint|editorconfig-checker|dprint|biome|typos|codespell|lychee|markdown-link-check|wc|grep|rg|ls)$/;
/**
 * T9R-F04 F03 follow-up (F03-FOLLOWUP-1 and its three verification rounds): the read-only exemption fails closed. It
 * applies only on a line nothing can hide in — no substitution, variable, redirection, subshell or quoted separator,
 * with an unquoted trailing comment set aside by a quote-aware scan — so splitting the line on separators is exact.
 * Within a statement EVERY pipeline stage must be a bare read-only program (no path, no environment assignment) whose
 * options are allow-listed and whose arguments name no program, plugin, script or path.
 */
const UNSAFE_SHELL_LINE = /[$`<>()\\]|"[^"]*[;&|][^"]*"|'[^']*[;&|][^']*'/;
/** Options a read-only statement may carry: an allow-list, so an option that loads a program, plugin, rule or config never passes. */
const SAFE_OPTION = /^(-[lwnirvqsLH]+|--(write|check|list-different|fix|quiet|no-progress|stat|name-only|name-status|cached|count|files-with-matches|no-color|color|dot|cache|verbose|silent|recursive|ignore-unknown|no-error-on-unmatched-pattern|ignore|ignore-path|ignore-pattern|log-level|loglevel|max-warnings|print-width|tab-width|use-tabs|prose-wrap|end-of-line|single-quote|no-semi)(=[^/]*)?)$/;
const PATH_OR_SCRIPT = /[/]|\.(m?[jt]sx?|cjs|cts|sh|bash|zsh|py|rb|pl|php|ps1|psm1|exe|cmd|bat|lua)$/;
function readOnlyStatement(statement: string, line: string): boolean {
  if (UNSAFE_SHELL_LINE.test(line)) return false;
  return statement.split("|").every((segment) => {
    let words = segment.trim().split(/\s+/).filter(Boolean).map((word) => word.replace(/^["']|["']$/g, ""));
    if (["npx", "bunx", "pnpx"].includes(words[0] ?? "")) words = words.slice(1);
    else if (["npm", "pnpm", "yarn"].includes(words[0] ?? "") && ["exec", "dlx"].includes(words[1] ?? "")) words = words.slice(words[2] === "--" ? 3 : 2);
    const program = words[0];
    let args = words.slice(1);
    if (!program || /[/=]/.test(program)) return false;
    // git only as exactly "git add" / "git diff" (single space; review verification NEW-7).
    if (program === "git") { if (!/^(?:\S+ )*?git (add|diff)(\s|$)/.test(segment.trim()) || (args[0] !== "add" && args[0] !== "diff")) return false; args = args.slice(1); }
    else if (!READ_ONLY_PROGRAM.test(program)) return false;
    return args.every((arg) => (arg.startsWith("-") ? SAFE_OPTION.test(arg) : /[*?[{]/.test(arg) || !PATH_OR_SCRIPT.test(arg)));
  });
}
/**
 * Quote-aware scan of one line: the code before an unquoted trailing comment, and whether a quote stays open at the
 * end of the line. `#` starts a comment only at a word start; PowerShell <# #> markers are never treated as comments.
 */
function scanLine(line: string, hashComments: boolean): { code: string; open: boolean } {
  let quote = "";
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) { if (c === quote) quote = ""; else if (c === "\\" && quote === "\"") i++; continue; }
    if (c === "\\") { i++; continue; }
    if (c === "\"" || c === "'") { quote = c; continue; }
    if (hashComments && c === "#" && line[i + 1] !== ">" && (i === 0 || (/\s/.test(line[i - 1]) && line[i - 1] !== "<"))) return { code: line.slice(0, i), open: false };
  }
  return { code: line, open: !!quote };
}
/** Files whose `#` starts a comment. Not cmd/bat, and not package.json: npm runs scripts with cmd.exe on Windows. */
const hashCommentFile = (name: string) => !/\.(cmd|bat)$|^package\.json$/i.test(name);
/**
 * Whether any shell statement in this consumer can span physical lines (backslash, caret or backtick line ends, an
 * open quote, a YAML folded or multi-line plain scalar, a multi-line package.json script). Lines are judged one by
 * one, so such a file gets no read-only exemption at all (F03 follow-up verifications 2-3). Judged on the raw text.
 * YAML literal blocks (run: |) keep their newlines, so each of their lines is its own shell line.
 */
function statementsSpanLines(name: string, raw: string): boolean {
  if (/^package\.json$/i.test(name)) {
    try { const scripts = (JSON.parse(raw) as { scripts?: Record<string, unknown> }).scripts; return !!scripts && typeof scripts === "object" && Object.values(scripts).some((value) => typeof value === "string" && /[\r\n]/.test(value)); } catch { return true; }
  }
  const yaml = /\.ya?ml$/i.test(name), hash = hashCommentFile(name);
  const shellSpans = (line: string) => { const { code, open } = scanLine(line, hash); return open || /[\\^`]$/.test(code.trimEnd()); };
  if (!yaml) return raw.split(/\r?\n/).filter((line) => !commentLine(name, line)).some(shellSpans);
  let literalIndent = -1, lastIndent = 0;
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const indent = line.length - line.trimStart().length;
    if (literalIndent >= 0 && indent > literalIndent) { if (shellSpans(line.trimStart())) return true; continue; }
    literalIndent = -1;
    const trimmed = line.trim();
    if (trimmed.startsWith("#")) continue;
    const code = scanLine(trimmed, true).code.trimEnd();
    if (/(^|[:-]\s*)\|[-+0-9]*$/.test(code)) { literalIndent = indent; lastIndent = indent; continue; }
    if (/(^|[:-]\s*)>[-+0-9]*$/.test(code)) return true;
    if (!/^(-(\s|$)|[[{]|[^\s:]+:(\s|$))/.test(trimmed) && indent > lastIndent) return true;
    if (shellSpans(yamlValue(trimmed))) return true;
    lastIndent = indent;
  }
  return false;
}
/** The value part of a YAML line ("- run: npx prettier ..." → "npx prettier ..."). */
const yamlValue = (line: string) => line.replace(/^\s*(-\s+)?([\w.-]+:\s+)?/, "");
/** Full-line comments: rem/:: only in cmd/bat (rem=1 is an sh assignment); a PowerShell #> line is code. */
function commentLine(name: string, line: string): boolean {
  // cmd.exe ends REM only at a delimiter (space, tab, comma, semicolon, equals) or the line end: "rem:x & node" runs.
  if (/\.(cmd|bat)$/i.test(name)) return /^[ \t]*@?(rem([ \t,;=]|$)|::)/i.test(line);
  return /\.psm?1$/i.test(name) ? /^[ \t]*#(?!>)/.test(line) : /^[ \t]*#/.test(line);
}
/** Brace expansion as bash does it (nested, comma lists), bounded; null when it would exceed the bound. */
function expandBraces(word: string, limit = 64): string[] | null {
  const open = word.indexOf("{");
  if (open < 0) return [word];
  let depth = 0, close = -1; const commas: number[] = [];
  for (let i = open; i < word.length; i++) {
    if (word[i] === "{") depth++;
    else if (word[i] === "}") { depth--; if (depth === 0) { close = i; break; } }
    else if (word[i] === "," && depth === 1) commas.push(i);
  }
  if (close < 0) return [word];
  if (!commas.length) { const rest = expandBraces(word.slice(close + 1), limit); return rest && rest.map((tail) => word.slice(0, close + 1) + tail); }
  const out: string[] = []; let start = open + 1;
  for (const end of [...commas, close]) {
    const expanded = expandBraces(word.slice(0, open) + word.slice(start, end) + word.slice(close + 1), limit);
    if (!expanded) return null;
    out.push(...expanded); start = end + 1;
    if (out.length > limit) return null;
  }
  return out;
}
/**
 * A word that names a file of the destination's extension by a computed, quoted, aliased, braced or pattern form
 * ($N.md, %N%.md, $(echo n).md, %.md, "notes".md, notes.md., ARCHIT~1.MD, notes.m{d,}, {a,b}.md) or that globs a
 * whole folder (./*, **). The classifier does not evaluate these, so they count (review verifications 2-3).
 */
function computedName(word: string, extension: string, leaf: string): boolean {
  const cleaned = word.replace(/["']/g, "");
  const trimmed = cleaned.replace(/[.\s]+$/, "");
  // Quoted ("notes".md) or trailing-dot (notes.md.) spellings of the name; the plain literal is caught by tokenIn.
  if (trimmed === leaf && trimmed !== word) return true;
  if (/(^|\/)\*\*?$/.test(cleaned) && (cleaned.includes("/") || cleaned === "**")) return true;
  if (cleaned.includes("{")) {
    const expanded = expandBraces(cleaned);
    if (!expanded) return true;
    if (expanded.some((form) => form !== cleaned && ((form.split("/").pop() ?? "") === leaf || globNamesLeaf(form, leaf)))) return true;
    if (extension && /\{[^}]*,[^}]*\}/.test(cleaned) && new RegExp(`(^|[^a-z0-9])${escapeRegExp(extension)}([^a-z0-9]|$)`).test(cleaned)) return true;
  }
  return !!extension && trimmed.endsWith(`.${extension}`) && /[$%{}()*?[\]~`"']/.test(word);
}
/** A shell glob word whose last segment matches the destination's file name (n*, *.m?, *.m[d], *.{md,txt}). */
function globNamesLeaf(word: string, leaf: string): boolean {
  const last = word.replace(/^["']|["']$/g, "").split("/").pop() ?? "";
  if (!/[*?[]/.test(last) || last === "*" || last === "**") return false;
  // Forms this translation does not model exactly fail closed: nested braces, a class opening with ], POSIX classes.
  if (/\{[^}]*\{/.test(last) || /\[!?\][^\]]*\]/.test(last) || /\[\[?[:.=]/.test(last)) return true;
  let pattern = "";
  for (let i = 0; i < last.length; i++) {
    const c = last[i];
    if (c === "*") pattern += "[^/]*";
    else if (c === "?") pattern += "[^/]";
    else if (c === "[") { const close = last.indexOf("]", i + 2); if (close < 0) { pattern += "\\["; continue; } pattern += "[" + last.slice(i + 1, close).replace(/^!/, "^").replace(/\\/g, "\\\\") + "]"; i = close; }
    else if (c === "{") { const close = last.indexOf("}", i); if (close < 0) { pattern += "\\{"; continue; } pattern += "(?:" + last.slice(i + 1, close).split(",").map(escapeRegExp).join("|") + ")"; i = close; }
    else pattern += escapeRegExp(c);
  }
  try { return new RegExp(`^${pattern}$`).test(leaf); } catch { return true; }
}
/**
 * Raw-text names hidden by shell or cmd escapes (n\otes.md, notes\.md, notes.m^d). Reference normalisation turns
 * every backslash into a separator, so these are checked on the raw consumer text (review verification 3, V5/V7).
 */
function escapedName(raw: string, extension: string, leaf: string): boolean {
  return raw.split(/[\s;&|<>()=]+/).some((word) => {
    if (!/[\\^]/.test(word)) return false;
    // Both readings: sh (backslash escapes, / separates) and cmd (caret escapes, backslash separates). The last path
    // segment is judged, so folder-qualified escapes (zq/ho\ld.md, zq\ho^ld.md) count (review verification 4).
    const readings = [word.replace(/\\(.)/g, "$1"), word.replace(/\^(.)/g, "$1").replaceAll("\\", "/")];
    return readings.some((reading) => {
      const plain = reading.replace(/["']/g, "").toLowerCase().replace(/[.\s]+$/, "");
      const last = plain.split("/").pop() ?? "";
      return last === leaf || globNamesLeaf(plain, leaf) || computedName(last, extension, leaf);
    });
  });
}
/** The raw script and lint-staged command strings of a package.json (JSON escapes decoded), or the text itself. */
function packageScripts(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { scripts?: Record<string, unknown>; "lint-staged"?: Record<string, unknown> };
    return [...Object.values(parsed.scripts ?? {}), ...Object.values(parsed["lint-staged"] ?? {}).flat()].filter((value) => typeof value === "string").join("\n");
  } catch { return raw; }
}
/** Execution context on a line: a glob of the destination's extension here is run, collected or sourced. */
const RUNS_GLOB = /(doctest|wildcard|\bfor\b.*\bin\b|\b(sh|bash|zsh|source|python3?|py|node|deno|bun|pwsh|powershell|cmd|exec|eval|xargs|pip|pytest|ruby|perl|php)\b)/;
/** Config keys that collect or run matching files without a runner word (pytest python_files, tox commands). */
const COLLECTS_GLOB = /\b(python_files|python_classes|commands|commands_pre|commands_post)\b/;
/** Source files: a glob of the destination's extension anywhere in one collects those files for the program. */
const PROGRAM_SOURCE = /\.(py|pyw|[cm]?[jt]sx?|rb|pl|php|lua|go|rs|ps1|psm1)$/i;
/** package.json keys that name files but never run them. */
const INERT_PACKAGE_KEYS = new Set(["name", "version", "description", "keywords", "files", "license", "author", "contributors", "maintainers", "repository", "homepage", "bugs", "funding", "dependencies", "devDependencies", "peerDependencies", "peerDependenciesMeta", "optionalDependencies", "bundleDependencies", "bundledDependencies", "overrides", "resolutions", "engines", "os", "cpu", "private", "publishConfig", "type", "types", "typings", "workspaces", "browserslist", "packageManager", "sideEffects", "lint-staged"]);
/**
 * Lines a shell actually runs: comments dropped; for package.json the scripts plus lint-staged entries (as
 * "command glob"), parsed from the raw text (reference normalisation rewrites JSON escapes such as \" and would make
 * the parse fail; T9R-F04 F03 follow-up).
 */
function shellLines(name: string, text: string, raw: string = text): string {
  if (/^package\.json$/i.test(name)) {
    try {
      const parsed = JSON.parse(raw) as { scripts?: Record<string, unknown>; "lint-staged"?: Record<string, unknown> };
      const lines = parsed.scripts && typeof parsed.scripts === "object" ? Object.values(parsed.scripts).filter((value): value is string => typeof value === "string") : [];
      const staged = parsed["lint-staged"];
      if (staged && typeof staged === "object") for (const [glob, command] of Object.entries(staged)) for (const each of Array.isArray(command) ? command : [command]) lines.push(typeof each === "string" ? `${each} ${glob}` : `(lint-staged ${glob})`);
      return referenceText(lines.join("\n"));
    } catch { return text; }
  }
  return text.split("\n").filter((line) => !commentLine(name, line)).join("\n");
}
/**
 * The project file that may consume this destination, or why that cannot be checked (F02 rounds 4-5, F03 round 1).
 * Consumers:
 * - every non-document file in the project root and in each folder above the destination;
 * - shell, CI, build, container and install files anywhere in the project (dependency and build-output folders
 *   skipped), and agent instruction files anywhere;
 * - every text file inside the project's dot-folders (caches excluded) and Git hooks in .git/hooks;
 * - a root or ancestor .txt that carries package-installer directives.
 * A consumer references the destination when its normalized text contains the destination path (root-relative or
 * relative to the consumer's folder), the file name as a token, a folder above the destination as a folder (see
 * folderRef), or, on a line that runs or collects files, a glob of the destination's extension. Agent instruction
 * files count exact paths and file names only. A folder below the root that also holds a program or tool file is
 * one some tool works in. Oversize, unreadable, binary-looking or linked consumers, too many consumers or too deep a
 * tree fail closed.
 */
function consumerOf(root: string, rel: string): Consumer | null {
  const relText = referenceText(rel);
  const parts = relText.split("/").filter(Boolean);
  const leaf = parts.at(-1) ?? "";
  const extension = /\.([a-z0-9]+)$/.exec(leaf)?.[1] ?? "";
  // A glob that can match the destination's extension: *.md, **/*.md, *.{md,txt}, *.*, and (for a root file or with **/) a bare *.
  const extensionGlob = extension ? new RegExp(String.raw`\*[^\s'"\x60]*\.(?:${escapeRegExp(extension)}(?![a-z0-9])|\*|\{[^}\s]*\b${escapeRegExp(extension)}\b[^}\s]*\})`) : null;
  const bareGlob = new RegExp(String.raw`(?:^|[\s'"=(])${parts.length === 1 ? "(?:\\*\\*/)?" : "\\*\\*/"}\*(?:\.\*)?(?=[\s'";)|&]|$)`);
  let budget = CONSUMER_BUDGET;
  const seen = new Set<string>();
  // An agent-instruction reference is the stronger label: a tool reference is remembered while the scan looks for one.
  let toolReference: Consumer | null = null;
  const settle = (found: Consumer | null): Consumer | null => {
    if (!found) return null;
    if ("unknown" in found || found.agent) return found;
    toolReference ??= found;
    return null;
  };
  // `automatic`: run without anyone choosing to (root and ancestor files, dot-folder CI, hook and editor files, Git hooks),
  // where a computed glob can reach any folder; elsewhere in the tree only references are matched.
  const check = (file: string, shown: string, folderParts: string[], agent: boolean, skipBinary = false, automatic = true): Consumer | null => {
    const key = file.toLowerCase();
    if (seen.has(key)) return null;
    seen.add(key);
    let info: ReturnType<typeof lstatSync>;
    try { info = lstatSync(file); } catch { return null; }
    if (info.isSymbolicLink()) return { unknown: `${shown} is a link, so its references cannot be checked` };
    if (!info.isFile()) return null;
    if (--budget < 0) return { unknown: "too many project files could consume this file to check them all" };
    let bytes: Buffer;
    try {
      if (info.size > CONSUMER_READ_LIMIT && !(/\.ipynb$/i.test(file) && info.size <= NOTEBOOK_READ_LIMIT)) {
        // A large binary in a dot-folder is skipped; a large text consumer cannot be checked.
        const head = Buffer.alloc(8192); const fd = openSync(file, "r");
        try { readSync(fd, head, 0, head.length, 0); } finally { closeSync(fd); }
        if (skipBinary && head.includes(0) && consumerText(head) === null) return null;
        return { unknown: `${shown} is too large to check for references` };
      }
      bytes = readFileSync(file);
    } catch { return { unknown: `${shown} could not be read` }; }
    let raw = consumerText(bytes);
    // A notebook is read as its cell sources (outputs can be large and are not run).
    if (raw !== null && /\.ipynb$/i.test(file)) {
      try { raw = ((JSON.parse(raw) as { cells?: { source?: string | string[] }[] }).cells ?? []).map((cell) => (Array.isArray(cell.source) ? cell.source.join("") : cell.source ?? "")).join("\n"); }
      catch { return { unknown: `${shown} is not a readable notebook, so its references cannot be checked` }; }
    }
    // A binary-looking file that may be skipped is still searched as NUL-stripped text (review F03 round 3).
    if (raw === null && skipBinary) raw = bytes.toString("latin1").replaceAll(NUL, "");
    if (raw === null) return { unknown: `${shown} is not readable text, so its references cannot be checked` };
    const name = shown.split("/").pop() ?? "";
    const shell = !agent && SHELL_RUN.test(name);
    // Shell-style computed globs ($(cmd)/*, $VAR/*, `cmd`*) can reach any folder: fail closed.
    if (shell && automatic && /(?:\$\([^)\n]*\)|`[^`\n]*`|\$\{?[a-z_][a-z0-9_]*\}?)\/?\*/i.test(raw)) return { unknown: `${shown} builds a path from a variable or command, so it cannot be checked` };
    const text = referenceText(raw);
    const depth = folderParts.length;
    const local = parts.slice(0, depth).join("/") === folderParts.join("/") ? parts.slice(depth).join("/") : relText;
    if ([local, relText].some((path) => path && text.includes(path)) || tokenIn(text, leaf)) return { by: shown, agent };
    if (agent) return null;
    const run = shell ? shellLines(name, text, raw) : text;
    for (let end = 1; end < parts.length; end++) {
      const folders = [parts.slice(0, end).join("/")];
      if (end > depth && parts.slice(0, depth).join("/") === folderParts.join("/")) folders.push(parts.slice(depth, end).join("/"));
      if (folders.some((folder) => folderRef(text, folder, false) || (shell && folderRef(run, folder, true)))) return { by: shown, agent };
    }
    // In shell-run text any glob of the extension counts unless the line names a read-only tool (an unknown runner
    // fails safe); elsewhere only on lines that visibly run or collect files (review F03 round 2).
    // Each simple command is judged on its own: a read-only tool earlier on the line does not exempt a later runner.
    // Statements split on sequencing only: a pipeline is judged whole, so a glob in a read-only stage feeding a runner
    // (ls *.md | xargs node r.js) counts. In shell-run text the exemption is decided per line by readOnlyStatement,
    // which refuses any line where a separator, redirection, comment or substitution could hide (F03-FOLLOWUP-1).
    const leafName = leaf.toLowerCase();
    // Names hidden by shell or cmd escapes are checked on the raw text (review verification 3, V5/V7).
    if (shell && escapedName(/^package\.json$/i.test(name) ? packageScripts(raw) : raw, extension, leafName)) return { by: shown, agent };
    // Config glob values: split on whitespace and quotes, drop key= prefixes, split comma lists outside braces.
    const words = (command: string) => command.split(/[\s"']+/).map((word) => word.replace(/^[\w.-]+=/, "")).flatMap((word) => word.split(/,(?![^{]*\})/)).filter(Boolean);
    const named = (command: string) => words(command).some((word) => word === "*" || word === "**" || globNamesLeaf(word, leafName) || computedName(word, extension, leafName));
    // Shell words keep their quotes ("notes".md is one word); an option=value word is also judged by its value.
    const shellNamed = (command: string) => command.split(/\s+/).filter(Boolean).flatMap((word) => [word, word.replace(/^-*[\w.-]+=/, "")]).some((word) => globNamesLeaf(word, leafName) || computedName(word, extension, leafName));
    if (!shell) {
      // Config text that runs or collects files (pytest doctest/python_files, tox commands, ...): any glob value naming
      // the destination counts, including n*, *.m?, [n]otes.md, braces and a lone * (review verifications 2-3).
      const commands = run.split(/\n|&&|\|\||;|&/);
      if (commands.some((command) => (RUNS_GLOB.test(command) || COLLECTS_GLOB.test(command)) && ((extensionGlob?.test(command) ?? false) || named(command)))) return { by: shown, agent };
      // A program source that globs the destination's name collects those files for itself, whatever line runs them.
      if (PROGRAM_SOURCE.test(name) && [...run.matchAll(/(["'`])([^"'`\n]{1,512})\1/g)].some(([, , literal]) => (extensionGlob?.test(literal) ?? false) || globNamesLeaf(literal, leafName))) return { by: shown, agent };
    } else {
      const spanning = statementsSpanLines(name, raw);
      const yaml = /\.ya?ml$/i.test(name), hash = hashCommentFile(name);
      // Make suffix rules (.md.html:) and .SUFFIXES apply a recipe to every file of the extension (verification 3, NB-2).
      if (extension && /^(gnu)?makefile$|\.mk$/i.test(name) && new RegExp(`^[ \\t]*(\\.suffixes[ \\t]*:.*\\.${escapeRegExp(extension)}\\b|\\.${escapeRegExp(extension)}(\\.[a-z0-9]+)?[ \\t]*:)`, "m").test(run)) return { by: shown, agent };
      // package.json content outside "scripts" and lint-staged (ava, jest, c8, ... map globs to runs) is checked for
      // globs on one line that can never be exempt (verification NEW-5); keys that only list files are inert.
      let rest = "";
      if (/^package\.json$/i.test(name)) {
        try { const other = Object.fromEntries(Object.entries(JSON.parse(raw) as Record<string, unknown>).filter(([key]) => key !== "scripts" && !INERT_PACKAGE_KEYS.has(key))); rest = Object.keys(other).length ? `\n(${referenceText(JSON.stringify(other))})` : ""; }
        catch { rest = `\n(${text})`; }
      }
      for (const physical of (run + rest).split("\n")) {
        const source = yaml ? yamlValue(physical) : physical;
        const { code } = scanLine(source, hash);
        // A comment is set aside only on a line where nothing can hide (no substitution, variable, block marker).
        const line = UNSAFE_SHELL_LINE.test(code) || /<#|#>/.test(source) ? source : code;
        for (const command of line.split(/&&|\|\||;|&/)) {
          // Any glob or computed word naming the destination counts, not only extension globs (n*, *.m?, $N.md).
          const globbed = (extensionGlob?.test(command) ?? false) || shellNamed(command);
          // A bare * counts only in a command that visibly runs or collects files (not arithmetic or prose).
          const bare = bareGlob.test(command) && RUNS_GLOB.test(command);
          if ((globbed || bare) && (spanning || line !== code || !readOnlyStatement(command, line))) return { by: shown, agent };
        }
      }
    }
    // pytest-markdown-docs collects every Markdown file under the test paths.
    if (/^(md|markdown)$/.test(extension) && text.includes("markdown-docs")) return { by: shown, agent };
    return null;
  };
  const followsToFolder = (path: string) => { try { return statSync(path).isDirectory(); } catch { return false; } };
  const linkedFolders = new Set<string>();
  // 1. The root and every folder above the destination: every non-document file is a consumer.
  for (let depth = 0; depth < parts.length; depth++) {
    const folderShown = parts.slice(0, depth).join("/");
    const folder = depth ? resolve(root, ...parts.slice(0, depth)) : root;
    let entries: Dirent[];
    try { entries = readdirSync(folder, { withFileTypes: true }); } catch (error) {
      // A folder the write would create holds no consumers (and neither do the folders below it).
      if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
      return { unknown: `${folderShown || "the project root"} could not be listed` };
    }
    for (const entry of entries) {
      const name = entry.name; const lower = name.toLowerCase();
      if (NON_CONSUMER.test(name) || entry.isDirectory()) continue;
      if (depth === parts.length - 1 && lower === leaf) continue;
      const path = resolve(folder, name);
      if (entry.isSymbolicLink() && followsToFolder(path)) continue;
      const shown = folderShown ? `${folderShown}/${name}` : name;
      const agent = AGENT_INSTRUCTION_FILE.test(name);
      if (depth > 0 && !agent && (PROGRAM_OR_TOOL_FILE.test(name) || CONSUMER_FILE.test(name))) { settle({ by: shown, agent: false, folder: true }); continue; }
      if (!agent) {
        if (OPAQUE_FILE.test(name)) continue;
        if (DATA_FILE.test(name)) continue;
        // A .txt is a consumer when it carries installer directives (pip -r chains); other documents are not.
        if (DOCUMENT_FILE.test(name) && !CONSUMED_TEXT_FILE.test(name)) {
          let directives = false;
          try { const info = lstatSync(path); const text = info.isFile() && info.size <= CONSUMER_READ_LIMIT ? consumerText(readFileSync(path)) : null;
            // A .txt with any directive is an install input; another document only when it is a requirements list
            // (every non-empty, non-comment line a directive or a requirement).
            const lines = (text ?? "").split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
            directives = text !== null && (/\.txt$/i.test(name) ? INSTALLER_DIRECTIVE.test(text) : lines.length > 0 && lines.every((line) => INSTALLER_DIRECTIVE.test(line) || REQUIREMENT_LINE.test(line)));
          } catch { directives = false; }
          if (!directives) continue;
        }
        // Structured data inside a data folder is data, not a consumer.
        if (depth > 0 && STRUCTURED_DATA_FILE.test(name) && !CONSUMER_FILE.test(name) && DATA_DIR.test(parts[depth - 1] ?? "")) continue;
      }
      const consumerName = agent || CONSUMER_FILE.test(name) || TREE_CONSUMER.test(name) || PROGRAM_OR_TOOL_FILE.test(name);
      const found = settle(check(path, shown, parts.slice(0, depth), agent, !consumerName));
      if (found) return found;
    }
  }
  // Markdown site generators that build (and may execute) every page by default (review F03 round 2):
  // VitePress compiles the Markdown under the folder holding .vitepress; MkDocs builds docs_dir (default docs/).
  if (/^(md|markdown)$/.test(extension)) {
    for (let depth = 0; depth < parts.length; depth++) {
      const folder = depth ? resolve(root, ...parts.slice(0, depth)) : root;
      if (existsSync(resolve(folder, ".vitepress"))) return { by: `${[...parts.slice(0, depth), ".vitepress"].join("/")}`, agent: false };
    }
    for (const name of ["mkdocs.yml", "mkdocs.yaml"]) {
      const file = resolve(root, name);
      if (!existsSync(file)) continue;
      let docsDir = "docs";
      try { docsDir = referenceText(/^docs_dir:[ \t]*['"]?([^'"\s#]+)/m.exec(readFileSync(file, "utf8"))?.[1] ?? "docs").replace(/^\.\//, "").replace(/\/$/, ""); } catch { return { unknown: `${name} could not be read` }; }
      if (docsDir === "" || docsDir === "." || relText === docsDir || relText.startsWith(`${docsDir}/`)) return { by: name, agent: false };
    }
  }
  // 2. The whole project tree: shell, CI, build and install files and agent instructions anywhere; everything in
  // dot-folders; Git hooks.
  const walk = (dir: string, shown: string, folderParts: string[], depth: number, inDot: boolean, agentDir: boolean): Consumer | null => {
    let entries: Dirent[];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return { unknown: `${shown || "the project root"} could not be listed` }; }
    for (const entry of entries) {
      const name = entry.name;
      const path = resolve(dir, name); const label = shown ? `${shown}/${name}` : name;
      if (entry.isDirectory() || (entry.isSymbolicLink() && followsToFolder(path))) {
        // A linked folder is followed (it may live outside the project; review F03 round 2), once per real folder.
        if (entry.isSymbolicLink()) {
          if (CACHE_DIR.test(name) || SKIPPED_DIR.test(name) || NON_CONSUMER.test(name)) continue;
          let real: string;
          try { real = realpathSync(path).toLowerCase(); } catch { return { unknown: `${label} is a link that cannot be resolved, so its references cannot be checked` }; }
          if (linkedFolders.has(real)) continue;
          linkedFolders.add(real);
        }
        if (CACHE_DIR.test(name) || SKIPPED_DIR.test(name) || NON_CONSUMER.test(name)) {
          if (depth === 0 && /^\.hg$/i.test(name)) {
            for (const file of ["hgrc"]) {
              const found = settle(check(resolve(path, file), `.hg/${file}`, [], false, true));
              if (found) return found;
            }
          }
          if (depth === 0 && /^\.(git|hg)$/i.test(name)) {
            const hooks = resolve(path, "hooks");
            let names: string[] = [];
            try { names = readdirSync(hooks); } catch { names = []; }
            for (const hook of names) {
              if (OPAQUE_FILE.test(hook)) continue;
              const found = settle(check(resolve(hooks, hook), `${name}/hooks/${hook}`, [], false, true));
              if (found) return found;
            }
          }
          continue;
        }
        if (depth + 1 > CONSUMER_DEPTH) return { unknown: `${label} is nested too deeply to check for references` };
        const dot = inDot || name.startsWith(".");
        const found = walk(path, label, [...folderParts, name.toLowerCase()], depth + 1, dot, agentDir || (name.startsWith(".") && AGENT_INSTRUCTION_DIR.test(name)));
        if (found) return found;
        continue;
      }
      if (NON_CONSUMER.test(name) || OPAQUE_FILE.test(name)) continue;
      const agent = agentDir || AGENT_INSTRUCTION_FILE.test(name);
      if (!inDot && !agent && !TREE_CONSUMER.test(name)) {
        // An extensionless script with a #! line is a program some tool or person runs.
        if (name.includes(".")) continue;
        let shebang = false;
        try { const head = Buffer.alloc(2); const fd = openSync(path, "r"); try { shebang = readSync(fd, head, 0, 2, 0) === 2 && head.toString("latin1") === "#!"; } finally { closeSync(fd); } } catch { shebang = false; }
        if (!shebang) continue;
      }
      // Structured data inside a data folder is data, not a consumer.
      if (!inDot && !agent && STRUCTURED_DATA_FILE.test(name) && !CONSUMER_FILE.test(name) && folderParts.some((part) => DATA_DIR.test(part))) continue;
      const found = settle(check(path, label, folderParts, agent, inDot && !CONFIG_TEXT.test(name), inDot));
      if (found) return found;
    }
    return null;
  };
  try { if (!statSync(root).isDirectory()) return null; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    return { unknown: "the project root could not be read" };
  }
  const found = walk(root, "", [], 0, false, false);
  if (found) return found;
  return toolReference;
}
/** Structured files whose name marks them as program, build, site or pipeline configuration, wherever they are. */
const CONFIG_LIKE_DATA = /(^_|config|(^|[\W_])conf([\W_]|$)|settings|pipeline|workflow|compose|manifest|values|chart|kustomiz|mkdocs|hugo|jekyll|netlify|vercel|deploy|build|(^|[\W_])ci([\W_]|$)|renovate|dependabot|codecov|lerna|turbo|tsconfig|eslint|prettier|babel|jest|vitest|playwright|cypress|openapi|swagger|schema)/i;
/** A pinned package requirement line (name[extras] ==/>=/~=/!= version), as pip and similar installers read. */
const REQUIREMENT_LINE = /^[ \t]*[A-Za-z0-9][\w.-]*(\[[\w ,.-]*\])?[ \t]*(?:(===?|~=|!=|>=|<=)[ \t]*[\w.*+!-]+|@[ \t]*\S+)[ \t]*(;.*)?$/m;
/** Package-installer directives (pip -r/-e/--index-url ...) in a text file make it an install input. */
const INSTALLER_DIRECTIVE = /^[ \t]*(-[rcefi]|--requirement|--constraint|--editable|--index-url|--extra-index-url|--find-links|--trusted-host)([ \t=]|$)/m;
/** A symlink or junction on any existing component below the root can retarget a write after it was judged. */
function linkBelow(root: string, rel: string): string | null {
  let at = root;
  for (const part of ["", ...rel.split(/[\\/]+/).filter(Boolean)]) {
    at = part ? resolve(at, part) : at;
    let info: ReturnType<typeof lstatSync>;
    try { info = lstatSync(at); } catch { return null; }
    if (info.isSymbolicLink()) return `${at} is a link or junction`;
  }
  return null;
}
const PROGRAM_START = /^(\uFEFF)?(#!|@echo|MZ|\x7fELF|<\?php|<script|import\s|export\s|require\(|["']use strict["'])/i;
const startsLikeProgram = (text: string) => PROGRAM_START.test(text.trimStart().slice(0, 64));
/**
 * Classifies a paired-device write or delete. `base` is the step's working folder (the project or its isolated
 * workspace); directory roles are judged relative to it, so a project kept under C:\dev\app is not "app".
 */
export function classifyDeviceWrite(path: string, context: { base: string; operation: "write" | "delete"; content?: string | null }): DeviceWriteClassification {
  const reasons: string[] = []; const warnings: string[] = [];
  const out = (classification: DeviceWriteClass, reason: string): DeviceWriteClassification => ({ classification, reasons: [...reasons, reason], warnings });
  if (typeof path !== "string" || !path) return out("UNKNOWN", "no concrete path");
  const leafRaw = path.split(/[\\/]/).pop() ?? "";
  if (/^([\\/]{2})/.test(path) || /^[a-z]:(?![\\/])/i.test(path)) return out("UNKNOWN", "network, device or drive-relative path");
  if (leafRaw.includes(":") || /[. ]$/.test(leafRaw)) return out("UNKNOWN", "alternate path form (stream suffix or trailing dot or space)");
  // Bidi, zero-width and other format or control characters can show a reviewer a different name than the real one.
  if (/[\p{Cf}\p{Cc}\p{Zl}\p{Zp}\u034f\u115f\u1160\u2800\u3164\uffa0\p{Variation_Selector}]/u.test(path)) return out("UNKNOWN", "path contains invisible, bidirectional or control characters");
  let names: { segments: string[]; leaves: string[] };
  let target: string; let root: string; let lexicalRel: string;
  try {
    const absolute = isAbsolute(path) ? path : resolve(context.base, path);
    root = canonical(context.base);
    target = canonical(absolute);
    names = resolvedNames(absolute);
    lexicalRel = relative(resolve(context.base), resolve(absolute));
  } catch { return out("UNKNOWN", "path could not be resolved"); }
  const rel = relative(root, target);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return out("UNKNOWN", "outside the step's working folder");
  if (!lexicalRel || lexicalRel.startsWith("..") || isAbsolute(lexicalRel)) return out("UNKNOWN", "path leaves the step's working folder before resolution");
  // Any 8.3 short-name component below the step folder is an alias whose real name (and role) is hidden.
  if (lexicalRel.split(/[\\/]+/).some((segment) => /~\d/.test(segment))) return out("UNKNOWN", "short (8.3) name form in the path; write the full names");
  // Links are judged on the path as written (canonicalization would already have followed them).
  const link = linkBelow(resolve(context.base), lexicalRel) ?? linkBelow(root, rel);
  if (link) return out("UNKNOWN", link);
  if (lexicalRel.toLowerCase() !== rel.toLowerCase()) return out("UNKNOWN", "path reaches its destination through an alias (8.3 name, link or junction)");
  let existing: ReturnType<typeof lstatSync> | null = null;
  try { existing = lstatSync(target); } catch { existing = null; }
  if (existing && !existing.isFile()) return out("UNKNOWN", "destination exists and is not a regular file");
  if (existing && existing.nlink > 1) return out("UNKNOWN", "destination has other hard links (possibly in another root)");
  const relSegments = rel.split(/[\\/]+/).filter(Boolean).map(normalizeSegment);
  const dirs = relSegments.slice(0, -1);
  const leaves = [...new Set([...names.leaves, relSegments.at(-1) ?? ""].filter(Boolean))];
  // Agent instructions first: a Markdown file an agent loads is an instruction, however harmless it reads.
  if (leaves.some((leaf) => AGENT_INSTRUCTION_FILE.test(leaf)) || dirs.some((segment) => AGENT_INSTRUCTION_DIR.test(segment)) || /(^|[\\/])\.github[\\/](instructions|prompts|chatmodes|agents)([\\/]|$)/i.test(rel))
    return out("AGENT_INSTRUCTIONS", "agent instruction or agent configuration location");
  if (names.segments.some((segment) => GIT_SEGMENT.test(segment))) return out("EXECUTION_RELEVANT", "Git metadata");
  if (dirs.some((segment) => EXECUTION_DIR.test(segment)) || names.segments.some((segment) => /^(\.husky|\.githooks|node_modules)$/i.test(segment))) return out("EXECUTION_RELEVANT", "hook, script, CI, tool or dependency folder");
  if (dirs.some((segment) => WATCHED_SOURCE_DIR.test(segment))) return out("EXECUTION_RELEVANT", "source folder a dev server, bundler or test runner watches, serves or imports");
  if (leaves.some((leaf) => EXECUTION_CONFIG_FILE.test(leaf)) || names.segments.some((segment) => EXECUTION_CONFIG_DIR.test(segment))) return out("CONFIGURATION", "file or folder that configures programs that run");
  if (!leaves.every((item) => DOCUMENT_FILE.test(item) || DATA_FILE.test(item) || STRUCTURED_DATA_FILE.test(item))) return out("EXECUTION_RELEVANT", "not a document or data file type (code, binary or extensionless)");
  if (leaves.some((item) => item.startsWith("."))) return out("CONFIGURATION", "dotfile");
  // Dot-folders hold tool, editor and agent settings; a new tool's folder is unknown to any list, so every dot-folder
  // inside the project fails closed (review round 2).
  if (dirs.some((segment) => segment.startsWith("."))) return out("CONFIGURATION", "dot-folder (tool, editor or agent settings)");
  if (dirs.some((segment) => CONFIG_DIR.test(segment) || /^requirements$/i.test(segment))) return out("CONFIGURATION", "configuration folder");
  // Site generators (Jekyll, Hugo, Eleventy) treat underscore folders as layouts, includes, plugins and data (review round 4).
  if (dirs.some((segment) => segment.startsWith("_"))) return out("CONFIGURATION", "site-generator folder (_layouts, _includes, _plugins, _data) is build input");
  if (leaves.some((item) => CONSUMED_TEXT_FILE.test(item))) return out("CONFIGURATION", "file name a package manager, build tool or web server consumes");
  // pytest collects test*.txt as doctests with no configuration at all (review F03 round 1).
  if (leaves.some((item) => /^test[^/\\]*\.txt$/i.test(item))) return out("EXECUTION_RELEVANT", "file name a test runner collects and runs by default (test*.txt doctests)");
  if (typeof context.content === "string" && startsLikeProgram(context.content)) return out("EXECUTION_RELEVANT", "new content starts like a program or script");
  // A Markdown pipeline that understands MDX evaluates ESM import/export lines wherever they appear.
  if (typeof context.content === "string" && /^[ \t]*(import|export)\b/m.test(context.content)) return out("EXECUTION_RELEVANT", "content has ESM import/export lines (evaluated by MDX-style pipelines)");
  if (typeof context.content === "string" && /^[ \t]*(?:`{3,}|~{3,})\{(?:code-cell|code|jupyter-execute|ipython|exec|eval-rst)\b|^[ \t]*\.\. (?:jupyter-execute|ipython)::/im.test(context.content)) return out("EXECUTION_RELEVANT", "content has an executable MyST or reST code directive");
  if (typeof context.content === "string" && /<script\b/i.test(context.content)) return out("EXECUTION_RELEVANT", "content has a <script> block (VitePress, MDX and HTML pipelines run it)");
  if (typeof context.content === "string" && (/<%[*=_-]?[\s\S]*?%>/.test(context.content) || /^[ \t>]*(?:(?:[-*+]|\d+[.)])[ \t]+)?(?:`{3,}|~{3,})[ \t]*(dataviewjs|meta-bind-js|js-engine|templater)\b/im.test(context.content))) return out("EXECUTION_RELEVANT", "content has a note-app script block (Templater, DataviewJS) that runs when opened or rendered");
  if (typeof context.content === "string" && /^[ \t]*>>>[ \t]/m.test(context.content)) return out("EXECUTION_RELEVANT", "content has interactive-interpreter prompts (doctest and pytest run them)");
  if (typeof context.content === "string" && REQUIREMENT_LINE.test(context.content)) return out("EXECUTION_RELEVANT", "content looks like a package requirement list (a package installer would install it)");
  if (typeof context.content === "string" && INSTALLER_DIRECTIVE.test(context.content)) return out("EXECUTION_RELEVANT", "content has package-installer directives (-r, -e, --index-url ...)");
  if (existing) {
    try {
      if (startsLikeProgram(readFileSync(target, "utf8").slice(0, 256))) return out("EXECUTION_RELEVANT", "existing destination content starts like a program or script");
    } catch { return out("UNKNOWN", "existing destination could not be read"); }
  }
  const consumer = consumerOf(root, rel);
  if (consumer && "unknown" in consumer) return out("UNKNOWN", consumer.unknown);
  if (consumer) return consumer.agent
    ? out("AGENT_INSTRUCTIONS", `referenced by agent instructions (${consumer.by})`)
    : consumer.folder
      ? out("EXECUTION_RELEVANT", `its folder also holds a program or tool file (${consumer.by}) that may process it`)
      : out("EXECUTION_RELEVANT", `named by project metadata (${consumer.by}) as a tool input`);
  if (leaves.some((item) => STRUCTURED_DATA_FILE.test(item))) {
    if (leaves.some((item) => CONFIG_LIKE_DATA.test(item))) return out("CONFIGURATION", "structured file whose name marks it as program, build, site or pipeline configuration");
    if (!dirs.some((segment) => DATA_DIR.test(segment))) return out("CONFIGURATION", "JSON or YAML outside a recognized data or document folder can configure programs");
    warnings.push("Structured data can still be read by programs as settings; review its consumers.");
    return out("PHONE_SAFE_DATA", "JSON or YAML inside a recognized data or document folder");
  }
  if (leaves.every((item) => DATA_FILE.test(item))) {
    warnings.push("Programs may read this data file.");
    if (typeof context.content === "string" && /(^|[,\t\n])[ \t]*"?[=+@-][^,\t\n]*[A-Za-z(]/m.test(context.content)) warnings.push("Some cells start with = + - or @; a spreadsheet may evaluate them as formulas when the file is opened.");
    return out("PHONE_SAFE_DATA", "tabular or log data");
  }
  if (leaves.every((item) => DOCUMENT_FILE.test(item))) {
    warnings.push("Any program can be pointed at a text file; it is staged and reviewed on the Windows Host before it reaches the project.");
    return out("PHONE_SAFE_DOCUMENT", "plain document");
  }
  return out("UNKNOWN", "no recognized safe document or data role");
}
/** Why a paired device may not write or delete this path (D1), or null when it is a phone-safe document or data file. */
export function deviceWriteClassRefusal(path: string, base: string, operation: "write" | "delete", content?: string | null): string | null {
  const result = classifyDeviceWrite(path, { base, operation, content });
  return PHONE_SAFE_CLASSES.includes(result.classification) ? null : `${DESKTOP_REQUIRED} ${path} is classified ${result.classification} (${result.reasons.at(-1)}); a paired device writes only phone-safe documents and data.`;
}
