# NOT COUNTED — superseded complete regression at c8c46c9

This complete regression ran at the first implementation commit
`c8c46c914b53d5693927ba3361a2aa7b36828519` from a clean detached worktree.

All phases passed except the library phase: 1,451 tests ran and 1 failed. The failure was
`provider-containment` F04 R3-BYPASS-CWD-1, because `jev-secrets.server.ts` launched `powershell.exe`
by bare name. That defect, together with the independent-review findings, is fixed in
`aa134f5efb6748f21ec9a5fe4eae83f4c2d8d86f`.

The counted complete regression is `../regression-final/`, run at the final source pin. Cases here are
not added to any total.
