# MA3 — Gate T1 Acceptance: ModelCapability Registry

**Milestone:** M-A-3 — Agentic Operating Layer / Product Completion
**Gate:** T1 — live provider/model discovery + normalized per-model capability registry (master-prompt §7–§8)
**Producing session:** Claude Code (model: GLM via OpenRouter), the implementation owner's session — this is the builder's gate record, **not** an independent review verdict.
**Date:** 2026-10-07
**Verdict:** `BUNNY_MA3_T1_PASS`

---

## 1. Scope, authorization, and what T1 is not

Authorized by the master prompt (M-A-3 program) plus the user instruction "Restart production, then begin T1". T1 covers
exactly the gate's own target: a Host-owned **ModelCapabilityRegistry** that probes real provider surfaces, normalizes
per-model facts, persists them additively, and announces material changes in the existing event vocabulary.

T1 is **not**: any routing change, any provider-selector change, any usage-per-model surface, any HTTP/API extension, any
UI, and no production release content (see §7). Routing still reads only the provider registry, exactly as delivered in
M-A-2: all three probe-result→routing consumers (`submit`/`retarget`/`launch`) are untouched — verified by review of the
diff and by the full regression suite passing unchanged.

Prior context: production restart inside this authorization window is recorded separately and completely in
`test-results/ma3/production-restart/INDEX.md` (RESTART_RECORD + census + controller fail-closed proof). The public
cloudflared tunnel remains deliberately down (L-T7-2); restoring it requires the user's separate consented manual
invocation. Neither is a T1 item.

## 2. Deliverables (code)

| File | What it adds |
|---|---|
| `src/lib/bunny-host/model-capability.server.ts` | `ModelCapabilityRegistry`: normalized `ModelCapabilityRecord`s (toolCalling / vision / embedding / contextWindow / loaded / isDefault / local — each probed field null-able, **null = UNKNOWN, never defaulted**); real probes: Ollama `/api/tags` + `/api/show` (POST) + `/api/ps`, Codex `app-server model/list`; `MODEL_SOURCE_PROVIDERS` = ollama+codex only; `MODEL_CAPABILITY_PROVIDERS` fixed display order; single-flight `refresh` (ProviderRegistry precedent), 30 min interval, change strings, snapshot |
| `src/lib/bunny-host/model-capability.test.ts` | 11 node:test cases: normalization incl. probed-negative vs UNKNOWN distinction; codex default + no invented facts; no-claims-for-sourceless providers; downed service leaves rows and their `probedAt` age untouched, emits nothing; persistence-across-reopen with `probedThisRun` reset; corrupt-row tolerance; interval gating + change strings; probe-failure path; adapter-set gating; idempotent table creation with user_version pinned and migrations keys untouched |
| `src/lib/bunny-host/contracts.ts` | Additive `HostSnapshot.modelCapabilities?: ModelCapabilitySnapshot` (the `missions?` precedent) |
| `src/lib/bunny-host/manager.server.ts` | Registry field on TaskManager; `discover()` / `refreshProviders()` merge model-capability change strings into the existing `provider.status_changed` announcements; `snapshot()` carries the new field. **Zero routing edits.** Adapter-set gating supplied: `availableProviders: () => this.adapters.map(a => a.id)` — a unit-test TaskManager with fixture adapters can never hit real Ollama HTTP or spawn real codex |

Evidence bundle: `test-results/ma3/t1/INDEX.md` (hashed).

## 3. Design decisions (and why)

1. **Own table in the constructor, no migrations key** — `model_capabilities(provider, model)` + provider index,
   `CREATE TABLE IF NOT EXISTS`. Chosen deliberately over the MissionStore recipe so no
   `migrations` key and no `PRAGMA user_version` bump is involved: bumping user_version would make every existing
   production DB refuse at boot (state-paths guards), and host-layer tables (like `providers` before it) already carry
   no migrations keys. The installed-state marker self-heals post-DDL via the existing boot-time
   `refreshStateMarker` path. Tested: user_version stays 3, migrations-key count unchanged, reopen loads rows.
2. **UNKNOWN discipline is enforced structurally, not by convention** — every probed capability field is explicitly
   `| null`; null is produced only where the probe truly said nothing: absent `capabilities` list in `/api/show`
   (older servers) → all three capability flags UNKNOWN; a returned list without a flag → probed **negative** (false);
   failed/absent `/api/ps` → `loaded` UNKNOWN, ps-omitted tag → probed false. A null or failed top-level probe
   (Ollama down, codex CLI missing, catalogue error) writes **no rows and no change strings**; persisted rows keep
   their original `probedAt` age. Each of these is a named test.
3. **Persisted state is memory, never proof** — rows survive restart (upsert-only, no deletes: models that drop off a
   listing keep their last probed facts rather than silently vanishing), but `probedThisRun` is an in-memory flag that
   only this Host instance's own probe can set. Consumers can therefore always distinguish "fact, as of T" from
   "this instance has actually probed".
4. **Material changes** use a facts-only signature (excludes timestamps/evidence), so an unchanged re-probe announces
   nothing while a genuinely changed fact (`context window 32768→65536`, model added/removed) becomes one
   `provider.status_changed`-carried change string, in the `describeChange` spirit.
