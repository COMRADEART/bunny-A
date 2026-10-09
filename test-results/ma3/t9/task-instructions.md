

<pasted_content id="03c7">
# BUNNY-A — M-A-3 GATE T9
## PHONE AGENTIC CONTROL + SECURE REMOTE CONTINUITY
### Windows Host · Paired Devices · Live Missions · Remote Approvals · Mobile UX

**PRIMARY MISSION**

Enable a user to control and supervise their existing Bunny-A Agents from a securely paired phone without transferring the Agent runtime, Mission authority, or execution environment away from the Windows Host.

The intended experience:

1. The user starts an Agent Mission on their Windows computer.
2. Bunny continues working under the existing bounded authorization.
3. The user leaves their computer.
4. The user opens Bunny on their phone.
5. The phone securely reconnects to the same Host.
6. The user sees the real Agent, current Task, activity, model, permissions and verified results.
7. The user may review an offered approval, Pause, Resume or Stop.
8. Closing the phone does not terminate the Agent.
9. Returning to the desktop shows the same canonical state.

**Phone = remote control and presentation.**

**Windows Host = execution, persistence, identity verification and authorization.**

Build on the existing Bunny-A system. Do not rebuild it.

---

## 0. Accepted baseline

Previous gates:

- T1 — Model Capability Registry: PASS.
- T2 — Provider Usage Truth: PASS.
- T3 — Dynamic Model Router: PASS.
- T4 — Persistent Agent Runtime: PASS.
- T5 — Agentic Authorization: PASS_WITH_LIMITATIONS.
- T6 — Cross-Application Execution: PASS_WITH_LIMITATIONS.
- T7 — Projects & Agent Workspaces: PASS_WITH_LIMITATIONS.
- T8 — Premium UI/UX & Agentic Workspace: PASS_WITH_LIMITATIONS.

**Accepted T8 executable source:**

`987afeace77520b9f4ef49e27b137dd01fb3fee8`

**Accepted development branch:**

`codex/ma3-t8-premium-ui`

**T8 regression floor:**

| Suite | Passed |
|---|---:|
| Scripts | 256 |
| Library | 650 |
| Agent | 24 |
| UI | 78 |
| **Distinct total** | **1,008** |

Zero failures or skips.

T8 delivered:

- Seven unified navigation destinations.
- Dedicated Agentic workspace.
- Separate regular Bunny chat.
- Host-backed Agent controls.
- Project organization.
- Model and usage transparency.
- SSE reconciliation.
- Improved Bunny Bar.
- Responsive and accessible layouts.

**Known T8 limitations:**

- Free-form Agent Talk/Redirect remains unsupported.
- Physical phone interaction has not been validated.
- Hosted-provider inference was not exercised in the T8 UI fixture.
- Native secondary-monitor DPI and complete screen-reader certification were not tested.
- The development package retains legacy semantic version metadata.

Production remains:

`Bunny-A-Windows-v26-MA2-R1`

No MA3 production installation has been authorized.

Before coding, verify the current Git source, executable ancestry, evidence-only descendants, test inventory, protected files and local branch.

Do not reset, clean, force-push, install, migrate or modify production.

---

## 1. Core architectural requirement

Preserve:

```text
                   USER
                    |
          ┌─────────┴─────────┐
          |                   |
     Windows Desktop     Paired Phone
          |                   |
          └─────────┬─────────┘
                    |
             Secure Host API
                    |
              Host Identity
            / Device Authority
                    |
              AgentRuntime
                    |
             MissionManager
                    |
               TaskManager
                    |
               BunnyRouter
                    |
             ProviderAdapter
                    |
          Independent Verification
                    |
               Persistence
```

For deterministic capabilities:

```text
Phone
  |
Authenticated Host Command
  |
Canonical Authorization
  |
MissionManager
  |
Capability Bus
  |
Windows / File / Git / Browser
  |
Independent Verification
```

The phone never executes Agent Tasks independently.

Do not create a second:

- Agent runtime.
- Scheduler.
- MissionManager.
- TaskManager.
- BunnyRouter.
- Authorization engine.
- Provider registry.
- Event journal.
- Memory authority.

The phone is a thin, authenticated client of the existing Host.

---

## 2. Initial audit of phone support

Before introducing new code, inspect:

- Existing device pairing.
- Existing Phone device records.
- Device identity storage.
- Device revocation.
- Remote authentication.
- Remote authorization restrictions.
- Host API authentication.
- Existing SSE/event endpoints.
- Existing tunnel lifecycle.
- Existing mobile-responsive UI.
- Existing native Bunny Bar.
- Existing trusted-peer requirements.
- Existing session-expiration semantics.

Determine exactly what is already implemented.

Produce:

