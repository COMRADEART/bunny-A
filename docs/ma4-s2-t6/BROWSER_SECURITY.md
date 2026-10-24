# MA4-S2-T6 — Controlled Browser Security Qualification (`BROWSER_SECURITY.md`)

- **Browser Connector Verdict:** **`PASS`**

---

## 1. Browser Isolation & Network Boundaries (`src/lib/bunny-host/ma4/connectors/browser.server.ts`)

1. **Origin & Scheme Enforcement:**
   - Production navigation (`browser.open`, `browser.extract`, `browser.submit`) permits only explicitly granted `https:` origins.
   - Blocks `file:`, `javascript:`, `data:`, loopback (`127.0.0.1`, `localhost`, `::1`), link-local (`169.254.0.0/16`), and RFC1918 private network addresses unless the test-only `allowLoopback` seam is set in synthetic fixtures.
2. **Isolated Profile & Process Containment:**
   - Runs in a dedicated profile directory under `<DataDir>/browser-sessions/`, tracked by `HostContainment` (`windows-job-object`) so browser child processes are terminated cleanly on task cancellation or `closeAll()`.
3. **Consequential Form Submission (`browser.submit`):**
   - Classified as `write_consequential` (`requiresExplicitApproval: true`, `idempotency: "none"`).
   - Binds user approval to the exact target URL, form action, and `payloadSha256` of the fields being submitted.
   - If interrupted after dispatch, enters `NEEDS_RECONCILIATION` (`owner_reconcile_required`) — never re-submitting a web form automatically after a crash.
