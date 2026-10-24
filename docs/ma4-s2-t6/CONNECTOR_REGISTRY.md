# MA4-S2-T6 — Connector Registry & Capability Contracts (`CONNECTOR_REGISTRY.md`)

- **Gate T6-A Verdict:** **`PASS`**

---

## 1. Registered Connectors (`src/lib/bunny-host/ma4/connector-registry.ts`)

Every connector in [`src/lib/bunny-host/ma4/connector-registry.ts`](../../src/lib/bunny-host/ma4/connector-registry.ts) declares its provider type, authentication mechanism, supported operations, narrow scopes, data categories, read/write classification, side-effect guarantees, idempotency support, revocation method, audit trail, and recovery behavior:

| Connector ID | Provider Type | Auth Mechanism | Default in Production | Live Qualification Status | Operations (`classification` / `idempotency` / `approval`) |
|---|---|---|---|---|---|
| `files` | `local_host` | `windows_host_acl` | `true` (registered roots only) | `QUALIFIED_LOCAL` | `file.read` (`read`/`none`/`false`), `file.stat` (`read`/`none`/`false`), `file.apply` (`write_consequential`/`conditional`/`true`) |
| `browser` | `controlled_chromium` | `isolated_session_profile` | `true` (permitted HTTPS origins) | `QUALIFIED_LOCAL` | `browser.open` (`read`/`none`/`false`), `browser.submit` (`write_consequential`/`none`/`true`) |
| `email` | `delegated_oauth2` | `oauth2_pkce_vault_scoped` | **`false`** | **`BLOCKED_NO_LIVE_OAUTH_ACCOUNT`** | `email.list` (`read`/`none`/`false`), `email.read` (`read`/`none`/`false`), `email.draft` (`draft`/`key`/`false`), `email.send` (`write_consequential`/`key`/`true`) |
| `calendar` | `delegated_oauth2` | `oauth2_pkce_vault_scoped` | **`false`** | **`BLOCKED_NO_LIVE_OAUTH_ACCOUNT`** | `calendar.events` (`read`/`none`/`false`), `calendar.availability` (`read`/`none`/`false`), `calendar.propose` (`draft`/`none`/`false`), `calendar.create` (`write_consequential`/`none`/`true`) |
| `docs` | `delegated_oauth2` | `oauth2_pkce_vault_scoped` | **`false`** | **`BLOCKED_NO_LIVE_OAUTH_ACCOUNT`** | `docs.list` (`read`/`none`/`false`), `docs.read` (`read`/`none`/`false`), `docs.write` (`write_consequential`/`conditional`/`true`) |

---

## 2. Automated Validation (`validateConnectorRegistration`)

Verified in `T6-A` ([`src/lib/bunny-host/ma4-s2t6.test.ts`](../../src/lib/bunny-host/ma4-s2t6.test.ts)):
- Rejects any connector missing `revocationMethod`, `auditTrail`, or narrow scopes.
- Rejects forbidden wildcard or full-account scopes (`*`, `full_access`, `https://mail.google.com/`, `https://www.googleapis.com/auth/drive`, `Directory.ReadWrite.All`, `Mail.ReadWrite.All`).
- Rejects any `write_consequential` operation with `requiresExplicitApproval: false`.
- Rejects any `read` operation with `untrustedOutput: false`.
- Rejects any `delegated_oauth2` connector with `enabledInProductionByDefault: true`.
