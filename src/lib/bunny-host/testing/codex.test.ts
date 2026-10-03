/** Test-only fixtures. Excluded from release files; none of these facts approve a real Codex runtime. */
import { realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { emptyCodexCompatibility, CodexCompatibilityGate, ExecutableFingerprints, type MetadataProbe, type ValidatedCodexRuntime } from "../codex-compatibility.server.ts";
import { systemContext, type DiscoveryContext, type Launchable } from "../discovery.server.ts";
import type { CodexCompatibilityProfile } from "../../orch/compatibility.ts";

export const FIXTURE_HELP = `Run Codex non-interactively
Usage: codex exec [OPTIONS] [PROMPT]
  -c, --config <key=value>
      --disable <FEATURE>
  -s, --sandbox <SANDBOX_MODE>
      [possible values: read-only, workspace-write, danger-full-access]
      --ignore-user-config
      --ignore-rules
`;
export const FIXTURE_FEATURES = ["apps", "plugins", "remote_plugin", "multi_agent", "multi_agent_v2", "image_generation", "browser_use", "browser_use_external", "computer_use", "tool_suggest", "hooks", "skill_mcp_dependency_install"].map(feature => `${feature}\tstable\tfalse`).join("\n");
export const FIXTURE_INVALID = "unknown variant `bunny_t2_invalid`, expected `elevated` or `unelevated`\n in `windows.sandbox`";
export const fixtureProbe: MetadataProbe = async (_launch, args) => {
  if (args.includes("--version")) return { code: 0, timedOut: false, stdout: "codex-cli 0.153.4\n", stderr: "" };
  if (args.includes("--help")) return { code: 0, timedOut: false, stdout: FIXTURE_HELP, stderr: "" };
  const invalid = args.some(arg => arg.includes("bunny_t2_invalid"));
  return { code: invalid ? 1 : 0, timedOut: false, stdout: invalid ? "" : FIXTURE_FEATURES, stderr: invalid ? FIXTURE_INVALID : "" };
};
export function simulatedCodexProfile(): CodexCompatibilityProfile {
  return {
    ...emptyCodexCompatibility("Simulated validated fixture; no real runtime evidence."),
    compatibilityClass: "VALIDATED", validatedAt: Date.now(), registryEntry: "simulated-fixture-only", versionRaw: "codex-cli 0.153.4", versionParsed: "0.153.4", validatedAgainstVersion: "0.153.4", evidenceSource: "SIMULATED test fixture",
    executable: { executablePath: "/test-only/codex", requestedPath: "/test-only/codex", command: "/test-only/codex", prefixArgs: [], kind: "native", size: 1, sha256: "a".repeat(64), stamp: "simulated-file" },
    supportsSandboxReadOnly: true, supportsSandboxWorkspaceWrite: true, supportsIgnoreUserConfig: true, supportsIgnoreRules: true, supportsConfigOverride: true, supportsWindowsSandboxElevated: true, disabledFeaturesVerified: true,
    readIsolationValidated: true, writeIsolationValidated: true, connectorIsolationValidated: true, pluginIsolationValidated: true, mcpIsolationValidated: true,
  };
}
/** Exercise real hashing and spawning of harmless Node fixtures. Windows parser facts are explicitly simulated. */
export async function fixtureSecurity(script: string, metadata: MetadataProbe = fixtureProbe) {
  const shim = join(dirname(script), `${basename(script)}.cmd`);
  writeFileSync(shim, `@"%dp0%\\node.exe" "%dp0%\\${basename(script)}" %*\r\n`);
  const ctx = systemContext({ codex: shim });
  const launch: Launchable = { command: process.execPath, args: [script], path: script, kind: "node-script", source: "disposable fixture" };
  const identity = new ExecutableFingerprints().identify(launch);
  const entry: ValidatedCodexRuntime = { id: "test-fixture-only", platform: "win32", executablePath: realpathSync(script), prefixArgs: [script], kind: "node-script", version: "0.153.4", size: identity.size, sha256: identity.sha256, policyVersion: 1, read: true, write: true, evidenceSource: "SIMULATED harmless fixture" };
  class FixtureGate extends CodexCompatibilityGate {
    inspect(target: Launchable, context: DiscoveryContext, force = false) { return super.inspect(target, { ...context, platform: "win32" }, force); }
  }
  const gate = new FixtureGate({ probe: metadata, registry: [entry] });
  const profile = await gate.inspect(launch, ctx);
  return { ctx, launch, gate, profile, entry };
}
