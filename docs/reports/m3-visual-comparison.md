# Bunny-A M3 visual acceptance comparison

**VISUAL_DIRECTION=PASS. MOTION_ACCEPTANCE=PASS. LITERAL_POSTER_REPRODUCTION=PARTIAL.**

The official supplied `bunny_a_futuristic_ai_os_showcase.png` was opened and visually inspected. This review compares the functioning current M3 with its intended design language. It does not certify a pixel-identical recreation of the illustrated showcase. The user explicitly asked to preserve the current implementation and use real data.

The independent reviewer actually inspected the original 24 web and 17 native captures, then all **26 refreshed web captures, 17 final native captures, and 27 final sequential motion captures**. This decision is based on images, actual animation samples, and the implementation, rather than the unit-test result alone. The image hashes and coverage are recorded in `visual-review-final.json`.

Evidence is in [the current gallery](C:/Users/<user>/Documents/new/bun-router/screenshots/m3/acceptance/index.html), [the motion gallery](C:/Users/<user>/Documents/new/bun-router/screenshots/m3/acceptance/motion/index.html), and [the official reference](C:/Users/<user>/Documents/new/bun-router/screenshots/m3/acceptance/bunny_a_futuristic_ai_os_showcase.png). Web numbers below refer to numbered images in `screenshots/m3/acceptance`; native numbers refer to `screenshots/m3/acceptance/native`.

## Reference comparison

| Reference element | Current implementation | Match | Difference | Action |
| --- | --- | --- | --- | --- |
| Overall composition | One floating Bunny Island plus the working desktop or companion, with contextual views | PARTIAL | The reference is a six-panel marketing illustration with a scenic island, planet, and sunset. M3 retains its application navigation and real screens. | Intentional functional composition; no new redesign or decorative fake dashboard required. |
| Deep blue-black glass | Navy layered surfaces, translucent blue tint, cool edges, rounded Island and panels; web 01–12/17 and native 01–12 | MATCHED | The implementation is quieter than the reference's bright scenic reflections. | Keep the restrained current treatment. |
| Scenic translucency and atmospheric reflections | Subtle shared glass tint over the current application background | PARTIAL | No illustrated island or space backdrop; consequently less visible chromatic reflection through the glass. | Document the illustration difference; adding scenery is outside this focused acceptance correction. |
| Border intensity and illumination | Thin cool borders; localized blue/violet Orb, focus, state, and routing illumination | MATCHED | Reference edges and cyan blooms are more luminous. | Retain restraint; no exaggerated glow. |
| Bunny central identity | Existing Bunny mark anchors the collapsed header and routing center in web and native | MATCHED | Small application mark replaces the large scenic pedestal. | Keep existing identity. |
| Codex identity | Blue stylized knot, blue reported-usage rings, consistent web/native scale | MATCHED | Stylized UI mark instead of the poster's luminous badge. | Original generic code chevron has been corrected. |
| Claude identity | Warm orange sunburst, orange usage rings, orange provider emphasis | MATCHED | Current badge is less luminous than the poster. | Original generic sparkle and blue Claude rings have been corrected. |
| Ollama identity | Minimal neutral outline and subdued provider treatment | MATCHED | No poster badge glow. | Original generic drive mark has been corrected. |
| Typography and icon scale | Existing readable type; prominent task/decision titles; small secondary facts and restrained icons | MATCHED | Application copy is real and can be longer than illustrative labels. | Preserve existing fonts and useful truncation/detail expansion. |
| Routing | Bunny-centered graph, named providers, actual recorded scores, chosen-provider emphasis; web 03–05 and native 04–05 | MATCHED | Straight restrained paths replace poster's illustrated energy trails. Unscored providers say unavailable/not scored. | Top Claude node was moved inward; all nodes now fit the graph bounds. |
| Approval hierarchy | Recommendation, chosen provider, explicit Approve & Run; explanation and route facts behind web disclosures | MATCHED | Native approval retains a short visible explanation paragraph. | Repeated web explanation was condensed. Native paragraph remains readable and does not obscure approval controls. |
| Task-state readability | Provider, title, status, activity ribbon, detailed journey, distinct failed/completed states | MATCHED | Journey labels use actual Prompt/Route/Approve/Work/Verify/Complete instead of illustrated generic stages. | Preserve real lifecycle distinctions. |
| Progress presentation | Finite plan shows completed/total only when a denominator exists; otherwise activity and indeterminate state | MATCHED | Real retained running tasks have no invented 70% or 7/10. | Keep unavailable denominator truthful. Finite-plan fixtures are visibly labelled. |
| Compact desktop Home | Shorter active summaries, recent activity, detailed journey only in expanded task views; web 17 | MATCHED | Real approval/activity descriptions can be longer than poster task labels. | Excess repeated journey on summary cards has been removed. |
| Agents density | Smaller provider panels with compact primary facts and existing supplementary details; web 18 | PARTIAL | Dedicated management page contains more readiness/quota/history facts than the poster's small task badges. | Material excess was reduced. Remaining detail is functional; optional future row-padding polish is not an acceptance blocker. |
| Projects | Tighter padding and spacing with actual project/workspace information; web 19 | MATCHED | The reference has no dedicated Projects screen. | Consistent current system; no competing layout introduced. |
| Telemetry density | Measured CPU/memory/GPU trends plus detected devices with explicit unavailable sensor rows; web 12/25, native 12 | PARTIAL | Five actual hardware entries replace four illustrative CPU/memory/GPU/NPU tiles. Unsupported hardware cards are less compact than the poster. | Retain detected hardware and unavailable states. Do not invent an NPU, temperature, or utilization. Further optional density polish can preserve these facts. |
| Desktop consistency | Navigation, Island, cards, controls, provider colors, task details, settings share one visual system | MATCHED | Current desktop uses the retained navigation shell, not the poster's miniature mock desktop. | Preserve working shell. |
| Phone consistency | Matching compact task cards, provider marks, blue controls, concise connection status, touch-sized navigation; web 20–21 | MATCHED | Actual connection/approval and unsupported telemetry facts replace illustrative miniature tasks. | Redundant journey and oversized connection summary were reduced. |
| Dark theme | Readable pale text on navy layers, restrained highlights; web 01–25 and native dark views | MATCHED | Less saturated than the artwork. | No outstanding contrast, overlap, or broken-layout issue found in reviewed settled views. |
| Light theme | Warm pale surfaces, dark readable type, same blue/orange identities and controls; web 21/26, native 15 | MATCHED | Warmer than the reference phone's white surface. | Parity is maintained. |
| Motion communicates state | Meaningful morph, routing flow, working pulse, real-stage journey, new-event ribbon, bounded success/failure, notification actions | MATCHED | A still concept image cannot define exact timing. Current timing is validated from sequential rendered frames. | Full, reduced, off, and OS reduction verified; no meaningless idle loop. |

