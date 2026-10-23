"""Bunny A MA4-S1R2 qualification sandbox launcher (trusted; runs inside WSL2 as the WSL user).

Isolation is enforced by the Linux kernel, not by this script's checks:
  * systemd user scope: cgroup v2 memory.max, memory.swap.max=0, pids.max
  * unshare: new user, mount, pid, net, ipc, uts and cgroup namespaces
  * pivot_root into a read-only tmpfs root holding only /usr (read-only), a few device nodes,
    a private /proc, and size-capped noexec tmpfs /work and /tmp; the host filesystem,
    /mnt/c, /run (WSL interop socket) and /home are never mounted
  * all capabilities dropped, no_new_privs, rlimits (CPU, file size, open files, core)
  * seccomp-BPF (MA4-S1R3): namespace creation, mount, ptrace, keyrings, BPF, io_uring, module/kexec/clock control → EPERM;
    foreign syscall ABIs killed. Installed unprivileged (no_new_privs) and inherited by the program.
  * empty environment, wall-clock SIGKILL, bounded output; killing pid 1 kills the namespace

Protocol: one JSON request line on stdin, then optional "cancel" line (or EOF) to stop.
One JSON result line on stdout. Never prints untrusted output outside that JSON.
"""
import ctypes, json, os, re, select, shutil, signal, struct, subprocess, sys, tempfile, threading, time, uuid

NAME = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$")
LIMITS = {"timeoutMs": (100, 120_000), "memoryMb": (32, 1024), "pids": (1, 64), "outputBytes": (1024, 1_048_576), "diskMb": (1, 256)}
PROGRAMS = {"python3": "/usr/bin/python3"}


# x86_64 syscalls an untrusted test program never needs; each returns EPERM. Defense in depth on top of the namespaces:
# nested namespaces, mounts, tracing, kernel keyrings, BPF, io_uring, module/kexec/clock/swap/reboot control.
DENY = {101: "ptrace", 103: "syslog", 135: "personality", 153: "vhangup", 155: "pivot_root", 159: "adjtimex", 161: "chroot", 163: "acct", 164: "settimeofday",
        165: "mount", 166: "umount2", 167: "swapon", 168: "swapoff", 169: "reboot", 170: "sethostname", 171: "setdomainname", 172: "iopl", 173: "ioperm",
        175: "init_module", 176: "delete_module", 179: "quotactl", 212: "lookup_dcookie", 227: "clock_settime", 246: "kexec_load", 248: "add_key",
        249: "request_key", 250: "keyctl", 272: "unshare", 298: "perf_event_open", 303: "name_to_handle_at", 304: "open_by_handle_at", 305: "clock_adjtime",
        308: "setns", 310: "process_vm_readv", 311: "process_vm_writev", 312: "kcmp", 313: "finit_module", 320: "kexec_file_load", 321: "bpf",
        323: "userfaultfd", 425: "io_uring_setup", 426: "io_uring_enter", 427: "io_uring_register", 428: "open_tree", 429: "move_mount", 430: "fsopen",
        431: "fsconfig", 432: "fsmount", 433: "fspick", 442: "mount_setattr"}
CLONE_NS_FLAGS = 0x7E020000  # CLONE_NEWNS|NEWCGROUP|NEWUTS|NEWIPC|NEWUSER|NEWPID|NEWNET


def install_seccomp():
    """Installs a seccomp-BPF filter on this process (inherited across execve). Needs only no_new_privs, no privilege."""
    ld_abs, jeq, jge, jset, ret = 0x20, 0x15, 0x35, 0x45, 0x06
    allow, kill, eperm, enosys = 0x7FFF0000, 0x80000000, 0x00050000 | 1, 0x00050000 | 38
    prog = [(ld_abs, 0, 0, 4), (jeq, 1, 0, 0xC000003E), (ret, 0, 0, kill),  # foreign ABI (i386) → kill
            (ld_abs, 0, 0, 0), (jge, 0, 1, 0x40000000), (ret, 0, 0, eperm)]  # x32 ABI → EPERM
    for nr in sorted(DENY):
        prog += [(jeq, 0, 1, nr), (ret, 0, 0, eperm)]
    # clone3 hides its flags in memory: ENOSYS makes libc fall back to clone, whose flags are checked below.
    prog += [(jeq, 0, 1, 435), (ret, 0, 0, enosys),
             (jeq, 0, 3, 56), (ld_abs, 0, 0, 16), (jset, 0, 1, CLONE_NS_FLAGS), (ret, 0, 0, eperm),
             (ret, 0, 0, allow)]
    filters = (ctypes.c_ubyte * (8 * len(prog)))()
    for i, (code, jt, jf, k) in enumerate(prog):
        ctypes.memmove(ctypes.byref(filters, 8 * i), struct.pack("=HBBI", code, jt, jf, k), 8)

    class Fprog(ctypes.Structure):
        _fields_ = [("len", ctypes.c_ushort), ("filter", ctypes.c_void_p)]
    fprog = Fprog(len(prog), ctypes.addressof(filters))
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(38, 1, 0, 0, 0) != 0:  # PR_SET_NO_NEW_PRIVS
        raise OSError(ctypes.get_errno(), "no_new_privs failed")
    if libc.prctl(22, 2, ctypes.byref(fprog), 0, 0) != 0:  # PR_SET_SECCOMP, SECCOMP_MODE_FILTER
        raise OSError(ctypes.get_errno(), "seccomp filter install failed")


