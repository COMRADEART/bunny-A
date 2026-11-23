# Bunny A: Visual Experience 2.0 acceptance

**Verdict: `BUNNY_VISUAL_EXPERIENCE_2_PASS_WITH_LIMITATIONS`**

Every security and implementation gate passes. The limitations in §9 are untested environments (a physical phone,
multi-monitor, GPU frame rates) and documented UX edges. None of them is a security, authority or data issue.

| Item | Value |
| --- | --- |
| Starting source | `c43fad3` (T13.3 N-C), a verified ancestor of the branch. Sealed baseline evidence `0eb58e6`, verdict `BUNNY_MA3_T13_3_PASS_WITH_LIMITATIONS` (`test-results/visual-experience-2/baseline/ancestry.txt`). |
| Branch | `visual-experience-2`, cut from `0eb58e6` |
| Source commits | `4a285a5` (22 theme systems, Notch, phone, reconciliation UI and review repairs), `28fb0fd` and `910eb85` (CSS-only masthead fixes found by the keyboard walk) |
| **Final executable source** | **`910eb85`** |
| Evidence commit | The commit that adds this file, `docs/visual-experience-2/` and `test-results/visual-experience-2/` |
| Pushed / deployed / installed / published | **No.** Production was observed only (§8). |

## 1. Gates

| Gate | Result | Evidence |
| --- | --- | --- |
| A Architecture and baseline | PASS | `baseline/ancestry.txt`; 22 baseline renders in `baseline/shots`; production observed before (`production/production-before.json`) |
| B Theme engine | PASS | `ui-theme.ts` (registry, strict schema `bunny-a.ui-theme.v1`, contrast maths, CSS and Notch tokens), `UiThemeStore` (one revision-checked row), hot switching, persistence across restarts, system default (glass). Tests: `ui-theme.test.ts` (12), `ui-theme-host.test.ts` (3), `theme-model.test.ts` (4) |
| C Foundation themes | PASS | Glass reproduces the T13 glass tokens exactly (unit test). The automated screenshot comparison against the T13.3 baseline shows only content and data differences (§4). Minimalism, Swiss and Bento have distinct layouts. |
| D Remaining 18 themes | PASS | `THEME_CATALOGUE.md` (generated from code): each has its own layout, home, studio, navigation, material, type, motion, Agent frame and Notch shape. The structural signatures are unique (unit test). Human review: §5. |
| E Windows surfaces | PASS | 10 desktop screens × 22 themes in the default appearance, plus each theme's other appearance on the dashboard (§3). `gate-e/topnav-fit.json`: masthead destinations never hidden, focus clear. |
| F Native Notch | PASS | 115/115 native runs (22 themes × 4 edges, 22 expanded, 3 high contrast, 2 other variant). Every check recomputed from receipts, including status-text contrast of 11.1–20.2:1. Revision-0 probe 3/3. Notch tests 2/2 in PowerShell 5.1. |
| G Phone | PASS (emulation) | 22 themes at 390×844, DPR 2, touch, plus the other appearance where one exists. Device writes are refused by the Host; a device keeps a local look. Physical phone **NOT TESTED**. |
| H Agent presentation | PASS | 22 Agent Studio screenshots. Theme frame rings sit *around* each Agent's own skin and never replace it (`CHARACTER_PRESENTATION.md`). Keyboard walk ok (§6). |
| I Functional UX | PASS | Owner reconciliation review: **16/16 live on the built app** (`gate-i/reconcile-ui.json`): only `task.reconcile`, exactly once, no replay, focus handled. Mission plan names its dependencies and shows the provider trail (`mission-model.test.ts`). |
| J Performance and accessibility | PASS with L-PERF-GPU | Theme switch p50 69.6 ms, p95 116.4 ms; main thread ≤ 4.26 %; ambient loops stop when idle (`gate-j/perf.json`). Keyboard walk, contrast tests and forced colours (`ACCESSIBILITY_PERFORMANCE.md`). |
| K Independent validation | PASS with L-FLAKE-T4 | Review rounds 1–3 ending "CONFIRMED" (`INDEPENDENT_REVIEW.md`). Full regression 2,512/2,513: the one failure is a pre-existing cleanup flake, with `4a285a5` at 2,513/2,513 (§7). Package verified (§7). |

