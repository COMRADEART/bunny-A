# Bunny-A M-A-2 runtime compatibility

The T1 observations below are the production baseline.
The T2 checkpoint follows them.

The accepted Codex security validation used `codex-cli 0.153.4`.
T1 does not certify a different Codex version.
T2 must record the executable, version and security capabilities.
Unknown versions must fail closed for hardened Mission execution.

The T1 package uses an exact source commit and an installed Node runtime.
State layout 2 requires Host database schema 3.
The Host checks the schema fingerprint before writable startup.
A missing or damaged database cannot become an empty production database.

The cloudflared record contains the copied binary hash and version.
The launcher and worker refuse a missing or changed client.
Ordinary startup does not download a replacement client.

The manifest records the source SHA, tooling SHA and file hashes.
The installed source is `898c52cbb439cbaa738f6a44e89ca4c526591cc9`.
The installed tooling is `e7f82de8f82fb427bc00fdb19a715b58df32fadf`.
The runtime is the packaged Node `v24.18.0`.
The observed Codex version is still `codex-cli 0.153.4`.
The observed cloudflared version is `2026.9.3`.
The complete identities are in the implementation report.

# M-A-2 Gate T2

## IMPLEMENTED

Bunny Codex security policy version is **1**. Host database schema stays at **3**.
The registry approves one Windows native runtime. It has no version ranges.

| Fact | Validated value |
|---|---|
| Version | `codex-cli 0.153.4` |
| Requested executable | `C:\Users\allam\AppData\Local\Programs\OpenAI\Codex\bin\codex.exe` |
| Canonical executable | `C:\Users\allam\.codex\packages\standalone\releases\0.153.4-x86_64-pc-windows-msvc\bin\codex.exe` |
| Bytes | `295408944` |
| SHA-256 | `444a3f0008050605cae73cd9b7a2dcac61294062dfaab56dd20430fd6498518b` |
| Compatibility | `VALIDATED` for Mission read and write access |
| Bunny policy | `1` |

`ProviderCompatibility` provides common policy, class, time and evidence fields.
`CodexCompatibilityProfile` adds runtime identity and observed controls.
The Host stores these facts in the existing provider observation JSON.
There is no database migration.

Discovery runs `--version`, `exec --help`, and positive and negative `features list` parser checks.
The positive check sets `windows.sandbox="elevated"`, disables web search and all 12 MA1 feature defaults.
The negative check must reject an invalid Windows sandbox enum.
Feature rows must report every required feature as disabled.
No compatibility probe starts a model session.
The parser checks read the current config. They do not write it.

Discovery caches the streamed SHA-256 by requested path, command, arguments, canonical path,
file id, size, mtime, ctime and birthtime. The cache holds at most 16 paths.
Validated evidence expires after 10 minutes.
Mission launch resolves the provider again, bypasses the hash cache, repeats metadata probes,
resolves again, and hashes again immediately before it spawns the canonical native executable.
No asynchronous wait occurs between the final identity check and spawn.
Changed paths, bytes, versions, controls, file identities or stale facts cause a check or refusal.
Persisted facts do not grant access after a Host restart. This Host must probe the provider first.

Mission read and write require `VALIDATED`, the current Bunny policy, complete identity,
fresh facts, the applicable isolation approval, and connector, plugin and MCP isolation.
The hard constraint applies before router scoring. History and manual selection cannot override it.
Retarget also checks older Mission children that lack the new routing constraint.
Retry and replan create new decisions. Approval checks the current provider facts.
The Codex adapter checks the actual runtime before every scoped launch.
TaskManager and router scoring were not changed.

`UNVALIDATED` means no approved exact runtime or inconclusive metadata.
`UNSUPPORTED` means a required CLI flag or sandbox mode is absent.
`INCOMPATIBLE` means the local parser contradicts the required controls.
All three classes exclude Codex from both Mission access modes.

Direct tasks keep their exact MA1 argv and current readiness checks.
An unvalidated runtime can be ready for direct tasks.
The UI then shows **Direct tasks ready** and **Mission execution: Restricted**.
Provider details show the concrete reason. Loading or expired facts show **Check required**.
Claude and Ollama retain their existing policy.

## LIVE VERIFIED

The native binary above passed the implemented gate on this computer.
Read and write exclusion reasons were both null.
`test-results/ma2-gate2/native-profile.json` records the complete facts.
No model session was started. The user config hash stayed equal to the baseline.
T1 preservation passed: same Host instance, PID 2200, gateway PID 42156,
canonical state, schema, workspace, shortcut, journal, backup, cloudflared and T1 release.

## SIMULATED

Harmless executable stand-ins cover future and old versions, malformed output, timeout,
nonzero commands, unreadable help, flag loss, parser contradictions, byte replacement,
same-version different bytes, path changes, stale policy, cancellation, routing and restart.
Mission tests cover both retarget paths, direct child approval, automatic retry, explicit retry and replan.
The future-version UI fixture reports `codex-cli 0.999.0`, remains ready for direct tasks,
and is Mission restricted. It refuses every model launch.
The installed native binary is never replaced in these tests.

## STATIC VERIFIED

482 regression tests passed: 233 script, 228 application and 21 UI tests.
All 439 baseline tests remain. Typecheck and both build targets passed.
Lint: 0 errors, 10 existing warnings.
Dev and desktop middleware UI rendered at desktop and mobile sizes with no errors or overflow.
The baseline text drift was the displayed live temperature. Both viewports were inspected.
Generated `.output/` is excluded from Tailwind source scanning so client and server CSS links agree.

## NOT TESTED

No new live Codex model Mission was run for T2. Existing MA1 isolation evidence remains the basis
for policy 1; T2 binds that contract to the observed binary and safe metadata checks.
The T2 candidate is not the production startup selection.
No other Codex runtime, future version or platform receives approval.
This gate does not prove safety against a compromised Host or privileged concurrent file tampering.

## BLOCKED

None for the T2 implementation and local acceptance checkpoint.

## DEFERRED

T3–T10 remain open. Production keeps the v17-T1 startup pin and v10 dashboard.
Candidate identity and staging evidence are in `MA2_IMPLEMENTATION_REPORT.md`.
Independent final M-A-2 review remains required.
