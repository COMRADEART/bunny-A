Full report: C:/Users/allam/AppData/Local/Temp/claude/C--Users-allam-Documents-new-bun-router/ff4c2710-73a2-4620-8ef3-2bbacaab2f37/scratchpad/understand/ui-settings.md

This was read-only. No repo files were edited. `npm run test:ui` baseline: 362 run, 362 pass. Scope from the relayed user request: Connected Accounts must cover every `ProviderId` (`src/lib/orch/types.ts:5`: codex, claude, ollama, opencode, cline, cursor), plus Laya and TypeSafe Jev.

**1. Settings shell (`src/components/island/settings.tsx`)**
- The groups list is the `GROUPS` tuple (:9-20).
- Rows are drawn by `Setting` (:22-40) using the `setting-row` markup.
- `Settings()` (:41) starts on `useState<Group>("Appearance")`. There is no deep link to a group.
- The nav is `nav.settings-nav[aria-label="Settings groups"]`. Its buttons use `aria-current="page"`.
- The panel is `section.settings-panel glass key={group}` (:100). Because of the key, all sub-area state resets when the group changes.
- The "Providers" group (:143-150) is a read-only `liveProviders()` + `ProviderStatus` list for all six providers. It overlaps Connected Accounts: keep it read-only and add a pointer to the new tab.
- "AI & Models" renders `<AiModelsSettings/>` (:152).
- "Privacy and permissions" is already `<MissionSettings/>` (:154). Do not add a top-level "Routing & Privacy" group next to it; the names would clash.
- `<Settings/>` renders in three places: desktop.tsx:161, desktop.tsx:278 and premium.tsx:299 (the live `.t8-app` shell). `?companion=1` renders only `<Phone/>`.

**2. AI & Models (`ai-models.tsx`)**
- Tabs: `SECTIONS = ["Connections","Routing preferences","Privacy & usage"]` (:22). `REVEAL_MS = 20_000`.
- Local primitives are copies, not shared: `Row` (:26, same as `Setting`), `Switch` (:37, `button.switch role=switch aria-checked aria-label`), `Pill` (:44, `span.ai-pill[data-tone]`), `Facts` (:51, `ul.ai-facts[aria-label]` with `li[data-on]`). T13.2 should move them into one shared module instead of copying a third time.
- Keyboard tabs: `onTabKey` (:72-84) handles ArrowLeft/ArrowRight with wrap, plus Home/End, and calls `preventDefault` then focus. Tabs use `useId()` ids, `aria-selected`, `aria-controls` (selected tab only) and `tabIndex` 0/-1. There is one `div[role=tabpanel][aria-labelledby][tabIndex=0].ai-panel` (:106).
- With no intelligence data the panel shows a caption. A device sees "managed on the workstation"; an old Host sees "needs the updated Bunny Host".
- `LayaCard` (:144):
  - Uses a hard-coded `aria-labelledby="laya-title"`. Six provider cards must use `useId` ids instead.
  - `busy = store.pending.laya`.
  - Calls `configureLaya` and `benchmarkLaya`.
  - Status goes to `p.caption[role=status][aria-live=polite]`.
- `JevCard` (:210):
  - Hard-coded id `jev-title`; `busy = pending.intelligence`.
  - Key field: password/text input with `autoComplete=off`, `data-1p-ignore`, `data-lpignore`, `aria-invalid`, `aria-describedby`.
  - Show/Hide uses `aria-pressed` and hides itself after 20 s. The field is cleared before awaiting the Host.
  - Saved keys show as `MASKED_KEY`. Remove takes two steps. The billable decision test needs a checkbox first.
  - `configure()` re-sends the full `JevPolicy`.
- `RoutingPreferences` (:384):
  - Task depth (`store.mode`) and Local only (`store.localOnly`) are client-only, in memory, not Host policy.
  - Threshold form validated with `boundedNumber`, saved via `configureIntelligence`.
- `PrivacyUsage` (:460): metadata and request-text switches (text depends on metadata), `usageLine`, the limits form, and Strict budget.
- Every mutation follows one pattern: `setStatus("")`, then `if (await store.X(..., setStatus)) setStatus(done)`. Nothing shows as saved before the Host confirms.

**3. View-model pattern (`intelligence-model.ts` + `.test.ts`)**
- Pure helpers. Imports are relative, end in `.ts`, and are type-only (:6-8). This is required because `test:ui` (package.json:24) runs `node --experimental-strip-types` over `src/components/island/*.test.ts`: no `@/` alias, no JSX, no enums.
- Exports:
  - `JEV_STATE_LABEL` (10 states)
  - `type Tone = ok|warn|off|bad` and `jevTone` (only CONNECTED is ok)
  - `LAYA_STATUS_LABEL`
  - `type Distinction` and `layaDistinctions(snapshot, tasks)` / `jevDistinctions(snapshot, tasks)`
  - `MASKED_KEY`, `apiKeyProblem`, `usageLine`
  - `lastTestLine(lastTest, now)` (clock can be injected), `assistanceLine`, `boundedNumber`
