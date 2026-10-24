# MA4-S2-T5 — Non-Developer Guided First-Run Onboarding (`ONBOARDING.md`)

- **Gate T5-A Verdict:** **`PASS`**

---

## 1. 10-Stage Guided Onboarding Flow

Implemented in [`src/lib/bunny-host/ma4/native-notifications.ts`](../../src/lib/bunny-host/ma4/native-notifications.ts) (`GUIDED_ONBOARDING_STAGE_IDS`, `resolveGuidedOnboardingState`, `evaluateLocalModelReadiness`) and [`src/components/island/journey-model.ts`](../../src/components/island/journey-model.ts) + [`src/components/island/surfaces.tsx`](../../src/components/island/surfaces.tsx):

| Stage Index | Stage ID | User-Facing Purpose | Security & Side-Effect Invariant |
|---|---|---|---|
| `0` | `welcome` | Welcome to Bunny A | Zero permissions or background tasks enabled |
| `1` | `local-architecture` | Explains local-first Host execution vs. model suggestions | Explicitly states models only suggest work; the Host enforces authorization |
| `2` | `preferences` | Preferred owner name & language (`en-US` default) | Stored locally; no external account or cloud sync |
| `3` | `local-model-readiness` | Probes local Ollama (`127.0.0.1:11434`) without a terminal | Filters out `:cloud` / remote models (`evaluateLocalModelReadiness`) |
| `4` | `model-selection` | Selects an installed runnable local model (`qwen2.5-coder:7b`, `deepseek-r1:7b`) | Rejects any `:cloud` model selection (`selectedLocalModel = null`) |
| `5` | `permissions-boundary` | Explains folder registration (`Folders Bunny-A may read`) and per-action approvals | Zero folders or connectors granted automatically |
| `6` | `background-execution-opt-in` | Optional background execution toggle (`backgroundExecutionOptIn`) | Default **`false`**; requires explicit user opt-in |
| `7` | `phone-pairing-optional` | Optional one-time code / QR pairing with Android companion | Skippable (`pairedDeviceSkipped: true` by default) |
| `8` | `voice-check-optional` | Optional local `whisper.cpp` voice readiness check | Skippable (`voiceCheckSkipped: true` by default); never blocks text usage |
| `9` | `first-safe-workflow` | Guides creating a first goal, schedule, monitor, or local task | Uses the standard `Review -> Approve and start` Host preview flow |

---

## 2. Skip & Resume Safety Guarantees

Verified in `T5-A` and `T5-A2` ([`src/lib/bunny-host/ma4-s2t5.test.ts`](../../src/lib/bunny-host/ma4-s2t5.test.ts)):

1. **Skipping Onboarding Never Grants Hidden Permissions:** Calling `resolveGuidedOnboardingState({ status: "skipped", ... })` forces `backgroundExecutionOptIn: false`, `nativeNotificationsOptIn: false`, `implicitPermissionsGranted: 0`, `automaticStartupEnabled: false`, and `cloudInferenceEnabled: false`.
2. **Cloud Models Blocked During Setup:** Any `:cloud` or `remoteModels` entry is excluded from `runnableLocalModels` and placed in `blockedRemoteModels`.
