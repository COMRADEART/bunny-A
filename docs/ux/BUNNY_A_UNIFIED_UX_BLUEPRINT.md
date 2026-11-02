# Bunny A — Unified Product UI/UX Blueprint v1.0

> **Placed in repo 2026-11-01** as `docs/ux/BUNNY_A_UNIFIED_UX_BLUEPRINT.md` by the design round
> (`docs/ux-master-design` worktree), per the master instruction: *the spec to implement is
> `BUNNY_A_UNIFIED_UX_BLUEPRINT.md`; if not present in the repo, create it using the attached
> specification and record its revision.* Verified absent from `main` at `95558fa4` immediately
> before creation. **Revision recorded: blueprint v1.0, baseline `main` = `95558fa4` (2026-11-01),
> CI run `41363985732` succeeded.** Text below is the owner-supplied specification, kept verbatim
> apart from this provenance block and the heading/section numbering.

**Product:** Bunny A by LOKAM
**Platforms:** Windows native notch + desktop workspace; Android companion; server/device-fabric control surface
**Design status:** DESIGN PROPOSAL, not evidence of implemented capabilities.
**Repository baseline verified:** `COMRADEART/bunny-A`, `main` at `95558fa4b7846d5a1832e904d42dcaca55f794b5` (2026-11-01). PR #83 merged; GitHub Actions run `41363985732` succeeded.
**Authoritative repo docs:** `docs/roadmap/BUNNY_A_PRODUCT_MASTERPLAN.md`, `docs/visual-experience-2/{THEME_ARCHITECTURE,WINDOWS_UX_SPEC,PHONE_UX_SPEC,NOTCH_THEME_SPEC,ACCESSIBILITY_PERFORMANCE}.md`, `docs/t13/BUNNY_A_T13_DESIGN_SPEC.md`, `docs/roadmap/UOF_ADR_0001_RUST_ADOPTION.md`.

## 0. Scope and truth labels

This blueprint covers the whole **product experience**, not a request to recreate all back-end systems. For every designed control the implementation must tag the source as **EXISTING / INTEGRATION REQUIRED / PROPOSED / BLOCKED BY OWNER** and hide or disable unavailable operations with truthful explanations. Never portray concept-screen counts, quotas, online statuses, progress, durations, latency, device connections, or model capabilities as actual runtime data. No merges, remote writes, credentials, signing, or physical-device sessions are authorized by this document.

The existing product already has React 19/TanStack desktop surfaces, Windows WPF/PowerShell native notch, Android native companion, a **22-theme registry**, host-saved theme preference, Mission Control, personal-agent character system, local models, connected-service infrastructure, and UOF v1 modules. PR #83 adds a contract adoption seam; it explicitly **does not wire those modules into persistent host/remote-device runtime yet**. Do not create a parallel architecture.

## 1. Design philosophy and defaults

- Two **prominent built-in defaults**: **Silver Liquid Glass (Light)** and **Graphite Liquid Glass (Dark)**, both expressed through the existing `glass` theme's light/dark variants. Offer **System / Light / Dark** selection; `System` follows OS where supported. Existing 22 themes remain available under **Explore Themes**, not deleted or silently deprecated. Future themes use the current manifest/registry mechanism.
- Materials must feel like **clear, physically layered glass**, *not frosted white fog*. Prefer low backdrop blur and strong but tasteful edge refraction, rim glints, optical thickness, reflected environment, depth shadows, and translucent tinted layers. Content remains sharp and accessible; never make a literal promise of Apple's proprietary material renderer.
- **Glass Intensity**: a continuous 0–100 slider, positioned **immediately below System/Light/Dark**, default **85**. The value adjusts specular rim lighting, depth/refraction approximation, tint, and selective transparency—not a proportional increase in Gaussian blur. Provide 0/50/85/100 snapshots, numeric percentage, keyboard arrows, screen-reader value, and instant live preview. Treat the current `transparency: low|medium|high` setting as an existing separate accessibility/opacity dimension; migrate or reconcile explicitly, without silently conflating the two.
- High Contrast / Reduce Transparency / Reduce Motion / battery saver / hardware fallback override decoration and may enforce solid surfaces. Override the stored slider visually with an **Effective intensity limited** explanation, retaining the user's selected preference. Guarantee text contrast and focus indication.
- Branding: Bunny A (companion) and LOKAM (publisher) with creator credit in About. Preserve supplied canonical Bunny and weapon character art; do not substitute generated character assets into source. Brand/provider marks only where actually permitted and available; keep them visually distinct from personal-agent identities.

## 2. Navigation and global shell

### Windows workspace