No major reference area is **NOT MATCHED** for the requested design direction. The **PARTIAL** entries describe real remaining visual differences; they are not concealed by a blanket pixel-match claim. The material initial gaps in provider identity, route clipping, repeated approval prose, Home/phone card density, and project/provider spacing were corrected without changing the data contract or backend.

## Required capture coverage

| Required state / reference role | Current implementation and evidence | Match | Difference / action |
| --- | --- | --- | --- |
| 1. Island idle | Web 01; native 01; motion 00 | MATCHED | Compact Bunny/provider header; no perpetual idle animation. |
| 2. Island expanded | Corrected web 25; native 12; motion 10 | MATCHED | Real measured system detail. First incorrect collapsed capture is preserved in `attempt-1`; replacement asserts expanded content is visible. |
| 3. Composer | Web 02; native 02/15; motion 01 | MATCHED | Existing task prompt, route/project choices, presets, accessible focus. |
| 4. Routing | Web 03; native 04; motion 02 | MATCHED | Saved decision scores or chronological awaiting-score state, clearly labelled. |
| 5. Approval | Web 04; native 03; motion 03 | MATCHED | Explicit approval before work; no execution inferred from decorative flow. |
| 6. Provider comparison | Web 05; native 05 | MATCHED | Actual recorded scores and provider facts; unsupported facts stay unavailable. |
| 7. Determinate task | Web 06; native 16 | MATCHED | Explicit controlled finite-plan visual fixture, not a claim that the live task reported a plan. |
| 8. Indeterminate task | Web 07; native 06; motion 05 | MATCHED | Actual retained task without a denominator; no fabricated percentage. |
| 9. Activity | Web 08; motion 05–06 | MATCHED | Retained real command/verification events, ribbon entry transition. |
| 10. Multiple tasks | Web 09/11; native 07/08 | MATCHED | Real simultaneous saved assignments; no invented handoff record. |
| 11. Expanded task | Web 10; native 09 | MATCHED | Detailed journey/output and Stop/Open controls; unavailable terminal/output is honest. |
| 12. Telemetry | Web 12/25; native 12 | PARTIAL | Real hardware facts; density difference described above. |
| 13. Thermal warning | Web 13; native 17 | MATCHED | Visibly marked safe threshold fixture. No claimed live overheating and no automatic Stop. |
| 14. Completed | Web 14; native 10; motion 07 | MATCHED | Verified artifact and complete journey; success appears only after actual completion record. |
| 15. Failed | Web 15; native 11; corrected motion 08 | MATCHED | Real retained failure text. Motion harness clears unrelated later completion notification before historical projection. |
| 16. Desktop Home | Web 17 | MATCHED | Compact summaries and one clear task entry point. |
| 17. Agents | Web 18 | PARTIAL | Functional dedicated provider-management detail; excess reduced, remaining difference documented. |
| 18. Projects | Web 19 | MATCHED | Actual project facts in a tighter layout. |
| 19. System | Web 12/25; native 12 | PARTIAL | No illustrative NPU or fake sensor values; measured/unavailable distinction preserved. |
| 20. Settings / Appearance | Web 23–24; native 14 | MATCHED | Existing controls and actual motion preference behavior. Scrollable native settings remain accessible. |
| 21. Phone dark | Web 20 | MATCHED | Compact real-state companion, matching marks/colors and readable controls. |
| 22. Phone light | Web 21 | MATCHED | Equivalent hierarchy and contrast on warm pale surfaces. |
| Extra: desktop light | Web 26; native 15 | MATCHED | Desktop/native light parity checked visually. |
| Extra: replay | Web 16; gallery replay checks | MATCHED | Submission hides future output/artifact; verified completion reveals it. |
| Extra: voice unavailable | Web 22; native 13 | MATCHED | Clear availability state and existing typed-task route; no fake transcript. |

