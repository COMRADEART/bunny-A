# E5D — Universal UI qualification record (E5C + E5D closure)

Recorded 2026-11-04 on `feat/e5c-e5d-universal-ui`, head `4caeca9`, closing the eight E5A defects (**F01–F08**) and running the E5D visual/accessibility/toolchain qualification. Branch fix line: `e3b398f` (F08) → `6ba186c` (F05) → `be845b5` (F03) → `c8e3f87` (F01+F07) → `a548456` (F02) → `ddfb362` (F04) → `b301ff2` (F06) → E5D additions `25fa3fb` (matrix skeleton), `c77d58e` (phone dock + toast), `c408f0e` (44px targets + forced-colors titles), `38d2994` (runner 125% persistence + focus cases), evidence runs `ba75912` and `4caeca9`. Symptom text and the original defect record live in [docs/ux/e5a/DEFECTS.md](../e5a/DEFECTS.md); this file is the standalone closure record.

**Status meanings are E5A's:** PASS means the stated check was executed successfully; PARTIAL means only part of the required scope is evidenced; FAIL means an observed acceptance failure; BLOCKED means the required destination, runtime data, device or channel was unavailable. A screenshot is not feature proof.

## What was run (commands verbatim)

Both production builds at source commit `38d2994` — the web/Vercel target and the desktop node-middleware output — and captures only ever ran against **built** output (dev-server shared-font 403s make dev captures dishonest):

```powershell
npm run build                                # web/Vercel target — exit 0
$env:JEV_DESKTOP_BUILD='1'; npm run build   # desktop node middleware — exit 0
BUNNY_HOST_DATA_DIRECTORY=<fresh temp dir> npm run host    # isolated real Host state
node install/server.mjs                     # real desktop adapter, loopback checks intact, :8082
```

Then, with `E5D_ISOLATED_HOST` asserted (an explicit statement of isolation, not a mechanism):

```powershell
$env:E5D_ISOLATED_HOST='1'
node scripts/e5d-capture-matrix.mjs http://127.0.0.1:8082/ docs/ux/e5d/evidence
node scripts/e5a-keyboard-checks.mjs     # rerun on the fixed build: 11/11
node scripts/e5a-layout-probes.mjs       # rerun on the fixed build: 18 cases, 0 overflow
```

Plus, at various fix-line heads: `npm run typecheck`, `npm run test:ui` (473/473 final), `npm test` (1763/1764, see flake note), `npm audit` (0 vulnerabilities), the Android hermetic gates (`scripts/prepare-android-native-tools.ps1` + JVM test classes + `scripts/build-android.ps1`). The matrix runner is the only E5D entry point (`npm run e5d:matrix` is equivalent); `E5D_APPEND=1`/`--subset=` exist for targeted recapture and were not needed for the definitive run.

Capture protocol (unchanged from E5A and enforced by the runner): loopback-only base, fresh browser context per case, UI-only navigation and appearance previews — no Task submitted, no microphone started, no provider authenticated, no permission granted, no approval accepted; never a populated production Host; auth/gateway checks were never weakened to obtain a capture.

## Harness correction (offline → live)

The first run (`ba75912`) captured 434 cases at source `b301ff2`: **386 PARTIAL + 48 BLOCKED**. The desktop adapter had no Host data directory wiring, so state-backed sections rendered empty and 32 screen captures were honestly BLOCKED: Lotus Memory ×16 and Automations ×16 (plus the 16 relatedOnly connected-services records). The fix wired `BUNNY_HOST_DATA_DIRECTORY` on **both the Host process and the adapter**, with connection verified LIVE before the matrix. The definitive run (`4caeca9`, source `38d2994`) captures 440 cases against that live Host: **422 PARTIAL + 18 BLOCKED + 0 FAIL**, zero console errors, zero failed resources, zero non-200 and zero horizontal overflow. Lotus Memory and Automations now render real state (PARTIAL). The first run remains in the ledger with its caveat; nothing was relabelled to dress the correction up as a feature result.

## Defect closure matrix

Measured on the fixed build with the E5A probe vocabulary; the plain-route corpus for every row is the E5D matrix (440 captures, 0 FAIL).

