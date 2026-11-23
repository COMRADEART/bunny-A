# Bunny-A M2 Report

October 2, 2026. Continued the existing terminal task after its session limit, preserved the v10 implementation and Apple-inspired interface, and completed verification and handoff. Real-agent acceptance below was captured by that terminal task; this continuation freshly reran the regression gates, reread the three output files, audited the running Host and checked the production gateway and public companion. No extra paid agent runs or new pairing codes were needed.

## Host

- **Status:** running as an independent background process. The current deployment is `releases/Bunny-A-Windows-v10`; its gateway is healthy, and the registry reports Ollama, Codex and Claude ready. No tasks were active at the continuation audit. [Sanitized audit](test-results/m2/resumed-audit.json).
- **Startup status:** the installed per-user Windows login shortcut starts the Host, gateway, approved tunnel and compact Island. Shortcut target and arguments were verified. An actual Windows reboot was not performed. This is a background process started at login, not a Windows Service Control Manager service.
- **Persistence status:** private SQLite state retains tasks, approvals, events, provider observations, sessions, outcomes, projects and policy records. Registry discovery and usage refresh belong to the Host, independent of any UI. Saved readiness alone does not make a provider eligible before a probe in the current Host run.
- **Preservation:** existing Ollama execution, Host data, startup shortcut, Android package, prior releases and recovery materials remain in place. This continuation changed only lint housekeeping and handoff documentation; it did not replace the architecture or redesign the interface.

## Provider discovery

| Provider | Installed | Version | Auth | Status | Usage source |
| --- | --- | --- | --- | --- | --- |
| Ollama | Yes | 0.35.0 | Not required | Ready; four local models detected | Local model/runtime observations; no subscription quota |
| Codex | Yes | codex-cli 0.153.4 | Authenticated | Ready | Official `account/rateLimits/read`, with report time and reset times |
| Claude Code | Yes | 2.1.287 | Authenticated | Ready | Provider `rate_limit_event` from Bunny-A-owned sessions; latest observation persisted and time-labelled |
| OpenCode | Yes | 1.18.34 | Unknown | Unavailable for routing | Unavailable |
| Cline | Yes | 3.0.67 | Unknown | Unavailable for routing | Unavailable |
| Cursor Agent | Yes | 2026.09.10-fd3934a | Not authenticated | Unavailable for routing | Unavailable |

Executable paths, capabilities, unsupported-feature reasons and usage provenance are in the [Host audit](test-results/m2/resumed-audit.json). OpenCode credential presence was detected but not validated. Cline's version came from its installed manifest; discovery avoids launching its self-updating CLI. Cursor reports that it is not signed in. These optional providers have detection support, not execution adapters, and cannot win routing.

Discovery is bounded and cached by the Host: primary probes every ten minutes, optional detection every thirty minutes and Codex usage every five minutes, with cheaper health checks between. Claude quota observations are not an independent account-wide polling API. Stale or missing reports remain distinguishable from current data.

## Execution

| Provider | Test | Result | Session proof | Filesystem proof |
| --- | --- | --- | --- | --- |
| Codex | Create and read back `bunny_codex_test.txt` | PASS; exit 0 | `01a0fae9-7e5a-78b1-a574-a1d56bd43a50`; genuine CLI launch and streamed events | Exact `BUNNY_A_CODEX_OK`, no trailing newline; independent Host read |
| Claude Code | Create and read back `bunny_claude_test.txt` | PASS; exit 0 | `50732357-368a-4b37-80ee-e1bd4d1903b9`; genuine CLI launch and streamed events | Exact `BUNNY_A_CLAUDE_OK`, no trailing newline; independent Host read |
| Claude Code, selected automatically | Create `hello.py`, run it and verify stdout | PASS; exit 0 | `86a14e91-f43d-4d3a-b7b2-36b231d9b617`; automatic route, actual provider session | `print("BUNNY_ROUTE_OK")\n`; independent Python run returned `BUNNY_ROUTE_OK` |

Each test passed nine acceptance checks, including approval before launch. Codex and Claude provider-specific tests used explicit overrides to isolate each adapter. The third test used automatic routing. Absolute working directories, paths, process/session details, commands and event streams: [Codex](test-results/m2/live-codex.json), [Claude](test-results/m2/live-claude.json), [automatic route](test-results/m2/live-route.json). All work occurred in disposable validation directories. The continuation independently reread all three files and confirmed they still match: [fresh filesystem proof](test-results/m2/resumed-filesystem-proof.json).

## Router