`test-results/ma3/t9/baseline-phone-audit.md`

Classify each capability:

- Implemented and tested.
- Implemented but unverified.
- Partial.
- Unsupported.
- Unsafe or blocked.

Reuse the existing security infrastructure.

---

## 3. Preserve the original paired phone

The user's existing production Phone record is protected.

Do not:

- Delete it.
- Regenerate its credentials.
- Re-pair it automatically.
- Overwrite its role.
- Change its scopes.
- Revoke it.
- Use its real secret in automated tests.

Use disposable devices and credentials for test scenarios.

Production device records remain untouched.

If actual physical-phone testing requires interaction with the user's existing paired phone, obtain the appropriate explicit consent and use only the supported authorized workflow.

---

## 4. Connection architecture

Implement a secure phone-to-Host connection using existing supported transport mechanisms.

Preferred order:

1. Existing authenticated local-network transport, if genuinely supported and secure.
2. Existing user-configured trusted remote transport.
3. Existing certified tunnel mechanism, invoked manually with explicit user consent.
4. Unsupported/offline state when no secure connection is available.

Never start a public tunnel automatically.

Never silently expose a new public listening endpoint.

Never change Windows Firewall configuration without explicit user consent.

Never silently switch from HTTPS to plaintext transport.

Do not bypass Host trusted-peer checks by forging headers or treating every remote IP as the owner.

A phone can use an already established authorized transport.

Its existence does not grant permission to activate an unavailable transport.

---

## 5. Trustworthy secure transport

Protect all sensitive phone traffic.

Requirements:

- Authenticated Host identity.
- Authenticated device identity.
- Confidentiality and integrity on remote connections.
- Correct certificate/transport verification.
- No acceptance of arbitrary self-signed identities without a deliberate trusted setup.
- No secrets in query strings.
- No credentials in logs.
- No permissive CORS wildcard for authenticated control endpoints.
- Origin and CSRF protections appropriate to the chosen authentication scheme.
- Replay-resistant command semantics.
- Connection rate limiting.
- Session expiration.
- Device revocation.

For HTTPS-based remote access, validate the server certificate and Host identity.

If the existing transport has a different supported authentication design, document and test its equivalent guarantees.

Do not create a second remote trust model merely to simplify the UI.

---

## 6. Host-owned device identity

Use the existing paired-device model.

Conceptual device record:

```text
DeviceIdentity
  device_id
  device_type
  display_name
  pairing_status
  authorization_role
  allowed_actions
  created_at
  last_seen_at
  revoked_at
  current_session_generation
```

Reuse the actual Host fields.

A device must not be treated as the Host owner solely because it is paired.

**Paired ≠ unlimited authority.**

Different device roles may have different control rights.

Do not invent capabilities unavailable under the actual paired-device permission contract.

---

## 7. Phone pairing

Where pairing is already supported, preserve it.

If necessary, improve its user presentation without changing its security semantics.

A safe pairing process should:

1. Be explicitly initiated by the authorized Host owner.
2. Establish a new device-specific identity.
3. Bind to the correct Host.
4. Use short-lived enrollment authority.
5. Require explicit confirmation.
6. Persist the device under canonical Host control.
7. Avoid exposing reusable pairing secrets through logs, URLs or screenshots.

Do not make approval of a new device possible from an untrusted unpaired client.

Do not silently copy the original Phone credentials into a new device.

---

## 8. Supported phone delivery format

Inspect the existing phone experience first.

Use the smallest compatible delivery approach:

- Existing mobile web client.
- Installable PWA if supported.
- Existing mobile companion shell, if one exists.

Do not create an unrelated Android or iOS Agent backend.

A PWA may be appropriate, but must not be introduced merely for marketing appearance.

If installability, push delivery or offline mode is claimed, verify each behavior on a compatible device.

Do not claim a native Android or iOS application was created if only responsive web UI exists.

---

## 9. Phone information architecture

Build a focused mobile experience.

Recommended primary destinations:

**Home**

Current Host and Agent overview.

**Agentic**

Active, paused, waiting, failed and completed Agents.

**Projects**

Registered Project summaries and linked work.

**Activity**

Canonical work history.

**Devices / Settings**

Current phone identity, connection information and supported controls.

The phone does not need to reproduce every desktop administration panel.

Prioritize supervision and decision-making.

---

## 10. Mobile Agentic overview

Display actual persistent Agents.

An Agent card should include:

- Agent name.
- Mission objective.
- Current canonical state.
- Current Task.
- Current model/provider when known.
- Latest verified activity.
- Pending approval status.
- Last update/freshness indication.

No fictitious completion percentage.

No fake work animation.

Unknown model identities remain unknown.

The phone must not generate a separate Agent ID for an existing desktop Agent.

