# Widget theme integration

Widgets do not ship a theme list of their own. The shell and the phone already set `data-ui-theme`, `data-material`, `data-hc`, `data-motion` and the VE2 custom properties (`--r-md`, `--font-display`, `--shadow`, `--bw`, and the rest) from `src/lib/bunny-host/ui-theme.ts`.

`src/components/island/widgets.css` uses those tokens for type, radius, border, shadow, spacing and motion. Material rules change structure: clay has no border and a large radius, neo-brutalism uses an offset shadow, pixel art uses square corners, glass uses blur with a solid fallback under high contrast. Each of the 22 theme ids also has a rule of its own (grid, top rule, dashed or double border, asymmetric radius, mono label, and so on). A theme change is a data change on the existing root, so the widgets update without a reload.

Agent character skins stay on the character appearance path. The widget preference has no field that can set a skin.

The unit test `all 22 themes differ by more than colour` checks that the 22 manifests are not the same material, radius, font and border. Sketch has no theme-id rule; it is styled through `[data-material="sketch"]`.

Rendered coverage: the built-app walk opened Settings in all 22 themes × light/dark and the phone companion in all 22 themes (66/66 pass: six visible cards, no overflow, no console errors, theme applied). The lowest widget text contrast measured was 5.72:1. See `test-results/widget-design-studio/walk/` and the contact sheets beside it.
