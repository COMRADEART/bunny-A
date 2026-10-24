# MA4-S3-T0 — Diagnostics and Feedback

## LocalBetaFeedbackStore

| Requirement | Status |
|---|---|
| Explicit opt-in | PASS |
| Sanitized preview | PASS |
| Local persistence | **PASS after T0** — optional `filePath`; Host uses `…/logs/beta-feedback.json` |
| Retention | max 200 entries |
| Export | **PASS after T0** — `exportLocal()` + `feedback.export` |
| Clear history | PASS |
| No automatic upload | PASS (`remoteUploadDispatched: false`) |
| Host commands | `feedback.opt_in|opt_out|status|preview|submit|list|export|clear` (workstation-only) |
| Dedicated settings UI | **PARTIAL** — commands available; polished panel deferred |

## Operational health / support bundle (T7-A/B helpers)

Still primarily contract helpers unless separately wired; pre-existing `OperationalHealth` UI remains.
