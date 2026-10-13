# T13 independent verification evidence audit

Audit date: 2026-10-12. Scope: the preserved `test-results/ma3/t13/{perf,a11y,live-voice,live-notch,phone,notch,web}` evidence. This is an independent read and visual inspection of existing evidence, not a new live test run. No native automation, audio interaction, production operation, source edit, or commit was performed by this audit. Later source fixes need their own supplementary verification; they do not turn an old failing capture into a pass.

## Provisional acceptance conclusion

The preserved evidence supports a substantial working development application, real WPF Notch rendering, correct four-edge geometry, Host-backed Personal Agent configuration, genuine voice-worker capture/playback facts, and useful portrait phone coverage. It does **not** support unconditional T13 acceptance.

Two required product surfaces have unresolved HIGH findings in these captures: the phone companion is unusable in the required landscape viewport, and the collapsed native weapon controls are missing from the accessibility tree. The web companion also continues to show Speaking after completed audio cancellation, contrary to the explicit directive. These are product observations, not unavailable hardware configurations. The strongest defensible verdict for this evidence alone is **T13 acceptance withheld / FAIL pending remediation and verification**. If those defects are remediated and the final source is independently verified, a provisional PASS WITH LIMITATIONS may be supportable for unavailable hardware/device configurations. User approval of the final Bunny/design is unavailable in this audit, so “complete user-approved design” cannot be certified.

The original master directive was read from the user turn in `C:/Users/allam/.claude/projects/C--Users-allam-Documents-new-bun-router/35b0c361-0c81-44b1-8728-b68995af842f.jsonl`. Relevant requirements are sections 6 (character focus/details), 10 (measured performance and invisible-animation throttling), 11 (no speaking after cancellation), 18/21/24 (touch targets, phone landscape, keyboard and accessible labels), and 27 (no unresolved HIGH/BLOCKER for PASS). This audit covers neither the complete security/regression/package evidence nor production preservation; those need separate verification in the final report.

## Findings that must not be hidden by aggregate pass counts

| ID | Severity | Actual observation | Evidence and implication |
|---|---|---|---|
| E01 | HIGH | At 844×390, phone Home and Settings collapse into a narrow column, wrap headings letter by letter, and clip controls. | `phone/final/shots/live/home-landscape-844x390.png`, `settings-landscape-844x390.png`, and `phone/final/report-live.json`. Home root overflow is 65 px even though document overflow is 0. Four character targets are only 10 px wide; four quick links are 30 px wide. Settings has three 22 px theme targets and two 36 px motion targets. This is 13 undersized targets across two screens. Portrait results must not be generalized to landscape. |
| E02 | HIGH | Native collapsed weapon chips have no accessible control peer/name in the UI Automation tree. | `perf/native/uia-collapsed.json`: 28 nodes, only five focusable nodes (window, Quick controls, Open workspace, Bunny, Voice), four unnamed weapon Image nodes and bare badge glyphs. `install/Bunny-Island.Weapons.ps1:55` creates WPF Borders; line 62 makes them focusable and line 186 sets a name, but a Border's name is not exposed as a control peer in this capture. `keys-tab-collapsed.json` never records a weapon control. Since invisible Border focus may be reported as its ancestor window, the trace alone cannot prove physical Tab never reaches a Border; it does prove the weapons are inaccessible through UIA, and keyboard activation/details were not demonstrated. |
| E03 | MEDIUM, explicit requirement failure | The web companion still displays Speaking after the interrupt receipt/audio stop. | `live-voice/verifier-reanalysis.json`, `voice-timeline.json` webRows, and `shots/web-c-interrupted.png`: Speaking persists until receipt +626 ms. Host samples are already Interrupted with playing=false at +20 ms. Raw check c3 only covered Host rows and therefore missed the web failure. |
| E04 | MEDIUM performance concern | Native full-motion idle uses substantial CPU; minimize does not approach Motion Off cost. | `perf/native/cpu-*.json`: collapsed 28.07% of one core, expanded 38.02%, Motion Off 6.04%; before minimize 23.59%, minimized 18.59%. Only one short minimize comparison exists. Residual CPU suggests inadequate invisible-work throttling but is not direct proof that every animation/timer kept running. No numeric acceptance budget was supplied, so do not invent a threshold or claim “low idle cost” passed. |
| E05 | MEDIUM rendering concern | Six active character animations reduce measured web frame rate in software compositing. | `perf/web-perf-3.json`: 25.24–26.00 FPS in three visible windows versus 57.71 FPS with all document animations paused by script. This comparison implicates animation/rendering cost in this environment; it does not measure a GPU desktop or physical phone. |
| E06 | MEDIUM interaction finding | Studio Escape-close check fails; explicit Close restores focus. | `perf/web-perf.json` → studioEditor: Enter focuses the slot heading; Escape leaves two textareas/two inputs and focus on the heading; focusReturnedToTrigger=false. No role=dialog/aria-modal. `web-perf-2.json` → studioCloseButton confirms Close returns to Edit slot 1. The editor is inline rather than demonstrably a modal, so absent modal semantics alone is not proof of an accessibility violation; the tested Escape expectation failed without trapping the user permanently. |