---

## 11. Agent detail

The phone must show the same Agent and Mission as the desktop.

Required information:

- Goal.
- Mission ID reference.
- Current state.
- Current Task.
- Accepted Mission steps.
- Completed and pending steps.
- Current provider/model when known.
- Authorization state.
- Current capability/application.
- Recent events.
- Verified artifacts.

Technical IDs may be available in diagnostics, but should not dominate the user interface.

The primary view should remain understandable on a small screen.

---

## 12. Phone control actions

Implement functional, Host-backed controls:

- Pause.
- Resume.
- Stop.
- Review offered authorization.
- Approve, only when existing device rights permit.
- Deny, only when existing device rights permit.
- Revoke, only when existing device rights permit.
- Open verified artifacts.
- Navigate to Project/Mission.

Any unavailable operation must be absent or clearly disabled.

Every command must reach the canonical Host control path.

Never implement controls as frontend-only state mutations.

---

## 13. Permission and scope authority

The existing T5 authorization system remains authoritative.

A paired phone cannot create unlimited delegation.

Phone commands must validate:

- Device identity.
- Current device role.
- Session validity.
- Agent identity.
- Mission identity.
- Current Host generation.
- Current authorization revision.
- Requested action.
- Current authorization state.
- Current command scope.

A client cannot turn:

```text
READ PROJECT
```

into:

```text
WRITE ALL FILES
```

by modifying an API request.

A phone cannot increase action budgets or expand roots merely by changing JSON fields.

---

## 14. Remote approval review

This is one of the most important T9 functions.

When an Agent requests approval, show:

- Agent.
- Mission.
- Requested capability.
- Concrete target.
- Exact resource scope.
- Risk classification.
- Action/duration budget.
- Current authorization revision.
- Explanation of why approval is required.

Buttons must communicate their actual effect.

Example:

```text
Bunny needs permission

Mission:
Build the dashboard

Requested:
Read files inside the approved project workspace

Duration:
20 minutes

Action budget:
12 actions

[Approve] [Deny]
```

This is illustrative only.

Use the exact current Host offer, not invented permission values.

---

## 15. Owner-consent boundaries

Do not assume every approval may be performed remotely.

Inspect existing restrictions on:

- Sensitive capabilities.
- Scope expansion.
- Initial Agentic delegation.
- Remote device enrollment.
- System-level changes.
- Credentials and external publication.

If an operation requires local Host-owner consent, the phone must display:

**Approval required on Windows Host.**

Do not quietly reinterpret local-only approval as ordinary remote approval.

---

## 16. Remote scope clamp

If a paired device may approve a Host-offered request:

- The phone must not widen the offer.
- The Host must reject stale revisions.
- The Host must reject different targets.
- The Host must reject higher budgets.
- The Host must reject altered risk classes.
- The Host must reject changed Mission/Agent IDs.

Any permitted scope reduction must use the existing T5 revisioned policy.

No frontend-generated envelope becomes trusted automatically.

---

## 17. Pause semantics

Phone Pause must invoke the existing T4 Host command.

On success:

- No new Agent work admission.
- Already-admitted effects remain truthfully recorded.
- Agent state persists.
- Desktop receives the same canonical state.

The phone should not claim the Agent paused until the Host acknowledges or a canonical state refresh confirms it.

---

## 18. Resume semantics

Phone Resume must revalidate:

- Agent state.
- Mission state.
- Current authorization.
- Device rights.
- Dependencies.
- Checkpoint integrity.
- Replay safety.
- Current Host generation.

Old grants must not revive.

If additional approval is required, display that condition.

Do not optimistically resume work in the browser.

---

## 19. Stop semantics

Phone Stop must:

- Authenticate the device.
- Check current control rights.
- Invoke the canonical Stop command.
- Block future Agent admissions.
- Preserve completed work.
- Preserve existing artifacts.
- Show actual acknowledgment.

Stop is not a guarantee that already-executed effects were reversed.

Do not use raw process termination from the phone.

Never expose arbitrary PID/HWND control to the mobile client.

---

## 20. Agent Talk and Redirect

T8 established that free-form Agent Talk and Redirect are not yet supported by canonical Host commands.

Do not silently introduce fake messaging or redirection.

For T9:

- Preserve ordinary Bunny chat where supported.
- Display Agent progress and activity correctly.
- Keep unsupported Agent Talk/Redirect unavailable or clearly explained.
- Do not create an alternate Mission authority just to make these controls appear functional.

A future reviewed Host command may enable conversational Agent control.

T9 must not claim it exists unless genuinely implemented and tested.

---

## 21. Live event streaming

Use the existing Host SSE/event infrastructure.

Support mobile subscriptions to:

