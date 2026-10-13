# Bunny A — T13 design and motion specification

Authoritative creative source: the user-supplied board `assets/t13/source/bunny-a-showcase-original.png`
(1536×1024, sha256 `e390442a…c7fd`). Every character pixel in the product comes from that board through
`assets/t13/derive_assets.py` (crop + alpha matte only; manifest `assets/t13/derived/manifest.json`).
No other character art, no generated substitutes, no letters or provider logos in place of a weapon.

Higgsfield image-to-video loops were requested as a motion source and are blocked by account credits
(4.2 available, 4.5 minimum per clip). The engine below accepts an optional per-weapon×state loop asset later
(`loops/<weapon>.<state>.webp` in the manifest); until then motion comes from transforms of the user's stills,
pose swaps between the board's pose tiles, and code-drawn effect layers.

## 1. Identity layers

| Layer | What it is | Visual | Never |
|---|---|---|---|
| Bunny A | the companion: conversation, voice, presenting results | `bunny.*` art (8 board states + phone hero) | a weapon, a provider logo, a generic orb |
| Personal Agents | four user-customizable slots bound to the user's own durable Agents | Gada, Spear, Vishnu Chakra, Sword art | an internal team member, a provider, a letter |
| Internal Agents | planner/researcher/implementer/documenter/reviewer/tester team members | neutral text rows in Mission detail only | a weapon |
| Providers / models | Claude, Codex/ChatGPT, Ollama, Cursor, … chosen per Task by BunnyRouter | existing provider marks, Models page and expanded technical detail only | an Agent identity |

Filter: a row is user-facing iff `!row.team || row.team.role === "coordinator"` (`isUserFacingAgent`).

## 2. Bunny character selection

Final Bunny = the board's **Companion States** set (white glossy helmet, lilac-blue ears, black visor with
blue arc eyes, side headphones). The phone-home hero (`bunny.hero`) is the same character at larger size; it is
the identity image for Settings/About, phone Home and the Notch at ≥ 56 px. Board states used:

| Board tile | Asset | Companion states |
|---|---|---|
| Idle | `bunny.idle` | READY, MUTED (dimmed + mute badge) |
| Listening | `bunny.listening` | LISTENING, ARMING, HELD, PERMISSION (amber ring) |
| Speaking | `bunny.speaking` | SPEAKING, LISTENING_WHILE_SPEAKING (+ live level ring) |
| Thinking | `bunny.thinking` | THINKING |
| Processing | `bunny.processing` | TRANSCRIBING, WAITING_FOR_RESPONSE |
| Interrupted | `bunny.interrupted` | INTERRUPTED, ERROR (amber ring) |
| Happy | `bunny.happy` | HAPPY (client overlay: a slot just became VERIFIED) |
| Sleeping | `bunny.sleeping` | SLEEPING; DISCONNECTED (greyscale + unplug badge) |

States without dedicated board art (permission, disconnected, listening-while-speaking, error) reuse the nearest
board expression plus a ring/badge; nothing is repainted.

## 3. Weapon characters

| Weapon | Hero (Studio, detail) | Compact (Notch strip, lists) | Poses (board tiles under Idle/Research/Coding/Testing/Complete) |
|---|---|---|---|
| Gada | `gada.hero`, `gada.portrait` | `gada.compact` | pose1 idle · pose2 research · pose3 coding · pose4 testing · pose5 complete |
| Spear | `spear.hero` (faced), `spear.alt` | `spear.compact` | pose1 idle · pose2 research · pose3 coding · pose4 testing · pose5 complete |
| Vishnu Chakra | `chakra.hero` | `chakra.compact` | pose1 idle · pose2 research · pose3 coding · pose4 testing · complete → hero |
| Sword | `sword.hero` (faced), `sword.alt1`, `sword.alt2` | `sword.compact` | pose1 idle · pose2 research · pose3 coding · pose4 testing · complete → hero |

The pose→state column mapping is an interpretation of the board layout (chips above tiles) and is recorded as such.
Art always composites on a **dark character well** (the matte keys dark visors toward transparent, so on light glass
the faces would vanish — the board itself shows characters in dark wells on light panels).

## 4. Presentation state machine (Host-derived, `src/lib/bunny-host/personal-agents.ts`)

