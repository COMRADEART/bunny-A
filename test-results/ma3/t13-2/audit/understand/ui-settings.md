# UI Settings map for MA3 T13.2 (Connected Accounts + Routing & Privacy)

Read-only investigation at HEAD e449456 (accepted T13.1 source aa134f5). No repository file was edited. `npm run test:ui`
baseline: **362 tests, 362 pass** (node --experimental-strip-types --test src/components/island/*.test.ts).

User scope reminder (relayed request): "even for all provider like ollama, opencode, etc" -> Connected Accounts must
cover EVERY `ProviderId` (`src/lib/orch/types.ts:5`: `"codex" | "claude" | "ollama" | "opencode" | "cline" | "cursor"`),
plus Laya (local, via Ollama) and TypeSafe Jev (hosted advice), not only Claude/Codex.

---------------------------------------------------------------------------------------------------------------------

## 1. Settings shell — `src/components/island/settings.tsx` (295 lines)

- `GROUPS` const tuple (settings.tsx:9-20): `General, Providers, AI & Models, Privacy and permissions, Workspace, Devices,
  Notifications, Runtime diagnostics, Appearance, About Bunny`. `type Group = (typeof GROUPS)[number]` (:21).
- `Setting({label, detail, children})` (:22-40) renders `<div className="setting-row"><div><strong/>{detail && <p/>}</div>{children}</div>`.
- `Settings()` (:41): `useState<Group>("Appearance")` (:43) — **no deep link to a group** (shots click the nav button).
  Nav: `<nav className="settings-nav glass" aria-label="Settings groups">` with buttons using `aria-current="page"` (:88-99).
  Panel: `<section className="settings-panel glass" key={group}>` (:100) — `key={group}` remounts the panel, so all
  sub-area local state (tab, drafts) resets on group switch.
- Group bodies:
  - "Providers" (:143-150): `liveProviders(store).map(p => <Setting label={NAMES[p.id]} detail={p.detail}><ProviderStatus provider={p}/></Setting>)`
    — read-only discovery status for all six providers. **This overlaps Connected Accounts**; T13.2 should leave it
    read-only and add a pointer ("Manage in AI & Models -> Connected Accounts"), not duplicate controls.
  - "AI & Models" (:151-152): `<AiModelsSettings />` (ai-models.tsx).
  - "Privacy and permissions" (:153-154): `<MissionSettings />` (mission.tsx) — Mission/agent permissions. **Name clash
    risk**: do NOT add a top-level "Routing & Privacy" group next to it; put Routing & Privacy inside AI & Models.
  - "Devices" (:167-168): `<Pairing compact />` from phone.tsx:1067.
- Render sites of `<Settings />`: desktop.tsx:161 (phone-width legacy shell, inside `.phone-content`), desktop.tsx:278,
  premium.tsx:299 (live T13 `.t8-app` shell). The `?companion=1` surface (premium.tsx:162-172) renders `<Phone/>` only,
  never `<Settings/>`. A paired device opening the premium shell still reaches `<Settings/>` -> AI & Models, which then
  shows the "managed on the workstation" caption because `intelligence` is null for devices (ai-models.tsx:109-114).

## 2. AI & Models — `src/components/island/ai-models.tsx` (548 lines)

Imports: `useIsland`, `IntelligenceSnapshot` (lib/bunny-host/intelligence-snapshot), `JevPolicy` (lib/bunny-host/intelligence),
and presentation helpers from `./intelligence-model` (:6-20).

- `SECTIONS = ["Connections", "Routing preferences", "Privacy & usage"] as const` (:22); `REVEAL_MS = 20_000` (:24).
- Local primitives (duplicated from settings.tsx, not shared):
  - `Row` (:26-36) — same markup as `Setting`.
  - `Switch({label, checked, disabled, onChange})` (:37-43): `<button className="switch" role="switch" aria-checked aria-label disabled>` + `<span/>` knob.
  - `Pill({tone, children})` (:44-50): `<span className="ai-pill" data-tone={tone}>`.
  - `Facts({items, label})` (:51-64): `<ul className="ai-facts" aria-label>` of `<li data-on={value}><strong>{label}: Yes|No</strong><span>{detail}</span></li>`.
  -> T13.2 should extract `Row/Switch/Pill/Facts` into a shared module (e.g. `ai-controls.tsx`) rather than copy a third time.
- `AiModelsSettings()` (:66-123) — **keyboard roving tabs** (WAI-ARIA tabs, manual-free/automatic activation):
  - `tabs = useRef<(HTMLButtonElement|null)[]>`, `base = useId()` (:69-70).
  - `onTabKey` (:72-84): ArrowRight/ArrowLeft wrap, Home/End; `preventDefault`, `setSection`, `tabs.current[next]?.focus()`.
  - Tablist `<div className="ai-tabs" role="tablist" aria-label="AI & Models sections">` (:87); each tab `role="tab"`,
    `id={base-tab-i}`, `aria-selected`, `aria-controls` only on the selected tab, `tabIndex={selected?0:-1}` (:88-104).
  - Single `<div role="tabpanel" id={base-panel-i} aria-labelledby={base-tab-i} tabIndex={0} className="ai-panel">` (:106).
  - Branching (:107-119): "Routing preferences" renders even without intelligence (`RoutingPreferences` keyed by
    `JSON.stringify(thresholds)` to reset drafts when Host values change); otherwise `!intelligence` -> caption
    (device: "Model connections and API keys are managed on the workstation (Windows Host)."; older Host: "...need the
    updated Bunny Host."); "Connections" -> `<Connections/>`; else `<PrivacyUsage key={JSON.stringify(jev.limits)}/>`.
- `Connections` (:125-142): caption "BunnyRouter makes every routing decision... none is assigned to a Personal Agent";
  `<h3 className="ai-heading"><Cpu/> Local models</h3>` + `LayaCard`; `<h3 className="ai-heading"><Cloud/> Cloud connections</h3>` + `JevCard`.
- `LayaCard` (:144-208): `<section className="ai-card" aria-labelledby="laya-title">` with **hard-coded id `laya-title`**
  (:150,153); `busy = !!store.pending.laya` (:148); Switch -> `store.configureLaya(next, setStatus)`; per-model `.ai-model`
  rows with "Run local benchmark" -> `store.benchmarkLaya(model, setStatus)`; `ul.ai-capabilities`; `Facts` from
  `layaDistinctions`; status line `<p className="caption" role="status" aria-live="polite">` (:203).
- `JevCard` (:210-382): hard-coded `aria-labelledby="jev-title"` (:250,253); `busy = !!store.pending.intelligence` (:220);
  credential UX: masked `MASKED_KEY` span `aria-label="Saved API key, hidden"` (:275), Replace / two-step
  Remove -> "Confirm remove" (:278-297); form (:302-341) with `type=password|text`, `autoComplete="off"`,
  `spellCheck=false`, `data-1p-ignore`, `data-lpignore`, `aria-invalid`, `aria-describedby={keyId-hint}`; Show/Hide
  `aria-pressed` auto-hides after `REVEAL_MS` (:221-225); `save()` clears the field before awaiting the Host (:235-237);
  `configure(patch)` re-sends the full `JevPolicy` (:243-247); Test connection / billable "Decision test" gated on an
  explicit checkbox (:360-374) -> `testIntelligence(true)` (sends `confirmBillable: true`).
- `RoutingPreferences` (:384-458): Rows "Approval before launch" (static "Required by Host"), "Next Task depth"
  (`store.mode`/`setMode`, client-only), "Local only" Switch (`store.localOnly`/`setLocalOnly`, client-only, "hard
  routing constraint for your next task"); when intelligence present: thresholds form (accept/fallback/clarify, 0-1,
  validated via `boundedNumber`, `fallbackBelow <= acceptConfidence`) -> `configureIntelligence({...thresholds})`;
  `assistanceLine(lastAssistance)`.
- `PrivacyUsage` (:460-548): privacy Switches `allowDecisionMetadata` / `allowTaskDescription` (the latter disabled unless
  metadata on, and auto-cleared when metadata turned off :503); `usageLine` + unknown-billing rows; limits form
  (per session/day, tokens, concurrent 1-4, timeout 1-30 s, USD cap) with `whole()` integer checks; Strict budget Switch.
- Pattern for every mutation: `setStatus("")` -> `if (await store.X(..., setStatus)) setStatus("<done text>")`; the
  refusal caption arrives through `onRefused` = `setStatus`. **Nothing is shown as saved before the Host acknowledges.**

## 3. View-model — `intelligence-model.ts` (106) + `intelligence-model.test.ts` (85)

- Header contract (:1-5): pure naming of the Host's secret-free snapshot; "Saved" = encrypted on this PC; only a
  Host-recorded test makes anything "tested".
- Imports use **relative paths with `.ts` extension, type-only where possible** (:6-8) — required because `test:ui` runs
  `node --experimental-strip-types` (no `@/` alias resolution, no JSX, no enums/namespaces/parameter properties). Value
  import allowed only from non-server pure modules (`isLayaModel` from lib/bunny-host/intelligence.ts:216).
- Exports: `JEV_STATE_LABEL: Record<JevConnectionState,string>` (:10-21, 10 states), `type Tone = "ok"|"warn"|"off"|"bad"`
  (:22), `jevTone` (:23-28; only CONNECTED is ok), `LAYA_STATUS_LABEL` (:30-35), private `ACTIVE` task-state set (:37),
  `type Distinction = {key,label,value,detail}` (:39), `layaDistinctions(snapshot, tasks)` (:42-53),
  `jevDistinctions(snapshot, tasks)` (:55-66; "selected" counts only ACTIVE tasks whose
  `decision.decision_assistance.action==="accept" && changed===true`), `MASKED_KEY` (:69; not derived from the key),
  `apiKeyProblem` (:72-79, mirrors Host shape check), `usageLine` (:81-86; "tokens unknown"/"cost unknown" when null),
  `lastTestLine(lastTest, now=Date.now())` (:88-93; injectable clock), `assistanceLine` (:95-99), `boundedNumber` (:102-106).
- Test pattern (intelligence-model.test.ts): `import test from "node:test"; import assert from "node:assert/strict";`
  local `snapshot(jevPatch, layaPatch)` fixture builder (:19-34) and `task(patch)` cast helper (:35); test titles prefixed
  with milestone ("T13.1 UI: ..."); asserts on label completeness (`Object.keys(JEV_STATE_LABEL).length === 10`), tone
  mapping, distinct facts via `Object.fromEntries(rows.map(r=>[r.key,r.value]))`, honest-text regexes, mask contains no
  `[A-Za-z0-9]`. **New file `connected-accounts-model.ts` + `connected-accounts-model.test.ts` must follow this exactly**;
  the glob `src/components/island/*.test.ts` picks it up automatically (package.json:24).

## 4. Naming collision: `connection-model.ts` is NOT about AI connections

`src/components/island/connection-model.ts` (216) is the M-A-3 T9 **Host transport** connection model: `ConnectionState`
(connecting/live/polling/reconnecting/offline/pairing/host-changed, :6-13), `connectionReducer` (:78), `canAct` (:125;
fresh snapshot <= `SNAPSHOT_FRESH_MS` 20 s over live/polling), `CONNECTION_LABEL` (:148), `commandCaption` (:175; captions
by code), `READ_ACTIONS` (:193-204) + `isMutating` (:205), `reconcileCaption` (:209). The T13.1 UI also already says
"Connections" for Laya/Jev. **T13.2 must name its UI model distinctly** (e.g. `account-model.ts`, types `AccountConnection`,
`ConnectionMode`) and must not reuse `Connection`/`ConnectionState`/`CONNECTION_LABEL`. Any new read-only Host action
(e.g. `accounts.list`) must be added to `READ_ACTIONS` here, or the store treats it as mutating (operation id + epoch
expectation + `canAct` gate).

## 5. Store data flow — `src/store/use-island.ts` (1385)

- State slots: `intelligence: IntelligenceSnapshot | null` (:256-257), `viewer: SnapshotViewer | null` (:155),
  `pending: Record<string,string>` (:161), `providerList`, `providerUsage`, `modelCapabilities`, `personalAgents`.
- Ingestion: `apply(snapshot, after, order, generation)` (:595-680). Ordering/generation guards (:597-599), device pinning
  (:614-623), then one `set({...})` copying `intelligence: snapshot.intelligence ?? null` (:659) alongside
  `providerList: snapshot.providers` (:651), `providerUsage` (:660), `modelCapabilities` (:661). A new
  `accounts`/`connections` snapshot field is added in exactly three places: the `Island` type, initial state (:716 and
  :1044 show `intelligence: null` in the reset and the initial object), and this `apply` set.
- Commands: `command(action, data, targetId=null, onRefused?)` (:793-859):
  1. mutating && `!canAct()` -> local refusal caption, nothing sent (:801-809);
  2. `targetId` already pending or uncertain -> "still confirming" note (:810-813);
  3. new `operationId` + `expect: {hostId, epoch}` for mutating (:814-817); `pending[targetId] = action` (:818);
  4. `commandBunnyHost` via `withTimeout(COMMAND_TIMEOUT_MS = 50_000)` (:822-827); timeout => `OUTCOME_UNKNOWN` (:828-836);
  5. ok -> `apply(result.snapshot)` (:846) — **every command reply carries a fresh snapshot**, so UI updates without a refetch;
  6. unknown -> `reconcile()` via `operation.status`, never resent (:852-855); refused -> `commandCaption` -> `onRefused`.
- T13.1 intelligence bindings (:1119-1130), all `async (...) => (await command(...)) !== null`:
  `configureIntelligence(policy)` -> `"intelligence.configure", {policy}`, target `"intelligence"`;
  `saveIntelligenceKey(apiKey)` -> `"intelligence.credential.save", {apiKey}` (key never stored in the store/localStorage);
  `removeIntelligenceKey()` -> `"intelligence.credential.remove"`; `testIntelligence(decisionTest)` ->
  `"intelligence.test", decisionTest ? {decisionTest:true, confirmBillable:true} : {}`;
  `configureLaya(enabled)` -> `"intelligence.laya.configure"`, target `"laya"`; `benchmarkLaya(model)` ->
  `"intelligence.laya.benchmark"`, target `"laya"`.
  -> T13.2 convention: one store method per Host action, `onRefused` last, boolean resolve; **per-account target ids**
  (e.g. `` `account:${provider}` ``) so six provider cards don't block each other through a shared `"intelligence"` key.
- Preferences persistence `save()` (:327-336) writes only theme/appearance/drafts/extensions/autoSubmit/cpuWarn/gpuWarn
  to localStorage; `mode`, `localOnly` are in-memory client state (not Host policy). Consent must be Host-owned, not here.
- Server side of the same flow: `commandBunnyHost` / `readBunnyHost` server fns (src/lib/orch/host.ts:40-60) ->
  `hostCall` (src/lib/orch/host-bridge.server.ts:96) using `hostCredentials()` (:66-70; honours
  `BUNNY_HOST_CREDENTIALS_FILE`) -> Host HTTP `/command` switch in src/lib/bunny-host/http.server.ts:768-794 where every
  `intelligence.*` case throws `WorkstationRequiredError` when `!local`. Workstation snapshot gets
  `intelligence: this.intelligenceSnapshot()` (manager.server.ts:521, 622). Device projection `deviceSnapshot()`
  (device-authority.server.ts:369-416) sets `intelligence: undefined` (:414), then `dashboardSnapshot()`
  (presentation.ts:486) applies public redaction (http.server.ts:558). `DEVICE_RIGHTS` (device-authority.server.ts:57-82)
  contains no `intelligence.*` actions -> `assertDeviceAction` refuses them (:87-94).

## 6. `host-stream.ts` (161)

`useHostStream()` (:18): SSE `/api/bunny-events?after=<cursor>` is an **invalidation signal only**; `ready`/`hb`/message ->
`connectionEvent("stream-signal")` + coalesced (120 ms) `refreshOllama()` canonical re-read (:53-60, :75-83); polling cadence
from `nextRefreshMs` (3 s visible / 30 s hidden / 15 s live re-read); watchdog every 4 s (:111-128); pairing/host-changed
stops streams (:135-139). Implication: Host-emitted events (e.g. `manager.emit(db.event("accounts.consent_changed", ...))`,
like manager.server.ts:637-674 for intelligence) are enough to refresh Settings; no new client transport is needed.

## 7. Phone — `phone.tsx` / `phone-model.ts`

- `PHONE_TABS = ["home","chat","agents","missions","settings"]` (phone-model.ts:22); `Body` routes `settings` ->
  `SettingsView` (phone.tsx:224).
- `SettingsView` (phone.tsx:960-1041) shows only: Connection card (`copy.title`, `CONNECTION_LABEL[store.connection.state]`,
  Host `shortId`, `sessionLine(viewer)`, `rightsSummary(viewer)` from remote-view-model.ts:109), Appearance segmented
  `aria-pressed` buttons (theme, motion), "This device" sign-out with two-step confirm (`caps.signOut`), and a workstation
  note "Personal Agents, voice and the Studio are managed on this PC." (:1037). **No AI/accounts info today.**
- `phoneCapabilities(viewer)` (phone-model.ts:175-195) / `holdsRight` (:169-173); `PhoneCapabilities` type (:143-166).
- Phone CSS classes: `pc-stack`, `pc-card`, `pc-h3`, `pc-line[data-tone]`, `pc-muted`, `pc-facts` (dl), `pc-bullets`,
  `pc-segment`, `pc-btn`, `pc-note`, `pc-tiny` (phone.css).
- For T13.2 "phone may only view redacted status": add a read-only `pc-card aria-label="AI accounts"` using a `pc-facts`
  dl of `{provider name, mode label, state label}` from a NEW redacted snapshot field (device projection must strip
  account identifiers/emails, credential handles, consent internals, usage rows), with a `pc-note` "Accounts and consent
  are managed on your PC." — no buttons, no `aria-pressed` toggles. Pure helpers + tests in phone-model.ts or the new
  account model. Do not add phone commands; do not add DEVICE_RIGHTS entries.

## 8. CSS tokens and accessibility

- Base tokens `.bunny-app` (bunny.css:8-66): `--page --page-end --fg --muted --subtle --panel --glass --field --border
  --luminous --hover --working --working-soft --thinking --claude --positive --negative --warning --stopped --action
  --action-ink --accent --accent-ink --shadow --raised-shadow --blur`, radii `--r-sm/md/lg/shell`, spacing `--s1..--s8`
  (4..64 px), type `--text-xs/sm/body/title/heading`, motion `--quick --motion --morph --ease --spring`. Light override
  `.bunny-app[data-theme="light"]` (:67-93).
- Live shell tokens: glass.css "single token source" `.bunny-app.t8-app, .bunny-app.t8-app[data-theme="light"]` (glass.css:13-65)
  and `.bunny-app.t8-app[data-theme="dark"]` (:68-107); adds `--glass-edge --glass-solid --elevated --pressed --lilac
  --focus --disabled --glass-saturate --dark-well --page-wash-a/-b`. Light `--warning #8a5a00`, `--positive #1e7a4c`,
  `--negative #b42335`; dark `#f0cf8f / #8fd7b0 / #ffb4b0`.
- Accessibility media: bunny.css `prefers-reduced-motion` (:2538-2549, kills animation/transition),
  `prefers-contrast: more` (:2550-2558; `--muted/--subtle = --fg`, stronger `--border`, opaque panels), `forced-colors`
  (:2559-2581; system colours, `.glass/.btn` bordered); glass.css `@supports not (backdrop-filter)` (:116-124),
  `prefers-reduced-transparency` (:129-144), `forced-colors` (:145-159, :472-477), reduced motion (:464-470); premium.css
  `[data-motion="off"|"reduced"]` kill-switch (:1199-1203). New CSS must use only tokens (no literal colours), so all of
  these keep working automatically.
- Settings/AI classes (bunny.css): `.settings-layout` (:1637), `.settings-nav` (:1643-1661), `.settings-panel` (:1662),
  `.setting-row` (:1668-1696), `.switch` (:1719-1749; 48x44 hit area), `.threshold-input` (:1750-1765; 44 px inputs),
  `.danger-text` (:1766); T13.1 block `/* M-A-3 T13.1 Settings -> AI & Models */` (:1769-1926): `.ai-tabs` + `[role=tab]`
  (40 px min-height) + `[aria-selected=true]`, `.ai-tabs [role=tab]:focus-visible, .ai-panel:focus-visible` outline
  `2px solid var(--working)`, `.ai-heading`, `.ai-card` (`--field` bg, `--r-md`), `.ai-card > header`, `.ai-pill` +
  `[data-tone=ok|warn|bad]` -> `--positive/--warning/--negative` (off = `--muted`), `.ai-facts` (auto-fit minmax(180px)),
  `.ai-limit`, `.ai-key*`, `.ai-mask`, `.ai-billable`, `.ai-capabilities`, `.ai-model`. Responsive: settings nav becomes
  horizontal scroller (bunny.css:2459-2474 at <=720px; :2284-2307 inside `.phone-content`), premium.css two-column nav
  grid and wrapping `.setting-row` at <=767px (:1162-1189), `.setting-row select` 124px at <=390px (bunny.css:2531-2536).
  -> New classes should extend the `ai-` prefix (`ai-account`, `ai-account-grid`, `ai-consent`, `ai-mode`) placed right
  after bunny.css:1926, reuse `.ai-card/.ai-pill/.ai-facts`, keep 44 px targets, and avoid `opacity` fades for state.
- Contrast guard `glass-contrast.test.ts` (102): reads glass.css itself, slices blocks by the comments
  `/* Light workspace` .. `/* Dark workspace` .. `/* Glass surfaces` (:11-12) — **those comment markers must not be
  renamed**; `check()` (:47-65) composites `--glass` over `--page` and both washes and asserts >= 4.5:1 for `--fg`,
  `--muted`, `--fg` on `--field`, `--muted` on `--elevated`; action-ink on action (:71-74); `.cx-row[data-bound="false"]`
  must not use `opacity` (:80-86); solid fallbacks + media queries exist (:88-95); theme selectors (0,3,0) (:97-102).
  **Gap:** tone colours used by `.ai-pill` (`--positive/--warning/--negative`) are not contrast-tested on `--field` over
  glass; T13.2 status pills for six providers make this more visible — add a test there (same helpers) rather than
  trusting by eye.

## 9. T13.1 screenshot harness

- `test-results/ma3/t13-1/screenshot-host.mjs` (48): disposable Host via `startHost({dataDirectory, root, workspaceRoot,
  port: 43891})` from src/lib/bunny-host/http.server.ts with scratch `%TEMP%/bunny-t131-screenshot-host` (:20-26), deletes
  `BUNNY_STATE_LAYOUT/BUNNY_RELEASE_ROOT/BUNNY_HOST_WORKSPACE` (:17-19), writes `credentials.json {token, port}` (:27-28),
  `command(action, body)` POSTs `http://127.0.0.1:43891/command` with `Bearer host.token` (:29-34), runs
  `host.manager.discover?.()` (:35), phase "saved" saves a FIXTURE key + enables Jev policy (:36-39), writes
  `screenshot-host.json`, stays alive until a `close` file appears in its folder (:43-48). Run:
  `node --experimental-strip-types test-results/ma3/t13-1/screenshot-host.mjs <fresh|saved>`.
- The dashboard dev server on `127.0.0.1:8093` is pointed at it through `BUNNY_HOST_CREDENTIALS_FILE=<scratch>/credentials.json`
  (consumed by `hostCredentials()` host-bridge.server.ts:66-70; same mechanism explicitly in package-acceptance.mjs:77 /
  package-preview.mjs:2-7), via the npm script wrapper (`scripts/with-app-env.mjs ... vite dev --port 8093`). Production
  43119/8084 untouched (screenshots-record.json).
- `test-results/ma3/t13-1/shots.mjs` (66): Playwright chromium; `BASE = T131_BASE ?? http://127.0.0.1:8093`; sizes desktop
  1366x900 and phone 390x844 (`isMobile, hasTouch`); themes light (fresh) or light+dark; goto `/?view=settings&theme=<t>`,
  click `navigation "Settings groups"` -> button "AI & Models", focus first tab, ArrowRight through `TABS =
  ["connections","routing","privacy"]` (**hard-coded 3 tabs; must be updated if tabs are added**); per tab records
  `scrollWidth > innerWidth+1` overflow, focused tab vs `aria-selected`, `tabpanel[aria-labelledby]`, fixture key in DOM
  / local+session storage, console + pageerror; full-page screenshot `shots/ai-models-<phase>-<tab>-<device>-<theme>.png`;
  writes `shots-<phase>.json`; failure = overflow | console errors | key leak | missing labelledby.
- Companion probe `key-form-probe.mjs` checks password field, autocomplete off, aria-pressed reveal, 20 s auto-hide, Save
  clears field.
- T13.2 should clone these into `test-results/ma3/t13-2/` (new port e.g. 43893/8094), extend TABS to the new tab list,
  add per-provider fixture states (installed/not installed/needs sign-in/view-only) and a device-viewer pass for the
  phone redacted card; keep FIXTURE-only credentials and zero paid-provider calls.

## 10. Conventions a new "Connected Accounts" sub-area must follow

1. Placement: a new FIRST tab inside `AiModelsSettings` (`SECTIONS`), not a new `GROUPS` entry. Recommended tab list:
   `["Connected Accounts", "Connections" (Laya/Jev, unchanged), "Routing & Privacy", "Privacy & usage"]` or merge Routing
   preferences into "Routing & Privacy" while keeping Jev limits in "Privacy & usage". Keep the roving-tab handler
   generic over `SECTIONS.length` (it already is) and keep `useId` ids.
2. Component shape: `function ConnectedAccounts({ accounts }: { accounts: <Snapshot> })` + one `AccountCard` per provider,
   `<section className="ai-card" aria-labelledby={useId-based id}>` (do NOT copy the hard-coded `laya-title`/`jev-title`
   pattern — six cards need unique ids), header `<strong id>` + `<p>` mode line + `<Pill tone>`, `Row` for each consent
   switch, `Facts` for distinct truths (installed / signed-in via native CLI / mode / allowed by you / allowed for this
   project / eligible / selected for a Task), local `status` + `<p className="caption" role="status" aria-live="polite">`.
3. Connection-mode selector: radio group semantics (`role="radiogroup"` + native radios, or `<select aria-label>` as in
   the Jev model picker) listing only modes the Host reports as supported for that provider (identity, native subscription
   CLI, delegated plan, API key, local runtime, view-only). Never show an "API key" field for a subscription-mode
   provider unless the user explicitly switches; display an explicit warning when `ANTHROPIC_API_KEY` is detected in the
   Host environment (Host-reported fact, e.g. `ambientApiKey: "present-ignored"`), never a silent switch.
4. Credentials: reuse the JevCard pattern verbatim (password input, autocomplete off, `data-1p-ignore`, `data-lpignore`,
   aria-pressed Show/Hide with `REVEAL_MS`, clear before await, `MASKED_KEY`, two-step Remove). The UI receives only
   `hasCredential`/`updatedAt`/`protection`, never a handle or id.
5. Store: snapshot field (e.g. `accounts: AccountsSnapshot | null`) wired in `apply` (:659 neighbourhood) + reset/initial
   state; store methods `configureAccount(provider, patch, onRefused)`, `setAccountConsent(scope, value, onRefused)`,
   etc., each `command("accounts.<verb>", data, `account:${provider}`, onRefused) !== null`. Read actions -> `READ_ACTIONS`.
6. Host: `accounts.*` cases in http.server.ts switch with `if (!local) throw new WorkstationRequiredError(...)`; no
   DEVICE_RIGHTS entries; `deviceSnapshot()` replaces the field with a redacted projection (or `undefined`).
7. View model: `src/components/island/account-model.ts` (relative `.ts` type imports, no JSX), exporting
   `ACCOUNT_STATE_LABEL: Record<State,string>` (completeness-tested), `accountTone(state): Tone` (reuse `Tone` from
   intelligence-model), `accountDistinctions(snapshot, tasks)`, `modeLabel`, `consentLine`, `retentionLine`; test file
   `account-model.test.ts` with "T13.2 UI:" titles. Run with `npm run test:ui` (baseline 362).
8. Copy rules (from T13.1): never claim connected/tested/eligible without a Host fact; "UNKNOWN stays UNKNOWN"; say
   "BunnyRouter decides" — no Personal Agent binding (personal-agents.ts:12 "AI providers are never bindable").
9. CSS: tokens only; `ai-` prefix; 44 px targets; no opacity fades; wraps at 390 px without horizontal overflow.

## 11. Adding "Routing & Privacy" without redesigning companion/Notch/Personal Agents

- Scope it entirely inside `ai-models.tsx` (a tab) + bunny.css T13.1 block; touch nothing in premium.tsx shell layout,
  `cx-panel`, characters.tsx/characters.css, studio.tsx, phone.tsx `Phone` routes, motion.css, or the native WPF Notch
  (scripts/island-notch.test.mjs, test-results/ma3/t10/notch-*).
- Content: (a) existing `RoutingPreferences` rows (depth, local-only, thresholds); (b) a per-provider consent matrix
  (`<table>` with `<caption>`, `<th scope="col">` providers / `<th scope="row">` scope "All projects" / per project, cells
  = `Switch` with aria-label "Allow <Provider> for <Project>") backed by Host policy, explicitly stating "enforced again at
  final dispatch and on every retry" (closes T13.1 limitation 7: accepted Jev advice may only move a Task to a provider the
  user consented to); (c) "Paid API use" row: "Use API keys only when I choose API mode" (default on) with the ambient-key
  warning; (d) retention row for jev_usage (e.g. "Keep hosted-decision usage history: 30 days", Host-enforced) rendered via
  a `retentionLine` helper. `localOnly`/`mode` are client-only today (use-island.ts) — if consent becomes Host policy,
  keep those two clearly labelled as "next task" preferences so they are not confused with Host-enforced consent.
- Accessibility: the table must reflow at <=720 px (stack per provider with `ai-card`), keyboard order follows DOM, every
  switch has an aria-label naming provider+scope, status line `role="status" aria-live="polite"`.