- Agent state changes.
- Mission updates.
- Task updates.
- Authorization requests.
- Verification results.
- Model selection and reroutes.
- Completion and failures.

All projections must be filtered through the authenticated device's actual authorization.

Do not broadcast all private Host events to every paired device.

---

## 22. Event replay and reconciliation

Phone networks are unreliable.

Support:

1. Connection loss.
2. Reconnect.
3. Authenticated Host identity revalidation.
4. Current canonical snapshot.
5. Event-cursor reconciliation.
6. Duplicate suppression.
7. Correct current-state presentation.

The client must handle:

- Duplicate events.
- Missing event ranges.
- Stale cursors.
- New Host epoch.
- Permission revision changes.
- Device revocation.
- Agent completion during disconnection.

Event signals do not supersede canonical state.

When cursor recovery is impossible, obtain a fresh authorized snapshot.

---

## 23. Mobile offline behavior

When phone connectivity disappears:

- Display offline/disconnected state.
- Preserve previously viewed non-sensitive presentation where permitted.
- Mark cached data stale.
- Disable controls requiring live Host authority.
- Do not claim active approval or current execution state.
- Do not perform local Agent execution.

Avoid queuing sensitive mutations for blind replay.

In particular, do not automatically replay:

- Approve.
- Deny.
- Revoke.
- Stop.
- Scope modification.

A fresh user action against current canonical state is required after reconnection where appropriate.

---

## 24. Command idempotency and uncertain acknowledgments

Phone commands may succeed on the Host while the response is lost.

Use canonical idempotency or operation identifiers as appropriate.

If the phone sends Stop and loses connection:

- Do not assume Stop failed.
- Do not automatically issue a conflicting command.
- Reconnect.
- Fetch canonical Agent state.
- Explain uncertainty until resolved.

A duplicate command must not create duplicate Agent runs, authorizations or destructive operations.

---

## 25. Host restart continuity

An active Agent may survive a real Host restart according to T4.

Phone UI must correctly handle:

- Host disconnect.
- Old Host epoch invalidation.
- New Host identity/generation validation.
- Re-authentication as required.
- Agent recovery.
- Fresh authorization review when required.
- Current Mission reconciliation.

No old approval request may be accepted merely because it remains displayed in the phone UI.

Restart-invalidated grants remain invalid.

---

## 26. Revoked phone behavior

Revocation must work immediately against current Host authority.

After revocation, the phone cannot:

- Send privileged commands.
- Approve scope.
- Resume work.
- Inspect new protected Agent events.
- Fetch protected artifacts.
- Reconnect with revoked credentials.

Terminate or reject active SSE subscriptions according to the existing revocation model.

Previously buffered protected events must not leak after the Host's revocation boundary.

Clearly distinguish unavoidable data already delivered before revocation from new post-revocation disclosure.

---

## 27. Multi-device consistency

Desktop and phone may control the same Agent.

Test concurrent actions:

- Desktop pauses while phone requests Resume.
- Phone stops while desktop requests approval.
- Desktop revokes a device while phone is connected.
- Two devices submit competing approval decisions.
- Authorization revision changes during phone review.

The Host must serialize canonical decisions.

Use current revisions, conditional updates, and appropriate locking.

Do not resolve races using whichever UI response arrives last.

The desktop and phone must eventually show the same authoritative state.

---

## 28. Phone session security

Use the existing device/session framework.

Requirements:

- Short-lived or appropriately bounded sessions.
- Secure token/credential handling.
- Device-specific revocation.
- Host-side authorization on every command.
- Replay protection.
- Session rotation where supported.
- Rate limiting.
- Logout/disconnect behavior.
- No sensitive credentials in browser URLs.
- No logging of authentication secrets.

Do not store raw bearer credentials in ordinary plaintext browser storage merely for convenience.

Choose the actual supported secure client credential mechanism and document its platform limitations.

---

## 29. Safe phone data projections

Mobile requests should return only what the device may see.

Examples:

```text
AgentSummary
  agent_id
  display_name
  mission_summary
  state
  current_task_summary
  updated_at
  requires_attention
```

```text
RemoteApprovalView
  request_id
  agent_id
  mission_id
  scope_summary
  risk
  expiration
  revision
  allowed_decisions
```

Reuse or extend existing canonical projections rather than duplicating models.

Never expose:

- Provider API keys.
- Full private prompts.
- Hidden reasoning.
- Raw provider transcripts.
- Host credential stores.
- Unrelated project files.
- Browser cookies.
- Other devices' secret identities.

---

## 30. Artifact access

Phone must be able to inspect eligible verified Mission artifacts.

Requirements:

- Device authorization.
- Correct Project/Mission/Agent binding.
- Existing artifact hash verification.
- Bounded reads.
- Safe content type.
- No arbitrary filesystem path reads.
- Correct revoked-device denial.

