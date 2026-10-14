# Bunny A MA3 T13.3 Gate H: character style system

A character style is a presentation skin drawn over the user's canonical board art. It changes material, linework, shading, motion flavour and effects. It never changes which Agent a slot is, which Missions it owns, what it may do, what it remembers or which models it may use. Any of the four weapons can wear any of the five styles.

Evidence: `test-results/ma3/t13-3/gate-h/`, covering native Notch receipts, browser QA, screenshots and regression logs.

## Registry (`src/lib/bunny-host/character-style.ts`, pure)

| Style | Label | Material | Native effect | Signature for |
|---|---|---|---|---|
| `glossy` | Glossy Inflatable | Rounded reflective highlights, weighted bounce, soft orb glow | Warm glow `#FFD27A`, blur 8 | Gada |
| `cel` | Cel-Shaded | Hard light boundaries, clean colour blocks, sharp light sweep | Ink outline `#05060A`, depth 1.2 | Spear |
| `arcade` | Arcade | Neon edges, radial pulse, orbiting energy | Cyan neon `#2EF2FF`, blur 10 | Vishnu Chakra |
| `comic` | Comic Book | Ink outlines, halftone accents, illustrated sheen | Black ink, blur 2.5 | Sword |
| `pixel` | SNES Pixel Art | Crisp pixels from the same art, stepped motion, no blur | None (nearest-neighbour) | (universal) |

**Appearance fields.** Each slot's appearance is `{ style: CharacterStyle | null, intensity: "full" | "subtle" | "off", highContrast: boolean }`.

- **Style.** `style: null` follows the weapon's signature, so swapping the weapon shows the new weapon's signature. A slot that chose a style keeps it across a weapon swap.
- **Validation.** `validateAppearance` is strict: unknown keys or values are refused, never coerced. A stored row that fails to parse falls back to the default.
- **Pairings.** `STYLE_MATRIX` lists all 20 weapon/style pairings. The signature is only a default, and the backend never enforces a weapon-to-style pairing (test H02).

## Host (`character-style.server.ts`, `http.server.ts`)

**Storage.** `CharacterAppearanceStore` writes the additive table `personal_agent_appearance(slot, value, updated_at)` under the migrations key `bunny-a.character-appearance.v1`. It sits apart from the revisioned Personal Agent configuration on purpose: a style change never bumps that revision.

**Commands.** Both are workstation only; a paired device gets `WorkstationRequiredError`.

| Command | Effect | Never does |
|---|---|---|
| `personal_agent.appearance {slot, appearance}` | Validates and saves a partial update. The event text names the shown style. | Touch a Mission, owner, profile, conversation, configuration revision or the foreground speaker |
| `personal_agent.appearance_reset {slot}` | Deletes the row, so the slot follows its weapon's signature again | Same |

**Projection.** `characterAppearance` is in every snapshot, device snapshots included, so a paired phone draws the same look. Devices cannot change it. A phone stays supervisory: the new Agent view gives it no workstation-owner permission.

**Host tests.** `character-appearance-host.test.ts` runs a real Host over HTTP:

- All 20 pairings leave the Mission, Agent, ownership, identity and configuration facts deep-equal to before, and the choice survives a Host restart.
- Reset works, and invalid or authority-shaped input (for example a `permissions` or `weapon` key) is refused with nothing changed and the configuration revision still 0.
- A weapon swap keeps the chosen look.
- A device can read the appearance but cannot change it.

## Canonical art and provenance

All five styles draw the same canonical PNGs in `public/bunny-a/characters/`: 39 manifest ids, each with a pinned hash. Test H09 asserts that the art set is unchanged and every runtime PNG matches its pinned hash.

No styled asset is stored, so derived art inherits the canonical file's provenance:

- **Web pixel art** is generated at runtime from the canonical PNG (`pixelSprite`) and cached in memory per file and grid.
- **Native pixel art** is a decode-time downsample of the same compact PNG.
- **Material styles** are CSS layers (web) or a WPF effect (native) over the unmodified art.

## Motion comes from the Host, not the style

`stylePresentation()` in `character-style-model.ts` gives a style its easing, an accent loop, an amplitude and a period. `characterMotion()` still decides whether anything moves, from the Host-derived state alone. As a result:

