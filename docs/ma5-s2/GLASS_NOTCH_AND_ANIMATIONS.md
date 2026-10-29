# MA5-S2 Phase 2: Native glass notch and agent animations

Branch `ma5-s2-phase2-glass-notch`, stacked on PR #61 (`ma5-s2-native-agents-voice`).

## Architecture (Task 1)

The existing `NotchWindow` already had the hard parts, verified in MA5-S1 and kept unchanged: four-edge placement in
physical pixels on the monitor under the notch, per-monitor-DPI awareness (`PerMonitorV2`), drag-to-snap to the nearest
edge of the drop monitor, work-area tracking (taskbar, resolution, DPI and monitor changes), saved edge/offset/corner
/collapsed state, non-activating top-most window with focus handed back, Escape, voice pill, approval badge and quick
stop. Phase 2 replaces its four static, dim-or-bright character images with a Host-driven chip system and a themed
glass surface. **No second task-state system was built**:

```
/state (Host) ──▶ MainWindow.ApplySnapshot ──▶ NotchWindow.UpdateSnapshot ──▶ NotchModel.Agents(root, now)  (pure, unit-tested)
                                                                         └─▶ RenderChips → BuildChip → Animate
chip click ──▶ MainWindow.OpenItem(kind, id, needsOwner) ──▶ existing Approval Center / Agent Dashboard / History
```

| Part | Responsibility |
|---|---|
| `Services/NotchModel.cs` | Maps Host facts to chip states. Sources: the Host's personal-agent **presentation projection** (state, basis, pending approvals, real step counts), team Agent rows plus their Mission (`teamView`), persistent-task views, direct tasks. Stable order; finished items stay 10 minutes after the Host's end time. No WPF types. |
| `BunnyA.Tests` | Dependency-free console test of `NotchModel` (no NuGet feed is configured), run by `native/windows/build.ps1`, so the CI Windows job runs it. |
| `NotchWindow` | Chips, identity glyphs, animations, theme and fallbacks, spring orientation change. Hidden: no rendering work (the snapshot is kept and applied on show; chips and animations are dropped). |
| `MainWindow.OpenItem` | A chip only **navigates**. Waiting for the owner → Approval Center on that item; active → Agent Dashboard; finished → History detail. Every decision stays in those screens with their existing checks. |
| `FrameMeter` | Opt-in frame-pacing log (`BUNNY_NOTCH_FRAME_LOG`); unhooks when nothing animates. |
| Snapshot hook | `BUNNY_NOTCH_SNAPSHOT` renders the notch's own visual tree to PNG: no desktop content behind the glass is captured. |

## State mapping (Task 5)

| Notch state | Shown when the Host reports | Glyph |
|---|---|---|
| Idle | slot UNASSIGNED/IDLE | (none) |
| Planning | slot PLANNING; team member whose current step `plan` is **running** | ▶ |
| Thinking (model generating) | team member whose current model step (`plan`/`generate_*`/`review`) is running; a running direct chat task | ▶ |
| Executing | slot RESEARCHING/CODING/TESTING/FILE_WORK/ACTIVE/VERIFYING; member's Host step running or verifying; task RUNNING | ▶ |
| Delegating | a slot bound to a team Coordinator whose presentation basis is a **member's** team step | ▶ |
| Waiting for a tool | task QUEUED blocked by `MODEL_UNAVAILABLE` / `RESOURCES_UNAVAILABLE` | … |
| Approval needed | slot with pending approvals; Coordinator while its team is in **plan review** (`teamView.phase == review`); unresolved Mission permission request; task AWAITING_APPROVAL or with a pending action | ! |
| Waiting for you | slot WAITING_FOR_USER without a pending approval; an unstarted Coordinator (start it) | ! |
| Queued | slot WAITING; member waiting on a dependency or not yet started (incl. a Planner that is PLANNING with its step pending); task QUEUED | … |
| Paused / Recovering | PAUSED / RECOVERING, INTERRUPTED | ‖ / … |
| Outcome uncertain | task UNCERTAIN (reconcile in History; never replayed) | ! |
| Completed / Failed / Canceled | COMPLETED or VERIFIED / FAILED / STOPPED or CANCELLED | ✓ / ✕ / ■ |
| Disconnected | the Host is unreachable: every chip, still and dimmed | ⌁ |

