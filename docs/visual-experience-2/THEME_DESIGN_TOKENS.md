# Theme design tokens (Visual Experience 2.0)

Source of truth: `src/lib/bunny-host/ui-theme.ts`. Each theme contributes two things:

- a **manifest**: structural choices plus geometry, typography, motion, icons, the Notch and performance;
- **palettes**: light and/or dark.

`resolveTheme()` applies the owner's preference to these. `themeCssVars()` then turns the result into custom properties
on each themed root, and `themeAttributes()` into data attributes. The full per-theme values are in
`THEME_CATALOGUE.md`, which is generated from the code.

## 1. The preference (schema `bunny-a.ui-theme.v1`)

| Key | Values | Default | Notes |
| --- | --- | --- | --- |
| `theme` | one of the 22 ids | `glass` | Unknown ids are refused. |
| `variant` | `system`, `light`, `dark` | `system` | A theme with a single palette ignores the other variant. |
| `accent` | `#rrggbb` or `null` | `null` | Refused if no ink colour can reach 4.5:1 on it. It is used only when it reaches 4.5:1 as text on the page and on the solid panel (several themes set the action colour as label text); otherwise it is dropped and a note explains why. |
| `density` | `theme`, `compact`, `comfortable`, `spacious` | `theme` | Spacing scale ×0.82 / ×1 / ×1.16. |
| `transparency` | `low`, `medium`, `high` | `medium` | `low` gives solid panels and no blur; `high` gives blur ×1.5. |
| `highContrast` | boolean | `false` | High-contrast palette, solid material, no decoration, no glow. |

Any other key is refused, so a theme write cannot carry authority-shaped data.

Two settings are deliberately **per window**, not part of the Host preference: text size (`appearance.fontScale`:
0.9, 1, 1.1, 1.25) and animation (`appearance.motion`: full, reduced, off). They are stored with the existing
appearance settings.

## 2. Palette roles

Every palette defines these roles:

- **Surfaces:** `page`, `washA`, `washB`, `panel` (may be translucent), `panelSolid` (opaque fallback), `elevated`, `field`.
- **Text:** `fg`, `muted`.
- **Lines and states:** `border`, `edge`, `hover`, `pressed`, `focus`.
- **Action:** `action`, `actionInk`.
- **Status:** `working`, `workingSoft`, `positive`, `negative`, `warning`.
- **Other:** `decor` (ornament only, never text), `shadow`, `raisedShadow`.

Tested guarantees (`ui-theme.test.ts`), for every palette and its high-contrast form:

- `fg` and `muted` reach 4.5:1 on the page, panel, field and elevated surfaces. Translucent surfaces are composited over the page and over each wash.
- The status colours as text on a panel (`positive`, `negative`, `warning`, `working`) reach 4.5:1. So do text on `hover`, selected navigation text (`working` on `workingSoft`) and `actionInk` on `action`.
- `focus` reaches 3:1 on the page.
- Under high contrast: `panel` equals `panelSolid`, there are no shadows, `border` equals `fg`, the material is `solid` and blur is 0.

## 3. Custom properties

| Group | Properties |
| --- | --- |
| Colour | `--page`, `--page-end`, `--page-wash-a`, `--page-wash-b`, `--fg`, `--muted`, `--subtle`, `--disabled`, `--panel`, `--glass`, `--glass-solid`, `--glass-edge`, `--elevated`, `--field`, `--border`, `--hover`, `--pressed`, `--focus`, `--action`, `--action-ink`, `--accent`, `--accent-ink`, `--working`, `--working-soft`, `--thinking`, `--stopped`, `--positive`, `--negative`, `--warning`, `--decor`, `--luminous`, `--claude` |
| Material | `--blur`, `--glass-saturate`, `--shadow`, `--raised-shadow`, `--bw`, `--bw-strong` |
| Shape | `--r-sm`, `--r-md`, `--r-lg`, `--r-shell`, `--r-pill`, `--radius-workspace-control`, `--radius-workspace-panel`, `--radius-workspace-dialog` |
| Space | `--s1` … `--s8`, each scaled by density |
| Type | `--font-bunny`, `--font-display`, `--font-mono`, `--heading-weight`, `--heading-tracking`, `--heading-case`, `--display-scale`, `--eyebrow-case`, `--eyebrow-tracking`, `--text-xs`, `--text-sm`, `--text-body`, `--text-title`, `--text-heading` |
| Motion | `--quick`, `--motion`, `--ease`, `--enter-name` (set by each theme's stylesheet) |
| Icons | `--icon-stroke` |
| Phone | `--pc-bg`, `--pc-wash`, `--pc-card`, `--pc-card-solid`, `--pc-chip`, `--pc-input`, `--pc-line`, `--pc-line-strong`, `--pc-ink`, `--pc-muted`, `--pc-accent`, `--pc-primary` and the rest of the `--pc-*` set used by `phone.tsx` |

Naming follows the accepted T13 glass tokens (`--fg`, `--muted`, `--glass`, `--r-*`, `--s*`), so the T13 components
pick up every theme with no change to their markup. With glass active, the generated values equal the accepted T13
values; `ui-theme.test.ts` checks this.

## 4. Structural enums (data attributes)

| Attribute | Values | Meaning |
| --- | --- | --- |
| `data-layout` | `sidebar`, `rail`, `topnav`, `bento`, `floating`, `window` | Shell arrangement at 768 px and wider. Narrow widths always use the accepted mobile shell. |
| `data-home` | `stack`, `bento`, `editorial`, `focus`, `collage`, `console`, `grid`, `window` | Grid areas for the home sections: hero, compose, quick actions, Agents, Missions, tasks. |
| `data-studio` | `cards`, `gallery`, `list`, `frames`, `polaroid`, `sprites`, `hud` | How Agent Studio presents the four characters. |
| `data-nav` / `data-phone-nav` | `pill`, `bracket`, `block`, `tab`, `dot`, `pixel`, `glow`, `underline`, `ink`, `ornament` / `bar`, `floating`, `block`, `pill`, `window` | Treatment of the current destination. |
| `data-material` | `glass`, `clay`, `neon`, `brutal`, `paper`, `mist`, `chrome`, `pixel`, `neu`, `solid`, `sketch`, `linen`, `ornate` | Surface material. Under high contrast it is always `solid`. |
| `data-agent-frame` | `rounded`, `square`, `circle`, `pixel`, `polaroid`, `ornate`, `hex`, `blob`, `ticket` | The frame around a character in Studio and the home Agents module. |
| `data-density`, `data-hc`, `data-transparency`, `data-motion`, `data-ambient` | from the preference and the window | `data-ambient="on"` only while the window is visible and was used within the last 45 s. |

## 5. Notch tokens (`notchTheme`)

The snapshot sends flat, opaque tokens. The Notch never has to composite translucent web colours.

- `schema`, `theme`, `name`, `shape` (`pill`, `capsule`, `block`, `frame`, `tab`, `blob`, `plate`), `radius` (0–40), `border` (0–4; at least 2 under high contrast), `glow` (false under high contrast);
- `font`: a Windows system font from the allowlist;
- `variant`, `highContrast`;
- `light` and `dark` colour sets: `fill`, `fillEnd`, `stroke`, `ink`, `muted`, `accent`, `accentInk`, `glow`, each `#rrggbb`. `ink` reaches 4.5:1 on `fill` (tested).

`install/Bunny-Island.Theme.ps1` validates every one of these again. See `NOTCH_THEME_SPEC.md`.
