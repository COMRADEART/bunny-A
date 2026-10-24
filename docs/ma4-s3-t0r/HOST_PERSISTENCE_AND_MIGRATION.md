# Host persistence and migration

Setting key `guided_onboarding_v1`, schema `{ schema: 1, state }`, table `settings`.

`migrateLegacyOnboarding` maps a `{ status, step }` blob from the 7-step list onto a stage index. It does not copy `backgroundExecutionOptIn`, `nativeNotificationsOptIn`, or `selectedLocalModel` out of that blob. The unit test passes a legacy blob that tries to set all three and asserts they stay off or null.

`onboarding.get` returns the Host row or null. The screen migrates browser storage only when the Host has no row, then `onboarding.save` writes the migrated state. A later get returns the Host row.

A model is kept only when the current Ollama catalogue lists it as runnable. The test saves `missing:7b` against a catalogue of `qwen2.5-coder:7b` and reads back null.
