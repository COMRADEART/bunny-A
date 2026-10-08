import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { HostDatabase } from "./persistence.server.ts";
import type { AgentWorkspace } from "./project-types.ts";
import { contained, inspectRoot, noLinks, validateIdentity } from "./project-paths.server.ts";

export const WORKSPACE_SCHEMA = "ma3.agent-workspace.v1";
export const WORKSPACE_MAX_BYTES = 64 * 1024 * 1024;
const digest = (body: string) => createHash("sha256").update(body).digest("hex");
const uuid = (id: string) => {
  if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error("Invalid workspace owner ID.");
  return id;
};

/** Durable scratch metadata in the existing Host SQLite; no cleanup, execution or authorization authority. */
export class AgentWorkspaceStore {
  host: HostDatabase;
  base: string;
  owner: string;
  constructor(host: HostDatabase, configuredWorkspaceRoot: string) {
    this.host = host;
    this.base = inspectRoot(configuredWorkspaceRoot).path;
    host.transaction(() => {
      host.db
        .exec(`CREATE TABLE IF NOT EXISTS agent_workspaces(id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, mission_id TEXT NOT NULL, project_id TEXT, state TEXT NOT NULL, record TEXT NOT NULL, manifest_sha256 TEXT NOT NULL, UNIQUE(agent_id,mission_id));
        CREATE INDEX IF NOT EXISTS agent_workspaces_project ON agent_workspaces(project_id,id);
        CREATE INDEX IF NOT EXISTS agent_workspaces_mission ON agent_workspaces(mission_id);
        INSERT OR IGNORE INTO migrations(key) VALUES('${WORKSPACE_SCHEMA}');`);
      host.db
        .prepare("INSERT OR IGNORE INTO settings(key,value) VALUES('agent_workspace_owner',?)")
        .run(randomUUID());
    });
    this.owner = String(
      host.db.prepare("SELECT value FROM settings WHERE key='agent_workspace_owner'").get()?.value,
    );
  }
  getForMission(missionId: string): AgentWorkspace | null {
    const row = this.host.db
      .prepare("SELECT record FROM agent_workspaces WHERE mission_id=?")
      .get(missionId) as { record: string } | undefined;
    return row ? (JSON.parse(row.record) as AgentWorkspace) : null;
  }
  list(projectId: string, limit = 100): AgentWorkspace[] {
    return (
      this.host.db
        .prepare("SELECT record FROM agent_workspaces WHERE project_id=? ORDER BY id LIMIT ?")
        .all(projectId, Math.min(100, limit)) as { record: string }[]
    ).map((row) => JSON.parse(row.record) as AgentWorkspace);
  }
  acquire(agentId: string, missionId: string, projectId: string | null): AgentWorkspace {
    uuid(agentId);
    uuid(missionId);
    return this.host.transaction(() => {
      const agent = this.host.db.prepare("SELECT mission_id FROM agents WHERE id=?").get(agentId);
      const mission = this.host.db
        .prepare("SELECT record FROM missions WHERE id=?")
        .get(missionId) as { record: string } | undefined;
      if (
        !agent ||
        agent.mission_id !== missionId ||
        !mission ||
        JSON.parse(mission.record).projectId !== projectId
      )
        throw new Error("Workspace Agent/Mission/Project binding mismatch.");
      const existing = this.getForMission(missionId);
      if (existing) {
        if (existing.agentId !== agentId || existing.projectId !== projectId)
          throw new Error("Workspace belongs to another Agent or Project.");
        this.validate(existing);
        return existing;
      }
      const base = inspectRoot(this.base);
      const parent = join(base.path, "agents");
      if (!existsSync(parent)) {
        mkdirSync(parent);
        writeFileSync(join(parent, ".bunny-owner"), this.owner, { flag: "wx" });
      }
      noLinks(join(parent, ".bunny-owner"));
      if (readFileSync(join(parent, ".bunny-owner"), "utf8") !== this.owner)
        throw new Error("Agent workspace parent is not owned by this Host.");
      inspectRoot(parent);
      const agentRoot = join(parent, agentId);
      if (!existsSync(agentRoot)) mkdirSync(agentRoot);
      inspectRoot(agentRoot);
      const id = randomUUID();
      const staging = join(agentRoot, `.creating-${id}`);
      const root = join(agentRoot, missionId);
      mkdirSync(staging);
      mkdirSync(join(staging, "scratch"));
      const now = Date.now();
      const manifest = JSON.stringify({
        schema: WORKSPACE_SCHEMA,
        id,
        agentId,
        missionId,
        projectId,
        owner: this.owner,
        revision: 1,
      });
      writeFileSync(join(staging, "manifest.json"), manifest, { flag: "wx" });
      if (existsSync(root)) throw new Error("Workspace collision; unowned files were preserved.");
      renameSync(staging, root);
      const workspace: AgentWorkspace = {
        id,
        agentId,
        missionId,
        projectId,
        root: inspectRoot(root),
        scratch: inspectRoot(join(root, "scratch")),
        workspaceRoot: base,
        state: "READY",
        createdAt: now,
        lastUsedAt: now,
        ownershipMarker: this.owner,
        manifestRevision: 1,
        maxBytes: WORKSPACE_MAX_BYTES,
      };
      this.host.db
        .prepare("INSERT INTO agent_workspaces VALUES(?,?,?,?,?,?,?)")
        .run(
          id,
          agentId,
          missionId,
          projectId,
          "READY",
          JSON.stringify(workspace),
          digest(manifest),
        );
      this.host.event(
        "workspace.created",
        null,
        JSON.stringify({ agentId, missionId, projectId, workspaceId: id }),
        missionId,
      );
      return workspace;
    });
  }
  validate(workspace: AgentWorkspace, additionalBytes = 0): void {
    try {
      if (workspace.state !== "READY")
        throw new Error("Workspace identity requires explicit review.");
      if (
        !Number.isFinite(additionalBytes) ||
        additionalBytes < 0 ||
        additionalBytes > workspace.maxBytes
      )
        throw new Error("Workspace disk quota exceeded.");
      if (
        workspace.ownershipMarker !== this.owner ||
        !contained(this.base, workspace.root.path) ||
        !contained(workspace.root.path, workspace.scratch.path)
      )
        throw new Error("Workspace ownership mismatch.");
      validateIdentity(workspace.workspaceRoot);
      validateIdentity(workspace.root);
      validateIdentity(workspace.scratch);
      const path = join(workspace.root.path, "manifest.json");
      noLinks(path);
      const stat = statSync(path);
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > 4096)
        throw new Error("Workspace manifest identity is invalid.");
      const body = readFileSync(path, "utf8");
      const expected = this.host.db
        .prepare(
          "SELECT manifest_sha256 FROM agent_workspaces WHERE id=? AND agent_id=? AND mission_id=? AND project_id IS ?",
        )
        .get(workspace.id, workspace.agentId, workspace.missionId, workspace.projectId);
      if (!expected || expected.manifest_sha256 !== digest(body))
        throw new Error("Workspace manifest was replaced.");
      let entries = 0,
        bytes = additionalBytes;
      const walk = (path: string, depth: number) => {
        if (depth > 12) throw new Error("Workspace depth limit exceeded.");
        for (const item of readdirSync(path, { withFileTypes: true })) {
          if (++entries > 1000) throw new Error("Workspace entry limit exceeded.");
          const child = join(path, item.name);
          const stat = lstatSync(child);
          if (stat.isSymbolicLink() || (stat.isFile() && stat.nlink !== 1))
            throw new Error("Workspace links are forbidden.");
          if (stat.isDirectory()) walk(child, depth + 1);
          else if (stat.isFile()) bytes += stat.size;
          else throw new Error("Workspace contains an unsupported resource.");
          if (bytes > workspace.maxBytes) throw new Error("Workspace disk quota exceeded.");
        }
      };
      walk(workspace.scratch.path, 0);
    } catch (error) {
      this.host.db
        .prepare("UPDATE agent_workspaces SET state='CONTEXT_CHANGED',record=? WHERE id=?")
        .run(JSON.stringify({ ...workspace, state: "CONTEXT_CHANGED" }), workspace.id);
      throw error;
    }
  }
  assertResource(missionId: string, path: string, additionalBytes = 0): void {
    noLinks(path);
    const current = this.getForMission(missionId);
    if (current)
      this.validate(current, contained(current.scratch.path, path) ? additionalBytes : 0);
    if (
      contained(join(this.base, "agents"), path) &&
      (!current || !contained(current.scratch.path, path))
    )
      throw new Error("Another Agent's workspace or manifest is outside this Mission.");
  }
  cleanup(_id: string): never {
    throw new Error(
      "Workspace cleanup is a separate reviewed lifecycle operation; no directory is deleted in T7.",
    );
  }
}