**Listening** belongs to the voice session, not to an agent: the voice pill and the Bunny button show it from the
Host's voice state. **"Waiting for the Windows app"** is not shown: the Host decides it with `uiAttached()` (an open
event stream, or a workstation request in the last 20 s) and does not expose it. And while the notch runs, the
Windows app *is* attached, so the condition cannot hold where the notch could show it. Recorded as **not applicable
on Windows** (it belongs on the phone).

## Identities and motion (Task 4)

Original stroke glyphs on a 24×24 grid (`NotchWindow.xaml` resources), legible at 18 px. Team roles take the weapon whose
meaning they share: Coordinator and Planner → Vishnu Chakra (orchestration, analysis), Researcher → Spear (precision),
Implementer and Documenter → Gada (execution), Reviewer and Tester → Sword (verification).

| Identity | Motion, only while the chip is Planning/Thinking/Executing/Delegating |
|---|---|
| Gada | weighted impact pulse (scale 1 → 1.14, back-ease) |
| Spear | forward thrust along the notch's axis |
| Vishnu Chakra | turning ring (2.4 s per turn) |
| Sword | light sweep along the blade (moving gradient stop) |
| Task | soft breathing opacity |

Approval needed pulses only its badge. A fresh Completed plays one spring "pop"; a fresh Failed one shake. Idle, queued,
waiting, finished, hidden, offline or reduced-motion chips do not move.

**Provider identities: BLOCKED.** The repository holds no approved brand assets for ChatGPT, Claude, Ollama or Cursor.
The web UI's provider icons are hand-drawn approximations, which the brief rules out as substitutes. Providers therefore
appear as text (for example "ollama · qwen…") in chip names and tooltips until approved assets are supplied.

## Appearance and fallbacks (Task 3)

The glass surface is a translucent gradient with a soft top highlight ("sheen"), a hairline edge and a drop shadow,
drawn from `DynamicResource` palette keys so a theme swap restyles everything live. WPF layered windows cannot sample
the desktop behind them, so there is **no backdrop blur**: the glass is a tinted translucent surface, not acrylic.

| Mode | Trigger | Result |
|---|---|---|
| Dark / light | `NotchTheme` = System (follows `AppsUseLightTheme`) or forced | dark or light palette |
| High contrast | `SystemParameters.HighContrast` | `SystemColors` only, opaque, no sheen, no shadow |
| Reduced transparency | Windows "Transparency effects" off (`EnableTransparency = 0`) or `ReducedTransparency` setting | opaque surface, no sheen |
| Reduced motion | Windows "Animation effects" off (`ClientAreaAnimation`) or the existing ReducedMotion setting | no loops, no pops, instant edge change |

Changes to any of these apply live (`UserPreferenceChanged`, `SystemParameters.StaticPropertyChanged`). The window's
UI Automation `ItemStatus` reports the active mode (`theme=…;opaque=…;reducedMotion=…`) so tests read it instead of
guessing from pixels.

## Interaction (Task 6)

Every chip is a button with a UI Automation name that states the item, its state in words and, when known, the real
step and its Host verification ("Implementer · … · write_file (completed) · 2 of 2 Host-verified"). Invoking it
(click, Enter/Space, or Narrator) calls `MainWindow.OpenItem`, which only **navigates**: the Approval Center selected on
that item when the owner is needed, otherwise the Agent Dashboard (active) or History detail (finished). The notch
holds no approve/deny/retry action of its own. Quick Stop is unchanged: it sends the existing Host stop command through `MainWindow.StopItemAsync`. An uncertain
outcome is shown as "Outcome uncertain" and is reconciled in History; nothing is replayed. When more than eight
items exist, the notch keeps the most important (working, needs-you, failed first; then the newest finished) and
shows a "+N" chip with "N more" read out; collapsed, only working, needs-you and failed chips remain.

