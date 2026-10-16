# Independent review (Visual Experience 2.0, Gate K)

**Reviewer.** A separate `code-reviewer` subagent on the Sonnet model, instructed to work read-only. It could read the
diff against `0eb58e6`, read the files, and run the four pure unit-test files. It was told never to edit or commit,
start servers, run the Island, or touch production (43119/8084).

**Scope.** The milestone's source (listed in §4). Unrelated user work was excluded: `oauth-pkce*`, `.gitignore`, and
the `test:session-evidence` line in package.json.

**Contract checked.** Eight items:

1. A theme is presentation only.
2. Theme data cannot execute code.
3. Writes are workstation-only, with stale writes refused.
4. The reconciliation UI uses only `task.reconcile` / `mission.reconcile`, is owner-only, and never replays automatically.
5. No new phone authority.
6. Robustness.
7. Accessibility.
8. General correctness.

Round 1 was interrupted once by an API rate limit and resumed from its saved state with the same instructions.

## Round 1: NOT CONFIRMED (1 HIGH, 2 MEDIUM, 6 LOW)

Contract items 1–5 were **CONFIRMED** with evidence:

1. The theme store writes only `ui_theme_preference`. The preference has a closed key set, and no authorization path reads it.
2. CSS variables come only from frozen manifests plus a `#rrggbb` accent. There is no `innerHTML`, `eval`, `url(` or `expression`, and the Notch validates again.
3. `appearance.*` is refused for devices twice: `WorkstationRequiredError`, and its absence from `DEVICE_RIGHTS`. `StaleThemeError` covers stale writes.
4. The UI sends only the two reconcile commands, needs an explicit confirm, and controls are hidden for devices. The only effect moves focus, and nothing resends.
5. The phone diff adds only `useThemeScope` and the look picker. No CSS hides or shows approval controls.

| # | Severity | Finding | Fix |
| --- | --- | --- | --- |
| 1 | HIGH | At revision 0 (no theme ever saved), the Host's default variant `light` forced the native Notch to light on every install and ignored the Notch's own appearance setting. | `Get-BunnyThemeLight` lets the Host variant win only when `Revision > 0`. Revision 0 keeps the T13 Notch setting. Tests: `unsavedNativeDark` and `unsavedNativeLight` in `scripts/island-theme.test.mjs`. |
| 2 | MEDIUM | The first theme save on a never-saved Host dropped the legacy light/dark choice. The Host merged the patch onto its default, `light`. | One helper, `withLegacyVariant()`, is used by the store, `useShownTheme` and the gallery. `setUiTheme` sends the legacy variant on the first save. |
| 3 | MEDIUM | A custom accent only had to reach 3:1 on the page, but several themes use the action colour as label text. Example: luxury light with `#b08a3a`, about 3.3:1. | An accent must reach 4.5:1 on the page and on the solid panel. New test: the gold accent is dropped, and every theme whose stylesheet uses `color: var(--action)` has a built-in action of at least 4.5:1 on both. |
| 4 | LOW | `appearance.theme_reset` ignored `expectRevision`, and a non-numeric `expectRevision` was silently treated as absent. | Reset is revision-checked. A present but non-integer `expectRevision` is refused. The client sends it. Host tests cover a stale reset, `"1"` and `1.5`. |
| 5 | LOW | On a single-appearance theme, the legacy header toggle saved a variant that changed nothing. On a device it pins a device-local look. | The toggle refuses with a note on single-appearance themes. The device pin is by design: the phone says "Kept on this phone only" and offers "Follow my PC's theme". |
| 6 | LOW | The theme cache was written on every snapshot, and the first paint is still glass before the cache is read. | Written only when changed. The first-paint flash is **not fixed** (limitation L-FIRST-PAINT). |
| 7 | LOW | The PowerShell `^…$` checks accept a trailing newline. | `\z` anchors. Hostile tests `trailingNewlineHex` and `trailingNewlineId`. |
| 8 | LOW | Gallery re-render cost, the fieldset disabled during a save dropping keyboard focus, a stale accent draft, `useAmbient` resetting its timer on every pointer move, and "write-capable scope" claimed for read scopes. | Memoized miniatures. The fieldset is no longer disabled (`save()` ignores repeats). The accent draft re-syncs. The ambient timer resets at most once a second. The scope check is now `access === "write"`. The gallery's top-level `useIsland()` without a selector is unchanged. |

