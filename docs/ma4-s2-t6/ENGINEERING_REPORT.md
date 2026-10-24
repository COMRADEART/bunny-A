# BUNNY A — MA4-S2-T6 ENGINEERING REPORT

## Milestone
`MA4-S2-T6 — Real Connected Services & Safe Action Qualification`

## Repository & Branch
- **Repository:** `https://github.com/COMRADEART/bunny-A`
- **Base Branch:** `ma4-s2-t5-native-experience` (`fa07f5d56b00aa5165d9758bd6d27d254324942c`, Draft PR #31)
- **Working Branch:** `ma4-s2-t6-provider-integrations`

## Executive Summary
- **Overall Milestone Verdict:** **`PARTIAL`** (`PASS` on `T6-A` Connector Registry, `T6-B` OAuth Scope & Confused-Deputy Governance, `T6-C/D/E` Email/Calendar/Docs/Files/Browser Contract & Prompt-Injection Defense; **`BLOCKED`** on `T6-F` Live External OAuth Provider Qualification because no non-production Gmail / Microsoft Graph / Google Drive test accounts or OAuth client credentials are provisioned in this environment).
- **Key Engineering Deliveries:**
  1. **Formal Connector Registry (`T6-A`):** Implemented [`src/lib/bunny-host/ma4/connector-registry.ts`](../../src/lib/bunny-host/ma4/connector-registry.ts) (`CONNECTOR_REGISTRY`, `validateConnectorRegistration`), declaring capabilities, narrow scopes, data categories, read/draft/consequential classification, idempotency, revocation, audit trails, and recovery behaviors across `files`, `browser`, `email`, `calendar`, and `docs`.
  2. **OAuth Scope & Account Isolation Enforcement (`T6-B`):** Implemented `verifyOAuthOperationAuthorization`, rejecting wildcard scopes (`*`, `https://mail.google.com/`, `Directory.ReadWrite.All`), expired/revoked grants, and cross-account confused-deputy requests.
  3. **Idempotency, Optimistic Concurrency & Prompt-Injection Boundary (`T6-C/D/E`):** Verified in [`src/lib/bunny-host/ma4-s2t6.test.ts`](../../src/lib/bunny-host/ma4-s2t6.test.ts) that `email.send` deduplicates by `idempotencyKey`, `docs.write` refuses stale `expectedVersion` overwrites, and untrusted connector outputs (`RESULT_SCHEMA`) cannot be piped directly into `bodyFrom` / `contentFrom`.
  4. **Honest Live Provider Status (`T6-F`):** Kept `email`, `calendar`, and `docs` disabled by default in production (`enabledInProductionByDefault: false`, `liveQualificationStatus: "BLOCKED_NO_LIVE_OAUTH_ACCOUNT"`).

## Verification Results
- `node --experimental-strip-types --test src/lib/bunny-host/ma4-s2t6.test.ts`: **`4/4 PASS`** (`183 ms`).

## Artifact Index (`docs/ma4-s2-t6/`)
- [`CONNECTOR_REGISTRY.md`](CONNECTOR_REGISTRY.md)
- [`OAUTH_AND_SCOPES.md`](OAUTH_AND_SCOPES.md)
- [`EMAIL.md`](EMAIL.md)
- [`CALENDAR.md`](CALENDAR.md)
- [`DOCUMENTS.md`](DOCUMENTS.md)
- [`BROWSER_SECURITY.md`](BROWSER_SECURITY.md)
- [`LIVE_PROVIDER_QUALIFICATION.md`](LIVE_PROVIDER_QUALIFICATION.md)
- [`ENGINEERING_REPORT.md`](ENGINEERING_REPORT.md)
