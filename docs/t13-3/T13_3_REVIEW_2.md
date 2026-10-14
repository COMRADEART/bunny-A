# T13.3 second review and Gate J repairs

Status: Gate J repairs every finding of the first review (`T13_3_INDEPENDENT_REVIEW.md`) that was open after Gate I. It also repairs what a second review of those repairs found. A few items stay as documented limitations, each with its reason.

Source commits:

- `906589b`: first-review repairs F4, F6, F7, F11 and F12, plus the F2 test.
- `94a08e5`: second-review repairs.
- `fc915a0`: the confirmation pass's repairs. This is the final executable source.

Evidence is in `test-results/ma3/t13-3/gate-j/`.

## What these reviews are, and what they are not

Both passes were done by a separate reviewer agent with no authoring context. The first pass read the code at `906589b` against all twelve original findings, ran the focused suites, and reproduced one regression. The confirmation pass re-read `94a08e5` without running anything.

Neither pass is an external release audit. The reviewer is the same kind of system that wrote the code, and no human security reviewer has signed off. The reviewer did not run the final gates. Those are the regression, native Notch, package and seal, which this document and `MA3_T13_3_ACCEPTANCE.md` record separately.

## The original findings at the final source

| # | Gate I state | Final state | Where |
|---|---|---|---|
| F1 BLOCKER | fixed | fixed. A model worker's Project memory now also sits under its own prompt heading, never "Verified facts" (second review). | `workers-host.test.ts` |
| F2 MEDIUM | fixed; `mission.respond` untested | fixed. A phone answering a worker's request returns `WORKSTATION_REQUIRED` and resolves nothing. | `workers-host.test.ts` |
| F3 MEDIUM | fixed | fixed (F3-M1 still survives as defence in depth, explained in the first review) | `personal-agent-context-host.test.ts` |
| F4 MEDIUM | documented only | **fixed by owner decision.** A direct task with no declared scope counts as write and pauses on quota. Baseline T3 R22 and T9R DEV-01 now declare a read scope. | `t3-manager.test.ts`, `remote-remediation.test.ts` |
| F5 LOW | fixed | fixed. The rollback path is now tested too (N9). | `lotus.test.ts` |
| F6 LOW | documented only | **fixed** | `lotus.test.ts`, `lotus-host.test.ts` |
| F7 LOW | fixed | fixed and hardened | `harnesses-host.test.ts` |
| F8–F10 LOW | fixed | fixed (both review passes agree) | — |
| F11 INFO | documented only | **fixed** (aging) | `scheduler.test.ts` |
| F12 INFO | documented only | **fixed** | `workers-host.test.ts` |

### F4: quota on unscoped direct work

**The owner's decision (2026-10-14).** A task from Chat or `/submit` declares no execution scope, but it runs with write access. So it now counts as write work: on a quota error the Host pauses it (`QUOTA_PAUSE`) instead of moving it to another provider. Moving it could repeat changes that already landed.

**Baseline change.** This changes the T3 R22 contract, so R22 now submits a declared read scope and still proves that read work reroutes within bounds. The second review found one more baseline test that relied on the old rule, T9R DEV-01's positive control (N2). It now declares read too.

**Visible change.** A Chat or voice task that runs out of quota now stops and asks, instead of silently switching providers.

**Test.** "T13.3 F4: an UNSCOPED direct task that hits quota pauses instead of rerouting" reproduces the reported case.

### F6: compaction trust

The first review described the gap as admission being skipped. Reading the code showed a sharper failure.

An Agent's reply ends with a "From memory:" block. That block quotes recalled memories with their labels, including untrusted outside text and model notes. Compaction folded the whole reply at **host** trust, laundering the quoted outside text into a host-trusted "Earlier conversation" summary.

Each folded turn is clipped to 80 characters, so the leak needed a short answer. An Agent with no Missions answers "Spear has no Missions yet." (26 characters), which leaves room. My first Host test used an Agent with Missions and could not fail. Mutation attempt 2 caught that, and the retained log shows it.

**Fix.**
- Only the Host-facts answer of a reply is folded.
- `summarize()` also runs `admit()`'s steering check on every folded non-user source.

**Tests.**
- "T13.3 F6: a short reply that quotes outside text from memory is folded without it, at host trust" (Host).
- "T13.3 F6: compaction runs the steering check" (unit).

### F7: harness pause and resume

`harness.enable` already resumed only what `harness.disable` paused. One gap remained. If the owner took such a route back and then paused it themselves, `harness.enable` still resumed it. Now the owner's own pause, resume or disconnect of a route clears the harness record for it.

### F11: aging

