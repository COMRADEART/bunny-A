# Bunny-A M3 — visual rebuild and motion system

The M3 implementation is ready for review in the current workspace and a new Windows package. The Island, desktop, and phone share blue-black glass, restrained blue/violet accents, warm Claude orange, and a warm light theme. Full acceptance remains pending the missing concept image, a successful current Claude run, and a working public HTTPS endpoint.

## Deliverables

- [Windows v12 M3 ZIP](C:/Users/<user>/Documents/new/bun-router/releases/Bunny-A-Windows-v12-M3.zip)
- [Browser screenshot gallery](C:/Users/<user>/Documents/new/bun-router/screenshots/m3/index.html): 24 views, including all 23 requested states and OS reduced motion.
- [Native screenshot gallery](C:/Users/<user>/Documents/new/bun-router/screenshots/m3/native/index.html): 17 views captured from the final package.
- [Screenshot provenance](C:/Users/<user>/Documents/new/bun-router/screenshots/m3/gallery.json), [visual review record](C:/Users/<user>/Documents/new/bun-router/test-results/m3/visual-review.json), and [final audit](C:/Users/<user>/Documents/new/bun-router/test-results/m3/final-audit.json).

ZIP SHA256: `F4EC85686A248C8472E8D103987B35445A8277ACB4F728382DD5E683E2489B1B`.

The new package contains the final native modules and the tested standalone production browser build. The existing installed v10 deployment and gateway remain in place; this package has not replaced them. The current development preview and the separately verified production preview remain available.

## What changed

| Surface | Result |
| --- | --- |
| Shared design | Color, glass, type, radius, and motion tokens; Segoe UI Variable where available; dark and warm light glass; phone layout and contrast support. |
| Everyday Island | Compact top-center default; the same surface expands into composer, route, approval, task, system, constellation, and settings. Keyboard routing and Escape collapse retain the existing commands. |
| Bunny orb | Semantic idle, listening, routing, working, waiting, completed, failed, and offline presentation. Completion uses a short check; warnings stay restrained. Native speech has an explicit unavailable state. |
| Routing and approval | Real score-driven paths and emphasis, concise approval facts, expanded provider comparison, eligible-provider selection, and clear cloud Ollama disclosure. Scores are labelled as routing scores, never success probabilities. |
| Task observability | Prompt → Route → Approve → Work → Verify → Complete journey; genuine finite progress only when a denominator exists; indeterminate activity otherwise; sanitized real events and a compact activity ribbon. |
| Multiple agents | Real active assignments, provider identity, elapsed time, event-count sparklines, focus controls, and optional constellation. Working paths animate; unavailable handoff records are stated explicitly. |
| Replay | Persisted events and timestamped retained logs drive scrubbing. Future provider selection, output, verification, and artifacts stay hidden until their recorded time. No gaps or private reasoning are invented. Native Open task leads to the full application. |
| Usage and telemetry | Actual quota rings only; observed usage labelled separately; no Ollama subscription rings. CPU, memory, detected GPUs, real sample graphs, Mixed micro telemetry, and fresh measured thermal warnings. Unsupported NPU and absent sensor values remain hidden/unavailable. |
| Completion and files | Independently verified files appear with known filename/path. Native Open and Show folder use a checked real file. Browser file opening, thumbnails, page counts, diffs, and sizes remain unavailable when the Host supplies no such capability or metadata. |
| Desktop and phone | Home, Agents, Tasks, Projects, System, and Settings; real activity and history; a simpler dark/light companion with approval focus and the same Host pipeline. |
| Voice and preferences | Optional browser speech becomes an editable draft and uses the existing route/approval flow. Speech errors/unavailability are shown. Motion Full/Reduced/Off, OS reduction, position, size, idle content, glass, collapse, theme, and primary-provider controls remain functional. |

Motion durations are centralized. Orb, paths, ribbon, and notification movement communicates current state; OS reduced motion and forced colors take priority. No 60 FPS benchmark or live microphone transcription result is claimed.

## Preservation and regression evidence

The initial checkpoint preserves 376 files, Git status, and binary patches at `artifacts/checkpoints/bunny-m3-20261002-065441`. Its working-tree ZIP SHA256 is `0072E1B43EB7EB3A41380D0F48FF1F8F69E9EE540EC8DAD558644C5B6C25636B`. Earlier package candidates were archived inside that checkpoint before replacing the candidate ZIP. No reset, clean, or commit was performed.

[The final audit](C:/Users/<user>/Documents/new/bun-router/test-results/m3/final-audit.json) passed. The Host remains instance `4dcf9a59-601d-4996-8e6c-b4861c5455c2`, PID `12444`. All original 34 tasks remain with identical task records; 9 scoped regression tasks were added and are terminal. Telemetry continues, verified learning outcomes remain, and the temporary pairing device was revoked. SQLite was neither reset nor migrated for this milestone.

All 59 frozen entries were checked. Backend, orchestration, provider execution/discovery, router, persistence, pairing, remote configuration, Stop isolation, and v10 release hashes are unchanged. The only allowed manifest difference is the packaging script copying the new UI-only native Motion module.

