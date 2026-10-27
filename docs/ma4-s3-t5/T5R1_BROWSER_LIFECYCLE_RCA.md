# T5R1 browser lifecycle investigation — preliminary

The T5 task state is committed synchronously; the old terminal callback discarded
the promise returned by task-scoped browser cleanup. A disposable failed-download
probe at baseline head `08a22c51857012e4c3035169a362216a1de156e5` observed
`FAILED` while one browser session was still closing; awaiting cleanup reduced
the count to zero. This establishes a terminal/teardown race, not the precise
reason the hosted run exceeded its 2.5 second polling window.

The proposed correction tracks terminal cleanup, exposes an explicit completion
barrier, counts closing sessions until cleanup succeeds, coalesces repeated closes,
and reports cleanup failures. Cancellation requests close the task's browser.
Page acquisition is synchronized with closure; closing a context during page
creation caused a reproducible hang in an earlier local implementation.

Local evidence so far: the full browser test file passed, including cookie and
profile isolation, failed download, repeated close/error handling, cancellation
at startup, and cancellation after an actual request reached a delayed server.
Twenty later repetitions under four concurrent processes passed. One earlier
repetition failed and stalled while the full MA4 suite and stress run were both
active; its assertion detail was not recovered before interruption. This remains
unresolved and is not erased by the later passes. A separate MA4 run reported
315 passed, 2 skipped, 0 failed. Host CI on this correction has not run.

The physical desktop, audio, Android, and installation gates are not qualified
by these browser tests. Public beta remains NO-GO.
