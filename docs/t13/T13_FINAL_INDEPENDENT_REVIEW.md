# T13 final source and accessibility review

Reviewer: Codex `/root/independent_review`, a separate review agent initially uninvolved in implementation.
Date: 2026-10-12, America/New_York. Base HEAD: `f104057d125d3265587d55d20fcf2eb555489303`.
Specification: `docs/t13/BUNNY_A_T13_DESIGN_SPEC.md`. Reviewed the unfinished, dirty checkout in place.

**Source verdict: no unresolved HIGH/BLOCKER found in the reviewed T13 sources after the repairs listed below.**
This is a scoped source review and executed-test record, not blanket release or installation approval. The native
keyboard repair must also be judged against the current live Island, not the old UIA receipt.

## Independence and scope

I independently inspected Host slot validation/projection/command dispatch, Studio draft/revision handling,
voice-companion derivation and snapshot acceptance, phone rights and approval controls, web motion/accessible labels,
and native companion/weapon/placement/accessibility sources. Earlier claims that 34 findings were fixed were not
accepted as evidence; I inspected the source and found additional defects.

After reporting findings, the root agent assigned specific repairs to this reviewer. I therefore became the author
of those repairs. Their unit/static checks below are author verification; independent runtime evidence and the root
agent's final review are needed to close the repaired behavior. I do not claim to be an independent reviewer of my
own changes. I wrote no commits, pushed nothing, installed/promoted nothing, and changed no installed v26 production
Host/gateway or preexisting development server.

## Findings and repairs

| ID | Severity | Concrete defect and repair | Verification |
| --- | --- | --- | --- |
| IR-H1 | HIGH | Native HAPPY took precedence over SPEAKING, PERMISSION, ERROR and MUTED for six seconds. `Get-BunnyCompanionDisplay` now overlays only READY/SLEEPING. Missing voice is UNKNOWN; a Host-origin HAPPY is refused. | Executed PowerShell cases for playback, permission, mute, error, absent snapshot and invalid Host HAPPY. |
| IR-H2 | HIGH | Native verification memory held only slot state, so rebinding to a historical verified Agent and reconnecting after an offline completion could celebrate work never observed. Memory now binds state to Agent ID; offline clears it; first load/rebind/reconnect seed only. | Executed PowerShell first-load, same-Agent transition, new-slot, rebound and offline cases; source offline-reset contract. |
| IR-H3 | HIGH | Existing native UIA evidence exposed four weapon Image/Text children but no actionable keyboard controls. Focusable Borders have no Button automation peer. Chips and expanded rows now use actual WPF Buttons with standard Tab/Enter/Space, shared Click behavior and an identity/state automation name. Back/Escape returns focus to the visible originating chip or Quick controls. | PowerShell parse/static gate passes. Old `perf/native/uia-collapsed.json` is evidence of the original defect, not of the repair; current runtime result belongs in the root/evidence review. |
| IR-H4 | HIGH | A delayed voice reply could restore protected voice state and restart effects after pairing/revocation or a Host switch. Root now captures access generation, canonical instance and identity/epoch before awaiting, rejects replies if they changed, and stops/reset polls and press state on pairing. | Independently re-read root's guard and pairing teardown. Source prevents acceptance and returning a stale start snapshot across this boundary. Runtime store-race evidence remains root-owned. |
| IR-M1 | MEDIUM | Discard after an external Host revision replaced the draft but retained the old `expectRevision`, making every later edit fail until remount. Discard now adopts the current revision. | Direct component review; existing Host tests verify stale-revision refusal. Current browser conflict-flow verification remains root-owned. |
| IR-M2 | MEDIUM | A still-existing bound Agent older than the fifty newest Agents disappeared from the client bindable set, making unrelated presentation edits unsavable. Projection now keeps the fifty recent entries plus up to four confirmed existing bindings. | New behavioral test projects sixty newer Agents plus four old bindings and validates an unrelated name edit. Missing/internal Agents remain excluded. |
| IR-M3 | MEDIUM | Web companion used the previous two-second timer value for new voice receipts; a newly received interrupt looked future-dated and produced a READY blip. Root now evaluates each render with the current clock. | Independently re-read `premium.tsx`; initial SSR/client render remains deterministic. Original `live-voice/verifier-reanalysis.json` still describes the old run. |
| IR-M4 | MEDIUM | Native input-level scaling continued in reduced/off motion and honored far-future or non-listening samples. Ring scaling now needs Full motion, a 0..1000ms sample age and a listening state; otherwise scale stays at rest. | Static ring gate check. Native fallback interruption/level checks also reject future timestamps; executed recent-plus-future receipt and endpoint-mute cases. |
| IR-M5 | MEDIUM | Native loops continued when minimized/hidden and on chips removed from the strip. Window visibility/state now suppress motion immediately; unused chips stop and clear their motion key; restoring a visible window restarts applicable motion. | Source state/visibility handlers and motion gate checked; PowerShell parse/static suite passes. Live minimized-window result remains root-owned. |
| IR-M6 | MEDIUM | Native failed/completed one-shots were implemented but never invoked. Observed same-Agent transitions now dispatch their actual cue; a VERIFIED-to-COMPLETED downgrade never celebrates. | Executed failed/completed/downgrade cases. |

