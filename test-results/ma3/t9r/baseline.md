# T9R protected baseline

The task began at T9 evidence commit `89f8217d488fd033bd9489d3ccc16c4d67a85b85` on `claude/ma3-t9-phone-remote`. Accepted T9 executable source is `0a5988c5eef7e6beae3d1622529e2c638cca7788`; accepted T8 executable ancestor is `987afeace77520b9f4ef49e27b137dd01fb3fee8`. Both ancestry checks passed before editing.

`source-before.json` records the original runner, hashes of every tracked existing test file and the 1,043 distinct test floor: scripts 256, library 664, Agent 24, UI 99. No existing test assertion was edited.

`protected-before.json` hashes the four protected untracked reports and `memory/`. The installed production audit resolves `install.json.stateRoot`, opens that actual database read-only in a consistent transaction, and records table/schema digests, installed manifest verification, credentials/configuration/startup hashes and process lifetimes. The observation starts at the timestamp in `production-before.json`; it does not imply earlier T9 whole-task database byte equality.

No public tunnel, installation, production restart, migration, remote push or T10 work was authorized or performed.

Continuation (2026-10-09): a later session resumed from `ea48c40` with every earlier T9R artifact preserved. It added the remote-authority review fixes (`b345aa3`, `0904132`, `395d1c0`) and re-ran every gate on the final source `395d1c0`. Sealed T5–T7 evidence files rewritten by test runs were copied to `prelim/` and restored to their committed versions; no user file was modified.
