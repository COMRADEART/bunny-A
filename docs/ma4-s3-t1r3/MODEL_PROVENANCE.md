# Model provenance

`OllamaReceipt.digest` is `string | null`. `digestFromTags` returns a digest only when exactly one tag name matches the served model. `observedDigest` reads `http://127.0.0.1:11434/api/tags` with a 3 second timeout. A missing or ambiguous digest stays null. The stream and non-stream success paths both set it.

The Host copies `{ name, digest }` onto `task.servedModel` from the `provider.receipt` event. The receipt is emitted even when a later hard-pin check fails. A hard pin (`constraints.modelDigest`) fails the result when the observed digest is missing or different. A preference is not a hard pin. `assertServedIdentity` does not fail PREFERRED when the served digest is null.

The local performance row "Served digest" is measured only when a digest string is present. A name alone shows "unavailable" and is not described as digest verification.

Live evidence, model `huihui_ai/qwen2.5-abliterate:7b`:

- `/api/tags` digest `103482475c9b4d4032999dd5d7383478cad8b966ae6ae984d525daf7352c2219`
- every completed candidate receipt in `evidence/measure.json` stored that same digest on the receipt and on `servedModel`
- the installed-package C0, C1, and C2 tasks stored the same digest
- the Stop task has no digest because the receipt is written when generation finishes, and Stop settled before that

No secret is stored in the receipt. The predecessor process has no `servedModel` field, which is expected for that build.
