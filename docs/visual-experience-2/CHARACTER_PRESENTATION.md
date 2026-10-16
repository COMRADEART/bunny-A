# Character presentation (Visual Experience 2.0)

The four Personal Agents keep their identity in every theme: Gada, Spear, Vishnu Chakra and Sword, with their
characters, names and per-Agent skins (T13.3 character style system). A theme changes how the characters are **framed
and arranged**. It never changes which character an Agent is, how that Agent looks, or what it may do.

## 1. Two independent layers

| Layer | Owner | Stored | What it controls |
| --- | --- | --- | --- |
| Global theme | Workstation preference (`ui_theme_preference`) | Host, revision-checked | Studio arrangement (`data-studio`), the frame ring around a character (`data-agent-frame`), surfaces, type and motion around the characters |
| Per-Agent look | Each slot's character appearance (`character-style-model.ts`) | Host, per slot | The character's skin: one of `glossy`, `cel`, `arcade`, `comic`, `pixel`. Also its well shape, accents and decoration |

The theme frame is a ring **around** the character element (`.wc-weapon`). The well inside belongs to the Agent's skin
(`character-styles.css`) and is never reshaped by a theme. Changing the theme therefore leaves every per-Agent choice
intact, and changing an Agent's skin leaves the theme intact.

Agent Studio says this in plain words, in a caption under its introduction: "The <theme> theme frames these
characters. Each Agent's own character look is chosen below and stays with that Agent whatever the theme. Neither
changes what an Agent may do."

## 2. Studio arrangements (`data-studio`)

| Value | Arrangement | Themes |
| --- | --- | --- |
| `cards` | The accepted T13 card grid | glass, neumorph, brutalism |
| `gallery` | Wide cards with tall character wells | clay, surreal, y2k, synthwave, bento, maximal, ethereal, bohemian |
| `list` | One row per Agent, character at left | editorial, swiss, minimal, wabisabi |
| `frames` | Framed portraits (per-theme frame art) | luxury, sketch, victorian |
| `polaroid` | Taped prints | scrapbook |
| `sprites` | Pixel sprites in RPG windows (nearest-neighbour scaling) | pixel |
| `hud` | Clipped instrument plates | cybercore, cyberpunk |

## 3. Frames (`data-agent-frame`)

| Frame | Ring | Themes |
| --- | --- | --- |
| `rounded` | 26% radius, decor ring | synthwave, bento. Glass has no ring, so the accepted T13 look stays exactly as it was. |
| `square` | Theme small radius, border-coloured ring | brutalism, editorial, swiss, luxury, sketch |
| `circle` | Round, double soft ring | surreal, y2k, neumorph, minimal, ethereal |
| `blob` | Organic uneven radius | clay, bohemian, wabisabi |
| `hex` | Hairline outline plus two action-coloured corner ticks | cybercore, cyberpunk |
| `polaroid` | Paper border with a deeper bottom edge and contact shadow | scrapbook |
| `ornate` | Arched cameo with a double decor rule | victorian |
| `ticket` | Dashed outline | maximal |
| `pixel` | Drawn by `pixel.css` with stepped borders and `image-rendering: pixelated` | pixel |

Under high contrast, every frame becomes a plain 2 px ring in the foreground colour.

## 4. Where characters appear

- **Home:** the "Personal Agents" module (`.ch-agents`). Each Agent is a button with its character, its name and the Host's presentation label for that slot. When the Host is not live, the label is prefixed "Last known:".
- **Agent Studio:** the four slots with their frames and the appearance controls.
- **Context panel:** compact characters next to each Agent's state.
- **Notch:** the Agent strip uses the T13 character tiles. Strip and body colours follow the theme (`NOTCH_THEME_SPEC.md`).
- **Phone:** the T13 phone Agent list, recoloured by the theme.

## 5. Motion

Characters keep the T13 animation gate: `reduced={systemReduced || appearance.motion !== "full"}`. Theme entrances
apply to the surfaces around them, never to the character's state animation. A character's state (working, needs
you, paused and so on) always comes from the Host's presentation facts, never from the theme.

## 6. Evidence

- Studio and dashboard screenshots for every theme, in its default appearance and, where it has one, its other appearance (dashboard): `test-results/visual-experience-2/matrix/`.
- Per-Agent looks are independent of the theme. The theme preference has no character keys (strict validation), and the character appearance store is untouched by `appearance.theme`. `ui-theme-host.test.ts` diffs every table across all 22 theme writes and finds them unchanged. Three are excluded: the theme row, the append-only event journal, and `connection_accounts`, which the Host's own background account refresh updates independently.
