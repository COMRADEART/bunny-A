/**
 * MA4-S1R2 sandbox tests. Contract tests always run. Adversarial fixtures run ONLY inside the WSL2
 * sandbox being validated; without it they are reported as skipped (never as passed).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { runSandboxed, sandboxAvailability, SandboxBlocked, SandboxRequestSchema, wslPath } from "./ma4/sandbox.server.ts";

test("request validation refuses traversal names, non-allowlisted programs and out-of-range limits", () => {
  for (const name of ["../x.py", "a/b.py", ".hidden", "", "x".repeat(65)]) assert.equal(SandboxRequestSchema.safeParse({ files: { [name]: "" }, argv: ["python3", "x.py"] }).success, false, name);
  assert.equal(SandboxRequestSchema.safeParse({ files: { "x.py": "" }, argv: ["bash", "-c", "id"] }).success, false);
  assert.equal(SandboxRequestSchema.safeParse({ files: { "x.py": "" }, argv: ["python3"], memoryMb: 4096 }).success, false);
  assert.equal(SandboxRequestSchema.safeParse({ files: { "x.py": "" }, argv: ["python3"], timeoutMs: 600_000 }).success, false);
  assert.equal(SandboxRequestSchema.safeParse({ files: { "x.py": "" }, argv: ["python3"], extra: true }).success, false);
  assert.equal(wslPath("C:\\a\\b c\\d.py"), "/mnt/c/a/b c/d.py");
  assert.throws(() => wslPath("\\\\server\\share\\x"));
});

test("fails closed: an unproven backend blocks execution and a malformed result is a failure", async () => {
  if (process.platform !== "win32") return;
  const calls: string[][] = [];
  const missing = async (args: string[]) => { calls.push(args); return { code: 0, stdout: JSON.stringify({ ok: false, checks: { userns: false }, kernel: "x" }) }; };
  await assert.rejects(runSandboxed({ files: { "t.py": "print(1)" }, argv: ["python3", "t.py"] }, undefined, missing), SandboxBlocked);
  assert.deepEqual(calls, [["--probe"]], "no run request is sent when the probe fails");
  const crashing = async () => { throw new Error("wsl.exe not found"); };
  await assert.rejects(runSandboxed({ files: { "t.py": "" }, argv: ["python3", "t.py"] }, undefined, crashing), SandboxBlocked);
  const garbage = async (args: string[]) => ({ code: 0, stdout: args[0] === "--probe" ? JSON.stringify({ ok: true, checks: {}, kernel: "k" }) : "Traceback..." });
  await assert.rejects(runSandboxed({ files: { "t.py": "" }, argv: ["python3", "t.py"] }, undefined, garbage), /no result/);
  const forged = async (args: string[]) => ({ code: 0, stdout: args[0] === "--probe" ? JSON.stringify({ ok: true, checks: {}, kernel: "k" }) : JSON.stringify({ ok: true, backend: "plain-subprocess", exitCode: 0 }) });
  await assert.rejects(runSandboxed({ files: { "t.py": "" }, argv: ["python3", "t.py"] }, undefined, forged));
});

const availability = await sandboxAvailability();
const skip = availability.available ? false : `SKIPPED (not passed): ${"reason" in availability ? availability.reason : ""}`;
const py = (source: string, limits: Record<string, number> = {}, signal?: AbortSignal) =>
  runSandboxed({ files: { "probe.py": source }, argv: ["python3", "-I", "-S", "probe.py"], timeoutMs: 15_000, memoryMb: 128, pids: 16, ...limits }, signal);
const json = (stdout: string) => JSON.parse(stdout.trim().split("\n").pop()!);

test("F4.1 reading files outside the workspace fails (host files, Windows drives, home, the launcher)", { skip }, async () => {
  const r = await py(`import json,os
out={}
for p in ["/etc/shadow","/etc/hostname","/mnt/c/Windows/win.ini","/home","/root","/mnt","/run/WSL","/init",${JSON.stringify(wslPath("C:\\Windows\\win.ini"))},"/proc/1/root/etc/hostname","/sys/class"]:
    try:
        out[p]=("dir:"+str(os.listdir(p))) if os.path.isdir(p) else open(p,"rb").read(16).hex()
    except Exception as e:
        out[p]=type(e).__name__
print(json.dumps({"out":out,"root":sorted(os.listdir("/")),"work":os.listdir("/work")}))`);
  assert.equal(r.exitCode, 0, r.stderr);
  const o = json(r.stdout);
  for (const [path, value] of Object.entries(o.out)) assert.match(String(value), /Error$/, `${path} must be unreadable, got ${value}`);
  assert.deepEqual(o.root, ["bin", "dev", "etc", "lib", "lib64", "proc", "sbin", "tmp", "usr", "work"]);
  assert.deepEqual(o.work, ["probe.py"]);
});

test("F4.2 environment secrets do not reach the program", { skip }, async () => {
  process.env.BUNNY_SANDBOX_CANARY = "canary-7f3a9d";
  process.env.WSLENV = [process.env.WSLENV, "BUNNY_SANDBOX_CANARY/u"].filter(Boolean).join(":");
  try {
    // Positive control: the canary DOES reach the WSL user environment the launcher runs in.
    assert.equal(spawnSync("wsl.exe", ["--exec", "printenv", "BUNNY_SANDBOX_CANARY"], { encoding: "utf8" }).stdout.trim(), "canary-7f3a9d");
    const r = await py(`import json,os,glob
seen=[]
for f in glob.glob("/proc/[0-9]*/environ"):
    try: seen.append(open(f,"rb").read().decode("latin1"))
    except Exception: pass
