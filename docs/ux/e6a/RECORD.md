# E6A — Phase record: software-verifiable closes after E5C+E5D

Recorded 2026-11-04 on `feat/e6a-software-gaps` from `main` `9bdcdc5` (merged PR #100). This file
closes the software-verifiable part of the E6 mission; owner-attended hardware items stay
explicitly open (see "Still owner-attended"), never relabelled.

Status meanings are E5A's: PASS = executed and evidenced; PARTIAL = part of the scope evidenced;
BLOCKED = the required destination, device or channel was unavailable.

## What closed (fix line, oldest first)

| # | Fix | Commits | Evidence |
|---|---|---|---|
| 1 | **X53 false-FAIL on an unbuilt ownership artifact set** — the Git steps launch through `windowsOwnershipModule()`, which reads `native/bunny-owned-process.node(.json)` built by pretest; on a bare checkout step 1 failed ENOENT three times, the first Host never reached its stop role and the test died "Owned disposable Host failed to exit". Now skips as NOT TESTED (same honesty class as the existing Calculator/input-desktop gates). Reproduced with artifacts moved out: 0 fail / 1 skipped in 0.9 s; artifacts restored after. | `5e78248` | reproduction noted in the commit; evidence protocol below |
| 2 | **X53 completion wait vs mission budget under concurrent load** — one failure in 34 loaded attempts (solo, serial-under-build-load, pairwise-concurrent, 4-way layered build+typecheck+test:ui load): 105.9 s, `Timeout: Integrated Mission completion`, the test's whole-leg 100 s deadline binding while the mission's own per-step contract is 600 s; every other loaded run completed in ≤24 s. The completion wait is now 180 s (inside the mission budget, inside the raised 240 s node:test timeout) and a timeout records `integrated-stall.json` with the last observed agent state plus worker output, so a future stall carries its own evidence instead of silence. The post-fix run passes 17.6 s. | `5e78248` | campaign tally in commit body |
| 3 | **125% text leg measured mid-application** — the runner read root `fontSize` immediately after navigation, racing the app's post-hydration scale pass: the definitive E5D matrix lost the scale on 9 of 25 silver landscape navigations (each held after its single re-apply) and one double loss falsely recorded connected-services as unable to apply 125% text. Measurement now waits for the scale to settle (bounded 5 s `waitForFunction`), keeps the single real-control re-apply, and BLOCKs only on a measured non-settling fontSize. Fresh full leg: 52 captures = 50 PARTIAL + the 2 relatedOnly connected-services blocks that are blocked by design, **zero scale notes**. | `925811b` | isolated-harness leg run on the live adapter + host (`connection: live` in both sampled records) |
| 4 | **Expanded in-flow phone dock had no Escape binding** (E5D F07 retained open item) — `premium.tsx` hands the shell's `dock` placement through; `ContextPanel` binds the shared `escapeClosesDrawer` guard for it: Escape from inside the expanded dock collapses to the rail and focus returns to the reopen control, exactly the drawer contract. Desktop inline panels keep no Escape binding. | `f7b724f` | new `context-dock.test.ts` lock; `npm run test:ui` 474/474 |
| 5 | **Phone-band touch targets** — character slot chips (34 px), animation-intensity and high-contrast rows and the background-task policy rows (native 13 px boxes inside short labels) now reach the 44 px thumb bar on the phone bands only; desktop keeps its compact pills by design. | `925811b` | `e5d-css-fixes.test.ts` source lock; 8/8 in the touched suites |
| 6 | **Populated isolated fixtures** — approval offer (left pending), consent granted → COMPLETED with two verified artifacts, consent revoked through the real dialog → STOPPED, two real paired devices with a revoke executed through the real UI dialog, Server Control populated. 0 console errors. | See below | `docs/ux/e6a/evidence/populated/` (script `scripts/e6a-populated-captures.mjs`) |

## Populated-fixture protocol (E6A-authorized isolated fixtures)

The E5D matrix excluded populated dialogs (`BLOCKED — require a paired device or seeded Host`).
E6A authorizes isolated test fixtures, so `scripts/e6a-populated-captures.mjs` drives the isolated
harness: the desktop adapter (:8082) plus an isolated Host (`BUNNY_HOST_DATA_DIRECTORY`), where
every row is created by the Host's own authenticated loopback commands — never a mocked record,
never on a production Host. Guards: `E5D_ISOLATED_HOST=1` and `E6A_FIXTURE_HOST=1`; a non-fresh
Host state refuses to run. The workstation sign-out dialog cannot be reached from the desktop
adapter's UI and stays an owner-attended item, recorded, not forced.

Observed, all real: Deny dialog ("Deny this Mission access?") captured then cancelled — offer
remains; keyboard contract green (focus inside the dialog, Escape closes it, Radix); Revoke-consent
dialog executed → Agent STOPPED; two devices paired via `pairing.create` + `/pair`; device revoke
dialog captured and confirmed → `revoked: true`; artifacts `filesystem.read/compare` both
`verified: true`; Server Control populated (device row + events).

## Acceptance matrix (deltas from the E5D record)

| Criterion | Status | Basis |
|---|---|---|
| X53 intermittent mission gate | PASS (two root causes closed, see 1–2) | Deterministic artifact-absence skip reproduced (0.9 s, 1 skipped); load campaign: 1 failure in 34 loaded attempts → budget-aligned wait with per-occurrence stall evidence; post-fix run 17.6 s PASS |
| Expanded phone dock Escape | PASS | Escapes collapse to the rail and return focus; source lock + suite |
| 125% text-scale landscape leg | PASS | New full leg: 52 cases, 0 scale notes, only by-design relatedOnly BLOCKs |
| Touch targets on phone bands | PASS (recorded gaps fixed) | chips 44 px, intensity/check rows 44 px, policy rows 44 px on phone bands; desktop compact by design |
| Populated approval/consent/artifact/device/Server Control | PASS | Populated fixture protocol above; keyboard contract measured on the real dialogs |
| Island component tests | PASS | 474/474 (473 prior + the dock Escape lock) |
| Theme preservation (item 6) | PASS | `ui-theme.test.ts` + `ui-theme-glass.test.ts` 23/23; 22 theme names present in `ui-theme.ts` |
| Glass intensity vs blur (item 7) | PASS | Owner invariant asserted across all 101 intensities × transparency axis (blur stays f(transparency)); native confirmation remains with F05 |
| Paired-device authority (item 8) | PASS | `tests/native-companion.test.ts` 4/4 — consequential approvals refused to devices (`APPROVAL_ON_HOST`), workstation-only actions refused |
| Windows native UIA (dotnet) | BLOCKED | Needs the dotnet SDK — owner-attended (Phase E6B) |
| Narrator / TalkBack / physical Android | BLOCKED | Owner-attended (Phases E6B/E6C) |

## Harness facts learned this phase (for E6B/E6D)

- The isolated capture harness is reproducible: fresh `BUNNY_HOST_DATA_DIRECTORY` + `BUNNY_HOST_PORT`
  (the owner's production Host occupies 43119 and was never touched), then `npm run build`,
  `JEV_DESKTOP_BUILD=1 npm run build`, `install/.output` → junction to the root build output,
  `node install/server.mjs` wired to the same data directory; the adapter reads `credentials.json`
  for the Host port. Connection measured `live` in captures.
- Fixture hosts are per-run disposable: the script refuses to populate a non-fresh Host state.

## Still owner-attended (unchanged scope, from the E5D record + E6 brief)

Windows UIA/notch (dotnet SDK), Windows Narrator, Android TalkBack + one physical device, paired
device sessions on real hardware, workstation sign-out from the adapter UI. None of these is
marked PASS by this phase: no evidence exists yet, and none may be simulated.

## Rollback

Revert in reverse commit order on this branch only (never reset a shared branch):
`925811b` (text-scale settle + touch targets) → `5e78248` (X53 gates + budget) → `f7b724f` (dock
Escape) — the fixture commit (`populated fixtures`) can be reverted independently since it only
adds a script and evidence. The junction `install/.output` is a generated link and can be deleted
safely; `src/routeTree.gen.ts` churn is generated output.