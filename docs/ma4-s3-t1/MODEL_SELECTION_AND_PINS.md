# Model selection and pins

## What T0R1 actually showed

Onboarding stored `selectedLocalModel = qwen2.5-coder:7b`. The local router ran `huihui_ai/qwen2.5-abliterate:7b`. Both were eligible local models. The T0R1 report is right: the stored choice was not a hard pin, and calling it one overstated the contract.

`localModel()` preferred the provider's current local model, then the first local tag. The onboarding field was never an input.

## Three meanings

| Name | Meaning | Failure |
| --- | --- | --- |
| Preference | Owner's preferred local model for a class of work | If it is missing, stop and list other authorized local models. Nothing is selected until the owner picks one |
| Execution selection | The model this task will run | Recorded with provider, id, digest when known, mode, and reason |
| Hard pin | Exact id and digest | Digest or id mismatch selects nothing |

`HARD_PIN`, `PREFERRED`, and `AUTO_LOCAL` are the T1 modes. Existing `modelExact` remains a name pin and is not overwritten by a preference. `modelDigest` plus `modelExact` is checked at revalidation against the last digest the local runtime reported. A missing digest fails closed. Nothing downloads a model, and cloud tags are rejected.

## Where it is applied

Local-only, offline, and privacy-local tasks read the saved onboarding model inside the Host. The public constraint parser does not accept `preferredLocalModel` from a client. A fact-bearing pipeline may not replace that preference with a higher score. Hosted decision advice runs before this check and cannot leave a different model in place.

## Tests

`src/lib/bunny-host/ma4-s3-t1.test.ts` covers exact pin match, digest mismatch, missing model, preferred model unavailable, authorized alternate, unauthorized alternate, a remote candidate, and a served identity that changes after selection. A Host submit with current model `huihui_ai/qwen2.5-abliterate:7b` and saved preference `qwen2.5-coder:7b` launches the preference and does not set `modelExact`.
