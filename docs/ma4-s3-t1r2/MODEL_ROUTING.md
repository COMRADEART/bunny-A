# Model routing

The timed model is `huihui_ai/qwen2.5-abliterate:7b`, digest `103482475c9b4d4032999dd5d7383478cad8b966ae6ae984d525daf7352c2219`. Ollama 0.40.9 reported that digest, and the Host receipts reported the same name. Receipts include the served name, token counts, and durations. They do not include the digest.

| Probe | Result |
| --- | --- |
| Saved onboarding preference for an installed local model | The next local-only chat selected `huihui_ai/qwen2.5-abliterate:7b`. |
| `onboarding.save` of `not-installed:7b` | The API stored `null`. The following submit still selected the installed 7B. Saving an unknown model clears the preference. It does not fail the request. |
| Preference already stored as `not-installed:7b` | HTTP 400, `MODEL_APPROVAL_REQUIRED`. The error names the installed local models and says no alternate was selected. `model` is null. This required writing the row in `guided_onboarding_v1` after the process had stopped, then starting the Host again. The save API will not store that value. |
| `constraints.modelExact` set to the pinned 7B | HTTP 200. The selected model is that 7B. The pin checked in this run is the model id. The receipt still has no digest. |
| Local-only task with a cloud `modelOverride` | HTTP 400. `model` is null. The error says the privacy requirement keeps data on this workstation, the candidate leaves the machine, and no alternative was selected. |
| `AUTO_LOCAL` with an unauthorized model or a cloud-only pool | Covered by `selectExecutionModel` in `src/lib/bunny-host/ma4-s3-t1.test.ts`. Those assertions reject the unauthorized id and a cloud-only pool. This qualification did not drive that mode through a live Host submit. |

`preferEligibleLocal` is the preference hook on the live submit path. `classifyTask`, `admitWork`, and `orderQueue` are not called there. A C0 chat and a C1 file read therefore do not take different executor paths because of the classifier. C1 made no model call because the measured work was `file.read`.