## Round 2: CONFIRMED

The reviewer re-read the fixes and re-ran the four pure test files (33 tests, all passing), and `tsc --noEmit` was clean.

| # | Result |
| --- | --- |
| F1 | **FIXED.** `Theme.ps1:58`: the Host variant wins only at `Revision -gt 0`. Tests `unsavedNativeDark` and `unsavedNativeLight`. |
| F2 | **FIXED.** `withLegacyVariant()` is the single application point (store, `useShownTheme`, gallery). The first save sends the legacy variant. |
| F3 | **FIXED.** The accent needs 4.5:1 on the page and on `panelSolid`, with a new test. `validateUiPreference` still stores a weak accent; that is harmless, because `resolveTheme` drops it with a note. |
| F4 | **FIXED.** A malformed `expectRevision` is refused, reset is revision-checked, and the Host tests cover both. |
| F5 | **FIXED** for single-appearance themes. The device pin is accepted by design. |
| F6 | **PARTIAL**, as declared. The write now happens only on change; the first-paint flash remains (L-FIRST-PAINT). |
| F7 | **FIXED.** `\z` anchors, with hostile tests. |
| F8 | **FIXED** except the declared unchanged item, the gallery's top-level `useIsland()`. That stays LOW because the miniatures no longer recompute. |

The fixes introduced no blocking defect. Two new LOW observations:

1. **"Reset to system default" stored variant `light`.** After a reset, the Notch followed the Host instead of its own setting. **Fixed after round 2:** reset now stores variant `system`. The desktop follows Windows, matching the button label, and the native Notch gets its own appearance setting back. The Host test asserts `preference.variant` and `notch.variant` are `system`.
2. **The ambient idle switch-off can come up to 1 s early,** because of the one-second wake throttle. Cosmetic; not changed.

Verdict: **"CONFIRMED: no unresolved HIGH/BLOCKER and no contract violation"**.

Source with the round 1–2 repairs: `4a285a5`; final source after round 3: `910eb85`.

Not covered by the reviewer, because running the Island and the Host was out of bounds for this review:

- the live Notch behaviour at revision 0;
- the live Host tests.

Both are covered elsewhere: the Host tests by the regression run, and Notch rendering by the native matrix (`NOTCH_THEME_SPEC.md` §4).

## Round 3: CONFIRMED (post-review CSS)

The live keyboard walk on the built app found one more defect after round 2, in the masthead layout (luxury). The
masthead's hidden horizontal scroll clipped "Devices", and the sticky context panel's toggle slid under the sticky
masthead. It was fixed in two CSS-only commits, `28fb0fd` and `910eb85`: the destinations wrap, the masthead scrolls
with the page, and luxury's tracking is tighter. The reviewer checked `4a285a5..910eb85` (`engine.css` and `luxury.css`
only):

- every changed engine rule is scoped to `[data-layout="topnav"]`, and the other five layouts are untouched;
- specificity is correct: luxury loads after the engine;
- `position: relative` leaves no sticky layer to offset against;
- wrapping keeps all ten destinations and the 44 px targets;
- the security contract is unaffected (CSS only, no `url(`, `@import` or `content` text).

Verdict: **"CONFIRMED: no new defect"**. One cosmetic note, not a defect: if the masthead wraps so that the "System"
group label starts the second row, its left divider sits at the row start.

**Final reviewed source: `910eb85`.**

## 4. Files reviewed

- **New:**
  - `src/lib/bunny-host/ui-theme.ts`, `ui-theme.server.ts`, `ui-theme.test.ts`, `ui-theme-host.test.ts`
  - `src/components/island/theme.tsx`, `theme-model.ts` (+ test), `theme-gallery.tsx`/`.css`, `reconciliation-model.ts` (+ test), `reconciliation.tsx`/`.css`, `themes/*`
  - `install/Bunny-Island.Theme.ps1`, `scripts/island-theme.test.mjs`
- **Modified:**
  - `src/lib/bunny-host/http.server.ts`, `contracts.ts`, `src/store/use-island.ts`
  - `src/components/island/premium.tsx`, `phone.tsx`, `settings.tsx`, `studio.tsx`, `chat-home.tsx`, `approvals.tsx`, `agent.tsx`, `agentic.tsx`, `mission-model.ts` (+ test)
  - `install/Bunny-Island.Visual.ps1`, `scripts/package-bunny-desktop.ps1`, `package.json` dependencies
