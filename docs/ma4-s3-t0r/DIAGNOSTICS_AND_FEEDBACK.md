# Diagnostics and feedback

`LocalBetaFeedbackStore` already persisted when given a file path (`paths.diagnostics/beta-feedback.json` in `http.server.ts`). This change adds `deleteEntry` and the HTTP action `feedback.delete`.

`T0R feedback delete and export survive a new store on the same file` opted in, submitted a secret-shaped detail, asserted the secret was not in the preview or the file, deleted the row, reopened the file in a new store, exported, and cleared. Export is the local JSON document. `remoteUploadDispatched` on the entry stays false. Nothing in this path calls a network upload.

Settings → Runtime diagnostics → `HostCare` calls `diagnostics.health`, preview, save, export (a download started by that button), delete, and clear. The health summary is `buildOperationalHealthSummary` filled from live task rows, the Ollama provider, proactive schedule/monitor counts, and paired-device rows. `missedSchedules` and `cpuMedianPct` are 0 because this view does not have those series. Regex redaction remains behind the allowlisted summary fields.

The screen was not clicked in a browser. Restart persistence was the file-backed store test, not a killed desktop Host process.
