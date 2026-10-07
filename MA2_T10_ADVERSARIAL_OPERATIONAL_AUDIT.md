# M-A-2 Gate T10

## Audit identity

Implementation-side final adversarial operational audit, branch `ma2-operational-hardening`, begun 2026-10-06; UTC closure 2026-10-07T01:25:17.511Z. This auditor implemented the repairs and is not an independent reviewer. T1–T9R accepted evidence was read and its complete sealed hashes reverified before shared document updates. Runtime/tooling packages use exact committed archives; evidence/documents are committed separately.

| Item | Final staged candidate |
|---|---|
| Release | Bunny-A-Windows-v25-T10 |
| Runtime source | `4f977c8071be17a7807a6c0b6f072f8f17cd4d4d` |
| Tooling pin | `599103cf4409ca1929f9d6109f5f6adec585bbf0` |
| Manifest SHA-256 | `5812926fc685d7f21fc6899df7aaf28583131e5ca0af10b8abb2abf81d9fceff` |
| ZIP SHA-256 | `a1ba1b219478f0296b6b8eef2d1b94cee099c48f13794fa5d5b2c7d1862f5580` |
| ZIP bytes | 36260857 |
| Asset manifest SHA-256 | `176828598eb38f2b2e0e6dd84316d657d04ebd07362304254a56b59c6ff74d75` |
| Covered installed files | 160; zero missing/changed/extra |

[candidate-package.json](test-results/ma2-gate10/candidate-package.json)

## Baseline

Discovered baseline: **645 tests = 251 scripts + 357 application + 37 UI** from actual T9R regression evidence, not a reused milestone number. Initial HEAD `1802dfa41ac8bcc6b07bf5a7039c45c09cb16484`. Before attacks: consistent SQLite backup outside Git, protected-row ledger, installed identity, process/Startup/provider/device/flags ledger and original Calculator inventory. [current-system-ledger.json](test-results/ma2-gate10/current-system-ledger.json), [db-backup.json](test-results/ma2-gate10/db-backup.json), [protected-row-ledger.json](test-results/ma2-gate10/protected-row-ledger.json). Prior documentation hashes/commits are recorded in the ledger. Backup raw content never enters Git.

## Current production identity

