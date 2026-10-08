import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, basename, join } from "node:path";

/**
 * Resolves a path the way the OS will see it: symlinks/junctions in the existing part are followed, so
 * a link inside an approved folder cannot point the operation outside it. Missing tails are appended.
 */
export function canonical(path: string): string {
  let current = resolve(path); const tail: string[] = [];
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) return resolve(path);
    tail.unshift(basename(current)); current = parent;
  }
  return join(realpathSync(current), ...tail);
}

/** True when `path` is `root` or inside it after canonicalization. */
export function within(root: string, path: string): boolean {
  const base = canonical(root); const target = canonical(path);
  const rel = relative(base, target);
  if (process.platform === "win32" && base.slice(0, 2).toLowerCase() !== target.slice(0, 2).toLowerCase()) return false;
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function withinAny(roots: string[], path: string): boolean { return roots.some((root) => within(root, path)); }

/** Private authority/runtime state never becomes an Agent project resource, even under a broad root. */
export function privateHostPath(dataDirectory: string, path: string): boolean {
  return ["host.sqlite", "host.sqlite-wal", "host.sqlite-shm", "credentials.json", "remote.json", "state-layout.json", "state-retired.json", "credentials", "settings", "runtime", "sessions", "logs", "agentic-terminal", "browser-profile", "browser-sessions"]
    .some(name => within(join(dataDirectory, name), path));
}

/** Resolves a user/agent-supplied path against a base folder and refuses anything that escapes every allowed root. */
export function scopedPath(base: string, path: string, roots: string[]): string {
  const target = canonical(isAbsolute(path) ? path : join(base, path));
  if (!withinAny(roots, target)) throw new Error(`Path is outside the approved scope: ${target}`);
  return target;
}