Large artifacts should be handled with supported bounded retrieval, not unbounded downloads.

Do not claim a generated artifact is verified unless canonical evidence confirms it.

---

## 31. Project continuity

Phone Projects view should use the existing T7 registry.

Show:

- Project identity.
- Current state.
- Related Agents.
- Active Missions.
- Waiting work.
- Verified artifacts.

Phone Project browsing does not grant the right to modify project files.

Cross-project isolation remains enforced at the Host.

---

## 32. Models and usage

Preserve T1/T2/T3 semantics.

Phone may display:

- Current routed model.
- Provider.
- Supported effort level.
- Routing reason.
- Known provider usage.
- Unknown/stale usage states.

Do not invent mobile-specific usage estimates.

Do not make the phone select a permanent model for a Project.

Provider credentials remain on the Windows Host.

---

## 33. Phone interface design

Follow T8's premium UI system.

Requirements:

- Responsive layouts.
- Consistent light/dark themes.
- Clear navigation.
- Useful Agent cards.
- Readable Mission plans.
- Accessible approval dialogs.
- Large enough touch targets.
- Visible pending states.
- Safe destructive-action confirmation.
- Clear online/offline indicators.
- Reduced-motion support.

Use platform conventions where appropriate.

Avoid duplicating desktop-sized panels in a cramped mobile layout.

---

## 34. Supported device sizes

Test at minimum:

- 360×800.
- 390×844.
- 430×932.
- 768×1024 tablet.
- Desktop comparison at 1280×800.

Test:

- Portrait orientation.
- Landscape orientation.
- Software keyboard visibility where applicable.
- Safe-area insets.
- Long Agent names.
- Long Mission objectives.
- Long permission paths.
- Dark and light modes.

Browser responsive emulation alone does not count as physical phone verification.

---

## 35. Phone interaction design

Prioritize quick decisions.

A typical Agent detail screen should present:

```text
Bunny

Agent: Dashboard Builder

Status: Waiting for permission

Current task:
Verify the project output

Model:
Codex — exact routed model if known

Completed:
6 verified steps

Pending:
1 approval

[Review Permission]

[Pause] [Stop]

Activity
  ✓ Read project
  ✓ Edited approved file
  ✓ Tests passed
  ● Waiting for user
```

This is an illustrative layout.

Every value must come from current canonical Host records.

---

## 36. Notifications

Do not automatically add an external push-notification service.

If notification infrastructure already exists, inspect its security and privacy rules.

Optional notifications may cover:

- Permission required.
- Mission completed.
- Verification failed.
- Agent stopped unexpectedly.

Only claim working push notifications if verified on an eligible actual device with user-granted notification permission.

No secret-bearing message content.

No notification should imply the Agent stopped simply because the phone is offline.

Notifications are not required for T9 core PASS unless the implementation explicitly makes them part of the supported contract.

---

## 37. Background phone behavior

Closing or backgrounding the phone must not affect Agent execution on Windows.

The phone client may disconnect or be suspended by the mobile operating system.

This is acceptable.

The Host remains the source of truth.

On reopen:

- Authenticate.
- Reconnect.
- Reconcile.
- Show actual current state.

Do not require the phone application to stay open to keep a Mission running.

---

## 38. Physical phone acceptance

This is a major gate.

Where a physical phone and authorized secure network path are available, prove the experience on the actual device.

Required physical scenario:

1. Open Bunny from the phone.
2. Authenticate using an existing supported device flow or explicitly approved disposable pairing.
3. View a real Agent running on the Windows Host.
4. Inspect its current Mission.
5. Observe a genuine Host state change.
6. Review a pending Host-offered approval.
7. Approve or deny, according to the actual device role.
8. Pause or Stop an Agent.
9. Confirm desktop and phone agree.
10. Disconnect phone network.
11. Reconnect.
12. Verify canonical state reconciliation.

Do not use production credentials in disposable fixtures.

Do not activate the public tunnel without explicit user consent.

A securely controlled local-network test can establish physical-device interaction without demonstrating public internet accessibility. Label those separately.

If no physical device or authorized transport is available, mark physical verification **NOT TESTED**, not PASS.

---

## 39. Cross-network acceptance

Where an authorized supported remote transport is available:

- Test phone and Host on separate network segments.
- Authenticate device and Host.
- Confirm event updates.
- Confirm scoped control.
- Disconnect/reconnect.
- Validate revocation.

If this requires the existing public tunnel, request explicit consent for its manual activation.

Do not start it automatically.

If testing is limited to local Wi-Fi, report:

**LOCAL NETWORK VERIFIED — INTERNET REMOTE ACCESS NOT TESTED.**