- **Settled, paused, failed and offline characters never animate** in any style (H05). Changing style never produces a transition cue or a state (H08).
- **Reduced motion and intensity off** stop every loop, including accents and pseudo-elements (H06). The system setting and the app's motion preference both apply.
- **Subtle intensity** halves the amplitude and stretches the period 1.6×. A rotation has no amplitude, so for it the period is the only control.
- **High contrast** removes the decorative layers and the accent loop and adds a solid outline (H07). Under forced colours the decorative skin layer is hidden.
- **Pixel art** steps its motion (`steps(4)`), and Chakra's rotation steps in 16.

## Web rendering

**Component.** `WeaponCharacter` takes an `appearance` prop. It sets `data-style`, `data-accent`, `data-decor` and `data-contrast` attributes and CSS variables (`--wc-accent-ms`, `--wc-amp`). It also adds a `wc-skin` layer that `character-styles.css` draws per style.

**Pixel art.**
- **Sprite.** `pixelSprite` box-downsamples the art so its long side is 24, 32 or 48 cells (compact, pose and hero). Colour is quantised to 15 bits (as on the SNES) and alpha is 1-bit.
- **Drawing.** The sprite is drawn with `image-rendering: pixelated`.
- **Recognisability.** H10 and H11 check it against the originals by silhouette overlap and four-way identification.
- **No glass tile.** The 1-bit alpha drops the translucent glass tile that the canonical hero and card art carry, so the pixel character sits on the flat pixel well at the same scale and position.

**Call sites passing the slot's appearance:**
- Studio slot cards;
- the Notch strip (`WeaponStrip`);
- Chat home, Recent Missions (`MissionRow.slot`) and the context panel;
- the Agentic view;
- every phone character (Home tiles, the Agents list, Agent detail).

**Design preview.** The gallery shows all 20 weapon/style pairs at pose size.

**Studio → Appearance → Character style** (`character-appearance.tsx`):
- **Previews.** Notch, Card and Detail previews, five radio options with the signature tagged, and a note that the style never changes Missions, permissions, memory or models.
- **Settings.** Animation intensity (Full, Subtle, Off), a High contrast switch and "Reset to signature".
- **Live Notch preview.** It has an edge picker and follows the four-edge rule: top and bottom edges place the Agents in a row left of Bunny, and left and right edges place them in a column above Bunny (H12). A bar marks the Host's foreground speaker, and a blue dot marks each Agent the Host reports working (H13). The preview never plays a transition cue.
- **Saving and controls.** Each change is saved on the Host immediately. The controls stay enabled while a change is in flight; a ref guard stops overlapping sends and the section carries `aria-busy`. Disabling the controls would have dropped keyboard focus, which was found and fixed in QA.
- **Read-only cases.** A paired device viewing the Studio sees the panel read-only ("Character style is changed on the workstation"). With the Host not live nothing is sent.

## Native Island (`install/Bunny-Island.Characters.ps1`, `Bunny-Island.Weapons.ps1`)

**Skin.** `Get-BunnyCharacterSkin` mirrors the web registry, so the same inputs produce the same skin:
- Inputs: weapon, appearance, the Island's animation switch, system high contrast.
- Outputs: the style; an effect (`DropShadowEffect` colour, blur and depth) or an outline; scaling (`NearestNeighbor` for pixel, `HighQuality` otherwise); and the motion settings (animate, amplitude, period and steps).
- An unknown style falls back to the signature.

**Pixel art.** The compact PNG is decoded so its longest side is 24 px and is never upscaled. This matches the web compact grid; `Get-BunnyPixelDecodeWidth` validates the art id before reading the PNG header.

**Speaker and working marks.** `Get-BunnyNotchRole` marks the speaker from `personalAgentContext.foreground` and a working dot from the Host state. When Bunny is speaking, no Agent is marked. Automation names carry "speaking now".

**Effect cost.** A shader effect on a chip whose transform animates re-runs every frame. The art therefore sits in its own `Border`, and that border carries a `BitmapCache` at device scale whenever the skin has an effect. A cache on the image itself does not hold the image's own effect, which was measured and rejected.

**Tests.** `scripts/island-notch.test.mjs` dot-sources these functions. It covers all 4×5 skins, the 24 px pixel rule, signature fallback, intensity and contrast, roles, the effect cache, and the native evidence receipts.