Additional lower-severity observations: native Tab order runs rightmost Quick controls/Open workspace before Bunny/Voice; native Escape collapses but leaves focus on the window root; UIA after keyboard use includes an unnamed focusable tooltip/popup window; the web shows Ready for about 0.4 s before Interrupted after cancellation; initial voice UI briefly shows Disconnected before its first Host read. The native expanded physical screenshot has terminal text visible through its composer background, so critical text contrast against arbitrary desktop content remains unproven. See `perf/shots/island-after-bunny-invoke-physical.png`.

## Evidence inventory and supported passes

### Desktop workspace and Studio

`web/shots-report.json` contains 60 captures: ten views (Chat, Missions, Agents/Studio, Projects, Files, Approvals, Activity, Models, Settings, design preview) × two themes × 1920×1080, 1366×768, 1280×800. All 60 record no document horizontal overflow and no console errors. These are actual app renders against a disposable seeded Host, not a promotional mockup. They are render coverage, not 60 complete behavioral acceptance tests.

`web/studio-interaction.json` records revision 4→5 after a save, the updated Ledger name in the context strip, an external revision change to 6, rejection of a stale save, and no console errors. The refusal explicitly says nothing changed; slot 2 remains Spear. This supports Host acknowledgment and concurrency protection for the exercised configuration path. It does not verify every Studio authority or lifecycle control.

`a11y/smoke-dev.json` records rendered desktop 1280×800 and mobile 390×844, HTTP 200, substantial body content, no document overflow, console errors or page errors. Both stored screenshots were visually inspected in this audit. This is a **dev** smoke run at 8096. There is no built-output T13 smoke result in this assigned directory scope. A missing custom share-card brand note is recorded and is not a browser runtime error; resolve applicability under the workspace rules in the main acceptance report.

The desktop screenshot samples visibly present readable light/dark workspace content, recognizable supplied Bunny/weapon art, separated provider navigation, and Host-backed slot labels. The 1280/1366 Chat sample requires vertical scrolling for lower content. Static screenshots do not verify animation fluidity, drag input, task execution, or final user design approval.

### Native Notch geometry and persistence

`notch/notch-receipts.json` contains 56 native smoke scenarios and 412 recorded Boolean checks, all true. The Host is explicitly a **fixture** (`notch/fake-host.mjs`); voice and slot states are controlled fixture values. Four offline scenarios carry the expected Host-timeout lastError. Do not describe these 56 scenarios as live workload or real voice demonstrations.

The stored comparison sheets show top/bottom character strip on the left and left/right character strip above, with recognizable Gada, Spear, Chakra and Sword. They support visual traceability to the provided docking board. The states montage shows single/all active, expanded/detail, waiting, paused, failed, verified, offline, voice, and light/reduced-motion layouts. A still frame cannot prove animation differences over time.

