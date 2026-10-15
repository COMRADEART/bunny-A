# Theme architecture (Visual Experience 2.0)

Bunny A has 22 complete themes and one engine. All 22 share a single React component tree. A theme is **presentation
configuration only**. It never authorizes anything, never reaches a Mission, Task, Agent profile, memory, routing,
consent or approval, and holds no executable content.

## 1. Layers

| Layer | File(s) | Role |
| --- | --- | --- |
| Registry (pure) | `src/lib/bunny-host/ui-theme.ts` | 22 manifests (`UI_THEMES`), palettes, fonts, the preference schema `bunny-a.ui-theme.v1`, strict validation, contrast maths, `resolveTheme`, `themeCssVars`, `themeAttributes` and `notchTheme`. No DOM, no I/O. |
| Host persistence | `src/lib/bunny-host/ui-theme.server.ts` | `UiThemeStore`: a single-row table `ui_theme_preference` (migration `bunny-a.ui-theme.v1`) with a revision counter. |
| Host wiring | `src/lib/bunny-host/http.server.ts`, `contracts.ts` | The snapshot carries `uiTheme: {schema, revision, preference, notch}`. Commands `appearance.theme` and `appearance.theme_reset` are workstation-only. |
| Window choice (pure) | `src/components/island/theme-model.ts` | `effectivePreference()`: which preference this window shows, and where it came from. |
| Store | `src/store/use-island.ts` | `uiTheme`, `themePreview`, `deviceTheme`, `themeCache`, `themeLink`; `setUiTheme`, `resetUiTheme`, `followWorkstationTheme`, `setThemePreview`. |
| React runtime | `src/components/island/theme.tsx` | `useThemeScope()` gives the attributes and inline custom properties for a themed root. Also `useDocumentTheme()`, `ThemedDialogContent` and `useAmbient()`. |
| CSS engine | `src/components/island/themes/engine.css` | Shared structure, selected by data attributes: six layouts, eight home compositions, seven Studio frames, navigation, materials, phone and dialogs, motion, and the high-contrast and forced-colours layers. |
| Theme signatures | `src/components/island/themes/<id>.css` (22) | One signature element per theme, plus its materials beyond tokens and its entrance keyframes. Imported in order by `themes.css`. |
| Fonts | `src/components/island/themes/fonts.ts` | Bundled @fontsource Latin subsets (OFL-1.1). Nothing is fetched at runtime. |
| Native Notch | `install/Bunny-Island.Theme.ps1`, `install/Bunny-Island.Visual.ps1` | Validates the snapshot's `notch` tokens again in PowerShell, then restyles the WPF Notch. |
| UI | `theme-gallery.tsx/.css`, `settings.tsx`, `phone.tsx`, `studio.tsx`, `premium.tsx` | Settings → Appearance → Theme Gallery, the phone's look picker, the Studio caption, and the preview bar. |

## 2. Data flow

```
 Settings → Theme Gallery ──Apply──► store.setUiTheme(patch)
                                        │ workstation: command appearance.theme {…, expectRevision}
                                        ▼
 Host  validateUiPreference ─► UiThemeStore.set (revision+1) ─► event "appearance.theme" ─► snapshot.uiTheme
                                        │                                          │
            every desktop window ◄──────┘ (SSE snapshot)                           └──► native Notch poll:
            store.apply → syncTheme → effectivePreference → resolveTheme                Get-BunnyNotchTheme (validate)
            → useThemeScope → data-* + inline CSS vars on each themed root              → restyle only when key changes
```

A device viewer (a paired phone) receives the same snapshot, which goes through the blacklist filter, so it can follow
the workstation's look. Its writes are refused with `WorkstationRequiredError`. A device can keep its own look in
`localStorage` (`bunny-a.device-theme.v1`); that never reaches the Host.

## 3. Precedence

`effectivePreference()` picks the first that applies:

1. **Preview.** A Theme Gallery preview. It changes only this window and is never saved. Escape or "End preview" cancels it.
2. **Link.** `?uitheme=<id>` and `?theme=light|dark`, layered over whichever base wins. The link is never saved.
3. **Device choice.** A device viewer's own look, if it chose one.
4. **Host.** The workstation's saved preference. At revision 0, the legacy `appearance.theme` light/dark choice is honoured, so an upgrade keeps the owner's existing appearance.
5. **Cache.** `bunny-a.ui-theme.v1`, the last resolved preference. It avoids a flash before the first snapshot arrives.
6. **Default.** `glass`, the accepted T13 look, following the system light or dark setting.

Every stored value is parsed with `parseUiPreference`. A wrong schema, an unknown key, a bad value or unparseable JSON
falls back to the default and never throws.

## 4. Hot switching

A theme change is a data change: new attribute values and new custom properties on the themed roots. Nothing reloads,
no component remounts, and the Host is not restarted. Running Missions are not touched. The Host test
`ui-theme-host.test.ts` applies all 22 themes while four Personal Agents own delegated Missions. It asserts that:

- the authority projection is byte-identical before and after;
- the journal shows no Mission or Task lifecycle event caused by the theme writes;
- the preference survives a Host restart (revision 23).

Live timing (switch to the first painted frame) is in Gate J, `ACCESSIBILITY_PERFORMANCE.md`.

## 5. The themed root contract

Each themed root receives:

- **Data attributes:**
  - `data-ui-theme`, `data-theme` (light/dark), `data-layout`, `data-home`, `data-studio`, `data-nav`, `data-phone-nav`;
  - `data-material`, `data-agent-frame`, `data-density`, `data-hc`, `data-transparency`, `data-motion`, `data-ambient`.
- **An inline `style`** of custom properties from `themeCssVars()`: colours, radii, fonts, the type scale, motion durations and easing, blur, and the phone `--pc-*` set.

The themed roots are the desktop shell `.bunny-app.t8-app`, every portaled dialog through `ThemedDialogContent`, the
phone `.pc-root`, and each gallery miniature.

The engine's selectors start at `.bunny-app.t8-app[data-ui-theme][data-material]`, which has specificity (0,4,0). That
beats the accepted T13 rules at (0,3,0) without `!important`, and the theme files load after the engine. With glass
active, the engine emits the T13 glass token values; the registry test asserts that equality.

## 6. Safety properties

| Property | Where enforced |
| --- | --- |
| Theme data cannot execute | Validation is allowlists only: ids, enums, `#rrggbb`, numeric ranges. `themeCssVars` output is tested free of `url(`, `<` and `javascript:`. The Notch validates again in `Get-BunnyNotchTheme`, and its module bans `Invoke-Expression`, `iex`, `ScriptBlock::Create`, `Add-Type`, `Start-Process` and `.Invoke(`. There are no user-installed theme assets. |
| A theme is not an authorization principal | The preference schema has no authority-shaped keys; unknown keys are rejected. The Host test sends `{scope, approve, consent, provider}` and checks that nothing is written. |
| Workstation-only writes | `appearance.*` throws `WorkstationRequiredError` for a non-local viewer. Tested with a paired device. |
| Stale writes refused | `expectRevision` is checked against the stored revision (`StaleThemeError`). Two windows cannot silently overwrite each other. |
| Readability | Every palette, including its high-contrast form, is tested: text 4.5:1 on every surface, focus 3:1 on the page. A custom accent must reach 4.5:1 as text on the page and on the solid panel, or it is dropped with a note. |
| No phone authority | The phone's look picker writes only device-local state. Workstation-only approvals keep their read-only rendering under every theme. |

## 7. Adding a theme

1. Add the id to `UI_THEME_IDS` and a manifest to `UI_THEMES`. Choose `layout`, `home`, `studio`, `nav` and `material` from the existing enums, and supply light and/or dark palettes.
2. Add `themes/<id>.css` with one signature element, its entrance keyframes and a `[data-hc="true"]` override. Import it from `themes.css`.
3. Add any font to `fonts.ts`, `FONT_STACKS` and `FONT_PROVENANCE`, OFL or similar only, plus a Windows system font for the Notch in `NOTCH_FONTS` and the Notch allowlist.
4. The registry tests fail until the new palettes pass contrast and the structural signature is unique.