| Defect | Slice | Fix commit | Closure and measurement | Status |
|---|---|---|---|---|
| F01 | E5B | `c8e3f87` | Shared workspace allocation (`workspace-layout.ts` + tests). Dedicated widget-sidebar (320px) + expanded-context case: Settings **50px → 329px @1181** and **134px → 428px @1280**; inspectors switch to drawer/rail before the main pane becomes unusable; no control hidden to suppress overflow | PASS |
| F02 | E5B | `a548456` | Container-aware settings rows (`@container` on `.settings-panel`/`.t8-dialog`). 375px: Appearance row **291px client = scroll**, System/Light/Dark unclipped and operable (was 140px client / 192px scroll under `overflow:hidden`); 844×390 @125% text: document width **844px** (was **870px**, 26px overflow, both variants); intensity value visible beside a full-width slider | PASS |
| F03 | E5B | `be845b5` | Universal `.workspace-content` 1400px cap removed (`premium.css:218`); Server Control consumes the full 2048px ultrawide track (matrix: split 2344px, `max-width:none`); theme-specific prose measures untouched | PASS |
| F04 | E5C | `ddfb362` | Shared token gutters on every direct `.t8-surface` panel and explicit `.fabric-scroll` wrappers in source; labels byte-identical, read-only authority unchanged | PASS for empty state; populated long-cell behaviour PARTIAL (seeded Host) |
| F05 | E5B | `6ba186c` + `c408f0e` | OS reduced transparency computes blur **0px** with an opaque surface and decorative filtering removed; stored intensity kept and the effective-intensity limit explained in Appearance. Forced colors: decoration suppressed, Liquid Glass preset titles resolve to CanvasText (`c408f0e`), miniatures keep their real design. The stored-intensity material still computes `blur(24px) saturate(1.5)` (blur-independence invariant preserved) | PARTIAL — CDP-emulated; native/browser + physical confirmation open |
| F06 | E5B | `b301ff2` | Routing, Safety, Providers, Automations, Connected accounts and Notifications are explicit navigation destinations (8 new entries), each opening an existing surface and naming itself truthfully; verified by cold-load deep links ×8; Notifications and Activity no longer highlight each other; pinned nav-table test holds | PASS with two retained owner-open items (below) |
| F07 | E5B/E5C | `c8e3f87` + `c77d58e` | Expanded Context behaves as an optional drawer again with focus management (drawer Escape live at 1180/1181); widget drawer demoted; the phone profile presents a collapsed dock by default, and its expanded form joins the layout flow so the offline toast can no longer cover the composer, the Reconnect control or the dock's reopen strip | PASS; expanded in-flow dock has no Escape binding — recorded open |
| F08 | E5C | `e3b398f` | Both renders derive from the same router search; companion deep links clean across all four tabs (chat/agents/missions/settings), reload and reload-Back; no React #418 | PASS |

### Retained owner-open items (recorded, none an E5B/E5C regression)

- **Connected Services mapping** — destination is relatedOnly by design: it manages model provider sign-in/plan/permission controls and names the absence of email/calendar/document connections; Connected Accounts is never relabelled as services. Owner-reopenable.
- **Home/Chat alias** — blueprint-specified design (one composer, not drift); recorded as an owner-review item, not silently dropped.
- **Expanded in-flow phone dock** has no Escape binding; the drawer Escape contract is live at 1180/1181.
- **F04 populated long-cell behaviour** and (with it) the populated dialogs — see BLOCKED rows below.

## Acceptance matrix

| Criterion / toolchain | Status | Basis |
|---|---|---|
| F01 workspace allocation | PASS | 329px @1181 / 428px @1280 on the fixed build in the dedicated widget-sidebar+context case; matrix corpus bounds improve on the plain route (371px/470px). |
| F02 settings rows | PASS | 291px client = scroll at 375px; 844px document at 844×390 @125%. |
| F03 ultrawide operational width | PASS | Full 2048px track consumed; `max-width:none`. |
| F04 gutters + scroll wrappers | PASS (empty state) | Populated long-cell rows PARTIAL — seeded Host required. |
| F05 OS reduction + forced colors | PARTIAL | Measured PASS under CDP emulation (blur 0px, CanvasText titles, stored intensity kept + explained); native/browser environments and a physical OS pass open. |
| F06 nav IA + highlight mapping | PASS | 8 cold-load deep links; Notifications≠Activity. Home/Chat alias and services mapping owner-open by design. |
| F07 drawer/dock + focus contract | PASS | Drawer semantics at 1180/1181; phone dock collapsed-default; Escape gap on the expanded in-flow dock recorded. |
| F08 companion parity | PASS | ×4 tabs + reload + reload-Back, clean console. |
| 125% text-scale persistence | PARTIAL | Root `fontSize` 20px verified after navigation on 7 of 8 profile legs; the connected-services silver landscape leg held 16px and is recorded BLOCKED instead of capturing at the wrong scale. |
| 44px touch targets (E5D cases) | PARTIAL | Stale-pairing reveal and AI & Models tab pills reach 44px on phone bands; desktop keeps 40px pills. Pre-existing sub-44px targets (AI tab desk rows 40px, character chips 34px, policy checkboxes 13×13) are triage-verified pre-existing, recorded — not fixed in this line. |
| Keyboard checks (`scripts/e5a-keyboard-checks.mjs`) | PASS | 11/11. |
| Layout probes (`scripts/e5a-layout-probes.mjs`) | PASS | 18 cases, 0 overflow. |
| E5D focus cases | 4 PASS + 2 BLOCKED | Focus ring measured on home/settings both variants; the two approvals walks reached no Tab-reachable control because the isolated Host's approval queue is empty — nothing focusable, recorded honestly. |
| Island component tests (`npm run test:ui`) | PASS | 473/473. |
| Navigation model tests (`nav-model.test.ts`) | PASS | 10/10. |
| Full regression (`npm test`) | PARTIAL | 1763/1764; the single failure is the X53 live-mission flake under concurrent load, which passes solo (17.1s) on the final branch. |
| Builds (`npm run build`, `JEV_DESKTOP_BUILD=1 npm run build`) | PASS | Both exit 0. |
| `npm audit` | PASS | 0 vulnerabilities. |
| Android hermetic gates | PASS | Native tool preparation (one legitimate retry), 8 JVM test classes, INTERNET-only manifest, aapt2-verified single-permission APK (v4). |
| Windows native UIA | BLOCKED | dotnet SDK absent → JEV notch binary build plus `scripts/verify-ma5-s1-windows.mjs` and `scripts/ma5-s2/verify-notch-windows.mjs` not executed. |
| Narrator / TalkBack / physical Android | BLOCKED | Not executed; no emulation-as-hardware claim. |
| Populated dialogs (sign-out, revoke, stop, consent, artifact) | BLOCKED | Require a paired device or seeded Host; protocol-excluded consistently with E5A. |
| Connected Services coverage | PARTIAL | relatedOnly by design; owner-reopenable. |
| Home/Chat alias | PARTIAL | Blueprint-specified; owner-review item. |

