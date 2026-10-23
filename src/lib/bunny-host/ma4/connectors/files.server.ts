import { closeSync, constants, copyFileSync, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync, readSync, realpathSync, renameSync, rmSync, writeSync, fstatSync, type BigIntStats } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { HostDatabase } from "../../persistence.server.ts";
import { sha256 } from "../task-runtime.ts";
import { ACTION_SCHEMA, RESULT_SCHEMA, type ActionContext, type Connector, type Prepared, type Requirement } from "../action-broker.server.ts";

/**
 * MA4-S2-T2 local file connector. The owner registers folders ("roots") on the workstation; a task can only name a root
 * id plus a relative path, and gets only what its grant allows. Scope is enforced on the file system, not on strings:
 *
 * - the relative path is parsed into plain segments (no "..", drive letters, streams, device names or 8.3 aliases);
 * - every component is lstat'ed from the root down and a link (symlink or junction) anywhere is refused, then the real
 *   path must equal the walked path exactly (this also catches other reparse points);
 * - files with more than one hard link are refused (a hard link can point outside the root);
 * - a file is read through a handle whose identity (dev + inode) must match the walked file (no swap in between);
 * - credential-bearing names (.env, keys, .ssh, .git, ...) are never listed, searched or read;
 * - writes are version-conditional, atomic (temp file + rename in the same folder) and keep a backup in Host data.
 *
 * Errors name only the root id and the relative path the task supplied, never a resolved absolute path.
 */
export const MAX_FILE_BYTES = 1024 * 1024;
export const MAX_READ_CHARS = 40_000;
const MAX_WRITE_BYTES = 256 * 1024;
const RESULT_CHARS = 60_000;
const SEARCH_FILES = 2_000, SEARCH_BYTES = 32 * 1024 * 1024;

export class FileScopeError extends Error { readonly code = "FILE_SCOPE"; }
const PROTECTED_DIRS = /^(\.git|\.ssh|\.aws|\.azure|\.gnupg|\.kube|\.docker|\.config|node_modules|\$recycle\.bin|system volume information)$/i;
const PROTECTED_FILES = /^(\.env(\..*)?|.*\.(pem|key|p12|pfx|kdbx|keychain|ppk|jks|keystore)|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|known_hosts|authorized_keys|\.npmrc|\.pypirc|\.netrc|_netrc|\.git-credentials|credentials(\..*)?|.*secrets?\.(json|ya?ml|toml|txt)|cookies(\..*)?|login data|web data|.*\.sqlite-wal)$/i;
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
export const isProtectedName = (name: string) => PROTECTED_FILES.test(name) || PROTECTED_DIRS.test(name);

/** Parses a task-supplied relative path into safe segments, or throws. "" and "." mean the root itself. */
export function relativeSegments(raw: string): string[] {
  if (typeof raw !== "string" || raw.length > 400) throw new FileScopeError("Paths are at most 400 characters.");
  const text = raw.trim().replace(/\\/g, "/");
  if (text === "" || text === ".") return [];
  if (text.startsWith("/") || /^[A-Za-z]:/.test(text) || text.startsWith("//")) throw new FileScopeError("Use a path relative to the granted folder.");
  const segments = text.split("/").filter((s, i, all) => !(s === "" && i === all.length - 1));
  if (segments.length > 24) throw new FileScopeError("That path is too deep.");
  for (const s of segments) {
    if (s === "" || s === "." || s === "..") throw new FileScopeError("Paths may not contain empty, '.' or '..' parts.");
    // eslint-disable-next-line no-control-regex
    if (/[<>:"|?*\u0000-\u001f]/.test(s)) throw new FileScopeError("Paths may not contain : < > \" | ? * or control characters.");
    if (/[. ]$/.test(s)) throw new FileScopeError("Path parts may not end with a dot or a space.");
    if (RESERVED.test(s)) throw new FileScopeError("Device names are not files.");
    if (/~\d/.test(s)) throw new FileScopeError("Short (8.3) names are refused; use the full name.");
  }
  return segments;
}
const display = (segments: string[]) => segments.join("/") || ".";
const same = (a: string, b: string) => process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;

export type FileRoot = { id: string; label: string; path: string };
const RootSchema = z.object({ id: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/), label: z.string().trim().min(1).max(60), path: z.string().min(3).max(400) }).strict();
const ROOTS_KEY = "ma4_connector_file_roots_v1";

