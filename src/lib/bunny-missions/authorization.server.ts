import { basename, isAbsolute, resolve } from "node:path";
import type { Mode, ProviderId, ProviderExecutionScope } from "../orch/types.ts";
import { withinAny } from "./paths.server.ts";
import { resolveCommand, type Resolved } from "./capabilities/process.server.ts";
import type { ActionManifest, AuthorizationEnvelope, Budget, GitAction, GrantPolicy, MissionStep, PermissionDecision, RiskClass, ScopeRequest } from "./types.ts";
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
  return {
    ...structuredClone(request),
    projectRoots: [...request.projectRoots, ...extraRoots],
    filesystem: { read: [...request.filesystem.read, ...extraRoots], write: request.filesystem.write.length ? [...request.filesystem.write, ...extraRoots] : [] },
    id: crypto.randomUUID(), missionId, grantedAt: now, grantedBy, expiresAt: now + Math.min(maxRuntimeMs, request.budget.maxRuntimeMs), revokedAt: null,
  };
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
export function decide(manifest: ActionManifest, params: Record<string, unknown>, context: { envelope: AuthorizationEnvelope | null; missionId: string | null; grants: GrantRow[]; oneTime?: boolean; direct?: { confirmed: boolean }; now?: number; base?: string; executable?: Resolved | null; agenticViolation?: string | null }): PermissionDecision {
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
  if (context.agenticViolation) return ask(context.agenticViolation);
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
      if (/(^|[\\/])\.git([\\/]|$)/i.test(path) && action !== "filesystem.read" && action !== "filesystem.list" && action !== "filesystem.exists") return "Git metadata requires specific Git authority.";
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
export function providerScopeViolation(task: { mission?: { missionId: string; stepId: string } | null; executionScope?: ProviderExecutionScope; cwd?: string }, envelope: AuthorizationEnvelope, step?: Pick<MissionStep, "id" | "scope">): string | null {
  if (!task.mission || task.mission.missionId !== envelope.missionId) return "child belongs to another mission";
  const authority = envelope.providers.sessions?.steps.find((item) => item.stepId === task.mission!.stepId);
  if (!authority || !task.executionScope) return "provider-session authority is missing; replan and approve again";
  if (step && (step.id !== task.mission.stepId || step.scope.access === "write" && authority.scope.access !== "write")) return "step exceeds approved provider-session authority";
  if (task.executionScope.access === "write" && (authority.scope.access !== "write" || step && step.scope.access !== "write")) return "child exceeds step or mission provider-session authority";
  if (!["read", "write"].includes(task.executionScope.access)) return "invalid child provider-session authority";
  if (task.executionScope.access === "write" && (!task.cwd || !withinAny(envelope.filesystem.write, task.cwd))) return "provider write authority exceeds approved write roots";
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
