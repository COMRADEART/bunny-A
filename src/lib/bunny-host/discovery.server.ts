import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { posix, win32 } from "node:path";
import type { ProviderId } from "../orch/types.ts";

/** Everything discovery reads from the machine, injectable so detection rules are testable without real installs. */
export type DiscoveryContext = {
  platform: string;
  env: Record<string, string | undefined>;
  home: string;
  exists: (path: string) => boolean;
  read: (path: string) => string;
  list: (path: string) => string[];
  /** Node used to run npm node-script shims; the Host's own runtime. */
  nodePath: string;
  /** User-configured executable paths (Host settings). */
  configured: Partial<Record<ProviderId, string>>;
};

/** How Bunny-A would start a provider. Always spawned directly, never through a shell. */
export type Launchable = {
  command: string;
  args: string[];
  path: string;
  kind: "native" | "node-script";
  source: string;
};
export type Located = { launch: Launchable | null; checked: string[]; note?: string; version?: string | null };

export function systemContext(configured: Partial<Record<ProviderId, string>> = {}): DiscoveryContext {
  return {
    platform: process.platform,
    env: process.env,
    home: homedir(),
    exists: (path) => existsSync(path),
    read: (path) => readFileSync(path, "utf8"),
    list: (path) => { try { return readdirSync(path); } catch { return []; } },
    nodePath: process.execPath,
    configured,
  };
}

const windows = (ctx: DiscoveryContext) => ctx.platform === "win32";
const join = (ctx: DiscoveryContext, ...parts: string[]) => (windows(ctx) ? win32 : posix).join(...parts);
const dir = (ctx: DiscoveryContext, path: string) => (windows(ctx) ? win32 : posix).dirname(path);
const env = (ctx: DiscoveryContext, name: string) => ctx.env[name] ?? (windows(ctx) ? Object.entries(ctx.env).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1] : undefined);

/** Every match on PATH in search order, like where.exe: native .exe before .cmd shims within a directory. */
export function searchPath(ctx: DiscoveryContext, name: string): string[] {
  const dirs = (env(ctx, "PATH") ?? "").split(windows(ctx) ? ";" : ":").map((entry) => entry.trim().replace(/^"|"$/g, "")).filter(Boolean);
  const suffixes = windows(ctx) ? [".exe", ".cmd"] : [""];
  const found: string[] = [];
  for (const directory of dirs) for (const suffix of suffixes) {
    const candidate = join(ctx, directory, name + suffix);
    if (ctx.exists(candidate) && !found.some((path) => path.toLowerCase() === candidate.toLowerCase())) found.push(candidate);
  }
  return found;
}

/**
 * Reads an npm cmd-shim to find what it really runs. npm writes either a direct call to a bundled
 * native executable or `node <script>`; anything else is left unsupported rather than run via cmd.exe.
 */
export function parseNpmShim(text: string): { relative: string; viaNode: boolean } | null {
  const targets = [...text.matchAll(/"%dp0%\\([^"]+)"/g)].map((match) => match[1]).filter((target) => !/^node(\.exe)?$/i.test(target));
  const target = targets.at(-1);
  if (!target) return null;
  return { relative: target, viaNode: !/\.exe$/i.test(target) };
}

function fromCandidate(ctx: DiscoveryContext, path: string, source: string, checked: string[]): Launchable | null {
  checked.push(`${source}: ${path}`);
  if (!ctx.exists(path)) return null;
  if (/\.cmd$/i.test(path)) {
    let shim: ReturnType<typeof parseNpmShim> = null;
    try { shim = parseNpmShim(ctx.read(path)); } catch { shim = null; }
    if (!shim) { checked.push(`unsupported shim (not an npm cmd-shim): ${path}`); return null; }
    const target = join(ctx, dir(ctx, path), ...shim.relative.split("\\"));
    if (!ctx.exists(target)) { checked.push(`shim target missing: ${target}`); return null; }
    return shim.viaNode
      ? { command: ctx.nodePath, args: [target], path: target, kind: "node-script", source: `${source} (npm shim → node script)` }
      : { command: target, args: [], path: target, kind: "native", source: `${source} (npm shim → native executable)` };
  }
  return { command: path, args: [], path, kind: "native", source };
}

function first(ctx: DiscoveryContext, id: ProviderId, names: string[], known: string[]): Located {
  const checked: string[] = [];
  const configured = ctx.configured[id];
  if (configured) {
    const launch = fromCandidate(ctx, configured, "user-configured path", checked);
    if (launch) return { launch, checked };
  }
  const variable = env(ctx, `BUNNY_${id.toUpperCase()}_PATH`);
  if (variable) {
    const launch = fromCandidate(ctx, variable, `BUNNY_${id.toUpperCase()}_PATH`, checked);
    if (launch) return { launch, checked };
  }
  for (const name of names) for (const path of searchPath(ctx, name)) {
    const launch = fromCandidate(ctx, path, "PATH", checked);
    if (launch) return { launch, checked };
  }
  for (const path of known) {
    const launch = fromCandidate(ctx, path, "known install location", checked);
    if (launch) return { launch, checked };
  }
  if (!names.some((name) => searchPath(ctx, name).length)) checked.push(`PATH: no ${names.join(" / ")}`);
  return { launch: null, checked };
}

/** First launchable PATH match for harnesses that have no execution adapter (and so no `locate` case). */
export function locateAny(ctx: DiscoveryContext, names: readonly string[]): Launchable | null {
  for (const name of names)
    for (const path of searchPath(ctx, name)) {
      const launch = fromCandidate(ctx, path, "PATH", []);
      if (launch) return launch;
    }
  return null;
}

