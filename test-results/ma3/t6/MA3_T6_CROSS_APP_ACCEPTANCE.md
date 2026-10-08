# M-A-3 T6 cross-application acceptance

The bounded real Windows Mission passed through AgentRuntime and all five required capability families. The final source passed all 950 distinct tests. The verdict is PASS_WITH_LIMITATIONS for deliberately unsupported general-purpose operations and the production process-continuity observation gap described below. No positive OS result is simulated.

## Source and baseline

Source commit: `b3ae2f52aa5b62cd8bbbcca1c9fd37c45c61bd7f`. Branch: `codex/ma3-t6-cross-app`. Accepted T5 executable baseline: `1be6bc0b6e24989fe26b069e7bcc09808079776a`; starting checkout `64c226ffb72d28e71782de13a856afdd18ee7c17` was an evidence-only descendant with identical executable source. Baseline ancestry and exact source equality were checked before edits. Three local source commits are recorded in source-provenance.json. No push, install, deployment, production configuration change or T7 work was performed.

The retained 913-test baseline is unchanged byte-for-byte. T6 adds 37 distinct cases: 32 library/real acceptance cases, two release checks, and three UI projection cases. Existing test assertions, limits and timeouts were retained. File concurrency was bounded to one after Windows fixture cleanup failures; explicit concurrency races within tests remain concurrent.

## Capability inventory and implementation

The accepted and final positive catalogs are in capability-inventory.json. New filesystem operations are bounded metadata, hash, compare and search; writes now include atomic replacement/read-back and before/after hashes. New delegated Git reads are tracked_files, branch and commit_info with fixed arguments and suppressed hooks/config/fsmonitor/external diff/text conversion. New cross-app execution metadata, exact-step consent digests, verified artifact input references, independent Bus postconditions, safe result artifacts, checkpoint boundaries and existing-panel activity connect the adapters.

Reused operations include filesystem read/list/exists/write, bounded Git status/diff/log, T5 immutable pure-read Node checks, isolated Playwright navigation/DOM reads/metadata/extraction/waits/screenshots, and T9/T9R Calculator acquisition/focus/approved arithmetic controls/result reads. The Windows package explicitly ships lock-matching Playwright 1.63.0 and playwright-core 1.63.0 with licenses. Copied dependency bytes and the pinned source files are sealed in its manifest. Existing build-machine dependencies are reused; this is not a registry-clean reinstall.

## Authority and outcome verification

AgentRuntime owns continuity; MissionManager schedules steps/dependencies and verifies outcomes; TaskManager/BunnyRouter retain model selection; the existing Capability Bus dispatches; the existing Host/T5 store owns authority and atomic finite accounting; the user supplies consent. There is no new workflow or permission engine, provider map, memory store or event authority.

Every external execution and independent read postcondition is checked against current Agent/Mission/step identity, signed envelope revision, generation, expiry, exact operation, root/origin/native target and budget. Cross-Mission envelope substitution is denied before canonical approval shortcuts. Browser content and model tags grant nothing. Stop/revoke prevent new admission; completed effects and evidence remain. Exact reviewed origins and Calculator arithmetic controls are included in the consent view. Cross-app scope cannot silently enable legacy T9 desktop execution.

## Real integrated Mission

Agent: `1fc7c7eb-fda1-4a15-ba73-ec9a900a0540`; Mission: `f6ac2fe1-2858-489e-8076-57372e2e2e1e`. One preauthored deterministic Mission executed ten sequential steps and finished COMPLETED with all ten independently verified. It used 19 genuine capability runs and retained 21 hash-checked semantic/evidence bodies. A verified filesystem read supplied only the later file-content parameter; resource/executable identities remained concrete. Full timestamps, run/admission IDs, postcondition runs, artifact hashes and provenance are in workflow-trace.json and integrated-acceptance.json.

