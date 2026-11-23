# MA3 T8 Premium UI Acceptance

Result: PASS WITH LIMITATIONS. Final implementation source **987afeace77520b9f4ef49e27b137dd01fb3fee8**, branch **codex/ma3-t8-premium-ui**. Accepted baseline 8b71167ba13de496ba25a6f78a7c70e99b388284 is an ancestor; evidence-only T7 descendant e668ce2 was retained. No history reset, cleanup, push, production install, migration, production restart, Startup edit, tunnel edit or provider configuration change was performed. T9 was not started.

## Product and design

Seven destinations share semantic light/dark tokens, restrained blue actions, Segoe UI/system typography, consistent spacing, flat panels, readable labeled status, focus rings, responsive navigation and reduced motion. Regular Bunny chat is separate from persistent Agentic work. Home provides real Host counts and verified results; unknown counts stay unknown while loading. Agentic includes overview/filter/page, accepted plan/dependencies, distinct activity/conversation/results, scope revision review and verified artifacts. Projects retains its T7 services and lifecycle. Models/usage preserves T1/T2/T3 facts and UNKNOWN semantics. Devices uses existing pairing controls and explains the later phone gate. Settings exposes actual Host settings, and web Appearance contains only working theme and motion controls.

## Architecture and commands

UI → Host API/SSE → AgentRuntime → MissionManager → TaskManager → BunnyRouter → adapters remains canonical. No extra scheduler, router, authorization authority or event store. The SSE bridge authenticates via existing peer/origin/device checks and transmits only sequence signals. Canonical snapshots own reconciliation and entity state. Control acknowledgments update snapshots; no optimistic completion. UI focus IDs are not canonical records. Legacy local data is no longer silently imported.

Pause, Resume, Stop, approve/adjust/deny/revoke, Project lifecycle, artifact opening, discovery and usage refresh use existing commands. Stop explains admission boundaries and retained effects. Talk/Redirect are disabled and explained because the Host has no supported free-form Agent conversation/redirect command. Model identity is not inferred from provider names.

## Live verification

A real disposable SQLite Host contains separate Projects, completed verified work, pending scopes, and paused work. Actual browser actions reduced a scope to 8 actions/30 minutes, removed filesystem.list and advanced its revision; denial produced STOPPED/REVOKED. Built UI repeated permission denial, Pause, refused unauthorized Resume and confirmed Stop. A verified artifact opened through Project scope and hash verification. Project favorite/search/filter/sort/archive/restore/relink and long-name/path registration were driven in the actual UI.

A real process shutdown/restart was observed as offline, permission controls disabled, then a fresh Host epoch reconciled stable IDs. Completed results and revoked consent persisted; pending consent remained blocked. Replay/deduplication, stale scope, hash corruption, Project isolation and device revocation also passed existing or focused test cases; classifications are explicit in the JSON evidence.

The final pinned Windows package was built from 987afeace77520b9f4ef49e27b137dd01fb3fee8; file hashes, import closure and source provenance passed. Its bundled middleware rendered in a supported local HTTP test adapter; the installed fixed-port gateway was not replaced. Native WPF smoke hooks raised the existing button events against the real disposable Host: pending review, Pause acknowledgment, missing-consent Resume refusal, Stop confirmation/acknowledgment, window closure/reopen, minimize/restore and explicit offline presentation. Navigation was recorded without opening production; the deep link was separately verified in the package browser.

## Responsive and accessibility

Agentic was inspected at 390×844, 768×1024, 1280×800 and 1920×1080 in light/dark themes; seven destinations were also checked on mobile and desktop. Retained screenshots and DOM layout measurements show no horizontal overflow. Long Project names/Windows paths were registered and displayed. Model-long-string handling is a static layout verification; no catalogue record was fabricated. Browser Tab focus, 2 px visible focus rings, dialog wrap/Escape/focus return, named controls, 44 px observed Agent controls and reduced-motion transition removal were verified. Token contrast ratios are in accessibility-results.json. Physical screen-reader certification, secondary-monitor DPI and physical phone testing are NOT TESTED.

## Regression and preservation

Final complete baseline: 256 script + 650 library + 24 Agent + 59 original UI = **989 passed**. New T8 tests: **19 passed**; UI lane **78**, distinct total **1008**, zero failures, skips, cancelled or todo. Existing baseline test-file hashes are unchanged. Build and typecheck passed; lint has zero errors and 23 warnings (22 pre-existing plus one Fast Refresh export warning). Previous-gate regenerated evidence was copied into T8 and the original tracked bytes restored. Protected reports and memory hashes are unchanged.

Production was read through a consistent read-only SQLite transaction. Schema, settings, process identities/creation times and installed v26 manifest were compared. No production command was issued; configured Mission/scheduling/trigger state was not changed. Details and any ordinary count changes are reported in production-final.json rather than inferred from UI tests.

## Explicit limitations

No physical phone/T9, voice streaming, secondary-monitor DPI or physical native keyboard claim. Native navigation was intercepted to protect the installed gateway. No live hosted-provider inference or sourced paid-provider quota was exercised in the zero-provider UI fixture; T1/T2/T3 simulated and existing regression coverage is separate. Approved-consent Resume is covered by the existing runtime/authorization test suite; the new live UI/native scenario deliberately verifies refusal without consent. Closing a Bar with a paused/pending Agent and Host survival was live verified; closure during a real paid-provider session was NOT TESTED. Full free-form Agent talk/redirect remains unsupported.

Evidence: INDEX.md and INDEX.sha256 seal the retained files; package payload directories are excluded from Git and represented by pinned manifest/closure/source-check evidence. Runtime credentials, SQLite databases, private transcripts and generated executables are not in the evidence commit.

## Changed source files and evidence boundary

- install/Bunny-Island.Presentation.ps1
- install/Bunny-Island.Visual.ps1
- src/components/island/activity.tsx
- src/components/island/agent.tsx
- src/components/island/agentic.tsx
- src/components/island/host-stream.ts
- src/components/island/premium-model.test.ts
- src/components/island/premium.css
- src/components/island/premium.tsx
- src/components/island/projects.tsx
- src/components/island/settings.tsx
- src/components/island/task.tsx
- src/components/island/workspace-model.ts
- src/components/island/workspace.tsx
- src/lib/bunny-host/event-signal.ts
- src/lib/bunny-host/http.server.ts
- src/routeTree.gen.ts
- src/routes/api/bunny-events.ts
- src/store/use-island.ts

The 73 requested V/A/P/B cases are mapped in acceptance-matrix.json with evidence classes and per-case limitations. failed-attempts-and-repairs.md preserves setup/compiler/visual repairs. The final test package retains legacy v26 semantic version and release-pin metadata from existing tooling, while release-manifest.json pins the actual T8 source/tooling and R4 TEST package name. No production-release claim is made.

Production runtime environment was not inspected. Its persisted Mission configuration is absent, source defaults disable Missions/Triggers, before/after settings/schema/counts/processes/installed files are unchanged, and no enabling command was issued. The earlier T6 process rotation cause remains unexplained.

Keyboard acceptance covers observed navigation and dialog interactions; exhaustive traversal of every subpanel is not claimed. Live long model identifiers were unavailable; wrapping is statically verified. Both limitations accompany the physical-screen-reader/native-keyboard/phone/DPI limits above.

BUNNY_MA3_T8_PASS_WITH_LIMITATIONS