/** Owner-registered folders. Registering is a workstation command; tasks only ever see ids. */
export class FileRootRegistry {
  readonly host: HostDatabase;
  /** Folders a root may neither be nor contain (the Host's own state, credentials and diagnostics). */
  readonly protectedPaths: string[];
  constructor(host: HostDatabase, protectedPaths: string[]) {
    this.host = host; this.protectedPaths = protectedPaths.map(p => resolve(p));
    host.db.exec("CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL)");
  }
  list(): FileRoot[] {
    const row = this.host.db.prepare("SELECT value FROM settings WHERE key=?").get(ROOTS_KEY) as { value: string } | undefined;
    try { return z.array(RootSchema).max(16).parse(row ? JSON.parse(row.value) : []); } catch { return []; }
  }
  get(id: string): FileRoot | null { return this.list().find(r => r.id === id) ?? null; }
  /** Validates and stores the whole set. A root must be an existing, link-free, non-system folder. */
  set(raw: unknown): FileRoot[] {
    const roots = z.array(RootSchema).max(16).parse(raw).map(root => ({ ...root, path: this.checkRoot(root.path) }));
    if (new Set(roots.map(r => r.id)).size !== roots.length) throw new FileScopeError("Folder ids must be unique.");
    this.host.db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(ROOTS_KEY, JSON.stringify(roots));
    return roots;
  }
  private checkRoot(path: string): string {
    if (!isAbsolute(path)) throw new FileScopeError("A folder must be an absolute path.");
    const st = lstatSync(path, { throwIfNoEntry: false });
    if (!st || !st.isDirectory() || st.isSymbolicLink()) throw new FileScopeError("A folder must be an existing directory, not a link.");
    const real = realpathSync.native(path);
    if (!same(real, resolve(path))) throw new FileScopeError("That folder is reached through a link; register its real location.");
    if (same(dirname(real), real)) throw new FileScopeError("A whole drive cannot be granted.");
    const env = process.env;
    const system = [env.SystemRoot, env.windir, env.ProgramFiles, env["ProgramFiles(x86)"], env.ProgramData, env.APPDATA, env.LOCALAPPDATA, "/etc", "/usr", "/bin", "/var", "/proc", "/sys"].filter(Boolean) as string[];
    const under = (child: string, parent: string) => same(child, parent) || (process.platform === "win32" ? child.toLowerCase().startsWith(parent.toLowerCase().replace(/[\\/]+$/, "") + sep) : child.startsWith(parent.replace(/\/+$/, "") + sep));
    if (system.some(s => under(real, resolve(s)))) throw new FileScopeError("System and application folders cannot be granted.");
    if (same(real, homedir())) throw new FileScopeError("Your whole user folder cannot be granted; choose a project folder.");
    if (this.protectedPaths.some(p => under(p, real) || under(real, p))) throw new FileScopeError("A granted folder may not contain or sit inside Bunny's own state.");
    return real;
  }
}

