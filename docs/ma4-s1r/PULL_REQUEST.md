Real local qualification demonstrates Ollama execution, exact pins, streaming, bounded cancellation and measured CPU/partial GPU use. It also exposes model correctness and strict-format limitations, so production qualification remains **PARTIAL**.

Fixes discovered during qualification:

* Require a completed local inference receipt matching the exact requested model, and reject malformed structured JSON.
* Read current Ollama architecture-qualified context metadata.
* Remove the conflicting mandatory prose summary from read-only exact-format agent steps, while retaining security rules and writer change summaries.
* Prevent the routing graph from dereferencing providers absent from an Ollama-only Host snapshot.
* Correct the inherited provenance fixture's contradiction with S1 local-only privacy, adding a zero-transmission assertion before exercising the explicitly permitted mock sharing path.
* Show a Host runtime-deadline stop as **Stopped · runtime limit reached** rather than a generic stop. A regression test reproduces the original behaviour.
* Supply explicit simulated catalogue facts to legacy team fixtures whose schema-bound requests are now correctly refused without model evidence; preserve unknown/offline behavior and production eligibility checks.

Validation and evidence:

* Two installed 7B models ran locally; four local weights and one unauthorized cloud proxy were inventoried. Large weights were skipped for memory safety.
* Nine-category, 36-sample qualified benchmark: automatic 4/9 versus fixed coder 6/9. No superiority claim. Contaminated planning samples were excluded and replaced using an answer-free prompt with unchanged validators; original evidence remains.
* CPU 8.95 tok/s; partial NVIDIA offload 30.76 tok/s. NPU enumerated, inference NOT TESTED.
* MA4 22 passed / one cloud-live test skipped; focused backend 23 passed; UI 406 passed. Final typecheck and default/shared-mobile-web plus Windows-target builds pass. Full regression outcome and all commands/counts are in the engineering report and evidence JSON.
* Built desktop/mobile smoke: visible content, clean console, no horizontal overflow; both screenshots visually inspected. Real UI approval, pinned-model display, completion, streaming and Stop exercised against isolated Host state.

Security and outstanding gates:

* External inference remains disabled. No live external API/authentication or real provider quota consumption; free-provider procedure is prepared and activation is **PENDING USER APPROVAL**.
* Three real Planner/Worker/Reviewer invocations preserved the exact model and dependencies, but Worker fenced its JSON and failed the objective output check. G7 remains failed; scheduler completion is not claimed as verified workflow success. A pre-registered Python workflow (Planner → Worker ∥ Tester → Reviewer, three trials, hidden tests, harness-only AST-gated execution) also scored **0/3**. Orchestration worked; the 7B model's code did not, and in one trial its Reviewer approved code that fails on import.
* Native tool-call trial returned no tool call; the product Ollama adapter remains tool-free.
* Built-UI re-check of the timeout label, unrestricted production resource admission, installed Windows release acceptance and physical mobile/NPU qualification remain incomplete. The pre-existing dev reference server timed out and was preserved; no dev/build parity pass is claimed.
* Original user changes are preserved in their worktree. Generated MA3 acceptance outputs, binaries, credentials, model weights and machine-specific paths are excluded from this change.

See `docs/ma4-s1r/ENGINEERING_REPORT.md` and its eight linked reports. This PR is reviewable qualification work within MA4-S1R; it does not begin S2 or authorize production release/merge.
