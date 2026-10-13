# T9R-F03 baseline

- Branch `claude/ma3-t9-phone-remote`. Starting point `e08edb0`: the F02 evidence commit, on F02 source `02a3c1d` (verdict `BUNNY_MA3_T9R_F02_PASS_WITH_LIMITATIONS`).
- F02 source and sealed evidence (`test-results/ma3/t9r-f02/`) are accepted and left unchanged. F03 adds new commits and this evidence folder.
- Regression floor: **1,235** (F02, all green, 0 skipped).
- Production v26: `production-before.json`. Read-only observation: release `Bunny-A-Windows-v26-MA2-R1`, manifest `81f83786…` (161 files), listeners PID 23016 (`127.0.0.1:8084`) and PID 13672 (`127.0.0.1:43119`).

## Scope (narrow)

1. Repair the four open F02 round-5 MEDIUMs in the D1 consumer classifier:
   - glob, quoted and variable references;
   - folder-level tool configuration;
   - missing consumer names;
   - UTF-16 consumers.
2. Review and repair the three open F02 round-5 LOWs:
   - promotion re-classification without content;
   - Retry revoking grants before its refusal checks;
   - Replan not stamping one-time answers.
3. Reassess process containment (the F01 §7.4 survivor-lineage residual MEDIUM).
4. Independent review of the resulting source, then the full regression on the final source pin.

## Out of scope

- No rebuild of F02 staging or authorization.
- No push, production change or T10 work.
- Physical-phone, LAN and internet-remote behaviour stays **NOT TESTED**.