**Structure:** native movable notch is always available when enabled; expanded main workspace is a separate large resizable window; single clear navigation sidebar/rail, global search/command palette, central canvas, optional contextual right inspector, lower transient activity/status area. Default landing = **Home/Chat**, matching existing `NAV_PRIMARY`: Home, Tasks, Projects, Agents. Additional destinations under expandable **Advanced** to avoid sidebar overload. Maintain existing `?view` deep links, Back/Escape, keyboard focus, and status semantics.

**Global top strip:** Bunny A identity, current workspace/project, connectivity source/time-of-last-update, search, alerts, account/profile, quick Voice, and optional agent sidebar toggle. **Bottom bar:** display genuine host state only (online/offline/reconnecting), pending approvals and current operation; diagnostics are optional, not permanent distracting metrics. **Context inspector** responds to selected task, agent, file, device, or model; no empty fake charts.

### Android companion

**Structure:** phone-safe header; conversational Bunny hero/voice; active task summary; bottom tabs **Home / Tasks / Agents / More** (settings, devices, memory, models, connections). Floating assistant uses Android capabilities only where permissions/OS APIs genuinely allow; clearly label unsupported lock-screen/background/overlay states. Single column, large touch targets, system insets, TalkBack. The paired phone can follow workstation appearance or retain a device-local one; it must not write workstation theme or execute workstation-only approvals.

### Server Control

**Positioning:** management surface for existing host/device fabric, *not a claim of a separate server deployment*. Views: **Overview / Device Fabric / Agent Runs / Schedules & Jobs / Routing & Providers / Events & Telemetry / Security / Settings**. Label local host, remote device, or proposed server coordination precisely; show no topology nodes that cannot be discovered. Enable new server-specific controls only after capabilities and authority are proven.

## 3. Windows notch — complete state map

| State | Compact visualization | Expand action |
|---|---|---|
| Idle | Bunny identity, neutral or asleep | Open Ask Bunny |
| Listening / Speaking simultaneously | truthful mic/speaker indicators + live input level | Voice session panel, mute and stop |
| Thinking / routing | small orbit/flow indicator, only if runtime reports state | Model route detail, provenance |
| Tasks running | **personal agents on LEFT of horizontal notch**, **ABOVE vertical notch** | Mission/task strip with real statuses |
| Approval required | high-salience attention dot + explicit request | Review details; no implicit spoken approval |
| Completed / Failed | one-shot result, honest outcome label | Task artifact or failure/retry options |
| Offline / reconnecting / stale | disconnected or stale timestamp | Retry/pairing diagnostics |
| Permission blocked | shield + reason | Permission help, no unsafe bypass |
| Thermal/resource warning | limited amber icon and real reading if measured | System diagnostics and safe choices |

Placement: **top / bottom / left / right** per monitor, draggable/dockable, safely clamped to taskbar/work areas and display cutouts; agent strip on left for top/bottom, above for left/right; expanded content always opens inward, away from screen edge. Preserve position through cold restart, DPI change, multi-monitor detach, keyboard snap, and accessibility. No art or animations can obstruct close, permissions, or focus. No fake counts/ETAs; task progress appears only when backed by actual measurable steps. Long-running work persists in Host after dashboard closes, subject to actual policy.

## 4. Agent characters and motion

Identity **Bunny A** is the companion; **Gada / Spear / Vishnu Chakra / Sword** are four user-customizable personal-agent slots; **internal team agents** are labeled role rows inside mission detail; **OpenAI/Claude/Ollama/Cursor** are provider/tool identities, *not weapons*. Use canonical assets from `assets/t13` / `public/bunny-a/characters` and current character appearance engine. Existing styles (glossy/cel/arcade/comic/pixel) and intensity flags remain functional.

Every character may show **idle, listening, thinking, planning, researching, coding, testing, waiting for approval, blocked, completed, error**, but only where runtime event mapping supports it; otherwise use a neutral status and explanatory text. Animations are visually distinct, brief, GPU-efficient, and stop under reduced motion. A persistent visual activity must reflect a real active job, not a timer. Respect agent capacity: show overflow as `+N`, never drop work silently.

## 5. Complete feature layout inventory

Each line describes the major layout zones and expected data sources. Proposed surfaces must not be called shipped.

