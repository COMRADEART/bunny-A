import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { HostDatabase } from "./persistence.server.ts";
import {
  PROJECT_SCHEMA,
  type RegisteredProject,
  type ProjectPage,
  type ProjectQuery,
} from "./project-types.ts";
import { contained, inspectRoot, validateIdentity } from "./project-paths.server.ts";

const columns: [string, string][] = [
  ["lifecycle", "TEXT NOT NULL DEFAULT 'NEEDS_RELINK'"],
  ["favorite", "INTEGER NOT NULL DEFAULT 0"],
  ["created_at", "INTEGER NOT NULL DEFAULT 0"],
  ["activity_at", "INTEGER NOT NULL DEFAULT 0"],
  ["display_name", "TEXT NOT NULL DEFAULT ''"],
  ["search_text", "TEXT NOT NULL DEFAULT ''"],
];
const label = (value: unknown, max: number): string => {
  if (
    typeof value !== "string" ||
    value.length > max ||
    [...value].some((char) => char.charCodeAt(0) < 32)
  )
    throw new Error("Invalid project metadata.");
  return value.trim();
};

/** Extends the canonical Host projects table. Membership is context, never executable authority. */
export class ProjectRegistry {
  host: HostDatabase;
  workspaceRoot: string;
  workspaceIdentity: ReturnType<typeof inspectRoot>;
  constructor(host: HostDatabase, workspaceRoot: string) {
    this.host = host;
    this.workspaceIdentity = inspectRoot(workspaceRoot);
    this.workspaceRoot = this.workspaceIdentity.path;
    host.transaction(() => {
      const names = new Set(
        (host.db.prepare("PRAGMA table_info(projects)").all() as { name: string }[]).map(
          (row) => row.name,
        ),
      );
      for (const [name, definition] of columns)
        if (!names.has(name)) host.db.exec(`ALTER TABLE projects ADD COLUMN ${name} ${definition}`);
      host.db
        .exec(`CREATE TABLE IF NOT EXISTS project_migration_issues(project_id TEXT PRIMARY KEY, reason TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS projects_lifecycle_activity ON projects(lifecycle,activity_at,id);
        CREATE INDEX IF NOT EXISTS projects_favorite ON projects(favorite,activity_at,id);
        CREATE INDEX IF NOT EXISTS projects_name ON projects(display_name,id);`);
      host.db.exec("CREATE INDEX IF NOT EXISTS projects_root_lookup ON projects(lower(json_extract(record,'$.path'))) WHERE json_valid(record) AND display_name<>''");
      const rows = host.db.prepare("SELECT id,record FROM projects").all() as {
        id: string;
        record: string;
      }[];
      for (const row of rows) {
        try {
          const old = JSON.parse(row.record);
          if (old.id !== row.id || !old.id || typeof old.path !== "string" || !old.name)
            throw new Error("Malformed historical project; original bytes retained.");
          if (old.schemaVersion === PROJECT_SCHEMA) continue;
          let root: ReturnType<typeof inspectRoot> | null = null;
          try {
            root = inspectRoot(old.path);
          } catch {
            /* Missing/unsafe roots need explicit relink. */
          }
          const now = Date.now();
          this.save({
            ...old,
            name: label(old.name, 120),
            path: root?.path ?? old.path,
            preferred: "auto",
            description: "",
            createdAt: now,
            updatedAt: now,
            lastActivityAt: now,
            lifecycle: root ? "ACTIVE" : "NEEDS_RELINK",
            rootIdentity: root?.identity ?? null,
            sourceType: "legacy",
            projectType: existsSync(join(old.path, ".git")) ? "repository" : "folder",
            ownerScope: "host-owner",
            tags: [],
            favorite: false,
            revision: 1,
            schemaVersion: PROJECT_SCHEMA,
            attention: [],
          });
        } catch {
          host.db
            .prepare("INSERT OR IGNORE INTO project_migration_issues VALUES(?,?)")
            .run(
              row.id,
              "Malformed or unsupported legacy record; review required. Original identity and bytes preserved.",
            );
        }
      }
      // Similar names/remotes never identify a project. Aliased historical roots are ambiguous, not merged.
      const identities = host.db
        .prepare("SELECT id,record FROM projects WHERE display_name<>''")
        .all() as { id: string; record: string }[];
      const seen = new Map<string, RegisteredProject>();
      for (const row of identities) {
        const p = JSON.parse(row.record) as RegisteredProject;
        if (!p.rootIdentity) continue;
        const prior = seen.get(p.rootIdentity);
        if (prior && prior.id !== p.id) {
          for (const item of [prior, p]) {
            this.save({ ...item, lifecycle: "NEEDS_RELINK", rootIdentity: null });
            host.db
              .prepare("INSERT OR IGNORE INTO project_migration_issues VALUES(?,?)")
              .run(
                item.id,
                "Multiple historical identities reference the same directory; explicit relink review required.",
              );
          }
        } else seen.set(p.rootIdentity, p);
      }
      host.db.prepare("INSERT OR IGNORE INTO migrations(key) VALUES(?)").run(PROJECT_SCHEMA);
    });
  }
  get(id: string): RegisteredProject {
    const row = this.host.db.prepare("SELECT record FROM projects WHERE id=?").get(id) as
      { record: string } | undefined;
    if (!row) throw new Error("Project is not registered on this Host.");
    let project = JSON.parse(row.record) as RegisteredProject;
    if (project.id === id && !project.schemaVersion && project.name && project.path) {
      const root = inspectRoot(project.path);
      const now = Date.now();
      project = this.save({
        ...project,
        preferred: "auto",
        description: "",
        createdAt: now,
        updatedAt: now,
        lastActivityAt: now,
        lifecycle: "ACTIVE",
        rootIdentity: root.identity,
        sourceType: "legacy",
        projectType: existsSync(join(root.path, ".git")) ? "repository" : "folder",
        ownerScope: "host-owner",
        tags: [],
        favorite: false,
        revision: 1,
        schemaVersion: PROJECT_SCHEMA,
        attention: [],
      });
    }
    if (project.id !== id || project.schemaVersion !== PROJECT_SCHEMA || !project.revision)
      throw new Error("Project metadata needs review.");
    return project;
  }
  save(project: RegisteredProject): RegisteredProject {
    this.host.db
      .prepare(
        `INSERT INTO projects(id,record,lifecycle,favorite,created_at,activity_at,display_name,search_text) VALUES(?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET record=excluded.record,lifecycle=excluded.lifecycle,favorite=excluded.favorite,created_at=excluded.created_at,activity_at=excluded.activity_at,display_name=excluded.display_name,search_text=excluded.search_text`,
      )
      .run(
        project.id,
        JSON.stringify(project),
        project.lifecycle,
        +project.favorite,
        project.createdAt,
        project.lastActivityAt,
        project.name.toLowerCase(),
        `${project.name} ${project.description} ${project.tags.join(" ")}`.toLowerCase(),
      );
    return project;
  }
  list(query: ProjectQuery = {}): ProjectPage {
    const limit = Math.max(1, Math.min(100, Math.floor(query.limit ?? 50)));
    const offset = Math.max(0, Math.min(100000, Math.floor(query.offset ?? 0)));
    if (!Number.isFinite(limit + offset)) throw new Error("Invalid project page.");
    const filter = query.filter ?? "all";
    const where = ["display_name<>''"];
    const args: (string | number)[] = [];
    if (filter === "active") where.push("lifecycle='ACTIVE'");
    else if (filter === "archived") where.push("lifecycle='ARCHIVED'");
    else if (filter === "favorites") where.push("favorite=1 AND lifecycle<>'ARCHIVED'");
    else if (filter === "attention")
      where.push(
        this.host.db.prepare("SELECT name FROM sqlite_master WHERE name='missions'").get()
          ? "(lifecycle IN ('MISSING_ROOT','NEEDS_RELINK') OR EXISTS(SELECT 1 FROM missions m WHERE json_extract(m.record,'$.projectId')=projects.id AND m.state IN ('waiting_for_approval','waiting_for_user','paused','failed')))"
          : "lifecycle IN ('MISSING_ROOT','NEEDS_RELINK')",
      );
    else if (filter !== "all") throw new Error("Unknown project filter.");
    if (query.search) {
      where.push("instr(search_text,?)>0");
      args.push(label(query.search, 200).toLowerCase());
    }
    const order =
      query.sort === "name"
        ? "display_name ASC,id ASC"
        : query.sort === "created"
          ? "created_at DESC,id ASC"
          : "activity_at DESC,id ASC";
    const clause = where.join(" AND ");
    const total = Number(
      this.host.db.prepare(`SELECT COUNT(*) n FROM projects WHERE ${clause}`).get(...args)?.n ?? 0,
    );
    const projects = (
      this.host.db
        .prepare(`SELECT record FROM projects WHERE ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`)
        .all(...args, limit, offset) as { record: string }[]
    ).map((row) => JSON.parse(row.record) as RegisteredProject);
    return { projects, total, offset, limit };
  }
  register(name: string, path: string, description = ""): RegisteredProject {
    const title = label(name, 120);
    if (!title) throw new Error("A project name is required.");
    const root = inspectRoot(path);
    if (contained(join(this.workspaceRoot, "agents"), root.path))
      throw new Error("Agent scratch cannot be registered as a user project.");
    const duplicate = this.host.db
      .prepare(
        "SELECT id FROM projects WHERE json_valid(record) AND json_extract(record,'$.rootIdentity')=?",
      )
      .get(root.identity) as { id: string } | undefined;
    if (duplicate) return this.get(duplicate.id);
    const now = Date.now();
    const project: RegisteredProject = {
      id: randomUUID(),
      name: title,
      path: root.path,
      preferred: "auto",
      description: label(description, 1000),
      createdAt: now,
      updatedAt: now,
      lastActivityAt: now,
      lifecycle: "ACTIVE",
      sourceType: "existing",
      projectType: existsSync(join(root.path, ".git")) ? "repository" : "folder",
      ownerScope: "host-owner",
      tags: [],
      favorite: false,
      rootIdentity: root.identity,
      revision: 1,
      schemaVersion: PROJECT_SCHEMA,
      attention: [],
    };
    return this.host.transaction(() => {
      this.save(project);
      this.event(project, "registered");
      return project;
    });
  }
  create(name: string): RegisteredProject {
    const title = label(name, 120);
    if (!title) throw new Error("A project name is required.");
    validateIdentity(this.workspaceIdentity);
    const parent = join(this.workspaceRoot, "projects");
    if (!existsSync(parent)) mkdirSync(parent);
    inspectRoot(parent);
    const root = join(parent, randomUUID());
    mkdirSync(root); // Atomic exclusive mkdir. No user directory is reused, renamed or removed.
    const p = this.register(title, root);
    return this.save({ ...p, sourceType: "bunny-owned" });
  }
  update(
    id: string,
    input: {
      name?: unknown;
      description?: unknown;
      tags?: unknown;
      favorite?: unknown;
      lifecycle?: unknown;
    },
    revision: number,
  ): RegisteredProject {
    return this.host.transaction(() => {
      const project = this.get(id);
      if (project.revision !== revision)
        throw new Error("Project changed; refresh before updating it.");
      const next = { ...project };
      if (input.name !== undefined) {
        next.name = label(input.name, 120);
        if (!next.name) throw new Error("A project name is required.");
      }
      if (input.description !== undefined) next.description = label(input.description, 1000);
      if (input.tags !== undefined) {
        if (!Array.isArray(input.tags) || input.tags.length > 12)
          throw new Error("At most 12 tags are supported.");
        next.tags = [...new Set(input.tags.map((tag) => label(tag, 40)).filter(Boolean))];
      }
      if (input.favorite !== undefined) {
        if (typeof input.favorite !== "boolean") throw new Error("Favorite must be explicit.");
        next.favorite = input.favorite;
      }
      if (input.lifecycle !== undefined) {
        if (!["ACTIVE", "INACTIVE", "ARCHIVED"].includes(String(input.lifecycle)))
          throw new Error("Unsupported project lifecycle transition.");
        if (input.lifecycle === "ACTIVE") this.verify(project);
        next.lifecycle = input.lifecycle as RegisteredProject["lifecycle"];
      }
      next.updatedAt = Date.now();
      next.revision++;
      this.save(next);
      this.event(next, "updated");
      return next;
    });
  }
  relink(id: string, path: string, revision: number, confirmed: boolean): RegisteredProject {
    if (!confirmed) throw new Error("Explicit confirmation of the replacement root is required.");
    const project = this.get(id);
    if (project.revision !== revision) throw new Error("Stale project revision.");
    const root = inspectRoot(path);
    if (contained(join(this.workspaceRoot, "agents"), root.path))
      throw new Error("Cannot relink to Agent scratch.");
    const collision = this.host.db
      .prepare(
        "SELECT id FROM projects WHERE id<>? AND json_valid(record) AND json_extract(record,'$.rootIdentity')=?",
      )
      .get(id, root.identity);
    if (collision) throw new Error("This root already belongs to another registered project.");
    const active = this.host.db
      .prepare(
        "SELECT id FROM missions WHERE json_extract(record,'$.projectId')=? AND state NOT IN ('completed','failed','stopped','waiting_for_approval','draft') LIMIT 1",
      )
      .get(id);
    if (active)
      throw new Error(
        "Stop active project Missions before relinking. Historical consent is not transferred.",
      );
    const next = {
      ...project,
      path: root.path,
      rootIdentity: root.identity,
      lifecycle: project.lifecycle === "ARCHIVED" ? ("ARCHIVED" as const) : ("ACTIVE" as const),
      updatedAt: Date.now(),
      revision: project.revision + 1,
    };
    return this.host.transaction(() => {
      this.save(next);
      this.event(next, "relinked");
      return next;
    });
  }
  verify(project: RegisteredProject): void {
    if (!project.rootIdentity) throw new Error("NEEDS_RELINK: root identity must be reviewed.");
    validateIdentity({ path: project.path, identity: project.rootIdentity });
  }
  forExecution(id: string): RegisteredProject {
    const project = this.get(id);
    if (project.lifecycle !== "ACTIVE") throw new Error("Project is inactive or needs relink.");
    try {
      this.verify(project);
    } catch (error) {
      this.save({
        ...project,
        lifecycle: "NEEDS_RELINK",
        revision: project.revision + 1,
        updatedAt: Date.now(),
      });
      throw error;
    }
    return project;
  }
  refresh(id: string): RegisteredProject {
    const p = this.get(id);
    if (p.lifecycle === "ARCHIVED") return p;
    try {
      this.verify(p);
      return p;
    } catch {
      return this.save({
        ...p,
        lifecycle: "NEEDS_RELINK",
        updatedAt: Date.now(),
        revision: p.revision + 1,
      });
    }
  }
  activity(id: string, at: number): void {
    const p = this.get(id);
    if (at > p.lastActivityAt) this.save({ ...p, lastActivityAt: at });
  }
  event(project: RegisteredProject, action: string) {
    this.host.event(`project.${action}`, null, JSON.stringify({ projectId: project.id, action }));
  }
}
