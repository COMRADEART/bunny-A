/**
 * M-A-3 T13 Files, client side. Rows are the Host's own Mission artifacts (`MissionView.artifacts`), grouped by the Host's
 * verification verdict. An artifact is only ever labelled verified when the Host verified it; anything else stays unverified
 * or failed, and the Host still checks the content hash when it is opened (project.artifact).
 */
import type { ArtifactSummary, MissionView } from "../../lib/bunny-missions/types.ts";

export type ArtifactVerdict = "verified" | "unverified" | "failed";

export type ArtifactRow = {
  id: string;
  title: string;
  type: string;
  verification: ArtifactVerdict;
  sha256: string;
  bytes: number;
  createdAt: number;
  missionId: string;
  missionTitle: string;
  projectId: string | null;
  projectName: string | null;
  location: "inline" | "file";
  mediaType: string;
};

export type MissionArtifactSource = Pick<MissionView, "id" | "title" | "projectId" | "artifacts">;

/** Every Mission artifact, newest first, with the owning Mission and Project named from canonical records. */
export function artifactRows(missions: readonly MissionArtifactSource[], projectNames: ReadonlyMap<string, string> = new Map()): ArtifactRow[] {
  const rows: ArtifactRow[] = [];
  for (const mission of missions) {
    for (const artifact of mission.artifacts ?? []) rows.push(toRow(artifact, mission, projectNames));
  }
  return rows.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
}

function toRow(artifact: ArtifactSummary, mission: MissionArtifactSource, projectNames: ReadonlyMap<string, string>): ArtifactRow {
  const projectId = mission.projectId ?? null;
  return {
    id: artifact.id,
    title: artifact.title,
    type: artifact.type,
    verification: artifact.verification === "verified" || artifact.verification === "failed" ? artifact.verification : "unverified",
    sha256: artifact.sha256,
    bytes: artifact.bytes,
    createdAt: artifact.createdAt,
    missionId: mission.id,
    missionTitle: mission.title,
    projectId,
    projectName: projectId ? projectNames.get(projectId) ?? null : null,
    location: artifact.location.kind,
    mediaType: artifact.location.mediaType,
  };
}

export type ArtifactGroups = { verified: ArtifactRow[]; unverified: ArtifactRow[]; failed: ArtifactRow[] };

export function groupArtifacts(rows: readonly ArtifactRow[]): ArtifactGroups {
  return {
    verified: rows.filter((row) => row.verification === "verified"),
    unverified: rows.filter((row) => row.verification === "unverified"),
    failed: rows.filter((row) => row.verification === "failed"),
  };
}

/** Opening calls the Host (project.artifact), which re-checks the content hash. Only a verified artifact may be opened here. */
export function artifactOpenState(
  row: Pick<ArtifactRow, "verification" | "projectId">,
  online: boolean,
): { enabled: boolean; reason: string | null } {
  if (!online) return { enabled: false, reason: "Reconnect to the Host to open files." };
  if (row.verification !== "verified") return { enabled: false, reason: "Not verified yet, so it cannot be opened from here." };
  // The Host reads artifacts through their owning Project; a Mission without one has nothing to open it through.
  if (!row.projectId) return { enabled: false, reason: "No Project owns this file, so it cannot be opened from here." };
  return { enabled: true, reason: null };
}

export const VERDICT_LABEL: Record<ArtifactVerdict, string> = {
  verified: "Verified by Bunny-A",
  unverified: "Not verified",
  failed: "Verification failed",
};

/** A file's size as the Host recorded it, for a compact row. */
export function bytesLabel(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "Size unknown";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
