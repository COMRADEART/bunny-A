# Bunny-A visual system implementation — 2 October 2026

The native Island, desktop application, and phone companion now share a dark/light visual system. The source and Windows v11 UI package are ready for review. **Full milestone acceptance remains open:** the concept image was absent from the supplied attachments, current Claude execution is rate-limited, public HTTPS is unavailable, and Windows prevented the approved replacement of the running v10 gateway.

## What changed

The interface uses Segoe UI Variable, neutral glass surfaces, restrained blue accents, semantic status colors, rounded controls, and consistent motion. The Island presents current activity; the desktop presents history and configuration; the phone presents remote controls.

| Surface | Implementation |
| --- | --- |
| Shared visual tokens and responsive/accessibility rules | [bunny.css](C:/Users/<user>/Documents/new/bun-router/src/components/island/bunny.css) |
| Browser Island: idle, composer, routing, approval, running, expanded, multitask, completion, failure | [floating.tsx](C:/Users/<user>/Documents/new/bun-router/src/components/island/floating.tsx) |
| Native Windows Island and appearance controls | [Bunny-Island.Visual.ps1](C:/Users/<user>/Documents/new/bun-router/install/Bunny-Island.Visual.ps1), loaded by [Bunny-Island.ps1](C:/Users/<user>/Documents/new/bun-router/install/Bunny-Island.ps1) |
| Desktop shell, Today, Agents, Projects, history, notifications | [desktop.tsx](C:/Users/<user>/Documents/new/bun-router/src/components/island/desktop.tsx) |
| Shared composer, approval, task timeline, results and verified files | [task.tsx](C:/Users/<user>/Documents/new/bun-router/src/components/island/task.tsx) |
| Phone home, composer, approval and pairing | [phone.tsx](C:/Users/<user>/Documents/new/bun-router/src/components/island/phone.tsx) |
| System page, telemetry panel, thermal actions | [telemetry.tsx](C:/Users/<user>/Documents/new/bun-router/src/components/island/telemetry.tsx) |
| Nine settings groups and appearance preferences | [settings.tsx](C:/Users/<user>/Documents/new/bun-router/src/components/island/settings.tsx) |
| Provider icons, status descriptions, quota rings and activity indicators | [ui.tsx](C:/Users/<user>/Documents/new/bun-router/src/components/island/ui.tsx) |
| UI state, persistence and existing Host commands | [use-island.ts](C:/Users/<user>/Documents/new/bun-router/src/store/use-island.ts) |
| Progress, elapsed time, sensors, cloud/local classification and verified-file rules | [ui-model.ts](C:/Users/<user>/Documents/new/bun-router/src/components/island/ui-model.ts) |

The original Host bridge, provider registry, adapter execution, BunnyRouter decisions, approval state machine, SQLite records, telemetry provenance, Stop isolation, pairing and remote authorization remain the backend baseline. This pass did not replace the Host or rewrite those modules. The repository already contained substantial changes from previous milestones; the overall Git diff includes that earlier work.

The Windows packaging script now includes the new native visual module. A Windows-only Nitro tracing correction in [vite.config.ts](C:/Users/<user>/Documents/new/bun-router/vite.config.ts:179) confines dependency tracing to the real workspace dependency root, avoiding a protected-directory readlink failure. It retains dependency tracing, the existing port contracts, gated Nitro plugin and platform branding integration.

## Data and behavior