Studio Escape also closes its inline editor and uses its existing Edit-button focus-return effect. It is an inline
section, not a modal; a focus trap is neither promised nor appropriate. Native expanded rows share the same accessible
Button constructor as strip chips, avoiding a second Border-only keyboard defect.

## Checks this reviewer actually ran

| Check | Result | Evidence |
| --- | --- | --- |
| All island UI model tests | 356 passed, 0 failed/skipped | `test-results/ma3/t13/review/ui-focused.log` |
| Native notch/placement/team/voice suites | 107 passed, 0 failed/skipped; PowerShell 5.1 parse and ASCII checks included | `test-results/ma3/t13/review/native-focused.log` |
| Personal Agent projection, real HTTP Host, voice-companion and voice-revision suites | 75 passed, 0 failed/skipped | `test-results/ma3/t13/review/host-focused-unsandboxed.log` |

The real HTTP tests use disposable Host state and fixture ports 43820–43829; they do not launch a provider. The first
restricted run failed at temporary-directory cleanup with Windows EPERM, and a workspace-TEMP attempt was correctly
refused by the Host's outside-Git state rule. These runs are preserved as diagnostics, not counted as passes. The
successful normal-Windows-temp run required an approved sandbox escalation. The first hanging test process was stopped;
no production process was stopped.

Source checks confirm: slot edits validate exactly four unique slots/weapons, reject authority-looking unknown keys,
and bind only existing user-facing Agents; workstation-only command admission is enforced on the Host; devices receive
no Studio bindable list or voice projection. Presentation is derived from canonical facts, with neutral ACTIVE fallback
and VERIFIED only from a mission result with positive verified steps and zero unverified steps. Client stale/Host-changed
views suppress live character state. Phone supervision follows Host rights and per-request remote verdicts.

I visually inspected the stored 1280×800 light Studio screenshot, the 390px paused-Agent phone screenshot, and the
1920×1080 editor-focus screenshot together. They contain visible content, readable labels and coherent layouts. This
is inspection of existing evidence; I did not capture a new browser run, measure glass-composited contrast, or treat
those screenshots as proof of the final native accessibility repair. The independent contrast audit itself labels
its ratios approximate because glass is not composited.

## Remaining limits and release gate

1. Fresh current-source native UIA/Tab/Enter/Space/Back/Escape and minimize/restore evidence must replace the old
   Border-based keyboard failure. Pure/static tests cannot prove assistive-technology behavior on the live window.
2. The old live voice run's ~626ms SPEAKING persistence after a native interrupt is bounded observation lag across
   voice polling and the server-function transport, distinct from the cached-clock READY blip. This reviewer found
   no evidence that audio or Host playback continued after the receipt. A fresh end-to-end run must judge actual
   response latency; the old screenshot cannot be relabeled as a new pass.
3. Native task effects remain simpler than the per-weapon choreography in spec sections 7–9 (many are halo pulses,
   rather than the described motes/sheets/traces); hover eases approximate the specified curves. These are visible
   motion-fidelity limitations, not execution-authority defects. They should be disclosed rather than described as
   pixel-complete compliance.
4. No final build, complete regression, production smoke, archive integrity, performance ceiling or installation
   gate is certified by this scoped review. Those are root/evidence-audit responsibilities. Only the explicitly
   executed counts above are this reviewer's results.

Reviewed repair-source SHA256 values:

| Source | SHA256 |
| --- | --- |
| `src/components/island/studio.tsx` | `47A2C3AD79520C0ABAE1EE53026A87713D4E556474611DF531DAD117C4B1EEFE` |
| `src/lib/bunny-host/personal-agents.ts` | `A0C000546732E2D628F6747E6DA91D11C23A3BC20D9EC37F919E52E98B5ECD17` |
| `install/Bunny-Island.Characters.ps1` | `A8848605F151708497C4A41F3297F722F4A3B4BCEB6EE59211D741986DE72D1C` |
| `install/Bunny-Island.Companion.ps1` | `FAE9E3D8F6412297E75A89D95A357A2F3927C786C4DC04C54E05B61359B010A9` |
| `install/Bunny-Island.Weapons.ps1` | `5EEBD23BA722B102D5FC8112327F4826AC4CC08EE9F4D568A711862F5BF4CC69` |
| `install/Bunny-Island.Visual.ps1` | `7A328C9072FA7D2F031979FDD7C5CEDB82B38D382A3731B026FB8621245572B4` |
| `install/Bunny-Island.Motion.ps1` | `544BF50DF11FAB215F84EFC3754681CD3F5327AAA089BECB1D08ED976345186D` |

These hashes identify the repair source at the review checkpoint, not the final package. Subsequent changes require
the root reviewer to refresh the relevant gate.
