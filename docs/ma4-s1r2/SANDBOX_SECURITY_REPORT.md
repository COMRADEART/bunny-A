# MA4-S1R2 sandbox security report — R2-G5 / R2-G6

## Decision

The S1R harness limited generated Python with an AST import allowlist plus a Windows job object. That is not a security boundary (import gates are bypassable and the child shared the user's filesystem and network). S1R2 replaces it, for qualification execution, with **kernel-enforced isolation inside WSL2**.

Options evaluated on this host (Windows 11 Pro 26300, WSL2 kernel `6.18.33.2-microsoft-standard-WSL2`):

| Option | Status here | Verdict |
|---|---|---|
| Docker / container runtime | not installed | would need install approval |
| bubblewrap / nsjail / firejail in WSL | not installed | would need install approval |
| Windows Sandbox / Hyper-V VM | feature state not readable without elevation; heavy per-run boot | not used |
| AppContainer via native helper | would need new native code + review | deferred |
| **util-linux `unshare` + `pivot_root` + systemd user scope (cgroup v2)** | present in Ubuntu 24.04 WSL2, unprivileged user namespaces enabled, user cgroup delegation of `memory`/`pids` verified | **chosen** — established kernel mechanisms, nothing installed |

WSL itself, ordinary subprocesses, import scanning or `cwd` changes are not treated as isolation. The isolation comes from the namespaces/cgroups listed below, verified by observed behaviour.

## Mechanism (`src/lib/bunny-host/ma4/sandbox.server.ts`, `sandbox-launcher.py`)

1. Windows Host → `wsl.exe --exec /usr/bin/python3 -I <launcher>`; request JSON on stdin (no shared files, no shell). The launcher validates names (`^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$`), sizes (≤1 MiB, ≤32 files), program allowlist (`python3` only) and limit ranges.
2. `systemd-run --user --scope -p MemoryMax=… -p MemorySwapMax=0 -p TasksMax=…` → cgroup v2 limits.
3. `unshare --user --map-root-user --mount --pid --net --ipc --uts --cgroup --fork --kill-child`.
4. Inside: private mount propagation; a fresh tmpfs root containing only read-only `/usr` (rbind), `/dev/{null,zero,urandom,random}`, a private `/proc`, a tiny `/etc/passwd`, and size-capped `noexec,nosuid,nodev` tmpfs `/work` and `/tmp`; root remounted read-only; `pivot_root` + detach of the old root. `/mnt/c`, `/home`, `/run` (WSL interop socket), `/init` and the host `/tmp` are unreachable.
5. `setpriv --no-new-privs` with all capability sets cleared; `prlimit` CPU / file size / open files / core / nproc; empty environment except `PATH, HOME, LANG, PYTHONDONTWRITEBYTECODE, PYTHONHASHSEED`; `timeout -s KILL`.
6. The launcher bounds combined output, kills the scope on overflow, deadline, any further stdin line, or stdin EOF (the Windows side dying), then reports systemd's own unit accounting (`Result=oom-kill`, remaining tasks), resets the unit and removes the temporary workspace.
7. Fail closed: `sandboxAvailability()` proves prerequisites with a live probe (namespaces + an actual 64 MiB / 8-task cgroup reading). If unproven, `runSandboxed` throws `SandboxBlocked` and **never** falls back to a plain subprocess. A forged or malformed result is rejected by schema (backend name is a literal).

## Adversarial results (live, inside the sandbox; harmless fixtures)

Command: `node --experimental-strip-types --test src/lib/bunny-host/ma4-sandbox.test.ts` (part of `npm run test:ma4`). Log: `evidence/ma4-s1r2-suites.log`. **12/12 passed, 0 skipped** on this host.

| # | Attempt | Observed |
|---|---|---|
| F4.1 | read `/etc/shadow`, `/etc/hostname`, `/mnt/c/Windows/win.ini`, `/home`, `/root`, `/run/WSL`, `/init`, `/proc/1/root/...`, `/sys` | every path raised an error; root listing exactly `bin dev etc lib lib64 proc sbin tmp usr work`; `/work` holds only the submitted file |
| F4.2 | environment secret | canary injected into the WSL user env (positive control: visible to `printenv` outside); inside: absent from `os.environ` and every `/proc/*/environ`; env keys exactly the 5 allowed |
| F4.3/F4.10 | TCP to 1.1.1.1:443, 8.8.8.8:53, 127.0.0.1:11434 (Ollama), 127.0.0.1:22, 172.17.0.1:80; DNS; abstract unix socket | all failed; only one (down) loopback interface; positive control: DNS works for the WSL user outside |
| F4.4 | fork until failure (pids=8); exec a Windows PE via `memfd` (WSL interop) | forks stopped below the cap with `BlockingIOError`; PE exec failed (binfmt interpreter `/init` not reachable) |
| F4.5 | write `/x`, `/usr/x`, `/etc/x`, `/dev/x`, `/proc/x`; exec from `/work`; `mount`; `setuid(1000)` | all writes outside `/work`,`/tmp` failed; `/work` is `noexec`; mount and setuid failed; workspace removed afterwards |
| F4.6 | allocate 1 GiB with `memoryMb=64` | killed by the cgroup OOM killer (`Result=oom-kill`), nothing printed |
| F4.7 | busy loop, 1.5 s limit | `timedOut`, no remaining processes |
| F4.8 | infinite stdout, 4 KiB cap | truncated at the cap, program killed, no remaining processes |
| F4.9 | double-fork + `setsid` daemon | killed with the pid namespace; `pgrep` in WSL finds no orphan |
| F4.11 | cancel after 1.5 s with 3 sleeping children | `cancelled`, tree gone (`pgrep` empty), workspace removed, < 15 s |

Contract tests (always run, also in CI): traversal names, non-allowlisted programs, out-of-range limits and unknown keys are refused; an unproven backend and a crashing probe block execution; garbage or forged results are rejected.

## Limits and residual risks

* Trust root: the WSL2 VM and the WSL user. The sandbox protects Windows files, secrets, the network and host services from generated code; it does not defend against a compromised WSL distribution or a kernel exploit (no seccomp filter is installed — `libseccomp` tooling is not present; adding it would need approval).
* CPU is bounded by `RLIMIT_CPU` + wall-clock kill, not a cgroup CPU quota (the user slice does not enable the `cpu` controller in `subtree_control`).
* `/usr` is visible read-only (needed for the interpreter). Programs can read world-readable files under `/usr`, nothing else.
* Windows-host only. On CI runners without WSL2 namespaces the adversarial fixtures report **SKIPPED (not passed)**; contract tests still run.
* Python only (`argv[0]` allowlist). Other runtimes need explicit review before allowlisting.

**Disposition: R2-G5 PASS, R2-G6 PASS** (this host, live evidence).