| Product area | Primary layout / interactions | Source and caveat |
|---|---|---|
| **Home / Ask Bunny** | hero + universal composer + quick actions; live task cards; recent projects, approvals, device state; adaptive right inspector | Existing Home/Chat; real Host snapshot only |
| **Conversation / Voice** | message timeline with multimodal attachments, interruptible voice orb, transcript visibility/privacy, push-to-talk/hands-free state | Existing voice stack; device/acoustic qualification separate |
| **Tasks** | All/Active/Queued/Completed/Blocked filters, queue rows, detail timeline, evidence/result, stop/pause only if supported | Existing task models + Host events |
| **Missions** | plan DAG/list, dependencies, stage summary, live agents, approvals, checkpoint/retry/replay, outputs | Existing mission + scheduler; replay UX needs work |
| **Projects & Workspaces** | project switcher, artifact tree, linked tasks, workspace rules, recent files | Existing project/file surfaces |
| **Files & Artifacts** | search/filter, preview, verified provenance, open/export where allowed, diff/version if available | Existing files; no invented saved artifacts |
| **Agents / Studio** | 4 personal slots, canonical weapon art, assignment, skills, styles, history, status; inspector panel | Existing Agent Studio/characters |
| **Agentic Teams / Workers** | planning/research/coding/review/testing role columns, handoffs, trace and failures | Existing internal agent rows; keep distinct from weapon agents |
| **Model Intelligence** | Auto/Manual/Per Task, candidate comparison, capability provenance, quality/cost/latency, pinned digest, selection explanation | Existing router + UOF route ledger; runtime wiring pending |
| **Providers & Accounts** | connected vs reported vs unavailable, auth controls, honest quota source, time-to-reset only if known, consent scope | Existing providers; NEVER invent quota percentages |
| **Runtime / Resource Control** | CPU/GPU/RAM/VRAM with timestamps, inference/device load, fairness warnings, stop/limits | Existing local-performance; missing sensors = unavailable |
| **Device Fabric** | Windows host, Android paired device, available remote nodes, link health, pairing/revoke, coordinator owner and lease | Existing remote-device + new pure coordinator fencing; wiring pending |
| **Server Control** | topology + nodes, work queues, scheduler, event stream, leases/epochs, failover/health, snapshots | New UX on verified endpoints; no fake deployment |
| **Memory / Lotus** | search, memory provenance, project boundaries, pin/correct/delete/export where permitted, contradiction review | Lotus exists; full user controls may be partial |
| **Context / Screen Assistance** | explicit app/screen picker, preview of minimal scope, consent, extraction result, action confirmation | Existing broker; no ambient silent screen capture |
| **Connected Services** | integrations list, account connect, scopes, last sync, permission revoke, action previews | Existing connector/OAuth broker, external availability varies |
| **Automation / Proactive** | scheduled jobs, trigger/time zone, action/permission policy, pause and activity history | Existing proactive/notification infrastructure |
| **Approvals / Safety** | approval inbox with exact operation, affected resources, risk, owner, evidence, approve/reject, immutable journal | Existing authority model; spoken phrases cannot authorize sensitive actions |
| **Activity / Audit / Replay** | chronological host event ledger, filters, correlated task IDs, read-only replay and receipts | Existing activity/replay components; QA for replay UX |
| **Notifications** | inbox + grouped alerts, quiet hours/frequency, approval alerts, source and staleness | Browser/native delivery differs; do not promise OS toasts if unsupported |
| **Widgets / Customization** | widget gallery, add/remove/reorder/density, honest data placeholders, responsive grid | Existing widgets/theme surfaces |
| **Design / Theme Studio** | defaults first, 22-theme gallery, per-window preview, appearance, glass intensity, accents, density, font, animation, character look | Existing theme host store; new slider requires schema evolution |
| **Developer Console** | logs, event inspector, model route decisions, test receipts, diagnostic bundle, flags | New presentation over existing telemetry, privilege gated |
| **Security & Privacy Center** | permission matrix, connected accounts, audit history, credentials status without exposing secrets, revoke/panic stop | Existing security infrastructure, UI follow-through |
| **Install / Update / About** | version/build, platform capabilities, update channel, publisher and creator, troubleshooting, signing state | Actual package metadata; signing owner-gated |
| **Onboarding & Pairing** | first-run privacy, local model availability, Windows install, Android QR/code pairing, consent tests | Existing pairing; physical proof owner-gated |
| **Error / Offline / Recovery** | empty/stale/error/suspended/conflict/reconciliation states for every screen | Existing fail-closed model; preserve clear paths |

## 6. Layout map per surface

**Windows Home**: left nav 240px (collapsible); top 64px; main chat/mission 55–65% width; right 30–40% task/agent inspector (collapsible); no permanent mock telemetry; context-sensitive action footer. At narrower widths, switch to single main pane with inspector as drawer. Modals preserve focus and restore it on exit.

