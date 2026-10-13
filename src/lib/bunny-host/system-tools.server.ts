import { lstatSync, realpathSync } from "node:fs";
import { delimiter, isAbsolute, join, relative, sep } from "node:path";

/**
 * M-A-3 T9R-F04 (review round 3, BYPASS-CWD-1): Host tools are launched by absolute path. A bare name lets the child
 * process search its working directory before PATH, and the Host's working directory can be a folder a provider can
 * write. Windows tools come from %SystemRoot%\System32; anything else is resolved from absolute PATH entries outside
 * the Host's working directory.
 */
export function systemTool(name: "powershell.exe" | "taskkill.exe"): string {
  if (process.platform !== "win32") return name;
  const root = process.env.SystemRoot ?? process.env.windir ?? "C:\\Windows";
  return name === "powershell.exe" ? join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe") : join(root, "System32", name);
}
const canonical = (path: string) => { try { return realpathSync(path); } catch { return path; } };
const inside = (root: string, path: string) => { const rel = relative(root, path); return rel === "" || (!(rel === ".." || rel.startsWith(".." + sep)) && !isAbsolute(rel)); };
/** PATH-only lookup: never the working directory, never a relative PATH entry, never an entry inside `exclude`. */
export function pathTool(name: string, exclude = process.cwd(), path = process.env.PATH ?? process.env.Path ?? ""): string | null {
  const root = canonical(exclude);
  for (const folder of path.split(delimiter)) {
    if (!folder || !isAbsolute(folder) || inside(root, canonical(folder))) continue;
    for (const extension of process.platform === "win32" ? [".exe"] : [""]) {
      const candidate = join(folder, name.endsWith(extension) ? name : name + extension);
      try { if (!lstatSync(candidate).isDirectory() && !inside(root, canonical(candidate))) return candidate; } catch { /* not here */ }
    }
  }
  return null;
}