Do not claim remote-from-anywhere operation without evidence.

---

## 40. Actual Host-backed mobile Mission

Use a disposable Windows Host and durable SQLite.

Create a bounded Agent Mission with:

- A real Project.
- Multiple Tasks.
- At least one verified artifact.
- A pending approval.
- A paused or waiting Agent.
- Current authorization revision.

Then connect an independently authenticated client from a distinct device/network context.

Demonstrate:

- Same Agent ID.
- Same Mission ID.
- Same Project ID.
- Same canonical step state.
- Same authorization revision.
- Real Host commands.
- Real state reconciliation.
- No alternate phone Agent.

The Mission may use deterministic fixtures; this does not prove arbitrary autonomous planning.

If no live model is invoked, state that clearly.

---

## 41. Real Host restart test

Use disposable state only.

Test:

1. Connect phone.
2. View Agent.
3. Capture current Host epoch and event cursor.
4. Terminate only the verified owned disposable Host.
5. Observe phone offline state.
6. Start a genuinely fresh Host from the same SQLite.
7. Reconnect through authenticated transport.
8. Reconcile Agent/Mission state.
9. Confirm old transient approval is refused.
10. Obtain fresh consent if required.
11. Confirm no duplicate Task or side effect.

Do not restart production.

---

## 42. Security adversarial matrix

Execute at least all the following cases.

**F01** — Existing device identity is recognized correctly.

**F02** — Unknown device is rejected.

**F03** — Revoked device is rejected.

**F04** — Expired device session is rejected.

**F05** — Device identity cannot be forged through request headers.

**F06** — Wrong Host identity is rejected.

**F07** — Transport downgrade is rejected.

**F08** — Invalid certificate/trust evidence fails closed.

**F09** — Sensitive credentials do not appear in URLs or logs.

**F10** — Unauthorized origin/CSRF attempt is rejected.

**F11** — Device cannot forge owner role.

**F12** — Phone cannot invent a new authorization envelope.

**F13** — Phone cannot widen Host-offered scope.

**F14** — Phone cannot extend finite action budgets.

**F15** — Stale approval revision is rejected.

**F16** — Cross-Agent approval substitution is rejected.

**F17** — Cross-Mission approval substitution is rejected.

**F18** — Cross-Project approval substitution is rejected.

**F19** — Sensitive local-owner boundary is enforced.

**F20** — Remote denial persists correctly.

**F21** — Remote Pause invokes canonical Host.

**F22** — Remote Resume revalidates authority.

**F23** — Remote Stop prevents future admissions.

**F24** — Agent identity remains unchanged.

**F25** — Mission identity remains unchanged.

**F26** — Phone cannot directly invoke ProviderAdapter.

**F27** — Phone cannot bypass TaskManager.

**F28** — Phone cannot directly execute arbitrary shell commands.

**F29** — Phone cannot launch an arbitrary app without Host authorization.

**F30** — Phone cannot read unrelated Project artifacts.

**F31** — Event stream requires authenticated device.

**F32** — Event stream applies authorization filtering.

**F33** — SSE cursor replay deduplicates events.

**F34** — Stale cursor triggers canonical reconciliation.

**F35** — New Host epoch invalidates stale assumptions.

**F36** — Offline phone displays stale/offline state.

**F37** — Offline phone does not execute Agent work.

**F38** — Old offline approval is not automatically replayed.

**F39** — Lost Stop acknowledgment is reconciled safely.

**F40** — Duplicate command cannot duplicate Agent effects.

**F41** — Host restart does not revive old grants.

**F42** — Host restart preserves Agent identity.

**F43** — Host restart preserves completed artifacts.

**F44** — Device revocation blocks future commands.

**F45** — Device revocation blocks protected future events.

**F46** — Device revocation blocks artifact access.

**F47** — Revoked device cannot silently re-pair.

**F48** — Concurrent desktop/phone decisions are serialized.

**F49** — Concurrent conflicting approval requests are safely resolved.

**F50** — Authorization revision wins over stale phone view.

**F51** — Phone and desktop converge on same canonical state.

**F52** — Agent continues after phone UI closes.

**F53** — Agent continues after phone network disconnects.

**F54** — No fake model identities or usage percentages appear.

**F55** — Unknown provider facts remain UNKNOWN.

**F56** — Artifact hash mismatch is rejected.

**F57** — Phone UI has no horizontal overflow on required sizes.

**F58** — Touch and keyboard controls are accessible.

**F59** — Reduced-motion preference is honored.

**F60** — No unsupported Agent Talk/Redirect represented as active.

**F61** — Real Host command matches displayed acknowledgment.

**F62** — Physical phone session tested or explicitly NOT TESTED.

**F63** — Separate-network transport tested or explicitly NOT TESTED.

