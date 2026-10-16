# Widget Design Studio acceptance

## Verdict

`BUNNY_WIDGET_STUDIO_PASS_WITH_LIMITATIONS`

No BLOCKER or HIGH finding is open. The limitations are listed in §8 and in `docs/widgets/WIDGET_INDEPENDENT_REVIEW.md`.

## 1. Source

| Item | Value |
| --- | --- |
| Branch | `widget-design-studio` (PR #7, `COMRADEART/bunny-A`, base `main`) |
| Accepted baseline | VE2 source `910eb85`, evidence `777f666`, `BUNNY_VISUAL_EXPERIENCE_2_PASS_WITH_LIMITATIONS` |
| Widget Studio source commit | `091c5d267a9a7163bfbd505f96720d02a9df9c48` (parent `777f666`) |
| Evidence | the commit that adds this file |
| Pushed | No. Both commits are local until the owner approves a push. |

**Discovery.** At the start of this verification, the Widget Studio existed only as uncommitted work in the working tree. Both `HEAD` and `origin/widget-design-studio` were `777f666` (0 ahead, 0 behind), and PR #7's head was `777f666`, which holds the VE2 commits only. No other branch, stash or worktree contained `widgets.ts`. The local remote URL `COMRADEART/router_agent` is the same repository; GitHub redirects it to `bunny-A`.

**What the source commit contains.** It has 28 files. Some are Widget Studio files. Some are VE2 follow-ups that were already uncommitted on this branch. Two small groups are housekeeping: lint hygiene, and a cleanup retry in one test. The commit message lists each group.

**Left out on purpose, and still in the working tree:**

- Routing autopilot and use-case skill learning, a separate feature written in the same session: `learning.server.ts`, `routing-feedback.ts`, `routing-learning.test.ts`, `bunny-host/manager.server.ts`, the autopilot hunks of `http.server.ts`, `routing-improvement.tsx`, and the `bunny-missions` skills, inbox, manager and test files.
- `oauth-pkce.*`.
- `test-results/ma3/**`, which test runs rewrite.
- `native/voice/bunny-voice-worker.json`, a rebuild byproduct of the native shim.
- The `.gitignore` additions, `.claude*`, `memory/`, `docs/lokam`, `tests/`, and the scratch logs.

## 2. Implemented features

| Feature | Status | Evidence |
| --- | --- | --- |
| Board, Sidebar, Drawer | Implemented | walk: board, sidebar persisted across reload, drawer open/close (`walk/results.json`) |
| Interactive Inspector (Settings) | Implemented | walk: data source, permissions, Apply, Cancel, Reset, size, density, spacing, motion, focus filter, Notch edge |
| Reorder, resize, show and hide | Implemented | walk: Alt+ArrowDown reorder, hide then Show all, size select; pointer drag-resize is in the code but was not driven by the walk |
| Persistent configuration | Implemented | revisioned Host row; packaged W02 and W05 (survives restart); stale write refused on the built app |
| 22 themes | Implemented | 66/66 pages: 22 × light/dark desktop and 22 phone; minimum measured widget text contrast 5.72:1 |
| Windows and phone layouts | Implemented. The phone is read-only | phone stack on Home in all 22 themes, no Inspector on the phone |
| Notch integration | Partial | The desktop Inspector previews the Notch cue per edge. The native WPF Notch does not render widgets. |
| Mission Control | Implemented | Host step counts. No invented percentage. |
| Personal Agents | Implemented as one widget with four rows | not four separate widgets |
| Session Usage | Implemented | Unknown stays Unknown. Withheld on a phone. |
| Lotus Memory | Implemented, metadata only | Values are never shown. Withheld on a phone. The Project filter does not apply to it. |
| Reconciliation (workstation only) | Implemented | Opens the existing owner review and has no decision buttons. A phone sees only that something waits. |
| Voice and conversation | Implemented on the workstation | uses the existing voice and foreground commands. Withheld on a phone. |
| Real Host state | Implemented | the walk ran against a disposable real Host seeded with four Agents and one uncertain task |
| Keyboard and accessibility | Mostly implemented | Alt+Arrow reorder; Escape closes the drawer only from inside it; labelled controls; 44 px targets. The resize handle is pointer-only; the Inspector Size control is the keyboard path. |

## 3. Tests (exact counts)

| Run | Result |
| --- | --- |
| Full regression of `091c5d2` in a clean detached worktree (`regression/final/`) | **2,526 / 2,526 pass, 0 fail, 0 skipped**: scripts 450, library 1,624, agent 58, UI 394; typecheck, lint and build exit 0 |
| Focused widget tests | 13 / 13 (`widgets.test.ts` 6, `widgets-host.test.ts` 1, `widget-model.test.ts` 6) |
| Lint | 0 errors, 20 warnings, all `react-refresh/only-export-components` in files that predate this work |
| Built-app browser walk (`walk/`) | 66 / 66 theme pages and 11 / 11 interaction checks |
| Packaged end-to-end, on the package's own runtime | widgets 8 / 8; VE2 themes 7 / 7; T13.3 baseline 18 / 18 |
| `git-helpers-ownership` repeat | 5 / 5 runs pass after the cleanup retry (`logs/git-helpers-repeat.log`) |

The regression is counted against VE2's 2,512 / 2,513. Library rose from 1,617 to 1,624 (7 widget host tests). UI rose from 388 to 394 (6 widget-model tests).

**`git-helpers-ownership` flake.** In VE2's preserved log (`visual-experience-2/regression/final/library.log`), every assertion passed. The `finally` cleanup `rmSync` threw `EPERM` because Windows releases a killed job's handles on its temp folder asynchronously. The cleanup now passes `maxRetries: 10, retryDelay: 100`. No assertion changed. The flake is intermittent, so five clean runs show no regression; they do not prove the cause.

**Not tested:** a real phone device, the native Notch with widgets, live provider inference (none was run), frame-time and GPU measurements, and a screen reader.

## 4. Browser verification

- **Setup.** Built app (`JEV_DESKTOP_BUILD=1 npm run build`, `scripts/preview-node-middleware.mjs` on `127.0.0.1:8081`), served against a disposable real Host from `harness/seed-host.mjs` (copied from VE2) on port 43892. Playwright Chromium, headless, desktop 1440×900 and phone 390×844.
- **Coverage.** Settings in all 22 themes, light and dark, plus the phone companion in all 22 themes. Each page checks for six visible cards with text, no card outside the viewport, no horizontal overflow, no console or page errors, and the requested theme applied.
- **Screenshots.** The widget surface is also captured on its own (`*-widgets.png`). Contact sheets are in `sheet-widgets-light.png`, `sheet-widgets-dark.png` and `sheet-phone-sample.png`.
- **Contrast.** The minimum measured text contrast inside the widgets is 5.72:1 (Neumorphism, light). No page falls below 4.5:1.
- **Interactions.** The walk drives the Inspector and checks keyboard reorder, hide and show, resize, Sidebar persistence across a reload, stale refusal across two windows, the drawer toggle and Escape scope, the reconciliation opener, and the phone stack.
- **Source match.** The widget UI files in that build are byte-identical to `091c5d2`. The build also contained the uncommitted autopilot files (§1).
- **First walk not kept.** The first walk exposed the Sidebar bug (§6, B1). Its output folder was deleted when the walk was rerun, so that run is recorded only by the description in §6. The fix is covered by the walk's "Apply sidebar layout persists across a reload" check and `walk/interaction-sidebar.png`.

## 5. Security

The full findings are in `docs/widgets/WIDGET_SECURITY.md` and the review.

- **Layout writes.**
  - `widgets.layout` and `widgets.reset` are workstation-only. A paired device gets 400 `WORKSTATION_REQUIRED` for both write and reset (packaged W04).
  - Stale, unknown-key, markup, `__proto__`, library-widget, incomplete and malformed-revision writes change nothing (W03).
  - A forged `widgets.execute` is refused (W03).
  - Layout and theme writes create no Mission, Task or session-ledger row (W08).
- **Device snapshot.** A device's snapshot omits `personalAgentContext`, `sessionLedger` and `voice` (W04 and the host test).
- **Reconciliation.** The widget only opens the existing owner review, and no decision control exists in it. A phone is not shown which work waits.
- **Unchanged boundaries.** The Personal Agents stay four independent slots, and the widget only reads them. No router, permission, provider, account, N-C retry or reconciliation code was changed.

## 6. Defects found and fixed in this verification

| Id | Found by | Defect | Fix |
| --- | --- | --- | --- |
| B1 | browser walk | Sidebar layout floated over the page and hid its own controls. A percentage width in the split's `auto` column let unwrapped card text size the track. | A fixed-width third column. Stacks at 1180 px and below. |
| B2 | browser walk | Agent rows ran together (for example, "GadaGada · Completed and verifiedReceipt…") | each field on its own line |
| S1 | session review | Apply sent the latest revision this window had seen, so another window's save was silently overwritten | Apply sends the revision the draft was opened from. Verified live. |
| R1 | independent review | Apply dead-ended after a stale refusal | rebase, so a second Apply is a deliberate overwrite |
| R2 | independent review | An unapplied draft showed on other pages | the draft is discarded when leaving Settings |
| R3 | independent review | The phone rendered reconciliation row text | rows withheld on a device; unit test added |
| R4 | independent review | The Agent card did not say it changes who answers | registry wording |
| R6 | independent review | Escape anywhere closed the drawer and wrote to the Host | only from inside the drawer; verified in the composer |
| R9 | independent review | Host refusal text promised a phone layout editor that does not exist | wording |
| T1 | typecheck | `premium.tsx` passed the parsed search object where a string was expected | `location.searchStr` |

## 7. Windows package and production

- **Package.** `Bunny-A-Windows-WD-TEST`, version `0.0.0-wd.1`, built from `git archive` of `091c5d2` (source and tooling).
  - 562 files; hash, import-closure and source-match checks all OK.
  - Zip: 181,159,491 bytes, sha256 `161772a9a9df77c34438e4c94437d9e4ba2623ade01fd982991d9f5b9c2179ae`.
  - The zip and package folder are not committed. Their `.sha256`, manifest, results and logs are.
- **Production**, observed read-only.
  - Host 43119 (PID 26300) and gateway 8084 (PID 24248) were listening.
  - `%LOCALAPPDATA%\Bunny-A\install.json` was last modified on 2026-10-12, before this work.
  - `install/` is unchanged, and the pin is still `26.0.0-MA2-R1`.
  - Nothing was installed, deployed or published.

## 8. Limitations

1. The native Notch does not render widgets. The Notch cue is a desktop Inspector preview only.
2. "Personal Agents" is one widget with four rows, not four widgets.
3. The phone is read-only. A device-local layout path exists in the store but has no UI.
4. Lotus shows metadata only and ignores the Project filter.
5. Drag-resize is pointer-only. Keyboard users resize through the Inspector Size control, and focus is not restored after a move.
6. The registry's platform list is not enforced on the phone. Usage, Voice and Reconciliation render "withheld" cards instead of being omitted.
7. Each widget subscribes to the whole store (render cost). Frame times, GPU use and a real phone were not measured.
8. `mayReconcile(null)` returns true in VE2's `reconciliation-model.ts`. The Host still enforces the decision, and that file is out of scope here.
9. Self-assessed: the sidebar wordmark changed from "Bunny" plus a styled "A" to plain "BunnyA" in the carried VE2 follow-ups. The owner should confirm this was intended.
