# Accessibility and performance (Visual Experience 2.0, Gates H and J)

All measurements are LIVE, on the **built** desktop app (`JEV_DESKTOP_BUILD=1 npm run build`, served by
`scripts/preview-node-middleware.mjs`, the same adapter the Windows package uses). It connects to a disposable real Host
seeded by `harness/seed-host.mjs`. Browser: Playwright Chromium, headless, at 1440×900 unless stated. Source: `910eb85`.

## 1. Readability (tested in code, every theme)

`src/lib/bunny-host/ui-theme.test.ts`:

- Every palette of all 22 themes, and its high-contrast form, gives:
  - `fg` and `muted` at 4.5:1 or more on the page, panel, field and elevated surfaces, composited over the page and each wash;
  - status colours as text on a panel, text on hover, and selected navigation text at 4.5:1 or more;
  - button labels at 4.5:1 or more;
  - focus at 3:1 or more on the page.
- Under high contrast: an opaque panel, `border = fg`, no shadows, solid material, and no blur.
- Any theme whose stylesheet sets the action colour as text (`color: var(--action)`) has a built-in action colour of 4.5:1 or more on the page and the solid panel. A custom accent must meet the same bar or it is dropped with a note.
- The Notch's status text, measured on the native Notch itself, reaches 11.1–20.2:1 across all 115 runs (`NOTCH_THEME_SPEC.md`).

## 2. Keyboard and focus (Gate H)

`harness/a11y-keyboard.mjs` covers 8 structurally different themes, light and dark: glass, cybercore, brutalism, pixel,
scrapbook, luxury, neumorph and cyberpunk.

- **Tab walk.** It tabs through the first 40 stops of Chat and of Settings, and checks every stop for:
  - an accessible name;
  - a visible focus indicator (outline or ring);
  - not being covered (`elementFromPoint` at its centre is the element itself or inside it).
- **Gallery by keyboard only.** Focus "Preview Pixel Art without applying it", press Enter: the window shows Pixel Art and `aria-pressed="true"`. Press Escape: back to the saved theme. The Host revision is unchanged, so nothing was saved.

**Result** (`test-results/visual-experience-2/gate-h/a11y-keyboard.json`): **ok**.

- 8 themes × 2 views, 39–40 stops each: 0 unnamed, 0 without a ring, 0 covered.
- The gallery keyboard flow passes.

### Defects found and fixed during Gate H

| Found | Cause | Fix | Evidence |
| --- | --- | --- | --- |
| Luxury: the context panel's toggle was covered when focused, and the masthead clipped "Devices" to "D" | The masthead nav used a hidden horizontal scroll, and luxury's 0.16em tracking overflowed it. The masthead was sticky, so the sticky context panel slid beneath it. | Commits `28fb0fd` and `910eb85`. The masthead destinations wrap onto a second row (never a hidden scroll). The masthead scrolls with the page. Luxury tracking is 0.08em. | `gate-e/topnav-fit.json`: all 5 masthead themes at 1440 and 1280 px. Every destination fits (luxury wraps at 1280), the last control and the context toggle are clear when focused. Then the keyboard walk passes. |
| Reconciliation: focus was lost after picking a choice or pressing Back | The chosen button was replaced by the confirmation | Focus moves to Confirm, and Back returns it to the choice | `gate-i/reconcile-ui.json` keyboard steps |
| Theme Gallery: focus was lost while a save was in flight | The tuning fieldset was disabled during the save | No longer disabled; repeats are ignored | Review finding F8 |

### Other accessibility properties

- **Reduced motion.** `prefers-reduced-motion: reduce`, or the window's Animation set to reduced or off, stops theme entrances and every ambient loop. `data-motion="off"` removes transitions entirely.
- **Forced colours.** Under `@media (forced-colors: active)`, decorative layers are removed and system colours are used.
- **Screen readers.** Decorative layers are pseudo-content or `aria-hidden`. Rail and masthead layouts keep their labels in the accessibility tree. Gallery miniatures are `aria-hidden`; the cards' text and buttons carry the meaning.
- **Text size.** Per window: 90, 100, 110 or 125%, applied to the root font size so the whole UI scales.
- **Mobile.** The phone renders at 390×844 for every theme (§3) with no horizontal overflow.

## 3. Responsive coverage

The capture matrix (`harness/capture.mjs`, results in `matrix/*/results.json`) checks every one of the 278 pages for:

- no page errors and no console errors;
- no horizontal overflow;
- real text;
- live Host data, with the requested theme hydrated and stable for 2 s.

| Folder | Content | Shots |
| --- | --- | --- |
| `matrix/default-light` | 15 light-default themes × 10 desktop screens + phone (390×844, DPR 2, touch) | 165 |
| `matrix/default-dark` | 7 dark-default themes × 10 desktop screens + phone | 77 |
| `matrix/alt-dark` | The dark appearance of 14 two-appearance themes: dashboard + phone | 28 |
| `matrix/alt-light` | The light appearance of 4 dark-default themes: dashboard + phone | 8 |

## 4. Performance (Gate J)