- Quota rings use observed provider windows only: inner short window, outer weekly window. Missing windows produce no invented ring. Ollama has no subscription rings.
- The detected Ollama model is `deepseek-v4.1-flash:cloud`. Approval and routing summaries disclose cloud execution; UI approval refuses that model for local-only/offline-only tasks. Unknown models are not assumed local. Cloud Ollama tasks are excluded from the thermal panel's local-inference Stop action.
- Routing and approval are distinct. Tasks remain unstarted until Run. Displayed scores are labeled as routing scores, not success probabilities.
- Determinate progress requires a finite, valid Host plan. Otherwise activity is indeterminate. Elapsed time uses actual start/finish timestamps and freezes at completion.
- Task details use normalized Host events, or retained timestamped Host logs when live events are no longer available. Raw logs remain behind Details.
- File actions require independent Host verification. Native Open/Show folder also check that the file exists inside the task's execution root. Browser file and terminal attachment paths that are unsupported remain explicitly unavailable.
- Telemetry uses measured samples with gaps preserved. Missing sensors remain unavailable. Thermal actions require fresh readings and never automatically stop a task.
- Appearance includes size, position, idle content, glass strength, collapse delay, theme and a maximum of three primary providers. Browser and native preferences persist separately because the baseline has no shared appearance-settings API.
- Keyboard focus, semantic labels, 44-pixel targets, high-contrast styles and reduced-motion behavior are implemented. Phone layouts were checked at 390 × 844 and 320 × 740 without horizontal overflow.
- Offline drafts require review before submission. The existing Host does not supply an authoritative sleeping state, so connection loss is not described as known sleep.

## Verification

| Check | Result and evidence |
| --- | --- |
| Existing tests | **302 passed**: 199 script tests and 103 application/Host tests. [Log](C:/Users/<user>/Documents/new/bun-router/test-results/ui/final-tests.log) |
| UI data/provenance tests | **6 passed**: progress, elapsed boundaries, sensor gaps, fresh thermal data, Ollama cloud/local classification, independently verified files. [Log](C:/Users/<user>/Documents/new/bun-router/test-results/ui/ui-model-tests-final.log) |
| TypeScript | Passed. [Log](C:/Users/<user>/Documents/new/bun-router/test-results/ui/typecheck-final.log) |
| Standard production build | Passed. [Log](C:/Users/<user>/Documents/new/bun-router/test-results/ui/build-final.log) |
| Windows package build | Passed. [Log](C:/Users/<user>/Documents/new/bun-router/test-results/ui/windows-package-final.log) |
| UI lint | Zero errors; seven Fast Refresh export warnings. [Log](C:/Users/<user>/Documents/new/bun-router/test-results/ui/ui-lint.log) |
| Real Codex execution | Passed with a real provider session and an independently read file containing exactly `BUNNY_A_CODEX_OK`. [Evidence](C:/Users/<user>/Documents/new/bun-router/test-results/ui/live-codex.json) |
| Real Claude execution | Provider launched, then returned its actual session-limit failure. A retry after the stated reset was refused by the preserved Host eligibility state. **Current Claude success is not verified.** [Evidence](C:/Users/<user>/Documents/new/bun-router/test-results/ui/live-claude.json), [retry](C:/Users/<user>/Documents/new/bun-router/test-results/ui/live-claude-after-reset.log) |
| Phone route → approval → Run | Passed by interacting with the UI. Task stayed unstarted at approval, then real Ollama returned exactly `BUNNY_PHONE_UI_OK`. [Evidence](C:/Users/<user>/Documents/new/bun-router/test-results/ui/phone-ui-flow.json) |
| Multitask and UI Stop | Passed with a real Codex session and a second pending task. UI Stop ended only the selected ten-process tree; the other task stayed unstarted and previous verified work stayed completed. [Evidence](C:/Users/<user>/Documents/new/bun-router/test-results/ui/task-control.json) |
| Native rendering | Native WPF captures exercise connected views, focus cycling, verified-file controls, sizing and always-on-top/no-taskbar contracts. Physical native mouse/keyboard interaction and an actual login/reconnect cycle are not fully verified. |
| Pairing and remote commands | **Nine checks passed** through the existing gateway using loopback HTTPS-header simulation: refusal before pairing, cross-origin refusal, secure HttpOnly cookie, shared Host state, remote project-registration refusal, approval gating, actual Ollama result, cancellation isolation and immediate revocation. The temporary device was revoked. **This does not verify public TLS or the new package's deployed remote frontend.** [Evidence](C:/Users/<user>/Documents/new/bun-router/test-results/ui/gateway-loopback-validation.json) |
| Host preservation | PID and instance identity match the pre-update record. [Final health record](C:/Users/<user>/Documents/new/bun-router/test-results/ui/host-after-ui-pass.json) |

