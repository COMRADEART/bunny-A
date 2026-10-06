# T9 bounded desktop approval policy

This supersedes `policy-design-before-admission-review.md`. The before-model remains
`current-approval-model.md`; existing Allow once, matching-action skill-run approvals,
persistent capability_grants and Mission authorization semantics are preserved.

## Authority and minimum extension

MissionManager computes an offer from concrete planned operations, expanding a known skill's
parameters when applicable. A deliberate `mission.respond(allow_batch)` creates the grant in
the existing Host database. Renderer state and provider claims cannot grant authority.
Capability Bus consults a batch only after the existing permission engine returns ordinary
ask. Denies, standing ask_every_time rules, envelope restrictions and unavailable adapters
remain authoritative. No additional engine, service, database or event store is introduced.

Persistent capability_grants represent policy choices, not atomic finite consumption or
short-lived window identity. The additive approval_batches table in the same MissionStore
is therefore the minimum finite-grant extension. Existing migration key
`ma2.approval-batches.v1` and schema version 3 remain unchanged. The admission review adds
operation digests and native window identity within the existing record JSON, requiring no
additional columns or migration. Old records without digests fail closed; boot recovery
ends active rows regardless.

## Eligibility and exact operations

Only a Host-defined Microsoft Calculator arithmetic profile participates. Each action must
also satisfy the existing implemented/sensitive/hardApproval flags and escalation-aware
risk model at or below EXECUTE. The application profile narrows that structured policy:

- Open `calculator`, with no target, arguments or extra fields.
- Focus exact title `Calculator` or a positive PID, with no extra fields.
- Invoke a known arithmetic AutomationId: digits, arithmetic operators, equal, clear,
  clear-entry, decimal, negate or backspace. Arbitrary name-based controls are excluded.
- Read only the verified CalculatorResults control through `computer.read_calculator`.

Arbitrary typing is excluded entirely, including ordinary text. Screenshots, generic screen
and control reads, clipboard, other apps, file pickers, uploads, shell, Browser Runtime,
filesystem, Git, connectors, installs, payments, security and external effects do not inherit
this batch. Future features need an explicit new application policy, never a model's safety
claim or a guessed sensitive-field blacklist.

Each covered operation is bound to its planned step ID and a SHA-256 digest of the canonical
action and exact parameters. Changed selectors, new fields, new operations, child steps,
foreign Task/Mission/envelope IDs or borrowed batch IDs do not match. The Host re-computes
the current offer before accepting the stored offer; changed plans leave the request open.
Provider routing is absent from grant identity; rerouting alone does not broaden scope.

## Bounds and consumption

An offer requires at least two known eligible mutations. Its budget is
`min(2 × known mutations, 12)`; retry headroom is finite and distinct from the planned count.
TTL is 120,000 milliseconds, chosen for this short deterministic workflow. The client may
only shrink budget and TTL; minimum TTL is 1,000 milliseconds. Host clock is authoritative.
The UI displays the actual maximum, application, expiration, risk ceiling and exclusion of
external effects. Allow once stays primary; batch is secondary; Deny remains available.

One newly admitted mutation consumes one slot, regardless of success. A retry is a new
admission, consumes another slot and also remains subject to the existing retry cap.
READ operations and UI/status refreshes consume no slots. Failed actions cannot enlarge
count, TTL, operations, target or risk ceiling. Expiration and exhaustion request fresh
approval. The guarded SQLite consume updates the count column and JSON together. The
consumption event precedes exhaustion, and canonical counts equal consumption events.

## Target identity and admission races

Titles are lookup hints. Runtime preflight verifies an installed Microsoft.WindowsCalculator
package with Microsoft PublisherId and Store/System signature classification, and verifies
the arithmetic control's executable belongs to that package. The first window operation
pins native handle, frame PID and process start time before admission. Later operations
re-check that exact identity, package and control ownership. A UWP frame PID alone is
insufficient because ApplicationFrameHost may host unrelated applications.

Native Windows checks run again immediately before mutations. An invocation requires an
enabled, non-password Button from the verified content process, InvokePattern and the
approved foreground window. Only normal UWP titlebar/content Window descendants are
allowed; modal, unexpected or sensitive descendants pause. No coordinate fallback is added.
The launcher uses the absolute Windows System32 calc.exe path rather than a PATH lookup.
Post-run owning-PID review is additional evidence, not the authorization boundary.

Preflight is asynchronous. After it, the Bus re-reads canonical Mission/envelope/batch,
re-evaluates policy, and checks cancellation/expiry before consuming. Stop or expiry during
preflight admits nothing. A preflight identity failure ends the batch with scope_mismatch
and returns ask, with zero mutation or budget consumption. Windows/UIA cannot atomically
freeze the entire desktop; the contract is identity revalidation immediately before the
operation, not immunity to malicious privileged OS code or every possible UI race.

## Lifetime, remote and verification

Stop/replan/mission end terminates the batch. Existing owned execution cancellation handles
in-flight operations, and unrelated work survives. Restart recovery ends active batches
with host_restart; per-boot epoch independently prevents old authority reuse. T3 remains
canonical: executing steps are interrupted, approval-paused steps stay paused, GUI actions
are not replayed. UI disconnect may leave already-authorized bounded work running; reload
creates no approval and displays current Host counts.

Workstation and paired-device approvals call the same manager and enforce the same limits.
createdBy records the paired device as context. Revoked devices fail authentication before
dispatch; explicit revoke ends authority. No new public tunnel, auto-start mechanism or
remote bypass is introduced. Execution authorization does not imply safety, provider
completion, Task completion or independent verification.

## Journal and privacy

Existing events record batch_started, consumed, exhausted, expired, scope_mismatch and ended.
They carry bounds, action labels and IDs, not typed values, clipboard data or private reasoning.
Run parameters retain character-count text redaction. Mission renderer snapshots/detail
responses also redact computer.type input and secret-key fields. The private Host plan
retains original execution input for an explicitly approved invocation; it is not an event
or public activity record. No blanket claim of secret absence from every private database
input is made. Typed input cannot acquire batch authority.

## Validation boundaries

Live acceptance uses a staged installed immutable package, disposable production snapshot,
separate workspace, token, port and startup directory. The A–J matrix, Stop during execution,
restart/replay, journal and renderer-privacy checks are evidence, not substituted simulations.
Forged target identity, altered operation, Stop/expiry preflight races, provider-origin changes
and parameter-driven risk escalation are automated adapter simulations. Physical phone,
public tunnel, localized Calculator, multiple monitors, actual UAC/payment dialogs and live
model/vision rerouting are not claimed. Production activation remains deferred until explicit
authorization and the activation procedure's backup/checks. T10 is not started.
