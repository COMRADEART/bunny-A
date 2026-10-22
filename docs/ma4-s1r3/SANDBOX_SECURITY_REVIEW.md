# MA4-S1R3 sandbox security review — R3-G6 (Phase E)

## Preserved enforcement (S1R2, unchanged)

WSL2 user/mount/pid/net/ipc/uts/cgroup namespaces; `pivot_root` into a read-only tmpfs root (read-only `/usr`; noexec, size-capped `/work` and `/tmp`; no `/mnt/c`, `/home`, `/run`); empty network namespace; systemd user scope with cgroup `memory.max`, `memory.swap.max=0` and `pids.max`; all capabilities dropped; `no_new_privs`; rlimits (CPU, FSIZE, NOFILE, NPROC, CORE); empty environment; wall-clock SIGKILL; output cap; whole-tree kill and workspace removal.

## E1 — seccomp: implemented (commit `9548eac`)

**Feasibility.** The WSL2 kernel (`6.18.33.2-microsoft-standard-WSL2`) has `CONFIG_SECCOMP=y` and `CONFIG_SECCOMP_FILTER=y`. A process with `no_new_privs` may install its own filter without privilege. No component was installed, and no host or kernel configuration was changed. Before S1R3, untrusted code inside the sandbox **could still create nested user namespaces** (`max_user_namespaces` = 63133), which exposes kernel userns attack surface. The filter closes that.

**Design** (`sandbox-launcher.py` `install_seccomp()`): a classic-BPF deny-list built with `ctypes`, installed in stage 2 as the **last step before** `execve` of the untrusted program's wrapper chain, after every mount/`pivot_root`, and inherited across `execve`. If installation fails, it raises and the run fails; nothing executes unfiltered.

| Rule | Action |
|---|---|
| arch ≠ `AUDIT_ARCH_X86_64` (i386 `int 0x80`) | kill process |
| x32 ABI (`nr ≥ 0x40000000`) | EPERM |
| `unshare`, `setns`, `clone` with any `CLONE_NEW*` flag | EPERM |
| `clone3` (flags are behind a pointer and cannot be inspected) | ENOSYS, so libc falls back to `clone`, which is checked |
| `mount`, `umount2`, `pivot_root`, `chroot`, new mount API (`open_tree`, `move_mount`, `fsopen`, `fsconfig`, `fsmount`, `fspick`, `mount_setattr`) | EPERM |
| `ptrace`, `process_vm_readv/writev`, `kcmp`, `perf_event_open` | EPERM |
| `add_key`, `request_key`, `keyctl`, `bpf`, `userfaultfd`, `io_uring_setup/enter/register` | EPERM |
| module, kexec, clock, swap, reboot, hostname, iopl/ioperm, quotactl, acct, syslog, personality, vhangup, `*_handle_at`, `lookup_dcookie` | EPERM |
| everything else | allow |

`sandboxAvailability()` now also requires `checks.seccomp`: the probe installs the filter in a child and confirms that `unshare(CLONE_NEWUSER)` is refused. Without it, dynamic execution is BLOCKED (fail closed, as before).

**Limits (stated, not hidden):** this is a deny-list, not an allow-list; the namespaces, cgroups, read-only root and empty network remain the primary boundary. The WSL distribution is still the trust root. There is still no cgroup CPU quota (RLIMIT_CPU and the wall clock bound CPU time). WSL2 only.

## E2 — qualification (live, this host)

`node --experimental-strip-types --test src/lib/bunny-host/ma4-sandbox.test.ts` → **13/13 pass** (`evidence/sandbox-adversarial.log`): the 2 contract tests, the 11 S1R2 live adversarial fixtures (F4.1 host/Windows/home/launcher reads; F4.2 secrets; F4.3/F4.10 network, DNS, Ollama/loopback; F4.4 spawn cap and Windows interop; F4.5 writes and persistence; F4.6 memory; F4.7 CPU/runtime; F4.8 output; F4.9 detached descendants; F4.11 cancellation cleanup), and the new **F5**:

* `/proc/self/status` `Seccomp: 2` inside the program
* `unshare(CLONE_NEWUSER)`, raw `clone(CLONE_NEWUSER)`, `setns`, `ptrace`, `mount`, `keyctl`, `bpf`, `io_uring_setup` and `perf_event_open` → all EPERM
* ordinary work still runs: `fork` (exit status propagated) and `subprocess` spawn (`clone3` → ENOSYS fallback) work

Negative control: F5 **fails** against the pre-seccomp launcher (`evidence/sandbox-f5-negative-control.log`), so it detects the absence of the filter. All harmless fixtures run only inside the sandbox; no generated or adversarial code ran on Windows or in an unrestricted WSL process. The coding-workflow suites (16 tests, live sandbox) and G7 run 2 ran under the seccomp sandbox.

## E3 — independence from model quality

No sandbox permission, limit or allowlist was relaxed for any model or task. The G7 runs use the same `SANDBOX_LIMITS` (20 s, 256 MiB, 8 pids, 256 KiB output) as S1R2.

**Security status: PASS, scoped to this host.** Seccomp has been added and qualified; the WSL distribution remains the trust root.