## Motion acceptance

The isolated browser rendered the current application with the genuine successful Claude task/event history from `claude-acceptance-resumed.json`, an actual retained failed Claude task from `host-resumed.json`, and genuine Codex reports from two recorded timestamps. All lifecycle projections and captures are labelled **RECORDED / CONTROLLED PRESENTATION**. No new provider run is claimed by this motion script. The separate Claude acceptance evidence establishes the real adapter execution.

`motion-acceptance.mjs` passed **30 assertions** and produced **27 captures** plus sampled computed animation values. The reviewer inspected every final image, including early/settled pairs. These cover idle → composer → routing → approval → running → verification → completed, a separately isolated running → failed chronology, and expanded → collapsed → expanded. Width, rotation, path dash offset, pulse opacity, ribbon transforms, completion check, and animation play states changed across sequential samples. Success/failure effects settled; idle did not loop.

The selected provider follows the genuine chosen Claude decision. Approval's journey stays at Approve until recorded launch; Verify uses the real verification event; completion uses the verified Host completion record. Activity ribbon content comes from actual retained events. Notification collapse preserves a count; activating that indicator clears the queue and opens the task. Before replaying the unrelated historical failure, the completion notification is cleared through its existing UI action, so future success evidence does not leak into the earlier failure proof.

Reported Codex short-window use changed **30% → 60%**, and weekly use **58% → 63%**, at two genuine observation timestamps with unchanged reset intervals. The inner ring sampled **108° → 162.173° → 206.711° → 216°**, and the outer ring **208.8° → 217.829° → 225.252° → 226.8°**. These values are rendered interpolation of real reports, not new quota measurements invented by the harness.

Reduced, off, and OS `prefers-reduced-motion` suppressed Orb, path, ribbon, and dot animation while preserving readable state. The final native candidate's separate 17-view check also passed its full/OS/reduced/off policies. The browser trace is the detailed timestamped lifecycle evidence; native screenshots are state/layout parity evidence, not a claim of an independently recorded full native lifecycle trace.

No uncaught application exception and no Host command/write request occurred. The environment-blocked external branding resource logged `ERR_NETWORK_ACCESS_DENIED`; this is retained in evidence and is not described as a completely clean network console. The controlled routing projection can show the Home card's fallback “Working…” label; it is presentation state, not evidence of provider launch or a trustworthy live activity count. Real approval gating is established by the separate Host integration/Claude evidence and the approval journey, not by that background fallback.

This is visual/motion acceptance only. The final M3 verdict also depends on the separate regression, package preservation, real provider, and public HTTPS results.