5. **Adapter-set gating** — model discovery probes only providers this Host manages; prevents standalone/fixture
   TaskManagers from making real network or CLI calls (test-proven: claude-only adapter set → zero probe calls, zero
   rows).
6. **No per-model usage** — no real probe exposes it; UsageWindow stays provider-level (the header comment forbids
   inventing it).

## 4. Evidence and classification (hashes in `test-results/ma3/t1/INDEX.md`)

| Evidence | Classification | Result |
|---|---|---|
| `test-results/ma3/t1/live-probe-capture.json` produced by `live-capture.mts` against this workstation's real endpoints | **LIVE VERIFIED** | Ollama 5 models discovered (e.g. `deepseek-v4.1-flash:cloud`: local:false, toolCalling:true, vision:true, from the server's own `capabilities: …; tools; vision` answer; `contextWindow` genuinely UNKNOWN — this Ollama build sends no `context_length`; `/api/ps` loaded:none probed negative); Codex 4 models (`gpt-6-astra` … `gpt-5.6-luna`, preferred=`gpt-6-astra` only; all other capability fields UNKNOWN); Claude/OpenCode/Cline/Cursor: no rows, `probedThisRun:false`. Changes: `Ollama: 5 models discovered` / `Codex: 4 models discovered`. In-memory DB only; no production state touched |
| `src/lib/bunny-host/model-capability.test.ts` run (focused + inside full suite) | SIMULATED (injected fixtures) | 11/11 pass |
| Full `npm test` | SIMULATED (fixtures) + regression floor evidence | **384/384 pass, 0 fail, 0 skipped** (254 outer + 384 strip-types phases), `TEST_EXIT=0` |
| `npm run test:ui` (island UI group, the MA2 floor's third phase) | SIMULATED | **37/37 pass, 0 fail, 0 skipped** (`logs/ui-tests.txt`) |
| `npm run build` (vite client+ssr, nitro vercel, db:migrate skip) | STATIC VERIFIED | `BUILD_EXIT=0` |
| `npm run typecheck`; eslint on the four T1 files | STATIC VERIFIED | both exit 0, re-run at gate close after the final edit |

Regression floor recomputed exactly: **254 scripts + 384 app/lib + 37 UI = 675** — MA2's 664 floor plus the 11 new T1
tests, with the same zero-fail/zero-skip standard. The UI phase is `npm run test:ui` (separate from `npm test`), the
same relationship MA2's floor counted.

## 5. Boundaries honored

- **Host sole authority / no new authority:** the registry is Host-layer additive state; it grants nothing, routes
  nothing, and changes no permission, promotion, restart, or identity rule. All MA0–MA2 invariants remain in force.
- **"Never invent availability"** — UNKNOWN stays UNKNOWN everywhere a probe says nothing (structural, tested).
- **§37 privacy:** evidence contains model tags/catalogue ids and probe verbs only — no provider transcripts, no
  reasoning content, no tokens/cookies/credentials, no command lines persisted.
- **§27:** nothing pushed; repo work stays local.
- **Production:** the installed v26-MA2-R1 release is untouched and byte-verified this window (separate record); T1
  code exists only in the dev workspace — live capture ran in disposable processes exclusively.

## 6. NOT TESTED (explicit)

- The HTTP/API surface and any UI consumption of `modelCapabilities` (later gates by design).
- The table's first creation inside the **production** host.sqlite (production does not yet run this code — by design;
  future release install will exercise it; the migration test proves the creation path on real disk DBs here).
- Real probe of Claude Code / OpenCode / Cline / Cursor model listings (no such probe surface exists yet).
- Any deployed-environment behavior (this is a Node/SQLite Host-layer capability; the Vercel web app is unaffected).

## 7. Documented limitations (verdict-neutral, recorded in `INDEX.md §Standing limitations`)

1. `contextWindow` UNKNOWN for all five real Ollama models on this workstation — the local Ollama build's `/api/show`
   omits `context_length`.
2. Codex records carry only id + catalogue preferred-default; that surface exposes no capability facts and none are
   invented.
3. Sourceless providers (claude/opencode/cline/cursor) remain UNKNOWN until a real listing surface exists.
4. `HostSnapshot.modelCapabilities` not yet passed through the `dashboardSnapshot` HTTP redaction gateway (deliberate
   T1 boundary; consumption surfaces are later gates).
5. No per-model usage exists and none is invented.

## 8. Verdict and NEXT

**`BUNNY_MA3_T1_PASS`** — all T1 gate work is implemented, all gates green (typecheck 0 / eslint 0 / 384·0·0 suite /
build 0), live discovery captured with real probes and classified LIVE VERIFIED, UNKNOWN discipline structurally
enforced and test-proven, zero routing or MA0–MA2 behavior change, evidence hashed.

**NEXT (not begun without a go):** the master prompt's next stage after T1 — no T-sequenced work starts from this
document alone. Queued, unchanged, still requiring separate user decisions: (a) §27 Git synchronization plan; (b)
restore of public tunnel transport via the user's own consented manual tunnel invocation; (c) the fresh independent
MA2 re-review (§43) remains outstanding — none of these block future-gate implementation reads.