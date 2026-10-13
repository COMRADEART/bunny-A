import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, dirname, sep } from "node:path";
import type { HostDatabase } from "./persistence.server.ts";
import type { MissionStore } from "../bunny-missions/store.server.ts";
import type { ProjectRegistry } from "./project-registry.server.ts";
import type { AgentWorkspaceStore } from "./agent-workspace.server.ts";
import type { ProjectContextSnapshot } from "./project-types.ts";
import type { AgenticAuthorizationEnvelope } from "../bunny-missions/agentic-types.ts";
import { contained, fileIdentity, noLinks, validateIdentity } from "./project-paths.server.ts";
import { privateHostPath } from "../bunny-missions/paths.server.ts";
import { rootIdentity } from "../bunny-missions/agentic-store.server.ts";

const hash = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const sensitive =
  /(^|[\\/])(\.env(?:\..*)?|credentials?(?:\..*)?|secrets?(?:\..*)?|id_rsa|id_ed25519|\.ssh|\.aws|host\.sqlite(?:-.*)?|.*\.(?:pem|key|pfx))($|[\\/])/i;
/** Bounded references only. Project files never become authority or automatic cloud prompt bodies. */
export class ProjectContextResolver {
  host: HostDatabase;
  projects: ProjectRegistry;
  workspaces: AgentWorkspaceStore;
  missions: MissionStore;
  dataDirectory: string;
  constructor(
    host: HostDatabase,
    projects: ProjectRegistry,
    workspaces: AgentWorkspaceStore,
    missions: MissionStore,
    dataDirectory: string,
  ) {
    this.host = host;
    this.projects = projects;
    this.workspaces = workspaces;
    this.missions = missions;
    this.dataDirectory = dataDirectory;
    host.db
      .exec(`CREATE TABLE IF NOT EXISTS project_context_snapshots(id TEXT PRIMARY KEY, project_id TEXT NOT NULL, mission_id TEXT NOT NULL, step_id TEXT NOT NULL, observed_at INTEGER NOT NULL, record TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS project_context_task ON project_context_snapshots(mission_id,step_id,observed_at);`);
  }
  assertResource(
    projectId: string | null,
    missionId: string,
    path: string,
    envelope: AgenticAuthorizationEnvelope | null,
    additionalBytes = 0,
    agentId: string | null = null,
  ): void {
    noLinks(path);
    if (existsSync(path) && statSync(path).isFile() && statSync(path).nlink !== 1) throw new Error("File links cannot be Project resources.");
    if (privateHostPath(this.dataDirectory, path) || sensitive.test(path))
      throw new Error("Private or secret-bearing resource is not Project context.");
    // M-A-3 T11: a team step may use only its own Agent's scratch; another member's scratch is refused like any Agent's.
    this.workspaces.assertResource(missionId, path, additionalBytes, agentId);
    if (projectId) this.projects.forExecution(projectId);
    const ancestors: string[] = []; for (let p = path; ; p = dirname(p)) { ancestors.push(p.toLowerCase()); if (dirname(p) === p) break; if (ancestors.length > 128) throw new Error("Path depth bound exceeded."); }
    const rows = this.host.db.prepare(`SELECT id,record FROM projects WHERE json_valid(record) AND display_name<>'' AND lower(json_extract(record,'$.path')) IN (${ancestors.map(() => "?").join(",")}) LIMIT 101`).all(...ancestors) as { id: string; record: string }[];
    if (rows.length > 100) throw new Error("Project identity ambiguity bound exceeded.");
    for (const row of rows) {
      if (row.id === projectId) continue;
      const p = JSON.parse(row.record);
      if (!contained(p.path, path)) continue;
      const scope = envelope?.permitted_resource_scopes.find(
        (ref) => ref.root === p.path && ref.identity,
      );
      if (!scope || !p.rootIdentity)
        throw new Error("Cross-project access requires an explicit current T5 resource scope.");
      validateIdentity({ path: p.path, identity: p.rootIdentity });
      if (scope.identity !== rootIdentity(p.path)) throw new Error("Cross-project scope identity is stale.");
    }
  }
  assertScan(
    projectId: string | null,
    missionId: string,
    path: string,
    envelope: AgenticAuthorizationEnvelope | null,
    agentId: string | null = null,
  ): void {
    this.assertResource(projectId, missionId, path, envelope, 0, agentId);
    if (
      contained(path, this.dataDirectory) ||
      contained(path, join(this.workspaces.base, "agents"))
    )
      throw new Error("Recursive project metadata cannot include private Host or Agent state.");
    const roots = this.host.db.prepare("SELECT id,record FROM projects WHERE id IS NOT ? AND json_valid(record) AND display_name<>'' AND (lower(json_extract(record,'$.path'))=? OR instr(lower(json_extract(record,'$.path')),?)=1) LIMIT 101").all(projectId, path.toLowerCase(), path.toLowerCase() + sep) as { id: string; record: string }[];
    if (roots.length > 100) throw new Error("Recursive Project scope bound exceeded.");
    for (const row of roots) {
      const p = JSON.parse(row.record);
      if (
        contained(path, p.path) &&
        !envelope?.permitted_resource_scopes.some((scope) => scope.root === p.path)
      )
        throw new Error("Recursive access would include another Project.");
    }
  }
  resolve(
    projectId: string,
    missionId: string,
    stepId: string,
    envelope: AgenticAuthorizationEnvelope | null,
    selectedFiles: string[] = [],
  ): ProjectContextSnapshot {
    if (selectedFiles.length > 12)
      throw new Error("Project context accepts at most 12 explicit file references.");
    const project = this.projects.forExecution(projectId);
    const mission = this.missions.mission(missionId);
    const step = this.missions.step(stepId);
    if (
      mission.projectId !== project.id ||
      step.missionId !== mission.id ||
      mission.root !== project.path
    )
      throw new Error(
        "Project/Mission/Task context mismatch; relink does not transfer old Mission authority.",
      );
    if (
      !envelope ||
      envelope.project_id !== projectId ||
      envelope.mission_id !== missionId ||
      envelope.current_state !== "ACTIVE" ||
      envelope.expires_at <= Date.now()
    )
      throw new Error("Current T5 Project context scope is required.");
    // M-A-3 T11: a team step binds to its owning member's workspace; that member must belong to the consenting
    // Coordinator's team. Without a team the Mission's single Agent workspace is used, as before.
    const owner = step.team?.agentId ?? null;
    const workspace = owner ? this.workspaces.getFor(owner, missionId) : this.workspaces.getForMission(missionId);
    const member = owner && owner !== envelope.agent_id
      ? (() => { const row = this.host.db.prepare("SELECT mission_id,record FROM agents WHERE id=?").get(owner) as { mission_id: string; record: string } | undefined; return row ? { missionId: row.mission_id, team: (JSON.parse(row.record) as { team?: { coordinatorId?: string | null } }).team } : null; })()
      : null;
    if (!workspace || workspace.agentId !== (owner ?? envelope.agent_id) || workspace.projectId !== projectId ||
        (owner && owner !== envelope.agent_id && (!member || member.missionId !== missionId || member.team?.coordinatorId !== envelope.agent_id)))
      throw new Error("Project Agent workspace binding mismatch.");
    this.workspaces.validate(workspace);
    let bytes = 0;
    const selectedFileRefs = selectedFiles.map((file) => {
      const path = noLinks(join(project.path, file));
      if (!contained(project.path, path) || sensitive.test(file))
        throw new Error("Selected context file is outside its Project or sensitive.");
      this.assertResource(projectId, missionId, path, envelope, 0, owner);
      if (
        !envelope.permitted_resource_scopes.some(
          (scope) => contained(scope.root, path) && scope.operations.includes("filesystem.read"),
        )
      )
        throw new Error("Selected file lacks current T5 read scope.");
      const info = statSync(path);
      bytes += info.size;
      if (!info.isFile() || info.nlink !== 1 || bytes > 64 * 1024)
        throw new Error("Context file size/identity bound exceeded.");
      const identity = fileIdentity(path);
      const sha256 = hash(readFileSync(path));
      if (fileIdentity(path) !== identity)
        throw new Error("Selected context file changed during observation.");
      return { path: file, identity, sha256, bytes: info.size };
    });
    const artifactRefs = step.dependsOn
      .slice(0, 12)
      .flatMap((id) => {
        const dep = this.missions.step(id);
        if (dep.missionId !== missionId)
          throw new Error("Cross-Mission dependency context denied.");
        return (dep.result?.artifactIds ?? []).slice(0, 4).map((id) => {
          const { artifact } = this.missions.artifact(id);
          if (artifact.missionId !== missionId || artifact.stepId !== dep.id)
            throw new Error("Artifact provenance differs from the selected dependency.");
          return { id, sha256: artifact.sha256, missionId, stepId: artifact.stepId };
        });
      })
      .slice(0, 24);
    // Only in-root bounded Git metadata. No remotes, external worktree links, scripts or config evaluation.
    const head = join(project.path, ".git", "HEAD");
    let headRef: string | null = null;
    if (existsSync(head)) {
      noLinks(head);
      const stat = statSync(head);
      if (stat.isFile() && stat.nlink === 1 && stat.size < 256) headRef = hash(readFileSync(head));
    }
    const previous = this.host.db.prepare("SELECT record FROM project_context_snapshots WHERE mission_id=? ORDER BY observed_at DESC,id LIMIT 1").get(missionId) as { record: string } | undefined;
    if (previous) {
      const prior = JSON.parse(previous.record) as ProjectContextSnapshot;
      // A fresh reviewed T5 revision/generation establishes a new observation. Existing consent
      // cannot silently follow a branch change between Tasks.
      if (prior.consentReference?.id === envelope.id && prior.consentReference.revision === envelope.revision && prior.consentReference.generation === envelope.host_generation &&
          (prior.workspaceRef.identity !== project.rootIdentity || prior.repositoryRefs[0]?.head !== (project.projectType === "repository" ? headRef : undefined)))
        throw new Error("CONTEXT_CHANGED: repository or Project identity changed; fresh review is required.");
    }
    const snapshot: ProjectContextSnapshot = {
      id: randomUUID(),
      projectId,
      missionId,
      taskId: stepId,
      stepId,
      consentReference: { id: envelope.id, revision: envelope.revision, generation: envelope.host_generation },
      workspaceRef: { path: project.path, identity: project.rootIdentity! },
      repositoryRefs:
        project.projectType === "repository" ? [{ root: project.path, head: headRef }] : [],
      selectedFileRefs,
      artifactRefs,
      contextVersion: 1,
      observedAt: Date.now(),
      provenance: "host-selected-references",
      authority: "NONE; current T5 admission required",
    };
    if (Buffer.byteLength(JSON.stringify(snapshot)) > 16 * 1024)
      throw new Error("Context snapshot bound exceeded.");
    this.host.transaction(() => {
      this.host.db
        .prepare("INSERT INTO project_context_snapshots VALUES(?,?,?,?,?,?)")
        .run(
          snapshot.id,
          projectId,
          missionId,
          stepId,
          snapshot.observedAt,
          JSON.stringify(snapshot),
        );
      this.host.db
        .prepare(
          "DELETE FROM project_context_snapshots WHERE mission_id=? AND step_id=? AND id NOT IN (SELECT id FROM project_context_snapshots WHERE mission_id=? AND step_id=? ORDER BY observed_at DESC LIMIT 20)",
        )
        .run(missionId, stepId, missionId, stepId);
    });
    return snapshot;
  }
  load(id: string): ProjectContextSnapshot {
    const row = this.host.db.prepare("SELECT record FROM project_context_snapshots WHERE id=?").get(id) as { record: string } | undefined;
    if (!row) throw new Error("CONTEXT_CHANGED: context reference is unavailable.");
    return JSON.parse(row.record) as ProjectContextSnapshot;
  }
  bindTask(id: string, taskId: string): ProjectContextSnapshot {
    const snapshot = this.load(id);
    const task = this.host.get(taskId);
    if (task.projectId !== snapshot.projectId || task.mission?.missionId !== snapshot.missionId || task.mission?.stepId !== snapshot.stepId)
      throw new Error("Project context cannot bind another Task.");
    const next = { ...snapshot, taskId };
    this.host.db.prepare("UPDATE project_context_snapshots SET record=? WHERE id=?").run(JSON.stringify(next),id);
    return next;
  }
  revalidate(snapshot: ProjectContextSnapshot): void {
    this.projects.forExecution(snapshot.projectId);
    validateIdentity(snapshot.workspaceRef);
    for (const ref of snapshot.selectedFileRefs) {
      const path = join(snapshot.workspaceRef.path, ref.path);
      const info = statSync(path); if (!info.isFile() || info.nlink !== 1 || info.size > 64 * 1024) throw new Error("CONTEXT_CHANGED: file size or link identity changed.");
      if (fileIdentity(path) !== ref.identity || hash(readFileSync(path)) !== ref.sha256)
        throw new Error("CONTEXT_CHANGED: selected file drifted.");
    }
    for (const ref of snapshot.repositoryRefs) {
        const path = join(ref.root, ".git", "HEAD");
        let current: string | null = null;
        if (existsSync(path)) {
          noLinks(path);
          const info = statSync(path);
          if (!info.isFile() || info.nlink !== 1 || info.size >= 256) throw new Error("CONTEXT_CHANGED: unsafe repository reference.");
          current = hash(readFileSync(path));
        }
        if (current !== ref.head)
          throw new Error("CONTEXT_CHANGED: repository branch changed.");
    }
  }
}