| Step | Role | Actual capability | Result |
|---|---|---|---|
| 1 | Inspect | filesystem.read | verified |
| 2 | Repository | git.status | verified |
| 3 | Edit | filesystem.write | verified |
| 4 | Check | terminal.exec | verified |
| 5 | Browser | browser.navigate | verified |
| 6 | Acquire | computer.open_app | verified |
| 7 | Focus | computer.focus_window | verified |
| 8 | Clear | computer.invoke_control | verified |
| 9 | Enter | computer.invoke_control | verified |
| 10 | Report | filesystem.write | verified |

The scoped repository was inspected before modification. The exact owned Node check exited 0 with `T6 CHECK PASS`; no arbitrary project script or shell was admitted. The browser navigated an isolated explicitly approved fixture origin and independently read its real DOM. Loopback was enabled only by the disposable fixture seam; production private-network policy remains refused. Real Windows UIA acquired/reused a verified Calculator native package/lifetime, focused it, cleared to 0, invoked digit 2 and independently read display 2. The final report file was read back through a separate capability postcondition.

Initial finite consent covered multiple actions without redundant prompts. A second consent was deliberately required after the genuine Host restart; total consent count is two and redundant per-action prompts are zero.

## Restart, replay and model routing

The first owned disposable Host PID 26760 exited after the committed terminal-check boundary. A genuinely fresh process PID 26696, with a new Host generation, loaded the same Agent/Mission/SQLite identities. Historical transient authority was WAITING_FOR_USER and could not admit work until fresh reviewed consent. Completed writes/test were consumed without replay: exactly two distinct file writes, one terminal execution and one application acquisition occurred. Current native target observations remain execution state, never authority. Unknown browser/GUI effects classify ask_user; controlled adverse-target/focus/retry probes are labeled SIMULATED in the matrix.

T3 routing integration is retained through actual TaskManager/Router eligibility, retry and retarget tests, including T5 A07/A23/A39/A44 and A22. Provider transport is simulated in those tests; no live external model result or quota is claimed. The new X30/X31 admission probes show that rerouting, a specialized local model tag or refusal cannot enlarge consent. The primary integrated OS workflow uses zero model calls. T6 reasoning can use the existing tool-free local Ollama boundary; workspace CLI tools and new provider authority require separate review.

## Security and regressions

X01–X55 are recorded with initial state, action, expected/actual result, evidence and classification in adversarial-matrix.json: 54 passing rows, 1 observation limitation, zero failed probes. X55's installed-process continuity gap is retained; it is not presented as unchanged PIDs. Native adverse responses for X24/X25/X27/X38/X39 and provider I/O are explicitly controlled; real filesystem/terminal/Git/browser/UIA positives come from the integrated Mission. No unresolved BLOCKER/HIGH authority defect remains after the X48 and legacy T9 fixes.

Final `npm test`: 256 script + 611 library + 24 Agent = 891 passed, zero failures/skips. Final `npm run test:ui`: 59 passed, zero failures/skips. Distinct total: **950 = 913 retained + 37 added**. Focused reruns and manual supplemental probes are not added to this count. Typecheck passed. Lint passed with zero errors and 22 existing warnings. Desktop build and full pinned Windows test packaging passed. The packaged browser was launched with the shipped node.exe/API; manifest, import closure and byte-for-byte pinned source checks passed. Package was not installed.

The full security regression includes T1/T2/T3/T4/T5, T9/T9R, canonical private state/root/junction guards, SSE/device/remote revocation, Git helper ownership, Windows kernel breakaway containment, and real browser DNS/redirect/subresource/rebinding fences. An unrelated real process sentinel survives TaskManager Stop. The pre-existing Calculator's native lifetimes survive owned Host cleanup. Historical failures and their resolutions remain in failure-ledger.json and the original logs; test-generated T5 rerun evidence is copied into T6 and original historical T5 bytes restored.

## UI acceptance and production