def fail(message):
    print(json.dumps({"ok": False, "error": message}), flush=True)
    sys.exit(2)


def validate(req):
    if not isinstance(req, dict) or set(req) - {"files", "argv", *LIMITS}:
        fail("invalid request shape")
    files = req.get("files")
    if not isinstance(files, dict) or not 1 <= len(files) <= 32:
        fail("files must be a non-empty object of at most 32 entries")
    total = 0
    for name, content in files.items():
        if not NAME.match(name) or not isinstance(content, str):
            fail("invalid file entry")
        total += len(content.encode())
    if total > 1_048_576:
        fail("files exceed 1 MiB")
    argv = req.get("argv")
    if not isinstance(argv, list) or not argv or not all(isinstance(a, str) and len(a) < 256 for a in argv) or argv[0] not in PROGRAMS:
        fail("argv must start with an allowlisted program")
    for key, (lo, hi) in LIMITS.items():
        v = req.get(key)
        if not isinstance(v, int) or isinstance(v, bool) or not lo <= v <= hi:
            fail(f"{key} out of range")
    return req


def run(cmd):
    r = subprocess.run(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
    if r.returncode:
        raise RuntimeError("sandbox setup failed: %s: %s" % (" ".join(cmd[:3]), r.stderr.strip()[:300]))


def stage2(base, config_path):
    """Runs as uid 0 of a fresh user namespace (no host privilege), pid 1 of a fresh pid namespace."""
    with open(config_path) as f:
        cfg = json.load(f)
    root = os.path.join(base, "root")
    os.makedirs(root)
    run(["mount", "--make-rprivate", "/"])
    run(["mount", "-t", "tmpfs", "-o", "size=1m,mode=0755,nosuid,nodev", "sandbox-root", root])
    for d in ("usr", "proc", "dev", "work", "tmp", "etc"):
        os.mkdir(os.path.join(root, d))
    for link in ("bin", "lib", "lib64", "sbin"):
        if os.path.exists("/usr/" + link) or link in ("bin", "lib", "sbin"):
            os.symlink("usr/" + link, os.path.join(root, link))
    # rbind: WSL has submounts under /usr that a user namespace may not reveal by a plain bind
    run(["mount", "--rbind", "/usr", root + "/usr"])
    run(["mount", "-o", "remount,bind,ro,nosuid,nodev", root + "/usr"])
    for dev in ("null", "zero", "urandom", "random"):
        open(os.path.join(root, "dev", dev), "w").close()
        run(["mount", "--bind", "/dev/" + dev, root + "/dev/" + dev])
    run(["mount", "-t", "proc", "-o", "nosuid,nodev,noexec", "proc", root + "/proc"])
    size = "size=%dm,mode=0777,nosuid,nodev,noexec" % cfg["diskMb"]
    run(["mount", "-t", "tmpfs", "-o", size, "sandbox-work", root + "/work"])
    run(["mount", "-t", "tmpfs", "-o", "size=8m,mode=1777,nosuid,nodev,noexec", "sandbox-tmp", root + "/tmp"])
    for name in os.listdir(os.path.join(base, "in")):
        shutil.copyfile(os.path.join(base, "in", name), os.path.join(root, "work", name))
    with open(os.path.join(root, "etc", "passwd"), "w") as f:
        f.write("sandbox:x:0:0:sandbox:/work:/usr/sbin/nologin\n")
    with open(os.path.join(root, "etc", "group"), "w") as f:
        f.write("sandbox:x:0:\n")
    run(["mount", "-o", "remount,bind,ro,nosuid,nodev", root])
    libc = ctypes.CDLL(None, use_errno=True)
    os.chdir(root)
    if libc.syscall(155, b".", b".") != 0:  # pivot_root(".", ".") on x86_64, then detach the old root
        raise OSError(ctypes.get_errno(), "pivot_root failed")
    if libc.umount2(b".", 2) != 0:
        raise OSError(ctypes.get_errno(), "umount old root failed")
    os.chdir("/work")
    seconds = max(1, -(-cfg["timeoutMs"] // 1000))
    argv = [PROGRAMS[cfg["argv"][0]], *cfg["argv"][1:]]
    install_seccomp()  # last step: fails closed (raises) before anything untrusted runs
    os.execve("/usr/bin/setpriv", [
        "setpriv", "--no-new-privs", "--inh-caps=-all", "--ambient-caps=-all", "--bounding-set=-all", "--",
        "/usr/bin/prlimit", "--cpu=%d" % seconds, "--fsize=%d" % (cfg["diskMb"] * 1024 * 1024), "--nofile=64", "--core=0",
        "--nproc=%d" % cfg["pids"], "--",
        "/usr/bin/timeout", "-s", "KILL", "%.3f" % (cfg["timeoutMs"] / 1000), *argv,
    ], {"PATH": "/usr/bin", "HOME": "/work", "LANG": "C.UTF-8", "PYTHONDONTWRITEBYTECODE": "1", "PYTHONHASHSEED": "0"})


def stage1():
    line = sys.stdin.readline()
    try:
        req = validate(json.loads(line))
    except json.JSONDecodeError:
        fail("request is not JSON")
    base = tempfile.mkdtemp(prefix="bunny-sbx-")
    unit = "bunny-sbx-" + uuid.uuid4().hex[:16]
    started = time.monotonic()
    result = {"ok": True, "backend": "wsl2-userns-pivot_root-cgroupv2", "unit": unit}
    try:
        os.mkdir(os.path.join(base, "in"))
        for name, content in req["files"].items():
            with open(os.path.join(base, "in", name), "w") as f:
                f.write(content)
        config = os.path.join(base, "config.json")
        with open(config, "w") as f:
            json.dump(req, f)
        cmd = ["systemd-run", "--user", "--scope", "--quiet", "--unit", unit,
               "-p", "MemoryMax=%dM" % req["memoryMb"], "-p", "MemorySwapMax=0", "-p", "TasksMax=%d" % (req["pids"] + 4), "--",
               "unshare", "--user", "--map-root-user", "--mount", "--pid", "--net", "--ipc", "--uts", "--cgroup", "--fork", "--kill-child", "--",
               "/usr/bin/python3", "-I", os.path.abspath(__file__), "--stage2", base, config]
        proc = subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
        out = {"stdout": bytearray(), "stderr": bytearray()}
        state = {"truncated": False, "cancelled": False}
        limit = req["outputBytes"]

        def kill():
            subprocess.run(["systemctl", "--user", "kill", "--signal=SIGKILL", unit + ".scope"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass

        def watch_stdin():
            # Any further input, or EOF (the Windows side died), cancels the run.
            sys.stdin.readline()
            if proc.poll() is None:
                state["cancelled"] = True
                kill()
        threading.Thread(target=watch_stdin, daemon=True).start()
        deadline = started + req["timeoutMs"] / 1000 + 10
        streams = {proc.stdout.fileno(): "stdout", proc.stderr.fileno(): "stderr"}
        cgroup, oom, peak = None, 0, None

        def sample():
            nonlocal cgroup, oom, peak
            if cgroup is None:
                try:
                    with open("/proc/%d/cgroup" % proc.pid) as f:
                        path = "/sys/fs/cgroup" + f.read().strip().split(":", 2)[2]
                    if path.endswith("/" + unit + ".scope"):
                        cgroup = path
                except (OSError, IndexError):
                    return
            if cgroup:
                try:
                    with open(cgroup + "/memory.events") as f:
                        oom = max(oom, int(dict(l.split() for l in f)["oom_kill"]))
                    with open(cgroup + "/memory.peak") as f:
                        peak = int(f.read())
                except (OSError, KeyError, ValueError):
                    pass
        while streams:
            sample()
            ready, _, _ = select.select(list(streams), [], [], 0.25)
            for fd in ready:
                chunk = os.read(fd, 65536)
                if not chunk:
                    del streams[fd]
                    continue
                buf = out[streams[fd]]
                room = limit - len(out["stdout"]) - len(out["stderr"])
                buf.extend(chunk[:max(0, room)])
                if len(chunk) > room and not state["truncated"]:
                    state["truncated"] = True
                    kill()
            if time.monotonic() > deadline and proc.poll() is None:
                result["outerDeadline"] = True
                kill()
        code = proc.wait()
        sample()
        duration = int((time.monotonic() - started) * 1000)
        # systemd's unit accounting is authoritative: Result=oom-kill, and an active scope means live leftovers.
        remaining, unit_result = None, None
        for _ in range(20):
            show = subprocess.run(["systemctl", "--user", "show", "-p", "Result", "-p", "ActiveState", "-p", "TasksCurrent", unit + ".scope"], capture_output=True, text=True)
            props = dict(l.split("=", 1) for l in show.stdout.splitlines() if "=" in l)
            unit_result = props.get("Result")
            tasks = props.get("TasksCurrent", "")
            remaining = int(tasks) if tasks.isdigit() else 0 if props.get("ActiveState") in ("inactive", "failed") else None
            if remaining == 0:
                break
            time.sleep(0.1)
        if unit_result == "oom-kill":
            oom = max(oom, 1)
        subprocess.run(["systemctl", "--user", "reset-failed", unit + ".scope"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        killed = code in (137, -9)
        result.update({
            "exitCode": code if code >= 0 else None, "signal": -code if code < 0 else (code - 128 if code > 128 else None),
            "oomKilled": oom > 0, "memoryPeakBytes": peak,
            "timedOut": killed and oom == 0 and not state["truncated"] and not state["cancelled"] and duration >= req["timeoutMs"],
            "cancelled": state["cancelled"], "outputTruncated": state["truncated"],
            "stdout": out["stdout"].decode("utf-8", "replace"), "stderr": out["stderr"].decode("utf-8", "replace"),
            "durationMs": duration, "remainingProcesses": remaining,
        })
    finally:
        shutil.rmtree(base, ignore_errors=True)
    result["workspaceRemoved"] = not os.path.exists(base)
    print(json.dumps(result), flush=True)


def probe():
    checks = {}
    for tool in ("systemd-run", "unshare", "setpriv", "prlimit", "timeout", "mount"):
        checks[tool] = shutil.which(tool) is not None
    try:
        r = subprocess.run(["unshare", "--user", "--map-root-user", "--mount", "--pid", "--net", "--fork", "true"], capture_output=True, timeout=10)
        checks["userns"] = r.returncode == 0
    except Exception:
        checks["userns"] = False
    try:
        r = subprocess.run(["systemd-run", "--user", "--scope", "--quiet", "--collect", "-p", "MemoryMax=64M", "-p", "TasksMax=8", "--",
                            "sh", "-c", "cat /sys/fs/cgroup$(cut -d: -f3 /proc/self/cgroup)/memory.max /sys/fs/cgroup$(cut -d: -f3 /proc/self/cgroup)/pids.max"],
                           capture_output=True, text=True, timeout=15)
        checks["cgroupLimits"] = r.stdout.split() == ["67108864", "8"]
    except Exception:
        checks["cgroupLimits"] = False
    checks["arch"] = os.uname().machine == "x86_64"
    try:
        r = subprocess.run([sys.executable, "-I", os.path.abspath(__file__), "--seccomp-selftest"], capture_output=True, text=True, timeout=10)
        checks["seccomp"] = r.stdout.strip() == "seccomp-ok"
    except Exception:
        checks["seccomp"] = False
    print(json.dumps({"ok": all(checks.values()), "checks": checks, "kernel": os.uname().release}), flush=True)


if __name__ == "__main__":
    if len(sys.argv) == 4 and sys.argv[1] == "--stage2":
        stage2(sys.argv[2], sys.argv[3])
    elif sys.argv[1:] == ["--probe"]:
        probe()
    elif sys.argv[1:] == ["--seccomp-selftest"]:
        install_seccomp()
        try:
            os.unshare(os.CLONE_NEWUSER)
        except PermissionError:
            print("seccomp-ok")
    else:
        stage1()
