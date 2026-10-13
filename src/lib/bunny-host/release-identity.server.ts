import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
export type ReleaseIdentity = {
  release: string;
  version: string;
  sourceCommit: string;
  toolingCommit: string;
  builtAt: string;
  manifestSha256: string;
  dashboard: {
    sourceCommit: string;
    builtAt: string;
    assetManifestSha256: string;
    assets: number;
  } | null;
};
/** This is build provenance, not permission or process ownership. Startup separately verifies the inventory. */
export function releaseIdentity(
  manifestPath: URL | string = new URL("../../../release-manifest.json", import.meta.url),
): ReleaseIdentity | null {
  if (!existsSync(manifestPath)) return null;
  const bytes = readFileSync(manifestPath),
    manifest = JSON.parse(bytes.toString("utf8"));
  return {
    release: manifest.release,
    version: manifest.version,
    sourceCommit: manifest.sourceCommit,
    toolingCommit: manifest.toolingCommit,
    builtAt: manifest.builtAt,
    manifestSha256: createHash("sha256").update(bytes).digest("hex"),
    dashboard: manifest.dashboard ?? null,
  };
}