- Tests use `node:test` + `node:assert/strict` with a `snapshot(jevPatch, layaPatch)` fixture builder and "T13.1 UI:" titles. They check that every label exists, the tone mapping, that facts stay distinct (`Object.fromEntries`), honest text via regex, and that the mask has no alphanumerics.
- T13.2 should add `account-model.ts` + `account-model.test.ts` in the same style. The glob picks them up automatically.

**4. Naming collision**
- `connection-model.ts` is the T9 Host transport model, not AI connections. It holds `ConnectionState`, `connectionReducer`, `canAct` (fresh snapshot within 20 s), `CONNECTION_LABEL`, `commandCaption`, `READ_ACTIONS` (:193) and `isMutating`.
- The new model needs different names (`account-model`, `AccountConnection`, `ConnectionMode`).
- Any new read-only Host action must be added to `READ_ACTIONS`. Otherwise the store treats it as mutating: operation id, epoch check, `canAct` gate.

**5. Store flow (`src/store/use-island.ts`)**
- Ingestion: `apply()` (:595-680) has order and generation guards, then copies `intelligence: snapshot.intelligence ?? null` (:659) next to `providerList` (:651), `providerUsage` (:660) and `modelCapabilities` (:661). A new accounts field goes in three places: the `Island` type, reset/initial state (:716, :1044), and this `set`.
- `command(action, data, targetId, onRefused)` (:793-859) works in order:
  1. Refuses locally if `!canAct()`.
  2. Refuses if the target is already pending or uncertain.
  3. Mutating commands get an `operationId` and `expect {hostId, epoch}`; `pending[targetId]` is set.
  4. Calls `commandBunnyHost` with a 50 s timeout (`COMMAND_TIMEOUT_MS`). A timeout means outcome unknown.
  5. On success, `apply(result.snapshot)` — every reply carries a fresh snapshot.
  6. Unknown outcomes go to `reconcile` and are never resent. Refusals go through `commandCaption` to `onRefused`.
- Intelligence bindings (:1119-1130), each `(await command(...)) !== null`:

| Store method | Host action | Target |
|---|---|---|
| `configureIntelligence` | `intelligence.configure {policy}` | "intelligence" |
| `saveIntelligenceKey` | `intelligence.credential.save {apiKey}` (never stored client-side) | "intelligence" |
| `removeIntelligenceKey` | `intelligence.credential.remove` | "intelligence" |
| `testIntelligence` | `intelligence.test {decisionTest, confirmBillable}` | "intelligence" |
| `configureLaya` | `intelligence.laya.configure` | "laya" |
| `benchmarkLaya` | `intelligence.laya.benchmark` | "laya" |

- T13.2 should use one target id per account (``account:${provider}``) so six cards don't block each other on a shared key.
- localStorage `save()` (:327-336) holds only appearance-type preferences. Consent must live on the Host.
- Server path:
  - The server functions `readBunnyHost`/`commandBunnyHost` (lib/orch/host.ts:40-60) call `hostCall` (host-bridge.server.ts:96).
  - `hostCall` uses `hostCredentials()` (:66-70), which honours `BUNNY_HOST_CREDENTIALS_FILE`.
  - Host-side cases live in http.server.ts:768-794. Each `intelligence.*` case throws `WorkstationRequiredError` when not local.
  - The workstation snapshot gets `intelligence` (manager.server.ts:521/622).
  - `deviceSnapshot()` (device-authority.server.ts:369-416) sets `intelligence: undefined` (:414). `dashboardSnapshot()` (presentation.ts:486) then redacts (http.server.ts:558).
  - `DEVICE_RIGHTS` (:57-82) has no `intelligence.*` entries, so devices are refused.
- Events (`manager.emit(db.event(...))`, manager.server.ts:637-674) trigger SSE invalidation and a canonical re-read through `host-stream.ts` `useHostStream` (:18; coalesced 120 ms; polls 3 s visible / 30 s hidden / 15 s re-read when live). No new client transport is needed.

**6. Phone**
- `PHONE_TABS` includes settings (phone-model.ts:22). `SettingsView` (phone.tsx:960-1041) shows only: Connection card (state label, Host id, session line, `rightsSummary`), Appearance (`aria-pressed` buttons), two-step device sign-out, and a note. It has no AI or accounts info today.
- For redacted status: add a read-only `pc-card aria-label="AI accounts"` with a `pc-facts` list of provider, mode label and state label, plus a `pc-note` saying it is managed on the PC.
  - It reads from a new redacted field set in `deviceSnapshot()`: no account ids or emails, no handles, no usage rows.
  - No buttons, no new `DEVICE_RIGHTS`.
- Helpers: `phoneCapabilities` / `holdsRight` (phone-model.ts:169-195).

**7. CSS tokens and accessibility**
- Base `.bunny-app` tokens (bunny.css:8-66):
  - Colours: `--fg --muted --subtle --panel --glass --field --border --hover --working --working-soft --positive --negative --warning --action --action-ink`
  - Spacing `--s1..--s8`; type `--text-xs/sm/body/title/heading`; radii `--r-sm/md/lg`; motion `--quick --ease`
  - Light override at :67-93.