## 2. The 22 themes

Claymorphism, Cybercore, Neo-Brutalism, Scrapbook, Surrealism, Y2K, Pixel Art, Synthwave, Glassmorphism (default),
Neumorphism, Bento Grid, Editorial, Swiss Design, Minimalism, Maximalism, Luxury Typography, Conceptual Sketch,
Ethereal, Bohemian, Victorian, Cyberpunk, Wabi-sabi.

All 22 manifests, and each theme's philosophy, signature element, layout, typography, motion, Notch, palette contrast,
performance fallback and provenance, are in `docs/visual-experience-2/THEME_CATALOGUE.md`. It is generated from
`src/lib/bunny-host/ui-theme.ts` by `harness/gen-catalogue.mjs`. Fonts are bundled OFL-1.1 `@fontsource` 5.3.0 Latin
subsets; the Notch uses Windows system fonts. All art is procedural CSS: there are no images or remote assets, and no
user-installed theme assets.

## 3. Screenshots (all from the BUILT app, source `910eb85`)

Evidence root `test-results/visual-experience-2/`. Every page was checked for no page or console error, no horizontal
overflow, live Host data, and the requested theme hydrated and stable before the picture was taken.

| Required (directive Phase 10) | Count | Where |
| --- | --- | --- |
| Desktop dashboards | 22 | `matrix/default-{light,dark}/<id>-<v>-dashboard.png` (+ 18 other-appearance dashboards in `matrix/alt-*`) |
| Phone dashboards | 22 | `matrix/default-*/<id>-<v>-phone.png` (+ 18 other-appearance phones) |
| Expanded Notch | 22 | `notch/shots/<id>-top-expanded.png` |
| Agent Studio | 22 | `matrix/default-*/<id>-<v>-studio.png` |
| Mission workflow | 22 | `matrix/default-*/<id>-<v>-missions.png` |
| Theme configuration previews | 22 | `previews/<id>-preview.png`. The gallery's real Preview control was used; nothing was saved (`previews/results.json`). |
| **Minimum total** | **132** | |

Also captured:

- the other six desktop screens for every theme (approvals, activity, files, projects, models, devices): 278 matrix pages in all;
- 115 native Notch captures across all four edges, with high contrast and the other variant;
- reconciliation (`gate-i/`), Notch probes (`gate-f/`), and contact sheets for review (`sheets/`, `notch/sheets/`).

## 4. Automated screenshot comparison

`harness/compare-glass.py` compares the default theme with the T13.3 baseline at 0eb58e6, using the same harness,
fixture Host and viewport (`compare-glass/compare-glass.json` plus diff images). Changed pixels per screen, at a
threshold of 24/255: 1.3–10.2 %.

Each difference was inspected and is content, not style:

- the greeting follows the time of day, and fixture badge counts and live data differ;
- intended additions: Agent Studio's theme/skin caption shifts content down, the home gains a Personal Agents module, and Approvals gains the reconciliation review;
- sidebar, typography, materials and spacing are unchanged.

The glass token set is asserted equal to T13 in `ui-theme.test.ts`.

## 5. Human visual review

Reviewed on the contact sheets (`sheets/sheet-*.png`, `notch/sheets/*`) and on individual frames.

| Check | Finding |
| --- | --- |
| Identity and distinctiveness | All 22 are recognisably different systems: shell layout, home composition, type and material. The closest pair is Glassmorphism and Neumorphism. Both use the sidebar-plus-stack structure; neumorphism differs in material (extruded surfaces), Agent frames and phone navigation, which is faithful to the style. |
| Legibility and contrast | Contrast is tested for every palette and its high-contrast form. A light-on-light Notch header was found in native captures and fixed (§F). |
| Hierarchy, spacing, alignment, balance | Consistent within each theme. The brutalism hero was earlier fixed for overflow with container-query sizing. |
| Consistent components and responsive layout | Every theme uses one component tree. The phone keeps one single-column structure by design (`PHONE_UX_SPEC.md`). |
| Interaction states | Focus is visible in every theme (keyboard walk). Preview has `aria-pressed`, and Apply and Reset report refusals inline. |
| Overflow and clipping | No horizontal overflow on any of the 278 pages. The masthead clipped "Devices" in luxury; fixed in `28fb0fd` and `910eb85`, and the masthead now wraps. |
| Motion | One entrance per navigation, ambient loops gated by idle, hidden window and reduced motion, and the T13 character animations unchanged. |

