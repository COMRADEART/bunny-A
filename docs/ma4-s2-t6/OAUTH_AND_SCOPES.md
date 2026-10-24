# MA4-S2-T6 — OAuth & Delegated Scope Governance (`OAUTH_AND_SCOPES.md`)

- **Gate T6-B Verdict:** **`PASS`** (Contract & security enforcement verified; live external OAuth credentials `BLOCKED` per `LIVE_PROVIDER_QUALIFICATION.md`)

---

## 1. Narrow Scope Enforcement & Account Isolation

Implemented in [`src/lib/bunny-host/ma4/connector-registry.ts`](../../src/lib/bunny-host/ma4/connector-registry.ts) (`verifyOAuthOperationAuthorization`) and [`src/lib/bunny-host/ma4/connectors/services.server.ts`](../../src/lib/bunny-host/ma4/connectors/services.server.ts) (`CredentialVault`):

1. **Least-Privilege Per-Operation Scopes:**
   - Reading email headers requires `mail.read.metadata`; reading bodies requires `mail.read.body`; creating drafts requires `mail.compose.draft`; sending mail requires `mail.send`.
   - A grant with `["mail.read.metadata", "mail.read.body", "mail.compose.draft"]` is permitted to list, read, and create drafts, but is **refused** before dispatch on `email.send` (`Missing required narrow scope(s): mail.send`).
2. **Cross-Account Confused-Deputy Prevention:**
   - Every operation names its `account` (`ACCOUNT_ID`), and `verifyOAuthOperationAuthorization` verifies `grant.account === requestedAccount`. Attempting to use `work@example.com`'s grant for `personal@example.com` is refused (`Cross-account confused-deputy blocked`).
3. **Vault-Scoped Credentials (Zero Token Leakage):**
   - `ServiceProvider` fetches bearer tokens from `CredentialVault` by `(provider, account)` inside the Host adapter. Raw OAuth tokens never appear in task step inputs, outputs, prompts, checkpoints, receipts, or logs.
4. **Immediate Revocation & Expiry:**
   - Revoking a grant (`revoked: true`) or reaching `expiresAt <= now` fails closed immediately before any provider call is dispatched.