**F64** — Phone testing does not mutate production device records.

**F65** — Production v26 remains unchanged.

Add any discovered real defects.

Every case must record:

- Initial state.
- Action.
- Expected result.
- Observed result.
- Evidence location.
- LIVE / SIMULATED / STATIC / NOT TESTED.
- PASS / FAIL / limitation.

A test that merely verifies a function's return value is not equivalent to a live phone-to-Host security boundary.

---

## 43. Performance and network resilience

Bound:

- Simultaneous SSE connections.
- Reconnection attempts.
- Backoff.
- Polling frequency.
- Event history retention.
- Mobile memory usage.
- Cached artifact size.
- API response size.
- Rate of control commands.

Prevent:

- Reconnect storms.
- Repeated approvals.
- Duplicate subscriptions.
- Unbounded mobile event arrays.
- Continuous high-frequency telemetry streaming.

Use efficient snapshots and incremental updates.

The Host must continue functioning if the phone disappears permanently.

---

## 44. Mobile security and privacy

Test sensitive-data exposure through:

- API responses.
- Cached state.
- Browser storage.
- Notifications.
- Error messages.
- Application logs.
- Connection URLs.
- Event streams.
- Screenshots retained in evidence.

Screenshots must not expose real device credentials.

Tests must not commit private browser profiles, live credentials, or canonical production SQLite.

Use disposable test identities.

---

## 45. Regression floor

Accepted T8 floor:

**1,008 distinct tests.**

Preserve:

- All MA2 security tests.
- T1 model registry.
- T2 usage truth.
- T3 router.
- T4 Agent recovery.
- T5 bounded authorization.
- T6 cross-app execution.
- T7 Project isolation.
- T8 premium UI/Host commands.

Run:

- Full script suite.
- Full library suite.
- Agent tests.
- UI tests.
- Typecheck.
- ESLint.
- Desktop build.
- Windows packaging tests.
- Focused remote security.
- Device revocation.
- Host restart.
- Mobile acceptance.

Zero required failures.

Zero skipped existing security tests.

Do not double-count focused reruns.

Do not weaken old assertions.

---

## 46. Production preservation

Current production remains v26.

Do not:

- Install T9.
- Restart production.
- Migrate production SQLite.
- Modify Startup.
- Change the existing Phone record.
- Change production device secrets.
- Start the public tunnel.
- Modify production provider configuration.
- Enable production Missions/Triggers.
- Terminate unidentified processes.

Use disposable Host state and device credentials for testing.

Capture appropriate read-only before/after observations.

If comprehensive production-state equality cannot be demonstrated, report that limitation truthfully.

Do not claim process continuity from executable hash equality.

---

## 47. Release metadata

T8 reported that a test package used legacy semantic version metadata while pinning its actual source.

Inspect and document this inconsistency.

If T9 creates a test package:

- The test package name must identify T9.
- The source commit must be exact.
- The tooling revision must be exact.
- The manifest must identify the actual tested bytes.
- Version metadata must not falsely identify the contents as installed v26 functionality.

Do not migrate or install a release as part of this gate.

Full release promotion remains separately authorized.

---

## 48. Git safety

Start from accepted T8 source.

Verify:

- Current branch.
- Executable commit.
- Evidence-only descendants.
- Ancestry.
- Dirty state.
- Protected reports.
- memory/.
- Untracked user material.

Do not:

- Force reset.
- Clean protected files.
- Force push.
- Push automatically.
- Merge into main without authorization.
- Reconcile GitHub as a side effect.

Git synchronization remains separate.

---

## 49. Evidence requirements

Evidence root:

`test-results/ma3/t9/`

Required report:

`MA3_T9_PHONE_REMOTE_ACCEPTANCE.md`

Produce:

- baseline.md
- phone-architecture.md
- existing-device-audit.md
- transport-security.md
- device-role-matrix.json
- pairing-contract.md
- remote-command-contract.md
- approval-scope-matrix.json
- mobile-ui-inventory.json
- mobile-responsive-results.json
- mobile-authentication-results.json
- mobile-event-replay.json
- multi-device-race-results.json
- revocation-acceptance.json
- offline-reconnect.json
- host-restart-recovery.json
- physical-phone-acceptance.json
- separate-network-acceptance.json
- adversarial-matrix.json
- integrated-phone-mission.json
- artifact-access-results.json
- regression-inventory.json
- security-regression.json
- full-test-results.log
- ui-test-results.log
- typecheck.log
- lint.log
- build.log
- windows-package-results.json
- production-final.json
- secret-scan.json
- INDEX.md
- INDEX.sha256

If an evidence item cannot be executed, record NOT TESTED with the blocker and reason.