## Voice-ready visuals (Task 7)

The voice pill shows only the Host's existing voice state (Off, Listening, Thinking, Speaking, …) as it did in MA5-S1,
and, while a voice session is open, adds "· N working" from the chip model. **No waveform or audio-level meter was built**: the Host exposes no audio
level, and drawing one without it would simulate live speech. The full-duplex engine (Phases 3–4) is not started.

## Evidence (Task 9)

`scripts/ma5-s2/verify-notch-windows.mjs` builds nothing and mocks nothing: it starts a disposable real Host (local
Ollama model only, state under `%TEMP%`), launches the real Release `BunnyA.exe` against it and drives it through UI
Automation (`scripts/ui-automation-helper.ps1`: `notch_tree`, `focus_notch`, `invoke_notch`). Screenshots come from
the app's own notch render (`BUNNY_NOTCH_SNAPSHOT`), so no desktop content is captured. Results:
`docs/ma5-s2/evidence/notch/windows-notch.json` and the PNGs next to it.

| Stage | What was checked | Result |
|---|---|---|
| n1 four edges | top/right/bottom/left placement flush with the work area on a 3200×2000 monitor at 150%; horizontal vs vertical layouts (`AgentGada…` / `VAgentGada…`) | PASS, `edge-*.png` |
| n2 restart | saved edge and offset restored after a relaunch (Right, ratio 0.3, same pixels) | PASS |
| n3 monitors and DPI | placed on both monitors (150% primary, 100% secondary at negative coordinates); sizes scale 1.5× | PASS |
| n4 live team | a real team (Coordinator, Planner, Researcher, Implementer, Reviewer, Tester) on the local model, 16 samples: Coordinator Queued + Planner Planning → Coordinator **Approval needed**, others Queued → Implementer, then Reviewer **Thinking (model generating)** → all Completed; invoking the Coordinator chip opened the Approval Center on `agent.team.approve` and approved **nothing** by itself; the decision was made with the Approval Center's button; mission completed, R1 and R2 passed | PASS, `team-approval-needed.png`, `team-completed.png` |
| n5 task outcomes | real persistent tasks shown as Completed, Failed, Approval needed, Queued, Canceled, matching the Host's `COMPLETED/FAILED/AWAITING_APPROVAL/QUEUED/CANCELLED` | PASS, `task-outcomes.png` |
| n6 Host loss | Host stopped: every chip Disconnected, title "Offline · Host not running"; Host back: same chips and states restored | PASS, `host-offline.png` |
| n7 appearance | dark, light, high contrast, reduced transparency, reduced motion, each confirmed by the window's reported mode | PASS, `theme-*.png` |
| n8 keyboard and names | 13 controls, all named and focusable; each chip's name contains its state; keyboard focus lands on a chip | PASS |
| n9 performance | CPU, memory and frame pacing against budgets, below | PASS |

Native unit tests (`native/windows/BunnyA.Tests`, run by `build.ps1` and so by the CI Windows job) cover the state
mapping, team rules (unstarted Coordinator, plan review, Planner with a pending step, member steps), task mapping,
presentation slots, the 10-minute finished window and the overflow ranking: 96 checks, all passing.

## Performance (Task 8)

Measured on the owner's machine (22 logical cores, 75 Hz display at 150%) by n9 against the real Release app and a
real team on the local model. CPU is the Bunny A process only, as a percentage of **one** core (the whole machine is
22× that), from `TotalProcessorTime` over the window. Final run (all stages, final build):

