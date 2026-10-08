import { useEffect, useState } from "react";
import { Archive, ArrowLeft, Folder, Plus, RefreshCw, Search, Star } from "lucide-react";
import { useIsland } from "@/store/use-island";
import type {
  ProjectDetail,
  ProjectPage,
  ProjectQuery,
  RegisteredProject,
} from "@/lib/bunny-host/project-types";
import { projectExecutable, projectPageRange, projectStatus, projectTags } from "./project-model";
import { Empty, NAMES } from "./ui";
import "./projects.css";

type Tab =
  "Overview" | "Agents" | "Missions / Tasks" | "Files / Workspace" | "Artifacts" | "Activity";
const tabs: Tab[] = [
  "Overview",
  "Agents",
  "Missions / Tasks",
  "Files / Workspace",
  "Artifacts",
  "Activity",
];
const date = (at: number | null) => (at ? new Date(at).toLocaleString() : "Not recorded");
type CardProject = RegisteredProject & { activeAgents?: number; missionCount?: number };

export function Projects() {
  const store = useIsland();
  const online = store.host === "online";
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ProjectQuery["filter"]>("all");
  const [sort, setSort] = useState<ProjectQuery["sort"]>("activity");
  const [offset, setOffset] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [page, setPage] = useState<ProjectPage>({ projects: [], total: 0, offset: 0, limit: 24 });
  const selectedId = store.projectFocus;
  const setSelectedId = (projectFocus: string | null) => useIsland.setState({ projectFocus });
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [tab, setTab] = useState<Tab>("Overview");
  const [historyOffset, setHistoryOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<"register" | "create" | "edit" | "relink" | "agent" | null>(
    null,
  );
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [description, setDescription] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [repository, setRepository] = useState<Record<string, unknown> | null>(null);
  const [artifact, setArtifact] = useState<{
    title: string;
    body: string;
    sha256: string;
    image?: string;
  } | null>(null);
  const command = store.projectCommand;
  useEffect(() => {
    if (!online) return;
    let current = true;
    setLoading(true);
    const timer = setTimeout(() => {
      void command("project.list", { search: query, filter, sort, offset, limit: 24 }).then(
        (data) => {
          if (!current) return;
          if (data) {
            setPage(data as ProjectPage);
            setError(null);
          } else setError("Projects could not be loaded. Refresh to try again.");
          setLoading(false);
        },
      );
    }, 150);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [online, store.hostInstanceId, query, filter, sort, offset, refresh, command]);
  useEffect(() => {
    if (!online || !selectedId) return;
    let current = true;
    setLoading(true);
    setDetail(null);
    setArtifact(null);
    setRepository(null);
    void command("project.get", { id: selectedId, offset: historyOffset, limit: 25 }).then(
      (data) => {
        if (!current) return;
        if (data) {
          setDetail(data as ProjectDetail);
          setError(null);
        } else setError("Project history could not be loaded.");
        setLoading(false);
      },
    );
    return () => {
      current = false;
    };
  }, [online, store.hostInstanceId, selectedId, historyOffset, refresh, command]);
  const mutate = async (action: string, data: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    const result = await command(action, data);
    setBusy(false);
    if (!result) {
      setError(
        "The Host refused this change. Review the notification, then refresh before retrying.",
      );
      return false;
    }
    setRefresh((value) => value + 1);
    return true;
  };
  const project = detail?.project;
  const change = async (patch: Record<string, unknown>) =>
    project && mutate("project.update", { id: project.id, revision: project.revision, ...patch });
  const openForm = (kind: NonNullable<typeof form>) => {
    setForm(kind);
    setName(kind === "edit" ? (project?.name ?? "") : "");
    setPath("");
    setDescription(kind === "edit" ? (project?.description ?? "") : "");
    setTagsText(project?.tags.join(", ") ?? "");
    setConfirmed(false);
  };
  const open = (id: string) => {
    setSelectedId(id);
    setTab("Overview");
    setHistoryOffset(0);
    setForm(null);
    setArtifact(null);
  };
  return (
    <div className="projects-workspace">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Projects</p>
          <h1>{project?.name ?? "A home for your work."}</h1>
          <p>
            {selectedId
              ? "Your workspace, its Agents, and the work they retain."
              : "Organize existing folders and continue work with the right context."}
          </p>
        </div>
        <button
          className="btn secondary"
          disabled={!online || busy}
          onClick={() => openForm("register")}
        >
          <Plus size={16} />
          Add project
        </button>
      </div>
      {!online && (
        <p className="project-message" role="status">
          Connect to your workstation to load Projects and their history.
        </p>
      )}
      {error && (
        <p className="project-message" role="alert">
          {error}
        </p>
      )}
      {form && (
        <form
          className="project-form glass"
          onSubmit={async (event) => {
            event.preventDefault();
            let success = false;
            if (form === "register")
              success = await mutate("project.add", { name, path, description });
            if (form === "create")
              success = await mutate("project.create", { name, confirmed: true });
            if (form === "edit")
              success = !!(await change({ name, description, tags: projectTags(tagsText) }));
            if (form === "relink" && project)
              success = await mutate("project.relink", {
                id: project.id,
                revision: project.revision,
                path,
                confirmed,
              });
            if (form === "agent" && project)
              success = await mutate("project.agent.create", {
                projectId: project.id,
                name,
                objective: description,
              });
            if (success) setForm(null);
          }}
        >
          <div className="section-heading">
            <h2>
              {form === "relink"
                ? "Relink workspace"
                : form === "edit"
                  ? "Edit project details"
                  : form === "agent"
                    ? "Create project Agent"
                    : "Add a project"}
            </h2>
            <button type="button" className="btn quiet" onClick={() => setForm(null)}>
              Cancel
            </button>
          </div>
          {(form === "register" || form === "create") && (
            <div className="task-filters">
              <button
                type="button"
                aria-pressed={form === "register"}
                onClick={() => openForm("register")}
              >
                Existing folder
              </button>
              <button
                type="button"
                aria-pressed={form === "create"}
                onClick={() => openForm("create")}
              >
                New empty project
              </button>
            </div>
          )}
          {form !== "relink" && (
            <label className="field">
              {form === "agent" ? "Agent name" : "Display name"}
              <input
                required
                maxLength={100}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
          )}
          {(form === "register" || form === "relink") && (
            <label className="field">
              {form === "relink" ? "Replacement folder" : "Existing folder"}
              <input
                required
                maxLength={4096}
                value={path}
                onChange={(event) => setPath(event.target.value)}
                placeholder="C:\Projects\my-project"
              />
            </label>
          )}
          {(form === "register" || form === "edit" || form === "agent") && (
            <label className="field">
              {form === "agent" ? "Objective" : "Description"}
              <textarea
                required={form === "agent"}
                maxLength={form === "agent" ? 4000 : 1000}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
          )}
          {form === "edit" && (
            <label className="field">
              Tags, separated by commas
              <input
                maxLength={500}
                value={tagsText}
                onChange={(event) => setTagsText(event.target.value)}
              />
            </label>
          )}
          {form === "relink" && (
            <>
              <p className="caption project-path">Previous folder: {project?.path}</p>
              <label className="project-confirm">
                <input
                  type="checkbox"
                  required
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                I confirm this folder belongs to this Project. Existing Missions and permissions
                will require review.
              </label>
            </>
          )}
          <p className="caption">
            {form === "create"
              ? "Creates one empty folder in Bunny’s configured workspace."
              : form === "agent"
                ? "Review the Mission plan and its requested access in Agents before execution."
                : "Your files stay in place. Project metadata grants no automatic file or command access."}
          </p>
          <button
            className="btn primary"
            disabled={!online || busy || (form === "relink" && !confirmed)}
          >
            {busy
              ? "Saving…"
              : form === "create"
                ? "Create empty project"
                : form === "agent"
                  ? "Create Agent"
                  : "Save project"}
          </button>
        </form>
      )}
      {!selectedId ? (
        <>
          <div className="project-tools">
            <label className="search-field">
              <Search size={16} />
              <input
                aria-label="Search projects"
                placeholder="Search name, description, or tags"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setOffset(0);
                }}
              />
            </label>
            <label className="field project-sort">
              Sort
              <select
                aria-label="Sort projects"
                value={sort}
                onChange={(event) => {
                  setSort(event.target.value as ProjectQuery["sort"]);
                  setOffset(0);
                }}
              >
                <option value="activity">Recently active</option>
                <option value="created">Recently created</option>
                <option value="name">Name</option>
              </select>
            </label>
            <button
              className="btn quiet"
              aria-label="Refresh projects"
              onClick={() => setRefresh((value) => value + 1)}
              disabled={!online}
            >
              <RefreshCw size={16} />
            </button>
          </div>
          <nav className="task-filters project-filters" aria-label="Project filters">
            {(
              [
                ["all", "All Projects"],
                ["active", "Active"],
                ["favorites", "Favorites"],
                ["archived", "Archived"],
                ["attention", "Needs attention"],
              ] as const
            ).map(([value, title]) => (
              <button
                key={value}
                aria-pressed={filter === value}
                onClick={() => {
                  setFilter(value);
                  setOffset(0);
                }}
              >
                {title}
              </button>
            ))}
          </nav>
          {loading && (
            <p role="status" className="caption">
              Loading Projects…
            </p>
          )}
          <div className="project-grid">
            {(page.projects as CardProject[]).map((p) => (
              <article className="project-card glass" key={p.id}>
                <button className="project-open" onClick={() => open(p.id)}>
                  <Folder size={22} />
                  <h2>{p.name}</h2>
                  <p>{p.description || "Registered workspace"}</p>
                  <span className="project-path">{p.path}</span>
                  <div>
                    <span>{projectStatus(p)}</span>
                    <span>
                      {p.activeAgents ?? 0} active Agents · {p.missionCount ?? 0} Missions
                    </span>
                  </div>
                  <small>Last activity {date(p.lastActivityAt)}</small>
                  {p.attention.length > 0 && (
                    <p className="project-attention">{p.attention.join(" · ")}</p>
                  )}
                  {p.tags.length > 0 && <small>{p.tags.join(" · ")}</small>}
                </button>
                <button
                  className="btn quiet project-favorite"
                  aria-label={`${p.favorite ? "Unfavorite" : "Favorite"} ${p.name}`}
                  aria-pressed={p.favorite}
                  disabled={!online || busy}
                  onClick={() =>
                    void mutate("project.update", {
                      id: p.id,
                      revision: p.revision,
                      favorite: !p.favorite,
                    })
                  }
                >
                  <Star size={16} fill={p.favorite ? "currentColor" : "none"} />
                </button>
              </article>
            ))}
          </div>
          {!loading && !page.projects.length && (
            <Empty
              title={query ? "No matching Projects." : "Give your next Mission a workspace."}
              detail="Register an existing folder or create an empty Project."
            />
          )}
          <div className="project-pagination">
            <span>{projectPageRange(offset, 24, page.total)}</span>
            <button
              className="btn quiet"
              disabled={!offset || loading}
              onClick={() => setOffset(Math.max(0, offset - 24))}
            >
              Previous
            </button>
            <button
              className="btn quiet"
              disabled={offset + 24 >= page.total || loading}
              onClick={() => setOffset(offset + 24)}
            >
              Next
            </button>
          </div>
        </>
      ) : (
        <>
          <button
            className="btn quiet"
            onClick={() => {
              setSelectedId(null);
              setDetail(null);
              setForm(null);
            }}
          >
            <ArrowLeft size={16} />
            All Projects
          </button>
          {loading && (
            <p role="status" className="caption">
              Loading project history…
            </p>
          )}
          {project && detail && (
            <section className="project-detail glass">
              <div className="section-heading">
                <p className="caption">
                  {projectStatus(project)} ·{" "}
                  {project.projectType === "repository" ? "Repository" : "Folder"}
                </p>
                <div className="project-actions">
                  <button
                    className="btn quiet"
                    onClick={() => void change({ favorite: !project.favorite })}
                    disabled={!online || busy}
                  >
                    <Star size={15} fill={project.favorite ? "currentColor" : "none"} />
                    {project.favorite ? "Favorited" : "Favorite"}
                  </button>
                  <button
                    className="btn secondary"
                    onClick={() => openForm("edit")}
                    disabled={!online}
                  >
                    Edit details
                  </button>
                  <button
                    className="btn secondary"
                    onClick={() =>
                      void change({
                        lifecycle: project.lifecycle === "ARCHIVED" ? "ACTIVE" : "ARCHIVED",
                      })
                    }
                    disabled={!online || busy}
                  >
                    <Archive size={15} />
                    {project.lifecycle === "ARCHIVED" ? "Restore" : "Archive"}
                  </button>
                </div>
              </div>
              <nav className="task-filters project-tabs" aria-label="Project detail sections">
                {tabs.map((value) => (
                  <button
                    key={value}
                    aria-pressed={tab === value}
                    onClick={() => {
                      setTab(value);
                      setArtifact(null);
                    }}
                  >
                    {value}
                  </button>
                ))}
              </nav>
              {tab === "Overview" && (
                <>
                  <p>
                    {project.description ||
                      "Add a description to keep this Project’s objective clear."}
                  </p>
                  <p className="caption">{project.tags.join(" · ")}</p>
                  <dl className="fact-list">
                    <div>
                      <dt>Workspace</dt>
                      <dd className="project-path">{project.path}</dd>
                    </div>
                    <div>
                      <dt>Created</dt>
                      <dd>{date(project.createdAt)}</dd>
                    </div>
                    <div>
                      <dt>Retained work</dt>
                      <dd>
                        {detail.totals.missions} Missions · {detail.totals.tasks} model Tasks ·{" "}
                        {detail.totals.artifacts} artifacts
                      </dd>
                    </div>
                    <div>
                      <dt>Model selection</dt>
                      <dd>BunnyRouter selects an eligible model for each Task.</dd>
                    </div>
                  </dl>
                  <button
                    className="btn primary"
                    disabled={!online || !projectExecutable(project)}
                    onClick={() => openForm("agent")}
                  >
                    <Plus size={16} />
                    New Agent
                  </button>
                </>
              )}
              {tab === "Agents" && (
                <>
                  {!detail.agents.length && (
                    <p className="caption">No Agents associated with this Project.</p>
                  )}
                  {detail.agents.map((agent) => (
                    <article key={agent.id} className="project-history-row">
                      <div>
                        <h3>{agent.name}</h3>
                        <p>{agent.state.replaceAll("_", " ")}</p>
                        <small>
                          Checkpoint {date(agent.lastCheckpoint?.at ?? null)} · Workspace{" "}
                          {detail.workspaces.find((w) => w.agentId === agent.id)?.state ??
                            "Not allocated"}
                        </small>
                        <p className="caption">
                          {detail.missions.find((m) => m.id === agent.missionId)?.title ??
                            "Mission history"}
                        </p>
                        <p className="caption">
                          {(() => {
                            const current = detail.tasks.find(
                              (t) =>
                                t.mission?.missionId === agent.missionId &&
                                ["running", "verifying", "waiting_for_approval", "queued"].includes(
                                  t.state,
                                ),
                            );
                            return current
                              ? `Current Task: ${current.title} · ${current.provider} / ${current.model}`
                              : "No active model Task";
                          })()}
                        </p>
                      </div>
                      <div className="project-actions">
                        <button
                          className="btn secondary"
                          onClick={() => {
                            useIsland.setState({
                              agentFocus: agent.id,
                              missionFocus: agent.missionId,
                              sheet: "agentic",
                            });
                          }}
                        >
                          View Mission / Agent
                        </button>
                        {agent.state === "PAUSED" ? (
                          <button
                            className="btn secondary"
                            disabled={!online}
                            onClick={async () => {
                              await store.resumeAgent(agent.id);
                              setRefresh((v) => v + 1);
                            }}
                          >
                            Resume
                          </button>
                        ) : (
                          !["COMPLETED", "FAILED", "STOPPED"].includes(agent.state) && (
                            <button
                              className="btn secondary"
                              disabled={!online}
                              onClick={async () => {
                                await store.pauseAgent(agent.id);
                                setRefresh((v) => v + 1);
                              }}
                            >
                              Pause
                            </button>
                          )
                        )}
                        {!["COMPLETED", "FAILED", "STOPPED"].includes(agent.state) && (
                          <button
                            className="btn quiet"
                            disabled={!online}
                            onClick={async () => {
                              await store.stopAgent(agent.id);
                              setRefresh((v) => v + 1);
                            }}
                          >
                            Stop
                          </button>
                        )}
                      </div>
                    </article>
                  ))}
                </>
              )}
              {tab === "Missions / Tasks" && (
                <>
                  <h3>Missions</h3>
                  {!detail.missions.length && <p className="caption">No Mission history.</p>}
                  {detail.missions.map((mission) => (
                    <article key={mission.id} className="project-history-row">
                      <div>
                        <h3>{mission.title}</h3>
                        <p>
                          {mission.state.replaceAll("_", " ")} ·{" "}
                          {date(mission.finishedAt ?? mission.updatedAt)}
                        </p>
                      </div>
                      <button
                        className="btn secondary"
                        onClick={() => {
                          store.openMission(mission.id);
                          useIsland.setState({
                            sheet: "agentic",
                            agentFocus:
                              store.agents?.agents.find((row) => row.missionId === mission.id)
                                ?.id ?? null,
                          });
                        }}
                      >
                        View Tasks and verification
                      </button>
                    </article>
                  ))}
                  <h3>Model Tasks</h3>
                  {detail.tasks.map((task) => (
                    <article key={task.id} className="project-history-row">
                      <div>
                        <h3>{task.title}</h3>
                        <p>
                          {task.state.replaceAll("_", " ")} · {NAMES[task.provider]} ·{" "}
                          {task.model || "Model unknown"}
                        </p>
                        <small>
                          {date(task.finishedAt ?? task.createdAt)} ·{" "}
                          {task.verification
                            ? task.verification.passed
                              ? "Verification passed"
                              : "Verification failed"
                            : "No independent Task verification"}
                        </small>
                      </div>
                      <button
                        className="btn secondary"
                        onClick={() => {
                          useIsland.setState({ decisionTaskId: task.id });
                          store.setSheet("task");
                        }}
                      >
                        View Task
                      </button>
                    </article>
                  ))}
                </>
              )}
              {tab === "Files / Workspace" && (
                <>
                  <h3>User Project root</h3>
                  <p className="project-path">{project.path}</p>
                  <p className="caption">
                    Registration preserves your folder in place. File reads and edits require their
                    own reviewed access.
                  </p>
                  <button
                    className="btn secondary"
                    onClick={() => openForm("relink")}
                    disabled={!online}
                  >
                    Relink workspace
                  </button>
                  {project.projectType === "repository" && (
                    <button
                      className="btn secondary"
                      disabled={!online || busy}
                      onClick={async () => {
                        const result = await command("project.repository", { id: project.id });
                        if (result) setRepository(result as Record<string, unknown>);
                      }}
                    >
                      Inspect repository
                    </button>
                  )}
                  {repository && (
                    <pre className="project-path">{JSON.stringify(repository, null, 2)}</pre>
                  )}
                  <h3>Agent scratch spaces</h3>
                  {!detail.workspaces.length && (
                    <p className="caption">No Agent scratch space allocated.</p>
                  )}
                  {detail.workspaces.map((w) => (
                    <article key={w.id} className="project-history-row">
                      <div>
                        <h3>
                          {detail.agents.find((a) => a.id === w.agentId)?.name ??
                            "Historical Agent workspace"}
                        </h3>
                        <p className="project-path">{w.scratch.path}</p>
                        <small>
                          {w.state} · {w.maxBytes / 1024 / 1024} MB limit
                        </small>
                      </div>
                    </article>
                  ))}
                  <p className="caption">
                    Artifact storage, user folders, and Agent scratch are separate ownership
                    domains.
                  </p>
                </>
              )}
              {tab === "Artifacts" && (
                <>
                  {!detail.artifacts.length && (
                    <p className="caption">No canonical Mission artifacts yet.</p>
                  )}
                  {detail.artifacts.map((a) => (
                    <article key={a.id} className="project-history-row">
                      <div>
                        <h3>{a.title}</h3>
                        <p>
                          {a.verification} · {a.type.replaceAll("_", " ")} · {date(a.createdAt)}
                        </p>
                        <small className="project-path">SHA-256 {a.sha256}</small>
                      </div>
                      <button
                        className="btn secondary"
                        disabled={!online || a.verification !== "verified"}
                        onClick={async () => {
                          const result = (await command("project.artifact", {
                            projectId: project.id,
                            artifactId: a.id,
                          })) as { artifact: typeof a; body: string; encoding: string } | null;
                          if (result)
                            setArtifact({
                              title: a.title,
                              body: result.body,
                              sha256: result.artifact.sha256,
                              image:
                                result.encoding === "base64"
                                  ? `data:${a.location.mediaType};base64,${result.body}`
                                  : undefined,
                            });
                        }}
                      >
                        Open verified artifact
                      </button>
                    </article>
                  ))}
                  {artifact && (
                    <div className="project-artifact">
                      <div className="section-heading">
                        <h3>{artifact.title}</h3>
                        <button className="btn quiet" onClick={() => setArtifact(null)}>
                          Close artifact
                        </button>
                      </div>
                      <p className="caption project-path">
                        Content checked against SHA-256 {artifact.sha256}
                      </p>
                      {artifact.image ? (
                        <img src={artifact.image} alt={artifact.title} />
                      ) : (
                        <pre>{artifact.body}</pre>
                      )}
                    </div>
                  )}
                </>
              )}
              {tab === "Activity" && (
                <>
                  {!detail.events.length && <p className="caption">No retained activity.</p>}
                  {detail.events.map((event) => (
                    <article className="project-history-row" key={event.sequence}>
                      <div>
                        <h3>{event.type.replaceAll(".", " ")}</h3>
                        <p>{date(event.at)}</p>
                        <p className="caption project-path">{event.detail}</p>
                      </div>
                    </article>
                  ))}
                </>
              )}
              {["Missions / Tasks", "Artifacts", "Activity"].includes(tab) && (
                <div className="project-pagination">
                  <span>History page {historyOffset / 25 + 1}</span>
                  <button
                    className="btn quiet"
                    disabled={!historyOffset || loading}
                    onClick={() => setHistoryOffset(Math.max(0, historyOffset - 25))}
                  >
                    Previous
                  </button>
                  <button
                    className="btn quiet"
                    disabled={
                      loading ||
                      (tab === "Artifacts"
                        ? detail.artifacts.length
                        : tab === "Activity"
                          ? detail.events.length
                          : Math.max(detail.missions.length, detail.tasks.length)) < 25
                    }
                    onClick={() => setHistoryOffset(historyOffset + 25)}
                  >
                    Next
                  </button>
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