Never create fabricated proof data to fill the expected evidence inventory.

SHA-256 seal the retained evidence.

Preserve unsuccessful attempts and remediation history.

---

## 50. PASS conditions

T9 full PASS requires:

1. The phone connects securely to the existing Windows Host.
2. Actual paired-device authority is used.
3. No duplicate mobile Agent runtime exists.
4. The same canonical Agent/Mission appears on desktop and phone.
5. Remote events are authenticated and correctly scoped.
6. Pause works through Host authority.
7. Resume works with fresh authorization validation.
8. Stop works through Host authority.
9. Host-offered approvals respect existing remote-device rights.
10. Remote clients cannot expand authorization.
11. Revocation blocks new commands and protected events.
12. Offline state is displayed truthfully.
13. Event reconnect/reconciliation works.
14. Real Host restart recovery works.
15. Stale approvals cannot revive.
16. Competing desktop/phone commands resolve safely.
17. Verified artifact access preserves Project isolation.
18. Model and usage facts remain truthful.
19. Mobile UI passes responsive/accessibility acceptance.
20. At least one actual physical phone completes the supported secure connection and control scenario.
21. The distinction between local-network and internet-remote verification is reported.
22. Existing 1,008-test regression floor is retained.
23. No unresolved BLOCKER/HIGH remote-authority vulnerability remains.
24. Production v26 and existing Phone credentials are preserved.
25. Evidence is sealed and source identity is pinned.

### PASS_WITH_LIMITATIONS

Use only when:

- The implemented, supported remote control path works and is security-tested.
- A core protocol/integration acceptance has been demonstrated from an independently authenticated client.
- Any physical-device or public-internet limitation is disclosed as NOT TESTED.
- No unresolved BLOCKER/HIGH authority issue exists.

Lack of a physical phone test cannot be reported as full physical-phone acceptance.

### FAIL

Use if:

- Remote commands can bypass Host authorization.
- Revoked devices can retain control.
- Sensitive events leak across devices.
- The primary authenticated remote control path does not work.
- Host state is replaced by mobile-only state.
- An unresolved BLOCKER/HIGH security defect remains.

Do not mark an unsafe implementation PASS_WITH_LIMITATIONS merely because its UI works.

---

## 51. T9 does not claim

T9 PASS does not automatically mean:

- A native iOS/Android application is available.
- Mobile device local applications can be controlled.
- Full public internet access is configured.
- Push notifications are deployed.
- Live voice is working.
- Free-form Agent Talk/Redirect exists.
- Arbitrary autonomous planning is proven.
- Unrestricted remote shell is supported.
- Multiple Agents can coordinate as a team.
- MA3 production release is ready.

Those claims require separate implementation and evidence.

---

## 52. Do not start T10

The next gate is:

**T10 — Live Conversational Voice + Interruptible Bunny Companion**

Do not start T10 without explicit user authorization.

---

## 53. Final report

Report:

- Exact source commit.
- Branch and ancestry.
- Files changed.
- Actual mobile delivery method.
- Existing pairing infrastructure reused.
- Authentication and transport contract.
- Device roles.
- Phone Agentic functions.
- Remote approval results.
- Phone/desktop consistency.
- Revocation proof.
- Offline/reconnect proof.
- Genuine Host restart proof.
- Physical phone results.
- Local-network results.
- Internet-remote results, if authorized.
- Adversarial matrix.
- Full regression total.
- Windows packaging results.
- Production preservation.
- Unsupported features.
- Evidence root.

End with exactly one:

`BUNNY_MA3_T9_PASS`

`BUNNY_MA3_T9_PASS_WITH_LIMITATIONS`

`BUNNY_MA3_T9_FAIL`

**Do not begin T10 automatically.**

---

# NORTH STAR

The user says:

"Bunny, continue working on my project."

Bunny begins the authorized Mission on the Windows Host.

The user leaves the computer.

On the phone, they see:

- The same Agent.
- The same Mission.
- The current Task.
- The selected model.
- Real work completed.
- Verified artifacts.
- Any permission needed.

The user may Pause, Resume, Stop or respond to an authorization request according to their actual device permissions.

If the phone disconnects, Bunny's authorized work continues.

If the Windows Host restarts, the Agent recovers safely.

If permission is revoked, the phone loses authority.

If a new sensitive action is needed, Bunny asks.

**The phone controls the experience. It does not become the execution authority.**

AGENTS MAINTAIN CONTINUITY.

MISSIONS MANAGE WORK.

THE ROUTER SELECTS INTELLIGENCE.

THE WINDOWS HOST ENFORCES AUTHORITY.

PAIRED DEVICES PROVIDE AUTHENTICATED ACCESS.

THE USER RETAINS CONTROL.
</pasted_content id="03c7">

