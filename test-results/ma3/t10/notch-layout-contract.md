# M-A-3 T10 — Glass Notch layout contract (§28–§33)

The source is `install/Bunny-Island.Placement.ps1`. There is one placement rule, `Get-BunnyPlacement`, and one indicator rule, `Get-BunnyIndicatorLayout`. Both are pure functions over the monitor **work area** (taskbar excluded) and the requested bar size. The Island (`Bunny-Island.ps1`) and the tests call the same functions.

## Placement (`Get-BunnyPlacement -Edge -WorkArea -Size -Offset -Margin`)

| Input | Rule |
|---|---|
| Edge | `top`, `bottom`, `left` or `right` (normalized; unknown → `top`) |
| Offset | 0..1 along the edge (0.5 = centred); clamped |
| Margin (gap) | `min(max(0, Margin), min(areaW, areaH) / 4)`, so the inner box keeps at least half of the area |
| Top / bottom | **Horizontal** notch. Width = `min(requestedW, innerW)`, height = `min(requestedH, innerH)`. Pinned to the edge at the gap; slides along X by the offset. **IndicatorSide = `left`.** |
| Left / right | **Vertical** notch. The bar's thickness becomes the width and its length becomes the height, each clamped to the inner box. Pinned to the edge; slides along Y by the offset. **IndicatorSide = `top`.** |
| Bounds | The result always lies inside the work area: every dimension is clamped to the inner box, so the notch never leaves the usable screen (V49). |

## Agent indicators (`Get-BunnyIndicatorLayout -Placement -AgentCount -MaxVisible`)

| Field | Rule |
|---|---|
| Side | From the placement: **left of a horizontal notch** (V47), **on top of a vertical notch** (V48) |
| Axis | `column` for a horizontal notch (stacked beside it), `row` for a vertical notch (laid across its top) |
| Visible | `min(count, cap)`, where cap = `clamp(MaxVisible, 1, 5)` (default 3) |
| Overflow | `count − visible`, shown as a `+N` chip; slots = visible + 1 when there is overflow |

## Voice state on the notch (V46)

| Host fact | Notch shows |
|---|---|
| `open && capturing` with a fresh poll (< 1 s) | **Listening**: accent mic glyph, level meter driven only by `snapshot.level` |
| `playing` | **Speaking**: accent glyph |
| A live proposal or an agent `WAITING_FOR_USER` | **Needs approval for <name>** |
| TRANSCRIBING / PROCESSING | Processing |
| ERROR / DEVICE_UNAVAILABLE | **Voice needs attention**: warning glyph, plus a device line (privacy off, muted in Windows, unavailable, disconnected, speakers muted) |
| Host offline | "Host offline - voice unavailable", in warning colour |

No state is animated from a timer, and the voice layer adds no decorative animation, so reduced motion and high contrast stay quiet (V51).

## Evidence

- `notch/placement-receipts.json`, and screenshots for each edge and state: `top|bottom|left|right` × `idle|listening|speaking|voice-idle`.
- `notch/overflow-receipt.json` and `overflow-top-idle-5agents.png`, for the `+N` chip.
- `notch/reduced-motion-top-idle.png`.
- `notch/hotkey-product-receipt.json`, for the product chord Ctrl+Alt+Space on the real Island.
- Deterministic tests: `scripts/island-placement.test.mjs` and `scripts/island-voice.test.mjs`.
- **Not tested:** secondary monitors and mixed-DPI layouts. Only the primary monitor at its current scale was exercised.
