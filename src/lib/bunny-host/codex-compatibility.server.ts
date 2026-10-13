import { createHash } from "node:crypto";
import { closeSync, openSync, readSync, realpathSync, statSync } from "node:fs";
import { win32 } from "node:path";
import { CODEX_SECURITY_POLICY_VERSION, codexMissionExclusion, type CodexCompatibilityProfile, type ExecutableIdentity } from "../orch/compatibility.ts";
import type { ProviderExecutionScope } from "../orch/types.ts";
import type { DiscoveryContext, Launchable } from "./discovery.server.ts";

/** These MA1 controls apply to both read and write Missions. Direct tasks retain their legacy policy. */
export const CODEX_READ_DISABLED_FEATURES = ["apps", "plugins", "remote_plugin", "multi_agent", "multi_agent_v2", "image_generation", "browser_use", "browser_use_external", "computer_use", "tool_suggest", "hooks", "skill_mcp_dependency_install"] as const;
export type MetadataResult = { code: number | null; stdout: string; stderr: string; timedOut: boolean; error?: string };
export type MetadataProbe = (launch: Launchable, args: string[], timeout?: number) => Promise<MetadataResult>;
export type ValidatedCodexRuntime = {
  id: string;
  platform: string;
  executablePath: string;
  kind: Launchable["kind"];
  prefixArgs: string[];
  version: string;
  size: number;
  sha256: string;
  policyVersion: number;
  read: boolean;
  write: boolean;
  evidenceSource: string;
};

/** Add an entry only after independent security evidence. There are no version ranges or runtime overrides. */
export function validatedCodexRuntimes(ctx: Pick<DiscoveryContext, "home">): readonly ValidatedCodexRuntime[] {
  return [{
    id: "ma1-windows-0.153.4-policy1",
    platform: "win32",
    executablePath: win32.join(ctx.home, ".codex", "packages", "standalone", "releases", "0.153.4-x86_64-pc-windows-msvc", "bin", "codex.exe"),
    kind: "native", prefixArgs: [], version: "0.153.4", size: 295408944,
    sha256: "444a3f0008050605cae73cd9b7a2dcac61294062dfaab56dd20430fd6498518b",
    policyVersion: CODEX_SECURITY_POLICY_VERSION, read: true, write: true,
    evidenceSource: "MA1_ACCEPTANCE_REPORT.md; MA1_CLAUDE_REVIEW_PACKET.md; MA2_RUNTIME_COMPATIBILITY.md (T2 native fingerprint and parser probes)",
  }];
}

const samePath = (a: string, b: string, platform: string) => platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
export function executableStamp(launch: Launchable): { path: string; stamp: string; size: number } {
  const path = realpathSync(launch.path);
  const stat = statSync(path);
  if (!stat.isFile()) throw new Error("Resolved executable is not a regular file.");
  return { path, size: stat.size, stamp: JSON.stringify([launch.path, launch.command, launch.args, launch.kind, path, stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs, stat.birthtimeMs]) };
}

/** Cache by file identity for discovery; Mission launch always bypasses the hash cache. */
export class ExecutableFingerprints {
  cache = new Map<string, ExecutableIdentity>();
  identify(launch: Launchable, force = false): ExecutableIdentity {
    const before = executableStamp(launch);
    const cached = this.cache.get(launch.path);
    if (!force && cached?.stamp === before.stamp) return cached;
    const fd = openSync(before.path, "r");
    const hash = createHash("sha256");
    try {
      const buffer = Buffer.allocUnsafe(1024 * 1024);
      let bytes: number;
      while ((bytes = readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, bytes));
    } finally { closeSync(fd); }
    const after = executableStamp(launch);
    if (before.stamp !== after.stamp) throw new Error("Executable changed while its identity was checked.");
    const identity: ExecutableIdentity = { requestedPath: launch.path, command: launch.command, prefixArgs: [...launch.args], executablePath: before.path, kind: launch.kind, size: before.size, sha256: hash.digest("hex"), stamp: before.stamp };
    // Bound the cache; changing PATH repeatedly must not retain every old binary.
    if (this.cache.size >= 16 && !this.cache.has(launch.path)) this.cache.clear();
    this.cache.set(launch.path, identity);
    return identity;
  }
}

