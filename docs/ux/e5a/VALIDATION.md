# E5A — Validation and qualification report

## Status meanings

**PASS** means the specific stated check was executed successfully. **PARTIAL** means only part of the required scope is evidenced. **FAIL** means an observed acceptance failure. **BLOCKED** means the required destination, runtime data, device or qualification channel was unavailable. A successful screenshot is not proof that the feature, accessibility or runtime was fully accepted.

## Verified repository baseline

`main` was freshly fetched and queried through GitHub, then reverified before preparing the PR. It remains protected at **28903a6c23936be58ebdf5c94fe8b2ed0e21b26c**. Zero open PRs were found at the start. Required checks at that exact base commit are all **PASS**:

- [Typecheck, MA4/routing/sandbox-contract, UI tests and builds](https://github.com/COMRADEART/bunny-A/actions/runs/41587033385/job/125754837080)
- [Full MA3/MA4 regression](https://github.com/COMRADEART/bunny-A/actions/runs/41587033385/job/125754836946)
- [Static security checks](https://github.com/COMRADEART/bunny-A/actions/runs/41587033385/job/125754837260)

These base results are not PR-head CI results. This audit runs on Windows with Node 26.13.0; repository CI uses Node 24. Product source is unchanged. The generated route tree's line-ending churn is excluded from the PR. The original dirty checkout is preserved.

## Executed local checks

| Check | Status | Actual evidence / limit |
|---|---|---|
| `npm run typecheck` | PASS | [Log](evidence/typecheck.log). |
| `npm run build` (web/Vercel target) | PASS | [Log](evidence/web-build.log); existing bundler warnings retained. No DATABASE_URL; existing migration script skips deployment migration. |
| `JEV_DESKTOP_BUILD=1 npm run build` | PASS | [Log](evidence/desktop-build.log); actual Node middleware output served for matrix captures. |
| `npm run test:ui` | PASS | 443 tests, zero failed/skipped: [log](evidence/ui-tests.log). |
| Focused glass/contrast tests | PASS | 21 tests, zero failed/skipped: [log](evidence/glass-tests.log). Some overlap existing UI tests; do not sum as unique tests. |
| Keyboard and DOM behavior | PASS | 11 checks: skip link, primary navigation, inspector focus, tab arrows, first-invalid-field focus, mobile menu in both appearances, OS System response, 22 theme entries, slider steps/endpoints/value and reduced-motion animations: [JSON](evidence/keyboard-checks.json). No spoken screen-reader claim. |
| Intensity 0/50/85/100 in both variants | PASS for value/render and blur independence | Eight actual captures. Sampled panel backdrop stays `blur(24px) saturate(1.5)` at every endpoint; intensity does not increase blur. Full subjective material acceptance remains PARTIAL. |
| In-app High contrast / Opaque | PASS for sampled preference/material behavior | High contrast resolves solid material; Opaque computes zero blur; stored 85 retained and limit explanation displayed. Full composite contrast/control coverage remains PARTIAL. |
| OS reduced-transparency emulation | FAIL | Media query matches but sampled material remains translucent and blurred (F05). |
| Forced colors | PARTIAL | Readable system colors visible, but residual computed blur and missing OS-effective-limit semantics require E5B/E5D (F05). |
| Reduced-motion emulation | PASS for sampled animation check | No running decorative animation longer than 1ms; not a full performance qualification. |
| Base feature matrix | PARTIAL | 156 records: 26 named sections × Silver/Graphite × desktop/narrow/mobile; Connected Services' six related-only records are explicitly BLOCKED. Empty-state and local-workstation rights only. |
| Entire baseline matrix | PARTIAL / FAIL | 190 cases: 176 PARTIAL, 8 FAIL (companion React #418), 6 BLOCKED (Connected Services). [Manifest](evidence/baseline.json). |
| Layout probes | FAIL | 18 cases; sidebars reduce Settings to 50px; Dark segment clipped; 844×390 at 125% text overflows to 870px; ultrawide track unused; server panels unpadded. [Metrics](evidence/layout-probes.json). |
| Final built Home render | PASS | Desktop/mobile visible; no console/page errors and no page overflow. [Verdict](evidence/desktop-built-smoke.json), [desktop](evidence/built-smoke-desktop.png), [mobile](evidence/built-smoke-mobile.png). Does not cover F08 deep links. |
| Final dev Home render | FAIL (audit environment) | Visible desktop/mobile, no uncaught page errors, but shared-dependency font files are rejected by Vite fs allow list (403). [Verdict](evidence/dev-smoke.json), [desktop](evidence/dev-smoke-desktop.png), [mobile](evidence/dev-smoke-mobile.png). This is not represented as a clean gate. |
| Dev/built body equality | PARTIAL | Visual review shows the same Home structure; hashes differ with real changing CPU/memory/time text. Preliminary generic Vercel preview also refused workstation gateway access. No blanket non-divergence claim. |
| PR-head full CI | PENDING | Must be read at the current PR head. Full local `npm test`, security audit and hardware suites were not rerun as part of this documentation-only slice. |

## Physical-device and runtime limitations

| Qualification | Status | What is missing |
|---|---|---|
| Windows Narrator | BLOCKED | No verified native assistive technology session, audible announcements or native UIA traversal evidence. Browser accessibility DOM/keyboard checks are not Narrator. |
| Android TalkBack / installed Activity | BLOCKED | No connected qualified physical Android device; adb not available in this environment. No install, screen-reader or physical safe-area test claimed. |
| Windows native notch | BLOCKED | No installed-window drag, docking, DPI, multiple-monitor, hardware rendering or screen-reader qualification performed. Source/assets/placement/security unchanged; that is a preservation claim only. |
| Paired-phone rights | BLOCKED | Companion screenshots use the real local browser at a mobile viewport with workstation viewer state. They do not establish the paired-device approval ceiling. |
| Populated dialogs and workflows | PARTIAL | No tasks, user projects, missions, teams, pending approvals or memory rows seeded. Actual empty/unavailable states only, plus reversible UI navigation/appearance on isolated state. |
| Performance / battery / hardware fallback | PARTIAL | No compositor/frame-time/memory/battery benchmark or physical hardware fallback test. E5D must measure, not infer from a screenshot. |

The preview Host used an isolated temporary state directory. The audit did not submit a Task, create/approve a Mission, authenticate a provider, request notification/device/microphone permission, open the microphone, create a pairing code or add Android permissions. Reversible foreground selection and widget/appearance preferences were exercised only on isolated state, then restored. Approvals and security boundaries were not modified.

## Reproduction for reviewers

Use an already started isolated Host and the desktop built adapter, with existing gateway checks intact. The standard preview was occupied by an unmanaged server and was left alone; the audit adapter used an alternate local port. Never point these probes at an ordinary populated Host. `E5A_ISOLATED_HOST=1` is an explicit assertion that separate Host state has been configured; it does not create isolation itself.

```powershell
$env:E5A_ISOLATED_HOST='1'
node scripts/e5a-ui-baseline.mjs http://127.0.0.1:8082/
node scripts/e5a-keyboard-checks.mjs
node scripts/e5a-layout-probes.mjs
./scripts/e5a-contact-sheets.ps1
```

Targeted baseline recapture retains other records when `E5A_APPEND=1` and `E5A_SCREENS` names a comma-separated inventory ID (or `companion`). Raw JSON and image filenames stay linked in EVIDENCE.md. If probes fail, keep the failure evidence; do not weaken Host authentication, permissions or approval gates to obtain a green capture.

## E5C+E5D qualification

Appended 2026-11-04. This section closes the E5A defects F01–F08 on `feat/e5c-e5d-universal-ui` (head `4caeca9`; fix commits `e3b398f`, `6ba186c`, `be845b5`, `c8e3f87`, `a548456`, `ddfb362`, `b301ff2`, plus E5D additions `25fa3fb`, `c77d58e`, `c408f0e`, `38d2994`, evidence runs `ba75912`, `4caeca9`). The standalone record with verbatim commands, per-commit rollback and the full evidence index is [docs/ux/e5d/QUALIFICATION.md](../e5d/QUALIFICATION.md). The same status meanings as above apply.

### Defect closure matrix

Every row is measured on the fixed build with the E5A probe vocabulary and the E5D matrix; 440 captures, **0 FAIL**, zero console errors across all captures.

| Defect | Fix commit | Measured closure | Status |
|---|---|---|---|
| F01 workspace allocation | `c8e3f87` | Dedicated widget-sidebar (320px) + expanded-context case: Settings **50px → 329px @1181**, **134px → 428px @1280** | PASS |
| F02 settings rows | `a548456` | At 375px the Appearance row is **291px wide with client = scroll** (System/Light/Dark all unclipped; was 140px client / 192px scroll under `overflow:hidden`). At 844×390 @125% text the document width is **844px** (was 870px / 26px overflow) | PASS |
| F03 ultrawide width | `be845b5` | `.workspace-content` cap removed: Server Control consumes the full 2048px track (matrix: split width 2344px, `max-width: none`) | PASS |
| F04 panel gutters + tables | `ddfb362` | Token gutters on every direct `.t8-surface` panel and explicit `.fabric-scroll` wrappers in source; read-only authority and labels byte-identical | PASS for empty state; populated long-cell behaviour PARTIAL |
| F05 material/media precedence | `6ba186c` + `c408f0e` | OS reduced transparency: computed blur **0px** and opaque surface, decorative filtering removed, stored intensity kept and the limit explained in Appearance. Forced colors: decoration removed and preset titles resolve to CanvasText. The `blur(24px) saturate(1.5)` invariant for the stored-intensity material is preserved | PARTIAL — CDP-emulated only; native/browser environments and a physical OS pass stay open |
| F06 navigation IA | `b301ff2` | 8 new nav destinations each verified by cold-load deep link; Notifications no longer highlights Activity and vice versa. Home/Chat alias is blueprint-specified design (owner-review item); Connected Accounts mapping recorded, never relabelled as services | PASS for the touched destinations, with retained owner-open notes |
| F07 inspector reachability | `c8e3f87` + `c77d58e` | Context drawer focus contract (drawer semantics at 1180/1181, focus management restored); widget drawer demoted; phone profile resolves to a collapsed dock whose expanded form joins the layout flow — the offline toast no longer covers it | PASS; expanded in-flow dock has no Escape binding (drawer Escape live at 1180/1181) — recorded open |
| F08 companion hydration | `e3b398f` | Both renders derive from the same router search: parity across the four deep-linked tabs, direct load, reload and reload-Back; no React #418 | PASS |

### Acceptance matrix

| Criterion / toolchain | Status | Basis |
|---|---|---|
| F01–F03 geometry (above) | PASS | Measured on the fixed build; plain-route corpus in the E5D matrix. |
| F04 empty-state composition | PASS | Matrix captures at every profile; populated rows PARTIAL (seeded Host required). |
| F05 reduction / forced colors | PARTIAL | Measured PASS under CDP emulation (blur 0px / CanvasText titles); physical OS confirmation open. |
| F06 destinations + highlight mapping | PASS | 8 cold-load deep links verified; Notifications≠Activity; Home/Chat alias and services mapping owner-open by design. |
| F07 drawer/dock + focus contract | PASS | Focus management verified; Escape gap on the expanded in-flow phone dock recorded. |
| F08 companion parity | PASS | ×4 tabs + reload + reload-Back, clean console. |
| 125% text-scale persistence | PARTIAL | Root `fontSize` 20px verified after navigation on 7 of 8 profile legs; the connected-services silver landscape leg stayed at 16px and is recorded **BLOCKED** rather than captured at the wrong scale. |
| 44px touch targets (E5D cases) | PARTIAL | Stale-pairing reveal and AI & Models tab pills reach 44px on phone bands; desktop keeps its 40px pills. Pre-existing targets below the E5A vocabulary (AI tab desk rows 40px, character chips 34px, policy checkboxes 13×13) are triage-verified pre-existing, not regressions, and are recorded, not fixed here. |
| Keyboard checks (`e5a-keyboard-checks.mjs`) | PASS | 11/11 on the fixed build. |
| Layout probes (`e5a-layout-probes.mjs`) | PASS | 18 cases, 0 overflow. |
| E5D focus cases | 4 PASS + 2 BLOCKED | Focus ring measured on home/settings both variants; approvals walks reached no Tab-reachable control because the isolated Host has an empty approval queue — nothing focusable, recorded honestly. |
| Island component tests (`npm run test:ui`) | PASS | 473/473. |
| Navigation model tests | PASS | 10/10. |
| Full regression (`npm test`) | PARTIAL | 1763/1764; the single failure is the X53 live-mission flake under concurrent load, which passes solo (17.1s) on the final branch. |
| Builds | PASS | `npm run build` (web/Vercel target) and `JEV_DESKTOP_BUILD=1 npm run build` both exit 0. |
| `npm audit` | PASS | 0 vulnerabilities. |
| Android hermetic gates | PASS | Native tool preparation (with one legitimate retry), 8 JVM test classes, INTERNET-only manifest, aapt2-verified single-permission APK (v4). |
| Windows native UIA (notch binary build + `verify-ma5-s1-windows.mjs` / `scripts/ma5-s2/verify-notch-windows.mjs`) | BLOCKED | dotnet SDK absent in the qualification environment → JEV notch binary build and both UIA verification scripts not executed. |
| Narrator / TalkBack / physical Android device | BLOCKED | Not executed; no emulation-as-hardware claim. |
| Populated dialogs (sign-out, revoke, stop, consent, artifact) | BLOCKED | Require a paired device or seeded Host; protocol-excluded consistently with E5A. |
| Connected Services mapping | PARTIAL | relatedOnly by design (16 captures labelled related-only Connected Accounts); owner-reopenable; Connected Accounts labels stay accurate and are never relabelled. |
| Home/Chat alias | PARTIAL | Blueprint-specified design; the alias is an owner-review item, not silently dropped. |

### Harness correction (offline → live)

The first E5D capture run (`ba75912`, 2026-11-04, at source `b301ff2`) produced 434 cases: 386 PARTIAL + 48 BLOCKED. The adapter had no Host data directory wiring, so state-backed sections rendered empty: Lotus Memory ×16, Automations ×16 and Connected Services ×16 recorded BLOCKED. The correction wires `BUNNY_HOST_DATA_DIRECTORY` on **both the Host process and the adapter**; the definitive run (`4caeca9`, at source `38d2994`, 2026-11-04) captures 440 cases against the live Host: **422 PARTIAL, 18 BLOCKED (16 relatedOnly connected-services by design + 2 focus-approvals with nothing focusable), 0 FAIL**. Lotus Memory and Automations now render real state and are PARTIAL. No capture was relabelled to make the correction look like a feature result; the first run stays in the ledger with its honest caveat.