function appData(ctx: DiscoveryContext) { return env(ctx, "APPDATA") ?? join(ctx, ctx.home, "AppData", "Roaming"); }
function localAppData(ctx: DiscoveryContext) { return env(ctx, "LOCALAPPDATA") ?? join(ctx, ctx.home, "AppData", "Local"); }

/** Version folders such as 2026.09.10-fd3934a or 2026.09.10-12-30-45-fd3934a, newest first. */
export function newestVersionFolder(names: string[]): string | null {
  const key = (name: string) => {
    const match = /^(\d{4})\.(\d{1,2})\.(\d{1,2})(?:-(\d{2})-(\d{2})-(\d{2}))?-[a-f0-9]+$/.exec(name);
    if (!match) return null;
    return Number(match[1]) * 1e10 + Number(match[2]) * 1e8 + Number(match[3]) * 1e6 + Number(match[4] ?? 0) * 1e4 + Number(match[5] ?? 0) * 100 + Number(match[6] ?? 0);
  };
  return names.filter((name) => key(name) !== null).sort((a, b) => key(b)! - key(a)!)[0] ?? null;
}

export function locate(ctx: DiscoveryContext, id: ProviderId): Located {
  if (id === "openrouter") return { launch: null, checked: [], note: "HTTP inference; no executable discovery." };
  const npm = join(ctx, appData(ctx), "npm");
  const local = localAppData(ctx);
  switch (id) {
    case "codex":
      return first(ctx, id, ["codex"], windows(ctx)
        ? [join(ctx, local, "Programs", "OpenAI", "Codex", "bin", "codex.exe"), join(ctx, npm, "codex.cmd")]
        : [join(ctx, ctx.home, ".local", "bin", "codex"), "/usr/local/bin/codex", "/opt/homebrew/bin/codex"]);
    case "claude":
      return first(ctx, id, ["claude"], windows(ctx)
        ? [join(ctx, ctx.home, ".local", "bin", "claude.exe"), join(ctx, npm, "claude.cmd")]
        : [join(ctx, ctx.home, ".local", "bin", "claude"), join(ctx, ctx.home, ".claude", "local", "claude")]);
    case "ollama":
      return first(ctx, id, ["ollama"], windows(ctx)
        ? [join(ctx, local, "Programs", "Ollama", "ollama.exe"), join(ctx, env(ctx, "ProgramFiles") ?? "C:\\Program Files", "Ollama", "ollama.exe")]
        : ["/usr/local/bin/ollama", "/usr/bin/ollama", "/opt/homebrew/bin/ollama"]);
    case "opencode":
      return first(ctx, id, ["opencode"], windows(ctx)
        ? [join(ctx, npm, "opencode.cmd"), join(ctx, ctx.home, ".opencode", "bin", "opencode.exe")]
        : [join(ctx, ctx.home, ".opencode", "bin", "opencode")]);
    case "cline": {
      // Running any Cline command starts its self-updater (observed: `cline --version` ran
      // `npm update -g cline`). Discovery therefore reads the package manifest instead of executing it.
      const found = first(ctx, id, ["cline"], windows(ctx) ? [join(ctx, npm, "cline.cmd")] : []);
      if (!found.launch) return found;
      const manifest = join(ctx, dir(ctx, dir(ctx, found.launch.path)), "package.json");
      let version: string | null = null;
      try { version = (JSON.parse(ctx.read(manifest)) as { version?: string }).version ?? null; } catch { found.checked.push(`no readable manifest: ${manifest}`); }
      return { ...found, version, note: "Version read from the npm package manifest; Cline is not executed during discovery because it self-updates on launch." };
    }
    case "cursor": {
      const checked: string[] = [];
      const configured = ctx.configured.cursor ?? env(ctx, "BUNNY_CURSOR_PATH");
      const roots = [configured ? dir(ctx, configured) : null, join(ctx, local, "cursor-agent")].filter((root): root is string => !!root);
      for (const root of roots) {
        // cursor-agent.ps1 runs <root>\node.exe index.js, or the newest <root>\versions\<version>\node.exe index.js.
        const direct = ctx.exists(join(ctx, root, "node.exe")) && ctx.exists(join(ctx, root, "index.js")) ? root : null;
        const newest = direct ? null : newestVersionFolder(ctx.list(join(ctx, root, "versions")));
        const home = direct ?? (newest ? join(ctx, root, "versions", newest) : null);
        checked.push(`known install location: ${join(ctx, root, "versions")}`);
        if (!home) continue;
        const node = join(ctx, home, "node.exe"), script = join(ctx, home, "index.js");
        if (!ctx.exists(node) || !ctx.exists(script)) { checked.push(`incomplete Cursor Agent install: ${home}`); continue; }
        return { launch: { command: node, args: [script], path: script, kind: "node-script", source: "known install location (bundled node)" }, checked, version: newest ?? null };
      }
      for (const name of ["cursor-agent", "agent"]) if (searchPath(ctx, name).length) checked.push(`PATH: ${name} launcher present but no runnable install was resolved`);
      return { launch: null, checked };
    }
  }
}

/** Whether a supporting tool (git, python) is on PATH; used for capability eligibility, not provider status. */
export function hasTool(ctx: DiscoveryContext, name: string): string | null {
  return searchPath(ctx, name).find((path) => /\.exe$/i.test(path) || !windows(ctx)) ?? null;
}