## Owner-attended hardware requirements

The remaining qualifications need the owner's presence and hardware, none of them executable by emulation or by this environment:

1. **Windows native UIA** — install the dotnet SDK, build the JEV notch binary, then run `scripts/verify-ma5-s1-windows.mjs` and `scripts/ma5-s2/verify-notch-windows.mjs` against the real window.
2. **Windows Narrator** — a native assistive-technology session; browser DOM/keyboard checks are not Narrator evidence.
3. **Android TalkBack and one physical Android device** — installed Activity, screen-reader and physical safe-area checks (adb device required).
4. **Paired device / seeded Host** — populated dialogs (sign-out, revoke, stop, consent, artifact) and populated long-cell table behaviour.

## Rollback

The fix line is stacked; revert in reverse order (evidence commits included so the tree returns exactly to the E5A record `073683e`):

```powershell
git checkout feat/e5c-e5d-universal-ui
git revert --no-edit 4caeca9     # definitive 440-case evidence
git revert --no-edit 38d2994     # runner 125% + focus cases
git revert --no-edit c408f0e     # 44px targets + forced-colors titles
git revert --no-edit c77d58e     # phone dock + toast
git revert --no-edit ba75912     # first 434-case evidence
git revert --no-edit b301ff2     # F06 nav IA
git revert --no-edit ddfb362     # F04 gutters + wrappers
git revert --no-edit a548456     # F02 settings rows
git revert --no-edit c8e3f87     # F01+F07 workspace layout
git revert --no-edit be845b5     # F03 ultrawide
git revert --no-edit 25fa3fb     # E5D matrix skeleton + plan
git revert --no-edit 6ba186c     # F05 material/media precedence
git revert --no-edit e3b398f     # F08 companion hydration
npm run typecheck                # routeTree.gen.ts is generated; its churn is not part of the record
```

Or, on a throwaway checkout that holds nothing else, restore the branch to the E5A record commit in one step:

```powershell
git reset --hard 073683e
```

Notes: revert only on this feature branch — never reset a shared branch. If a revert sequence conflicts (later fixes edited code introduced earlier, e.g. `c77d58e` over `c8e3f87`'s `workspace-layout.ts`), fall back to the single reset on the throwaway checkout. The uncommitted `src/routeTree.gen.ts` phantom is generated output, not part of the record; leave it.

## Evidence index

- **Matrix** — [evidence/e5d-matrix.json](evidence/e5d-matrix.json): 440 records (416 screen + 8 intensity + 10 media + 6 focus), `sourceCommit 38d2994…`, `capturedAt 2026-11-04T15:12:32Z`, live-connection runtime note, per-case measurements, console/HTTP/overflow results.
- **PNGs** — [evidence/](evidence/): 638 on disk; the definitive matrix references 437. Three capture records carry no PNG because there was nothing honest to capture (connected-services silver landscape-text125 at 16px, and both focus-approvals with an unreachable focus). 201 first-run `-panel.png` files from `ba75912` remain on disk superseded but retained.
- **First run** — `ba75912` (434 cases, 386 PARTIAL + 48 BLOCKED, offline-state caveat documented above).
- **Contact sheets** — [sheets/](sheets/): 17 grid sheets built from the definitive matrix into `docs/ux/e5d/sheets/` as `e5d-contacts-<profile>-<variant>-01.png` (all 8 profiles × Silver/Graphite) plus `e5d-contacts-extra-01.png` (intensity/media/focus cases).
- **Qualification summary in E5A** — [docs/ux/e5a/VALIDATION.md](../e5a/VALIDATION.md) ("E5C+E5D qualification") and [docs/ux/e5a/EVIDENCE.md](../e5a/EVIDENCE.md) ("E5C+E5D evidence ledger").