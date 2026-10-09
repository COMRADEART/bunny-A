import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { canonical, scopedPath, within, privateHostPath } from "../paths.server.ts";
import { sha256 } from "../artifacts.server.ts";
import type { ActionManifest, CapabilityResult, RiskClass } from "../types.ts";
import type { CapabilityAdapter, ExecutionContext } from "./bus.server.ts";
import { resolveCommand, runCommand, runProcess, tail } from "./process.server.ts";
import { mergeTransaction } from "./git-merge.server.ts";
import { commandName } from "../authorization.server.ts";
import { boundedTestResources, snapshotBoundedTest } from "./bounded-terminal.server.ts";

const READ_LIMIT = 1024 * 1024;
const input = (name: string, type: ActionManifest["inputs"][number]["type"], required: boolean, description: string) => ({ name, type, required, description });
const ok = (summary: string, output: unknown, evidence: string[], extra: Partial<CapabilityResult> = {}): CapabilityResult => ({ ok: true, status: "succeeded", summary, output, evidence, ...extra });
const fail = (summary: string, output: unknown = null, evidence: string[] = []): CapabilityResult => ({ ok: false, status: "failed", summary, output, evidence, errorCategory: "capability_failed" });
const str = (params: Record<string, unknown>, key: string, required = true): string => {
  const value = params[key];
  if (typeof value === "string" && value.length) return value;
  if (required) throw new Error(`Parameter "${key}" is required.`);
  return "";
};
const argv = (params: Record<string, unknown>): string[] => {
  const value = params.args ?? [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string") || value.length > 64) throw new Error("args must be an array of at most 64 strings.");
  return value as string[];
};
function cwdOf(params: Record<string, unknown>, context: ExecutionContext) {
  return typeof params.cwd === "string" && params.cwd ? scopedPath(context.cwd, params.cwd, context.roots) : scopedPath(context.cwd, ".", context.roots);
}

export class FilesystemCapability implements CapabilityAdapter {
  manifest = {
    id: "filesystem", version: "1.0.0", description: "Read, list and write files inside approved project roots and Host-owned mission workspaces.", locality: "local" as const, platforms: "any" as const,
    events: ["capability.completed", "capability.failed"], cost: { kind: "local_compute" as const, note: "Local disk I/O; no model tokens." }, adapter: "node:fs",
    actions: [
      { id: "filesystem.read", description: "Read a UTF-8 text file (up to 1 MB).", risk: "READ", inputs: [input("path", "string", true, "File path, relative to the step's working folder.")], outputs: "{ path, bytes, text, sha256 }", evidence: "Absolute path and byte count read from disk.", timeoutMs: 10_000, implemented: true },
      { id: "filesystem.list", description: "List a folder (up to 500 entries).", risk: "READ", inputs: [input("path", "string", false, "Folder path; defaults to the working folder.")], outputs: "{ path, entries: { name, kind, bytes }[] }", evidence: "Folder path and entry count.", timeoutMs: 10_000, implemented: true },
      { id: "filesystem.exists", description: "Check whether a path exists.", risk: "READ", inputs: [input("path", "string", true, "Path to check.")], outputs: "{ path, exists, kind }", evidence: "Path checked on disk.", timeoutMs: 5_000, implemented: true },
      { id: "filesystem.write", description: "Write a UTF-8 text file atomically (temporary file + rename).", risk: "WRITE", inputs: [input("path", "string", true, "File path."), input("content", "string", true, "Full file contents."), input("overwrite", "boolean", false, "Allow replacing an existing file (default false).")], outputs: "{ path, bytes, created }", evidence: "Path and bytes written, read back from disk.", timeoutMs: 10_000, implemented: true },
      { id: "filesystem.delete", description: "Delete one file (never a folder).", risk: "DESTRUCTIVE", inputs: [input("path", "string", true, "File to delete.")], outputs: "{ path, deleted }", evidence: "Path no longer exists on disk.", timeoutMs: 5_000, implemented: true },
      ...["hash", "metadata", "compare", "search"].map(operation => ({ id: `filesystem.${operation}`, description: `Bounded scoped file ${operation}.`, risk: "READ" as const, inputs: [input("path", "string", true, "Approved file or search folder."), ...(operation === "compare" ? [input("content", "string", true, "Expected exact UTF-8 text.")] : operation === "search" ? [input("query", "string", true, "Literal text to find.")] : operation === "hash" ? [input("expectedSha256", "string", false, "Optional expected SHA-256.")] : [])], outputs: "Bounded current disk facts.", evidence: "Current resource identity and disk observation.", timeoutMs: 10_000, implemented: true })),
    ] satisfies ActionManifest[],
  };
  async health() { return { availability: "available" as const, detail: "Node filesystem access inside approved roots." }; }
  async execute(action: string, params: Record<string, unknown>, context: ExecutionContext): Promise<CapabilityResult> {
    if (action === "filesystem.list") {
      const path = scopedPath(context.cwd, str(params, "path", false) || ".", context.roots);
      if (context.boundedDelegation && privateHostPath(context.dataDirectory, path)) throw new Error("Private Host state is outside project scope.");
      if (!statSync(path).isDirectory()) return fail(`${path} is not a folder.`);
      const entries = readdirSync(path, { withFileTypes: true }).filter(entry => !context.resourceValidation?.(join(path,entry.name)) && (!context.boundedDelegation || !privateHostPath(context.dataDirectory, join(path, entry.name)))).slice(0, 500).map((entry) => {
        const full = join(path, entry.name); let bytes: number | null = null;
        try { if (entry.isFile()) bytes = statSync(full).size; } catch { bytes = null; }
        return { name: entry.name, kind: entry.isDirectory() ? "folder" : entry.isFile() ? "file" : "other", bytes };
      });
      return ok(`${entries.length} entries in ${path}.`, { path, entries }, [`Listed ${path}`]);
    }
    const path = scopedPath(context.cwd, str(params, "path"), context.roots);
    if (context.boundedDelegation && privateHostPath(context.dataDirectory, path)) throw new Error("Private Host authority state is outside project scope.");
    if (action === "filesystem.metadata") {
      const info = statSync(path);
      return ok("Read current file metadata.", { path, bytes: info.size, kind: info.isFile() ? "file" : info.isDirectory() ? "folder" : "other", modifiedAt: info.mtime.toISOString() }, ["Metadata observed from disk."]);
    }
    if (action === "filesystem.hash" || action === "filesystem.compare") {
      const info = statSync(path);
      if (!info.isFile() || info.size > READ_LIMIT) return fail("Hash/compare requires a bounded regular file.");
      const body = readFileSync(path); const hash = sha256(body);
      if (action === "filesystem.compare" && typeof params.content !== "string") throw new Error("Expected content must be text.");
      const expected = action === "filesystem.compare" ? sha256(params.content as string) : params.expectedSha256;
      if (action === "filesystem.hash" && expected !== undefined && (typeof expected !== "string" || !/^[a-f0-9]{64}$/.test(expected))) throw new Error("Expected SHA-256 is invalid.");
      return ok("Current file content independently observed.", { path, sha256: hash, matches: expected === undefined ? null : expected === hash }, [`SHA-256 ${hash}`]);
    }
    if (action === "filesystem.search") {
      const query = str(params, "query"); if (query.length > 1000) throw new Error("Search query exceeds its bound.");
      const matches: { path: string; line: number }[] = []; let inspected = 0; let bytes = 0; let truncated = false;
      const walk = (folder: string, depth: number) => {
        if (depth > 8) { truncated = true; return; }
        for (const entry of readdirSync(folder, { withFileTypes: true })) {
          context.signal.throwIfAborted();
          if (++inspected > 1000 || matches.length >= 100 || bytes > 8 * READ_LIMIT) { truncated = true; return; }
          if (entry.isSymbolicLink() || entry.name === ".git" || entry.name === "node_modules") continue;
          const child = scopedPath(folder, entry.name, context.roots);
          if (context.resourceValidation?.(child)) continue;
          if (privateHostPath(context.dataDirectory, child)) continue;
          if (entry.isDirectory()) walk(child, depth + 1);
          else if (entry.isFile()) { const info = statSync(child); if (info.size > READ_LIMIT || bytes + info.size > 8 * READ_LIMIT) continue; bytes += info.size;
            readFileSync(child, "utf8").split(/\r?\n/).forEach((line, index) => { if (line.includes(query) && matches.length < 100) matches.push({ path: relative(path, child), line: index + 1 }); }); }
        }
      };
      if (!statSync(path).isDirectory()) throw new Error("Search requires an approved folder."); walk(path, 0);
      return ok(`Found ${matches.length} matching lines.`, { path, matches, truncated }, [`Inspected at most ${inspected} entries; bounded content search.`]);
    }
    if (action === "filesystem.exists") {
      const exists = existsSync(path);
      return ok(`${path} ${exists ? "exists" : "does not exist"}.`, { path, exists, kind: exists ? (statSync(path).isDirectory() ? "folder" : "file") : null }, [`Checked ${path}`]);
    }
    if (action === "filesystem.read") {
      const info = statSync(path);
      if (!info.isFile()) return fail(`${path} is not a file.`);
      if (info.size > READ_LIMIT) return fail(`${path} is ${info.size} bytes; the read limit is ${READ_LIMIT}.`);
      const text = readFileSync(path, "utf8");
      const { sha256 } = await import("../artifacts.server.ts");
      return ok(`Read ${info.size} bytes from ${path}.`, { path, bytes: info.size, text, sha256: sha256(text) }, [`Read ${path} (${info.size} bytes)`]);
    }
    if (action === "filesystem.write") {
      const content = typeof params.content === "string" ? params.content : null;
      if (content === null) throw new Error('Parameter "content" is required.');
      if (Buffer.byteLength(content) > READ_LIMIT) return fail("Write exceeds the bounded text size.");
      const existed = existsSync(path);
      if (existed && params.overwrite !== true) return fail(`${path} already exists; overwrite was not requested.`);
      if (existed && statSync(path).isDirectory()) return fail(`${path} is a folder.`);
      if (existed && statSync(path).size > READ_LIMIT) return fail("Existing file exceeds the bounded text size.");
      const beforeSha256 = existed ? sha256(readFileSync(path)) : null;
      mkdirSync(dirname(path), { recursive: true });
      const temporary = join(dirname(path), `.${basename(path)}.bunny-${crypto.randomUUID()}.tmp`);
      try { writeFileSync(temporary, content, { encoding: "utf8", flag: "wx" }); renameSync(temporary, path); } finally { if (existsSync(temporary)) rmSync(temporary); }
      const back = readFileSync(path, "utf8");
      if (back !== content) return fail(`Read-back of ${path} did not match what was written.`);
      return ok(`Wrote ${Buffer.byteLength(content)} bytes to ${path}.`, { path, bytes: Buffer.byteLength(content), created: !existed, sha256: sha256(back), beforeSha256 }, [`Wrote and read back ${path}; before ${beforeSha256 ?? "absent"}; after ${sha256(back)}`], { artifacts: [{ type: "source_file", title: relative(context.cwd, path) || basename(path), path, mediaType: "text/plain" }], before: { sha256: beforeSha256 }, after: { sha256: sha256(back) } });
    }
    if (action === "filesystem.delete") {
      if (!existsSync(path)) return fail(`${path} does not exist.`);
      if (!statSync(path).isFile()) return fail("Only single files can be deleted.");
      rmSync(path);
      return existsSync(path) ? fail(`${path} still exists after deletion.`) : ok(`Deleted ${path}.`, { path, deleted: true }, [`${path} no longer exists`]);
    }
    return { ok: false, status: "unsupported", summary: `${action} is not supported.`, output: null, evidence: [] };
  }
}

const DESTRUCTIVE_GIT = [/^reset$/, /^clean$/, /^push$/, /^rebase$/, /^checkout$/, /^restore$/, /^branch$/, /^filter-branch$/, /^update-ref$/, /^gc$/, /^prune$/];
export class TerminalCapability implements CapabilityAdapter {
  manifest = {
    id: "terminal", version: "1.0.0", description: "Run one executable with an argument list (no shell) inside an approved folder.", locality: "local" as const, platforms: "any" as const,
    events: ["capability.completed", "capability.failed"], cost: { kind: "local_compute" as const, note: "Local CPU only; no model tokens." }, adapter: "node:child_process (shell: false)",
    actions: [
      { id: "terminal.exec", description: "Run `command args…` without a shell. npm/npx run through this Node's npm CLI; .cmd/.bat/.ps1 scripts are refused.", risk: "EXECUTE", inputs: [input("command", "string", true, "Executable name (node, npm, git, python, …)."), input("args", "string[]", false, "Argument list."), input("cwd", "string", false, "Working folder inside the approved roots."), input("timeoutMs", "number", false, "Timeout (ms).")], outputs: "{ command, args, cwd, exitCode, stdout, stderr, durationMs, timedOut }", evidence: "Exact argv, folder, exit code and output tail.", timeoutMs: 15 * 60_000, implemented: true },
    ] satisfies ActionManifest[],
  };
  async health() {
    return { availability: "available" as const, detail: `Shell-free process execution. npm via ${resolveCommand("npm") ? "bundled npm CLI" : "unavailable npm CLI"}.` };
  }
  riskFor(_action: string, params: Record<string, unknown>): RiskClass | null {
    const command = typeof params.command === "string" ? commandName(params.command) : "";
    const args = Array.isArray(params.args) ? params.args.map(String) : [];
    if (command.endsWith("git") && args.length && DESTRUCTIVE_GIT.some((pattern) => pattern.test(args[0]))) return "DESTRUCTIVE";
    if (command.endsWith("git") && args[0] === "push") return "EXTERNAL_SIDE_EFFECT";
    if (/(^|[\\/])(rm|rmdir|del|format|shutdown|reg|diskpart|takeown|icacls|sc|bcdedit|cipher)$/.test(command)) return "DESTRUCTIVE";
    if (["npm", "npx"].includes(command) && ["publish", "unpublish", "login", "adduser", "token", "deprecate", "owner"].includes(args[0] ?? "")) return "EXTERNAL_SIDE_EFFECT";
    if (["npm", "npx"].includes(command) && ["install", "i", "uninstall", "ci", "update"].includes(args[0] ?? "")) return "EXTERNAL_SIDE_EFFECT";
    return null;
  }
  async execute(_action: string, params: Record<string, unknown>, context: ExecutionContext): Promise<CapabilityResult> {
    const command = str(params, "command"); const args = argv(params); const cwd = cwdOf(params, context);
    const timeoutMs = Math.min(typeof params.timeoutMs === "number" && params.timeoutMs > 0 ? params.timeoutMs : context.timeoutMs, context.timeoutMs, context.boundedEnvironment ? 60_000 : Infinity);
    const identity = context.executable === undefined ? resolveCommand(command, cwd) : context.executable;
    if (!identity) throw new Error(`Command "${command}" is not an executable Bunny-A can launch without a shell.`);
    let launchIdentity = identity; let launchCwd = cwd;
    if (context.boundedEnvironment) {
      const script = scopedPath(cwd, args[0], context.roots);
      const resources = boundedTestResources(script, cwd, context.roots);
      if (!context.boundedScriptHash) throw new Error("No current approved script identity.");
      launchCwd = snapshotBoundedTest(script, resources, cwd, join(context.dataDirectory, "agentic-terminal", context.capabilityRunId!), context.boundedScriptHash);
      launchIdentity = { ...identity, prefix: ["--permission", `--allow-fs-read=${launchCwd}`] };
    }
    const result = await runProcess(launchIdentity, args, { cwd: launchCwd, signal: context.signal, timeoutMs, env: context.boundedEnvironment, owned:true, owner:{missionId:context.missionId,stepId:context.stepId,capabilityRunId:context.capabilityRunId,dataDirectory:context.dataDirectory,records:context.processOwnership,action:"terminal.exec"} });
    const line = `${command} ${args.join(" ")}`.trim();
    const output = { command, args, cwd, ...(context.boundedEnvironment ? { executionBoundary: "pure-read-check-v1", executionCwd: launchCwd } : {}), exitCode: result.exitCode, stdout: tail(result.stdout, 20_000), stderr: tail(result.stderr, 8_000), durationMs: result.durationMs, timedOut: result.timedOut };
    const evidence = [`${line} in ${cwd} → exit ${result.exitCode ?? "none"} after ${result.durationMs} ms`];
    const report = { type: "test_report" as const, title: `${line} output`, inline: `$ ${line}\n# cwd: ${cwd}\n# exit: ${result.exitCode}\n\n${tail(result.stdout, 30_000)}\n${result.stderr ? `\n# stderr\n${tail(result.stderr, 10_000)}` : ""}`, mediaType: "text/plain" };
    if (result.timedOut) return { ok: false, status: "timeout", summary: `${line} timed out after ${timeoutMs} ms.`, output, evidence, errorCategory: "timeout", artifacts: [report] };
    if (result.aborted) return { ok: false, status: "failed", summary: `${line} was cancelled.`, output, evidence, errorCategory: "user_stopped" };
    if (result.exitCode !== 0) return { ...fail(`${line} exited with ${result.exitCode}. ${tail(result.stderr || result.stdout, 300)}`, output, evidence), artifacts: [report] };
    return ok(`${line} exited 0.`, output, evidence, { artifacts: [report] });
  }
}

export class GitCapability implements CapabilityAdapter {
  worktreeRoot: string;
  constructor(dataDirectory: string) { this.worktreeRoot = join(dataDirectory, "worktrees"); }
  manifest = {
    id: "git", version: "1.0.0", description: "Git status, diff, log, commit, isolated worktrees and merge through the local git executable.", locality: "local" as const, platforms: "any" as const,
    events: ["capability.completed", "capability.failed"], cost: { kind: "local_compute" as const, note: "Local git; no network (push is not offered)." }, adapter: "git CLI (no shell)",
    actions: [
      { id: "git.status", description: "Branch and porcelain status.", risk: "READ", inputs: [input("cwd", "string", false, "Repository folder.")], outputs: "{ branch, changes: string[], clean }", evidence: "git status --porcelain=v1 -b output.", timeoutMs: 20_000, implemented: true },
      { id: "git.diff", description: "Diff stat and patch (working tree vs HEAD, or against a ref).", risk: "READ", inputs: [input("cwd", "string", false, "Repository folder."), input("against", "string", false, "Ref to compare with.")], outputs: "{ stat, patch, empty }", evidence: "Patch stored as an artifact with its SHA-256.", timeoutMs: 30_000, implemented: true },
      { id: "git.log", description: "Recent commits (one line each).", risk: "READ", inputs: [input("cwd", "string", false, "Repository folder."), input("limit", "number", false, "How many (max 100).")], outputs: "{ commits: string[] }", evidence: "git log --oneline output.", timeoutMs: 20_000, implemented: true },
      ...["tracked_files", "branch", "commit_info"].map(op => ({ id: `git.${op}`, description: `Read repository ${op}.`, risk: "READ" as const, inputs: [input("cwd", "string", false, "Approved repository."), ...(op === "commit_info" ? [input("ref", "string", false, "Commit ref, defaults HEAD.")] : [])], outputs: "Bounded repository facts.", evidence: "Current Git CLI observation.", timeoutMs: 20_000, implemented: true })),
      { id: "git.commit", description: "Stage all changes in the folder and commit with a message.", risk: "WRITE", inputs: [input("cwd", "string", false, "Repository folder."), input("message", "string", true, "Commit message.")], outputs: "{ commit }", evidence: "New HEAD commit id.", timeoutMs: 60_000, implemented: true },
      { id: "git.worktree_add", description: "Create an isolated worktree on a new bunny/* branch under the Host data folder.", risk: "WRITE", inputs: [input("cwd", "string", false, "Repository folder."), input("name", "string", true, "Short worktree name.")], outputs: "{ path, branch, base }", evidence: "Worktree path and branch.", timeoutMs: 60_000, implemented: true },
      { id: "git.worktree_remove", description: "Remove a clean Bunny-owned worktree (never one outside the Host data folder).", risk: "WRITE", inputs: [input("cwd", "string", false, "Main repository folder."), input("path", "string", true, "Worktree path.")], outputs: "{ removed }", evidence: "Worktree no longer listed.", timeoutMs: 60_000, implemented: true },
      { id: "git.merge", description: "Merge a bunny/* branch into the current branch (--no-ff; aborts cleanly on conflict).", risk: "WRITE", inputs: [input("cwd", "string", false, "Repository folder."), input("branch", "string", true, "bunny/* branch to merge.")], outputs: "{ merged, conflict, head }", evidence: "Resulting HEAD or conflict files.", timeoutMs: 120_000, implemented: true },
    ] satisfies ActionManifest[],
  };
  async health() {
    const git = resolveCommand("git");
    return git ? { availability: "available" as const, detail: `git at ${git.file}.` } : { availability: "unavailable" as const, detail: "git executable not found on PATH." };
  }
  async git(args: string[], cwd: string, context: ExecutionContext, timeoutMs = 60_000, signal: AbortSignal = context.signal) {
    if (context.boundedDelegation) {
      const env: NodeJS.ProcessEnv = Object.fromEntries(["SystemRoot", "WINDIR", "TEMP", "TMP", "PATH"].flatMap(k => process.env[k] ? [[k, process.env[k]!]] : []));
      Object.assign(env, { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null", GIT_ATTR_NOSYSTEM: "1" });
      const safeArgs = args[0] === "diff" ? [args[0], "--no-ext-diff", "--no-textconv", ...args.slice(1)] : args;
      return runCommand("git", ["--no-pager", "--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=" + join(context.dataDirectory, "disabled-hooks"), "-c", "diff.external=", ...safeArgs], { cwd, signal: context.signal, env, timeoutMs: Math.min(timeoutMs, context.timeoutMs), owner: { missionId: context.missionId, stepId: context.stepId, capabilityRunId: context.capabilityRunId, dataDirectory: context.dataDirectory, records: context.processOwnership, action: `git.${args[0]}` } });
    }
    // M-A-3 T9R-F01: under remote authority Git never runs repo-configured programs (hooks, fsmonitor, external diff or textconv).
    const hardened = context.remoteAuthority ? ["--no-pager", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=" + join(context.dataDirectory, "disabled-hooks"), "-c", "diff.external=", ...(args[0] === "diff" ? [args[0], "--no-ext-diff", "--no-textconv", ...args.slice(1)] : args)] : args;
    return runCommand("git", hardened, { cwd, signal, timeoutMs: Math.min(timeoutMs, context.timeoutMs),owner:{missionId:context.missionId,stepId:context.stepId,capabilityRunId:context.capabilityRunId,dataDirectory:context.dataDirectory,records:context.processOwnership,action:`git.${args[0]}`} });
  }
  async execute(action: string, params: Record<string, unknown>, context: ExecutionContext): Promise<CapabilityResult> {
    const cwd = cwdOf(params, context);
    if (context.boundedDelegation && !["git.status", "git.diff", "git.log", "git.tracked_files", "git.branch", "git.commit_info"].includes(action)) return fail("Delegated Git mutations are unsupported.");
    const inside = await this.git(["rev-parse", "--show-toplevel"], cwd, context, 15_000);
    if (inside.exitCode !== 0) return fail(`${cwd} is not inside a git repository.`);
    if (context.boundedDelegation) {
      scopedPath(cwd, inside.stdout.trim(), context.roots);
      const metadata = await this.git(["rev-parse", "--path-format=absolute", "--git-common-dir"], cwd, context, 15_000);
      if (metadata.exitCode !== 0) return fail("Repository metadata could not be verified.");
      scopedPath(cwd, metadata.stdout.trim(), context.roots);
      const denied = await context.revalidate?.(); if (denied) throw new Error(denied);
    }
    if (action === "git.tracked_files" || action === "git.branch" || action === "git.commit_info") {
      const ref = typeof params.ref === "string" ? params.ref : "HEAD";
      if (!/^[A-Za-z0-9][\w./@^~-]{0,119}$/.test(ref)) return fail("Invalid commit reference.");
      const args = action === "git.tracked_files" ? ["ls-files", "-z"] : action === "git.branch" ? ["symbolic-ref", "--short", "HEAD"] : ["show", "--no-patch", "--no-show-signature", "--format=%H%n%P%n%s", ref];
      const result = await this.git(args, cwd, context);
      if (result.exitCode !== 0) return fail(`Git read failed: ${tail(result.stderr, 300)}`);
      const output = action === "git.tracked_files" ? { files: result.stdout.split("\0").filter(Boolean).slice(0, 1000) } : action === "git.branch" ? { branch: result.stdout.trim() } : { commit: result.stdout.trim() };
      return ok("Current repository facts read.", output, [`${action} observed in approved repository.`]);
    }
    if (action === "git.status") {
      const result = await this.git(["status", "--porcelain=v1", "-b"], cwd, context);
      if (result.exitCode !== 0) return fail(`git status failed: ${tail(result.stderr, 300)}`);
      const lines = result.stdout.split(/\r?\n/).filter(Boolean);
      const branch = (lines[0] ?? "").replace(/^## /, ""); const changes = lines.slice(1);
      return ok(`${branch}: ${changes.length ? `${changes.length} changed path${changes.length === 1 ? "" : "s"}` : "clean"}.`, { branch, changes, clean: !changes.length }, [`git status in ${cwd}`]);
    }
    if (action === "git.diff") {
      const against = typeof params.against === "string" && params.against ? params.against : "HEAD";
      // A ref never starts with "-": an option there (e.g. --textconv, --ext-diff) would override Bunny's own flags.
      if (!/^[\w./@^~][\w./@^~-]{0,119}$/.test(against)) return fail("Invalid ref.");
      const stat = await this.git(["diff", "--stat", against], cwd, context);
      const patch = await this.git(["diff", against], cwd, context);
      if (stat.exitCode !== 0 || patch.exitCode !== 0) return fail(`git diff failed: ${tail(stat.stderr || patch.stderr, 300)}`);
      const empty = !patch.stdout.trim();
      return ok(empty ? `No differences against ${against}.` : `Diff against ${against}: ${stat.stdout.trim().split(/\r?\n/).at(-1)}`, { stat: stat.stdout, patch: tail(patch.stdout, 60_000), empty, against }, [`git diff ${against} in ${cwd}`], empty ? {} : { artifacts: [{ type: "patch", title: `diff against ${against}`, inline: patch.stdout, mediaType: "text/x-diff" }] });
    }
    if (action === "git.log") {
      const limit = Math.max(1, Math.min(100, Number(params.limit ?? 20) || 20));
      const result = await this.git(["log", `-n${limit}`, "--oneline", "--no-decorate"], cwd, context);
      if (result.exitCode !== 0) return fail(`git log failed: ${tail(result.stderr, 300)}`);
      const commits = result.stdout.split(/\r?\n/).filter(Boolean);
      return ok(`${commits.length} commits.`, { commits }, [`git log in ${cwd}`]);
    }
    if (action === "git.commit") {
      const message = str(params, "message").slice(0, 2000);
      const add = await this.git(["add", "-A", "--", "."], cwd, context);
      if (add.exitCode !== 0) return fail(`git add failed: ${tail(add.stderr, 300)}`);
      const commit = await this.git(["commit", "-m", message], cwd, context);
      if (commit.exitCode !== 0) return fail(`git commit failed: ${tail(commit.stderr || commit.stdout, 300)}`);
      const head = await this.git(["rev-parse", "HEAD"], cwd, context);
      return ok(`Committed ${head.stdout.trim().slice(0, 12)}.`, { commit: head.stdout.trim() }, [`HEAD ${head.stdout.trim()}`]);
    }
    if (action === "git.worktree_add") {
      const name = str(params, "name"); if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,40}$/.test(name)) return fail("Worktree name must be short and plain.");
      const folder = join(this.worktreeRoot, context.missionId ? context.missionId.slice(0, 8) : "direct", name);
      if (existsSync(folder)) return fail(`${folder} already exists.`);
      mkdirSync(dirname(folder), { recursive: true });
      const branch = `bunny/${context.missionId ? context.missionId.slice(0, 8) : "direct"}-${name}`;
      const base = (await this.git(["rev-parse", "HEAD"], cwd, context)).stdout.trim();
      const result = await this.git(["worktree", "add", "-b", branch, folder, "HEAD"], cwd, context);
      if (result.exitCode !== 0) return fail(`git worktree add failed: ${tail(result.stderr, 300)}`);
      return ok(`Worktree ${folder} on ${branch}.`, { path: canonical(folder), branch, base }, [`worktree ${folder} @ ${base}`]);
    }
    if (action === "git.worktree_remove") {
      const path = str(params, "path");
      if (!within(this.worktreeRoot, path)) return fail("Only Bunny-owned worktrees under the Host data folder can be removed.");
      const result = await this.git(["worktree", "remove", canonical(path)], cwd, context);
      if (result.exitCode !== 0) return fail(`git worktree remove failed (uncommitted changes are kept): ${tail(result.stderr, 300)}`);
      return ok(`Removed worktree ${path}.`, { removed: true }, [`worktree ${path} removed`]);
    }
    if (action === "git.merge") {
      const branch = str(params, "branch");
      if (!/^bunny\/[A-Za-z0-9._-]{1,80}$/.test(branch)) return fail("Only bunny/* branches can be merged by a mission.");
      // M-A-3 T9R-F01: under remote authority the merge runs with the same hardened Git flags as every other call.
      return mergeTransaction(branch, cwd, context, context.remoteAuthority ? (args, at, signal, timeoutMs) => this.git(args, at, context, timeoutMs, signal) : undefined);
    }
    return { ok: false, status: "unsupported", summary: `${action} is not supported.`, output: null, evidence: [] };
  }
}

/** Local notifications: an entry in the Bunny Inbox (and the UI's own notification when permitted). */
export class NotificationsCapability implements CapabilityAdapter {
  notify: (title: string, detail: string, missionId: string | null) => void;
  constructor(notify: (title: string, detail: string, missionId: string | null) => void) { this.notify = notify; }
  manifest = {
    id: "notifications", version: "1.0.0", description: "Post a notification to the local Bunny Inbox. Nothing leaves this machine.", locality: "local" as const, platforms: "any" as const,
    events: ["notification.sent"], cost: { kind: "local_compute" as const, note: "Local only." }, adapter: "Bunny Inbox",
    actions: [
      { id: "notifications.send", description: "Add an informational entry to the Bunny Inbox.", risk: "READ", inputs: [input("title", "string", true, "Short title."), input("detail", "string", false, "Body text.")], outputs: "{ delivered: 'inbox' }", evidence: "Inbox entry id.", timeoutMs: 5_000, implemented: true },
    ] satisfies ActionManifest[],
  };
  async health() { return { availability: "available" as const, detail: "Bunny Inbox (local). Phone push is not configured." }; }
  async execute(_action: string, params: Record<string, unknown>, context: ExecutionContext): Promise<CapabilityResult> {
    const title = str(params, "title").slice(0, 120); const detail = (typeof params.detail === "string" ? params.detail : "").slice(0, 2000);
    this.notify(title, detail, context.missionId);
    return ok(`Inbox notification: ${title}`, { delivered: "inbox" }, ["Bunny Inbox entry created (local only; no phone push)."]);
  }
}
