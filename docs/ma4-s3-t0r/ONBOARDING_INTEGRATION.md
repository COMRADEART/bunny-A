# Onboarding integration

`surfaces.tsx` `Onboarding` renders `GUIDED_ONBOARDING_STAGE_IDS` (10 stages) with the existing onboarding styles.

Stages: welcome, local-architecture, preferences, local-model-readiness, model-selection, permissions-boundary, background-execution-opt-in, phone-pairing-optional, voice-check-optional, first-safe-workflow.

Model buttons are the models `evaluateLocalModelReadiness` accepts from the live Ollama provider. `saveOnboarding` drops a name that is not in that list, including `:cloud` tags.

Skip calls `resolveGuidedOnboardingState({ status: "skipped" })`, which forces background execution and notification opt-in off and sets `implicitPermissionsGranted` to 0.

The 7-step `ONBOARDING_STEPS` export remains so the older island test still describes that list. The screen no longer reads it.

A fresh installed Windows click-through was **NOT TESTED**.
