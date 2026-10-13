# T9R limitations and items not tested

## Not tested (blocker recorded)

| Item | Status | Blocker |
|---|---|---|
| Physical phone (all §10 steps) | NOT TESTED | No phone attached or offered (`device-inventory.json`; its "phone" matches are the microphone array). The browser/loopback fixtures are not physical-phone proof. |
| LAN remote | NOT TESTED | No authorized second device on the Wi-Fi network. |
| Internet remote / public tunnel | NOT TESTED | Not authorized; the tunnel was never started. |
| Packaged gateway (`Bunny-Server.mjs`) boot | NOT TESTED | Its fixed port 127.0.0.1:8084 is held by protected production v26. The same built gateway was live-verified on disposable listeners (`protocol/`). |
| Phone UI closure on the final build | NOT RE-RUN | Executed on the ea48c40 build (`continuity/ui-closed.json`). The final build re-ran the phone-only network loss (`phone-only-network.json`) and the full protocol suite. |
| Concurrent app acquisition / window replaced mid-acquisition / focus unavailable (live) | ADAPTER-LEVEL ONLY | Covered by SIMULATED boundary tests in `calculator-readiness.test.ts` and live read-only native validators (`native-adversarial-results.json`). Not forced on the live desktop. |
| Unrelated user Calculator already running | NOT TESTED LIVE | No user Calculator existed during the session. Only the exact ledgered, test-owned HWND was ever minimized or closed. |

## Owner policy decisions (not changed by T9R)

1. **F-01: Mission plans with write-scoped provider sessions.** These sessions include an unconfined shell (Claude with Bash/PowerShell), and a paired phone can approve them. Two independent verifiers rated this HIGH relative to DEV-01's rationale. The accepted MA0R tests (`missions.test.ts:412`, `capabilities.test.ts:264`) explicitly require this phone right, so changing it needs an owner policy decision and new accepted tests. The phone cannot create Missions; it can only approve the exact Host-computed scope, which states `writeIncludesShell: true`.
2. **F-04 / T9R-02.** Answering exact Host-offered WRITE/EXECUTE requests and approving read-scope provider sessions remain phone rights under the T9 contract.
3. **Folder paths.** Mission authority roots stay visible to the paired owner device as consent context (MA0R). Device artifact reads stay location-free, and task cwd/process facts stay removed.
4. **Self sign-out.** Signing out a device does not end the approvals that device gave. Workstation revocation of a lost device does.

## Residual LOW findings (documented, not fixed)

- **Remote-tag snapshot window (round-4 F1).** The remote-tag check uses the latest registry probe. If the workstation owner turns a local tag into a remote proxy between refreshes, the tag could pass until the next refresh. The phone cannot cause this.
- **Pre-existing `hidePaths` gap (T01-12).** The tail of a path containing spaces can remain in a device-visible `project.artifact` file-system error.
- **CAL-18.** The non-cross-app `computer.*` path matches window titles by substring. Each such action is individually consented; X53 uses verified identity.
- **Call-site wiring (round-4 T2/T3/T5).** The `remoteModels` call sites and the sweep re-read have unit or static coverage only, with no end-to-end failing assertion.
- **Memory-only state (A16, A10).** The device-approved marker is in memory and never pruned. After a restart, interrupted tasks are not relaunched, so nothing can be rerouted without it.
- **One overstated assertion message (round-4 T1).** The revocation itself is asserted separately.

## Evidence caveats

- Production protection is a row/schema digest comparison over the stated window (`production-final.json`), not byte equality of a live SQLite/WAL. The live production Host's own provider polling added four `provider.status_changed` events and refreshed `providers.probed_at` (`production-change-attribution.txt`).
- The SIMULATED parts are labeled in each record: the loopback TLS adapter, the client-receipt discard, the in-process Host restart (the OS-process restart lives in `protocol/`), the AUTO selection in the DEV-01 test, and the failed state of one parked Mission.
- Earlier stability attempts 1–6 are preserved with their causes:
  - 1–2: harness defects.
  - 3: a real focus denial, which led to the ea48c40 repair.
  - 4: the ea48c40 matrix; run 8 hit foreground drift caused by another window and was refused fail-closed, by design (see `root-cause-analysis.md`).
- Foreground theft by another application remains an environmental risk. X53 then fails closed and asks for a fresh decision; it never invokes without foreground.
  - 5–6: the ownership guard refusing a stale or incomplete ledger.
