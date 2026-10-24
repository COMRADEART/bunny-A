# MA4-S2-T6 — Cloud Documents & Local Files Qualification (`DOCUMENTS.md`)

- **Gate T6-E Verdict:** **`PARTIAL`** (`PASS` on local approved folders `files.*` and `docs.*` compare-and-swap / diff-preview contract; **`BLOCKED`** on live Google Drive / OneDrive test account credentials)

---

## 1. Local Approved Folders (`src/lib/bunny-host/ma4/connectors/files.server.ts`)

- **Production Status:** **`QUALIFIED_LOCAL`**
- **Path & Link Containment:** `FileRootRegistry` rejects symlinks, Windows directory junctions, relative path traversal (`..`), system directories (`C:\Windows`, `C:\Program Files`), and Bunny A's own state directory.
- **Consequential Writes (`file.apply`):** Stages a pre-write backup in `<DataDir>/connector-backups/`, binds approval to the target file's current hash and the new `payloadSha256`, and verifies completion on recovery via content hash comparison.

---

## 2. Cloud Documents Connector (`src/lib/bunny-host/ma4/connectors/services.server.ts`)

| Operation | Classification | Approval Required | Idempotency | Security & Side-Effect Guarantees |
|---|---|---|---|---|
| `docs.list` | `read` | No (within read grant) | `none` | Lists document metadata (`id`, `title`, `version`); output marked `untrusted: true`. |
| `docs.read` | `read` | No (within read grant) | `none` | Reads document content (`<= 40,000` chars) with its `version`; output marked `untrusted: true`. |
| `docs.write` | `write_consequential` | **Yes (`payloadSha256`-bound)** | `conditional` (`expectedVersion`) | Enforces optimistic concurrency control (`expectedVersion`): if the document changed since it was read (`d.version !== expectedVersion`), `prepare` and `run` fail closed with `ProviderRejected` (`"Document doc-1 is at version v1, not v0-stale."`), verified in `T6-C/D/E`. |
