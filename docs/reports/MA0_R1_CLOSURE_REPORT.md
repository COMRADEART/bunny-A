# Bunny-A M-A-0R2 — R1 Codex read-step isolation closure

**BUNNY_MA0_R1_CLOSED** — implementer's launch-contract closure claim, pending independent Claude Review 0R2. This is not M-A-1 or final freeze approval.

## Reviewed baseline and scope

Repository `COMRADEART/router_agent`, branch `ma0-mission-architecture`. Before editing, status contained only the untracked supplied `MA0_CLAUDE_REVIEW_0.md` and `MA0_CLAUDE_REVIEW_0R.md`; no unrelated changes. Branch/HEAD/status and decorated history were checked.

```text
PRE_R1_SHA=284249353a5b6ae7105d40f1f3a17f135b5d878b
```

All seven existing commits remain ancestors: `32ce245 → dbab79e → 60d54e0 → 33723ee → 02d6a7e → b975026 → 2842493`. One additional coherent commit contains R1 source, tests and these docs; obtain its exact SHA from the final handoff / `git rev-parse HEAD`. No amend, squash, reset, clean, push or merge.

Claude Review 0R verdict: **BUNNY_MA0_FREEZE_APPROVED_WITH_NOTES**, no remaining BLOCKER/HIGH. **R1 (MEDIUM)** concerns Codex read steps inheriting `config.toml` MCP servers, plugins and side-effecting integrations. `--sandbox read-only` alone governs Codex shell/files, so filesystem sandboxing did not close that configuration boundary. R1 is an entry condition for M-A-1's Codex read acceptance.

Both supplied review reports remain untracked and untouched. Their SHA-256 values are `391bbaab3928c61ce58fef9483f85f48c2f6917abaf4e08acc6078253423ef86` (Review 0) and `0d95decd0db430033c3390f79ce6b2bd14d6431588b5db81d637ff7135747691` (Review 0R).

## Actual executable and supported syntax

The same discovery code the Host uses, with the saved `provider_paths` read through a **read-only** SQLite connection, resolves:

```text
C:\Users\<user>\AppData\Local\Programs\OpenAI\Codex\bin\codex.exe
codex-cli 0.153.4
source: PATH; native executable; no launch prefix arguments
```

A read-only GET of the running Host snapshot confirms the same executable/version. No discovery refresh, login, app-server or provider session was invoked. This corrects Review 0's `0.159.0-alpha.12.1` evidence from a different app-bundled binary.

The resolved executable's `exec --help` supports:

| Syntax | Installed help contract |
|---|---|
| `--sandbox read-only` | `read-only`, `workspace-write`, `danger-full-access` are supported sandbox values. |
| `--ignore-user-config` | Omits `$CODEX_HOME/config.toml`; authentication still uses `CODEX_HOME`. |
| `--ignore-rules` | Omits user and project execpolicy `.rules` files. |
| `-c` / `--config key=value` | Dotted keys override nested configuration; values parse as TOML. |

Evidence: `test-results/ma0r2/codex-cli-evidence.json`, `codex-cli.log`, `codex-exec-help.txt`, `codex-root-help.txt` and `codex-read-argv-help.txt`. After the change, the exact helper-generated read argv was supplied to **that executable with `--help`**: exit 0 and identical help output. This proves parser compatibility, not live tool registration or OS sandbox enforcement. All actual Codex invocations were version/help only.

## Read launch and platform policy

The actual `CodexAdapter.launch` still calls `codexLaunchArgs` and the existing `spawnSession` (`shell:false`). For a child with `executionScope.access === "read"`, the native Windows argv is:

```text
exec --json --sandbox read-only --ignore-user-config --ignore-rules
-c windows.sandbox="elevated"
--skip-git-repo-check --cd <approved cwd> --model <routed model> -
```

`windows.sandbox="elevated"` is **one argv element**, including its TOML quotes. The flags omit user-configured MCP/plugin/integration definitions and permissive execpolicy. No user profile, config file, MCP table, plugin enablement, hook or integration is copied back into the launch. This is configuration-wide isolation, not a list of known MCP names.

The workstation's existing `[windows] sandbox = "elevated"` was read as a single selected setting; the config was never changed. Ignoring that config must not erase the native sandbox selection, so the adapter restores the **fixed trusted literal** `windows.sandbox="elevated"` on `win32`. No user value controls this override. Other platforms get the isolation flags without the Windows setting. The setting also agrees with [official Windows sandbox guidance](https://learn.chatgpt.com/docs/windows/windows-sandbox). Native sandbox setup/enforcement remains CLI-managed and awaits M-A-1 live evidence; Bunny adds no unsandboxed fallback.

Scope, not role, chooses this policy: Research/read and CustomAgent/read are isolated. Research/write, other approved write/execute steps and unscoped direct tasks retain the exact pre-R1 `workspace-write` argv and normal config behavior. Claude's reviewed read/write launch implementation is unchanged; Ollama is unchanged. Unsupported flags in another executable would fail its CLI parser; no retry path strips the read flags to recover.

## Files changed and focused proof