| Check | Outcome and evidence |
| --- | --- |
| Existing regression suite | 199 script tests + 103 application tests passed: [log](C:/Users/<user>/Documents/new/bun-router/test-results/m3/regression-tests.log). |
| UI semantics | 12 tests passed, including score weighting, private-event filtering, replay chronology, finite progress, thermal provenance, and artifact claims: [log](C:/Users/<user>/Documents/new/bun-router/test-results/m3/motion-tests.log). Total: 314 passing tests across these suites. |
| Type/build/lint | Typecheck and default production build passed. UI lint: 0 errors, 8 component-export Fast Refresh warnings. New motion model/component lint: 0 errors/warnings. |
| Native package | PowerShell execution and 17-view smoke passed using final packaged modules. Immediate expanded-view sizing, comparison without automatic retarget, routing/assignment motion, OS policy, reduced/off, and UI close were checked. Three packaging tests also passed. |
| Real Codex | Approved task ran a genuine session, created/read the exact requested file, and passed independent Host verification: [evidence](C:/Users/<user>/Documents/new/bun-router/test-results/m3/codex.json). |
| Real Ollama | Routed through the UI, waited for approval, then returned `BUNNY_M3_UI_OK`: [evidence](C:/Users/<user>/Documents/new/bun-router/test-results/m3/ollama.json). Its selected model is cloud-backed and is labelled accordingly. |
| Automatic routing | Actual automatic route, approval, file creation, and Host Python verification passed. The original runner's extra `python` command was unavailable in the restricted shell; bundled Python independently ran the exact checked file, printed `BUNNY_ROUTE_OK`, and exited 0: [combined evidence](C:/Users/<user>/Documents/new/bun-router/test-results/m3/automatic-route-independent.json). Original runner evidence is retained. |
| Stop and reconnect | Real UI Stop ended only the selected Codex process tree; the other pending task stayed unstarted and completed history stayed intact. Dashboard reattachment and native close retained the same Host: [Stop evidence](C:/Users/<user>/Documents/new/bun-router/test-results/m3/task-control.json), [preservation](C:/Users/<user>/Documents/new/bun-router/test-results/m3/preservation.json). |
| Pairing and remote control | Nine checks passed through the new packaged middleware: unpaired/cross-origin refusal, secure HttpOnly one-time pairing, shared Host access, remote project refusal, approval gating, real Ollama execution, isolated cancellation, and immediate revocation. This was a loopback HTTPS-header simulation, not public TLS: [evidence](C:/Users/<user>/Documents/new/bun-router/test-results/m3/gateway-loopback-validation.json). |
| Browser render | Dev and fresh packaged production desktop/mobile views rendered, with no horizontal overflow, module/MIME failure, hydration error, or uncaught application exception. Text differed because real regression tasks changed history between captures. |
| Accessibility | 200% pixel density, keyboard collapse/focus restoration, actual light-theme selection, forced colors, and OS reduced motion passed: [evidence](C:/Users/<user>/Documents/new/bun-router/test-results/m3/accessibility.json). |

## Visual review and remaining acceptance gaps

All 24 browser states, 17 native views, both dev/production desktop/mobile pairs, and high-DPI/contrast captures were visually inspected. Review caught and fixed phone overflow, stretched provider rings, route endpoints, clipped proof labels, replay capture overlap, native view sizing, UTF-8 fixture decoding, and empty native comparison selection. Native historical screenshots use their recorded time. Finite-plan, thermal-warning, and unsupported-speech fixtures are visibly labelled, isolated to QA memory, and never written to the Host or used as execution evidence.

The sole browser console resource error is the preserved external Grok branding script being blocked by this environment (`ERR_NETWORK_ACCESS_DENIED`). Application exceptions are empty. The existing placeholder share card remains, following the OG skill's unavailable image-pipeline fallback; no branding was removed.

These acceptance items are still unavailable:

1. **Exact concept comparison:** the attachment contains the request text, but no concept image was supplied or found. The implemented palette follows the written requirements; exact image matching cannot be certified.
2. **Current Claude execution:** a full reprobe still reports `rate_limited`; the normal Host submit gate refuses that provider. Historical Claude results are retained, but they do not count as a new M3 run. [Evidence](C:/Users/<user>/Documents/new/bun-router/test-results/m3/claude.json).
3. **Public HTTPS:** the saved address is `https://api.trycloudflare.com`, and it does not reach Bunny-A. Pairing/control logic passed on the fresh production package, but public TLS and phone access away from the workstation remain unverified. Consent and configuration were preserved. [Evidence](C:/Users/<user>/Documents/new/bun-router/test-results/m3/public-https.json).

The normal production-preview restart encountered Windows CIM access denial. Fresh standalone packaged middleware was therefore tested on a separate loopback listener, preserving the installed gateway. This does not substitute for the public HTTPS acceptance item above.

The 9:20 a.m. continuation ran in this chat and resumed the saved implementation. The one-shot follow-up is stopped after delivery; outstanding external acceptance is recorded here rather than reported as passed.