- The live shell's tokens come from glass.css: light at :13-65, dark at :68-107. It adds `--glass-solid --elevated --pressed --focus --disabled`.
- Accessibility media queries:

| Feature | bunny.css | glass.css | premium.css |
|---|---|---|---|
| reduced motion | :2538 | :464 | `[data-motion=off/reduced]` :1199 |
| `prefers-contrast: more` | :2550 | — | — |
| `forced-colors` | :2559 | :145, :472 | — |
| reduced transparency | — | :129 | — |
| `@supports not (backdrop-filter)` | — | :116 | — |

- Existing classes:
  - Settings: `.settings-layout/.settings-nav/.settings-panel/.setting-row` (bunny.css:1637-1696), `.switch` (:1719, 48x44), `.threshold-input` (:1750, 44 px), `.danger-text`.
  - T13.1 block (:1769-1926): `.ai-tabs [role=tab]` (40 px, `[aria-selected]`), focus-visible outline `var(--working)` for tabs and `.ai-panel`, `.ai-heading`, `.ai-card`, `.ai-pill[data-tone=ok|warn|bad]` (maps to `--positive/--warning/--negative`), `.ai-facts`, `.ai-key*`, `.ai-mask`, `.ai-limit`, `.ai-model`.
  - Responsive: bunny.css :2459 (≤720px), :2284 (`.phone-content`), :2531 (≤390px); premium.css :1162-1189 (≤767px).
- `glass-contrast.test.ts`:
  - Slices glass.css by the comments `/* Light workspace`, `/* Dark workspace`, `/* Glass surfaces`. Do not rename them.
  - Requires 4.5:1 for fg and muted on glass over the page and both washes, fg on field, muted on elevated, and action-ink on action.
  - Unbound `.cx-row` must not use opacity; fallbacks and media queries must exist; theme selectors must be (0,3,0).
  - Gap: the pill tone colours are not contrast-tested. Add that test for six provider pills.

**8. Screenshot harness**
- `test-results/ma3/t13-1/screenshot-host.mjs`:
  - Starts a disposable `startHost({dataDirectory, root, workspaceRoot, port:43891})` with scratch state in `%TEMP%/bunny-t131-screenshot-host`, and clears the state/release/workspace env vars first.
  - Writes `credentials.json {token, port}` and POSTs `/command` with the Bearer token.
  - Phase "saved" stores a FIXTURE key and a policy. The Host stops when a `close` file appears.
- The dev server on 8093 reaches it through `BUNNY_HOST_CREDENTIALS_FILE` (same mechanism as package-acceptance.mjs:77).
- `shots.mjs` (Playwright):
  - Desktop 1366x900 and phone 390x844 (mobile + touch), light (plus dark in later phases).
  - Opens `/?view=settings&theme=`, clicks "Settings groups" → "AI & Models", then ArrowRight through a hard-coded `TABS` list of 3. That list must be updated when tabs are added.
  - Per shot it checks: horizontal overflow, focused tab matches `aria-selected`, `tabpanel[aria-labelledby]` exists, fixture key not in the DOM or local/session storage, and the console. Writes `shots-<phase>.json`.
- `key-form-probe.mjs` covers the key-form interactions.
- T13.2 should clone both into `t13-2/` on new ports, add per-provider fixture states and a device-viewer pass, use FIXTURE keys only, and make zero paid calls.

**9. Recommended placement and conventions**
- Add Connected Accounts as the first tab inside `AiModelsSettings`. Then either keep "Connections" (Laya/Jev) as is and turn "Routing preferences" into "Routing & Privacy", or keep Jev limits in "Privacy & usage".
- `AccountCard` per provider:
  - `section.ai-card` with a `useId` labelledby, header, `Pill`, consent `Row`/`Switch`es.
  - `Facts`: installed / signed in natively / mode / allowed by you / allowed for this project / eligible / selected for a Task.
  - The mode selector (radiogroup or labelled select) lists only modes the Host says the provider supports.
  - API key entry reuses the JevCard pattern exactly. The client only ever receives `hasCredential`, `updatedAt` and protection, never a handle.
  - Show a Host-reported ambient `ANTHROPIC_API_KEY` warning; never switch silently.
- "Routing & Privacy" tab content:
  - The existing routing rows.
  - A provider × project consent `<table>` with caption and `th scope`. It stacks into cards at ≤720px. Each switch's aria-label names provider and scope.
  - Text saying consent is enforced again at final dispatch and on retries (closes limitation 7).
  - A "Paid API only in API mode" row and a `jev_usage` retention row.
- Keep all changes in ai-models.tsx, the new model plus its test, and the T13.1 bunny.css block. Do not touch the premium shell, cx-panel, characters, studio, Phone routes, or the WPF Notch. Personal Agents stay unbindable (personal-agents.ts:12).