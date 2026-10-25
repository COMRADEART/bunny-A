# Context and replanning

`buildTaskContext()` keeps trusted task, capability, prior, and verification text. Retrieved untrusted text is wrapped as data and cannot authorize anything (`contextGrantsAuthority` is always false). Untrusted agent chatter is dropped. The builder stops at a character budget.

`assessReplan()` allows one bounded repair only when the failure is named, the next attempt stays in the original envelope, retries remain, and no consequential external write is uncertain. A changed plan always sets `clearApprovals`. Stale approvals do not carry over.

`admitHandoffCount()` stops at 8 handoffs.

Invalid dependency cycles remain the job of `validateGraph()` in the coding graph. T1 did not replace that checker.
