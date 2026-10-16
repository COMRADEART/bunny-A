# Phone UX specification (Visual Experience 2.0)

The phone companion (`src/components/island/phone.tsx`, root `.pc-root`) is themed by the same engine as the desktop.
Its authority is unchanged from T9R/T13. A theme can never add a control the phone may not use.

## 1. How the phone is themed

- `.pc-root` receives `useThemeScope()`: the same data attributes and custom properties as the desktop shell, plus the `--pc-*` phone set.
- `data-phone-nav` selects the phone navigation treatment: `bar`, `floating`, `block`, `pill` or `window`. The per-theme value is in `THEME_CATALOGUE.md`.
- Theme signatures that read well at 390 px carry over to the phone, for example pixel window borders, scrapbook tape, Victorian frames and the synthwave title. Decoration never sits behind text, and all of it disappears under high contrast.
- Structure is deliberately the same single column in every theme: hero, Personal Agents, actions, bottom navigation. Themes vary the phone through type, palette, material, frames, borders and the navigation bar treatment. They do not rearrange it. The phone is less structurally varied than the desktop by design, and the visual review records it that way.
- Touch targets keep the T13 minimum. Theme decoration never shrinks or covers a hit area.

## 2. Choosing a look on the phone

Settings → Appearance on the phone (`PhoneThemeChoice`) shows:

- a **Theme** select listing all 22 themes;
- **Appearance**: System, Light or Dark. An appearance a theme does not have is disabled;
- a line saying where the choice lives:
  - on a paired device, "Following your PC's theme" or "Kept on this phone only";
  - on the workstation, "Saved on your Host for every window and the Notch";
- **Follow my PC's theme**, shown when a device has its own look.

A paired device never writes the Host preference:

- `store.setUiTheme` on a device viewer validates the patch and stores it in `localStorage` (`bunny-a.device-theme.v1`). No Host command is sent.
- If anything tried to send `appearance.theme` from a device, the Host would refuse it with `WorkstationRequiredError`. `ui-theme-host.test.ts` covers this, and checks that the device can still read `uiTheme`.

## 3. Authority (unchanged)

| Rule | Status |
| --- | --- |
| Workstation-only approvals are never actionable controls on the phone | Unchanged T9R behaviour (`remote-view-model.ts`, `allowVerdict`, `controlCaption`). Theme CSS only restyles the existing read-only rendering. |
| Reconciliation of an uncertain outcome | A device sees the review and the note "Only the workstation owner can decide". It gets no decision controls (`mayReconcile`), and the Host refuses `task.reconcile` and `mission.reconcile` from a device. |
| Theme write | Device-local only (§2). |

## 4. Evidence and limits

- **Desktop browser emulation.** The capture matrix renders the phone at 390×844, DPR 2, touch, for every theme in its default appearance and in its other appearance where one exists. Each capture records console errors, horizontal overflow and that the page went live in the requested theme. Results: `test-results/visual-experience-2/matrix/*/results.json`.
- **Physical phone: NOT TESTED** in this milestone. No physical device was paired or driven. Everything above is Chromium device emulation on the workstation, reported separately as the directive requires.