| File | R1 change |
|---|---|
| `src/lib/bunny-host/adapters.server.ts` | Codex read-only isolation flags and sole Windows sandbox override; corrected CLI evidence comment. |
| `src/lib/bunny-host/execution-scope.test.ts` | Extend six real adapter argv stand-ins; add eight focused regressions. |
| `MA0_REMEDIATION_REPORT.md` | Add R1 closure/current gates and correct actual Codex version evidence. |
| `MA0_CLAUDE_REVIEW_PACKET.md` | Narrow independent Review 0R2 handoff. |
| `docs/MA0_SECURITY_MODEL.md` | Document isolated read launch and platform preservation. |
| `MA0_R1_CLOSURE_REPORT.md` | This report. |

New tests: three explicit platform contracts (Windows/Linux/macOS), two real read Mission launches (Research/CustomAgent), one Claude → Codex retarget with automatic and explicit retries, one read replan with revoked old approval, and one missing-child/envelope-authority refusal. **8 added, none deleted.** The adapter test file is now **14/14**.

These use **real MissionManager → TaskManager → CodexAdapter → spawnSession** and capture argv from disposable Node executables. Only provider discovery/auth/usage and CLI IO are stand-ins; no real model or configured tool is invoked. Retarget begins with a pending Claude child and ends at Codex; the fixture makes Claude unavailable for subsequent Codex retry routing. Each retry creates a distinct child with the same read flags. Replan retains read access, revokes old approval, refuses execution before new approval, then spawns isolated Codex. Child scope mutation/removal is refused. Missing scope or old envelope metadata fails before spawn. Existing tests retain JSON-byte-preserving migration, write Research, feature-off/direct behavior and Claude restrictions.

For Codex direct and write cases the tests compare **the entire actual spawned argv** with a literal pre-R1 baseline. Read assertions check both isolation flags, read-only mode, no profile/feature re-enable or sandbox bypass, and that the **only** configuration override is the Windows literal. This proves the constructed launch contract; no live MCP behavior is inferred from an argv stand-in.

## Complete regression gates

Logs are ignored local evidence under `test-results/ma0r2/`.

| Gate | Result | Evidence |
|---|---|---|
| `npm test`, scripts | **205/205**, 0 failed/skipped/cancelled | `full-test.log` |
| `npm test`, app/Host/Mission | **174/174**, 0 failed/skipped/cancelled | `full-test.log` |
| `npm run test:ui` | **20/20**, 0 failed/skipped/cancelled | `ui-test.log` |
| **Total** | **399/399**, all 391 reviewed tests retained + 8 R1 tests | above |
| Focused adapter/scope | **14/14** | `focused-test.log` |
| `npm run typecheck` | **exit 0** | `typecheck.log` |
| `npm run lint` | **exit 0; 0 errors / same 10 warnings**; output byte-identical to M-A-0R | `lint.log` |
| `npm run build` | **exit 0**; existing Radix directive notices; `db:migrate` skips without `DATABASE_URL` as before | `build.log` |
| Migration / legacy compatibility | **PASS**, detailed below | `migration.log`, `migration-evidence.json` |
| Missions disabled / direct behavior | **PASS**, retained original regression and exact adapter argv tests | full tests |
| Dev / fresh built render | Both desktop/mobile show content, clean console and no horizontal overflow; all four screenshots inspected | `dev-smoke.log`, `built-smoke.log`, `screenshots/ma0r2-*.{json,png}` |

Full tests ran with native process permissions so the existing Git Stop fixtures could terminate their own disposable children. No production process was stopped. No production source changed after these gates.

Migration used read-only source connections and disposable `VACUUM INTO` snapshots of the current Host DB and pre-M2 backup. Every original column/value/JSON byte/count was unchanged after **two** new-code opens; the actual `ea0e803` persistence implementation read both migrated copies successfully. Missions stayed disabled on those migrated copies. Source main/WAL hashes were unchanged during the check. Live snapshot counts: **51 tasks / 13 projects / 1,840 events / 36 outcomes / 9 devices**. Backup: **13 / 1 / 890 / 5 / 4**. Row digests: `7f9e520a531af07fa4782deb48c0684f67a75f27c45cee90d9365e12132f1f70` and `a93c240606196bfc855219f5c6ff331d788676adc6a90ee7d9bec7c57a28840d`. R1 adds no schema, persistence or migration change. The running installed Host was not restarted/upgraded.

Built-preview rendering still differs from connected dev because of the **previously reviewed Host connection limitation**; the dev baseline comparison reports shorter body text (desktop 1,292 → 429; mobile 1,199 → 381). Comparison with the prior reviewed built verdict has **no divergence** (`prior-built-comparison.json`). No bridge weakening or UI change was used. The existing utility share-card placeholder note remains.

## Residual boundaries and handoff

R1's launch-contract fix is complete. Provider CLI enforcement remains trusted: no live tool-registration/MCP/plugin probe, native Windows write-refusal attempt, ordinary Codex/Claude/Ollama Mission, public phone acceptance or installed-Host upgrade was performed. No mission quota was spent, configured MCP tool invoked or external integration used. Isolated app-render QA used a temporary browser profile; it did not invoke Codex browser/computer plugins or the user's browser profile.

M1's accepted provider-internal boundary and other Review 0R notes remain unchanged. M-A-1 must collect live Codex read evidence for absence of inherited tools and refusal of writes, plus the existing provider/write/phone/platform acceptance cases. Claude Review 0R2 must independently inspect this diff and approve the candidate first. **The post-R1 commit is not yet the final M-A-0 freeze SHA.**