Issues found and repaired before acceptance:

- light-on-light Notch header;
- luxury masthead clipping and focus obscured;
- reconciliation facts layout and lost focus;
- the gallery fieldset dropping focus;
- the dev-server-only and stale-build capture problems in the harness (superseded runs kept in `superseded/`).

## 6. Accessibility and keyboard

`gate-h/a11y-keyboard.json` covers 8 themes × Chat and Settings, 39–40 Tab stops each: 0 unnamed, 0 without a focus
ring, 0 covered. The gallery works by keyboard only (Preview, then Escape; nothing saved).

`gate-e/topnav-fit.json` covers 5 masthead themes at 1440 and 1280 px: all destinations visible, and focused controls
clear.

Also in place:

- contrast tests: text 4.5:1 on every surface, focus 3:1, and the accent as text at 4.5:1;
- reduced motion, forced colours, and text size 90–125 %.

Details are in `ACCESSIBILITY_PERFORMANCE.md`.

## 7. Regression, package and review

**Full regression of `910eb85`** in a clean detached worktree (`regression/run-final-regression.ps1`, copied from
T13.3), receipts in `regression/final/`:

| Step | Result |
| --- | --- |
| typecheck / lint / build / pretest | exit 0 / exit 0 (0 errors, 35 warnings, baseline 27: +8 fast-refresh warnings in the theme files) / exit 0 / exit 0 |
| scripts | 450 / 450 |
| library | **1,616 / 1,617**. One failure, described below. |
| Agent runtime | 58 / 58 |
| UI | 388 / 388 |
| **Total** | **2,512 / 2,513 distinct** (floor 2,488) |

**The one failure** is `git-helpers-ownership.test.ts` "T4: harmless gpg helper descendants are owned and timeout
kills them".

- **Where it fails.** Its assertions pass. The error is `EPERM` from the test's own `finally` cleanup (`rmSync` of its temp root, line 19), right after it kills the helper process tree; Windows still holds a handle on the folder for a moment.
- **Not this milestone's code.** The test and everything it exercises (`bunny-missions/capabilities/process.server.ts`) are unchanged since T4. This milestone touched only six `src/lib/bunny-host` theme and wiring files.
- **Passes on identical code.** The same file passed in the regression of `4a285a5` (whole library lane 1,617 / 1,617; `superseded/regression-4a285a5`), whose non-CSS source is identical to `910eb85`. It also passed in the T13.3 baseline.
- **Reruns.** Targeted reruns on the final source failed 3 times in 9, always at the same cleanup line (`regression/final/t4-git-helpers-reruns.log`).

It is recorded as a pre-existing environmental flake, **L-FLAKE-T4**, and was not edited or weakened.

The floor was 2,488 distinct (448 / 1,602 / 58 / 380). Lint: 0 errors. The new tests are:

- the Host theme lanes, `ui-theme.test.ts` and `ui-theme-host.test.ts`, now listed in `npm test`;
- `scripts/island-theme.test.mjs`;
- in the UI lane: `theme-model`, `reconciliation-model` and the mission-model additions.

No existing test was weakened or removed. One assertion was updated where its *subject* changed: the Notch light/dark
rule test gained revision-0 cases. The earlier regression of `4a285a5` (2,513 / 2,513) is kept in
`superseded/regression-4a285a5`.

**Windows package** (`windows-package/`, built from `git archive` of `910eb85` with
`scripts/package-bunny-desktop.ps1`):

| Item | Value |
| --- | --- |
| Release / version | `Bunny-A-Windows-VE2-TEST` / `0.0.0-ve2.3` |
| Source / tooling commit | `910eb853b04697b1e12bf2781b65526952704c67` |
| Archive | `Bunny-A-Windows-VE2-TEST.zip`, 181,129,144 bytes, sha256 `e7c1c37e826b436d827f682ea7aae9a96f0c2d879179237eb62df6e728da59f4` (the zip itself is not committed; its `.sha256`, manifest and receipts are) |
| Verification | files 560/560, import closure 147 (includes `ui-theme.ts`, `ui-theme.server.ts`), source match 194 files |
| Packaged end-to-end | T13.3 baseline 18/18 (`e2e/package-e2e.json`); theme e2e 7/7 (`e2e/package-theme-e2e.json`): 22 themes applied, refusals, device refused, restart, reset, no Mission/Task/provider rows. Both run on the package's own runtime. |
| Installed / published | No |

