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
