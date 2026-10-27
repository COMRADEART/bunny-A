# T5R1 benchmark count reconciliation

T4R2's `CONTROLLED_BASELINE_COMPARISON.md` and
`ORACLE_VS_PROCESS_RECEIPTS.md` claim **12** process-verified benchmark tasks.
The cited reports do not list the twelve task IDs. The separate T4R2 document
about twelve negative provenance tests describes test cases, not an identified
set of twelve benchmark tasks. No original task-by-task process receipts have
been located in the cited records examined here, so the exact claimed set remains
**unresolved**; assigning `REP-01` through `REP-12` would be speculation.

The frozen dataset contains **15** repair-category entries (`REP-01` through
`REP-15`). The T5 v1 audit inspected all 15, while its narrative incorrectly
called them twelve. A fresh fixture audit again found no `.test.*` or `.spec.*`
reference fixture in these 15 entries. This is a dataset inspection, not proof
that any particular historical benchmark task launched an OS process.

The new `benchmark-reconciliation-audit.v2.json` retains the original claim
count, records the claimed IDs as unknown, and reports the full repair category
count separately. The original audit is retained. Its standalone test-runner
exercise launched an actual temporary Node test process; that does not establish
process-test evidence for any benchmark task.

Historical live-model 54/60 per arm and the controlled 60/60 policy ablation are
separate reported experiments. Text oracle checks do not establish OS-process
testing. This correction does not rewrite historical results.
