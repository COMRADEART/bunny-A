# MA5-S1 — Glass notch results

Evidence: `evidence/windows/notch.json` and `lifecycle.json` (same run as WINDOWS_NATIVE_ACCEPTANCE.md). All
coordinates are physical pixels; the UIA helper is per-monitor DPI aware. The notch is a separate top-most window
titled "Bunny Island Notch", created with `ShowActivated=false`. No Apple assets are used: the shape, avatar and
icons are drawn in XAML.

## Docking (primary display, 150 %)

| Edge | Size (px) | Gap to the edge | Centring offset | Agents rendered, in order | Focus after docking |
|---|---|---|---|---|---|
| Right | 136×431 | 0 | 1 | Gada, Spear, Chakra, Sword (lead, aligned, inside the notch) | main window |
| Bottom | 857×122 | 0 | 1 | same | main window |
| Left | 136×431 | 0 | 1 | same | main window |
| Top | 857×122 | 0 | 1 | same | main window |

The vertical layout (Left/Right) now includes the approval badge and quick stop. Controls appear only when there is
something to act on. In the run above the only visible control was collapse, because no approvals or tasks were
pending.

## Drag and snap

| Drag | Drop point | Result |
|---|---|---|
| Primary → left edge | (40, 1157) | Docked Left at x = 0, gap 0, on the expected monitor, ratio 0.60 stored |
| Primary → secondary display, top | (−640, −134) | Docked Top on the Samsung display (work area 1280×976 at −1280, −164), gap 0, 571 px wide at 100 % vs 857 px at 150 % on the primary |

The edge is computed from the cursor position and grip offset at drop time, so a window straddling two monitors with
different DPI cannot snap to the wrong one. Host refreshes do not move the notch during a drag.

## Collapse

571 → 261 px and back to 571, still docked Top on the secondary display. The collapsed flag persists.

## Persistence across restart (`lifecycle.json`)

Saved edge Top with ratio 0.5 and corner (−770, −164) on the secondary display. After Quit and relaunch the notch
returned to Top on the same secondary display: x −926, width 571, inside the work area, not off-screen.

## Focus

A `WM_ACTIVATE` hook records the window that was active before the notch, the main window included, and gives
focus back after mouse actions. Keyboard users keep focus on the notch control. In every docking check the
foreground window afterwards was the main Bunny A window, not the notch.

## Motion

The expand/collapse fade (180 ms) is skipped when Windows client-area animation is off, or when `ReducedMotion` is
true in Bunny A's config file. Not exercised with Windows animations switched off.

## Not exercised (G7 PARTIAL)

- Changing a display's resolution or Windows scale while the app runs.
- Moving or resizing the taskbar (work-area change).
- Unplugging the display that holds the notch.

Handlers exist for these (`DisplaySettingsChanged`, `UserPreferenceChanged`/work area, `DpiChanged` →
re-place on the monitor under the window centre, falling back to the primary). They were not driven during
acceptance, so no PASS is claimed for them. Two monitors with different DPI were exercised for real.