export function emptyCodexCompatibility(reason: string, now = Date.now()): CodexCompatibilityProfile {
  return {
    policyVersion: CODEX_SECURITY_POLICY_VERSION, compatibilityClass: "UNVALIDATED", reason, checkedAt: now, validatedAt: null, evidenceSource: "Safe local metadata probes only",
    executable: null, versionRaw: null, versionParsed: null, validatedAgainstVersion: null, registryEntry: null,
    supportsSandboxReadOnly: false, supportsSandboxWorkspaceWrite: false, supportsIgnoreUserConfig: false, supportsIgnoreRules: false, supportsConfigOverride: false,
    supportsWindowsSandboxElevated: false, disabledFeaturesVerified: false, readIsolationValidated: false, writeIsolationValidated: false,
    connectorIsolationValidated: false, pluginIsolationValidated: false, mcpIsolationValidated: false,
  };
}
export function codexParserArgs(setting = "elevated"): string[] {
  return ["-c", `windows.sandbox="${setting}"`, "-c", 'web_search="disabled"', ...CODEX_READ_DISABLED_FEATURES.flatMap((feature) => ["--disable", feature]), "features", "list"];
}

/** No auth/model requests: version, exec help, and positive/negative local config parser checks. */
export class CodexCompatibilityGate {
  probe: MetadataProbe;
  registry?: readonly ValidatedCodexRuntime[];
  fingerprints: ExecutableFingerprints;
  constructor(options: { probe: MetadataProbe; registry?: readonly ValidatedCodexRuntime[]; fingerprints?: ExecutableFingerprints }) {
    this.probe = options.probe; this.registry = options.registry; this.fingerprints = options.fingerprints ?? new ExecutableFingerprints();
  }
  async inspect(launch: Launchable, ctx: DiscoveryContext, forceHash = false): Promise<CodexCompatibilityProfile> {
    const profile = emptyCodexCompatibility("Security compatibility has not been established.");
    const reject = (reason: string, kind: CodexCompatibilityProfile["compatibilityClass"] = "UNVALIDATED") => { profile.reason = reason; profile.compatibilityClass = kind; return profile; };
    try {
      profile.executable = this.fingerprints.identify(launch, forceHash);
      // Probe the real native target, rather than a retargetable PATH alias.
      const target = this.canonicalLaunch(launch, profile.executable);
      const version = await this.probe(target, ["--version"], 5000);
      if (version.timedOut || version.code !== 0) return reject(`Codex version probe ${version.timedOut ? "timed out" : "failed"}; Mission execution is refused.`);
      profile.versionRaw = version.stdout.trim();
      const parsed = /^codex-cli (\d+\.\d+\.\d+)$/.exec(profile.versionRaw);
      if (!parsed) return reject("Codex version output is empty or unrecognized.");
      profile.versionParsed = parsed[1];
      const [help, valid, invalid] = await Promise.all([
        this.probe(target, ["exec", "--help"], 5000),
        this.probe(target, codexParserArgs(), 5000),
        this.probe(target, codexParserArgs("bunny_t2_invalid"), 5000),
      ]);
      if (help.code !== 0 || help.timedOut) return reject("Codex exec help probe failed; required CLI controls are unproven.");
      if (!/Run Codex non-interactively/.test(help.stdout) || !/Usage:\s*codex exec\b/.test(help.stdout)) return reject("Codex exec help output is unrecognized.");
      const sandbox = help.stdout.match(/--sandbox\s+<SANDBOX_MODE>[\s\S]*?\[possible values:\s*([^\]]+)\]/);
      const modes = sandbox?.[1].split(",").map((mode) => mode.trim()) ?? [];
      profile.supportsSandboxReadOnly = modes.includes("read-only");
      profile.supportsSandboxWorkspaceWrite = modes.includes("workspace-write");
      profile.supportsIgnoreUserConfig = /(?:^|\n)\s*--ignore-user-config\s*(?:\r?\n|$)/.test(help.stdout);
      profile.supportsIgnoreRules = /(?:^|\n)\s*--ignore-rules\s*(?:\r?\n|$)/.test(help.stdout);
      profile.supportsConfigOverride = /-c,\s*--config\s+<key=value>/.test(help.stdout);
      const missing = [
        !profile.supportsSandboxReadOnly && "--sandbox read-only", !profile.supportsSandboxWorkspaceWrite && "--sandbox workspace-write",
        !profile.supportsIgnoreUserConfig && "--ignore-user-config", !profile.supportsIgnoreRules && "--ignore-rules", !profile.supportsConfigOverride && "-c / --config",
        !/(?:^|\n)\s*--disable\s+<FEATURE>/.test(help.stdout) && "--disable",
      ].filter(Boolean);
      if (missing.length) return reject(`Required ${missing.join(", ")} support unavailable.`, "UNSUPPORTED");
      if (ctx.platform !== "win32") return reject("This platform has no validated Codex Mission security profile.");
      if (valid.code !== 0 || valid.timedOut) return reject('Codex parser did not accept windows.sandbox="elevated" with Bunny isolation controls.', valid.timedOut || valid.code === null ? "UNVALIDATED" : "INCOMPATIBLE");
      profile.supportsWindowsSandboxElevated = !invalid.timedOut && invalid.code !== null && invalid.code !== 0 && /windows\.sandbox/.test(invalid.stderr) && /unknown variant `bunny_t2_invalid`/.test(invalid.stderr) && /expected `elevated` or `unelevated`/.test(invalid.stderr);
      if (!profile.supportsWindowsSandboxElevated) return reject("Codex Windows sandbox setting parser could not be verified.", "INCOMPATIBLE");
      profile.disabledFeaturesVerified = CODEX_READ_DISABLED_FEATURES.every((feature) => new RegExp(`^${feature}\\s+\\S+\\s+false\\s*$`, "m").test(valid.stdout));
      if (!profile.disabledFeaturesVerified) return reject("Codex did not report all Bunny tool and extension features disabled.", "INCOMPATIBLE");
      const entry = (this.registry ?? validatedCodexRuntimes(ctx)).find((item) => item.platform === ctx.platform && item.policyVersion === CODEX_SECURITY_POLICY_VERSION && item.version === profile.versionParsed && item.kind === launch.kind && JSON.stringify(item.prefixArgs) === JSON.stringify(launch.args) && samePath(item.executablePath, profile.executable!.executablePath, ctx.platform) && item.size === profile.executable!.size && item.sha256 === profile.executable!.sha256);
      if (!entry) return reject(`Unvalidated security compatibility for codex-cli ${profile.versionParsed}; exact path and binary fingerprint require approval in the validated-profile registry.`);
      if (executableStamp(launch).stamp !== profile.executable.stamp) return reject("Codex executable changed during metadata probes.");
      profile.compatibilityClass = "VALIDATED"; profile.reason = "Exact runtime and required controls match the validated Mission security profile.";
      profile.registryEntry = entry.id; profile.validatedAgainstVersion = entry.version; profile.validatedAt = Date.now(); profile.checkedAt = profile.validatedAt; profile.evidenceSource = entry.evidenceSource;
      profile.readIsolationValidated = entry.read; profile.writeIsolationValidated = entry.write;
      profile.connectorIsolationValidated = profile.pluginIsolationValidated = profile.mcpIsolationValidated = true;
      return profile;
    } catch { return reject("Codex runtime identity or metadata could not be read safely; Mission execution is refused."); }
  }
  canonicalLaunch(launch: Launchable, identity: ExecutableIdentity): Launchable {
    return launch.kind === "native" ? { ...launch, command: identity.executablePath, path: identity.executablePath } : launch;
  }
  /** Synchronous final check. Caller must spawn this canonical target immediately, with no intervening await. */
  authorize(launch: Launchable, profile: CodexCompatibilityProfile, access: ProviderExecutionScope["access"]): Launchable {
    const reason = codexMissionExclusion({ id: "codex", securityCompatibility: profile }, access);
    if (reason) throw new Error(reason);
    const current = this.fingerprints.identify(launch, true);
    if (JSON.stringify(current) !== JSON.stringify(profile.executable)) throw new Error("Codex excluded: executable identity changed before Mission launch; refresh providers.");
    return this.canonicalLaunch(launch, current);
  }
}
