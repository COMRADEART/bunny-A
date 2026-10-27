# Movable Glass Notch & Real-Time Agent Experience

**Product:** Bunny A by LOKAM  
**Milestone:** MA4-S3-T5  
**Document:** Visual Identity, Dynamic Placement & Agent Indicator Specification  
**Classification:** Visual Design & User Experience Specification  

---

## 1. Visual Language & Design Ethos

Bunny A's desktop presence is grounded in a refined, unobtrusive visual language that synthesizes Apple Human Interface guidelines with native Windows 11 aesthetics:
- **Translucent Acrylic Glass:** Window background uses WPF transparency (`AllowsTransparency="True"`) with a blurred dark glass aesthetic (`#2C2C2E` at 85% opacity with dynamic acrylic diffusion).
- **Subtle Metallic Accents:** Borders utilize a delicate 1px stroked gradient (`#1FFFFFFF` highlights with `#636366` metallic framing).
- **Legible Typography:** Standardized entirely on Microsoft's modern variable font family:
  ```css
  font-family: "Segoe UI Variable Text", "Segoe UI Variable", "Segoe UI", system-ui, sans-serif;
  ```
- **Geometry & Spacing:** Soft, continuous curves with a 17px border corner radius (`CornerRadius="17"`), minimum button touch targets of 44px, and consistent 8px/12px padding intervals.

---

## 2. Movable Notch Placement Architecture

The notch supports user-configurable positioning across all four primary display edges via `install/Bunny-Island.Placement.ps1`:

```
                    TOP (Horizontal Notch)
         +--------------------------------------------+
         | [Gada][Spear]  Bunny A Status...  [Actions]|
         +--------------------------------------------+
               ^
               | Active agents on LEFT side
               v
LEFT (Vertical)                                       RIGHT (Vertical)
+---------+                                           +---------+
| [Gada]  |                                           | [Gada]  |
| [Spear] | <- Active agents at TOP                   | [Spear] | <- Active agents at TOP
+---------+                                           +---------+
| Bunny A |                                           | Bunny A |
| Status  |                                           | Status  |
| ...     |                                           | ...     |
+---------+                                           +---------+
               ^
               | Active agents on LEFT side
               v
         +--------------------------------------------+
         | [Gada][Spear]  Bunny A Status...  [Actions]|
         +--------------------------------------------+
                   BOTTOM (Horizontal Notch)
```

### 2.1 Orientation & Indicator Alignment Rules
1. **Horizontal Notch (`Edge: "top"` or `"bottom"`):**
   - **Footprint:** Horizontal rectangle (default width 700px, collapsed height 76px, expanded height 664px).
   - **Agent Indicator Side:** Strictly positioned on the **LEFT** side of the central message body (`IndicatorSide: "left"`).
   - **Indicator Axis:** Rendered as a single horizontal row (`Axis: "row"`).
2. **Vertical Notch (`Edge: "left"` or `"right"`):**
   - **Footprint:** Vertical rectangle; the width and height dimensions are swapped along the edge (`Width: 76px`, `Height: 700px`).
   - **Agent Indicator Side:** Strictly positioned at the **TOP** of the central message body (`IndicatorSide: "top"`).
   - **Indicator Axis:** Rendered as a single vertical column (`Axis: "column"`).
3. **Automatic Adaptation:** When the user drags or reconfigures the notch to a different edge, `Resize-Bunny` immediately re-runs `Get-BunnyPlacement`, swaps dimensions if changing between horizontal and vertical, and realigns the indicator layout without restarting the Host or losing active task state.

### 2.2 Bounded Indicator Overflow Protection
To prevent the notch from expanding unboundedly across the display when numerous subagents are active:
- Maximum visible indicator chips is strictly capped at **4 chips**.
- If more than 4 agents are active, an overflow chip (`+N`) is rendered:
  ```text
  Active Agents: 6  -->  [Chip 1] [Chip 2] [Chip 3] [Chip 4] [+2]
  ```
- Verified mathematically in `scripts/island-placement.test.mjs` (13/13 passing tests).

---

## 3. Host-Authoritative Agent States

