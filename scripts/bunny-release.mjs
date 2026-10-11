// M-A-1D release helper: writes and verifies the manifest of a pinned Bunny-A release folder.
// Used by package-bunny-desktop.ps1 at build time and by tests; the installed release itself needs no Node tooling.
//   node scripts/bunny-release.mjs manifest <release>        record every file (sha256, origin) from .release-build.json
//   node scripts/bunny-release.mjs verify <release>          files on disk are exactly the manifest
//   node scripts/bunny-release.mjs closure <release>         the Host and tunnel import graphs stay inside the release
//   node scripts/bunny-release.mjs source-check <repo> <release>  source/tooling files equal their git blobs
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const MANIFEST = "release-manifest.json";
const BUILD_RECORD = ".release-build.json";
/** Entry points whose relative imports must all resolve inside the release. */
export const ENTRY_POINTS = ["Bunny-Host.mjs", "scripts/bunny-tunnel.mjs"];

const sha256 = (data) => createHash("sha256").update(data).digest("hex");
export const fileSha256 = (path) => sha256(readFileSync(path));

export function walkFiles(root) {
  const files = [];
  const visit = (folder) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Links are not allowed in a release: ${relative(root, path)}`);
      if (entry.isDirectory()) visit(path); else files.push(relative(root, path).split(sep).join("/"));
    }
  };
  visit(root);
  return files.sort();
}

function origin(path, recorded) {
  if (recorded.has(path)) return recorded.get(path);
  if (path.startsWith(".output/")) return { origin: "build" };
  if (path.startsWith("runtime/")) return { origin: "runtime" };
  if (path === "package.json") return { origin: "generated" };
  throw new Error(`Unclassified release file: ${path}`);
}

/** Highest `PRAGMA user_version=N` the packaged Host persistence code migrates to. */
export function hostSchemaVersion(release) {
  const source = readFileSync(join(release, "src/lib/bunny-host/persistence.server.ts"), "utf8");
  const versions = [...source.matchAll(/user_version\s*=\s*(\d+)/g)].map((m) => Number(m[1]));
  if (!versions.length) throw new Error("Packaged persistence code declares no schema version.");
  return Math.max(...versions);
}

export function writeManifest(release) {
  const recordPath = join(release, BUILD_RECORD);
  const record = JSON.parse(readFileSync(recordPath, "utf8"));
  rmSync(recordPath);
  const recorded = new Map(record.origins.map((o) => [o.path, { origin: o.origin, repoPath: o.repoPath }]));
  const files = walkFiles(release).filter((path) => path !== MANIFEST).map((path) => {
    const full = join(release, path);
    return { path, sha256: fileSha256(full), bytes: statSync(full).size, ...origin(path, recorded) };
  });
  for (const path of recorded.keys()) if (!files.some((f) => f.path === path)) throw new Error(`Recorded file missing from the release: ${path}`);
  const { origins: _origins, ...meta } = record;
  const assets=files.filter(file=>file.path.startsWith(".output/public/")).map(({path,sha256,bytes})=>({path,sha256,bytes}));
  const dashboard=record.build?.dashboardBuild ? {sourceCommit:record.sourceCommit,builtAt:record.builtAt,assetManifestSha256:sha256(JSON.stringify(assets)),assets:assets.length} : null;
  const manifest = { schema: "bunny-release-manifest/1", ...meta, dashboard, compatibility: { ...meta.compatibility, hostSchemaUserVersion: hostSchemaVersion(release) }, files };
  writeFileSync(join(release, MANIFEST), JSON.stringify(manifest, null, 1) + "\n");
  return manifest;
}

export function verifyRelease(release) {
  const manifest = JSON.parse(readFileSync(join(release, MANIFEST), "utf8"));
  const listed = new Map(manifest.files.map((f) => [f.path, f]));
  const onDisk = walkFiles(release).filter((p) => p !== MANIFEST);
  const extra = onDisk.filter((p) => !listed.has(p));
  const missing = [...listed.keys()].filter((p) => !onDisk.includes(p));
  const changed = onDisk.filter((p) => listed.has(p) && fileSha256(join(release, p)) !== listed.get(p).sha256);
  return { ok: !extra.length && !missing.length && !changed.length, checked: onDisk.length, extra, missing, changed };
}

// Statement-anchored so strings such as `"legacy.import": {` are not read as imports. `import type` / `export type`
// lines are erased by --experimental-strip-types and never resolved at runtime.
const STATIC_FROM = /^\s*(?:import|export)\s+(type\s+)?[^;]*?\bfrom\s*["']([^"'\n]+)["']/gm;
const SIDE_EFFECT = /^\s*import\s*["']([^"'\n]+)["']/gm;
const DYNAMIC = /\bimport\(\s*["']([^"'\n]+)["']\s*\)/g;
/** Packages the Host loads only through a guarded dynamic import; absent, the capability reports itself unavailable. */
export const OPTIONAL_PACKAGES = ["playwright"];
/** Walks runtime imports from the entry points. Every file must exist inside the release; no npm package is required. */
export function importClosure(release) {
  const root = resolve(release);
  const seen = new Set(); const missing = []; const outside = []; const packages = new Set(); const optional = new Set();
  const queue = ENTRY_POINTS.map((entry) => join(root, entry));
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    if (!existsSync(file)) { missing.push(relative(root, file).split(sep).join("/")); continue; }
    const text = readFileSync(file, "utf8");
    const specifiers = [
      ...[...text.matchAll(STATIC_FROM)].filter((m) => !m[1]).map((m) => ({ spec: m[2], dynamic: false })),
      ...[...text.matchAll(SIDE_EFFECT)].map((m) => ({ spec: m[1], dynamic: false })),
      ...[...text.matchAll(DYNAMIC)].map((m) => ({ spec: m[1], dynamic: true })),
    ];
    for (const { spec, dynamic } of specifiers) {
      if (spec.startsWith("node:")) continue;
      if (!spec.startsWith(".")) { (dynamic && OPTIONAL_PACKAGES.includes(spec) ? optional : packages).add(spec); continue; }
      const target = resolve(dirname(file), spec);
      if (relative(root, target).startsWith("..")) outside.push(`${relative(root, file)} -> ${spec}`); else queue.push(target);
    }
  }
  const files = [...seen].map((f) => relative(root, f).split(sep).join("/")).sort();
  // Native resources are loaded with createRequire rather than an ESM import.
  // Check them only for T4 releases; accepted older release closures stay valid.
  if(files.includes("src/lib/bunny-host/owned-process-group.server.ts")) {
    for(const path of ["native/bunny-owned-process.c","native/bunny-owned-process.node","native/bunny-owned-process.node.json","scripts/build-owned-process.mjs"]) {
      if(!existsSync(join(root,path))) missing.push(path);else files.push(path);
    }
  }
  // M-A-3 T10: the contained voice worker is spawned by path, never imported; a voice release must carry it.
  if(files.includes("src/lib/bunny-host/voice/voice-worker.server.ts")) {
    for(const path of ["native/voice/BunnyVoiceWorker.cs","native/voice/bunny-voice-worker.exe","native/voice/bunny-voice-worker.json","scripts/build-voice-worker.mjs"]) {
      if(!existsSync(join(root,path))) missing.push(path);else files.push(path);
    }
  }
  // T6 promises an executable bounded browser family, rather than an optional development import.
  if (existsSync(join(root, "src/lib/bunny-missions/cross-app.ts"))) {
    for (const path of ["node_modules/playwright/index.mjs", "node_modules/playwright-core/index.mjs", "node_modules/playwright/LICENSE", "node_modules/playwright-core/LICENSE"])
      if (!existsSync(join(root, path))) missing.push(path); else files.push(path);
  }
  return { ok: !missing.length && !outside.length && !packages.size, files, missing, outside, packages: [...packages], optionalPackages: [...optional] };
}

/** Source files must equal the blobs of sourceCommit and tooling files the blobs of toolingCommit, byte for byte. */
export function sourceCheck(repo, release) {
  const manifest = JSON.parse(readFileSync(join(release, MANIFEST), "utf8"));
  const commits = { source: manifest.sourceCommit, tooling: manifest.toolingCommit };
  const mismatched = []; let checked = 0;
  for (const file of manifest.files) {
    const commit = commits[file.origin];
    if (!commit) continue;
    const blob = execFileSync("git", ["-C", repo, "cat-file", "blob", `${commit}:${file.repoPath}`], { maxBuffer: 64 * 1024 * 1024 });
    checked++;
    if (sha256(blob) !== file.sha256 || fileSha256(join(release, file.path)) !== file.sha256) mismatched.push(file.path);
  }
  return { ok: checked > 0 && !mismatched.length, checked, mismatched, sourceCommit: commits.source, toolingCommit: commits.tooling };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, first, second] = process.argv.slice(2);
  const result = command === "manifest" ? (({ files, ...rest }) => ({ ...rest, files: files.length }))(writeManifest(first))
    : command === "verify" ? verifyRelease(first)
    : command === "closure" ? importClosure(first)
    : command === "source-check" ? sourceCheck(first, second)
    : null;
  if (!result) { console.error("usage: bunny-release.mjs manifest|verify|closure <release> | source-check <repo> <release>"); process.exit(2); }
  console.log(JSON.stringify(result, null, 1));
  if (result.ok === false) process.exit(1);
}
