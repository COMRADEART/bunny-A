# T6 FAILURE LEDGER (M-A-2 Gate T6R — produced before any repair)

Scope: the actual T6 failure as recorded in `MA2_T6_REMOTE_ACCEPTANCE.md`,
`MA2_ACCEPTANCE_MATRIX.md §M-A-2 Gate T6`, `MA2_INDEPENDENT_REVIEW_PACKET.md`,
`MA2_IMPLEMENTATION_REPORT.md §M-A-2 Gate T6`, and evidence under
`test-results/ma2-gate6/`. Nothing in this ledger is inferred from a prompt.

Severity gate rule: only BLOCKER/HIGH block T6R closure (task §0).

| Finding | Severity | Real/Simulated | Evidence | Root Cause | Repair Needed |
|---|---|---|---|---|---|
| F1. Sustained public transport unavailable: repeated real Cloudflare HTTP 530 / Error 1033 across BOTH quick hostnames, over ~40 minutes (03:12Z–03:48Z), including a real browser reload; phone and acceptance client both affected | **BLOCKER** | LIVE VERIFIED (real requests, real browser 1033 render) | `tunnel-live-diagnostic.json` (ha_connections 1, 7 register / 6 unregister cycles in ~10 min while child lived), `tunnel-intermittent-error.json`, `revocation.log`, `stale-session.json`, `screenshots/cloudflare-1033.png` | Cloudflare edge registration churn on this network: archived tunnel log (`state/logs/archive/20261004-223629-2a7f7581-tunnel.log`, machine-generated, pre-T6) shows `Lost connection with the edge` / `connection with edge closed` / DNS i/o timeout to `region1.v2.argotunnel.com` / `Unauthorized: Tunnel not found` during re-register. A quick tunnel publishes 2×A+2×AAAA edge addresses; with only 1 of 4 HA connections registered, DNS round-robin sends a share of eyeball requests to unrouted edges → intermittent 530/1033 | T6R task §16/§28: repair the transport path inside the installed tunnel worker only — sustained-degradation watchdog (child alive but under-registered) with exact-identity child restart (the already-documented manual recovery, automated and bounded), truthful degraded Remote status, and a live protocol A/B probe to decide whether the forced `--protocol http2` is contributing. No auth change |
| F2. Stale `settings/remote.json` in installed state after the T6 worker was terminated externally at session teardown: dead hostname `martin-lovely-myself-tomatoes.trycloudflare.com`, tunnelPid 8420 (process gone); paired `unavailable()` cleanup did not run on hard kill | **HIGH** | LIVE VERIFIED (file inspected 2026-10-05, worker absent from live process table) | `state/settings/remote.json` (tunnelPid 8420 absent from `Get-CimInstance` live list), `tunnel-restart.json` (publish path), `scripts/bunny-tunnel.mjs` `unavailable()` (unlink only on supervisor-delivered exit) | Worker was killed without its process handlers running, so the state publication of a now-dead hostname survives with `enabled` still configured | T6R task §10/§43: at worker startup and in the watchdog, reconcile recorded `tunnelPid` against the live process and publish truthful Remote availability (no Host restart); Host `remote.configure` remains the single authority |
| F3. Public stale-session/revocation acceptance incomplete (blocked by F1, not by auth) | **HIGH** | LIVE VERIFIED (canonical) + BLOCKED (public) | `revocation.json`, `stale-session.json` (canonical Host 401 after revoke, no restart, `authorityRemovedImmediately` null), `revocation.log` (assertion failed: transport, not auth) | F1 only: the auth boundary never misbehaved; public checks could not complete | Re-run public revocation/stale-session/reconnect sequence (T6R §22 K–M) under sustained transport; add bounded, honest enforcement-latency measurement (single measurement, no retry-overwrite) |
| F4. Physical Android installation, pairing and traffic NOT TESTED | **HIGH** | NOT TESTED | `acceptance-index.json` blockers, `MA2_T6_REMOTE_ACCEPTANCE.md §NOT TESTED`, `phone-invitation.json`, `android-installation.json` | User reported external-Wi-Fi Android but installation/pairing confirmation never supplied; no phone record | T6R §20/§21: request phone test with a fresh one-time code at the then-valid hostname; record client type/network/TLS/DNS/timestamps. If unavailable, mark NOT TESTED and use an independent external network/client; emulator/local-browser does not count |
| F5. Supervisor only reacts to child EXIT (3 bounded attempts); a live-but-degraded child (unregistered/flapping) never triggers repair or a visible degraded state | **HIGH** | LIVE VERIFIED (behavioral gap demonstrated in T6: child 26404 lived while transport was down 03:28–03:48) | `scripts/bunny-tunnel-worker.mjs` (exit-only supervision), `tunnel-live-diagnostic.json` (child alive, ha_connections 1, request_errors 1), `BUNNY_REMOTE.md §Temporary tunnel recovery` (manual procedure documented) | Design gap acknowledged in M2 report and remote doc, exercised in T6 | Same repair as F1 (one mechanism): watchdog with identity-checked bounded child restart + degraded-state observability + regression tests (T6R §32/§38) |
| F6. Revocation enforcement latency unmeasured: acceptance-harness retried over the original revocation timestamp, so immediate-latency evidence was discarded | **MEDIUM** | LIVE VERIFIED (canonical 401 proven) / harness measurement defect | `revocation.json` `timingCorrection` field, `revocation.log` | Acceptance-harness measurement design, not a Host defect | Fix the measurement (one clean timed sample per stage) in the T6R harness; no runtime change |
| F7. Live pairing-abuse limiter under public transport not exercised (left to static/regression coverage) | **MEDIUM** | NOT TESTED (live) / STATIC VERIFIED (limiter) | `pairing-abuse.json`, `MA2_T6_REMOTE_ACCEPTANCE.md §STATIC VERIFIED` | F1 blocked the live window; deliberate non-consumption on the unpaired phone | Re-run under sustained transport (bounded: well under the 5/10-min per-client limit) |
| F8. Final Mission render + repeated-task phone checks blocked mid-sequence | **MEDIUM** | LIVE (blocked by transport) | `phone-render.json`, `remote-mission-render.json`, F1 evidence | F1 | Complete during R-sequence G with sustained transport |
| F9. `unpaired-auth-boundary.json` shows expected 403/404 safe behavior; `public-denial-followup.json` shows correct pairing denial text; `sse-reconnect.json` confirms no public SSE surface (snapshot polling by design) and cursor-consistent reconnect | NOTE | LIVE VERIFIED (passing evidence, listed for completeness) | cited files | None — passing | None (no repair); re-verify over the R-sequence |
| F10. Old M3-era repo-script tunnel worker (PID 27924, targeting 8085) and its cloudflared were left failing `Unauthorized: Tunnel not found` since 2026-10-02; currently NOT running; its log was archived at the 10-04 release launch | NOTE | LIVE VERIFIED (process absent; log read) | `state/logs/archive/20261004-223629-2a7f7581-tunnel.log`, `MA1D_DEPLOYMENT_HARDENING_REPORT.md:225,285`, live process check 2026-10-05 | Legacy dev-tree worker predating the installed release; superseded | None — already archived; no live duplicate exists (verified). Keep identity-checked launch discipline |
| F11. Both T6 quick hostnames are dead (expected ephemeral identity); `state/settings/remote.json` still naming one is the F2 residue | NOTE | LIVE VERIFIED | F2 evidence, Cloudflare quick-tunnel docs | §17 expected behavior | Persist only operational metadata (already true); no permanent identity claimed |
| F12. Quick tunnels do not support SSE; phone/dashboard uses authenticated snapshot polling with cursor resync | NOTE | STATIC VERIFIED + LIVE (polling) | `sse-reconnect.json`, acceptance doc | Cloudflare platform property | None — existing design already correct; keep as T6/phone contract |
| F13. T6 worker was session-spawned (parent 24544), not the launcher/logon chain — acceptable for acceptance-only T6, but the logon-path start remains untested in a real sign-in (that is T7, out of scope) | NOTE | LIVE VERIFIED (provenance) | `tunnel-start.json` process list | T6 contract choice | None in T6R; T7 owns logon/startup acceptance |

