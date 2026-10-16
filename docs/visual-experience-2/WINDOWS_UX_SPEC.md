# Windows desktop UX specification (Visual Experience 2.0)

The desktop app (`premium.tsx` shell and its views) is themed through one engine. Every screen keeps its T13
components, commands, labels and accessibility tree. A theme rearranges and restyles; it never removes a control or
moves one behind a gesture.

## 1. Shell layouts (`data-layout`, at 768 px and wider)

| Layout | Composition | Themes |
| --- | --- | --- |
| `sidebar` | The accepted T13 sidebar, restyled | glass, neumorph, brutalism, scrapbook, sketch, bohemian, wabisabi |
| `rail` | Icon rail. Labels appear as tooltips on hover and focus, and stay in the accessibility tree. | cybercore, minimal, cyberpunk |
| `topnav` | Sticky masthead navigation. Status text is visually hidden but read by screen readers. When the ten destinations do not fit, they wrap onto a second row; nothing is hidden behind a scroll. `scroll-padding-top` keeps focused controls clear of the masthead (WCAG 2.4.11). Measured in `gate-e/topnav-fit.json`: all five themes at 1440 and 1280 px; luxury wraps at 1280. | synthwave, editorial, swiss, luxury, victorian |
| `bento` | Navigation as a tile in the bento grid | bento, maximal |
| `floating` | Detached navigation and panels floating over the page | clay, surreal, ethereal |
| `window` | Each region as a titled window (OS-window or RPG-window chrome) | y2k, pixel |

Below 768 px every theme uses the accepted T13 mobile shell, restyled by its tokens. The capture harness checks every
page for horizontal overflow.

## 2. Screens covered

Every view in the left navigation is themed and captured for every theme in its default appearance:

- Chat (home): hero, compose, quick actions, the Personal Agents module, Missions and tasks. The arrangement follows the home composition (`data-home`).
- Missions, including the Mission plan in the agent inspector (§4).
- Agents (Agent Studio): see `CHARACTER_PRESENTATION.md`.
- Projects, Files, Approvals (with the reconciliation review, `RECONCILIATION_UX.md`), Activity.
- Settings, including Appearance → Theme Gallery.
- System: Models and Devices.

Dialogs render through `ThemedDialogContent`, so a portaled dialog carries the same theme scope as the window that
opened it.

## 3. Settings → Appearance → Theme Gallery

`theme-gallery.tsx` contains:

- **Status line** (`role="status"`): which theme this window shows and where it comes from (saved on the Host, previewing, a link, this device, or the default).
- **Gallery** (`<ul>` with 22 cards). Each card shows a live miniature (desktop, phone and Notch) rendered from that theme's real tokens through the same `scopeFor()` as the app. The miniature is `aria-hidden`, because the card's text carries the meaning. Each card has two buttons:
  - **Preview**: `aria-pressed`, labelled "Preview <Name> without applying it". It changes only this window.
  - **Apply**: "Apply <Name>". It saves to the Host with `expectRevision`.
- **Preview bar** (`ThemePreviewBar`, at the top of the window while previewing). It offers Apply and End preview. Escape also ends the preview.
- **Tuning**, saved with the theme:
  - appearance: System, Light or Dark as a radiogroup; an appearance the theme lacks is disabled;
  - accent colour, with a contrast note when it is dropped;
  - density;
  - transparency;
  - high contrast (a switch).
- **Per window:**
  - text size: 90, 100, 110 or 125%;
  - animation: full, reduced or off. Reduced motion from the OS always wins.
- **Agent characters**: explains that themes frame characters but never replace them, and links to Agent Studio.
- **Notch position**: explains that the position is set from the Notch's own menu or by dragging it to an edge. The gallery does **not** change it. The position is a native Notch preference, not Host state, and adding a Host channel for it was out of scope (limitation L-NOTCH-POS).
- **Reset to system default**: `appearance.theme_reset`, which returns to glass following the system. On a device: Follow the workstation.

A refused write is shown inline (`role="alert"`) with the Host's words, and the saved theme stays as it was:

- a stale revision, when another window saved first;
- a low-contrast accent;
- a device trying to change the workstation's theme.

The tuning controls stay enabled while a save is in flight, so keyboard focus is never dropped; repeats are ignored
until the save finishes. The first save on a Host that never stored a theme carries the existing light/dark choice, so
applying a theme never flips the appearance. The sidebar's light/dark toggle explains, instead of saving, when the
shown theme has only one appearance (cybercore, synthwave, cyberpunk and scrapbook).

## 4. Mission clarity (Phase 6)

In the Mission plan (`agentic.tsx`, agent inspector), each step now shows:

- **Dependencies by name** (`stepDependencyLabel`): "No dependencies", "After build, review (waiting for review)" or "After build, review (done)". A dependency that cannot be resolved is named "step <id>" and counted as waiting, never guessed.
- **Resource switching** (`stepResourceTrail`): when a step has had two or more attempts, a line such as "Attempts 1: claude (failed) → 2: codex (running)". Without a provider, the executor is named instead (a capability action, a skill, or a model).
- Existing T13 facts are unchanged: state, failure category and the uncertain-outcome label.

Both helpers are pure and tested in `mission-model.test.ts`.

## 5. Navigation counts

The Approvals navigation count now includes uncertain items awaiting the owner's review, so a paused write is visible
from anywhere in the app. The Approvals heading reads "Review needed" while any are present.

## 6. Keyboard and screen readers

- Every themed navigation keeps real buttons with `aria-current="page"`. Rail and topnav keep their labels in the accessibility tree.
- Focus uses the theme's `--focus` colour (tested at 3:1 or better on the page) with a visible outline in every theme, including the decorative ones.
- Theme decoration (tape, ornaments, grids, orbs, scanlines) is CSS pseudo-content or `aria-hidden`. It never carries meaning and never covers a hit area.
- Windows High Contrast and forced colours: `@media (forced-colors: active)` removes decorative layers and defers to system colours.

Live keyboard and accessibility checks are recorded in `ACCESSIBILITY_PERFORMANCE.md`.