`harness/perf-themes.mjs` runs on the built app at 1440×900 with Settings open, so the 22 gallery miniatures are on
screen. It is the only browser load running. For each theme, in order:

1. Press the real **Preview** control.
2. Time from the click to the first painted frame (two `requestAnimationFrame`s) that carries the theme.
3. Wait 700 ms, then measure a 4 s window: `requestAnimationFrame` intervals, CDP main-thread task time, and the running animations.

Results: `test-results/visual-experience-2/gate-j/perf.json`.

**Hot switch.** p50 **69.6 ms**, p95 **116.4 ms**, max **119.3 ms**, with 0 page errors.

- Nothing reloads and nothing remounts: a switch is attribute and custom-property changes only.
- The Host is never restarted. `ui-theme-host.test.ts` applies all 22 themes while four Personal Agents own delegated Missions: the authority projection is unchanged and the journal shows no lifecycle event.

**Main thread.** At most **4.26 %** busy in a steady 4 s window, in every theme.

| Theme | Switch to painted frame (ms) | fps (4 s) | Frame p95 (ms) | Main thread busy | Running loops (theme-owned) |
| --- | --- | --- | --- | --- | --- |
| clay | 111.4 | 60 | 16.8 | 2.78% | 4 (none) |
| cybercore | 114.8 | 53.75 | 33.3 | 4.26% | 5 (ve-scanline) |
| brutalism | 69.6 | 60 | 16.7 | 3.25% | 4 (none) |
| scrapbook | 65.8 | 60 | 16.7 | 3.23% | 4 (none) |
| surreal | 68.5 | 33.75 | 33.4 | 1.79% | 4 (none) |
| y2k | 116.4 | 51 | 33.4 | 2.83% | 4 (none) |
| pixel | 62.6 | 60 | 16.7 | 3.04% | 5 (ve-blink) |
| synthwave | 82.2 | 37.35 | 33.4 | 2.96% | 5 (ve-grid) |
| glass | 119.3 | 47.75 | 33.4 | 2.8% | 4 (none) |
| neumorph | 111.1 | 60 | 16.8 | 2.87% | 4 (none) |
| bento | 67.3 | 60 | 16.7 | 2.86% | 4 (none) |
| editorial | 86.9 | 60 | 16.7 | 2.96% | 4 (none) |
| swiss | 66.3 | 60 | 16.8 | 3.09% | 4 (none) |
| minimal | 64.2 | 60 | 16.7 | 3.37% | 4 (none) |
| maximal | 52.2 | 60 | 16.8 | 3.44% | 4 (none) |
| luxury | 65.3 | 60 | 16.7 | 3.09% | 4 (none) |
| sketch | 65 | 60 | 16.8 | 2.83% | 4 (none) |
| ethereal | 70.9 | 30.13 | 33.5 | 1.75% | 5 (ve-breathe) |
| bohemian | 105.6 | 60 | 16.7 | 3.19% | 4 (none) |
| victorian | 65.6 | 60 | 16.7 | 1.22% | 0 (none) |
| cyberpunk | 65.3 | 60 | 16.7 | 2.89% | 4 (none) |
| wabisabi | 70.1 | 60 | 16.7 | 3.18% | 4 (none) |

**Persistent loops.** The four loops that run in every theme, including the accepted glass baseline, are the T13 character animations: `wc-ring-pulse`, `wc-sword-hover`, `wc-glint` and `wc-style-sheen`. They show real Agent state and follow the T13 animation gate. Theme-owned decorative loops are `ve-scanline` (cybercore), `ve-grid` (synthwave) and `ve-breathe` (ethereal); surreal's drift runs on the home page only.

**Idle gate.** After 47 s without input, the theme-owned loops stop (`data-ambient="off"`):

- synthwave: 5 running → 4, the T13 characters only;
- surreal on Settings: 4 → 4, because its ambient drift lives on the home page.

They also stop whenever the window is hidden, under reduced motion, and with the window's Animation set to reduced or off.

**Frame rate (software compositing).** Headless Chromium here composites in software:

- **Light themes:** most sustain 60 fps.
- **Heaviest backdrop and gradient themes:** surreal, synthwave and ethereal measure 30–37 fps (frame p95 ≈ 33 ms).
- **Accepted glass baseline:** 47.75 fps in the same setup.

These are the themes whose manifests declare heavy layers and a fallback (`performance.fallback` in `THEME_CATALOGUE.md`), and the main thread stays at or below 3 % for them, so the cost is compositing, not script. **GPU-composited frame rates on the real WebView2 window were not measured** (limitation L-PERF-GPU).

## 5. Limitations

- **L-PERF-GPU:** frame rates are from headless software compositing, not the real GPU-composited WebView2 window.
- **L-FIRST-PAINT:** the browser theme cache is read after mount, so the first frame after a reload can show glass before the saved theme (review finding F6, partial).
- **No automated axe-core audit.** Nothing new was installed for evidence. Accessibility was measured with the keyboard walk, the contrast tests and the checks above.
- **Physical phone: NOT TESTED.** The phone was tested by 390×844 device emulation only.