## Measured performance (no assumed frame rate)

**Native Notch** (`notch/style-receipts.json`). The Island ran with `-SmokeTest` and a hook that runs its own motion mode. Four moving chips were measured on a 75 Hz display. CPU is process time over 8 s, as a percentage of one core; GPU is the Windows GPU Engine counters for the Island process.

| Run | CPU (one core) | Frames: fps / p95 | GPU 3D |
|---|---:|---|---:|
| Island static, no chips moving | 5.65% | (no frame callback needed) | 0% |
| T13 chips with no effect (baseline) | 21.88% | 75 / 13.33 ms | 5.14% |
| Signature mix | 22.08% | 75 / 13.33 ms | 5.44% |
| Glossy | 20.53% | 75 / 13.33 ms | 4.99% |
| Cel | 19.34% | 75 / 13.33 ms | 5.39% |
| Arcade | 22.46% | 75 / 13.33 ms | 5.44% |
| Comic | 19.34% | 75 / 13.33 ms | 5.66% |
| Pixel | 18.95% | 74.5 / 13.33 ms | 5.11% |

Before the art-container cache, the material styles cost about 34–43% of one core and 20–24% GPU, with a p95 frame interval of 26.7 ms. That run is retained as `run-styles-pre-cache.*`, and the rejected image-level cache as `run-styles-image-cache-attempt.*`. With the cache every style matches the T13 no-effect baseline.

**Web** (`browser-qa.md`). Headed Edge, 60 Hz, nine animated characters:

- **Frames.** Every style holds 60 fps with a p95 frame interval of 16.8 ms.
- **CPU.** Renderer CPU is 17.0–18.9% of one core, against 14.7% for three characters at intensity off and 4.0% under reduced motion.
- **GPU.** Utilisation stays at about 22–23.5% in every style, matching three animated characters at intensity off. The styles add none measurable.
- **Cheapest style.** Pixel.

**Battery: NOT MEASURED.** The laptop was on AC power, and per-process energy needs SRUM or administrator tooling.

## §38 coverage

| §38 requirement | Where it is proven |
|---|---|
| 4 weapons × 5 styles | H01, H02; Host test 1; native 4×5 skin test; design-preview gallery (20 cells); native `style-*` runs |
| Permissions, Missions and identity unchanged | Host tests 1–3 (Mission, Agent, ownership, identity and configuration facts unchanged; authority-shaped input refused; devices cannot change a style); browser Mission/Agent facts before and after |
| Canonical art intact | H09 (39 ids, pinned hashes) |
| Four Notch placements | H12; native `edge-*` runs (4); browser Notch preview on 4 edges |
| Animation derived from Host state | H05, H08; native motion checks per Host state |
| No false celebration | H08; browser "no completion celebration plays in the preview"; native `bunny-speaking-no-agent-marked` |
| Compact recognisability | H11 (silhouette and identification); native 24 px rule |
| Reduced motion | H06; browser (13 characters still); native `reduced-motion-preference` and `intensity-off` |
| High contrast and keyboard | H07; native `contrast-high`; browser keyboard flow, high contrast and forced colours |
| Measured performance | Native and web tables above |
| No overflow on desktop or mobile | Browser at 390×844 (panel, Notch preview, gallery) |

## Limitations

- **Native draws less than the web.** It draws the material effect and the motion flavour, not the web accent overlays (halftone, scanlines, light sweep), and at Notch size the effects are subtle. Native pixel art is a decode downsample with nearest-neighbour scaling; it has no 15-bit quantisation or 1-bit alpha.
- **Compact Sword is the hardest to tell apart.** Its identification margin is the thinnest of the four (4.2 in H11); it still passes.
- **QA coverage is partial.** The QA Host binds only slots 1 and 2, so the browser Notch preview showed Gada and Spear; the native harness covers all four. The native reduced-motion run relies on the Island's own `Set-BunnyMotionMode` with `$SmokeTest` shadowed.
- **Measurement scope.** Performance was measured on one machine (RTX 4050 Laptop plus Intel Arc, 22 logical processors) with one browser, and battery impact is NOT MEASURED.
- **Out of scope.** The T13 glass dashboard was not rebuilt. No next visual redesign was started.