## What did NOT fail (explicitly, so T6R does not repair healthy systems)

- Unpaired/anonymous denial (403/404, no state, no tokens) — `unpaired-denial.json`, `public-endpoint.json`, `header-security.json`, `public-denial-followup.json`.
- Pairing with bounded one-time code, HttpOnly+Secure+SameSite=Strict cookie, revocable device — `pairing.json`.
- Paired authorized state, canonical cursors/reconnect — `paired-state.json`, `network-loss.json`, `sse-reconnect.json`.
- Remote Task (incl. honest cold-model stop at the 90 s bound), remote approval in real mobile UI, deterministic Git Mission, remote Stop isolation — `remote-task*.json`, `remote-approval.json`, `remote-mission.json`, `remote-stop*.json`.
- Tunnel-child kill containment: only the owned child died; Host/gateway/Island identities unchanged; supervisor restarted child with new hostname — `tunnel-failure.json`, `tunnel-restart.json`.
- Token-leak audit of public HTML/assets/APK — `token-leak-audit.json`.
- T1–T5 preservation, 585/585, builds — `production-preservation.json`, `regression-results.json`, build logs.
- Forwarded-header trust resistance — `header-security.json` (re-proved in T6R §40).

## Repair decision under §28/§29 (minimum repair principle)

F1/F2/F5 are the only source/tooling-bearing findings, concentrated in one
owned surface: `scripts/bunny-tunnel*.mjs` (the installed release's tunnel
worker) — a transport-path repair explicitly permitted by task §28. F3, F4,
F6, F7, F8 are acceptance-procedure work with no runtime change. If the live
T6R re-run substantiates F1 from the environment alone (e.g. transport sustains
without any change on this attempt), §29 allows closure as acceptance evidence
against T5 without manufacturing v17-T6; the findings and the live A/B probe
result decide. No test is weakened, skipped, or re-classified (§1).