`live-notch/live-dock-receipts.json` adds a **real disposable Host and real WPF Island**: 18/18 recorded checks passed, two real bound slots retained order, all snapshots within work area, appropriate orientation/expansion, along-edge offsets change, and relaunch restores edge, offset, monitor and window geometry. Real Ctrl+Alt+Arrow inputs to left and top landed via the keyboard-chord path without fallback. Pointer input is explicitly **synthetic release coordinates invoking Invoke-BunnyDockRelease**, not a full physical press-drag-release gesture. Report it as native snap/release-path coverage, not physical mouse-drag acceptance.

Only one display was available. The logical work-area coordinates and helper-reported systemDpi=96 in the docking receipt are not an independent 100% display-scaling test: the physical DPI probe measured the actual display at 144 DPI/150%. Multi-monitor detach/rearrangement, monitor removal, and transitions between different scales remain NOT TESTED.

### Voice visual integration

The run is **LIVE-SYNTHETIC**. `live-voice/live-voice.mjs` and `results.json` use real disposable Host code, the real native voice worker on actual default endpoints, a real WPF Island, and a real app page. Every response turn is typed via voice.text; there is no deliberate human speech or human barge-in. Worker playing/capturing facts are real, but this audit did not hear playback or prove requested words were spoken. The first stored answer is “I can't do that by voice. Nothing was changed.”, so requesting a phrase is not proof the requested phrase was produced.

Supported Host observations include closed→Sleeping, open→Ready, response processing before Speaking, worker-confirmed playback, Ready after playback idle, stopped playback after interruption, real push-to-talk capture, app-mute with capturing=false, active hands-free capture, simultaneous capture/playback, session close→Sleeping, and web Disconnected after Host shutdown. Host invariant samples contain no Speaking without playback, no Listening without capture, and no capture while app-muted. The timeline contains 26 simultaneous capture/playback companion rows; the final e2 evidence object has playing=false because it was read after playback ended, so the timeline rather than that last snapshot supports simultaneity.

The raw run reports **17 PASS / 1 FAIL across 18 checks**. Raw c1 is a driver false failure: it read a cached Host sampler snapshot from before interruption returned. `verifier-reanalysis.json` corrects Host c1 to PASS from the first post-receipt sample at +20 ms. This yields 18/18 **Host-scoped** checks on reanalysis, not 18/18 all-surface acceptance; E03 is a separate genuine web failure. Preserve the raw run and cite the correction separately.

Island screenshots show expected sampled expressions, but no continuous Island transition trace exists; immediate cancel accuracy on the native expression is NOT TESTED. App mute was tested; actual Windows endpoint mute/unavailable, privacy denied, device loss/worker exit, deliberate speech transcription, and human barge-in were NOT TESTED. Interrupted precedence also obscures a confirmed new capture for part of a 2.5 s post-cancel window; no false capture claim is demonstrated by that precedence.

`results.json` lists one ERR_INCOMPLETE_CHUNKED_ENCODING web resource error and no leaked worker PIDs. The error occurs in a run that deliberately stops its Host; do not erase it or call the entire run a clean-console pass. Distinguish teardown transport errors from uncaught app exceptions.

### Phone companion

`phone/final/report-live.json` covers 50 renders: ten destinations/state views × 320×640, 375×812, 390×844, 430×932, and 844×390. All use headless Chromium with isMobile, hasTouch, deviceScaleFactor=2, a real app and disposable Host. They are **browser simulations, not physical-phone, remote HTTPS transport, or device-principal acceptance**. The live screenshots show “This workstation”/“Talk to Bunny” because the workstation context was used.

The 40 portrait captures have no document or root overflow, no console errors, no undersized targets, and no flagged text contrast. Agent-detail labels match the seeded Host presentation for verified, waiting, paused and idle. Ten landscape captures were collected; Home and Settings fail E01, even though their document overflow metric alone remains 0. Other landscape captures record no target/contrast flags, but this does not make the overall landscape experience pass.

`report-stale.json` supports stale presentation after a **simulated network stall** on a live Host: last-known timestamp, explicit stopped-animation copy, no active voice invitation, reachedStale=true at 22 s and 12 s in the two viewport runs. Attribute copy is evidence of presentation, not direct measurement of every animation's playState.