type Walked = { abs: string; stat: BigIntStats; segments: string[] };
/** The handle-and-identity checked walk described above. Never follows a link. */
export function walk(root: FileRoot, rel: string): Walked {
  const segments = relativeSegments(rel);
  const top = lstatSync(root.path, { throwIfNoEntry: false, bigint: true });
  if (!top || !top.isDirectory() || top.isSymbolicLink() || !same(realpathSync.native(root.path), root.path)) throw new FileScopeError(`Folder "${root.id}" is no longer available as registered.`);
  let abs = root.path, stat = top;
  for (const [i, segment] of segments.entries()) {
    if (isProtectedName(segment)) throw new FileScopeError(`${display(segments)} is protected; Bunny never reads credential or key files.`);
    abs = join(abs, segment);
    const next = lstatSync(abs, { throwIfNoEntry: false, bigint: true });
    if (!next) throw new FileScopeError(`${display(segments)} was not found in "${root.id}".`);
    if (next.isSymbolicLink()) throw new FileScopeError(`${display(segments.slice(0, i + 1))} is a link; links are not followed.`);
    if (i < segments.length - 1 && !next.isDirectory()) throw new FileScopeError(`${display(segments.slice(0, i + 1))} is not a folder.`);
    stat = next;
  }
  if (!same(realpathSync.native(abs), abs)) throw new FileScopeError(`${display(segments)} resolves outside its folder (a link or reparse point).`);
  if (stat.isFile() && stat.nlink > 1n) throw new FileScopeError(`${display(segments)} has several hard links; it is not read.`);
  return { abs, stat, segments };
}

/** Reads a walked file through one handle whose identity must still be the walked file. Text only. */
export function readText(w: Walked): { text: string; sha256: string; size: number } {
  if (!w.stat.isFile()) throw new FileScopeError(`${display(w.segments)} is not a file.`);
  if (w.stat.size > BigInt(MAX_FILE_BYTES)) throw new FileScopeError(`${display(w.segments)} is larger than ${MAX_FILE_BYTES / 1024} KiB.`);
  const fd = openSync(w.abs, constants.O_RDONLY);
  try {
    const now = fstatSync(fd, { bigint: true });
    if (!now.isFile() || now.ino !== w.stat.ino || now.dev !== w.stat.dev || now.nlink > 1n) throw new FileScopeError(`${display(w.segments)} changed while it was opened; nothing was read.`);
    const size = Number(now.size), buffer = Buffer.alloc(size);
    let read = 0;
    while (read < size) { const n = readSync(fd, buffer, read, size - read, read); if (n === 0) break; read += n; }
    const bytes = buffer.subarray(0, read);
    if (bytes.subarray(0, 8000).includes(0)) throw new FileScopeError(`${display(w.segments)} is a binary file; only text is read.`);
    return { text: bytes.toString("utf8"), sha256: sha256(bytes.toString("utf8")), size: read };
  } finally { closeSync(fd); }
}

/** Short line diff for previews: changed lines with a little context, bounded. */
export function lineDiff(before: string, after: string, max = 300): string {
  const a = before.split(/\r?\n/), b = after.split(/\r?\n/);
  if (a.length * b.length > 4_000_000) return `(${a.length} lines before, ${b.length} after; too large to preview line by line)`;
  const m = a.length, n = b.length, lcs: Uint32Array[] = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1));
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const out: string[] = [];
  let i = 0, j = 0;
  while ((i < m || j < n) && out.length < max) {
    if (i < m && j < n && a[i] === b[j]) { i++; j++; continue; }
    // Removed lines before added ones, as in a unified diff.
    if (i < m && (j >= n || lcs[i + 1][j] >= lcs[i][j + 1])) { out.push(`-${i + 1}: ${a[i]}`); i++; }
    else { out.push(`+${j + 1}: ${b[j]}`); j++; }
  }
  return out.length ? out.join("\n") + (out.length >= max ? "\n(preview truncated)" : "") : "(no change)";
}

type Deps = { roots: FileRootRegistry; backupDirectory: string };
const rootId = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/);
/** The same parser as the walk, so an unsafe path is refused when the task is created, not only when it runs. */
const relPath = z.string().max(400).refine(p => { try { relativeSegments(p); return true; } catch { return false; } }, "Use a plain path relative to the granted folder (no '..', drive letters, streams or device names).");
const stepRef = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/);
const fileReq = (root: string, access: "read" | "write"): Requirement[] => [{ kind: "file", root, access }];
const base = { schema: ACTION_SCHEMA, connector: "local-files" as const, resource: "file", untrusted: true, maxResultChars: RESULT_CHARS };