A held step rises one priority rank per minute waited (`FAIRNESS_AGING_MS`), up to high. Ties fall to fewer live steps, then the longer wait. So a low-priority Agent behind a stream of high-priority work gets a seat within two minutes. Per-Agent caps and the shared ceiling are checked before priority, so aging never exceeds them (the reviewer confirmed this).

### F12: worker attribution

Every ownership change moves the Agent's open workers to the new slot:

- `personal_agent.assign`;
- a Studio rebinding (second review, N3).

Closed workers keep the slot they ran under, as history. A move that would push any slot over its open-worker cap is refused and changes nothing (N4). The cap check uses the net effect of the whole save, so a swap is allowed (N-A).

## Second-review findings

| # | Severity | Finding | Resolution |
|---|---|---|---|
| N1 | HIGH | Pausing an Agent did not hold its workers' child Missions, so a worker kept launching steps with the Agent's Project memory. | **Fixed.** The pause gate resolves a worker's parent Mission. Test: "T13.3 N1". |
| N2 | HIGH | The F4 change broke T9R DEV-01's positive control (reproduced). | **Fixed** per the F4 owner decision: the control declares read. |
| N3 | MEDIUM | A Studio rebinding moved ownership but not open workers. | **Fixed** (see F12). |
| N4 | MEDIUM | Assign could exceed the open-worker cap. | **Fixed** (see F12). |
| N5 | MEDIUM | Write work still switched providers after a persistent transport failure. | **Fixed** for direct work (`WRITE_PAUSE`) and, after the confirmation pass, for Missions (N-B). |
| N6 | LOW | The steering check missed "guidance / guidelines / directions" phrasings. | **Fixed.** |
| N7 | LOW | "usage limit … no longer available" was classified as model-unavailable, which bypassed the quota pause. | **Fixed:** quota is classified first. |
| N8 | LOW | The Mission `retryVerdict` treats an undefined access as read. | **Documented.** It is unreachable, because the Host refuses any Mission task without a scope. Changing it would rewrite a baseline Mission unit test. |
| N9 | INFO | The `writeAll` rollback path was untested. | **Fixed:** a write failing after the first copy rolls the batch back. |
| N10 | INFO | `WorkerStore.save` now writes the slot, so a future stale save could revert a move. | Disclosed. Every current caller re-reads before saving. |
| N11 | INFO | F4 is a visible Chat and voice change. | Disclosed (see F4). |
| F1 residual | LOW | Worker memory sat under the "Verified facts:" heading. | **Fixed.** |

## Confirmation-pass findings (review of `94a08e5`)

| # | Severity | Finding | Resolution |
|---|---|---|---|
| N-B | HIGH | A Mission write step still switched providers. The Host's `WRITE_PAUSE` text was classified as a plain `provider_failed`, which reroutes. | **Fixed.** The new category `provider_write_paused` never retries automatically and waits for the owner. Test: "T13.3 N-B" drives a real TaskManager and MissionManager through the Host's own pause. |
| N-C | MEDIUM | The one bounded same-candidate retry after a transport failure re-runs write work on the same provider. | **Documented limitation (L-RETRY-SAME).** It is the T3 §22 baseline, covered by baseline tests. Removing it for write work is a contract change for the owner to decide, as F4 was. |
| N-A | LOW | The cap check counted workers leaving a slot in the same Studio save, so a valid swap was refused. | **Fixed.** |
| N-D | LOW | `429` matched inside an address or port (`127.0.0.1:14290`), turning a connection error into a quota pause. | **Fixed:** `\b429\b`, in both the Host and the Mission classifier. |
| N-E | LOW | Workers were moved before the ownership write, so a fault in that write could leave them moved. | **Fixed:** ownership is written first. |
| N-F | INFO | The steering check is a pattern list. Phrasings such as "Ignore whatever I said earlier" still pass. | **Documented (L-STEER).** The check is defence in depth, and recall still labels every memory by trust. |

## Re-verification

Mutation checks are in `gate-j/review-fixes/mutation-checks.{cjs,json,log}`, and every earlier attempt is retained:

- Attempt 1: one mutation did not apply, because of an escaping bug in the checker.
- Attempt 2: my first F6 Host test could not fail.
- Attempt 3: round-one final run.
- Attempt 4: crashed on a Windows file lock. Nothing was left mutated, and the checker now retries the write.
- Attempt 5: round two. The new F1R-M1 mutant survived because it copied the heading text into the facts list. The test now requires the heading on its own line (`mutation-checks-f1r-retest.log`).
- Final, at `fc915a0`: **25 of 26 mutations caught.** F3-M1 survives as documented defence in depth. See `gate-j/review-fixes/MUTATION_SUMMARY.md`.

The full regression, native Notch, the Windows package and the production proof are in `MA3_T13_3_ACCEPTANCE.md`.
