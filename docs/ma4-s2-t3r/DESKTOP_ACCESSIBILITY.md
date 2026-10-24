# MA4-S2-T3R — Desktop and mobile-web accessibility (Phase J)

**Gate T3R-G6: PASS for what can be automated; Narrator NOT TESTED** (labels, roles and focus checked through the DOM and
the accessibility tree instead).

Run: `node --experimental-strip-types scripts/ma4-s2t3r/ui-evidence.mjs` → `evidence/ui/ui-evidence.json`
(**45 checks, 0 failed, 0 console errors**). Real dashboard (Vite dev + Host bridge) in headless Chromium against an
isolated Host.

| Requirement | How it was checked | Result |
|---|---|---|
| Labels | every input/select/textarea in the schedule and monitor forms has a programmatic label | pass at 1280/767/390 |
| Clear validation | empty submit → `role="alert"` summary ("2 fields need attention."), focus moves to the first `aria-invalid` field, its message is attached with `aria-describedby` | pass at all widths |
| Keyboard / focus order | Tab from the first field visits controls in reading order (a native date input's parts count once) | pass |
| Logical dialogs | review heading receives focus; Back keeps input; Close returns | pass |
| Reduced motion | `prefers-reduced-motion: reduce`: zero running animations in the panel | pass |
| High contrast | `forced-colors: active` screenshot; errors still state the problem in text, never colour alone | pass |
| Text scaling / reflow | 320 CSS px (1280 px at 400 % zoom): no horizontal overflow (root-font scaling proves nothing because the styles use px) | pass |
| Small screens | 390 px and 767 px: no horizontal overflow with errors or preview open | pass |
| Monitoring not shown as work | no animations on a monitor row; idle monitors muted, running work uses the accent | pass |
| Long names | 120-character limits enforced in forms; rows wrap (`overflow-wrap:anywhere`) | pass (visual) |
| Mobile labels, touch targets, orientation, large text | physical phone (see `PHYSICAL_ANDROID_QUALIFICATION.md`) | pass, TalkBack not tested |

Visual review of the screenshots (390 px preview, 1280 px errors, Approval Center, rows) found two issues, both fixed:
checkboxes sat below their labels; idle monitors used the same amber as "waiting for approval".

Screen readers: **Narrator and TalkBack NOT TESTED** — no automation was run with them; only DOM/a11y-tree properties are
claimed.