Superseded packages built from `4a285a5` and `28fb0fd` are recorded in `superseded/`.

**Independent review** (`INDEPENDENT_REVIEW.md`). Round 1 found 9 issues (1 HIGH, 2 MEDIUM, 6 LOW), and all were
repaired or documented. Round 2 returned "CONFIRMED: no unresolved HIGH/BLOCKER and no contract violation". Round 3,
on the post-review CSS, returned "CONFIRMED: no new defect". Contract items CONFIRMED:

- a theme is presentation only;
- theme data cannot execute;
- writes are workstation-only and revision-checked;
- reconciliation uses only the existing commands, is owner-only, and never replays;
- the phone gains no new authority.

## 8. Production

`Bunny-A-Windows-MA3-T13-FINAL-TEST` on 8084 and 43119 was **observed read-only** before and after
(`production/PRODUCTION_PRESERVATION.md`).

- The release, `install.json`, the manifest and every table are unchanged except production's own activity (journal, provider refresh).
- Its process IDs changed because **Windows Update restarted the PC** at 13:30 EDT (event 1074, TrustedInstaller, "Operating System: Upgrade (Planned)"). Production started again on its own at 15:23 EDT, before this work resumed. This work did not restart production.

## 9. Limitations

| Id | Limitation |
| --- | --- |
| L-PHONE-PHYSICAL | No physical phone was paired or driven; phone evidence is Chromium emulation at 390×844. |
| L-MULTI-MONITOR | Multi-monitor, mixed-DPI and side-taskbar Notch placement were not re-tested (the theme does not change placement; the T13 placement evidence stands). |
| L-WIN-HC-LIVE | Windows High Contrast was exercised through the theme's own high-contrast tokens and the static restore path, not in a live system High Contrast session. |
| L-PERF-GPU | Frame rates are from headless software compositing. Surreal, synthwave and ethereal measure 30–37 fps there (glass 47.75). GPU-composited WebView2 rates were not measured. |
| L-NOTCH-POS | The Theme Gallery explains, but cannot set, the Notch position. It is a native Notch preference set from the Notch's menu or by dragging. |
| L-NOTCH-TOGGLE | Once the owner saves an explicit light or dark choice on the workstation theme, the Notch's own appearance toggle no longer overrides it. "System", or Reset, hands the choice back. |
| L-FIRST-PAINT | After a reload, the first frame can show glass before the cached theme is read (review F6, partial). |
| L-NO-AXE | No automated axe-core audit; accessibility was measured by the keyboard walk, the contrast tests and the checks in §6. |
| L-FLAKE-T4 | `git-helpers-ownership.test.ts` T4 sometimes fails in its own temp-folder cleanup (`EPERM`) on this machine. It is pre-existing, the code under test is unchanged, and it is not weakened. Final regression 2,512/2,513 because of it; `4a285a5` was 2,513/2,513. |
| L-AMBIENT-1S | The ambient idle switch-off can come up to 1 s early because of the wake throttle (cosmetic). |
| L-PHONE-STRUCTURE | Phone themes vary type, palette, material, frames and navigation, but not the single-column structure. |

## 10. Security confirmations

- A theme is presentation configuration only. It is never an authorization principal; unknown or authority-shaped keys are refused.
- Theme data never executes: strict allowlists and `#rrggbb` values, no `url(`, and PowerShell revalidation with `\z` anchors.
- Theme writes are workstation-only. A paired device is refused and keeps a device-local look.
- Selecting a theme never stops, pauses or restarts a Mission, the Host or an Agent. Tested with four Personal Agents owning Missions across all 22 themes, and in the packaged e2e.
- No automatic write replay was added. Reconciliation sends only the owner's explicit `task.reconcile` / `mission.reconcile`.
- No workstation-only approval became an actionable phone control.
