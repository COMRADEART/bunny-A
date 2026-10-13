import type { RegisteredProject } from "../../lib/bunny-host/project-types.ts";
export const projectStatus = (project: RegisteredProject) =>
  ({
    ACTIVE: "Active",
    INACTIVE: "Inactive",
    ARCHIVED: "Archived",
    MISSING_ROOT: "Missing workspace",
    NEEDS_RELINK: "Needs relink",
  })[project.lifecycle] ?? "Needs review";
export const projectExecutable = (project: RegisteredProject) =>
  project.lifecycle === "ACTIVE" && !!project.rootIdentity;
export function projectPageRange(offset: number, limit: number, total: number) {
  return total ? `${offset + 1}–${Math.min(offset + limit, total)} of ${total}` : "0 projects";
}
export function projectTags(value: string) {
  return [
    ...new Set(
      value
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  ].slice(0, 12);
}