Real dev and built-output browser renders showed visible content without console/runtime errors or horizontal overflow. The existing Agents/Mission UI was inspected at 1280×800, 1920×1080 and 390×844. Completed, waiting-consent and failed-verification projections were exercised. Expanding a completed Agent exposes steps/verified artifacts; the artifact button opens the existing Mission verification view. Exact access cards wrap on mobile and controls remain usable. CUA provided interaction QA because agent-browser was unavailable. The existing Mission popover auto-collapse timing is retained.

The dev bridge cannot establish a trusted peer and fails closed; the built native desktop bridge connects. This explains the smoke baseline body-text difference; neither page is blank or has a module/hydration error. Dev remains running under the unchanged startup.sh contract. Screenshots and complete verdicts are included in evidence.

Installed production remains Bunny-A-Windows-v26-MA2-R1. A final read-only audit verifies all 160 installed manifest files, unchanged schema, Missions/triggers disabled, no MA3 tables, unchanged startup.sh and unchanged protected user files. No production release, database/configuration, Startup, device, remote consent, tunnel or provider mutation was performed. **Production process continuity is not proven:** initial runtime PIDs 52164/16924 were later 13672/23016 under the installed Bunny GUI, whose new parent started at 06:01 UTC. The cause was not established. This is recorded in production-final.json and the failed continuity assertion is preserved. It does not justify touching production.

## Unsupported operations and remaining limits

T6 delegation excludes arbitrary shells/npm/project scripts, Git push/write/worktree mutations, browser forms/click/type/download/publication, personal browser sessions, arbitrary Windows apps/raw coordinate input, messaging, credentials/system changes, unrestricted provider CLI tools, and T7. Existing direct legacy capabilities retain their own specific approvals. General-purpose desktop/browser execution requires additional reviewed contracts and independent postconditions. Installed Chrome/Edge or a compatible bundled Chromium is needed; browser acquisition fails closed if unavailable. Native adverse-target/focus cases and provider transport are controlled test seams, separately classified. Production PID continuity and the dev trusted-peer limitation remain openly recorded.

Evidence root: `test-results/ma3/t6/`. INDEX.md seals the report, required JSON/Markdown artifacts, original failure logs, screenshot verdicts and package manifest with SHA-256. Browser profiles, raw credentials, canonical databases and package binaries are excluded from committed evidence. The separate test package remains locally available under packages/Bunny-A-Windows-v27-MA3-T6-final-test.

## Exact source files changed

- `package.json`
- `scripts/bunny-release.mjs`
- `scripts/cross-app-package.test.mjs`
- `scripts/fixtures/cross-app-host-worker.mjs`
- `scripts/package-browser-runtime.mjs`
- `scripts/package-bunny-desktop.ps1`
- `src/components/island/agent-cross-app.test.ts`
- `src/components/island/agent-model.ts`
- `src/components/island/agent.tsx`
- `src/lib/bunny-host/agent-replay.ts`
- `src/lib/bunny-host/agent-runtime.server.ts`
- `src/lib/bunny-host/agent-types.ts`
- `src/lib/bunny-missions/agentic-store.server.ts`
- `src/lib/bunny-missions/agentic-types.ts`
- `src/lib/bunny-missions/authorization.server.ts`
- `src/lib/bunny-missions/capabilities/browser-network.server.ts`
- `src/lib/bunny-missions/capabilities/browser.server.ts`
- `src/lib/bunny-missions/capabilities/bus.server.ts`
- `src/lib/bunny-missions/capabilities/computer.server.ts`
- `src/lib/bunny-missions/capabilities/local.server.ts`
- `src/lib/bunny-missions/cross-app-live.test.ts`
- `src/lib/bunny-missions/cross-app.test.ts`
- `src/lib/bunny-missions/cross-app.ts`
- `src/lib/bunny-missions/manager.server.ts`
- `src/lib/bunny-missions/paths.server.ts`
- `src/lib/bunny-missions/planner.server.ts`
- `src/lib/bunny-missions/store.server.ts`
- `src/lib/bunny-missions/types.ts`

BUNNY_MA3_T6_PASS_WITH_LIMITATIONS