| State | Canonical source | Notes |
|---|---|---|
| UNASSIGNED | slot has no agentId | Studio only; not drawn in the Notch strip |
| IDLE | AgentState CREATED | not started |
| PLANNING | AgentState PLANNING; team kind `plan`; provider `agent.planning` | |
| RESEARCHING | capability read/list/browser/git read; team kind `observe`; fresh provider `agent.reading`/`agent.searching` | |
| CODING | team kind `generate_json`/`generate_html`; fresh provider `agent.editing` | |
| TESTING | `terminal.exec` command classified as test; fresh provider `agent.testing` | |
| FILE_WORK | capability write/move/delete/git write; team kind `write_file`/`generate_markdown` | |
| ACTIVE | RUNNING with no honest category | neutral loop — never a guessed category |
| VERIFYING | AgentState VERIFYING; step `verifying`; team kind `review`/`verify_output`; provider `agent.verifying` | work state, not a verified claim |
| WAITING | AgentState WAITING_FOR_DEPENDENCY | low energy |
| WAITING_FOR_USER | AgentState WAITING_FOR_USER, or consent asks pending | amber attention; nothing auto-granted |
| PAUSED | AgentState PAUSED (admission hold) | already-admitted steps may still finish — copy says so |
| COMPLETED | AgentState COMPLETED with unverified steps or no result | settled, no celebration |
| VERIFIED | COMPLETED and Mission result verifiedSteps > 0, unverifiedSteps = 0 | one-shot celebration on observed transition |
| FAILED / STOPPED | AgentState | |
| RECOVERING | AgentState INTERRUPTED | |
| UNKNOWN | bound Agent not found / not user-facing | |
| OFFLINE | client connection not live (stale/offline/host-changed) | client overlay; Host never emits it |

Provider events count only within 90 s on a running task (`PROVIDER_EVENT_FRESH_MS`). Every state carries its basis;
expanded views show it ("Host step: filesystem.read", "Provider reported: testing", "Team step: review").

## 5. Motion tokens

| Token | Value | Use |
|---|---|---|
| micro | 150 ms | hover, press, badge in/out |
| content | 220 ms | content fades, pose crossfade |
| morph | 360 ms | Notch resize/orientation, panel expand |
| route | 760 ms | Notch relocation glide |
| oneshot | 900 ms | completion/failure acknowledgment |
| ease-standard | cubic-bezier(.2,0,0,1) | default |
| ease-emphasized | cubic-bezier(.3,0,0,1) | expansion, relocation |
| ease-weighty | cubic-bezier(.45,0,.2,1) | Gada |
| ease-precise | cubic-bezier(.65,0,.35,1) | Spear, Sword |
| ease-orbital | linear | Chakra rotation |

Rules: transform/opacity/filter only; no layout animation; no random values; no flashing above 3 Hz; every loop
pauses when its surface is hidden (document hidden, element off-screen, Notch collapsed out of view, window
minimized); reduced motion (OS or app setting) removes every loop and one-shot and keeps pose + ring + badge.

## 6. Weapon motion personalities (idle loops)

| Weapon | Base loop | Period | Easing |
|---|---|---|---|
| Gada | float ±2 px, tilt ±2° lagging the float (weight), orb glow 0.35→0.6 | 4.2 s | weighty |
| Spear | vertical float ±1.5 px, no rotation; tip glint sweeps base→tip | 3.0 s | precise |
| Vishnu Chakra | continuous rotation 360° (12 s), halo counter-rotation | 12 s / 18 s | orbital |
| Sword | hover ±1.5 px, tilt ±1°, blade sheen sweep hilt→tip | 3.6 s | precise |

## 7. Task loops (effect layer on top of the base loop)

| State | Gada | Spear | Vishnu Chakra | Sword |
|---|---|---|---|---|
| PLANNING | dotted orbit traced around the head | three nodes align along the shaft | radial tick marks fade in sequence | hilt glyph pulse |
| RESEARCHING | three light motes orbit the ornament | narrow scan beam sweeps across the tip | outer ring CW, inner ring CCW | scan light travels hilt→tip |
| CODING | geometric fragments assemble around the head | energy segments light along the shaft, base→tip | arc segments form and reconnect (dash offset) | successive glyph marks travel along the blade |
| TESTING | measured pulses: three rings, then rest | point-to-point checks: tip, mid, base | concentric diagnostic rings expand | two controlled blade flashes, then rest |
| FILE_WORK | three small sheets drift into the orb | sheets stack along the shaft | sheets orbit then settle | sheets slide along the blade |
| VERIFYING | one trace around the orb per 2.4 s | one trace along the shaft | rim trace | edge trace |
| ACTIVE | soft halo breathe only | soft halo breathe only | rotation only | soft halo breathe only |
| WAITING | base loop at 0.6× speed, 80 % opacity, no effects | same | rotation at 0.3× | same |
| WAITING_FOR_USER | motion stops on idle pose; amber ring pulse 2.4 s; amber "!" badge | same | rotation stops | same |
| PAUSED | static, 40 % desaturated, pause badge | same | same | same |
| RECOVERING | slow dashed ring rotation, 60 % opacity | same | same | same |

## 8. One-shot acknowledgments (fire only on an observed transition, never on first load)