## F1 root-cause refinement — live protocol A/B probe (2026-10-06T02:36:36Z–02:51:50Z)

Two disposable 15-minute quick tunnels from the *same* network that failed T6,
same installed `cloudflared.exe` version 2026.9.3 (SHA-256
`f096265ec2fcbe9bb6e2d64268db167ced3fcbb83d894bdb9e2fcdb26f2ea7e2`, the T6-pinned
tool identity), dummy loopback
origin on `127.0.0.1:18081`, one forced `--protocol http2`, one `--protocol
quic`, metrics on loopback, one real public GET every 10 s with origin-hit
labeling. Harness: `test-results/ma2-gate6r/probe/protocol-ab.mjs`;
`summary.json` + `samples.jsonl` + `proto-http2.log` / `proto-quic.log` are the
evidence (run by this session, LIVE VERIFIED).

| Metric over 90 iterations × ~10 s | http2 tunnel | quic tunnel |
|---|---|---|
| Public GETs returning 200 | **90/90 (100%)** | **90/90 (100%)** |
| Worst consecutive public failures | 0 | 0 |
| Origin-delivered requests | 90 | 90 |
| `cloudflared_tunnel_ha_connections` | constant **1** (min=max=1) | constant **1** (min=max=1) |
| Edge events (15 min) | 1 register, 0 unregister, 0 error, 0 edge-lost | 1 register, 0 unregister, 0 error, 0 edge-lost |
| Child exit | none | none |

Consequences for the ledger:

1. **`ha_connections 1` is this network's normal steady state**, not a fault:
   both tunnels sustained exactly one registered edge connection for 15 minutes
   at 100% public success. T6's earlier "only 1 of 4 HA connections registered"
   reading is therefore **partially wrong** — a single registered connection
   normally serves this network completely.
2. **The T6 BLOCKER was the churn itself**, not the connection count: 7
   register / 6 unregister events in ~10 minutes with server-side
   `Unauthorized: Tunnel not found` invalidation windows (the archived log),
   leaving intermittent 530/1033 while the child stayed alive.
3. **Protocol stays `--protocol http2`** (minimum repair §28): http2 and quic
   were statistically identical across the probe; the archived log shows
   cloudflared's own precheck preferring http2 on this network. No change.
4. The exit-only supervisor (F5) is confirmed as the only component that could
   have short-circuited this failure: neither protocol, nor the origin, nor the
   auth boundary exhibited the defect under a stable edge registration; the
   instability is an external failure episode whose *repair* belongs in the
   supervisor — which is exactly the bound of T6R §28.