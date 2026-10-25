# Verification and completion

A finished execution is not a verification. `completionClaim()` uses the existing sentence when verification was not established:

`Task completed. Independent verification was not established.`

Verified text is allowed only for `performed_passed`. `reviewerReplacesDeterministicCheck()` is false. File hash, process exit, test counts, and external-write evidence each return passed, failed, or unavailable. An uncertain external write stays unavailable and is not retried by `assessReplan()`.

The installed chat task in T0R1 had no verify spec. T1 does not invent one for it. The activity line stays honest.