| Window | CPU, % of one core |
|---|---|
| Idle, nothing running (30 s) | 0.7 |
| Idle after the team finished (30 s) | 0.2 |
| Team planning, notch shown, motion on | 28.9 |
| Team planning, notch shown, motion off | 19.3 |
| Team planning, notch hidden (Hide Glass Notch) | 4.4 |

So while a team works, the visible notch costs about 15 points of one core without motion and about 10 more with
one animated chip; when idle it is below 1. Memory: working set grew 32 MB across the whole stage (two teams run,
three app relaunches), and did not grow while idle (+2 MB and −5 MB in the two idle windows).

Frame pacing (`BUNNY_NOTCH_FRAME_LOG`, 5 s windows while a chip animated): 46–49 rendered fps, median gap 14–16 ms,
p95 50–52 ms, worst gap 75 ms. Budgets, derived from the 30 fps cap rather than from the data: p95 ≤ 67 ms (two
frames), no gap over 100 ms, ≥ 25 fps, idle ≤ 3 % of one core, growth ≤ 100 MB. All met.

Two changes came out of the measurements. (1) The drop shadow had been on the element that contains the chips, so
each animation frame re-rendered the whole notch through the blur effect. It now sits on a separate glass plate
behind the content. (2) Ambient loops are capped at 30 fps (`Timeline.DesiredFrameRate`); before the cap the same
window (frame meter on) cost 42–48 % of one core with p95 15–18 ms; with the cap, 30 %. On a 75 Hz display, 30 fps does not divide the refresh rate, so
gaps alternate between 27 and 40 ms; that is the p95 above, not a stall. Earlier budgets that assumed display-rate
animation (p95 ≤ 33 ms) were replaced when the cap was introduced, and that change is recorded here. Run-to-run spread:
motion on 29–32 % (five runs with the cap), motion off 18–22 % (seven runs), notch hidden 4–7 % (four runs).

Not reduced: about 15 % of one core for a static notch during busy Host activity. The notch only redraws when a chip,
title or brush actually changes (a per-snapshot voice-pill brush was removed), but it is a per-pixel-alpha layered
window, which WPF redraws in full on any change. Profiling that further is a follow-up; the notch can be hidden.

## Acceptance

| Area | Result | Basis |
|---|---|---|
| Four positions, drag/snap, restart, multi-monitor DPI | PASS | n1–n3 |
| Glass appearance: dark, light | PASS | n7, images |
| High contrast, reduced transparency, reduced motion | PASS (app modes) | n7. The system high-contrast toggle was not flipped: it changes the owner's whole desktop. |
| Backdrop blur | NOT BUILT | WPF layered windows cannot blur the desktop; tinted translucent glass instead |
| Weapon identities and their motions | PASS | XAML glyphs; n4/n9 animate only while Host-reported work runs; unit tests |
| Provider brand identities | BLOCKED | no approved brand assets in the repository; text only |
| Host-driven states incl. Approval needed, Thinking, Completed/Failed/Canceled, Disconnected | PASS | n4–n6, unit tests |
| Delegating, Waiting for a tool, Paused, Recovering, Outcome uncertain | PASS (unit tests only) | mapped and unit-tested; not produced live in these runs |
| "Waiting for the Windows app" | NOT APPLICABLE on Windows | the Host does not expose it, and the condition cannot hold while the notch runs |
| Chip opens the right screen; notch decides nothing | PASS | n4: invoking the chip approved nothing; Approval Center made the decision |
| Several agents working at once | PARTIAL | the Host ran the team one step at a time (max 1 working observed); the overflow ranking for many chips is unit-tested |
| Voice visuals from real Host voice state | PASS (unchanged path) | no new voice signal; no waveform (no audio-level signal exists) |
| Keyboard and UI Automation names | PASS | n8: 13 controls named and focusable, state in each name |
| Narrator itself | NOT RUN | names verified through UI Automation only |
| Performance | PASS against stated budgets | n9; residual static cost noted above |
| Android notch / phone | NOT IN SCOPE | Phase 5 needs the phone |

