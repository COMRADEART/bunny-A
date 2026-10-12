import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { AgentRuntime } from "./agent-runtime.server.ts";
import type { MissionManager } from "../bunny-missions/manager.server.ts";
import type { ProjectDetail, ProjectQuery } from "./project-types.ts";
import type { HostEvent } from "./contracts.ts";
import type { OrchTask } from "../orch/types.ts";
import type { Mission, Artifact } from "../bunny-missions/types.ts";
import { contained, noLinks } from "./project-paths.server.ts";
import { privateHostPath } from "../bunny-missions/paths.server.ts";
import { deviceProjectDetail } from "./device-authority.server.ts";

/** Bounded projections and reference checks over canonical owners, not a second Mission/artifact store. */
export class ProjectService {
  missions: MissionManager;
  agents: AgentRuntime;
  constructor(missions: MissionManager, agents: AgentRuntime) {
    this.missions = missions;
    this.agents = agents;
    missions.tasks.db.db
      .exec(`CREATE INDEX IF NOT EXISTS missions_project_context ON missions(json_extract(record,'$.projectId'),created_at,id);
      CREATE INDEX IF NOT EXISTS tasks_project_context ON tasks(json_extract(record,'$.projectId'),json_extract(record,'$.createdAt'),id);`);
    missions.tasks.bus.on("event", (event) => {
      if (event.missionId) {
        const m = missions.store.mission(event.missionId);
        if (m.projectId) this.registry.activity(m.projectId, event.at);
      } else if (event.taskId) {
        const t = missions.tasks.db.get(event.taskId);
        if (t.projectId) this.registry.activity(t.projectId, event.at);
      }
    });
  }
  get registry() {
    return this.missions.tasks.projects;
  }
  async command(action: string, data: Record<string, unknown>, local: boolean): Promise<unknown> {
    const text = (value: unknown, max = 4096) => {
      if (typeof value !== "string" || !value.trim() || value.length > max)
        throw new Error("Invalid Project input.");
      return value;
    };
    if (action === "project.list") {
      const page = this.list({
        search: data.search == null ? "" : String(data.search),
        filter: data.filter as ProjectQuery["filter"],
        sort: data.sort as ProjectQuery["sort"],
        offset: data.offset as number,
        limit: data.limit as number,
      });
      return local ? page : { ...page, projects: page.projects.map((project) => ({ ...project, path: "[Project folder on the Windows Host]" })) };
    }
    if (action === "project.get") {
      const detail = this.detail(
        text(data.id, 200),
        data.offset == null ? 0 : Number(data.offset),
        data.limit == null ? 50 : Number(data.limit),
      );
      return local ? detail : deviceProjectDetail(detail);
    }
    if (action === "project.artifact")
      return this.artifact(text(data.projectId, 200), text(data.artifactId, 200));
    if (action === "project.repository") {
      if (!local) throw new Error("Repository inspection requires this workstation.");
      const p = this.registry.get(text(data.id, 200)); this.registry.verify(p);
      this.agents.context.assertScan(p.id, "project-inspect", p.path, null);
      if (p.projectType !== "repository") throw new Error("No repository detected in this Project.");
      await this.missions.bus.refreshHealth();
      const result: Record<string, unknown> = {};
      for (const action of ["git.status", "git.branch", "git.commit_info"]) {
        const outcome = await this.missions.bus.request({ action, params: {}, missionId: null, stepId: null, envelope: null, origin: "workstation-project-inspection", cwd: p.path, roots: [p.path], direct: { confirmed: true } });
        if (!outcome.result?.ok) throw new Error("Bounded repository inspection could not be verified.");
        result[action] = outcome.result.output;
      }
      return result;
    }
    if (!local) throw new Error("Project metadata and folder changes require this workstation.");
    if (action === "project.add")
      return this.registry.register(
        text(data.name, 120),
        text(data.path),
        typeof data.description === "string" ? data.description : "",
      );
    if (action === "project.create") {
      if (data.confirmed !== true)
        throw new Error("Confirm creation of an empty Bunny-owned project.");
      return this.registry.create(text(data.name, 120));
    }
    if (action === "project.update")
      return this.registry.update(text(data.id, 200), data, Number(data.revision));
    if (action === "project.relink")
      return this.registry.relink(
        text(data.id, 200),
        text(data.path),
        Number(data.revision),
        data.confirmed === true,
      );
    if (action === "project.remove") {
      const p = this.registry.get(text(data.id, 200));
      return this.registry.update(p.id, { lifecycle: "ARCHIVED" }, p.revision);
    }
    if (action === "project.agent.create") {
      const p = this.registry.forExecution(text(data.projectId, 200));
      this.agents.create(
        { projectId: p.id, objective: text(data.objective, 4000), name: text(data.name, 100) },
        "workstation",
      );
      return { created: true, projectId: p.id };
    }
    throw new Error("Unknown Project command.");
  }
  list(query: ProjectQuery) {
    const page = this.registry.list(query);
    return {
      ...page,
      projects: page.projects.map((project) => {
        project = this.registry.refresh(project.id);
        const db = this.missions.tasks.db.db;
        const states = db
          .prepare(
            "SELECT state,COUNT(*) n FROM missions WHERE json_extract(record,'$.projectId')=? GROUP BY state",
          )
          .all(project.id) as { state: string; n: number }[];
        const attention = project.lifecycle === "NEEDS_RELINK" ? ["Needs relink"] : [];
        for (const [state, label] of [
          ["waiting_for_user", "Needs approval"],
          ["waiting_for_approval", "Plan needs approval"],
          ["paused", "Paused"],
          ["failed", "Needs review"],
        ])
          if (states.some((row) => row.state === state)) attention.push(label);
        const activeAgents = Number(
          db
            .prepare(
              "SELECT COUNT(*) n FROM agents a JOIN missions m ON m.id=a.mission_id WHERE json_extract(m.record,'$.projectId')=? AND a.state NOT IN ('COMPLETED','FAILED','STOPPED')",
            )
            .get(project.id)?.n ?? 0,
        );
        const latest = Number(
          db
            .prepare(
              "SELECT MAX(updated_at) n FROM missions WHERE json_extract(record,'$.projectId')=?",
            )
            .get(project.id)?.n ?? 0,
        );
        return {
          ...project,
          lastActivityAt: Math.max(project.lastActivityAt, latest),
          attention,
          activeAgents,
          missionCount: states.reduce((n, row) => n + row.n, 0),
        };
      }),
    };
  }
  detail(projectId: string, offset = 0, limit = 50): ProjectDetail {
    if (
      !Number.isInteger(offset) ||
      !Number.isInteger(limit) ||
      offset < 0 ||
      offset > 100000 ||
      limit < 1 ||
      limit > 100
    )
      throw new Error("Invalid project history page.");
    const project = this.registry.refresh(projectId);
    const db = this.missions.tasks.db.db;
    const parse = <T>(rows: unknown) =>
      (rows as { record: string }[]).map((row) => JSON.parse(row.record) as T);
    const missions = parse<Mission>(
      db
        .prepare(
          "SELECT record FROM missions WHERE json_extract(record,'$.projectId')=? ORDER BY created_at DESC,id LIMIT ? OFFSET ?",
        )
        .all(projectId, limit, offset),
    );
    const tasks = parse<OrchTask>(
      db
        .prepare(
          "SELECT record FROM tasks WHERE json_extract(record,'$.projectId')=? ORDER BY json_extract(record,'$.createdAt') DESC,id LIMIT ? OFFSET ?",
        )
        .all(projectId, limit, offset),
    );
    const artifacts = parse<Artifact>(
      db
        .prepare(
          "SELECT a.record FROM mission_artifacts a JOIN missions m ON m.id=a.mission_id WHERE json_extract(m.record,'$.projectId')=? ORDER BY a.created_at DESC,a.id LIMIT ? OFFSET ?",
        )
        .all(projectId, limit, offset),
    );
    const agentIds = (
      db
        .prepare(
          "SELECT a.id FROM agents a JOIN missions m ON m.id=a.mission_id WHERE json_extract(m.record,'$.projectId')=? ORDER BY a.created_at DESC,a.id LIMIT ? OFFSET ?",
        )
        .all(projectId, limit, offset) as { id: string }[]
    ).map((row) => row.id);
    const events = db
      .prepare(
        `SELECT e.sequence,e.at,e.type,e.task_id taskId,e.detail,e.mission_id missionId FROM events e
      WHERE e.mission_id IN (SELECT id FROM missions WHERE json_extract(record,'$.projectId')=?)
        OR e.task_id IN (SELECT id FROM tasks WHERE json_extract(record,'$.projectId')=?)
        OR (e.type LIKE 'project.%' AND json_valid(e.detail) AND json_extract(e.detail,'$.projectId')=?)
      ORDER BY e.sequence DESC LIMIT ? OFFSET ?`,
      )
      .all(projectId, projectId, projectId, limit, offset) as HostEvent[];
    return {
      project,
      missions: missions.map((m) => ({
        ...m,
        request: "[Retained on Host]",
        objective: "[Retained on Host]",
        result: null,
        failure: null,
      })),
      tasks: tasks.map((t) => ({
        ...t,
        output: "",
        prompt: "[Retained on Host]",
        logs: [],
        processTree: null,
        error: t.error ? "Task failed; diagnostics retained on Host." : null,
        verification: t.verification
          ? {
              ...t.verification,
              detail: t.verification.passed
                ? "Independent verification passed."
                : "Verification failed.",
            }
          : null,
      })),
      artifacts,
      agents: this.agents.store.snapshot(agentIds).agents.map(agent => ({ ...agent,
        note: agent.note ? "Agent needs review; diagnostics retained on Host." : null,
        lastCheckpoint: agent.lastCheckpoint ? { boundary: agent.lastCheckpoint.boundary, at: agent.lastCheckpoint.at, replaySafety: agent.lastCheckpoint.replaySafety } : null,
      })),
      workspaces: this.agents.workspaces.list(projectId, limit),
      events: events.map((e) => ({
        ...e,
        detail: "Canonical Host event; related work is available in Mission and Task detail.",
      })),
      offset,
      limit,
      totals: {
        missions: Number(
          db
            .prepare("SELECT COUNT(*) n FROM missions WHERE json_extract(record,'$.projectId')=?")
            .get(projectId)?.n ?? 0,
        ),
        tasks: Number(
          db
            .prepare("SELECT COUNT(*) n FROM tasks WHERE json_extract(record,'$.projectId')=?")
            .get(projectId)?.n ?? 0,
        ),
        artifacts: Number(
          db
            .prepare(
              "SELECT COUNT(*) n FROM mission_artifacts a JOIN missions m ON m.id=a.mission_id WHERE json_extract(m.record,'$.projectId')=?",
            )
            .get(projectId)?.n ?? 0,
        ),
        events: Number(db.prepare(`SELECT COUNT(*) n FROM events e WHERE
          e.mission_id IN (SELECT id FROM missions WHERE json_extract(record,'$.projectId')=?) OR
          e.task_id IN (SELECT id FROM tasks WHERE json_extract(record,'$.projectId')=?) OR
          (e.type LIKE 'project.%' AND json_valid(e.detail) AND json_extract(e.detail,'$.projectId')=?)`).get(projectId,projectId,projectId)?.n ?? 0),
      },
    };
  }
  artifact(projectId: string, artifactId: string) {
    const project = this.registry.get(projectId);
    const { artifact, body } = this.missions.artifacts.get(artifactId);
    const mission = this.missions.store.mission(artifact.missionId);
    if (
      mission.projectId !== projectId ||
      (artifact.stepId && this.missions.store.step(artifact.stepId).missionId !== mission.id)
    )
      throw new Error("Artifact is outside the selected Project.");
    if (artifact.verification !== "verified")
      throw new Error("This artifact has not passed independent verification.");
    let content: Buffer;
    if (artifact.location.kind === "inline") content = Buffer.from(body ?? "");
    else {
      const path = noLinks(artifact.location.path);
      if (
        privateHostPath(this.missions.dataDirectory, path) ||
        (!contained(join(this.missions.dataDirectory, "artifacts", mission.id), path) &&
          !contained(project.path, path))
      )
        throw new Error("Artifact file is outside canonical storage or its originating Project.");
      if (contained(project.path, path)) this.registry.verify(project);
      const info = statSync(path);
      if (!info.isFile() || info.nlink !== 1 || info.size > 1024 * 1024)
        throw new Error("Artifact preview requires a bounded regular file.");
      content = readFileSync(path);
    }
    if (
      content.length > 1024 * 1024 ||
      createHash("sha256").update(content).digest("hex") !== artifact.sha256
    )
      throw new Error("Artifact content no longer matches its verified hash.");
    const agent = this.missions.tasks.db.db
      .prepare("SELECT id FROM agents WHERE mission_id=?")
      .get(mission.id);
    return {
      artifact,
      agentId: agent?.id ?? null,
      taskId: artifact.stepId ? this.missions.store.step(artifact.stepId).taskId : null,
      body: content.toString(["image/png", "image/jpeg", "image/webp"].includes(artifact.location.mediaType) ? "base64" : "utf8"),
      encoding: ["image/png", "image/jpeg", "image/webp"].includes(artifact.location.mediaType) ? "base64" : "utf8",
    };
  }
}