**Windows Mission Control**: top goal + status + owner; left task DAG/timeline; center current execution and artifacts; right selected agent/approval/routing context; lower collapsible event log. Never use percentages unless anchored to explicit workload counters; support unknown duration.

**Android Home**: Bunny and status at top; large voice control and text entry; one top-priority active mission card; next actions and approvals; navigation fixed above gesture bar. Android Tasks and Agents are dedicated screens; pair/connect under More. Read-only where workstation authority is required.

**Server Control**: top overall source + freshness and connectivity; central device topology that degrades to accessible list; left node/device filter; right selected-node inspector; bottom execution queue/event log. For unavailable server features show "Not configured" and documented setup rather than sample nodes.

**Settings > Appearance, exact order**: (1) Theme: Silver Liquid Glass / Graphite Liquid Glass / Explore 22 existing themes; (2) Appearance: System | Light | Dark; (3) **Glass Intensity slider 0–100, default 85**, live preview and number; (4) Reduce Transparency / High Contrast, (5) Accent, (6) Density and Text Size, (7) Motion/Animation, (8) Notch placement, (9) Agent character style, (10) Sync preference workstation vs device. Existing saved preferences must migrate without loss.

## 7. State and semantics contract

Required visual states for **every** surface: loading, populated, empty, unavailable, permission required, disconnected, stale, partial data, failed, reconnecting, busy, completed, blocked/pending owner, high contrast, reduced motion. Distinguish **verified** from **provider-reported** from **unavailable** capability, and **unknown usage** from **0% usage**. Bind every data-driven state to an identified Host field/contract and last-updated timestamp; keep descriptive UI labels. Actions should not be merely decorative. Provide keyboard/TalkBack/Narrator equivalents and WCAG-aligned labels, contrast, focus, scaling, and minimum pointer sizes.

## 8. Performance, security and integration constraints

- Do not rewrite Host, UOF v1 schemas, models, or Android authorization just for appearance. Extend versioned interfaces narrowly, maintaining downgrade/migration paths.
- `src/lib/bunny-host/ui-theme.ts` currently stores a `transparency: low|medium|high` preference, **not** glassIntensity. Introduce a validated bounded integer `glassIntensity: 0..100` with default 85 and explicit migration in `ui-theme.server.ts`, host events/snapshots and native notch validators, without breaking existing clients and without adding authority-bearing fields.
- On 6GB-VRAM-class machines, minimize ambient motion; opt-in advanced effects and efficient non-blur rendering. Maintain frame stability under voice + agents. Never claim live duplex or 3s latency as proven without attended measurements.
- Cloud inference stays disabled unless separately authorized through actual existing policy; design shows eligible providers but never auto-connects.
- Preserve Windows notch persistence and Android device-local theme ownership; do not let device views acquire workstation-only actions. Sensitive approvals require actual user action.
- Platform-specific rendering: browser can use limited CSS filter/reflections, WPF requires own brush/rim implementation, Android requires capable safe native/composited effects with fallbacks. Design consistency does **not** imply identical low-level visual effects.

## 9. Acceptance and handoff

**Design artifacts:** all platform sitemap, annotated screen inventory, two full theme boards, system tokens/material spec, notch 4-edge states, character state diagrams, microinteraction/motion matrix, Android layout with insets, server-control information architecture, user flow maps, accessibility/reduced-motion variants, annotated component library, source-of-truth map and implementation-ready Figma-equivalent specs or repo docs.

**Engineering artifacts per phase:** implementation diff, migration note, relevant unit/UIA/TalkBack/browser tests, screenshot comparisons, real-state demo with seeded fixtures visibly labeled, device and CI evidence, explicit BLOCKED items, rollback plan and approval checkpoint. Keep PRs small, owner-reviewed; never merge without authorization.

**No-go:** fictional product health or provider quota, invented active agents, exposing credentials, unapproved computer actions, weakening tests/permissions to pass gates, bypassing physical signing/device checks, deleting the 22-theme gallery, replacing canonical character art, or conflating glass intensity with blur.

## 10. Source links

- Repository: https://github.com/COMRADEART/bunny-A
- Latest merged PR #83: https://github.com/COMRADEART/bunny-A/pull/83
- Latest verified CI: https://github.com/COMRADEART/bunny-A/actions/runs/41363985732
- Native design: https://github.com/COMRADEART/bunny-A/blob/main/docs/t13/BUNNY_A_T13_DESIGN_SPEC.md
- Theme engine: https://github.com/COMRADEART/bunny-A/blob/main/docs/visual-experience-2/THEME_ARCHITECTURE.md
- Windows and phone: https://github.com/COMRADEART/bunny-A/tree/main/docs/visual-experience-2