print(json.dumps({"env":dict(os.environ),"proc":seen}))`);
    assert.equal(r.exitCode, 0, r.stderr);
    assert.doesNotMatch(r.stdout, /canary-7f3a9d|WSL_INTEROP|WSL_DISTRO|USERPROFILE|APPDATA/);
    assert.deepEqual(Object.keys(json(r.stdout).env).sort(), ["HOME", "LANG", "PATH", "PYTHONDONTWRITEBYTECODE", "PYTHONHASHSEED"]);
  } finally { delete process.env.BUNNY_SANDBOX_CANARY; }
});

test("F4.3/F4.10 no external network, no DNS and no host services (Ollama/loopback)", { skip }, async () => {
  // Positive control: the same lookup works for the trusted WSL user outside the sandbox.
  const control = spawnSync("wsl.exe", ["--exec", "python3", "-c", "import socket; socket.getaddrinfo('example.com', 80); print('resolved')"], { encoding: "utf8" });
  const networkControl = control.stdout.trim() === "resolved";
  const r = await py(`import json,socket
res={}
for host,port in [("1.1.1.1",443),("8.8.8.8",53),("127.0.0.1",11434),("127.0.0.1",22),("172.17.0.1",80)]:
    s=socket.socket(); s.settimeout(3)
    try: s.connect((host,port)); res[f"{host}:{port}"]="CONNECTED"
    except Exception as e: res[f"{host}:{port}"]=type(e).__name__
    finally: s.close()
try: socket.getaddrinfo("example.com",80); res["dns"]="RESOLVED"
except Exception as e: res["dns"]=type(e).__name__
try:
    u=socket.socket(socket.AF_UNIX); u.connect("\\0WSLInterop"); res["abstract-unix"]="CONNECTED"
except Exception as e: res["abstract-unix"]=type(e).__name__
res["ifaces"]=open("/proc/net/dev").read().count(":")
print(json.dumps(res))`);
  assert.equal(r.exitCode, 0, r.stderr);
  const o = json(r.stdout);
  for (const [k, v] of Object.entries(o)) if (k !== "ifaces") assert.notEqual(v, "CONNECTED", k), assert.notEqual(v, "RESOLVED", k);
  assert.equal(o.ifaces, 1, "only the down loopback interface exists");
  if (!networkControl) console.log("# network positive control unavailable (host offline?); isolation assertions above still hold");
});

test("F4.4 process spawning is capped and Windows interop executables cannot launch", { skip }, async () => {
  const r = await py(`import json,os,time