Bunny A strictly maps UI presentation states to the Host runtime's state model (`TaskExecutionStatus` in `outcome-measurement.ts`). The UI is forbidden from inventing intermediate or speculative statuses.

| Host Status | Product Presentation Label | Motion / Visual Behavior | Meaning |
| :--- | :--- | :--- | :--- |
| `IDLE` | **Ready** | Ambient subtle shimmer | System ready for user input |
| `LISTENING` | **Listening…** | Soundwave breathing animation | Voice input capture active |
| `SPEAKING` | **Speaking…** | Audible amplitude pulse | Outgoing voice synthesis active |
| `PLANNING` | **Planning…** | Circular pulse (Gada) | Planner constructing task DAG |
| `WORKING` | **Working…** | Active weapon rotation | Worker executing code generation or tools |
| `TESTING` | **Verifying…** | Counter-rotation (Chakra) | Tester running deterministic test process |
| `REVIEWING` | **Reviewing…** | Subtle blade flash (Sword) | Reviewer auditing code quality |
| `WAITING_APPROVAL`| **Approval Required** | Amber pulse with badge | Action Broker paused awaiting user consent |
| `PAUSED` | **Paused** | Solid yellow border, motion frozen| Task paused by user or coordinator |
| `COMPLETED` | **Completed** | Solid green check (0.5s transition)| Host kernel verified contract satisfaction |
| `FAILED` | **Failed** | Red border with error badge | Execution failed or unrecoverable error |
| `CANCELLED` | **Cancelled** | Muted slate border, motion halted | Task terminated via abort signal |
| `UNCERTAIN` | **Uncertain** | Dashed border with info glyph | Ambiguous outcome requiring disambiguation |

> [!IMPORTANT]
> **Anti-Hallucination Invariant:** The UI *never* displays `COMPLETED` merely because an LLM emitted completion phrasing (e.g. *"Task is complete!"*) in its text stream. The status transitions to `COMPLETED` only after the Host kernel validates contract satisfaction and records it in SQLite.

---

## 4. Agent Identity & Weapon Artwork

Bunny A represents specialized agent roles through approved identity weapon assets stored in `public/bunny-a/characters`:

```
+-----------+-----------+----------------------+----------------------------------------------+
| Role      | Weapon    | Symbolism            | Approved Motion Token                        |
+-----------+-----------+----------------------+----------------------------------------------+
| Planner   | Gada      | Strength & Structure | Base period 1.8s, halo pulse                 |
| Worker    | Spear     | Speed & Focus        | Base period 1.2s, forward directional thrust |
| Tester    | Chakra    | Truth & Cycles       | Base period 1.4s, counter-rotational cycle   |
| Reviewer  | Sword     | Cut & Precision      | Base period 1.6s, clean edge highlight       |
+-----------+-----------+----------------------+----------------------------------------------+
```

### Brand & Trademark Compliance
- Third-party logos (Ollama, Claude, ChatGPT, Cursor) are rendered strictly in designated model selection chips following their respective brand asset usage guidelines.
- The Bunny A primary logo remains preserved and unmutated across all release candidates.

---

## 5. Motion Performance, Display Scaling & Accessibility

- **Mixed-DPI & Display Scaling:** Tested across 100%, 125%, 150%, and 200% Windows display scaling. The placement math uses device-independent units, ensuring the notch remains anchored within the `WorkArea` bounds on all display configurations without clipping or blurry raster text.
- **GPU Responsiveness:** WPF animations utilize hardware-accelerated composition layers (`SnapsToDevicePixels="True"`, `UseLayoutRounding="True"`).
- **Reduced Motion Mode:** When the user enables Windows `Settings -> Accessibility -> Visual effects -> Animation effects: OFF`, Bunny A detects the preference and immediately disables all rotational, pulse, and sliding animations (`$bunnyAnimate = $false`), reducing transition times to 0 ms.

---

## 6. Verification Summary (Gates T5-G7, T5-G8)

- **`T5-G7` (Movable notch behavior verified):** **PASS** (All 4 edges tested, placement clamped within bounds, size swapping verified).
- **`T5-G8` (Horizontal and vertical agent indicators verified):** **PASS** (Horizontal left / vertical top layout rule verified across all viewports).
