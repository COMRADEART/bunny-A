import type { ProviderLive, ProviderExecutionScope } from "./types.ts";

/** Security policy version, independent of the Host database schema. */
export const CODEX_SECURITY_POLICY_VERSION = 1;
export const CODEX_COMPATIBILITY_MAX_AGE_MS = 10 * 60_000;
export type CompatibilityClass = "VALIDATED" | "UNVALIDATED" | "UNSUPPORTED" | "INCOMPATIBLE";
export type ProviderCompatibility = {
  policyVersion: number;
  compatibilityClass: CompatibilityClass;
  reason: string;
  checkedAt: number;
  validatedAt: number | null;
  evidenceSource: string;
};
export type ExecutableIdentity = {
  requestedPath: string;
  command: string;
  prefixArgs: string[];
  executablePath: string;
  kind: "native" | "node-script";
  size: number;
  sha256: string;
  /** Includes real path, file id, ctime, mtime and birthtime. Used only for discovery hash caching. */
  stamp: string;
};
export type CodexCompatibilityProfile = ProviderCompatibility & {
  executable: ExecutableIdentity | null;
  versionRaw: string | null;
  versionParsed: string | null;
  validatedAgainstVersion: string | null;
  registryEntry: string | null;
  supportsSandboxReadOnly: boolean;
  supportsSandboxWorkspaceWrite: boolean;
  supportsIgnoreUserConfig: boolean;
  supportsIgnoreRules: boolean;
  supportsConfigOverride: boolean;
  supportsWindowsSandboxElevated: boolean;
  disabledFeaturesVerified: boolean;
  readIsolationValidated: boolean;
  writeIsolationValidated: boolean;
  connectorIsolationValidated: boolean;
  pluginIsolationValidated: boolean;
  mcpIsolationValidated: boolean;
};

/** A hard constraint shared by routing, Mission approval and the adapter. Missing facts never grant access. */
export function codexMissionExclusion(provider: Pick<ProviderLive, "id" | "securityCompatibility">, access: ProviderExecutionScope["access"], now = Date.now()): string | null {
  if (provider.id !== "codex") return null;
  const profile = provider.securityCompatibility;
  const prefix = `Codex excluded from ${access} Mission execution: `;
  if (!profile) return prefix + "security compatibility check required.";
  if (profile.policyVersion !== CODEX_SECURITY_POLICY_VERSION) return prefix + "security policy version has not been validated.";
  if (profile.compatibilityClass !== "VALIDATED") return prefix + profile.reason;
  if (!Number.isFinite(profile.checkedAt) || now - profile.checkedAt > CODEX_COMPATIBILITY_MAX_AGE_MS || profile.checkedAt > now + 1000) return prefix + "security compatibility evidence is stale; refresh providers.";
  if (!profile.executable || !/^[a-f0-9]{64}$/.test(profile.executable.sha256) || !profile.registryEntry || !profile.versionParsed || profile.versionParsed !== profile.validatedAgainstVersion || !profile.validatedAt) return prefix + "validated runtime identity is incomplete.";
  if (!(profile.supportsSandboxReadOnly && profile.supportsSandboxWorkspaceWrite && profile.supportsIgnoreUserConfig && profile.supportsIgnoreRules && profile.supportsConfigOverride && profile.supportsWindowsSandboxElevated && profile.disabledFeaturesVerified)) return prefix + "required CLI security controls are unproven.";
  if (!(profile.connectorIsolationValidated && profile.pluginIsolationValidated && profile.mcpIsolationValidated && (access === "read" ? profile.readIsolationValidated : profile.writeIsolationValidated))) return prefix + `${access} isolation has not been validated.`;
  return null;
}

export function codexMissionStatus(provider: Pick<ProviderLive, "id" | "securityCompatibility">): string {
  if (!provider.securityCompatibility || (provider.securityCompatibility.compatibilityClass === "VALIDATED" && (codexMissionExclusion(provider, "read") || codexMissionExclusion(provider, "write")))) return "Check required";
  return provider.securityCompatibility.compatibilityClass === "VALIDATED" ? "Validated" : "Restricted";
}
