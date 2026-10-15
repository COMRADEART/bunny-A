# Notch theme specification (Visual Experience 2.0)

The Bunny Notch is the native WPF Island (`install/Bunny-Island.ps1` plus its dot-sourced modules). It follows the
workstation theme saved on the Host. It keeps every T13 placement behaviour unchanged at all four edges:

- On a horizontal edge (top or bottom), the Agent indicators sit to the left of the body.
- On a vertical edge (left or right), they sit above it.
- Expansion opens away from the edge.

## 1. Inputs and validation

The Notch reads `snapshot.uiTheme.notch` (see `THEME_DESIGN_TOKENS.md` §5) on its normal snapshot poll.
`install/Bunny-Island.Theme.ps1` validates the tokens again before WPF sees any of them. All of these are pure
functions with no WPF state:

| Rule | Function |
| --- | --- |
| Schema must be `bunny-a.ui-theme.v1`; theme id must match `^[a-z0-9]{2,16}\z` | `Get-BunnyNotchTheme` |
| Shape from `pill`, `capsule`, `block`, `frame`, `tab`, `blob`, `plate` | `Get-BunnyNotchTheme` |
| Font from a fixed list of 17 Windows system fonts. Web fonts are never loaded into WPF. | `Get-BunnyNotchTheme` |
| Radius 0–40, border 0–4, variant `system`/`light`/`dark` | `Get-BunnyNotchTheme` |
| Every colour in both sets matches `^#[0-9a-fA-F]{6}\z`. `\z`, not `$`, so a trailing newline is refused. | `Test-BunnyHexColor` |

If any single value fails, the whole theme is `$null`, and the Notch draws the accepted black-glass T13 look. Nothing
from the snapshot is evaluated, invoked or interpolated into code. The module is ASCII-only, and the test bans
`Invoke-Expression`, `iex`, `ScriptBlock::Create`, `Add-Type`, `Start-Process` and `.Invoke(`.

`scripts/island-theme.test.mjs` runs these functions in real Windows PowerShell 5.1:

- on 44 views (22 themes, each with and without high contrast);
- on 16 hostile inputs (trailing newlines in a colour and in the id, missing data, a foreign schema, bad or short hex, `$(Remove-Item …)` in a colour, `$(calc.exe)` as a font, an unknown font or shape, an out-of-range radius or border, an injected id, a bad variant, a missing palette). Every hostile input must fall back.

## 2. Rendering

| Element | Glass (default) | Any other theme |
| --- | --- | --- |
| Body fill | T13 black glass gradient `#EB1A1E2B` → `#EB07080D` | Vertical gradient `fill` → `fillEnd` at the owner's glass alpha (250/238/218 for low/medium/high) |
| Body stroke | T13 white hairline gradient | `stroke`, or `glow` when the theme glows (never under high contrast) |
| Corners | 28 horizontal / 29 vertical (exact T13) | Pill and capsule: fully round. Blob: deliberately uneven. Tab: rounded top, square base. Block, frame and plate: the theme radius, capped at 16. |
| Border | 1 | Theme border 1–4. Under Windows High Contrast: 2. |
| Text, icons and accent roles | T13 values; the header keeps its own white-on-glass brushes | The theme's `ink`, `muted`, `accent` and `accentInk` replace `BunnyText`, `BunnyMuted`, `BunnyAccent` and the related roles, in the window **and** in the header's local brushes |
| Status colours (positive, negative, warning) | T13 tested values | Unchanged T13 tested values, so their meaning never depends on the theme |
| Font | Segoe UI | The theme's allowlisted Windows font, with Segoe UI as fallback |
| Windows High Contrast | System colours | System colours. The theme is ignored for colour, and the header returns to the T13 brushes. |

Light or dark (`Get-BunnyThemeLight`):

- A light or dark variant **saved** on the workstation (revision above 0) wins.
- Revision 0 means no workstation theme was ever saved. The Notch then keeps its own T13 appearance setting, so an upgrade never flips it.
- `system` defers to the Notch's own appearance setting, which may itself follow Windows.

Once the owner saves an explicit light or dark choice, the Notch's own appearance toggle no longer changes it (limitation L-NOTCH-TOGGLE). Choosing "System" in the gallery hands the choice back to the Notch.

The Notch restyles only when `Get-BunnyNotchThemeKey` changes (theme, revision, variant, high contrast), never on an
ordinary poll. The restyle runs `Apply-BunnyAppearance` and then `Set-BunnyJoin`. Placement, the Agent strip, voice,
the companion and every command path are untouched.

## 3. Defect found and fixed during Gate F

The first full native matrix passed every receipt check. Its screenshots showed something the checks could not see:
on light palettes, the header's status text and icons were light-on-light.

The cause was the header `DockPanel`'s local brushes. They were tuned for the always-black T13 body and shadowed the
remapped window palette. `Set-BunnyTheme` now writes the theme's ink into those header brushes for a themed body. For
glass and Windows High Contrast it restores the T13 originals.

The evidence driver now records the status text's real foreground and fails any run below 4.5:1 against the body fill.
The superseded run, with contact sheets, is kept in `test-results/visual-experience-2/superseded/notch-run1-header-defect/`.

## 4. Evidence

`test-results/visual-experience-2/harness/notch/run-notch.ps1` drives the real Island in `-SmokeTest`. Each run uses a
disposable fixture Host (`fake-host.mjs`, ports 43850–43889) that serves the real `uiThemeView` for one theme. The
Island saves a native `RenderTargetBitmap` screenshot, and the driver recomputes these checks from the receipt:

- theme applied;
- window inside the work area;
- indicators to the left on a horizontal edge, above on a vertical edge;
- expansion anchored to the edge;
- Agent strip shown;
- no `appearance.*` command sent by the Notch;
- no error;
- status text at least 4.5:1 on the body.

The matrix in `runs.json` has 115 runs:

- 22 themes × 4 edges (top, bottom, left, right);
- 22 themes expanded (quick view) at the top edge;
- 3 high-contrast themes (glass, scrapbook, cyberpunk);
- 2 opposite-variant runs (swiss dark, luxury light).

The results are in `test-results/visual-experience-2/notch/` (`notch-receipts.json`, `shots/`, `sheets/`): **115/115
runs, every check passing**. Status-text contrast is 11.11–20.18:1.

The **revision-0 probe** (`gate-f/probe-revision0/`, 3/3) runs with the Notch's own appearance set to dark:

- `glass-top-revision0`: nothing saved on the Host (Host default variant `light`), and the Notch stays **dark**.
- `glass-top-revision1-light`: an explicitly saved `light`, and the Notch turns light.
- `clay-top-revision0`: dark.

This is the live evidence for review finding F1. The packaged `Bunny-Island.Theme.ps1` and `Bunny-Island.Visual.ps1`
are byte-identical to source.

## 5. Not covered

- Multi-monitor, mixed-DPI and taskbar-on-side layouts were not tested in this milestone. The T13 placement evidence for those still applies, and the theme does not change placement.
- Windows High Contrast was exercised only through the theme's own high-contrast tokens and the static restore path. A live system High Contrast session was not captured.