- **Selected provider:** Claude Code for the automatic `hello.py` test, Balanced mode; no manual override.
- **Scores:** Claude 0.5550; Codex 0.5009. These are routing scores, not measured success probabilities. Confidence 0.65574 is explicitly uncalibrated.
- **Constraints:** filesystem and terminal required. Both eligible providers satisfied them. Ollama was excluded for lacking filesystem capability; OpenCode, Cline and Cursor were excluded as unavailable. Local/offline requirements, allow/deny lists, Git/GPU capabilities and project working-directory requirements are checked before ranking. Overrides cannot bypass eligibility.
- **Alternatives:** Codex was the eligible alternative. The decision retained excluded providers and their concrete reasons, plus weights, workload, quota observations and history inputs.
- **Approval behavior:** submit produced a reviewable recommendation and `waiting_for_approval`; the journal shows approval before `agent.started`. No approval means no launch. Genuine cwd context is not an OS filesystem jail; provider permission/sandbox mechanisms govern tool access.
- **Replay:** fifteen replay rows produced no route changes versus v8; all eleven labelled seed cases passed in both versions. This is regression evidence, not proof of general routing accuracy. [Replay](test-results/m2/router-replay.json).

## Island

- **Real events observed:** Codex and Claude starting, working, editing, running an actual command, provider completion, Bunny-A independent verification and final completion. The native Island showed the same task/session activity. [Codex observation](test-results/m2/live-island/codex/island-observed.json), [Claude observation](test-results/m2/live-island/claude/island-observed.json), [route observation](test-results/m2/live-island/route/island-observed.json).
- **Progress behavior:** indeterminate activity unless the provider supplies a finite plan; then completed/total steps are shown. Elapsed time is not converted to a fabricated percentage. Provider completion and Bunny-A verification are separate states.
- **Terminal behavior:** real command events and output are visible. Interactive terminal attachment, send-input, pause and resume are unsupported and explicitly labelled; Terminal is disabled rather than simulated.
- **Usage ring behavior:** Codex short-window and weekly rings are separate, with report/reset times. Claude uses actual provider-stream observations when available. Observed Bunny-A task counts and outcomes are separate from provider-reported quotas. Missing sensor or quota data is shown as unavailable.
- **Stop:** pressing the actual Island Stop button ended all eleven verified processes in the selected Codex-owned tree, including its harmless Python sleeper. No descendants remained; another Ollama job, two unrelated test terminals and eighteen pre-existing agent processes were untouched. Host stayed healthy and Island showed Stopped. All eleven checks passed. [Stop evidence](test-results/m2/stop-test/stop-test.json).

## Persistence

- **UI-close test:** the Island window and process exited while a real Ollama generation was streaming. The Host remained healthy and output continued growing. Eight checks passed. [Evidence](test-results/m2/reconnect-test/reconnect-island.json).
- **Reconnect test:** reopening Island restored the same running task and live activity. Reloading the dashboard preserved the Host-owned task/session and output grew from 95 to 209 characters; seven dashboard checks passed. [Evidence](test-results/m2/reconnect-test/reconnect-dashboard.json).
- **Boundary:** a Host crash/restart differs from closing a UI. Current CLI adapters cannot reattach lost output pipes after the Host process dies. Persisted process IDs are not sufficient authorization to terminate anything.

## Phone