kids=[];err=None
for i in range(200):
    try:
        pid=os.fork()
        if pid==0: time.sleep(5); os._exit(0)
        kids.append(pid)
    except OSError as e: err=type(e).__name__; break
fd=os.memfd_create("pe")
os.write(fd,b"MZ"+b"\\0"*510)
try: os.execv(f"/proc/self/fd/{fd}",["x.exe"]); interop="LAUNCHED"
except OSError as e: interop=type(e).__name__
print(json.dumps({"forked":len(kids),"err":err,"interop":interop}))
for k in kids: os.kill(k,9)`, { pids: 8 });
  assert.equal(r.exitCode, 0, r.stderr);
  const o = json(r.stdout);
  assert.ok(o.forked < 8, `forks must stop below the cap, got ${o.forked}`);
  assert.equal(o.err, "BlockingIOError");
  assert.notEqual(o.interop, "LAUNCHED");
});

test("F4.5 writes outside the private workspace fail and the workspace is discarded", { skip }, async () => {
  const r = await py(`import json,os
res={}
for p in ["/x","/usr/x","/etc/x","/dev/x","/proc/x","/work/ok.txt","/tmp/ok.txt"]:
    try:
        open(p,"w").write("x"); res[p]="WROTE"
    except Exception as e: res[p]=type(e).__name__
try: os.chmod("/work/probe.py",0o755); os.execv("/work/probe.py",["x"]); res["exec-work"]="EXEC"
except Exception as e: res["exec-work"]=type(e).__name__
for name,fn in [("mount",lambda: os.system("mount -t tmpfs x /work 2>/dev/null")),("setuid",lambda: os.setuid(1000))]:
    try: res[name]=fn()
    except Exception as e: res[name]=type(e).__name__
print(json.dumps(res))`);
  assert.equal(r.exitCode, 0, r.stderr);
  const o = json(r.stdout);
  for (const p of ["/x", "/usr/x", "/etc/x", "/dev/x", "/proc/x"]) assert.notEqual(o[p], "WROTE", p);
  assert.equal(o["/work/ok.txt"], "WROTE");
  assert.equal(o["/tmp/ok.txt"], "WROTE");
  assert.equal(o["exec-work"], "PermissionError", "workspace is noexec");
  assert.notEqual(o.mount, 0, "mount must fail without capabilities");
  assert.notEqual(o.setuid, null);
  assert.equal(r.workspaceRemoved, true);
});

test("F4.6 memory limit is enforced by the cgroup", { skip }, async () => {
  const r = await py(`b=[]
for i in range(64): b.append(bytearray(16*1024*1024))
print("ALLOCATED", len(b))`, { memoryMb: 64 });
  assert.doesNotMatch(r.stdout, /ALLOCATED/);
  assert.ok(r.oomKilled || /MemoryError/.test(r.stderr), JSON.stringify({ ...r, stdout: r.stdout.slice(0, 200) }));
  assert.ok((r.memoryPeakBytes ?? 0) <= 64 * 1024 * 1024 + 4096, "peak, when sampled, is within the limit");
  assert.equal(r.remainingProcesses, 0);
});

test("F4.7 runtime limit kills a busy loop", { skip }, async () => {
  const r = await py("while True: pass", { timeoutMs: 1500 });
  assert.equal(r.timedOut, true);
  assert.equal(r.remainingProcesses, 0);
  assert.ok(r.durationMs < 1500 + 8000, `${r.durationMs}`);
});

test("F4.8 excessive output is truncated and the program is stopped", { skip }, async () => {
  const r = await py("import sys\nwhile True: sys.stdout.write('x'*65536)", { outputBytes: 4096 });
  assert.equal(r.outputTruncated, true);
  assert.ok(r.stdout.length + r.stderr.length <= 4096);
  assert.equal(r.remainingProcesses, 0);
});

const marker = () => `bunny-orphan-${Math.random().toString(36).slice(2)}`;
const hostSees = (tag: string) => spawnSync("wsl.exe", ["--exec", "pgrep", "-f", tag], { encoding: "utf8" }).stdout.trim();

test("F4.9 detached descendants do not outlive the run", { skip }, async () => {
  const tag = marker();
  const r = await py(`import os,sys,time