`report-offline.json` supports real disposable Host stop→Offline in both 320/390 viewports, controls paused and retained labels marked last known, within about 4 s. Both include ERR_INCOMPLETE_CHUNKED_ENCODING from the deliberately broken stream; those are recorded, not a universally clean console.

Two intended connection demonstrations did **not** reach their expected state:

- `report-pairing.json`: reachedExpectedState=false twice; wrong workstation token yields Offline/Host unreachable rather than Pairing required.
- `report-host-changed.json`: reachedHostChanged=false; after disposable Host restart the page remains Live throughout the recorded 60–119 s tail.

These are unsuccessful **workstation-context harness demonstrations**, not proof the paired-device pathways are broken. The earlier verifier notes that Host-changed is device-only. Actual pairing/Host-changed device rendering remains NOT TESTED and needs the supported gateway/device session. Do not mark either intended demonstration PASS based on the report filename.

`phone/final/voice-note-check.json` verifies **model-level capability/caption** outputs: workstation voice available; device_full/device_readonly/none voice unavailable and caption “Voice is available on your PC”. It does not render or exercise a paired phone. It supports policy classification only, not phone microphone capture or remote authorization enforcement.

The earlier `phone/report.json` and `live-report.json` are useful preliminary captures, not additional distinct physical coverage and not a reason to double-count the final 50 runs.

## Performance measurements and limitations

### Web

| Measurement | Result | Evidence / boundary |
|---|---|---|
| Initial visible Chat window | 14.15 FPS, 10.04 s | `perf/web-perf.json`; initial run, not excluded because later runs are better |
| Repeated visible Chat windows | 26.00 / 25.24 / 25.96 FPS | `web-perf-3.json`; 10 s each; p50 33.4 ms, p95 about 50 ms |
| Script-paused animation control | 57.71 FPS | `web-perf-3.json`; SIMULATED control, p50 16.7 ms/p95 16.8 ms |
| Blank-page baseline | 60.39 FPS | `web-perf-2.json`; 5.001 s |
| Chat main-thread busy | About 2.4–2.7% | CDP; not whole browser/GPU CPU cost |
| Chat used JS heap | About 26.5–29.3 MB | Later CDP windows; not total process/texture memory |
| 331-character design-preview stress | 42.04 FPS, 26.88% main-thread busy, 50.22 MB used heap, 6,236 nodes | `web-perf.json`; fixture surface; 621 character animations, 124 running/497 paused |

Real viewport scroll toggles data-paused on offscreen characters as expected. Browser-emulated OS reduced-motion and app Motion Off reduce recorded running/document character animations to zero. This supports the web reduced-motion path. Weapons still report data-reduced=false under the OS setting while CSS suppresses their animations; it is a metadata inconsistency, not evidence animations continue.

Real hidden-document pausing was **not reproduced**: headless minimize left document.hidden=false and visibilityState=visible. The hidden gate was tested by overriding document.hidden and dispatching visibilitychange; all nine character elements then had data-paused=true. This is simulated branch coverage. In that simulated window actual CSS play-state efficacy was not measured. No GPU FPS, physical mobile performance, battery drain, total texture memory bound, or long-run memory trend was measured. Do not claim 60 FPS or battery-conscious performance passed.

### Native WPF Island

CPU percentages below are percentages of **one CPU core**, not total machine utilization. The machine had 22 logical processors. These are actual install/Bunny-Island.ps1 runs, not SmokeTest estimates.

| State | Duration | Average CPU, one core | p95 interval CPU | Peak working set |
|---|---:|---:|---:|---:|
| Collapsed, full motion, four agents | 60 s | 28.07% | 37.01% | 392.9 MB |
| Expanded, full motion | 30 s | 38.02% | 47.59% | 572.4 MB |
| Collapsed, Motion Off after preference restart | 30 s | 6.04% | 9.25% | 415.9 MB |
| Collapsed before minimize, separate process | 20 s | 23.59% | 34.07% | 365.7 MB |
| Same process minimized | 20 s | 18.59% | 53.77% | 366.8 MB |

