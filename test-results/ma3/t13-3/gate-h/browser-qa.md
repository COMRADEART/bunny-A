# T13.3 Gate H — browser QA of Studio Appearance → Character style

Final run: `browser/appearance-qa.log` and `browser/appearance-qa.json`, **36 of 36 checks pass**, no console errors.
Script: `browser/appearance-qa.mjs`. Screenshots: `screenshots/`.

## Environment

- **UI and Hosts.** The dev UI is served by Vite on port 8091. It talks to an isolated QA Host on port 43190, which uses its own data directory under `%TEMP%`. The production Host (port 43119) was not touched.
- **Browser.** Headed Microsoft Edge (Chromium) driven by Playwright through `channel: "msedge"`, using the machine's real GPU.
  - The display ran at 60 Hz during the run.
  - The machine has 22 logical processors and an RTX 4050 Laptop GPU plus Intel Arc graphics.
- **QA Host data.** Only slots 1 (Gada) and 2 (Spear) are bound, so the Studio Notch preview shows those two Agents beside Bunny. The native harness (`notch/`) covers all four.
- **No secrets.** No credentials, transcripts or user data are recorded in the receipts.

## What was checked

| Area | Checks |
|---|---|
| **Panel** | The panel shows five styles with the signature tag. The run starts from the signature. |
| **Keyboard** | Focus reaches the style group and is visible. ArrowRight moves Glossy to Cel to Arcade, and each choice is saved on the Host. Focus stays on the chosen radio after the Host answers. Tab reaches intensity, where ArrowRight selects Subtle. Tab reaches High contrast, where Space turns it on. Tab reaches Reset, where Enter returns to Glossy Inflatable at Full. |
| **High contrast** | A solid outline appears and the decorative skin layer is hidden in all three previews (Notch, Card, Detail). |
| **Notch preview** | On the top and bottom edges the Agents sit left of Bunny; on the left and right edges they sit above. Exactly one speaker mark shows, on the Host's foreground Agent, and working dots appear only where the Host reports work. No completion celebration plays. |
| **Styles** | Each of the five styles is saved on the Host and drawn in all three previews. Pixel art uses `image-rendering: pixelated`. |
| **Reduced motion** | All 13 characters on the page are still, including body, skin, halo and pseudo-elements. |
| **Forced colours** | The decorative skin layer is hidden and the controls stay visible. |
| **Design preview** | The gallery shows all four weapons in all five styles (20 cells). |
| **Authority** | Recent Missions and the Personal Agents facts are identical before and after every style change. |
| **Mobile 390×844** | Neither the panel nor the gallery overflows horizontally, the Notch preview fits on the left and top edges, and every style option is at least 44 px tall. |
| **Console** | No errors on desktop or mobile. |

## Defect found and fixed during QA

**Keyboard focus was lost after each choice.** `character-appearance.tsx` disabled the controls while a change was in flight. A disabled radio drops focus to the page body, so a keyboard user lost their place after every ArrowRight.

The fix keeps the controls enabled. A ref guard (`inFlight`) stops overlapping sends, and the section carries `aria-busy` while the Host answers. The check "focus stays on the chosen radio after the Host answers, and is visible" covers this.

## Exploratory attempts and retests

- **`appearance-qa-attempt-1.log`.** Playwright's bundled Chromium is not installed on this machine, so the script was switched to the installed Edge (`channel: "msedge"`).
- **`appearance-qa-attempt-2.log`.** This attempt failed in two ways:
  - **Server-render error.** The page threw "Failed to load url ./character-styles.css". The QA Vite process had started before that file existed. Vite was restarted, and the console has been clean since.
  - **Hidden mobile navigation.** At 390 px the "Agents" button lives in the collapsed navigation, so the script now opens "Toggle navigation" first.
- **`appearance-qa-attempt-3.log` / `.json`.** This run passed 36 of 36. It was re-run once because the mobile panel screenshot showed the "Skip to content" link over the Arcade option.
  - **The overlay was a screenshot artifact.** The panel is taller than the viewport, and Playwright stitches such element captures in a way that draws the off-screen fixed skip link over the content.
  - **The re-run recorded what had focus.** It was the page heading (`H2`), not the skip link. The run also added a plain viewport capture, `t13-3-h-appearance-mobile-viewport.png`. In that capture the skip link sits at `y = -100` (hidden) and the Arcade option is unobstructed. This is a capture artifact, not a layout defect.
- **Cursor's built-in browser** produced the two screenshots `t13-3-h-appearance-desktop-signature.png` and `-desktop-arcade.png`. Its synthetic key presses do not trigger default actions: a passive listener saw the keydown, but arrows changed no radio and Tab moved no focus. The keyboard checks were therefore run in Playwright, where keys behave as they do for a real user.

## Pixel art and the canonical glass tile

The canonical hero and card art draws each character over a translucent glass tile. The pixel style uses 1-bit alpha: each sprite cell is fully opaque when its alpha coverage is at least 50%, and fully transparent otherwise. That removes the translucent tile, so the pixel character sits directly on the flat pixel well.

The character's scale and position are unchanged. The rendered boxes, intrinsic aspect ratios and `object-fit: contain` all match the glossy images. The silhouette agreement with the original art is covered by the unit tests in `character-style.test.ts`.

## Web performance (measured, not assumed)

Each run used a 5-second window after a 1.5-second settle.

| Metric | How it was measured |
|---|---|
| Frames | `requestAnimationFrame` intervals |
| Main-thread time | CDP `Performance.getMetrics` |
| Process CPU | Browser CDP `SystemInfo.getProcessInfo` (`cpuTime` delta per process type), expressed as a percentage of one core |
| GPU utilisation | Windows `GPU Engine` counters for Edge's GPU process, all engines |

| Run | Animated characters | Frames: fps / p95 / max | Renderer CPU | GPU-process CPU | GPU utilisation |
|---|---:|---|---:|---:|---:|
| Reduced motion (baseline) | 0 | 60 / 16.8 / 16.9 ms | 3.99% | 1.33% | 0.03% |
| Gada intensity off | 3 | 60 / 16.8 / 17.0 ms | 14.74% | 27.10% | 23.27% |
| Glossy | 9 | 60 / 16.8 / 16.8 ms | 18.69% | 27.78% | 23.23% |
| Cel | 9 | 60 / 16.8 / 16.9 ms | 18.94% | 27.86% | 23.55% |
| Arcade | 9 | 60 / 16.8 / 17.1 ms | 17.73% | 27.21% | 23.17% |
| Comic | 9 | 60 / 16.8 / 16.9 ms | 18.72% | 27.47% | 23.33% |
| Pixel | 9 | 60 / 16.8 / 16.9 ms | 16.97% | 26.90% | 22.06% |

Every style holds 60 fps, and no frame exceeded 25 ms. Most of the GPU cost already appears with three animated characters at intensity off. The five styles add about 2–4% of one renderer core over that run and no measurable GPU utilisation. Pixel is the cheapest.

**Battery: NOT MEASURED.** The machine was on AC power (`BatteryStatus` 2), and per-process energy is not exposed without SRUM or administrator tooling.

**Limitation.** These numbers come from one machine on one browser at 60 Hz. The native Notch numbers are in `notch/style-receipts.json`.
