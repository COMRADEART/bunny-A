# Bunny A MA3 T13.2 implementation

Final executable source: `2ea9bd497830334190c20fa2867363368d965ce4` (2026-10-13).
This document supersedes the recovered preimplementation design. In particular, Anthropic API inference and OpenRouter OAuth from that proposal are **not implemented**.

The Host Connection Registry is a dependency of the existing TaskManager and BunnyRouter. It stores masked provider identities, salted account fingerprints, lifecycle epochs, consent revisions, encrypted API keys and bounded nonsecret usage. No second router or scheduler was added.

Settings → AI & Models → Connected Accounts presents ten manifest-driven families. Native Codex, native Claude Code and local Ollama are the only dispatch surfaces. OpenAI, Anthropic, xAI, Gemini and OpenRouter API keys can be encrypted and checked through fixed metadata endpoints; no API inference adapter is enabled. Identity/delegated modes without client approval and unsupported native tools stay visibly unavailable. No OAuth callback is registered or consumed.

At approval, a Task binds the specific provider, account fingerprint, connection mode, epoch, consent revision and permitted destination accounts. Final dispatch, retries, reroutes, escalations and Jev decisions must satisfy that binding and Project scope. A later global allowance cannot silently replace a destination account captured when the Task was proposed. Local fallbacks narrow exposure. Revocation/account switches cancel bound work and invalidate queued authority. The beforeDispatch wrapper retains Windows owned-job containment.

Native status is read through provider-owned commands. Sign-in launches the configured provider client in a user-controlled window, with no output capture. An email is only a hint. Native auth caches are neither read nor copied. API credentials use per-family Windows DPAPI entropy and opaque Host-only handles. Child environments strip billing credentials, custom auth homes and code-injection variables; Codex pins the OpenAI backend and ignores user configuration, and Claude disables helper hooks/settings and trips on unexpected API billing.

The phone receives only redacted mode/status/billing/eligibility information. Every credential and new-provider authorization operation is denied at the actual Host handler. A review request adds a nonsecret owner notification. Agent input omits Task route bindings and credential handles.

Retention rolls old detail into UTC daily aggregates in transactions of at most 5,000 records. Current local-day budget entries, pending reservations, current Jev session and latest historic Jev request survive. Unknown cost stays unknown. Cleanup is idempotent, configurable and runs in bounded increments; a restart treats unfinished connection reservations as unknown outcomes.

Limitations: provider-reported plan metadata is not live inference entitlement. Actual live provider login, charged inference, delegated authorization, WSL separation, managed gateways and physical phone/microphone execution were not tested. Native clients may consume provider-enabled extra usage; Bunny does not change provider billing settings or guarantee zero vendor charges. API inference and Ollama cloud dispatch remain disabled. Native account replacement uses the provider client rather than simultaneous native profiles. Generic PKCE draft files left from the recovered work are excluded from the source pin/package and confer no implemented capability.