Source contains eight DispatcherTimer constructions according to the earlier verifier; no external runtime timer count was observed. Sample window maxima/working sets do not establish bounded texture memory or a memory leak. Native OS-level reduced-motion, mixed-DPI, multiple displays, display unplug/rearrangement, and native render FPS remain NOT TESTED.

`probe-dpi-collapsed.json` measures one 3200×2000 physical display at 144 DPI/150%, work area 3200×1928; Island and window are system-aware at matching 144 DPI, physical collapsed window 921×123. `dpi-sharpness.json` compares a physical composited capture with a 614×82 SmokeTest RenderTargetBitmap upscaled 1.5× bicubic. Mean absolute Laplacian edge energy is 42.622 versus 32.874 for Bunny, and 79.02 versus 52.744 for voice text. Physical pixels look sharper and support native rendering at this matching scale. This is a heuristic on selected crops, not universal font/asset quality or per-monitor-DPI transition acceptance.

## Accessibility coverage

`a11y/contrast-audit.json` is explicitly **approximate**: six surfaces (Chat/Approvals/Studio in light/dark), 81/55/77 visible text nodes respectively, zero flagged, minimum 5.37 light/7.24 dark. It composites ancestor colors but not backdrop-filter/desktop content. This cannot certify all glass, native materials, high-contrast/forced-colors, focus indicators, or every phone/device surface. Phone portrait/stale/offline estimates also have zero flagged nodes (minimum about 4.89–5.43), with the same screenshot-versus-actual-composition boundary.

Web Chat records 46 named focusable controls and Approvals 22, no unnamed controls in those scans, and a wrapping Tab sequence without a detected permanent trap. Chat's trace starts after composer autofocus, so “Skip to content is stop 34” is relative to the harness's starting focus, not proof it is the 34th element in document tab order. It does show that the composer is auto-focused and the navigation cycle is long. Studio Close focus restoration passes; Escape behavior remains E06.

Native UIA confirms names for Quick controls, Open workspace, Bunny, Voice and the companion image; E02 excludes the four weapon controls. Native Escape collapses the panel successfully but does not restore focus to BunnyButton. After keyboard use, `uia-collapsed-after.json` records an unnamed focusable popup window. No real screen-reader speech review, native high-contrast/forced-color render, Windows reduce-motion preference, or assistive touch review occurred. A label scan is not full screen-reader acceptance.

## Visual inspection performed for this audit

Existing images were opened in batches without generating or altering evidence:

- `notch/compare/{states-montage,top-compare,bottom-compare,left-compare,right-compare}.png`.
- `web/shots/chat-light-1280x800.png`, `chat-dark-1366x768.png`, `agents-light-1920x1080.png`, `missions-light-1920x1080.png`.
- `a11y/smoke-dev.png`, `smoke-dev-mobile.png`.
- `phone/final/shots/live/home-320.png`, `settings-390.png`, `home-landscape-844x390.png`, `settings-landscape-844x390.png`.
- `perf/shots/island-collapsed-tab-focus-one.png`, `island-after-bunny-invoke-physical.png`.
- `live-voice/shots/web-c-interrupted.png`.

This was a targeted visual inspection, not a claim that all 60 desktop, 56 native, and 50 phone screenshots were individually reviewed. The samples confirm actual rendered content and the listed visible defects. The comparison sheets preserve the relationship to the user reference, but no human final-design approval can be inferred from their existence.

## Conditions for a truthful final report

Retain raw failed and partial evidence; add new runs for corrected source. Report physical-phone/device-principal, multi-monitor/mixed-DPI, human voice/barge-in, real hidden browser, native accessibility modes, GPU FPS, and final user visual approval separately as NOT TESTED until actual evidence exists. The current source and evidence commits, final regression counts, build/package/built-output smoke, and production baseline must be established by the main T13 completion pass, not inferred from this audit's older dev captures. Do not count fixture scenarios, screenshots, reruns, focused checks, or this read-only audit as additional distinct regression tests.

No source or release was changed by this audit. No T14 work was started.
