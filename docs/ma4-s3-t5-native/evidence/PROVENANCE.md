# Evidence provenance

- `stage1-real-conversation.json`, `stage2-agent-journey.json`, `stage3-wpf-notch.json`, `stage4-android-companion.json`:
  R1, produced by `scripts/verify-native-r1.mjs` at `a9554d8`. Kept as recorded except the bearer token, which R1R2 redacted
  (`authRedaction` field). Stage 1 records `provider: "claude"`, `model: "claude-opus-5-5"`: that run did **not** use Ollama.
  The stage 3 `orphanProcessAudit` followed a forced termination, not a clean exit. Stage 4 is source-pattern checking only.
- `r1r2/<run-id>/`: R1R2, produced by `scripts/verify-native-r1r2.mjs` (UI Automation against the compiled WPF app and an
  isolated real Host). Files are written only through `scripts/evidence-guard.mjs`.