function rootOf(deps: Deps, id: string): FileRoot {
  const root = deps.roots.get(id);
  if (!root) throw new FileScopeError(`Folder "${id}" is not registered on this PC.`);
  return root;
}
const fail = (error: unknown) => ({ ok: false as const, error: error instanceof Error ? error.message : String(error), dispatched: false });
const entryOf = (abs: string, name: string) => {
  const st = lstatSync(abs, { throwIfNoEntry: false });
  if (!st) return null;
  const type = st.isSymbolicLink() ? "link" as const : st.isDirectory() ? "dir" as const : st.isFile() ? "file" as const : null;
  return type ? { name, type, size: st.isFile() ? st.size : null, modifiedAt: Math.round(st.mtimeMs) } : null;
};
/** Bounded recursive walk for search and change detection: links, protected names and huge trees are never entered. */
function* files(root: FileRoot, start: Walked, budget: { files: number }): Generator<{ abs: string; rel: string }> {
  const stack: { abs: string; rel: string[] }[] = [{ abs: start.abs, rel: start.segments }];
  while (stack.length && budget.files > 0) {
    const dir = stack.pop()!;
    let names: string[];
    try { names = readdirSync(dir.abs).sort(); } catch { continue; }
    for (const name of names) {
      if (isProtectedName(name) || budget.files <= 0) continue;
      const abs = join(dir.abs, name), st = lstatSync(abs, { throwIfNoEntry: false });
      if (!st || st.isSymbolicLink()) continue;
      if (st.isDirectory()) stack.push({ abs, rel: [...dir.rel, name] });
      else if (st.isFile()) { budget.files--; yield { abs, rel: [...dir.rel, name].join("/") }; }
    }
  }
}
function tryRead(root: FileRoot, rel: string) { try { return readText(walk(root, rel)); } catch { return null; } }

/** New content for prepare/apply: literal (bounded) or the raw text a generating step produced — never a connector result. */
function proposedContent(input: { content?: string; contentFrom?: string }, ctx: ActionContext): string {
  if ((input.content === undefined) === (input.contentFrom === undefined)) throw new FileScopeError("Give exactly one of content or contentFrom.");
  const text = input.content ?? ctx.outputOf(input.contentFrom!);
  if (text === null || text === undefined) throw new FileScopeError(`Step ${input.contentFrom} has no result to write.`);
  if (text.includes(`"schema":"${RESULT_SCHEMA}"`)) throw new FileScopeError("contentFrom must name a generating step, not a connector result.");
  if (Buffer.byteLength(text) > MAX_WRITE_BYTES) throw new FileScopeError(`New content exceeds ${MAX_WRITE_BYTES / 1024} KiB.`);
  return text;
}

