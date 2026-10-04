# Bunny-A M-A-2 operational security

## T1 controls

The installed launcher checks the manifest hash against `install.json`.
It checks the complete installed file inventory.
It checks the shared state helper before it executes that helper.
Missing, changed or unexpected release files cause refusal.

The launcher refuses an existing Host with a different runtime path.
It does not kill that Host.
State cannot use a directory link or a critical file link.
The Host refuses a missing database, damaged database or unknown schema.

Cloudflared has a recorded binary hash.
Both launcher and worker check the client.
The migration preserves local credentials and paired-device records.
The reports contain row fingerprints and file hashes. They do not contain bearer tokens.

Mission and capability authority checks stay unchanged.
Missions and triggers must retain their pre-migration flags.

The live migration preserved the Host token and all nine paired-device records.
Unpaired state access returned HTTP 401.
Missions and triggers stayed OFF.
The final state tree had no links to the repository.
The installed manifest matched its configuration hash and all 140 file hashes.
No new public tunnel or provider task started during T1 acceptance.

## Open gates

T3 must add fatal-error containment.
T4 must complete Windows Git process ownership.
T9 must define bounded desktop approval policy.
T10 must test the completed operational architecture.
This T1 change does not certify those gates.

# M-A-2 Gate T3

## IMPLEMENTED

Explicit failure taxonomy, owned local async boundaries, installed process containment, scoped
operational health and work refusal, bounded safe diagnostics, atomic state/event persistence,
single terminal outcomes, owned process shutdown and truthful restart reconciliation are implemented.
Read `MA2_T3_FAILURE_CONTAINMENT.md` for the complete policy and local ownership audit.
The legacy repo credential writer chain is identified and retired; T1 state layout 2 remains authoritative.
T2 Codex compatibility remains policy 1. T4–T10 remain open.

## LIVE VERIFIED

Native Codex 0.153.4 still passes the actual implemented gate, without a model session or user-config
change. Real source-entry subprocesses contain an unknown rejection and uncaught exception and exit 70.
Desktop/mobile source UI checks and the operational-warning interaction passed.
Installed-candidate and production-update evidence will be recorded after packaging and acceptance.

## SIMULATED

Controlled injections exercise scheduler/session/capability/browser/computer exceptions, provider
stream and normalization failures, persistence rollback/fallback, HTTP/SSE/timer failures,
Stop/completion races, scoped degradation and bounded cleanup. Harmless native worker processes
exercise the tunnel supervisor. These are disposable fixtures, not live model/provider Missions.

## STATIC VERIFIED

The async ownership audit covers all requested T3 surfaces. Auth, grants, path checks and T2 gating
remain in force. Unknown globals are conservative fatal; no broad executable-name kill or fatal
retry exists. Installed launcher startup has one launch attempt and a bounded readiness check.
The initial 517-check regression and normal build passed; final gates are recorded in the evidence handoff.

## NOT TESTED

Production fatal fault injection, real public tunnel activation, arbitrary provider versions,
new live model Missions and all remaining operational gates. Candidate acceptance is pending here.

## BLOCKED

No known unresolved T3 blocker in the implementation; candidate acceptance is still required.
Independent review remains pending and is not replaced by this builder checkpoint.

## DEFERRED

T4–T10, physical-device approval tests, logon/reboot acceptance and independent final operational review.
The user's subsequent laptop-update instruction permits one backed-up production activation after
all local and disposable installed-candidate checks pass. It does not enable Missions or triggers.
