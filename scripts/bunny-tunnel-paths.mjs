import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, relative } from "node:path";
import { developmentStateDirectory } from "../src/lib/bunny-host/state-paths.server.ts";

export function tunnelPaths(env = process.env, _cwd = process.cwd()) {
  const installed = env.BUNNY_STATE_LAYOUT === "2";
  if (installed && (!env.BUNNY_HOST_DATA_DIRECTORY || !isAbsolute(env.BUNNY_HOST_DATA_DIRECTORY))) throw new Error("Installed tunnel needs an explicit state directory.");
  const root = resolve(env.BUNNY_HOST_DATA_DIRECTORY ?? developmentStateDirectory(env));
  const data = root;
  if (!installed && existsSync(join(data, "state-retired.json"))) throw new Error("Retired production state cannot start a development tunnel.");
  const paths = {
    root, data, installed,
    binary: join(data, installed ? "cloudflared/cloudflared.exe" : "tools/cloudflared.exe"),
    credentials: join(data, installed ? "credentials/credentials.json" : "credentials.json"),
    config: join(data, installed ? "settings/tunnel.json" : "tunnel.json"),
    process: join(data, installed ? "runtime/tunnel-process.json" : "tunnel-process.json"),
    remote: join(data, installed ? "settings/remote.json" : "remote.json"),
  };
  assertOutsideGit(data);
  if (installed) {
    for (const path of [paths.binary, paths.credentials, paths.config, paths.process, paths.remote]) {
      if (relative(data, path).startsWith("..")) throw new Error("Tunnel path escaped installed state.");
      assertOutsideGit(path);
    }
    const tool = JSON.parse(readFileSync(join(data, "cloudflared/tool.json"), "utf8"));
    if (!env.BUNNY_CLOUDFLARED_SHA256 || tool.sha256 !== env.BUNNY_CLOUDFLARED_SHA256 || !existsSync(paths.binary) || createHash("sha256").update(readFileSync(paths.binary)).digest("hex") !== env.BUNNY_CLOUDFLARED_SHA256.toLowerCase()) throw new Error("Installed Cloudflare client is missing or changed.");
  }
  return paths;
}

export function assertOutsideGit(path) {
  for (let folder = resolve(path); ; folder = dirname(folder)) {
    if (existsSync(join(folder, ".git"))) throw new Error("Tunnel dependencies must be outside Git.");
    if (existsSync(folder) && lstatSync(folder).isSymbolicLink()) throw new Error("Installed tunnel dependencies cannot use links.");
    if (dirname(folder) === folder) break;
  }
}
