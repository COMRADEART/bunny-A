# MA4-S1R4 — Sandbox validation (R4-G10)

S1R4 did not change the sandbox (`ma4/sandbox.server.ts`, `sandbox-launcher.py` are byte-identical to `e93f5ae`).
It changed **how often** generated code reaches it (Worker samples are statically checked and tested) and put every
invocation behind the permission broker with a bounded count and a receipt (TOOL_AUGMENTATION_REPORT).

## Adversarial suite — live, this host, S1R4 branch

`node --experimental-strip-types --test src/lib/bunny-host/ma4-sandbox.test.ts` → **13/13 pass**
(`evidence/sandbox-adversarial.log`):

| Fixture | Result |
|---|---|
| request validation (traversal names, non-allowlisted programs, limits) | pass |
| fail closed (unproven backend, malformed result) | pass |
| F4.1 host / Windows drive / home / launcher reads | pass |
| F4.2 environment secrets | pass |
| F4.3/F4.10 network, DNS, Ollama and loopback | pass |
| F4.4 spawn cap, Windows interop executables | pass |
| F4.5 writes outside the workspace, workspace discarded | pass |
| F4.6 cgroup memory limit | pass |
| F4.7 CPU / wall-clock limit | pass |
| F4.8 output cap | pass |
| F4.9 detached descendants | pass |
| F4.11 cancellation kills the tree and cleans up | pass |
| F5 seccomp: namespace, mount, ptrace, keyring, BPF, io_uring syscalls → EPERM | pass |

Backend reported by every S1R4 run: `wsl2-userns-pivot_root-cgroupv2`, kernel `6.18.33.2-microsoft-standard-WSL2`.

## Workflow-level checks (live sandbox)

* `ma4-workflow.test.ts` (10) and `ma4-repair.test.ts` (6): unchanged S1R3 behaviour, 16/16.
* `ma4-s1r4.test.ts`: broker denial → **zero** sandbox executions; tool budget → `resource_exhaustion`; sample
  selection never executes the hidden tests (asserted per sandbox call). 7/7.
* Every runner refuses to start without the sandbox (fail closed) and enforces a localhost-only fetch allowlist.

## Limits (unchanged)

Trust root is the WSL distro; the seccomp filter is a deny-list, not an allow-list. Hosted CI has no WSL2, so the
adversarial suite is a local gate and is reported as NOT TESTED on hosted runners.