if os.fork()==0:
    os.setsid()
    if os.fork()==0:
        os.execv("/usr/bin/python3",["python3","-c","import time; time.sleep(120)  # ${tag}"])
    os._exit(0)
time.sleep(0.5); print("parent exits")`);
  assert.match(r.stdout, /parent exits/);
  assert.equal(r.remainingProcesses, 0);
  assert.equal(hostSees(tag), "", "no orphan visible to the WSL host");
});

test("F4.11 cancellation kills the whole tree and cleans up", { skip }, async () => {
  const tag = marker();
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 1500);
  const started = Date.now();
  const r = await py(`import os,time
for i in range(3):
    if os.fork()==0: os.execv("/usr/bin/python3",["python3","-c","import time; time.sleep(120)  # ${tag}"])
time.sleep(120)`, { timeoutMs: 60_000 }, controller.signal);
  assert.equal(r.cancelled, true);
  assert.equal(r.remainingProcesses, 0);
  assert.ok(Date.now() - started < 15_000);
  assert.equal(hostSees(tag), "");
  assert.equal(r.workspaceRemoved, true);
});

test("F5 seccomp (S1R3): namespace, mount, tracing, keyring, BPF and io_uring syscalls fail with EPERM; ordinary work still runs", { skip }, async () => {
  const r = await py(`import ctypes, json, os, subprocess, sys
libc = ctypes.CDLL(None, use_errno=True)
def sc(nr, *a):
    rv = libc.syscall(nr, *a)
    if rv == 0 and nr == 56: os._exit(0)  # a clone that was not blocked: the child leaves at once
    return "EPERM" if rv == -1 and ctypes.get_errno() == 1 else f"rv={rv} errno={ctypes.get_errno()}"
out = {"status": [l.split()[1] for l in open("/proc/self/status") if l.startswith("Seccomp:")][0]}
try: os.unshare(os.CLONE_NEWUSER); out["unshare"] = "allowed"
except PermissionError: out["unshare"] = "EPERM"
out.update(clone_newuser=sc(56, 0x10000000 | 17, 0, 0, 0, 0), ptrace=sc(101, 0, 0, 0, 0), mount=sc(165, b"x", b"/tmp", b"tmpfs", 0, 0),
           keyctl=sc(250, 0, 0, 0, 0), bpf=sc(321, 0, 0, 0), io_uring=sc(425, 1, 0), setns=sc(308, 0, 0), perf=sc(298, 0, 0, 0, 0, 0))
pid = os.fork()
if pid == 0: os._exit(7)
out["fork"] = os.waitpid(pid, 0)[1] >> 8
out["spawn"] = subprocess.run([sys.executable, "-I", "-S", "-c", "print(6*7)"], capture_output=True, text=True).stdout.strip()
print(json.dumps(out))`);
  const o = json(r.stdout);
  assert.equal(o.status, "2", "seccomp filter mode is active for the untrusted program");
  for (const k of ["unshare", "clone_newuser", "ptrace", "mount", "keyctl", "bpf", "io_uring", "setns", "perf"]) assert.equal(o[k], "EPERM", `${k}: ${o[k]}`);
  assert.equal(o.fork, 7); assert.equal(o.spawn, "42");
});
