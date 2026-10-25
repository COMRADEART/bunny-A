# Model routing verification

## Preference is not a silent fallback

`selectExecutionModel` no longer selects another model when `allowAuthorizedAlternate` is set. That flag only returns the authorized local choices. A different model is used only when `acceptedAlternateId` is one of those choices and it has a digest.

`bunnyRoute` and the Host throw `preferenceUnavailable`, which names the authorized local models and says none was selected. The model-selection step says the saved choice is a preference, and that Bunny will not substitute another local model.

## Same provider list, predecessor `bc1c82d` vs this branch

The list is the models Ollama reported on this machine. Current model is `huihui_ai/qwen2.5-abliterate:7b`. Evidence: `evidence/routing-compare.json`.

| Case | T1 | Predecessor |
| --- | --- | --- |
| Preference is the installed 7B | `huihui_ai/qwen2.5-abliterate:7b` | same |
| Preference is installed `qwen2.5-coder:7b` | `qwen2.5-coder:7b` | stays on the current 7B |
| Preference `not-installed:7b` | error, lists the four local models, selects nothing | stays on the current 7B |

The predecessor ignores `preferredLocalModel` and keeps the provider's current local model. T1 follows an installed preference. A missing preference fails closed here and does not on `bc1c82d`.

## Pins, pool, digest

Covered by `src/lib/bunny-host/ma4-s3-t1.test.ts` and `ma4-s3-t1r.test.ts`:

- Hard pin with a mismatched digest selects nothing.
- A missing pin selects nothing.
- `AUTO_LOCAL` rejects a pool that is only cloud or unauthorized.
- A preferred model with a null digest selects nothing.
- `assertServedIdentity` rejects a different id or a changed digest.

No cloud tag was sent to Ollama during the live sample. The live call checked the 7B digest before the first generate.
