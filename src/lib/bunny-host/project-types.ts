import type { Project, OrchTask } from "../orch/types.ts";
import type { Mission, Artifact } from "../bunny-missions/types.ts";
import type { AgentSnapshot } from "./agent-types.ts";
import type { HostEvent } from "./contracts.ts";

export const PROJECT_SCHEMA = "ma3.projects.v1";
export const PROJECT_STATES = [
  "ACTIVE",
  "INACTIVE",
  "ARCHIVED",
  "MISSING_ROOT",
  "NEEDS_RELINK",
] as const;
export type ProjectState = (typeof PROJECT_STATES)[number];
export type RootIdentity = { path: string; identity: string };
export type RegisteredProject = Project & {
  description: string;
  createdAt: number;
  updatedAt: number;
  lastActivityAt: number;
  lifecycle: ProjectState;
  sourceType: "existing" | "bunny-owned" | "legacy";
  projectType: "repository" | "folder";
  ownerScope: "host-owner";
  tags: string[];
  favorite: boolean;
  rootIdentity: string | null;
  revision: number;
  schemaVersion: typeof PROJECT_SCHEMA;
  attention: string[];
};
export type ProjectQuery = {
  search?: string;
  filter?: "all" | "active" | "archived" | "favorites" | "attention";
  sort?: "activity" | "created" | "name";
  offset?: number;
  limit?: number;
};
export type ProjectPage = {
  projects: RegisteredProject[];
  total: number;
  offset: number;
  limit: number;
};
export type AgentWorkspace = {
  id: string;
  agentId: string;
  missionId: string;
  projectId: string | null;
  root: RootIdentity;
  scratch: RootIdentity;
  workspaceRoot: RootIdentity;
  state: "READY" | "CONTEXT_CHANGED";
  createdAt: number;
  lastUsedAt: number;
  ownershipMarker: string;
  manifestRevision: 1;
  maxBytes: number;
};
export type ProjectContextSnapshot = {
  id: string;
  projectId: string;
  missionId: string;
  taskId: string;
  stepId: string;
  consentReference: { id: string; revision: number; generation: string | null };
  workspaceRef: RootIdentity;
  repositoryRefs: { root: string; head: string | null }[];
  selectedFileRefs: { path: string; identity: string; sha256: string; bytes: number }[];
  artifactRefs: { id: string; sha256: string; missionId: string; stepId: string | null }[];
  contextVersion: 1;
  observedAt: number;
  provenance: "host-selected-references";
  authority: "NONE; current T5 admission required";
};
export type ProjectDetail = {
  project: RegisteredProject;
  missions: Mission[];
  tasks: OrchTask[];
  agents: AgentSnapshot["agents"];
  workspaces: AgentWorkspace[];
  artifacts: Artifact[];
  events: HostEvent[];
  offset: number;
  limit: number;
  totals: { missions: number; tasks: number; artifacts: number; events: number };
};