Development and built pages were rendered at desktop and mobile sizes and visually inspected. The shipped Windows Node middleware connected to the real Host; screenshots and [verdict](C:/Users/<user>/Documents/new/bun-router/screenshots/ui/windows-built.json) record visible content, no horizontal overflow and no uncaught page errors. Its baseline text comparison changed only because the live temperature changed. The in-app browser also showed real provider data and no captured error logs.

The final CLI smoke runs recorded one blocked external platform-branding resource (`ERR_NETWORK_ACCESS_DENIED`), so those raw verdicts are **not described as entirely clean**. Branding was retained. The standard Vercel preview rendered but rejected local Host authentication because its request context lacked the required trusted peer information; its offline state therefore diverged from the development baseline. The separately tested Windows Node runtime supplied the correct context without weakening authorization. Evidence: [development](C:/Users/<user>/Documents/new/bun-router/screenshots/ui/dev-final.json), [Vercel preview](C:/Users/<user>/Documents/new/bun-router/screenshots/ui/built-final.json), [Host-auth probe](C:/Users/<user>/Documents/new/bun-router/test-results/ui/built-host-probe.json).

## Visual evidence

The [screenshot gallery](C:/Users/<user>/Documents/new/bun-router/screenshots/ui/index.html) contains all nineteen requested states, plus settings, task details, phone composer/approval and the built Windows application. Captures were visually inspected; each is a timestamped observation rather than a claim that its displayed values remain current.

| Requested states | Capture provenance |
| --- | --- |
| 1–2: native idle dark/light | Actual Host provider and sensor observations |
| 3–5: composer, routing, approval | Native views; approval uses a real waiting task |
| 6: determinate running | **Explicit visual fixture**; no live finite plan was observed |
| 7–9: indeterminate, activity, multitask | Real Host tasks and real Codex command events |
| 10: expanded task | Replay of a recorded real Host snapshot, after the task stopped; final capture fixes action clipping |
| 11: telemetry | Actual measured sensors |
| 12: thermal warning | **Explicit conditional layout fixture** retaining an actual reading; no live threshold crossing occurred |
| 13–14: completed/failed | Independently verified Codex output and actual Claude limit failure |
| 15–17: Today/Agents/Projects | Real history, provider observations and registered workspaces |
| 18–19: phone dark/light | Actual Host data at 390 × 844 |

Only the request text was attached. The referenced concept image was not available, so an exact side-by-side comparison cannot be supplied or asserted. High-DPI/ultrawide behavior and a full screen-reader/high-contrast audit also remain acceptance checks; implementation support alone is not a claim that those audits passed.

## Package and activation

Package: [Bunny-A-Windows-v11-UI.zip](C:/Users/<user>/Documents/new/bun-router/releases/Bunny-A-Windows-v11-UI.zip), **35,987,643 bytes**.

SHA-256: `472B6134E2FEDC485E875E86EED6DE65562C5A81F7AD4BD2D61623F6AB8DFFC4`.

The user approved replacing the gateway while keeping the Host running. Default process inspection/termination was denied, elevated tool attempts did not execute, and Windows UI automation could not control the higher-integrity gateway-management window. **The switch was not applied:** the running gateway and `.bunny-a/deployment.json` still use v10. No Host replacement, broad process kill or authorization bypass was performed. The new source preview remains available, and the new package was independently rendered against the existing Host.

The old public tunnel address no longer resolves. Reconnection through the existing authorized tunnel configuration was blocked by outbound socket permissions. The test-owned reconnect worker was stopped; no public endpoint was created. Public HTTPS access needs restoration before away-from-workstation validation can finish.

The native Island uses translucent WPF glass styling rather than Windows compositor backdrop blur. Browser surfaces use backdrop blur. The existing login/startup contract was retained; a fresh Windows login and full installed-package activation were not exercised here.

The implementation is reviewable, with tests and live-flow evidence attached. **Reference comparison, current Claude success, public HTTPS validation and installed activation remain outstanding.**