export function fileConnectors(deps: Deps): Connector<never>[] {
  const available = (r: Requirement) => r.kind === "file" && !deps.roots.get(r.root) ? `Folder "${r.root}" is not registered on this PC.` : null;

  const list: Connector<{ root: string; path: string; limit: number }> = {
    available,
    contract: { ...base, kind: "file.list", operation: "list", category: "read_only", sideEffect: false, consequential: false, activity: "Reading files", idempotency: "none", timeoutMs: 15_000,
      input: z.object({ root: rootId, path: relPath.default(""), limit: z.number().int().min(1).max(500).default(200) }).strict(),
      result: z.object({ root: z.string(), path: z.string(), entries: z.array(z.object({ name: z.string(), type: z.enum(["file", "dir", "link"]), size: z.number().nullable(), modifiedAt: z.number() })), truncated: z.boolean() }),
      requires: i => fileReq(i.root, "read") },
    async run(i) {
      try {
        const w = walk(rootOf(deps, i.root), i.path);
        if (!w.stat.isDirectory()) throw new FileScopeError(`${display(w.segments)} is not a folder.`);
        const names = readdirSync(w.abs).filter(n => !isProtectedName(n)).sort();
        const entries = names.slice(0, i.limit).flatMap(n => { const e = entryOf(join(w.abs, n), n); return e ? [e] : []; });
        return { ok: true, result: { root: i.root, path: display(w.segments), entries, truncated: names.length > i.limit } };
      } catch (error) { return fail(error); }
    },
  };

  const read: Connector<{ root: string; path: string; maxChars: number }> = {
    available,
    contract: { ...base, kind: "file.read", operation: "read", category: "read_only", sideEffect: false, consequential: false, activity: "Reading files", idempotency: "none", timeoutMs: 15_000,
      input: z.object({ root: rootId, path: relPath.min(1), maxChars: z.number().int().min(100).max(MAX_READ_CHARS).default(MAX_READ_CHARS) }).strict(),
      result: z.object({ root: z.string(), path: z.string(), sha256: z.string(), size: z.number(), modifiedAt: z.number(), content: z.string(), truncated: z.boolean() }),
      requires: i => fileReq(i.root, "read") },
    async run(i) {
      try {
        const w = walk(rootOf(deps, i.root), i.path), file = readText(w);
        return { ok: true, result: { root: i.root, path: display(w.segments), sha256: file.sha256, size: file.size, modifiedAt: Number(w.stat.mtimeMs), content: file.text.slice(0, i.maxChars), truncated: file.text.length > i.maxChars } };
      } catch (error) { return fail(error); }
    },
  };

  const stat: Connector<{ root: string; path: string }> = {
    available,
    contract: { ...base, kind: "file.stat", operation: "metadata", category: "read_only", sideEffect: false, consequential: false, activity: "Reading files", idempotency: "none", timeoutMs: 15_000,
      input: z.object({ root: rootId, path: relPath }).strict(),
      result: z.object({ root: z.string(), path: z.string(), type: z.enum(["file", "dir"]), size: z.number().nullable(), modifiedAt: z.number(), sha256: z.string().nullable() }),
      requires: i => fileReq(i.root, "read") },
    async run(i) {
      try {
        const w = walk(rootOf(deps, i.root), i.path), dir = w.stat.isDirectory();
        const hash = dir ? null : w.stat.size <= BigInt(MAX_FILE_BYTES) ? (() => { try { return readText(w).sha256; } catch { return null; } })() : null;
        return { ok: true, result: { root: i.root, path: display(w.segments), type: dir ? "dir" : "file", size: dir ? null : Number(w.stat.size), modifiedAt: Number(w.stat.mtimeMs), sha256: hash } };
      } catch (error) { return fail(error); }
    },
  };

  const search: Connector<{ root: string; path: string; query: string; content: boolean; limit: number }> = {
    available,
    contract: { ...base, kind: "file.search", operation: "search", category: "read_only", sideEffect: false, consequential: false, activity: "Reading files", idempotency: "none", timeoutMs: 60_000,
      input: z.object({ root: rootId, path: relPath.default(""), query: z.string().trim().min(1).max(200), content: z.boolean().default(false), limit: z.number().int().min(1).max(100).default(50) }).strict(),
      result: z.object({ root: z.string(), query: z.string(), matches: z.array(z.object({ path: z.string(), line: z.number().nullable(), excerpt: z.string().nullable() })), scanned: z.number(), truncated: z.boolean() }),
      requires: i => fileReq(i.root, "read") },
    async run(i, ctx) {
      try {
        const root = rootOf(deps, i.root), start = walk(root, i.path), budget = { files: SEARCH_FILES };
        if (!start.stat.isDirectory()) throw new FileScopeError(`${display(start.segments)} is not a folder.`);
        const q = i.query.toLowerCase(), matches: { path: string; line: number | null; excerpt: string | null }[] = [];
        let scanned = 0, bytes = 0;
        for (const f of files(root, start, budget)) {
          if (matches.length >= i.limit || ctx.signal.aborted) break;
          scanned++;
          if (f.rel.split("/").pop()!.toLowerCase().includes(q)) matches.push({ path: f.rel, line: null, excerpt: null });
          else if (i.content && bytes < SEARCH_BYTES) {
            const file = tryRead(root, f.rel);
            if (!file) continue;
            bytes += file.size;
            const lines = file.text.split(/\r?\n/), at = lines.findIndex(l => l.toLowerCase().includes(q));
            if (at >= 0) matches.push({ path: f.rel, line: at + 1, excerpt: lines[at].trim().slice(0, 200) });
          }
        }
        return { ok: true, result: { root: i.root, query: i.query, matches, scanned, truncated: matches.length >= i.limit || budget.files <= 0 || bytes >= SEARCH_BYTES } };
      } catch (error) { return fail(error); }
    },
  };

  const changes: Connector<{ root: string; path: string; sinceHours: number; limit: number }> = {
    available,
    contract: { ...base, kind: "file.changes", operation: "changes", category: "read_only", sideEffect: false, consequential: false, activity: "Reading files", idempotency: "none", timeoutMs: 60_000,
      input: z.object({ root: rootId, path: relPath.default(""), sinceHours: z.number().int().min(1).max(24 * 90), limit: z.number().int().min(1).max(20).default(10) }).strict(),
      result: z.object({ root: z.string(), since: z.number(), changed: z.array(z.object({ path: z.string(), size: z.number(), modifiedAt: z.number(), sha256: z.string().nullable(), excerpt: z.string().nullable() })), scanned: z.number(), truncated: z.boolean() }),
      requires: i => fileReq(i.root, "read") },
    async run(i, ctx) {
      try {
        const root = rootOf(deps, i.root), start = walk(root, i.path), since = ctx.now() - i.sinceHours * 3_600_000, budget = { files: SEARCH_FILES };
        if (!start.stat.isDirectory()) throw new FileScopeError(`${display(start.segments)} is not a folder.`);
        const recent: { rel: string; at: number; size: number }[] = [];
        let scanned = 0;
        for (const f of files(root, start, budget)) { scanned++; const st = lstatSync(f.abs, { throwIfNoEntry: false }); if (st && st.mtimeMs >= since) recent.push({ rel: f.rel, at: Math.round(st.mtimeMs), size: st.size }); }
        recent.sort((a, b) => b.at - a.at || a.rel.localeCompare(b.rel));
        const changed = recent.slice(0, i.limit).map(r => { const file = tryRead(root, r.rel); return { path: r.rel, size: r.size, modifiedAt: r.at, sha256: file?.sha256 ?? null, excerpt: file ? file.text.slice(0, 1_500) : null }; });
        return { ok: true, result: { root: i.root, since, changed, scanned, truncated: recent.length > i.limit || budget.files <= 0 } };
      } catch (error) { return fail(error); }
    },
  };

  type EditInput = { root: string; path: string; content?: string; contentFrom?: string; expectedSha256?: string };
  const editInput = z.object({ root: rootId, path: relPath.min(1), content: z.string().max(8_000).optional(), contentFrom: stepRef.optional(), expectedSha256: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict();
  const resolveEdit = (i: EditInput, ctx: ActionContext) => {
    const root = rootOf(deps, i.root), w = walk(root, i.path), current = readText(w), next = proposedContent(i, ctx);
    if (i.expectedSha256 && i.expectedSha256 !== current.sha256) throw new FileScopeError(`${display(w.segments)} changed since it was read (version ${current.sha256.slice(0, 12)}, expected ${i.expectedSha256.slice(0, 12)}).`);
    return { root, w, current, next, nextSha256: sha256(next) };
  };

  const prepare: Connector<EditInput> = {
    available,
    contract: { ...base, kind: "file.prepare", operation: "prepare-edit", category: "read_only", sideEffect: false, consequential: false, activity: "Preparing draft", idempotency: "none", timeoutMs: 15_000,
      input: editInput, result: z.object({ root: z.string(), path: z.string(), currentSha256: z.string(), proposedSha256: z.string(), unchanged: z.boolean(), diff: z.string() }),
      requires: i => fileReq(i.root, "read") },
    async run(i, ctx) {
      try { const e = resolveEdit(i, ctx); return { ok: true, result: { root: i.root, path: display(e.w.segments), currentSha256: e.current.sha256, proposedSha256: e.nextSha256, unchanged: e.current.sha256 === e.nextSha256, diff: lineDiff(e.current.text, e.next).slice(0, 20_000) } }; }
      catch (error) { return fail(error); }
    },
  };

  const apply: Connector<EditInput> = {
    available,
    contract: { ...base, untrusted: false, kind: "file.apply", operation: "replace", category: "idempotent", sideEffect: true, consequential: true, activity: "Executing", idempotency: "conditional", timeoutMs: 30_000,
      input: editInput, result: z.object({ root: z.string(), path: z.string(), previousSha256: z.string(), sha256: z.string(), backup: z.boolean() }),
      requires: i => fileReq(i.root, "write") },
    async prepare(i, ctx): Promise<Prepared> {
      const e = resolveEdit(i, ctx), path = display(e.w.segments);
      return { target: `Folder "${i.root}"`, summary: `Replace ${path} (${e.current.size} → ${Buffer.byteLength(e.next)} bytes)`,
        effects: ["Changes one file on this PC.", "The previous version is kept in Bunny's backup folder."], data: [`Reads ${path} to check its version.`],
        changes: [`${path}: version ${e.current.sha256.slice(0, 12)} → ${e.nextSha256.slice(0, 12)}`], preview: lineDiff(e.current.text, e.next), reversible: true,
        payload: { root: i.root, path, expectedSha256: e.current.sha256, newSha256: e.nextSha256 } };
    },
    async run(i, ctx, prepared) {
      const payload = prepared!.payload as { path: string; expectedSha256: string; newSha256: string };
      let e: ReturnType<typeof resolveEdit>;
      try { e = resolveEdit(i, ctx); } catch (error) { return fail(error); }
      // The approved version must still be on disk, and the content must still be the approved content.
      if (e.current.sha256 !== payload.expectedSha256 || e.nextSha256 !== payload.newSha256) return { ok: false, error: `${payload.path} changed after you approved it; nothing was written. It will be shown to you again.`, dispatched: false };
      const backup = join(deps.backupDirectory, ctx.taskId.slice(0, 80), `${ctx.stepId}-${payload.expectedSha256.slice(0, 16)}.orig`);
      mkdirSync(dirname(backup), { recursive: true });
      copyFileSync(e.w.abs, backup);
      const temp = join(dirname(e.w.abs), `.${e.w.segments.at(-1)}.bunny-${randomBytes(6).toString("hex")}.tmp`);
      let fd: number | null = null;
      try {
        fd = openSync(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
        const bytes = Buffer.from(e.next, "utf8");
        let written = 0; while (written < bytes.length) written += writeSync(fd, bytes, written, bytes.length - written);
        fsyncSync(fd); closeSync(fd); fd = null;
        // Second version check right before the atomic replace.
        if (readText(walk(e.root, i.path)).sha256 !== payload.expectedSha256) { rmSync(temp, { force: true }); return { ok: false, error: `${payload.path} changed while writing; nothing was replaced.`, dispatched: false }; }
        renameSync(temp, e.w.abs);
      } catch (error) {
        if (fd !== null) closeSync(fd);
        rmSync(temp, { force: true });
        // A failure before rename leaves the original untouched; the rename itself is atomic.
        return { ok: false, error: error instanceof Error ? error.message : String(error), dispatched: true, definite: true };
      }
      return { ok: true, result: { root: i.root, path: payload.path, previousSha256: payload.expectedSha256, sha256: payload.newSha256, backup: true }, receipt: `sha256:${payload.newSha256}` };
    },
    async verify(i, ctx) {
      try {
        const next = sha256(proposedContent(i, ctx)), now = readText(walk(rootOf(deps, i.root), i.path));
        return now.sha256 === next ? { found: true, result: { root: i.root, path: i.path, previousSha256: i.expectedSha256 ?? "unknown", sha256: next, backup: true }, receipt: `sha256:${next}` } : { found: false };
      } catch { return { found: false }; }
    },
  };
  return [list, read, stat, search, changes, prepare, apply] as unknown as Connector<never>[];
}