| Transition | Gada | Spear | Vishnu Chakra | Sword |
|---|---|---|---|---|
| → VERIFIED | weighted bounce + golden shockwave ring | upward thrust 6 px + vertical light line | one fast decelerating revolution + circular burst | diagonal slash light + shield-glint ring |
| → FAILED | 2 × ±2 px shake (400 ms), red ring fades to badge | same | same | same |
| → COMPLETED (unverified) | 220 ms settle, neutral check badge | same | same | same |

Final stable states: VERIFIED shows a green check badge; FAILED a red "!" badge with desaturation; both static.

## 9. Companion motion

| Companion state | Motion |
|---|---|
| SLEEPING | breathe scale 1→1.02, 5 s, 85 % brightness |
| READY | float ±1.5 px, 4 s |
| ARMING / LISTENING | ring scaled by the REAL input level (`level.rms`, only while `level.at` is fresh); no level → static ring |
| SPEAKING | gentle 1.2 s bob (playback is worker-confirmed) |
| LISTENING_WHILE_SPEAKING | speaking bob + live level ring |
| HELD | static listening pose, soft blue ring |
| TRANSCRIBING / WAITING_FOR_RESPONSE / THINKING | slow orbit dots, 2.4 s |
| INTERRUPTED | 200 ms recoil (scale 0.96→1), then hold |
| PERMISSION / ERROR | static, amber ring pulse 2.4 s |
| MUTED | static, mute badge |
| DISCONNECTED | static greyscale, unplug badge |
| HAPPY | one 600 ms hop |

## 10. Notch geometry and docking (locked)

| Dock | Notch | Personal Agent strip | Panel opens |
|---|---|---|---|
| TOP | horizontal, attached to the top edge | LEFT of the Notch, connected | downward |
| BOTTOM | horizontal, attached to the bottom edge | LEFT of the Notch | upward |
| LEFT | vertical | ABOVE the Notch | rightward |
| RIGHT | vertical | ABOVE the Notch | leftward |

Drag: press-and-move on the Notch body (not on buttons) moves it; release snaps to the nearest edge of the monitor
under the pointer, with `edgeOffset` = position along that edge (0..1). Safe margins: 4 DIP from the edge, never
overlapping the taskbar (work area, not screen bounds). Persisted: `edge`, `edgeOffset`, `monitor` (device name +
work-area fingerprint). Restore: if the saved monitor is gone or its geometry changed, fall back to the primary
monitor and clamp — the Notch is never stranded off-screen. Slot order is preserved through every orientation change.

## 11. Windows glass system

Black glass Notch: `#0B0D14` at 92 % with a 1 px top highlight `rgba(255,255,255,.14)`, inner gradient
`#1A1E2B → #07080D`, corner radius 28 (horizontal) / 30 (vertical), soft shadow `0 12 32 rgba(0,0,0,.45)`.

Light workspace: aurora page background (`#EEF2FB` with lilac `#C9C2FF` and sky `#BFD8FF` radial washes); glass
surfaces `rgba(255,255,255,.64)` + `backdrop-filter: blur(24px) saturate(160%)`, border `rgba(255,255,255,.75)`,
shadow `0 8 30 rgba(30,40,80,.10)`; text `#121726`, muted `#5A6378`; accent `#5B6CFF`, lilac `#9C7BFF`.
Dark workspace: page `#0A0D16` with deep indigo washes; glass `rgba(20,24,38,.66)`; text `#EEF1FA`, muted `#9AA3B8`.
Fallback: `@supports not (backdrop-filter)`, `prefers-reduced-transparency`, `forced-colors` → opaque surfaces
(`#F6F7FB` / `#141824`). Body text contrast ≥ 4.5:1 on every surface in both themes.

## 12. Information architecture

Desktop nav: Chat (default), Missions, Agents, Projects, Files, Approvals, Activity, Settings; Models and Devices
in a separated "System" group. Right context panel (collapsible): Personal Agents (real), pending reviews, Host
state, model activity, real Host telemetry samples when instrumented (else "Sensor unavailable").
Chat ≠ Agentic: Chat is the conversation surface; Missions/Agents are durable work. Closing or minimizing the
workspace never stops a Mission — copy says so.

Phone (touch-first): Home, Chat, Agents, Missions, Settings; safe areas, ≥ 44 px targets, thumb-reach bottom bar.
Voice is workstation-only today: the phone shows "Voice is available on your PC" instead of a microphone.
Approvals on the phone follow the Host's per-request remote verdict; desktop-only asks say so.

## 13. Not shipped from the board

The board's illustrative numbers (CPU 24 %, GPU 18 %, RAM 62 %, "63 %", "72 %", "Good morning, Ravi", sample
mission names, "Qwen3.8") are design placeholders and never appear as data. Percent progress is replaced by real
step counts ("3 of 7 steps · 2 verified").