- **Remote task test:** all eight checks passed over the approved public HTTPS gateway: unpaired denial, pairing, routed submission waiting for approval, actual workstation Ollama execution, real `BUNNY_PHONE_OK` result, live normalized activity, clean page errors and denial after test-device revocation. [Evidence](test-results/m2/phone-test/phone-test.json). Verification devices were revoked.
- **Fresh remote check:** the current public companion renders on desktop and mobile, shows Not paired and exposes no task data to this fresh visitor. Both screenshots were visually inspected; no console/page errors or horizontal overflow. [Verdict](screenshots/bunny-m2-resumed-phone.json).
- **Physical Android test status:** NOT TESTED; no connected Android hardware or emulator was available. Browser verification is not hardware validation. The preserved Android v2 APK loads the hosted companion.
- **Connection status:** the current temporary address is [Bunny-A Phone](https://common-dave-painted-productivity.trycloudflare.com/?companion=1). **Phone** in Island is authoritative after a tunnel restart. Stable named-tunnel support exists but account/domain credentials are unconfigured. [Stable connection configuration and recovery](BUNNY_REMOTE.md).

## Learning

- **Recorded task evidence:** persisted provider/model, task category and mode, complexity, routing scores, override status, duration, stop/outcome, independent verification, retries, feedback and token/resource values where actually reported. Unknown values are not invented.
- **Provider performance profile state:** Claude coding/general and Codex coding have one independently verified completion per class; each is below the five-sample threshold. Codex general records the Stop test. Ollama general has seven completed but unverified outcomes; Ollama writing records four stopped runs. This is sparse operational evidence, not a validated measure of answer quality. [Profile audit](test-results/m2/resumed-audit.json).
- Bounded history adjustments and candidate replay/promotion/rollback are implemented. Unverified completion contributes no verified success, although recorded outcomes can affect the bounded history adjustment after the threshold. User stops are excluded from quality decisions. No new policy was promoted in this continuation, and no broad self-improvement claim is made.

## Tests

- **Unit:** fresh `npm test` passed **302/302**, zero failures or skips: 199 script tests and 103 application/Host tests. [Log](test-results/m2/resumed-baseline-tests.log).
- **Integration:** real Codex/Claude/automatic-route tests, native Stop isolation, UI close/reconnect, public HTTPS pairing/execution/revocation and sixteen desktop/mobile dashboard checks passed. [Dashboard evidence](test-results/m2/dashboard-v10-live/results.json).
- **Typecheck:** passed. [Log](test-results/m2/resumed-typecheck.log).
- **Lint:** passed with zero errors and two existing warnings, in legacy Quorum UI and the auth hook. Added a comment explaining the existing empty token-parser fallback; excluded generated releases, evidence, private runtime data and recovery archives from source lint. [Full lint log](test-results/m2/resumed-full-lint.log).
- **Production build:** standard build passed. [Log](test-results/m2/resumed-build.log). Development and the actual v10 Windows production gateway passed desktop/mobile render checks with clean consoles, visible content, no overflow and **no baseline divergence**. Both viewport screenshots were visually inspected. [Dev verdict](screenshots/bunny-m2-resumed-dev.json), [production gateway verdict](screenshots/bunny-m2-resumed-gateway.json).
- **Generic web preview limitation:** the freshly built Vercel-oriented preview renders cleanly but reports Host offline and diverges from the connected development baseline. Providing an absolute Host data path did not resolve it. It is not accepted as a connected Windows Host verification; the packaged standalone gateway was separately verified successfully. [Preview diagnostic](screenshots/bunny-m2-resumed-built-absolute-data.json). No security check was relaxed to hide this distinction.
- **Release integrity:** v10 ZIP SHA-256 `814D5C0D832848B500DA7179AB697A4A02AD013121EDE1485A0A600C0F53E9B7`. Existing prior releases remain preserved.

## Remaining blockers

1. OpenCode, Cline and Cursor execution adapters are not implemented; Cursor also needs sign-in, and OpenCode/Cline auth is unvalidated.
2. Interactive terminal attachment, send-input, permission continuation, pause/resume and reattachment after an actual Host crash are unsupported.
3. A permanent remote hostname requires an account/domain and named-tunnel credentials. Current quick-tunnel recovery can require an identity-checked child restart if Cloudflare invalidates its tunnel without the child exiting. Named mode has not been activated against a real domain.
4. Physical Android installation, Android background push, wake/sleep behavior and an actual Windows reboot remain untested or unconfigured.
5. The generic Vercel-oriented preview does not connect to the local Host; the tested Windows standalone gateway does. A cloud deployment must not imply access to this workstation without a separately configured authorized transport.
6. Sparse independently verified outcomes do not establish improved routing accuracy. CPU/Intel sensors and unsupported provider quotas remain unavailable. Two non-blocking legacy lint warnings remain.

## Git

- **Branch:** `main`.
- **Commits:** HEAD `eae148b` — Export from Grok. No commits were created by this continuation; existing local work was preserved.
- **Changed files:** existing Host/discovery/registry/adapters/events/process-tree/router/persistence/learning modules, dashboard/store/native installation, gateway/tunnel/validation/package scripts, branding, Android source and generated output remain uncommitted. Continuation-specific source housekeeping: `eslint.config.mjs` and `src/lib/app-data/client.server.ts`. Handoff: this report, `BUNNY_REMOTE.md`, `BUNNY_INSTALLATION.md`, `BUNNY_TAKEOVER.md`, plus fresh ignored test/render evidence. [Complete status snapshot](test-results/m2/resumed-git-status.txt).
- **Clean/dirty status:** dirty, intentionally preserved. No reset, clean, destructive checkout or history rewrite was performed.
