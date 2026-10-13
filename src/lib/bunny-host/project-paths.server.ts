import { existsSync, lstatSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import type { RootIdentity } from "./project-types.ts";

/** Reject path grammars that cannot be safely represented by the local Host contract. */
export function regularPath(path: string): string {
  if (
    typeof path !== "string" ||
    !path ||
    path.length > 4096 ||
    [...path].some((char) => char.charCodeAt(0) < 32)
  )
    throw new Error("Invalid workspace path.");
  if (
    process.platform === "win32" &&
    (/^\\\\/.test(path) ||
      path.slice(2).includes(":") ||
      /(^|[\\/])(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|[\\/]|$)/i.test(path) ||
      path.split(/[\\/]/).some((part) => /[. ]$/.test(part) && part !== "." && part !== ".."))
  )
    throw new Error("UNC, device, alternate stream and ambiguous Windows paths are unsupported.");
  return resolve(path);
}
export function noLinks(path: string): string {
  const full = regularPath(path);
  for (let folder = full; ; folder = dirname(folder)) {
    if (existsSync(folder) && lstatSync(folder).isSymbolicLink())
      throw new Error("Workspace symlinks and junctions are not permitted.");
    if (dirname(folder) === folder) break;
  }
  return full;
}
export function fileIdentity(path: string): string {
  noLinks(path);
  const info = statSync(path, { bigint: true });
  return `${info.dev}:${info.ino}:${info.birthtimeNs}`;
}
export function inspectRoot(path: string): RootIdentity {
  const full = noLinks(path);
  if (!statSync(full).isDirectory())
    throw new Error("Project root must be an accessible directory.");
  const root = realpathSync.native(full);
  noLinks(root);
  return { path: root, identity: fileIdentity(root) };
}
export function contained(root: string, path: string): boolean {
  const rel = relative(regularPath(root), regularPath(path));
  return (
    rel === "" ||
    (rel !== ".." &&
      !rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) &&
      !isAbsolute(rel))
  );
}
export function validateIdentity(ref: RootIdentity): void {
  const current = inspectRoot(ref.path);
  if (current.identity !== ref.identity)
    throw new Error("CONTEXT_CHANGED: directory identity changed; relink and review access.");
}
