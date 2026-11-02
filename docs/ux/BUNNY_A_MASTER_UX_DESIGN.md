# BUNNY A — Universal UX Master Design + Implementation Plan

**Deliverable:** design round D0+D1 of the master handoff — full feature-to-screen mapping, annotated
layouts for Windows / Android / Server Control, the two approved default appearances, the Glass
Intensity system, and a phased implementation plan. **Status: PROPOSED — awaiting owner approval.
Nothing here is implemented; no phase may start until the owner authorizes it.**

**Design baseline (verified live 2026-11-01):** upstream `main` = `95558fa4b7846d5a1832e904d42dcaca55f794b5`
(merge of PR #83, `unify/adopt-uof-v1`), `ci` workflow green at that commit. Design spec:
`docs/ux/BUNNY_A_UNIFIED_UX_BLUEPRINT.md` (blueprint v1.0, placed this round). Complementing docs:
`docs/roadmap/BUNNY_A_PRODUCT_MASTERPLAN.md`, `docs/visual-experience-2/*`, `docs/t13/*`,
`docs/roadmap/UOF_*`.

**Method:** every status label in this document is grounded in the code at that commit (four
read-only area surveys plus direct verification of the theme, navigation and persistence cores).
Where the handoff's anchors differ from reality, this document follows reality and says so (§2).

---

## 1. Evidence & inputs

| Item | Value (verified 2026-11-01) |
|---|---|
| Upstream main | `95558fa` — Merge PR #83 (`unify/adopt-uof-v1`) |
| CI at baseline | `ci` — success (checks / regression / security jobs), workflow `ci.yml` |
| Merged PRs since masterplan snapshot | #74 (docs kit), #75+#76 (agent-visuals merged then reverted), #77/#78 (CI watchdog, spoken-approval test), then the MA6/uof.v1 lanes #79 contracts · #80 core route ledger · #81 provider capability probes · #82 fabric coordinator lease · #83 adoption seam |
| Open PRs | none |
| This checkout | `bun-router-uxmaster` worktree, branch `docs/ux-master-design` pinned at `95558fa`; design docs only, uncommitted |
| In-flight lanes (untouched) | root checkout `sec/resolve-better-auth-advisory` @ `68951b5` (dirty: voice session, startup.sh, untracked installer test / native activity); worktrees `ma5-s2-*`, `ma5-s3-sprint1-agent-visuals` (Sprint 3, in flight), `unify/*`, `docs/*`, `bun-sec-main` locked |
| Masterplan status quirk | masterplan §1.1 pins `f29ab04`/PR #66 with updates to `8685c59` but has **no MA6/uof.v1 milestone row** (#78–#83 happened after); this design adds that row as a doc deliverable (§13), not by quoting the masterplan |

## 2. Findings that reshape the handoff's assumptions

These differences between the handoff anchors and verified reality drive the design; each is
load-bearing for feasibility.

1. **Two parallel native Windows notch stacks exist.** (A) The *installed production* surface is
   the PowerShell/WPF **Bunny Island** chain (`install/Bunny-Island.ps1` + dot-sourced
   `Bunny-Island.{Visual,Placement,Theme,Characters,Weapons,Voice,Motion,Companion}.ps1`), launched
   by the anti-tamper Launcher (`Bunny-A-Windows-Launcher.cs` → `Start-Bunny-Release.ps1`), which
   **consumes Host theme tokens** (`snapshot.uiTheme.notch`, revalidated in
   `install/Bunny-Island.Theme.ps1`: schema `bunny-a.ui-theme.v1`, shape/font/radius/palette
   allowlists, T13 black-glass fallback). (B) The **C# WPF client** `native/windows/BunnyA`
   (`BunnyA.exe`: 10-tab dashboard + `NotchWindow`) implements all 4-edge docking, persistence
   (`%LOCALAPPDATA%\BunnyA\config.json`), DPI/multi-monitor handling and UIA — but its theme is
   **local** (`config.NotchTheme` System/Light/Dark/HighContrast + Windows registry); it never
   reads the 22-theme token channel. Only (A) currently honors the owner's themed-notch spec.
   `BunnyA.exe` is a dev-candidate install channel (`native/windows/README.md`), not the shipped
   launch chain.
2. **`src/lib/bunny-host/remote-device.ts` does not exist** (handoff §3 anchors listed it). The
   device truth is `src/lib/bunny-host/device-authority.server.ts` (registry table, DEVICE_RIGHTS
   ~45 actions, deviceSnapshot redaction, approval ceiling) + `remote-device.test.ts` driving the
   real `/state / /command / /events` HTTP boundary.
3. **Server Control UI is MISSING** — grep-verified ("device fabric / server control / topology"
   hits only contract comments). `docs/roadmap/UOF_BASELINE_CONTRACT_FREEZE.md:52` states the
   authoritative position: W4 UI redesign and W5 verification remain not started.
4. **The four UOF lane modules are runtime-unwired by design:** `orch/route-ledger.ts`,
   `orch/capability-surface.ts`, `bunny-host/coordinator-fence.ts` ("Wiring into the persistent
   host is a later slice, gated on these tests"), `orch/uof-adopt.ts` (additive seam, imported by
   no runtime). The **live model routing** truth is the MA3-T3 router
   (`bunny-host/routing.server.ts` + `routing-store` + `model-capability` + `provider-usage`
   + `intelligence-snapshot.ts` → `ai-models.tsx`). A design that binds fabric UI to
   `Lease/CoordinatorEpoch/DeviceNode` today would fabricate wiring — prohibited.
5. **No Glass Intensity exists anywhere** (grep across src/install/native/docs: zero). **Four**
   overlapping glass levers exist instead: (a) Host preference `transparency: low|medium|high`
   (`ui-theme.ts`) — a **web** axis (blur 0 / manifest / ×1.5 at high, solid panels at low); it
   does **not** reach the native island at all (verified: no `transparency` consumer anywhere in
   `install/*.ps1`); (b) legacy per-window `appearance.glass` low|medium|high (`use-island.ts`,
   `data-glass` overrides in `bunny.css`); (c) per-theme manifest `blur`; (d) the **island-local
   `glass` preference** (`island-ui.json`, default medium, saved by `Save-BunnyPreferences`,
   `Bunny-State.ps1:37`) which is what actually drives notch body alpha today via
   `install/Bunny-Island.Visual.ps1:223/227/469` (low→250, high→218, default→238; high-contrast
   →255 opaque). The owner slider must replace none of them silently: it is a new additive
   dimension (§11 reconciles all four explicitly).
6. **Silver/Graphite are not named presets.** The `glass` theme (id `glass`, "Glassmorphism",
   registry #9, default) ships both palettes, light-default; per the owner rule they are *expressed
   through the existing glass theme's variants* — the two prominence slots are
   gallery-level preset cards mapping to `glass + (light|dark)`, not registry entries. The
   registry stays exactly 22.
7. **Android committed reality is narrower than the blueprint IA:** one hand-rolled Activity, 3
   tabs (Supervised Work / Companion Chat / Workstation Connection), pairing by manual HTTPS
   origin + one-time code (no QR), `INTERNET` the only manifest permission, **no voice, no
   floating overlay, no theming** (hardcoded dark palette). The phone is a supervised read/
   supervise/answer-ceiling client — truthful and security-hardened, but blueprint screens
   (Home/Tasks/Agents/More theming) are net-new phases, and overlay/voice change the device's
   permission posture (owner-gated).
8. **Shell truths:** routed shell = `premium.tsx` (single `/` route; all destinations are `?view=`
   deep links, `nav-model.ts` is the single nav table); legacy `desktop.tsx` shell is
   reference-only (`do not route to this Island`). Notch placement invariant (top/bottom → agents
   LEFT, left/right → agents ABOVE, expansion inward) is enforced on three surfaces today:
   PS island placement rules, C# NotchWindow geometry, and the web `character-style-model.ts`
   NOTCH_EDGES preview. Notch persistence is sprint-proven (PR #71 receipts 132/132).
9. **Dead/miswired odds and ends to account for in the plan:** `install/Bunny-Island.ps1` contains
   dead code after line 656 (live behavior lives in `Bunny-Island.Visual.ps1` chain) — never cite
   handlers from it; `?view=design-preview` is reachable via deep link while its header claims
   "not reachable from the product surfaces" (fixture-only page — keep, fix the claim);
   `reconciliation.tsx` has no nav entry; notifications ride sheet `extensions` with nav highlight
   `activity`; `src/components/quorum/*` + `use-quorum.ts` form an unreachable surface (owner
   decision); THEME_DESIGN_TOKENS.md §1 states variant default `system` while shipped
   `DEFAULT_UI_PREFERENCE.variant` is `light` (stale doc); routed shell has **no top-level Voice
   entry point** (VoicePanel reachable only via task detail / legacy floating island). Install
   packaging: the tracked chain is PowerShell (`scripts/package-bunny-desktop.ps1`,
   `scripts/install-bunny-release.ps1`, verified launcher → `Start-Bunny-Release.ps1`,
   `install/release-pin.json`); the masterplan's "Windows NSIS" claim has **no .nsi/.nsh in the
   tree** — narrative only (another staleness item for the docs PR).
10. **Voice/phone qualifications:** whisper + acoustic tests are local-only gates, never CI;
    physical-device gates (Android hardware, TalkBack round, EV signing) are owner-gated. The
    masterplan's perfection definition tracks voice latency ≈6.5 s P50 under load vs the 3 s
    target — a product-truth number the UI must not glamorize.

## 3. Feature-to-screen coverage matrix

Legend: **EXISTING** = live today at verified paths · **PARTIAL** = exists, named gap ·
**PROPOSED** = this design, unimplemented · **BLOCKED** = owner/signing/hardware gate. An
"(unwired)" annotation means the module/test exists but no runtime producer feeds it — UI may not
present it as live.

| # | Feature | Platform | Status | Screens / components (verified paths) | Truth source (live data) |
|---|---|---|---|---|---|
| 1 | Home / Ask Bunny | Windows web | EXISTING | `premium.tsx` → `chat-home.tsx`, `surfaces.tsx`, `task.tsx` (composer), `context-panel.tsx` | SSE+snapshot (`api/bunny-events.ts`, `host-stream.ts`, `use-island.ts`) |
| 2 | Conversation / Voice | Windows web | PARTIAL | `voice.tsx` reachable only via task detail / legacy floating (`floating.tsx` legacy-only) | `voice/*` + voice snapshot (workstation-only) |
| 2a | Voice top-level entry point | Windows web | PROPOSED | global top-strip Voice (§6.1) | existing voice snapshot |
| 3 | Tasks | Windows web | EXISTING | `ptasks.tsx`, `ptask-model.ts`, `task.tsx`, `surfaces.tsx` | persistentTasks + Host events |
| 4 | Missions | Windows web | EXISTING | `agentic.tsx` (AgenticWorkspace), `mission-model.ts`; legacy `mission.tsx` | bunny-missions + orch snapshot |
| 5 | Projects & Workspaces | Windows web | EXISTING | `projects.tsx`, `project-model.ts` | project-registry/project-service |
| 6 | Files & Artifacts | Windows web | EXISTING | `files.tsx`, `files-model.ts` | verifiedFile / artifact rules (`ui-model.ts`) |
| 7 | Agents (4 slots) | Windows web | EXISTING | `agent.tsx`, `agent-model.ts`, `personal-agents.ts` (SLOT_IDS=4, weapons 1:1) | personalAgentContext snapshot |
| 8 | Studio (character styles) | Windows web | EXISTING | `studio.tsx`, `character-appearance.tsx`, `character-style-model.ts` | personal_agent.appearance commands |
| 9 | Agentic Teams / Workers | Windows web | EXISTING | `surfaces.tsx` TeamsHome, `workers.tsx`, `team-model.ts` | team snapshot sections |
| 10 | Model Intelligence | Windows web | PARTIAL | `ai-models.tsx`, `routing-improvement.tsx`, `intelligence-snapshot.ts` (no dedicated screen) | live T3 router + modelCapabilities |
| 11 | Providers & Accounts | Windows web | PARTIAL | `accounts.tsx`, `account-model.ts`, `session-usage.tsx` (+ Providers group) | adapters FEATURES, provider-usage (unknown ≠ 0) |
| 12 | Runtime / Telemetry | Windows web | EXISTING | `telemetry.tsx`, `local-performance.tsx` | telemetry.server.ts samples (missing sensor = unavailable) |
| 13 | Widgets | Windows web | EXISTING | `widgets.tsx`, `widget-model.ts` | widgets.layout/reset commands |
| 14 | Notifications | Windows web | PARTIAL | `desktop.tsx` (legacy import in `premium.tsx`), sheet `extensions`, nav-highlight `activity` | native-notifications contract + events |
| 15 | Approvals | Windows web | EXISTING | `approvals.tsx`, `approvals-model.ts`, task-level Approval, sheet `decision` | pendingApprovalFacts union; device ceiling |
| 16 | Activity / Audit / Replay | Windows web | PARTIAL | `activity.tsx`, `activity-model.ts`, `session-usage.tsx`; replay models exist, **no replay player UI** | session-ledger v1, HostEvent ledger |
| 17 | Connected Services | Windows web | PARTIAL | `accounts.tsx` + Accounts section (no dedicated nav destination) | connections catalog, oauth-pkce |
| 18 | Automations / Proactive | Windows web | EXISTING | `proactive.tsx`, `proactive-create.tsx`, `proactive-forms.ts` | proactive.server decide() re-authorization |
| 19 | Memory / Lotus (per-slot UI) | Windows web | PARTIAL | `memory.tsx` inside AgentConversation; **no global memory browser** | lotus v1 (layers/trust/limits) |
| 20 | Reconciliation / Recovery UI | Windows web | PARTIAL | `reconciliation.tsx` (no nav entry) | task.reconcile / mission.reconcile (workstation-only) |
| 21 | Developer Console | Windows web | MISSING | closest: `harness-manager.tsx`, `local-performance.tsx` | proposal §6.4 (privilege-gated) |
| 22 | Onboarding (10 stages) | Windows web | EXISTING | `surfaces.tsx` Onboarding on chat landing | native-notifications GUIDED_ONBOARDING |
| 23 | Settings & Appearance | Windows web | EXISTING | `settings.tsx` (11 groups), `theme-gallery.tsx` | ui-theme v1 store; Appearance order proposed in §5.4 |
| 24 | Theme registry (22) | Windows web | EXISTING | `ui-theme.ts` (22 ids), `themes/engine.css` + per-theme css, `theme-gallery.tsx` | host snapshot uiTheme |
| 25 | Native notch — themed, production | Windows PS/WPF | EXISTING | `Bunny-Island.Visual.ps1` chain + Placement/Theme/Characters modules; launcher `Bunny-A-Windows-Launcher.cs` | snapshot.uiTheme.notch (validated), receipts 132/132 |
| 26 | Native notch — C# client | Windows C#/WPF | EXISTING (dev-candidate) | `native/windows/BunnyA/*` (NotchWindow, NotchModel, NotchVoice, FrameMeter, tests) | local config.json + Windows registry (token channel NOT consumed) |
| 27 | C# notch ↔ theme-token parity | Windows | PROPOSED (owner decision §13.1) | — | extend NotchTheme channel additively |
| 28 | Device pairing / Devices | Windows web | EXISTING | `premium.tsx` DevicesWorkspace, `phone.tsx` companion, `api/bunny-pair.ts` | device-authority (hostId/epoch pinning) |
| 29 | Companion phone — committed app | Android | EXISTING (3 tabs) | `android/.../NativeCompanionActivity.java` (9 app classes + 7 JVM tests), custom packaging (`scripts/build-android.ps1`) | `bunny.native.state.v1` polling (1.5/5/10 s), DEVICE_RIGHTS |
| 30 | Companion phone — blueprint IA (Home/Tasks/Agents/More), theming, QR, voice, floating overlay | Android | PROPOSED (phased, §12 E3) | net-new; overlay/voice change permission posture → owner-gated | existing device snapshot fields where available |
| 31 | Server Control (8 views) | Web | PROPOSED (§12 E4) | net-new; renders only verified endpoints; "Not configured" for pending ones | see rows below |
| 32 | Fabric backend primitives | Host lib | EXISTING (unwired) | `device-authority.server.ts`, `coordinator-fence.ts`, `orch/contracts.ts` uof.v1, `uof-adopt.ts` | runtime wiring = integration gate (owner) |
| 33 | Routing ledger / capability probes (UOF lanes) | Host lib | EXISTING (unwired) | `orch/route-ledger.ts`, `orch/capability-surface.ts` | runtime wiring = integration gate |
| 34 | Security & Privacy center | Windows web | PARTIAL | Privacy group, `settings.tsx` | security infra; UI follow-through |
| 35 | Install / Update / About | Windows | EXISTING | PowerShell packaging chain (`scripts/package-bunny-desktop.ps1`, `scripts/install-bunny-release.ps1`), anti-tamper launcher (`Bunny-A-Windows-Launcher.cs` → `Start-Bunny-Release.ps1`), `install/release-pin.json`; release-identity server lib | package metadata (signing owner-gated) |
| 36 | Error / Offline / Recovery states | all | EXISTING | connection-model states + offline overlays + reconciliation | freshness contract (20 s / 8 s / 35 s) |

## 4. Design system

The system is the existing theme engine (`ui-theme.ts` registry → `themeCssVars()` →
`themes/engine.css` + per-theme stylesheets). Nothing here replaces it; §11 defines the one
additive evolution (glassIntensity) it needs.

### 4.1 The two approved default appearances

- **Silver Liquid Glass (Light)** = theme `glass`, variant `light` — page `#eef2fb`, translucent
  white panel `rgba(255,255,255,0.64)`, thin luminous edge, spatial ease motion. Presented as the
  first Theme card ("Silver Liquid Glass · Light").
- **Graphite Liquid Glass (Dark)** = theme `glass`, variant `dark` — page `#0a0d16`, deep graphite
  panel `rgba(20,24,38,0.66)`. Presented as the second Theme card.
- **Explore Themes** lists all 22 entries (nothing deleted or deprecated; future themes via the
  existing manifest mechanism). The preset cards are store actions (`theme:"glass"` +
  `variant:"light"/"dark"`), so a user who then picks accent/density keeps theming rules intact.

**Glass must read as clear glass, not fog.** The `glass` manifest's `blur: 24` is the material's
base (today `transparency: high` renders ×1.5 = 36); intensity contributes **no blur term and
cannot raise it** — blur remains owned solely by `transparency` with its existing scaling (§11).
Depth comes from: edge refraction band, rim glint, specular sheen, layered shadows and the stable
aurora washes — all cheap compositing; no per-frame blur growth.

### 4.2 Core token families (existing; unchanged by this design)

- Colour roles: `--page --page-wash-a/b --fg --muted --panel --glass --glass-solid --glass-edge
  --elevated --field --border --luminous --hover --pressed --action --action-ink --focus --working
  --positive --negative --warning --decor --shadow --raised-shadow` (4.5:1 text roles enforced by
  `ui-theme.ts` contrast math; `glass-contrast.test.ts` exists).
- Type: `--font-bunny/display/mono`, sizes `--text-xs..--text-heading`, density-scaled spacing
  `--s1..--s8` (×0.82/1/1.16), radii `--r-sm/md/lg/shell/pill`.
- Motion: `--quick --motion --ease` from the manifest; web MOTION_TOKENS micro 150 / content 220 /
  morph 360 / route 760 / oneshot 900 / breathing 3200; notch loops capped at **30 fps in code**
  (`native/windows/BunnyA/NotchWindow.xaml.cs:496` — `Timeline.SetDesiredFrameRate(loop, 30)`;
  `FrameMeter.cs` is the opt-in aggregate pacing-evidence log under `BUNNY_NOTCH_FRAME_LOG`).
- Platform attribute contract: `data-ui-theme data-theme data-layout data-home data-studio
  data-nav data-phone-nav data-material data-agent-frame data-density data-hc data-transparency`.
- Phone tokens: `--pc-*` family exists for the web companion surface; the **committed Android app
  has no token layer** (hardcoded `Color.rgb()` literals) — E3 introduces one (§12).

### 4.3 Glass Intensity — deterministic token mapping (v1; PROPOSED)

One bounded integer preference, `0..100`, default **85**. Stored value is never silently altered
by accessibility modes; a computed *effective* value is what renders (existing
`data-material=solid` mechanism extended). Pure function
`glassMaterialTokens(intensity, manifest, preference)` in `ui-theme.ts`; every value derivable in
CSS from one `--glass-intensity` var + existing tokens.

Let `i = glassIntensity / 100` (integer steps, exactly representable).

| CSS var | Meaning | 0 | 50 | 85 | 100 | Formula |
|---|---|---|---|---|---|---|
| `--glass-rim` | rim/edge-glint strength | 0.30 | 0.65 | 0.895 | 1.00 | `0.30 + 0.70·i` |
| `--glass-sheen` | specular highlight opacity | 0.18 | 0.49 | 0.707 | 0.80 | `0.18 + 0.62·i` |
| `--glass-refract` | edge refraction band | 1 px | 2.5 px | 3.55 px | 4 px | `1px + 3px·i` |
| `--glass-depth` | shadow-depth multiplier | 0.55 | 0.875 | 1.1025 | 1.20 | `0.55 + 0.65·i` |
| `--glass-clear` | extra panel clearness | 0 | 0.03 | 0.051 | 0.06 | `0.06·i` (clamped by contrast floor) |
| `--blur` | backdrop blur | unchanged | unchanged | unchanged | unchanged | owned by `transparency` only |

Rules pinned in the design:

1. **Intensity never touches blur** — the anti-conflation owner rule, stated as a test
   (`glass-intensity.test.ts` asserts `--blur` invariance across all 101 values).
2. Contrast floor: `--glass-clear` is clamped so every text role keeps ≥4.5:1 (existing
   `ui-theme.ts` math + `glass-contrast.test.ts` extended).
3. Effective limiting: high contrast → solid surfaces (existing); Reduce Transparency → panel
   solid (existing); low power / reduced motion → loops off, static glass (existing
   `performance.fallback` path) — the slider shows "Effective intensity limited — stored
   preference retained" when rendered ≠ stored.
4. `0` is not "solid theme": it is minimal decoration (flat panel, hairline edge) with identical
   layout and text roles — themes remain themes.

Both flagship palettes get tuned under this mapping at approval time (E1 includes a short
"clarity pass" on `glass` light/dark: reduce fog impression by shifting a few points from tint
into rim/sheen at the same contrast floor — values are the only change, ids do not move).

### 4.4 Notch theme token channel (native)

`NotchTheme` (`ui-theme.ts`) already carries schema-tagged flat colors (8 `#rrggbb` keys ×2
appearances), shape/radius/border/glow/font, validated by `Bunny-Island.Theme.ps1` allowlists.
Additive extension (v1 keys untouched): an optional `glass: { intensity: 0..100, rimAlpha: number,
sheenAlpha: number }` block inside the notch token object. **Verified this round:** the island
validator silently ignores unknown keys on the notch and light/dark sub-objects, so the additive
block is safe even before the island learns it (E2a still updates the validator to an explicit
v1+glass read). Rendering split: the island's body alpha stays owned by its local `glass`
preference until E2a migrates it (§11b), and the island gains a **new** rim/sheen layer in E2 —
`NotchSheen` is a C#-client element only today (`NotchWindow.xaml:131`); the PS island has no
specular layer (verified by grep).

---

## 5. Sitemaps and annotated layouts

### 5.1 Windows workspace sitemap (the routed shell — verified nav truth)

```
Bunny A desktop workspace (single TanStack route "/"; destinations = ?view= deep links)
├─ PRIMARY (NAV_PRIMARY — landing default = Home/Chat with Onboarding overlay on first run)
│  ├─ Home (chat) …… chat-home.tsx + task.tsx composer + context-panel.tsx
│  ├─ Tasks ……………… ptasks.tsx / ptask-model.ts / task.tsx detail
│  ├─ Projects ……… projects.tsx / project-model.ts
│  └─ Agents ………… agent.tsx / agent-model.ts (4 slots) · conversation.tsx · workers.tsx · memory.tsx
├─ ADVANCED (NAV_ADVANCED)
│  ├─ Missions ……… agentic.tsx (AgenticWorkspace; mission-model)
│  ├─ Agentic teams …… TeamsHome (surfaces.tsx; team-model)
│  ├─ Studio …………… studio.tsx + character-appearance.tsx (per-slot skins, 4-edge notch preview)
│  ├─ Widgets ……… widgets.tsx (board/sidebar/drawer)
│  ├─ Characters …… characters.tsx (canonical art, state poses)
│  ├─ Files …………… files.tsx
│  ├─ Approvals ……… approvals.tsx (+ sheet "decision" for a focused waiting task)
│  ├─ Activity ……… activity.tsx + session-usage.tsx (ledger) + reconciliation.tsx (PROPOSED nav entry)
│  ├─ Telemetry ……… telemetry.tsx (sheet system)
│  ├─ Models ………… ai-models.tsx + routing-improvement.tsx (sheet provider)
│  ├─ Devices ……… DevicesWorkspace + Pairing (sheet devices; ?companion=1 = full phone surface)
│  └─ Settings ……… settings.tsx (11 groups; Appearance = theme-gallery.tsx)
├─ Non-nav reachable: design-preview (fixtures, ?view=design-preview, labelled NON-LIVE)
│  · sheet "extensions" = Notifications (legacy import; PROPOSED rename to its own destination)
│  · PROPOSED Server Control destination (§5.4) once E4 approved
└─ API: /api/bunny-events (SSE+commands) · /api/bunny-native-v1-state · /api/bunny-pair
```

**Window layout (annotated, all themes):**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ TOP STRIP 64px: Bunny A id · workspace · freshness("Live · updated 12:03")  │
│   · search · alerts · profile · [PROPOSED quickVoice] · agent-rail toggle    │
├───────────┬─────────────────────────────────────────┬───────────────────────┤
│ NAV 240px │ MAIN CANVAS (55–65%)                    │ INSPECTOR 30–40%      │
│ (collapse→│  sheet content                          │ (collapsible; reacts  │
│  rail)    │                                          │ to selection: task/   │
│ 4 primary │                                          │ agent/file/device/    │
│ + Advanced│                                          │ model; no fake charts)│
├───────────┴─────────────────────────────────────────┴───────────────────────┤
│ FOOTER: real host state only · pending approvals count · current operation  │
└─────────────────────────────────────────────────────────────────────────────┘
Narrow width: inspector becomes a drawer; nav to icon rail (existing layouts contract).
```

Modals keep focus and restore it on exit (existing behavior, retained as a gate item).

### 5.2 Android companion — committed truth, then proposed evolution

**Committed (versionCode 4, 3 tabs + pairing + offline states):**

```
┌───────────────────────────────┐
│ header: Bunny-A · host state   │
│ [TABS: Tasks | Chat | System]  │
│ Tasks: mission cards (state    │
│  + completed/total when real), │
│  ptasks (truthState,           │
│  pendingAction), stop-gated    │
│ Chat: text composer → submit   │
│  (mode fast) · ChatTurn banner │
│  (no model output on device)   │
│ System: origin · hostId ·      │
│  epoch · "polling while open"  │
│  disclosure · Sync / Unpair    │
└───────────────────────────────┘
Approval banner: "Approval required on Windows Host." — decisions defer to Windows.
Pairing screen: HTTPS origin + 10-min one-time code (FLAG_SECURE during entry). No QR today.
```

**PROPOSED blueprint IA (phased; owner-gated because it changes device permission posture):**
bottom tabs **Home / Tasks / Agents / More** (More: settings · devices · memory · models ·
connections — each rendered only from fields the device snapshot already carries today:
agents list, deviceConnections redacted view, projects read). A floating assistant and phone
voice remain **BLOCKED-PROPOSED** (overlay permission + foreground service + mic capture are new
security postures — §12 E3 states the gates). Appearance phase: device-local choice only
(System/Light/Dark + intensity, stored in a versioned device preference — never writing
workstation theme); the committed app currently has zero preference schema, so E3 builds the
first one from the existing migration pattern (single pref reuse).

### 5.3 Server Control sitemap — PROPOSED, integration-gated

Positioned exactly as the blueprint says: a management surface over the **existing** host/device
fabric — never a claim of a separate deployed server. New top-level destination `?view=server`
(sheet `fabric`), privileged (admin principal), hidden until E4 wiring is approved.

```
Server Control (PROPOSED)
├─ Overview ………… source+freshness · host identity (hostId/epoch) · counts of real rows only
├─ Device Fabric … device registry table (devices table fields) · presence · pair/revoke actions
│                   (commands already exist) · coordinator section UNAVAILABLE-until-wired
├─ Agent Runs …… mission/task ledger (existing lists, server-context view)
├─ Schedules & Jobs … proactive schedules/monitors/goals (server-side view of the same store)
├─ Routing & Providers … provider usage/capability + routing-learning (served today);
│                   route decision/attempt ledger = small E4 read-only projection (scoped)
│                   states verified|reported|unavailable (existing contract vocabulary;
│                   uof capability-surface wiring pending = integration gate)
├─ Events & Telemetry … HostEvent ledger + GPU/CPU/memory samples (telemetry.server)
├─ Security ………… device rights matrix, revoked devices, secret-status w/o exposure
└─ Settings ………… server-scoped settings (new, additive; no authority-bearing theme fields)
```

Layout zones (annotated): top = **source + freshness banner** (local host / remote device /
"proposed server coordination — not configured"); left filter rail (node/device/platform); central
**topology that degrades to an accessible list view** — only discoverable nodes render; right
selected-node inspector (identity, presence, last seen, lease/epoch **only when wired**, health
as reported state with timestamp); bottom execution-queue/event log with sequence + cursor.
Leases/epochs/device-nodes render "Not configured — coordinator wiring pending (ADR gate)" until
the integration gate passes. No sample nodes ever.

### 5.4 Settings > Appearance — exact approved order (verified against current gallery)

Current order in `theme-gallery.tsx`: Appearance segment → Accent → Density → Transparency →
High contrast → per-window text size/animation. **Proposed order (owner-approved list, additive
implementation):**

1. **Theme** — Silver Liquid Glass · Graphite Liquid Glass · Explore Themes (22)
2. **Appearance** — System | Light | Dark (existing radiogroup; per-theme availability honored)
3. **Glass Intensity** — continuous 0–100, default 85 (new; live preview, numeric readout,
   keyboard arrows, screen-reader value; immediately below Appearance)
4. **Reduce Transparency / High Contrast** (existing; overrides render, never the stored value)
5. **Accent** (existing contrast-gated)
6. **Density and Text Size** (existing + per-window fontScale)
7. **Motion/Animation** (existing per-window full/reduced/off)
8. **Notch placement** (existing Devices/notch settings; dock edge + offset)
9. **Agent character style** (existing per-slot appearance + style links)
10. **Sync preference** — workstation vs device-local (existing followWorkstationTheme surfaced
    explicitly)

## 6. Native notch system (Windows)

**Placement invariant (owner rule, enforced on all three existing surfaces):** top/bottom docking
places agent indicators to the **LEFT** of the notch; left/right docking places them **ABOVE**
(→ below-left in a vertical stack reading order, i.e. at the far end of the vertical strip);
expansion opens **inward** (toward screen center). C# verified: `Place()` pins the outer
coordinate and computes the inner edge → geometry grows toward center
(`NotchWindow.xaml.cs:151-164`); PS placement `Get-BunnyIndicatorLayout` encodes the 4-edge rule;
web preview `character-style-model.ts` mirrors it.

**State map (compact chip → expand action), all states runtime-backed:**

| State (NotchState / NotchVoice) | Compact visualization | Expand action |
|---|---|---|
| Idle | bunny identity, neutral/sleeping pose | Open Ask Bunny |
| Listening / Speaking (+ simultaneous) | truthful mic/speaker icons + confirmed-capture level (−60–0 dBFS→0–1, 5% quantize) | Voice panel: mute, stop |
| Thinking / routing | orbit/flow mark only when runtime reports | Model route detail + provenance |
| Tasks running (personal agents) | weapon chips **LEFT** (horiz.) / **ABOVE** (vert.); max 8, `+N` overflow rank-safe | Mission/task strip — real statuses only |
| Approval required | pulsing attention badge | Approval detail; spoken phrase never approves |
| Completed / Failed | one-shot pop / shake, honest label | Artifact / retry options |
| Offline / reconnecting / stale | dimmed chips + disconnected overlay | Retry / pairing diagnostics |
| Permission blocked | shield + reason | Permission help (no unsafe bypass) |
| Thermal/resource warning | amber icon + real reading if measured | System diagnostics |

**Persistence:** dock edge + offset + monitor survive cold restart and display changes —
verified in both stacks (C# `ConfigService` restore-first-then-place physical-pixel pattern;
PS island Sprint 2 pure placement rules, receipts 132/132, corrupt-file safety).
**Accessibility:** every notch control carries AutomationProperties; UIA `notch_tree` evidence;
ReducedMotion / ReducedTransparency in both stacks; `BUNNY_NOTCH_SNAPSHOT` renders RGBA-safe
evidence PNGs.

**Character rendering on the notch:** PS island renders per-slot skins (5 styles × intensity
flags, PNG decode pipeline); C# notch draws bunny avatar PNGs + vector weapon glyphs
(`GlyphGada/Spear/Chakra/Sword`) with per-weapon animations — pose/hero art + skins on C# are
net-new work (§12 E2).

## 7. Characters, agents and identities

- **Bunny A** = companion (17 companion states incl. voice). **Gada / Spear / Vishnu Chakra /
  Sword** = the four personal-agent slots (SLOT_IDS = [1,2,3,4], one weapon each, exactly once).
- **Canonical art** lives once: `assets/t13/reference` → `derive_assets.py` →
  `assets/t13/derived` (39 ids + manifest.json) → copied to `public/bunny-a/characters` (web) and
  `native/windows/BunnyA/Assets/characters` (WPF pack). Canonical source of truth = the derived
  manifest (hash-pinned); copies are build outputs, never hand-edited.
- **Signature styles:** gada glossy · spear cel · chakra arcade · sword comic; intensity
  full | subtle | off; high-contrast toggle; styles never change identity, only rendering.
- **Separation rules:** internal team agents are labeled role rows inside mission detail; the C#
  NotchModel maps team ROLES → weapons by meaning (coordinator→chakra, researcher→spear,
  implementer/documenter→gada, reviewer/tester→sword) while personal slots map slot→weapon
  directly — both stay distinct from provider/tool identities (codex, claude, ollama, opencode,
  cline, cursor, openrouter), which get text/wordmarks only, never weapons.
- **State vocabulary:** this design adopts the existing runtime-backed sets as the canonical
  vocabulary (NotchState 17 / presentation states 19 / NotchVoice 13 / CompanionState 17) and
  defines the cross-surface mapping table as an E2 deliverable (one shared TypeScript map +
  per-platform renderers, additive — no runtime enum rewrites).
- Animations: motion only while a real active state is held (`NotchModel.IsActive`; transition
  cues only on observed transitions; never on first observation/offline); overflow shows `+N`;
  reduced motion stops all loops; ambient effects stay opt-in on 6 GB-VRAM-class machines.

## 8. Truth-source map (the anti-fabrication contract, per surface)

Binding design to the verified producers (this is what makes every future screen honest):

| UI presents | Renders from | Never from |
|---|---|---|
| Tasks/missions state/progress | persistentTasks / HostEvent ledger / orch snapshot (`contracts.ts`) | invented percentages (only completed/total counters) |
| Voice level/state | voice snapshot + confirmed capture | guessed levels; device/acoustic claims |
| Provider capability | verified·reported·unavailable + evidenceNote (`capability-surface.ts` contract vocabulary; live: adapters FEATURES) | fabricated "connected" |
| Quota/usage | provider-usage (UNKNOWN stays UNKNOWN; session-ledger: unknown cost ≠ 0) | quota fill bars |
| Devices/presence | devices + hostIdentity {hostId, epoch} | unreachable nodes |
| Coordinator leases/epochs | UNWIRED modules → "Not configured" | fabricated lease health |
| Memory | lotus v1 layers/trust/limits | unproven recollections in UI copy |
| Approvals | approval union (id/kind/target/answer) + answerable verdicts | spoken-phrase resolution (schema pins `spokenPhraseNeverCounts: true`) |
| Freshness | connection-model fresh 20 s / ready 8 s / stale 35 s + snapshotAt | undated "live" |
| Server Control rows | verified endpoints only | sample/mock topology |

## 9. User flows (annotated, truth-bound)

1. **Ask Bunny** (Home): Onboarding (first run) → composer → task created → approval if required
   → live result; failure paths route to task detail.
2. **Agent task handoff**: Home → Agents → slot → conversation → workers roster; personal_agent
   commands, device viewers read-only.
3. **Multi-agent Mission**: Tasks/Missions → plan + DAG view → teams columns → approvals inline →
   checkpoint/replay (models exist; player UI PROPOSED M4).
4. **Voice interrupt**: top-strip Voice (PROPOSED entry) or task detail VoicePanel → session →
   barge-in → transcript visibility; duplex claims remain qualification-tagged (MA5-S2 S3
   owner-attended status governs wording).
5. **Approval**: attention route (notch badge / approvals / notifications) → decision sheet →
   ID/revision/action-scoped approve-deny → immutable journal (activity).
6. **Pairing**: Devices → 10-min code → phone enters origin+code (FLAG_SECURE) → trust pinned
   (hostId) → epoch changes on restart refuse stale lookups → revoke both directions.
7. **Model choice**: Models → routing preference (Auto/Manual/Per task) → candidate comparison
   with provenance (verified vs reported) → decision ledger row (existing T3 store).
8. **Device failover**: Device Fabric → node health changes → coordinator takeover **PROPOSED**
   (unwired) → honest "pending" otherwise.
9. **Memory correction**: Agents → AgentMemory → layer/trust shown → correct/pin/export where
   permitted (lotus rules) → contradiction review lands in reconciliation where applicable.
10. **Recovery**: restart → entry recovery (owned git ops) → reconciliation review of uncertain
    writes (workstation-only) → replay safety classification displayed as-is.

## 10. Accessibility & performance

- Contrast: text roles ≥4.5:1 on their composited surfaces (engine-enforced, tested);
  `--glass-clear` clamps to preserve it; high-contrast mode already collapses materials to solid
  and full-strength borders.
- Keyboard: full focus order incl. notch (existing UIA tests), Escape semantics, slider arrow-key
  steps of 1 (shift = 10 proposed).
- Screen readers: notch uses ItemStatus/HelpText/LiveRegion; web maintains labelled controls;
  Android TalkBack is code-present today but **hardware qualification is NOT TESTED** (gated).
- Motion: reduced-motion collapses loops everywhere (C# NotchModel honors ReducedMotion; web
  per-window motion setting; MOTION_TOKENS respected); no essential information conveyed by
  motion alone (badges + text always present).
- Performance: notch loops capped at 30 fps in code (`NotchWindow.xaml.cs:496`) with aggregate
  pacing evidence via `BUNNY_NOTCH_FRAME_LOG`; blur cost unchanged by
  intensity; reduced/low-power replaces heavy effects per manifest `performance.fallback`;
  voice+agents frame stability is an E5 attended gate.

## 11. Preferences & migration design (the glass-intensity core, PROPOSED)

Current preference (`ui-theme.ts`, schema `bunny-a.ui-theme.v1`): `{theme, variant, accent,
density, transparency, highContrast}` stored as **one versioned row** in
`ui_theme_preference(id=1)`, revision-checked with `expectRevision`/`StaleThemeError`, fail-safe
parse to defaults, plus: localStorage cache (`bunny-a.ui-theme.v1`), device-local phone preference
key (`bunny-a.device-theme.v1`, phone uses it only as its own look), legacy per-window
`Appearance.glass` (low|medium|high), and a legacy `appearance.theme` lever reconciled at
revision 0 (`withLegacyVariant`). The schema string is consumed as an exact-match check by the
web reader AND by `Bunny-Island.Theme.ps1` (notch token channel).

**Recommended schema evolution (Option 1 — versioned bump + dual-schema reader):**

1. `UI_THEME_SCHEMA` → `"bunny-a.ui-theme.v2"`; `UiThemePreference` gains
   `glassIntensity: number` (integer 0–100, default **85**). Writers stamp v2.
2. **Readers accept both v1 and v2** at *every* hard schema compare — `parseUiPreference`
   (`ui-theme.ts:864`) plus the two inside `theme-model.ts`: `readStoredPreference` (:61, the
   localStorage cache row and device rows) and `hostView` (:80, older-window-vs-newer-host guard);
   the local writer `storedPreference` (:68) stamps v2. v1 input validates then gains
   `glassIntensity: 85`; v2 validates fully (unknown keys still rejected — strictness retained).
3. **Lazy migration on read** in `UiThemeStore.get()`: a v1 row is re-written as v2 (same values +
   intensity 85), advancing no revision (no user-visible change), so the persisted row converges
   to v2 without a batch migration step.
4. **Downgrade behavior (documented):** a v1 build reading a v2 row reads it as foreign schema →
   falls back to the system default (glass) — the same fail-safe already codified for damaged or
   foreign rows. No authority path notices. (Optional E1 hardening: before an owner-authorized
   downgrade, a small "degrade to v1" note; the fail-safe is the contract.)
5. **Why not keep the schema string and add a field:** old builds reject unknown keys in
   `validateUiPreference` → a newer-host snapshot with an additive field makes an old window
   fall back to defaults *at runtime* (worse than documented fail-safe). The dual-schema reader
   keeps validation strict while fixing cross-version reads in one direction (forward).
6. **Notch channel stays v1-keyed until E2**: today the island validator requires the exact
   string `bunny-a.ui-theme.v1` (`Bunny-Island.Theme.ps1:22`) and — verified this round — it
   **silently ignores unknown keys** on the notch and light/dark sub-objects, so the additive
   `glass` block is safe in both directions. Mechanism note: `NotchTheme`/`UiThemeView` type their
   `schema` field as `typeof UI_THEME_SCHEMA` (ui-theme.ts:1102/:1153), so keeping the island feed
   on v1 while the preference bumps to v2 needs the constant split into `NOTCH_THEME_SCHEMA`
   (pinned `bunny-a.ui-theme.v1`) — listed in E1's file scope. Notch body alpha today is **not
   host-driven**: it comes from the island's own local `glass` preference
   (`install/Bunny-Island.Visual.ps1:223/227/469` — low→250, high→218, default→238; high contrast
   →255 opaque). Intensity reaches the island in E2 via the `glass` block + the §11(b) lever
   mapping; the island gains a **new** rim/sheen rendering there (no `NotchSheen` reuse — that is
   C#-only today). No blur growth on any surface.
7. **Device-local (web phone surface theme cache):** the storage key
   `bunny-a.device-theme.v1` keeps its name (stable handle); the row's schema *field* follows
   `UI_THEME_SCHEMA` (v2) and its readers stay dual-schema (§11.2). The committed Android app gets
   its own first preference schema in E3 (`bunny.native.appearance.v1`), versioned from birth —
   no legacy rows exist there.
8. **Windows-registry notch palette / C# config:** C# `config.json` NotchTheme stays as-is in E1;
   if the owner picks C#-parity (§13.1), the C# client consumes the notch token channel with the
   same unknown-field-tolerance rule.
9. **Security**: no field in this migration is authority-bearing (existing constraint preserved:
   theme store is read by no authorization path — enforced by the existing header + tests).

**Reconciliation note (owner rule "migrate or reconcile explicitly, without silently
conflating"):** all glass levers reconcile deterministically, preserving today's ownership until
each owner-approved migration:
   (a) **Web per-window `Appearance.glass` (legacy)** → superseded by global intensity, kept
   read-compatibly mapped low→30, medium→85, high→100 (medium ↔ the new default 85) for two
   releases, with a one-line gallery notice.
   (b) **Island-local `glass` preference** (`island-ui.json`, default medium — the lever that
   actually drives notch body alpha today) → same map {low:30, medium:85, high:100}, applied when
   E2a migrates island rendering to intensity (body alpha keeps its 200..255 clamp; high contrast
   stays 255 + opaque).
   (c) **Host `transparency`** is NOT touched and is NOT wired to the island today (verified): it
   remains the web/material axis it already is (blur 0 | manifest | ×1.5 at high; solid panels at
   low). Any future transparency→island coupling is a **new, explicitly-gated behavior change**,
   never presented as a continuation.
   (d) **Per-theme manifest `blur`** stays each material's own base scaled by transparency only;
   intensity contributes no blur term.

## 12. Implementation plan — independently reviewable phases (PROPOSED; owner approves each)

Shared contract for all phases: branch from latest `main`; no merge without owner; every phase
ships: scoped diff + migration note (when applicable) + unit/UIA/TalkBack/browser tests +
screenshot comparisons + PASS/PARTIAL/FAIL/BLOCKED verdict + rollback. Existing in-flight lanes
(voice branch dirty files, Sprint 3 agent-visuals worktree, security lanes) are never touched.

### Phase E1 — Glass tokens + preference system (foundations; ~medium risk)
- **Files:** `src/lib/bunny-host/ui-theme.ts` (glassIntensity validation + v2 schema +
  `glassMaterialTokens()` + clear-clamp in resolveTheme; split out `NOTCH_THEME_SCHEMA` pinned at
  v1 so the notch token channel keeps its exact-match), `ui-theme.server.ts` (lazy v1→v2 rewrite
  on read + v2 migration key), `src/components/island/theme-model.ts` (also a hard schema
  consumer — dual-schema `readStoredPreference`/`hostView`, `storedPreference` stamps v2),
  `src/components/island/theme-gallery.tsx` (slider + preset cards + live preview +
  effective-intensity note; §5.4 order), `src/store/use-island.ts` (preference plumbing), and the
  stylesheets consuming the new vars: `src/styles.css`, `src/components/island/bunny.css`
  (legacy `data-glass` path), `src/components/island/themes/engine.css` (+ `themes/glass.css`
  for the flagship clarity pass).
- **Tests (exact commands):** new `ui-theme-glass.test.ts` (101-value invariance of `--blur`
  except transparency axis; clamps; v1↔v2 parse matrix; clear-clamp contrast at anchors;
  invalid values rejected); existing `npm run test:ui`; `npm run typecheck`; `npm run lint`;
  screenshot comparison of glass light/dark at 0/50/85/100 + HC (Playwright via design-preview
  fixtures, images labelled PROPOSED CONCEPT until approved).
- **Gates:** `ci` checks + regression jobs as-is; security job unchanged (no flags touched).
- **Rollback:** revert the PR — dual-schema reader means v2 rows in old deploys re-read as
  defaults (documented); a follow-up strip-migration (`v2→v1 by removing the key`) exists as
  rollback SQL/JS before any island release depends on v2.
- **Risk:** medium — touches the one-row preference everyone reads; mitigated by dual-schema
  reader + invariance tests.

### Phase E2 — Windows notch & character parity (high risk; two sub-phases, each separately
reviewable)
- **E2a (PS island, production):** extend `Bunny-Island.Theme.ps1` to an explicit v1+glass read
  (unknown-key tolerance is already verified this round — the island ignores fields it doesn't
  know — so no coupling window remains in either direction); migrate or keep the island-local
  `glass` lever per §11(b) (owner picks in the E2a review); add the island's **new** rim/sheen
  rendering (`Bunny-Island.Visual.ps1` — there is no sheen layer on the island today; do not
  reuse the C# `NotchSheen` name); keep the 132-receipt persistence suite green; and **commit the
  visual-matrix harness** — the 115-run notch-theme matrix driver currently lives only in
  gitignored `test-results/visual-experience-2/harness/notch/`, so a fresh clone cannot run that
  gate: E2a ships a committed runner (extending the already-committed
  `scripts/notch-persist-harness.mjs` + `scripts/island-theme.test.mjs`) before the
  115/115 × Silver/Graphite gate runs; the invariance test asserts notch alpha comes from the
  island glass lever as mapped and intensity never raises blur.
- **E2b (C# client, dev-candidate):** consume `snapshot.uiTheme.notch` additively (keep config
  fallback), pose/hero art + per-slot skins parity where PNG pipeline allows, NotchState→web
  vocabulary map deliverable, FrameMeter budget kept. Gated by owner decision §13.1.
- **Tests:** `native/windows` test projects + `scripts/verify-ma5-s1-windows.mjs` UIA;
  persistence receipts; multi-monitor/DPI matrix (including the never-tested mixed-DPI case from
  NOTCH_THEME_SPEC §5) as an attended checklist when hardware is available.
- **Rollback:** island validator reverts to strict v1 (host keeps emitting v1 shape); C# client
  falls back to local theme.

### Phase E3 — Android companion (medium-high risk; permission posture changes are owner-gated)
- **Sub-phase A (no new permissions — pure UI):** token layer (colors from literals → resource
  system), device-local appearance preference `bunny.native.appearance.v1` (System/Light/Dark +
  intensity, device-only), Agents tab rendering existing snapshot fields, TalkBack pass (static +
  code review), JVM tests (manifest-shape, session store, exchange, chat turns extensions).
  Commands: `node android/tests` equivalents (JVM), `scripts/build-android.ps1`, lint if added.
- **Sub-phase B (new permissions — each individually owner-approved):** floating assistant
  (SYSTEM_ALERT_WINDOW + foreground service + battery-optimization UX), phone voice (RECORD_AUDIO
  + capture pipeline), QR pairing (camera permission). Existing security posture
  (INTERNET-only default-deny authority) preserved otherwise.
- **Gates:** hardware/TalkBack/Keystore rounds are owner-attended (currently NOT TESTED; beta
  NO-GO stands until run); CI unchanged.
- **Rollback:** (A) code revert; the born-versioned preference row is deleted on downgrade; (B)
  **granted Android permissions do not retract when code reverts** — the undo is uninstalling the
  app or the owner revoking the permission in Android settings, stated in the phase's migration
  note.

### Phase E4 — Server Control / Device Fabric UX (gated on integration truth; medium risk,
contained blast radius)
- **Build the shell first with honest states:** new destination + privileged wrapper
  (introduced by this phase) rendering only data actually served today: devices registry +
  presence (pair/revoke commands), telemetry samples, event ledger, proactive schedules/goals,
  routing-learning + performance profiles + providerUsage + modelCapabilities, and sessionLedger
  provider/model rows. **Routing decisions/attempts:** the tables exist
  (`routing-store.server.ts`) but nothing serves them yet (verified — no snapshot field, no UI
  reader), so that segment either stays out of the first increment or ships behind a small,
  explicitly-scoped read-only projection (workstation-only `routingLedger` snapshot field with
  its own unit test) — not presented as pre-existing. Fabric-specific sections (leases/epochs/device
  topology/coordinator takeover) render **"Not configured — coordinator wiring pending"** until
  the owner-authorized integration phase wires `coordinator-fence` + `uof-adopt` (explicitly the
  later slice the module headers reserve; the contract-freeze W4/W5 note is the gate checklist).
- **Tests:** `test:ui` truthfulness locks extended (no fabricated node/lease rendering even in
  fixtures; fixture data only in design-preview, labelled), new fabric UI unit tests, browser
  smoke; regression untouched.
- **Rollback:** the destination ships hidden behind E4's own new privileged flag (default hidden;
  exposed on owner authorization — the admin-principal wrapper is net-new in E4, nothing pre-existing);
  no host schema change.

### Phase E5 — End-to-end verification & owner acceptance (gates already exist; attended parts
owner-scheduled)
- Theme consistency across all surfaces (Silver/Graphite boards), all-feature navigation walk,
  truthful live states (fixtures visibly labelled), failure/reconnect/reconciliation flows,
  approvals end-to-end, multi-agent scenes, performance under voice+agents (attended),
  `npm run typecheck` + `npm run test:ma4` + routing tests + `npm run test:ui` + full `npm test`
  (4 stages) + dual `npm run build` + `npm audit` + native UIA + Android emulation where
  available; separate CI PASS vs owner-attended physical PASS; screen-diff gallery both flagships
  × three platforms; explicit BLOCKED items (EV cert, physical device, acoustic S3).

Sequencing: E1 → (E2a ‖ E3-A) → E2b/E3-B → E4 → E5; each phase = one small PR, owner-reviewed.

## 13. Open decisions for the owner (defaults stated; decision only where materially affecting)

1. **Canonical native notch lane.** Default: installed PS island remains the shipped themed
   surface; C# `BunnyA.exe` aligns to the token channel **only if** the owner confirms it is the
   future desktop product (otherwise E2b scales down to parity tests only). This materially
   changes E2 scope.
2. **Android scope.** Default: E3-A only (pure UI, no new permissions) in the first approved
   increment; floating assistant / phone voice / QR are separate owner decisions (permission
   posture). Materially affects device security posture.
3. **Server Control timing.** Default: shell-with-honest-states now (E4), coordinator/lease UI
   only after the owner approves the UOF host/remote-device runtime integration slice (the gate
   PR #83 explicitly deferred). Materially affects what "live" means in UI.
4. **Legacy window `Appearance.glass` deprecation** via deterministic mapping (§11) — confirm, or
   keep both levers.
5. **Replay UI** (masterplan Track C PARTIAL): default defer to M4.
6. **Housekeeping decisions (non-blocking):** rename notifications sheet `extensions` → its own
   destination; give `reconciliation.tsx` a nav entry under Recovery; disposition of the
   unreachable `quorum` surface (wire or delete); masterplan staleness row for MA6/uof.v1 (this
   design proposes adding it as a docs PR).

## 14. Explicit stops

- **This round delivers design + plan only** (docs in a draft PR ready to push — ask on approval).
- No implementation, no merges, no deploys, no signing, no pairing of real devices, no permission
  changes, no cloud-policy changes (CI asserts cloud stays disabled — `ci.yml:124-129`), no
  registry deletions, no canonical art substitutions, no dirty-file touches.
- Implementation starts only at the owner's per-phase authorization, in the order §12 permits.

## 15. Checklist against the handoff requirements

| Handoff requirement | Where |
|---|---|
| Git state first | §1 |
| Feature-to-screen mapping (all platforms) | §3 (36-row matrix) |
| Annotated layouts both themes | §5 (geometries) + §4 (token boards; per-surface boards rendered via design-preview in E1 step) |
| Interaction states, tokens, animations, flows, access, source-of-truth mappings | §4.3, §6, §7, §8, §9, §10 |
| Two defaults + 22-theme catalogue + extensibility | §4.1, §11 |
| Appearance order + Glass Intensity 0–100 default 85, slider semantics | §5.4, §4.3, §11 |
| Optical clarity / no blur-by-intensity / contrast + alternatives preserved | §4.1–§4.3, §4.3 rule 1–4 |
| Notch rules (docking, agents left/above, inward, persistence) | §6 |
| Canonical characters + identity separation | §7 |
| No fabrication; verified vs reported vs unavailable | §8, §3 statuses |
| Reuse existing systems, no parallel invention | §2 (corrections), §12 files lists |
| Phases with migration/tests/gates/visual comparisons/rollback | §12, §11.3–11.4 |
| Versioned glass-intensity preference migration | §11 |
| Stop for owner approval | §12, §14 |