Production remains **Bunny-A-Windows-v17-T6** at `C:\Users\allam\AppData\Local\Bunny-A\releases\Bunny-A-Windows-v17-T6`, source `cb005ef75bf86d4d9e722b5214612fe115db5c6b`, tooling `90a6e8da11e77bd1d3d402c166456f0d816fb4c4`. Manifest `f5bf648c92711baba3fe4a24ea46c449fd8f226c0afa018f8f9cf93da52fde88`; ZIP `29740a280d96a7d1ed87acab3fbd59fc709ed523e8f118da43be4603606ace1d`. Canonical state `C:\Users\allam\AppData\Local\Bunny-A\state`, DB `C:\Users\allam\AppData\Local\Bunny-A\state\host.sqlite`, schema 3, workspace `C:\Users\allam\Bunny-Workspace`. Host PID 35792, instance `3ea628ff-7f5e-47fb-8f66-69c42b32112a`, healthy; gateway 17040, Island 40712, worker 45724 retain original native lifetimes. Current transport child 25956 replaced original 39680; same executable bytes/worker parent, cause NOT ESTABLISHED. Current URL [https://shut-achieved-vista-deny.trycloudflare.com](https://shut-achieved-vista-deny.trycloudflare.com). This replaces the baseline URL in operational state. No T10 production activation/restart/transport termination was performed. [production-native-final.json](test-results/ma2-gate10/production-native-final.json), [production-final.json](test-results/ma2-gate10/production-final.json).

## Threat model

Attack components that lie, race, crash, replay, disappear or change identity. Treat provider version strings, cached UI, saved PIDs, pending permission IDs and rollback paths as untrusted evidence, not authority. Production safe controls remain reversible; disruptive actions without exact §6 authorization are staged or explicitly deferred. Positive controls establish each major boundary: valid canonical staged state, registered harmless provider metadata, actual admitted native batch, paired state 200, public shell 200, quiescent verified code roundtrip and live unrelated sentinel before/after Stop.

## Attack matrix

**Planned 69; executed 69; final passed 69; failed 0; primary not tested 0; blocked 0.** Executed includes SIMULATED and STATIC VERIFIED cases; it does not mean 69 live disruptions. Classification counts: DISPOSABLE LIVE 39; SIMULATED 19; LIVE VERIFIED 6; LIVE SAFE 2; STATIC VERIFIED 3. Optional/unauthorized subcases and controller limitations are listed explicitly below. Three original HIGH failures remain in the ledger and have final-candidate repairs/retests. [threat-matrix.md](test-results/ma2-gate10/threat-matrix.md) and [attack-plan.json](test-results/ma2-gate10/attack-plan.json) contain every stable ID, requested attack, expected invariant, actual result and limit.

| Gate | Original guarantee | New T10 attack | Final candidate result | New evidence |
|---|---|---|---|---|
| T1 | External canonical state; no reset/fallback | path spoof, damaged DB, WAL/stale copies | PASS within recorded classifications/limits | t1-path-spoof.json, wal-partial-attack.json, script-attacks-pass.log |
| T2 | Fresh exact provider compatibility | same-size/mtime byte substitution, future 99.0.0, launch race | PASS within recorded classifications/limits | t6/affected-retest-pass.log, stop-composition.json |
| T3 | Contained failures and honest recovery | async/serialization/child failures, hard crash/no replay | PASS within recorded classifications/limits | t6/affected-retest-pass.log, restart-verified-v25.json |
| T4 | Owned processes only | stale claims, real jobs/hooks/breakaway, unrelated sentinels | PASS within recorded classifications/limits | composition-attacks.log, v25-rollback-attacks.json |
| T5 | Private canonical truthful presentation | secrets/reasoning/stale/duplicate events, verification failure | PASS within recorded classifications/limits | composition-attacks.log, secret-audit/result.json |
| T6R | Authenticated transport/device authority | public spoof, paired revoke, stale SSE, bounded watchdog fixtures | PASS within recorded classifications/limits | public-denials-valid-wire.json, installed-stream-retest-v25.json, script-attacks-pass.log |
| T7 | Canonical single startup generation | three installed competitors, registry/Startup audit, wrong-release collision | PASS within recorded classifications/limits | startup-competitors.json, production-native-final.json, v25-rollback-attacks.json |
| T8 | Verified code-only rollback | tamper/path/stale identity/newer rows/partial commit/active grant | PASS within recorded classifications/limits | v25-rollback-attacks.json, installed-active-rollback-v25.json, transition-boundaries.json |
| T9 | Bounded task/operation/time/count/Stop authority | scope/replay/expiry/budget/Stop/restart | PASS within recorded classifications/limits | restart-repair-focused-pass.log, native-matrix-v25.json, restart-verified-v25.json |
| T9R | Native target reuse with explicit ownership | rapid/retry/concurrent acquire, stale content, owned-only cleanup | PASS within recorded classifications/limits | native-matrix-v25.json, composition-attacks.log, calculator-owned-cleanup.json |


## T1 attacks

**T10-T1-01 — DISPOSABLE LIVE — PASS.** Installed state selection and missing-DB startup refuse fallback; disposable Git-clean and external canonical state survive. Installed v25 is independent of the development checkout. Repository removal itself was simulated through an independent installed root, not a production rename. Evidence: [script-attacks-pass.log](test-results/ma2-gate10/script-attacks-pass.log), [v25-rollback-attacks.json](test-results/ma2-gate10/v25-rollback-attacks.json).

**T10-T1-02 — DISPOSABLE LIVE — PASS.** Relative, repository, release-local, unprovisioned temporary and unknown-layout inputs refuse without a new database; canonical staged state is the positive control. A fully validated, explicitly provisioned disposable temporary state is intentionally allowed. Evidence: [t1-path-spoof.json](test-results/ma2-gate10/t1-path-spoof.json), [script-attacks-pass.log](test-results/ma2-gate10/script-attacks-pass.log).

**T10-T1-03 — DISPOSABLE LIVE — PASS.** Real disposable truncated SQLite and unknown layout fail startup validation without replacement or migration over corruption. Production was never corrupted. Evidence: [script-attacks-pass.log](test-results/ma2-gate10/script-attacks-pass.log).

**T10-T1-04 — DISPOSABLE LIVE — PASS.** Consistent snapshot includes committed WAL rows. Main-only/stale valid SQLite copies lose one row while quick_check stays ok; the protected-row ledger detects that loss. SQLite alone cannot detect valid lost history. Evidence: [wal-partial-attack.json](test-results/ma2-gate10/wal-partial-attack.json), [script-attacks-pass.log](test-results/ma2-gate10/script-attacks-pass.log).

## T2 attacks

**T10-T2-01 — DISPOSABLE LIVE — PASS.** Real stand-in bytes are replaced with restored size/mtime; fresh native identity, hash and metadata probes refuse Mission spawn. Harmless metadata positive control succeeds. Junction/state-link coverage is separate T1 coverage; no real Codex replacement. Evidence: [t6/affected-retest-pass.log](test-results/ma2-gate10/t6/affected-retest-pass.log), [regression-final-full.log](test-results/ma2-gate10/regression-final-full.log).

**T10-T2-02 — DISPOSABLE LIVE — PASS.** Harmless codex-cli 99.0.0 and malformed/unknown versions fail Mission compatibility; direct legacy readiness is a separate policy and grants no Mission override. Evidence: [t6/affected-retest-pass.log](test-results/ma2-gate10/t6/affected-retest-pass.log).

**T10-T2-03 — DISPOSABLE LIVE — PASS.** Discovery-to-launch path and byte changes, including changes during metadata probing, are rejected before model spawn. Evidence: [t6/affected-retest-pass.log](test-results/ma2-gate10/t6/affected-retest-pass.log).

**T10-T2-04 — SIMULATED — PASS.** Routing fixtures recalculate eligibility on retarget/retry/replan. Composed live owned child plus Calculator grant refuses incompatible Codex retarget; no second child and no broadened desktop scope. Provider policy facts are simulated. Evidence: [restart-repair-focused-pass.log](test-results/ma2-gate10/restart-repair-focused-pass.log), [reroute-composition.log](test-results/ma2-gate10/reroute-composition.log), [stop-composition.json](test-results/ma2-gate10/stop-composition.json).

## T3 attacks

**T10-T3-01 — DISPOSABLE LIVE — PASS.** Real source-entry rejection/exception containment and injected callback failures classify safely, degrade or shut down within bounds; owned trees do not become uncontrolled zombies. Callback inputs are simulated. Evidence: [t6/affected-retest-pass.log](test-results/ma2-gate10/t6/affected-retest-pass.log), [script-attacks-pass.log](test-results/ma2-gate10/script-attacks-pass.log).

**T10-T3-02 — SIMULATED — PASS.** Cyclic/aggregate/accessor/truncation-boundary diagnostic fixtures serialize within bounds and redact credentials without recursive failure. Evidence: [t6/affected-retest-pass.log](test-results/ma2-gate10/t6/affected-retest-pass.log).

**T10-T3-03 — DISPOSABLE LIVE — PASS.** Real native provider exits/stream errors fail the owned session; local-task fixtures preserve unrelated work and Host health. Successful provider completion alone cannot publish verification. Evidence: [t6/affected-retest-pass.log](test-results/ma2-gate10/t6/affected-retest-pass.log), [composition-attacks.log](test-results/ma2-gate10/composition-attacks.log).

**T10-T3-04 — DISPOSABLE LIVE — PASS.** Exact installed v25 hard crash changes Host instance, interrupts work without GUI replay; actual Windows job and Git-hook hard termination closes descendants and preserves unrelated sentinels. Evidence: [restart-verified-v25.json](test-results/ma2-gate10/restart-verified-v25.json), [stage-v25-crash.json](test-results/ma2-gate10/stage-v25-crash.json), [composition-attacks.log](test-results/ma2-gate10/composition-attacks.log).

**T10-T3-05 — DISPOSABLE LIVE — PASS.** Canonical Host restart marks ambiguous work interrupted and waiting_for_user; run count is unchanged, pending decisions are invalidated, explicit retry must create fresh work. No blind external side-effect retry. Evidence: [restart-verified-v25.json](test-results/ma2-gate10/restart-verified-v25.json), [restart-repair-focused-pass.log](test-results/ma2-gate10/restart-repair-focused-pass.log).

## T4 attacks

**T10-T4-01 — SIMULATED — PASS.** Forged stale birth/executable/role claims against a real unrelated sentinel refuse. Kernel ownership refuses arbitrary PID authority. Actual OS PID reuse was not forced. Evidence: [v25-rollback-attacks.json](test-results/ma2-gate10/v25-rollback-attacks.json), [composition-attacks.log](test-results/ma2-gate10/composition-attacks.log).

**T10-T4-02 — DISPOSABLE LIVE — PASS.** Real unrelated node/Git jobs survive owned Stop/crash/rollback. Production worker/gateway remain alive. Native ownership is per job/held lifetime, never process name. Every requested name variant was not separately manufactured. Evidence: [composition-attacks.log](test-results/ma2-gate10/composition-attacks.log), [stop-composition.json](test-results/ma2-gate10/stop-composition.json), [production-native-final.json](test-results/ma2-gate10/production-native-final.json).

**T10-T4-03 — DISPOSABLE LIVE — PASS.** Actual Git-for-Windows cmd, bin and mingw64/bin launchers, hooks, helper descendants, detached attempts and explicit breakaway are controlled by Windows jobs. usr/bin form is not separately claimed. Evidence: [composition-attacks.log](test-results/ma2-gate10/composition-attacks.log).

**T10-T4-04 — DISPOSABLE LIVE — PASS.** Real slow Git hook descendants are killed by sole-job-handle closure on Host hard termination; no delayed commit occurs. Evidence: [composition-attacks.log](test-results/ma2-gate10/composition-attacks.log).

**T10-T4-05 — DISPOSABLE LIVE — PASS.** Independent Git jobs and unrelated sentinel remain alive when only the Bunny-owned job is stopped. Fixtures are deliberately unrelated, not the user actual Git work. Evidence: [composition-attacks.log](test-results/ma2-gate10/composition-attacks.log), [stop-composition.json](test-results/ma2-gate10/stop-composition.json).

## T5 attacks

**T10-T5-01 — SIMULATED — PASS.** Public presentation fixture projections omit/redact password, token, headers, cookies, pairing secrets and private arguments; raw canonical inputs are not renderer fields. Evidence: [composition-attacks.log](test-results/ma2-gate10/composition-attacks.log), [secret-audit/result.json](test-results/ma2-gate10/secret-audit/result.json).

**T10-T5-02 — SIMULATED — PASS.** Unknown actions, private reasoning, prompt/transcript/tool arguments cannot supply public activity labels or arbitrary command output. Evidence: [composition-attacks.log](test-results/ma2-gate10/composition-attacks.log).

**T10-T5-03 — SIMULATED — PASS.** Provider turn completion remains distinct from independent verification; failed verification is failed and unverified, not successful. Evidence: [composition-attacks.log](test-results/ma2-gate10/composition-attacks.log).

**T10-T5-04 — SIMULATED — PASS.** Terminal canonical state and ordered Host cursor reject stale planning/execution presentation. UI fixture revision guards are rerun; no production stale renderer injection. Evidence: [composition-attacks.log](test-results/ma2-gate10/composition-attacks.log), [regression-final-ui.log](test-results/ma2-gate10/regression-final-ui.log).

**T10-T5-05 — SIMULATED — PASS.** Duplicate/out-of-order journal sequence fixtures deduplicate public activity by canonical Host sequence. Evidence: [composition-attacks.log](test-results/ma2-gate10/composition-attacks.log).

## T6 attacks

**T10-T6-01 — LIVE VERIFIED — PASS.** Current actual HTTPS shell returns 200; valid Seroval server-function requests and protected-path probes are refused without sensitive partial state. Public POST refusal is Cloudflare/edge 403 and is not claimed to reach Host auth. Direct installed Host authentication has a paired positive control. Evidence: [public-denials-valid-wire.json](test-results/ma2-gate10/public-denials-valid-wire.json), [live-safe.json](test-results/ma2-gate10/live-safe.json).

**T10-T6-02 — LIVE VERIFIED — PASS.** Actual HTTPS forwarded-for, real-ip, Forwarded, localhost Host/Origin and Cloudflare-style spoof probes do not produce local authority or protected state. Edge refusal and Host auth are distinguished. Evidence: [public-denials-valid-wire.json](test-results/ma2-gate10/public-denials-valid-wire.json), [live-safe.json](test-results/ma2-gate10/live-safe.json).

**T10-T6-03 — LIVE VERIFIED — PASS.** Dedicated production test device pairs with 200 positive state, is revoked, then state/submit/Mission/approval/Stop/SSE/WS endpoints return 401. Original Phone is untouched. Exact v25 stage also proves revoke behavior. Evidence: [live-safe.json](test-results/ma2-gate10/live-safe.json), [installed-stream-retest-v25.json](test-results/ma2-gate10/installed-stream-retest-v25.json).

**T10-T6-04 — DISPOSABLE LIVE — PASS.** Original stale SSE delivered after revoke: HIGH. Per-delivery auth repair closes existing global/task streams and prevents future protected delivery; unrelated workstation/device streams survive. Exact installed v25 retest passes. Authenticated WebSocket support is not claimed. Evidence: [revoke-stream-probe.json](test-results/ma2-gate10/revoke-stream-probe.json), [revoke-stream-retest.json](test-results/ma2-gate10/revoke-stream-retest.json), [installed-stream-retest-v25.json](test-results/ma2-gate10/installed-stream-retest-v25.json), [t6/affected-retest-pass.log](test-results/ma2-gate10/t6/affected-retest-pass.log).

**T10-T6-05 — LIVE VERIFIED — PASS.** A revoked device may retain cached visuals but fresh protected reads/control are denied. Existing server-side bounded Host authority is not silently converted into device-wide future authority. Evidence: [live-safe.json](test-results/ma2-gate10/live-safe.json), [installed-stream-retest-v25.json](test-results/ma2-gate10/installed-stream-retest-v25.json).

**T10-T6-06 — SIMULATED — PASS.** Disposable supervisor fixtures kill/retry only their owned child with three bounded attempts and preserve Host semantics. Production cloudflared kill was not authorized/performed; separately observed live generation replacement is documented. Evidence: [script-attacks-pass.log](test-results/ma2-gate10/script-attacks-pass.log).

**T10-T6-07 — SIMULATED — PASS.** Gateway/origin fault breaks the public-failure streak without counting child failure; bounded retry and abort prevent storms. Exact installed disposable gateway reports Host fetch failure safely. Evidence: [script-attacks-pass.log](test-results/ma2-gate10/script-attacks-pass.log), [offline-gateway-v25-valid-wire.json](test-results/ma2-gate10/offline-gateway-v25-valid-wire.json).

**T10-T6-08 — LIVE SAFE — PASS.** Observed production child changes from 39680 to 25956 under unchanged worker 45724; remote file and Host canonical URL match the current worker. Dead-worker publication fixtures reject stale generations. Replacement cause is not established. Evidence: [production-native-final.json](test-results/ma2-gate10/production-native-final.json), [production-final.json](test-results/ma2-gate10/production-final.json), [public-denials-valid-wire.json](test-results/ma2-gate10/public-denials-valid-wire.json), [script-attacks-pass.log](test-results/ma2-gate10/script-attacks-pass.log).

## T7 attacks

**T10-T7-01 — LIVE VERIFIED — PASS.** Three production bootstrap competitors exit and reuse the original Host instance; no T10 production restart or new gateway/Island/worker. Evidence: [startup-competitors.json](test-results/ma2-gate10/startup-competitors.json).

**T10-T7-02 — LIVE SAFE — PASS.** Actual Startup folder, Run registry and scheduled-task inventory show the canonical installed shortcut; bytes/target/arguments are preserved. No automatic legacy cleanup. Evidence: [baseline/native-ledger.json](test-results/ma2-gate10/baseline/native-ledger.json), [production-native-final.json](test-results/ma2-gate10/production-native-final.json), [production-final.json](test-results/ma2-gate10/production-final.json).

**T10-T7-03 — DISPOSABLE LIVE — PASS.** Exact current launcher refuses a live older-release Host collision; the older instance survives refusal. No production foreign-service takeover. Evidence: [v25-rollback-attacks.json](test-results/ma2-gate10/v25-rollback-attacks.json).

**T10-T7-04 — DISPOSABLE LIVE — PASS.** Missing canonical database and invalid marker/layout refuse before initialization; no empty replacement DB. Evidence: [v25-rollback-attacks.json](test-results/ma2-gate10/v25-rollback-attacks.json), [script-attacks-pass.log](test-results/ma2-gate10/script-attacks-pass.log).

## T8 attacks

**T10-T8-01 — DISPOSABLE LIVE — PASS.** Tampered covered rollback file is detected by the exact v25 installed tooling and rejected before install mutation; positive healthy quiescent Host makes the target boundary reachable. Evidence: [v25-rollback-attacks.json](test-results/ma2-gate10/v25-rollback-attacks.json), [rollback-attacks-v25.log](test-results/ma2-gate10/rollback-attacks-v25.log).

**T10-T8-02 — DISPOSABLE LIVE — PASS.** Unregistered relative/random/latest/ZIP/repository/wrong-package selections refuse; only registered, manifest-pinned, covered-file-verified target is eligible. Evidence: [v25-rollback-attacks.json](test-results/ma2-gate10/v25-rollback-attacks.json).

**T10-T8-03 — SIMULATED — PASS.** Historical PID birth/executable/entry mismatches refuse against a real unrelated process; own final cleanup holds native handles and checks fresh CIM/lifetime. True kernel PID reuse not forced. Evidence: [v25-rollback-attacks.json](test-results/ma2-gate10/v25-rollback-attacks.json).

**T10-T8-04 — DISPOSABLE LIVE — PASS.** Code-only v25→accepted v21→v25 round trip preserves all 2617 historical/newer copied rows, including a new setting. State is not rolled back. Production is untouched. Evidence: [v25-rollback-attacks.json](test-results/ma2-gate10/v25-rollback-attacks.json).

**T10-T8-05 — DISPOSABLE LIVE — PASS.** Missing forward target and tampered covered target refuse without arbitrary fallback or DB destruction. Evidence: [v25-rollback-attacks.json](test-results/ma2-gate10/v25-rollback-attacks.json).

**T10-T8-06 — STATIC VERIFIED — PASS.** All six transition points are mapped to fresh runtime refusal or inspected control flow. Actual partial copy fails before install.json LAST; private shortcut bytes may be ahead and explicit manual recovery is required. Six live crash injections are not claimed; no autonomous journal/recovery was added. Evidence: [transition-boundaries.json](test-results/ma2-gate10/transition-boundaries.json), [v25-rollback-attacks.json](test-results/ma2-gate10/v25-rollback-attacks.json), [installed-active-rollback-v25.json](test-results/ma2-gate10/installed-active-rollback-v25.json).

## T9 attacks

**T10-T9-01 — SIMULATED — PASS.** Foreign Mission/Task and step identity cannot reuse another bounded grant even for the same app/user. Positive same-Mission grant succeeds. Evidence: [t6/affected-retest-pass.log](test-results/ma2-gate10/t6/affected-retest-pass.log), [restart-repair-focused-pass.log](test-results/ma2-gate10/restart-repair-focused-pass.log).

**T10-T9-02 — SIMULATED — PASS.** Changed operation/selectors/extra fields/foreign app/process/risk fail scope matching or request fresh approval without mutation. Evidence: [t6/affected-retest-pass.log](test-results/ma2-gate10/t6/affected-retest-pass.log).

**T10-T9-03 — SIMULATED — PASS.** Expired grant and expiration during asynchronous preflight admit nothing and require fresh approval. No clock change to production. Evidence: [restart-repair-focused-pass.log](test-results/ma2-gate10/restart-repair-focused-pass.log).

**T10-T9-04 — DISPOSABLE LIVE — PASS.** Exact installed budget 2 admits exactly 2 native target/read actions; the third asks again. Atomic admission guards are also tested with fixtures. Evidence: [native-matrix-v25.json](test-results/ma2-gate10/native-matrix-v25.json), [restart-repair-focused-pass.log](test-results/ma2-gate10/restart-repair-focused-pass.log).

**T10-T9-05 — DISPOSABLE LIVE — PASS.** Canonical Stop ends only the owned grant/work; no later run is admitted. Controlled asynchronous preflight race records canonical ordering; live native Stop isolation is verified. Evidence: [native-matrix-v25.json](test-results/ma2-gate10/native-matrix-v25.json), [restart-repair-focused-pass.log](test-results/ma2-gate10/restart-repair-focused-pass.log), [stop-composition.json](test-results/ma2-gate10/stop-composition.json).

**T10-T9-06 — DISPOSABLE LIVE — PASS.** Two staged Missions safely share one verified native target but have independent approval/Stop authority; stopping A preserves B. Evidence: [native-matrix-v25.json](test-results/ma2-gate10/native-matrix-v25.json), [restart-repair-focused-pass.log](test-results/ma2-gate10/restart-repair-focused-pass.log).

**T10-T9-07 — DISPOSABLE LIVE — PASS.** An active v25 batch is hard-crashed before expiry; boot epoch and recovery invalidate it, no ephemeral revival or automatic GUI replay. Evidence: [restart-verified-v25.json](test-results/ma2-gate10/restart-verified-v25.json), [stage-v25-crash.json](test-results/ma2-gate10/stage-v25-crash.json).

**T10-T9-08 — SIMULATED — PASS.** Password/sensitive-control fixture is not covered by ordinary text batch consent and cannot execute through it. No real secret typing. Evidence: [t6/affected-retest-pass.log](test-results/ma2-gate10/t6/affected-retest-pass.log).

**T10-T9-09 — SIMULATED — PASS.** Browser/shell/filesystem/foreign app actions are excluded from a Calculator grant; actual staged PowerShell plan asks separately and is never executed. Evidence: [t6/affected-retest-pass.log](test-results/ma2-gate10/t6/affected-retest-pass.log), [native-matrix-v25.json](test-results/ma2-gate10/native-matrix-v25.json).

## T9R attacks

**T10-T9R-01 — DISPOSABLE LIVE — PASS.** Repeated native acquisition, approval refresh and real postcondition retry reuse one target; earlier native focus/reconnect pass retained. Final forced focus was refused by Windows foreground policy, so later pass preserves safe identity/read and does not claim that subcase. No multiplication. Evidence: [native-matrix-v25.json](test-results/ma2-gate10/native-matrix-v25.json), [native-matrix-v24.json](test-results/ma2-gate10/native-matrix-v24.json), [native-matrix.json](test-results/ma2-gate10/native-matrix.json), [composition-attacks.log](test-results/ma2-gate10/composition-attacks.log), [calculator-launch-lineage.json](test-results/ma2-gate10/calculator-launch-lineage.json).

**T10-T9R-02 — DISPOSABLE LIVE — PASS.** Near-simultaneous staged acquire operations serialize and intentionally reuse one native Calculator target. Per-workflow records and grants remain separate. Evidence: [native-matrix-v25.json](test-results/ma2-gate10/native-matrix-v25.json), [composition-attacks.log](test-results/ma2-gate10/composition-attacks.log).

**T10-T9R-03 — SIMULATED — PASS.** Stale closed handle/PID/content lifetime fixtures produce one controlled replacement or guarded refusal. Later observed disappearance of the original native window causes exactly one recorded T10 acquisition; disappearance itself was not induced and its cause is unknown. Evidence: [composition-attacks.log](test-results/ma2-gate10/composition-attacks.log), [calculator-launch-lineage.json](test-results/ma2-gate10/calculator-launch-lineage.json).

**T10-T9R-04 — DISPOSABLE LIVE — PASS.** Original user window and arithmetic are preserved in earlier passes with no launch. Original lifetime does not survive the whole interrupted run; cause is not established. Later fresh identity is explicitly T10-owned, reused without further launch, and cleaned separately. Evidence: [native-matrix.json](test-results/ma2-gate10/native-matrix.json), [native-matrix-v24.json](test-results/ma2-gate10/native-matrix-v24.json), [native-matrix-v25.json](test-results/ma2-gate10/native-matrix-v25.json), [calculator-launch-lineage.json](test-results/ma2-gate10/calculator-launch-lineage.json).

**T10-T9R-05 — DISPOSABLE LIVE — PASS.** Launch lineage plus fresh CIM, trusted package, frame/content lifetimes and held native handles authorize closing only the T10-owned HWND. Content exits naturally; shared frame survives. Original handle is never targeted; final visible targets 0. Evidence: [calculator-owned-cleanup.json](test-results/ma2-gate10/calculator-owned-cleanup.json), [calculator-final.json](test-results/ma2-gate10/calculator-final.json), [script-attacks-pass.log](test-results/ma2-gate10/script-attacks-pass.log).

## Cross-gate attacks

**T10-XG-01 — DISPOSABLE LIVE — PASS.** Dedicated staged device can approve only Host-offered bounded native scope with TTL clamped to 120s; production paired auth positive/negative control is separate. No arbitrary client authority expansion. Evidence: [native-matrix-v25.json](test-results/ma2-gate10/native-matrix-v25.json), [live-safe.json](test-results/ma2-gate10/live-safe.json).

**T10-XG-02 — DISPOSABLE LIVE — PASS.** Revocation denies new device commands/streams immediately. An already admitted Host-owned bounded batch may finish its exact scope; later PowerShell needs fresh approval and is stopped. No retroactive batch-cancellation guarantee invented. Evidence: [native-matrix-v25.json](test-results/ma2-gate10/native-matrix-v25.json), [installed-stream-retest-v25.json](test-results/ma2-gate10/installed-stream-retest-v25.json).

**T10-XG-03 — SIMULATED — PASS.** Incompatible provider reroute during a live grant is refused; exact grant remains unchanged and no extra child launches. Harmless provider policy is simulated, native child and target are real. Evidence: [stop-composition.json](test-results/ma2-gate10/stop-composition.json), [reroute-composition.log](test-results/ma2-gate10/reroute-composition.log), [restart-repair-focused-pass.log](test-results/ma2-gate10/restart-repair-focused-pass.log).

**T10-XG-04 — DISPOSABLE LIVE — PASS.** Same disposable Mission has real desktop batch and owned Windows child; Stop ends batch, closes owned job and leaves unrelated sentinel alive, with no later GUI run. Evidence: [stop-composition.json](test-results/ma2-gate10/stop-composition.json), [native-matrix-v25.json](test-results/ma2-gate10/native-matrix-v25.json).

**T10-XG-05 — DISPOSABLE LIVE — PASS.** Exact installed hard crash during batch invalidates both answered grant and pending request; user retry/replan is required and run count does not advance. Evidence: [restart-verified-v25.json](test-results/ma2-gate10/restart-verified-v25.json), [stage-v25-crash.json](test-results/ma2-gate10/stage-v25-crash.json).

**T10-XG-06 — DISPOSABLE LIVE — PASS.** Original old acceptance controller missed paused Mission/live grant: HIGH. Canonical authenticated+readonly DB preflight now refuses all nonterminal work/live grants and Missions/Triggers ON before first write; exact installed v25 retest preserves Host and install bytes. Evidence: [rollback-active-original.json](test-results/ma2-gate10/rollback-active-original.json), [installed-active-rollback-v25.json](test-results/ma2-gate10/installed-active-rollback-v25.json), [rollback-preflight-focused-final.log](test-results/ma2-gate10/rollback-preflight-focused-final.log).

**T10-XG-07 — DISPOSABLE LIVE — PASS.** Disposable v25→v21→v25 code round trip and competitor reuse establish current release as canonical; older runtime cannot reclaim startup. Evidence: [v25-rollback-attacks.json](test-results/ma2-gate10/v25-rollback-attacks.json).

**T10-XG-08 — DISPOSABLE LIVE — PASS.** Actual installed disposable gateway can read healthy Host, then valid Seroval request reaches fetch and safely fails while Host is down. Production public-tunnel Host restart was not authorized and is NOT TESTED. Evidence: [offline-gateway-v25-valid-wire.json](test-results/ma2-gate10/offline-gateway-v25-valid-wire.json), [gateway-wire-positive.json](test-results/ma2-gate10/gateway-wire-positive.json).

**T10-XG-09 — DISPOSABLE LIVE — PASS.** Exact installed runtime source (same 4f977c8 in v24/v25), injected degraded Host: unauthenticated spoof 401, paired/local commands 503 and zero tasks. Public HTTPS degradation of production is NOT TESTED. Evidence: [degraded-boundary-v24.json](test-results/ma2-gate10/degraded-boundary-v24.json), [t6/affected-retest-pass.log](test-results/ma2-gate10/t6/affected-retest-pass.log).

**T10-XG-10 — SIMULATED — PASS.** Fixture failure secret at provider/desktop/gateway/rollback/tunnel safeError boundary is redacted; projected private inputs stay omitted. Whole evidence scanned for available actual credentials without emitting values. Evidence: [stop-composition.json](test-results/ma2-gate10/stop-composition.json), [composition-attacks.log](test-results/ma2-gate10/composition-attacks.log), [t6/affected-retest-pass.log](test-results/ma2-gate10/t6/affected-retest-pass.log), [secret-audit/result.json](test-results/ma2-gate10/secret-audit/result.json).

**T10-XG-11 — STATIC VERIFIED — PASS.** Canonical terminal state, cursor/sequence, instance epoch, authenticated fresh fetch and resolved permission rows dominate stale projections across Stop/restart/revoke. Rollback changes code, not state. A four-transition live renderer replay campaign is not claimed. Evidence: [source-boundaries.json](test-results/ma2-gate10/source-boundaries.json), [composition-attacks.log](test-results/ma2-gate10/composition-attacks.log), [restart-verified-v25.json](test-results/ma2-gate10/restart-verified-v25.json), [live-safe.json](test-results/ma2-gate10/live-safe.json).

**T10-XG-12 — STATIC VERIFIED — PASS.** Resolved approval ID replay refuses, repeated device revoke is idempotent. submit/Mission create intentionally create a fresh UUID each call: replay is non-idempotent and can create another task/draft; user approval gates execution. No nonexistent idempotency key guarantee. Evidence: [source-boundaries.json](test-results/ma2-gate10/source-boundaries.json), [t6/affected-retest-pass.log](test-results/ma2-gate10/t6/affected-retest-pass.log), [restart-repair-focused-pass.log](test-results/ma2-gate10/restart-repair-focused-pass.log).

**T10-XG-13 — DISPOSABLE LIVE — PASS.** Original unresolved approval could admit a harmless action after restart: HIGH. Recovery now resolves pending requests as deny/bunny-host-restart and clears one-time authority. Exact v25 refuses old IDs. Already resolved IDs refuse after denial/expiry/Stop/completion by the same resolvedAt/canonical-step gate; those latter replay variants are static/fixture coverage. Evidence: [pending-replay-original.json](test-results/ma2-gate10/pending-replay-original.json), [restart-verified-v25.json](test-results/ma2-gate10/restart-verified-v25.json), [restart-repair-focused-pass.log](test-results/ma2-gate10/restart-repair-focused-pass.log), [source-boundaries.json](test-results/ma2-gate10/source-boundaries.json).

**T10-XG-14 — LIVE VERIFIED — PASS.** Production Missions/Triggers remain OFF; both authenticated local and dedicated paired Mission create are refused 400. No hidden alternate creation path. Evidence: [live-safe.json](test-results/ma2-gate10/live-safe.json), [production-final.json](test-results/ma2-gate10/production-final.json).

## Findings

**T10-F01 / T10-T6-04 / HIGH.** Original actual HTTP SSE continued protected delivery after revoked state returned 401. Root cause: SSE authorized only when connected, not at each future write/drain/heartbeat. Status: RESOLVED IN v25 CANDIDATE: focused global/task/unrelated streams and installed v25 pass. Residual: Production v17 remains older; candidate repair is not promoted. Existing Host-owned batch revocation semantics are separate.

**T10-F02 / T10-XG-06 / HIGH.** Old T8 acceptance idle check returned idle with a paused Mission/live grant. Root cause: Historical controller filtered only running-like Mission states and did not actually inspect canonical DB grants. Status: RESOLVED IN v25 CANDIDATE: three focused guard tests plus exact installer active-state refusal and code roundtrip. Residual: Historical controller is retained for evidence and must not be used alone for promotion; production installer remains older.

**T10-F03 / T10-XG-13 / HIGH.** v22 restart invalidated batch, but allow_once on persisted unresolved old ID admitted harmless nonexistent-control action; no arithmetic side effect. Root cause: Recover swept active steps/batches but left unanswered pending request and one-time authorization fields authoritative. Status: RESOLVED IN v25 CANDIDATE: two new recovery regressions, 106 focused tests, installed active hard-crash no-replay/old-ID-refusal. Residual: Production Missions are OFF and candidate not promoted; fixture effect is bounded, original authority defect is still HIGH.

**T10-F04 / T10-T8-01 / LOW.** First full regression failed one of 254 script tests after adding the guard; application half never ran. Root cause: Old installer regression used fake SQLite/no reachable Host; it could not reach the expected target refusal or valid rollback with the new preflight. Status: RESOLVED: 7 installer tests and complete final 654 tests pass; no guard weakened. Residual: No added feature or arbitrary rollback fallback.

**T10-F05 / T10-XG-08 / NOTE.** Initial plain-JSON serverFn payload failed wire decoding; generic error was mistakenly treated as Host-down evidence. Root cause: Missing TanStack Seroval serialization/x-tsr-serverfn header prevented intended boundary. Status: CORRECTED: exact installed v25 gateway healthy read then Host-down fetch failure. Residual: Old output retained as harness false positive, never used as final Host-down proof.

**T10-F06 / T10-T9R-04 / NOTE.** Original user content/window disappeared across execution interruption; v25 initial comparison to that old identity failed. Root cause: Cause NOT ESTABLISHED; no T10 cleanup/name kill targeted original HWND. T10 lineage proves exactly one later controlled acquisition of a new target. Status: BOUNDED: initial/v24 original identity and arithmetic preservation; v25 fresh identity stable; owned content closes naturally and shared frame survives. Residual: Whole-run original-lifetime/value preservation NOT TESTED; disappearance is not assigned to Bunny or user without evidence.

**T10-F07 / T10-T6-08 / NOTE.** Original cloudflared PID absent at final check; original four app processes survived; current child 25956 belongs to unchanged worker 45724 and URL changed. Root cause: Child replacement observed under supervisor; replacement cause NOT ESTABLISHED. Initial final harness incorrectly required immutable operational remote publication. Status: CORRECTED: read-only final comparison passes with unchanged cloudflared bytes and authoritative current generation. Residual: No intentional production transport kill/restart performed; do not claim induced watchdog live recovery.

**T10-F08 / T10-T9R-01 / NOTE.** Final forced-focus subcase was refused by Windows foreground policy. Root cause: Windows focus restriction, not duplicate-target multiplication. Status: BOUNDED: final rapid/concurrent acquisition, budget/approval-refresh and real postcondition retry pass. Residual: Final v25 forced foreground subcase NOT TESTED; equivalent Computer source unchanged and fixture coverage retained.

**T10-F09 / T10-XG-05 / NOTE.** One early grant expired before crash; later v25 wrapper initially called the v24-only helper and refused before crashing. Root cause: TTL timing and helper-version selection errors in audit harness. Status: CORRECTED: active-before-v25, held native crash and final no-replay recovery pass. Residual: Expired-before-crash case is not active-grant proof.

**T10-F10 / T10-XG-10 / NOTE.** Several initial probes failed on wrong import/API/shape/path/encoding/assertion before intended boundary; failed run logs retained. Root cause: Audit assumptions: array provider shape, status field, empty adapter health fixture, wrong db API/regex, PowerShell path/marker quoting, module path or TLS environment. Status: CORRECTED: final safe task/revoke/public/native/degraded/rollback/focused results pass. Residual: Earlier harness failures are not product success evidence.

**T10-F11 / T10-XG-04 / NOTE.** First composed fixture consent already covered desktop so no new batch prompt appeared; failure cleanup saw transient EPERM/Node Windows assertion. Root cause: Test authorization positive control and Windows output/lifetime cleanup ordering. Status: CORRECTED: real child+native batch Stop/reroute, sentinel preservation and no final leaked process. Residual: Provider policy facts remain SIMULATED; no production mutation.

**T10-F12 / T10-XG-08 / NOTE.** Execution quota/reviewer capacity and later sandbox-refresh failure interrupted tool work; CUA kernel could not resume. Complex shell inline JS also had a PowerShell parse error before execution. Root cause: Environment/controller failure, inherited output pipes, PowerShell 5 module search inherited from PowerShell 7, unsafe complexity in inline quoting. Status: BOUNDED: final candidate smoke pass; all own native processes stopped; shared IAB process not killed. Residual: Temporary IAB tab close could not be explicitly confirmed via CUA; default temporary tab lifecycle ends with tool task. No standalone T10 browser exists. Tool exceptions are summarized here because not all platform failures produce local logs.

**T10-F13 / T10-XG-11 / NOTE.** First final comparison asserted immutable cloudflared child, then an assumed state.remote.url field threw TypeError/Node UV assertion. Root cause: Harness treated replaceable transport child as fixed identity and used wrong HostSnapshot shape; canonical field is remoteUrl. Status: CORRECTED: final protected-row/Phone/Startup/install/source comparison passes. Residual: Provider config and rollback content pre-fingerprints were not captured; byte comparisons of those paths remain NOT TESTED.

**T10-F14 / T10-XG-10 / NOTE.** A missing string concatenation quote caused a SyntaxError before report generation. Root cause: Documentation helper syntax mistake; no product or production action executed. Status: CORRECTED: report generation and final evidence audit must pass. Residual: No runtime defect; original parser output retained.

**T10-F15 / T10-XG-10 / NOTE.** Git whitespace check flagged native CRLF/trailing-space capture lines and an extra final report blank line. Staged byte equality already passed. Root cause: Intentional -text evidence capture preserves native output; style checks interpret raw CRLF as trailing whitespace. Status: CORRECTED: staged bytes and final diff --check must pass. Residual: No raw result was reformatted; historical hashes remain unchanged.

Original product HIGH: 3; repaired in final candidate: 3; unresolved candidate HIGH/BLOCKER: 0. The installer-test compatibility issue is LOW. Harness anomalies, the unexplained original Calculator disappearance and observed transport generation replacement remain NOTE, with bounds and originals retained. [failure-ledger.json](test-results/ma2-gate10/failure-ledger.json).

## Repairs

Only accepted invariants were repaired. `738f05b` rechecks existing SSE device authorization before protected delivery; adds three real-HTTP tests. `99ffbdd` adds canonical rollback quiescence guard to installed tooling; adds three script tests. `4f977c8` invalidates pending/one-time permissions at Host recovery; adds two Mission tests. The additional codex-cli 99.0.0 regression adds one application test. `2afee0e` preserves validation-first installer refusals and uses a real SQLite/authenticated HTTP regression fixture; tooling pin `599103c`. Baseline tests retained; **9 new tests (3 scripts, 6 application)**. No product feature, redesign, new service, event store, updater or autonomous rollback. v22/v24 intermediate identities/original failures are retained; v25 is the final immutable candidate.

## Retests

Affected provider/containment/auth/desktop suite: 113 pass. Restart/Mission/desktop suite: 106 pass. Canonical rollback guard: 3 pass. Installer compatibility: 7 pass. State/tunnel/cleanup scripts: 46 pass. Native ownership/Git/presentation/target fixtures: 66 pass. Installed v25 final native matrix, active-grant rollback refusal, actual hard crash/recovery, SSE revoke and code-only rollback roundtrip pass. No failed original was removed. [regression-final.json](test-results/ma2-gate10/regression-final.json).

## Secret leakage audit

Fingerprint-only search of all T10 evidence, report sources and T10 browser artifacts checks available current Host tokens, provider auth values and secret-bearing environment values without emitting them. Private backups stay outside Git; DB row ledgers are digests, credentials/tokens are absent from stored live output. Safe failure fixtures cover provider, desktop, gateway, rollback and tunnel projections; typed input never enters public run/request/event/batch fields. Explicit safe input strings in source are test inputs, not output leaks. Historical revoked raw device tokens were not retained and cannot be reconstructed from canonical hashes; this limit is recorded. Final results and scanned-file count are in [secret-audit/result.json](test-results/ma2-gate10/secret-audit/result.json).

## Production preservation

Final read-only comparison verifies 2621 protected historical row digests unchanged, original devices including Phone unchanged, all new T10 production devices revoked, Missions/Triggers OFF, same release/Host/Startup/config/credentials/state marker/deployment/consent/cloudflared bytes and validated Codex. Volatile provider-observation/workspace-lock tables are explicitly excluded from protected-row digests. Operational remote URL/hash changed with observed transport child generation and is checked against actual Host/worker state. Provider config pre-fingerprints and rollback-material content pre-fingerprints were not captured; they are NOT TESTED, rather than claiming byte equality. [production-final.json](test-results/ma2-gate10/production-final.json).

## Process cleanup

Own staged v25 Host and QA gateway stopped using fresh credential/health instance, exact executable+entry, fresh CIM creation time and held native handles. Roundtrip Hosts/sentinels cleaned; native jobs drain their own children. Final inventory: zero own native/controller/fixture candidates and zero listeners on 45129/45149/8088. Zero visible Calculator targets; one T10-owned window closed through exact native WindowPattern, content exited naturally, shared Windows frame survived. Original user HWND was never targeted. No name kills, no stale saved-PID kill. Browser smoke closes page/context/browser in finally. Temporary IAB tab explicit close was unavailable after controller failure; default temporary lifecycle ends with the tool task, with no separate T10 browser process and no running QA authority. Shared browser/Codex processes and pre-existing developer services were not stopped. [cleanup-native-inventory.json](test-results/ma2-gate10/cleanup-native-inventory.json), [stage-v25-cleanup.json](test-results/ma2-gate10/stage-v25-cleanup.json), [ui-v25-gateway-cleanup.json](test-results/ma2-gate10/ui-v25-gateway-cleanup.json), [calculator-owned-cleanup.json](test-results/ma2-gate10/calculator-owned-cleanup.json).

## Data preservation

No destructive production attack. Consistent production backup preceded attacks. All protected historical rows/Phone remain intact; only safe T10 task/history/telemetry and revoked test device rows were appended. A disposable code rollback retains 2617 newer/historical copied rows. WAL main-only and stale copies can remain valid SQLite while missing history; external row-ledger comparison, not quick_check alone, detects it. [wal-partial-attack.json](test-results/ma2-gate10/wal-partial-attack.json), [v25-rollback-attacks.json](test-results/ma2-gate10/v25-rollback-attacks.json).

## Provider compatibility

Current live Codex 0.153.4 is VALIDATED, exact native SHA `444a3f0008050605cae73cd9b7a2dcac61294062dfaab56dd20430fd6498518b`, size 295408944. Production harmless Task completes with expected text and no tool side effects. Stand-in 99.0.0/substitution/path race, stale profile/manual override/retarget cannot authorize a Mission child. Direct legacy task readiness has its documented separate policy. [live-safe.json](test-results/ma2-gate10/live-safe.json); final compatibility in [production-final.json](test-results/ma2-gate10/production-final.json).

## Remote security

Current actual HTTPS unpaired/spoof probes deny; public POST edge 403 is distinguished from Host-level authenticated 200/401 controls. Dedicated test device revoke loses fresh state/control/SSE reconnect immediately. Fixed candidate ends already-authenticated SSE future delivery while preserving unrelated streams. A cached page is not authority. A pre-existing Host-owned bounded batch may continue its exact scope after approving device revocation; the device cannot acquire fresh authority. Production Phone never used for revoke. Transport generation changes are observed, not an induced-production recovery claim.

## Desktop approval integrity

Batch identity binds Mission/step/exact operation/window/process/content/risk/epoch/count/TTL. Simulator tests exercise sensitive input, mutation/escape, expiry and async Stop boundaries; actual installed native workflow exercises budget, concurrent isolated grants, postcondition retry, remote TTL clamp/revoke and Stop. Exact v25 restart invalidates grants and pending/one-time decisions without GUI replay. No shell/browser/filesystem authority is inherited from Calculator consent.

## Target lifecycle integrity

Repeated/concurrent acquire intentionally reuses one verified target; failed uncertain launch cannot storm. Original pre-existing target was preserved in initial/v24 native passes. It disappeared across the interruption, cause NOT ESTABLISHED. A fresh recorded single acquisition created HWND 15991686/content PID 18744, reused by final v25 matrix, and closed with explicit launch provenance/fresh lifetimes/package/content validation. No new acquisitions multiply windows. Do not upgrade earlier original-window preservation to a whole-run guarantee. [calculator-launch-lineage.json](test-results/ma2-gate10/calculator-launch-lineage.json).

## Rollback integrity

Read-only pinned target/legacy/manifest/covered-file/shortcut validation precedes canonical authenticated+SQLite quiescence preflight, which occurs immediately before first installer mutation. All pending/nonterminal work/live batches and enabled Missions/Triggers refuse. Private v25→v21→v25 retains user rows, current startup wins, missing/tampered target refuses. install.json LAST is the inspected commit point; actual partial copy may put a private shortcut ahead and requires explicit recovery. No automatic rollback or six-point live crash claim. Old T8 acceptance idleCheck is retained for history and cannot be the sole promotion guard. [transition-boundaries.json](test-results/ma2-gate10/transition-boundaries.json).

## Startup integrity

Canonical production Startup shortcut `C:\Users\allam\AppData\Local\Bunny-A\Bunny-A.exe`, empty arguments, SHA `a7a3e9425019854797fc48477ec24885e517e0d0c8735989502d37f2ae776d0c` unchanged. Run registry/scheduled tasks inventoried without mutations. Three real installed competitors reuse current Host. Wrong-release/missing-DB disposable starts fail closed. Actual reboot is NOT TESTED.

## LIVE VERIFIED

Actual installed production identity/state/provider/safe Task, three startup competitors, current public HTTPS denial/spoof checks, dedicated paired-device revoke/disabled-Mission refusal and final production preservation. Production is v17. Exact installed v25 native desktop/Stop/duplicate-target/rollback/SSE/dashboard/hard-crash checks are real machine operations but explicitly DISPOSABLE LIVE. No mock-only pass.

## DISPOSABLE LIVE

Exact staged committed v25 Host/gateway/package and private state; actual native Calculator reuse/read/concurrency/budget/Stop/revoke, actual hard crash/no-replay recovery, installed SSE revoke, rollback active-state guard/tamper/code roundtrip, Windows owned jobs/Git hooks and SQLite/WAL/path/corruption fixtures. Public projection/provider-policy fixtures inside these are separately marked SIMULATED where applicable.

## SIMULATED

Harmless provider-policy/metadata facts, presentation secrecy/stale/duplicate event fixtures, desktop scope/sensitive/expiry races, controlled stale target/content identities, watchdog network/child-origin fault sequences and forged stale PID claims. Real kernel jobs/native processes/SQLite execution are identified per case; simulated policy does not become production proof.

## STATIC VERIFIED

Committed source and installed coverage/asset/manifest/ZIP hashes; approval resolvedAt/canonical-step replay guards, non-idempotent submit/create semantics, cursor/revision/epoch state precedence, six rollback boundary mapping and evidence/secret hash verification. This classification does not assert live execution of inspected control flow.

## NOT TESTED

- Physical Android app: NOT TESTED; desktop/mobile browser render is not native Android evidence.
- Actual reboot and Windows sign-out/sign-in: NOT TESTED in T10; prior T7 acceptance is historical.
- Intentional production Host/gateway/tunnel restart, hard crash, active-work Stop, release activation and install mutation: NOT TESTED / DEFERRED because §6 separately explicit authorization was absent.
- Production live cloudflared kill/recovery: NOT TESTED. Disposable supervisor policy is SIMULATED; actual uninduced child replacement is only observed.
- Actual forced OS PID reuse: NOT TESTED. Stale lifetime/executable/role claims against a real sentinel are SIMULATED; real native ownership/job tests ran.
- Real provider binary/junction substitution: NOT TESTED. Harmless registered stand-ins undergo actual byte/path/hash races; production Codex was not modified.
- Every named process collision and every Git launcher spelling: not separately manufactured; actual cmd/bin/mingw64 launchers, helpers/hooks, isolated jobs and production process preservation were checked.
- Final v25 forced foreground subcase: NOT TESTED after Windows focus refusal. Earlier actual native focus/reconnect pass and unchanged Computer source plus final safe native read/reuse are retained.
- Original pre-existing Calculator whole-run lifetime/arithmetic preservation: NOT ESTABLISHED across the interruption. Earlier passes preserve it; no T10 cleanup targeted it. Later target is one explicitly recorded T10 launch, now closed.
- A live four-transition stale renderer replay campaign and all six timed rollback crash points: NOT TESTED. Canonical guards/commit points are STATIC VERIFIED with actual bounded refusal/partial-copy examples.
- Authenticated WebSocket streaming is not claimed as supported; attempted reconnect endpoints deny revoked/unpaired clients. Global/task SSE revocation is actually tested.
- Real provider config byte preservation and rollback-material content equality: NOT TESTED because T10 baseline did not fingerprint those content paths. Final safe fingerprints/paths and no audit mutators are recorded, not substituted for before/after proof.
- Public HTTPS POST probes: actual valid wire payloads receive edge 403; no claim that these requests reached Host auth. Paired/unpaired/revoked direct installed Host positive and negative controls independently reach authentication.
- Production cloudflared replacement cause: NOT ESTABLISHED; original four native process lifetimes are unchanged, current child parent and transport record match worker 45724, Host and current remote file agree.
- Production v17 retains older implementation/tooling. T10 PASS applies only to the sealed staged v25 candidate; three HIGH repairs must be reviewed/promoted before that candidate is treated as production.

## BLOCKED

No primary matrix attack is BLOCKED. CUA explicit temporary-tab close/reload was blocked by environment kernel/sandbox failure; no native UI/browser-driver workaround or shared-process termination was attempted. Reviewed shell scripts completed unaffected work; no unresolved safety-approval rejection remains. The temporary-tab lifecycle limitation is recorded in cleanup and independent-review packet.

## DEFERRED

Separately authorize production disruption/promotion only after a fresh independent review of the final candidate and current activation procedure. Do not infer T10 authorization for production Host/gateway/tunnel/release/Windows session changes. No independent review was begun. Candidate HIGH repairs remain absent from production v17.

## Final regression

**654 = 254 scripts + 363 application + 37 UI; zero failures, skips or cancellations.** Complete tests after the last harmless path probe and all runtime repairs/attacks. Baseline 645 retained; 9 new regressions. Typecheck 0, lint 0 errors (11 pre-existing warnings), normal build 0, exact committed Windows v25 build/package 0. Candidate installed integrity 160 covered files; module closure/source coverage pass. Final built dashboard desktop 1280×800 and mobile 390×844 visually inspected: visible content, no overflow, no browser/page errors. Asset hashes match package. Existing utility-dashboard share-card placeholder is a brand NOTE, not new redesign work. [regression-final.json](test-results/ma2-gate10/regression-final.json), [browser-smoke-v25.log](test-results/ma2-gate10/browser-smoke-v25.log).

## Evidence index

[SHA-256 evidence index](test-results/ma2-gate10/evidence/index.json) seals every T10 artifact including originals, scripts, reports and all T10 screenshots. Each has path, bytes, SHA-256, classification, timestamp and stable attack association. Index does not include its own bytes or private raw DB backups. Historical T9/T9R indexed artifacts and sealed documents retain every original hash; shared current root documents are superseded by T10, not required to remain byte-equal to old sealed copies. [historical-pre-doc-update.log](test-results/ma2-gate10/historical-pre-doc-update.log).

## Remaining limitations

- Physical Android app: NOT TESTED; desktop/mobile browser render is not native Android evidence.
- Actual reboot and Windows sign-out/sign-in: NOT TESTED in T10; prior T7 acceptance is historical.
- Intentional production Host/gateway/tunnel restart, hard crash, active-work Stop, release activation and install mutation: NOT TESTED / DEFERRED because §6 separately explicit authorization was absent.
- Production live cloudflared kill/recovery: NOT TESTED. Disposable supervisor policy is SIMULATED; actual uninduced child replacement is only observed.
- Actual forced OS PID reuse: NOT TESTED. Stale lifetime/executable/role claims against a real sentinel are SIMULATED; real native ownership/job tests ran.
- Real provider binary/junction substitution: NOT TESTED. Harmless registered stand-ins undergo actual byte/path/hash races; production Codex was not modified.
- Every named process collision and every Git launcher spelling: not separately manufactured; actual cmd/bin/mingw64 launchers, helpers/hooks, isolated jobs and production process preservation were checked.
- Final v25 forced foreground subcase: NOT TESTED after Windows focus refusal. Earlier actual native focus/reconnect pass and unchanged Computer source plus final safe native read/reuse are retained.
- Original pre-existing Calculator whole-run lifetime/arithmetic preservation: NOT ESTABLISHED across the interruption. Earlier passes preserve it; no T10 cleanup targeted it. Later target is one explicitly recorded T10 launch, now closed.
- A live four-transition stale renderer replay campaign and all six timed rollback crash points: NOT TESTED. Canonical guards/commit points are STATIC VERIFIED with actual bounded refusal/partial-copy examples.
- Authenticated WebSocket streaming is not claimed as supported; attempted reconnect endpoints deny revoked/unpaired clients. Global/task SSE revocation is actually tested.
- Real provider config byte preservation and rollback-material content equality: NOT TESTED because T10 baseline did not fingerprint those content paths. Final safe fingerprints/paths and no audit mutators are recorded, not substituted for before/after proof.
- Temporary IAB tab explicit close: BLOCKED by sandbox/controller kernel failure. The default temporary tab lifecycle ends with the tool task; no standalone T10 browser process exists. Smoke contexts close in finally and the owned QA gateway is stopped. Shared Codex/IAB processes are preserved.
- Public HTTPS POST probes: actual valid wire payloads receive edge 403; no claim that these requests reached Host auth. Paired/unpaired/revoked direct installed Host positive and negative controls independently reach authentication.
- Production cloudflared replacement cause: NOT ESTABLISHED; original four native process lifetimes are unchanged, current child parent and transport record match worker 45724, Host and current remote file agree.
- Production v17 retains older implementation/tooling. T10 PASS applies only to the sealed staged v25 candidate; three HIGH repairs must be reviewed/promoted before that candidate is treated as production.

## Final verdict

**BUNNY_MA2_T10_PASS** — implementation-side **MIXED** audit of the exact staged v25 candidate. All 69 primary cases have classified executed evidence and final PASS; three HIGH defects are repaired in that candidate, full regression passes, protected production state/Phone remain preserved and no unexplained T10-owned process remains. This does not certify unchanged production v17 and is not an operational approval. A different reviewer must conduct the fresh final independent review/promotion audit using this sealed packet; none was started here.
