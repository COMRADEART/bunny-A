import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useIsland } from "@/store/use-island";
import { buildGoal, buildMonitor, buildSchedule, type FieldErrors, type GoalDraft, type MonitorDraft, type ScheduleDraft } from "./proactive-forms";

/**
 * MA4-S2-T3R creation on the workstation: a goal, a schedule or a monitor is filled in, previewed by the Host (the same
 * validation it enforces), then approved — or saved for later approval, or edited. The owner sees what will run, what is
 * read, whether a model runs, what needs approval later and when it all ends, before anything can act.
 */
type Kind = "goal" | "schedule" | "monitor";
type Preview = Record<string, unknown> & { ok: boolean; problems: string[] };
const today = (days = 0) => { const d = new Date(Date.now() + days * 86_400_000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const when = (at: number) => new Date(at).toLocaleString([], { weekday: "short", year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const ZONES = [Intl.DateTimeFormat().resolvedOptions().timeZone, "UTC", "Asia/Kolkata", "Europe/London", "Europe/Berlin", "America/New_York", "America/Los_Angeles", "Asia/Tokyo", "Australia/Sydney"].filter((z, i, all) => z && all.indexOf(z) === i);
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function ProactiveCreate() {
  const store = useIsland();
  const [kind, setKind] = useState<Kind | null>(null);
  const [roots, setRoots] = useState<{ id: string; label: string }[]>([]);
  const live = store.canAct();
  useEffect(() => {
    if (!kind || kind === "goal") return;
    void store.ptaskCommand("connector.roots.list", {}).then(r => setRoots(((r?.data as { roots?: { id: string; label: string }[] } | undefined)?.roots ?? []).map(x => ({ id: x.id, label: x.label }))));
  }, [kind]); // eslint-disable-line react-hooks/exhaustive-deps
  const projects = store.projects.length ? store.projects.map(p => ({ id: p.id, name: p.name })) : [{ id: "personal", name: "Personal" }];
  const ollama = store.providerList.find(p => p.id === "ollama");
  const models = (ollama?.models ?? []).filter(m => !(ollama?.remoteModels ?? []).includes(m) && !m.endsWith(":cloud"));
  return (
    <div className="proactive-create" data-testid="proactive-create">
      <div className="task-filters" role="group" aria-label="Create">
        {(["goal", "schedule", "monitor"] as const).map(k => (
          <button key={k} type="button" aria-pressed={kind === k} disabled={!live} onClick={() => setKind(kind === k ? null : k)}>
            {k === "goal" ? "New goal" : k === "schedule" ? "New schedule" : "New monitor"}
          </button>
        ))}
      </div>
      {kind === "goal" ? <GoalForm projects={projects} models={models} onDone={() => setKind(null)} /> : null}
      {kind === "schedule" ? <ScheduleForm projects={projects} models={models} roots={roots} onDone={() => setKind(null)} /> : null}
      {kind === "monitor" ? <MonitorForm projects={projects} roots={roots} onDone={() => setKind(null)} /> : null}
    </div>
  );
}

/** Shared edit → review → approve flow. `build` turns the form into the Host spec or field messages. */
function Flow({ kind, title, build, children, onDone }: { kind: Kind; title: string; build: () => { ok: true; spec: Record<string, unknown> } | { ok: false; errors: FieldErrors }; children: (errors: FieldErrors) => ReactNode; onDone: () => void }) {
  const store = useIsland();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [preview, setPreview] = useState<{ spec: Record<string, unknown>; view: Preview } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null), heading = useRef<HTMLHeadingElement>(null);
  const run = async (action: string, data: Record<string, unknown>) => {
    let refusal: string | null = null;
    const reply = await store.ptaskCommand(action, data, caption => { refusal = caption; });
    if (!reply) setMessage(refusal ?? "The Host refused this; nothing was changed.");
    return reply?.data as Record<string, unknown> | undefined;
  };
  const review = async () => {
    setMessage(null);
    const built = build();
    if (!built.ok) {
      setErrors(built.errors);
      // Focus the first field the owner must fix; the summary above it is announced.
      requestAnimationFrame(() => form.current?.querySelector<HTMLElement>("[aria-invalid='true']")?.focus());
      return;
    }
    setErrors({}); setBusy(true);
    const view = await run(`${kind}.preview`, { spec: built.spec }) as Preview | undefined;
    setBusy(false);
    if (view) { setPreview({ spec: built.spec, view }); requestAnimationFrame(() => heading.current?.focus()); }
  };
  const create = async (approve: boolean) => {
    if (!preview) return;
    setBusy(true);
    const created = await run(`${kind}.create`, { spec: preview.spec });
    if (created && approve) await run(`${kind}.approve`, { id: created.id, version: created.version });
    setBusy(false);
    if (created) onDone();
  };
  const count = Object.keys(errors).length;
  return (
    <form ref={form} className="project-form glass proactive-form" aria-labelledby={`${kind}-form-title`} noValidate onSubmit={e => { e.preventDefault(); void review(); }}>
      <div className="section-heading">
        <h3 id={`${kind}-form-title`} ref={heading} tabIndex={-1}>{preview ? `Review: ${title}` : title}</h3>
        <button type="button" className="btn quiet" onClick={onDone}>Close</button>
      </div>
      {count ? <p className="caption" role="alert">{count === 1 ? "One field needs attention." : `${count} fields need attention.`}</p> : null}
      {message ? <p className="caption" role="alert">{message}</p> : null}
      {preview ? (
        <>
          <PreviewCard kind={kind} view={preview.view} />
          <div className="actions">
            <button type="button" className="btn primary" disabled={busy || !preview.view.ok} onClick={() => void create(true)}>{busy ? "Working…" : "Approve and start"}</button>
            <button type="button" className="btn secondary" disabled={busy || !preview.view.ok} onClick={() => void create(false)}>Save for later approval</button>
            <button type="button" className="btn quiet" disabled={busy} onClick={() => setPreview(null)}>Back to edit</button>
          </div>
        </>
      ) : (
        <>
          {children(errors)}
          <div className="actions"><button className="btn primary" disabled={busy}>{busy ? "Checking…" : "Review"}</button></div>
        </>
      )}
    </form>
  );
}

function PreviewCard({ kind, view }: { kind: Kind; view: Preview }) {
  const v = view as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!view.ok) return (
    <div className="caption" role="alert"><p><strong>Bunny-A cannot accept this yet:</strong></p><ul>{view.problems.map(p => <li key={p}>{p}</li>)}</ul></div>
  );
  const rows: [string, ReactNode][] = kind === "schedule" ? [
    ["When", v.trigger],
    ["Next runs", v.next?.length ? <ul>{v.next.map((n: { at: number; note: string | null }) => <li key={n.at}>{when(n.at)}{n.note ? ` — ${n.note}` : ""}</li>)}</ul> : "None before it ends"],
    ["What Bunny-A will do", <ul>{v.willDo.map((s: string) => <li key={s}>{s}</li>)}</ul>],
    ["Information it reads", v.reads.length ? v.reads.join("; ") : "Nothing beyond the reminder text"],
    ["Local model", v.model.runs ? `Yes: ${v.model.models.join(", ")} (${v.model.calls} call${v.model.calls === 1 ? "" : "s"} per run)` : "No model runs"],
    ["Further approval", v.approvals.length ? <ul>{v.approvals.map((s: string) => <li key={s}>{s}</li>)}</ul> : "None: it only reads. Anything that sends or changes would wait for you."],
    ["Without a window open", v.background ? "Runs while Bunny-A's Host is running and you allow background work" : "Runs only while a Bunny-A window is open"],
    ["If a run is missed", v.missedPolicy === "skip" ? "Skipped and reported" : "Only the latest missed run happens, once"],
    ["Ends", when(v.expiresAt)], ["Your approval lasts until", when(v.approvalUntil)],
  ] : kind === "monitor" ? [
    ["Reads", v.reads], ["Acts", v.condition], ["Checks", `Every ${Math.round(v.everyMs / 60_000)} min, at most ${v.checksPerHour} per hour`],
    ["Local model", "No model runs for checks"], ["Notifies", v.notify ? "Yes, once per change" : "No (it can still start a schedule)"],
    ["First check", v.baseline], ["Ends", when(v.expiresAt)], ["Your approval lasts until", when(v.approvalUntil)],
  ] : [
    ["Success criteria", `${v.criteria}`], ["How progress counts", v.progressRule], ["Allowed actions", v.permittedActions.length ? v.permittedActions.join(", ") : "Whatever each approved task allows"],
    ["Task budget", `${v.maxTasks} tasks`], ["Deadline", v.deadlineAt ? when(v.deadlineAt) : "None"], ["Ends", when(v.expiresAt)], ["Activation", v.activation],
  ];
  return <dl className="proactive-preview">{rows.map(([k, val]) => <div key={k}><dt>{k}</dt><dd>{val}</dd></div>)}</dl>;
}

/** A labelled field whose message is tied to its control for screen readers. */
function Field({ label, name, errors, hint, children }: { label: string; name: string; errors: FieldErrors; hint?: string; children: (a11y: { id: string; "aria-invalid": boolean; "aria-describedby"?: string }) => ReactNode }) {
  const id = useId(), err = errors[name], described = [hint ? `${id}-hint` : "", err ? `${id}-err` : ""].filter(Boolean).join(" ") || undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children({ id, "aria-invalid": !!err, "aria-describedby": described })}
      {hint ? <small id={`${id}-hint`} className="caption">{hint}</small> : null}
      {err ? <small id={`${id}-err`} className="caption field-error">{err}</small> : null}
    </div>
  );
}
const Choice = <T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) => (
  <fieldset className="field proactive-choice"><legend>{label}</legend>
    <div className="task-filters">{options.map(([v, text]) => <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>{text}</button>)}</div>
  </fieldset>
);
const Check = ({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) => (
  <label className="caption proactive-check"><input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} /> {label}{hint ? <small> — {hint}</small> : null}</label>
);

function GoalForm({ projects, models, onDone }: { projects: { id: string; name: string }[]; models: string[]; onDone: () => void }) {
  const store = useIsland();
  const [d, setD] = useState<GoalDraft>({ title: "", description: "", projectId: projects[0]?.id ?? "", criteria: "", deadline: "", expires: today(60), maxTasks: 20, permitted: ["file.read", "local.generate", "local.review"], milestones: true, priority: "normal" });
  const [plan, setPlan] = useState<{ steps: { id: string; kind: string }[]; problems: string[] } | null>(null);
  const set = (patch: Partial<GoalDraft>) => setD({ ...d, ...patch });
  const draftPlan = async () => {
    if (!models[0]) return setPlan({ steps: [], problems: ["No local model is installed; the Planner needs one."] });
    const env = { capabilities: d.permitted.length ? d.permitted : ["file.read"], providers: ["ollama"], localOnly: true, models: [models[0]], projectScopes: [d.projectId], sideEffects: false, background: false, budgets: { maxModelCalls: 10, maxWallMs: 3_600_000 }, expiresAt: Date.now() + 86_400_000 };
    const r = await store.ptaskCommand("ptask.plan", { request: `${d.title}\n${d.description}\nSuccess criteria:\n${d.criteria}`, projectId: d.projectId, model: models[0], envelope: env });
    const p = r?.data as { spec?: { steps: { id: string; kind: string }[] } | null; problems?: string[] } | undefined;
    setPlan({ steps: p?.spec?.steps ?? [], problems: p?.problems ?? (r ? [] : ["The Planner could not be reached."]) });
  };
  return (
    <Flow kind="goal" title="New goal" onDone={onDone} build={() => buildGoal(d, Date.now())}>{errors => (
      <>
        <Field label="Goal" name="title" errors={errors}>{a => <input {...a} maxLength={120} value={d.title} onChange={e => set({ title: e.target.value })} />}</Field>
        <Field label="Description (optional)" name="description" errors={errors}>{a => <textarea {...a} maxLength={600} value={d.description} onChange={e => set({ description: e.target.value })} />}</Field>
        <Field label="Project" name="projectId" errors={errors}>{a => <select {...a} value={d.projectId} onChange={e => set({ projectId: e.target.value })}>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}</Field>
        <Field label="Success criteria, one per line" name="criteria" errors={errors} hint="Each one is met only by a completed task with verified receipts.">{a => <textarea {...a} value={d.criteria} onChange={e => set({ criteria: e.target.value })} />}</Field>
        <div className="proactive-row">
          <Field label="Deadline (optional)" name="deadline" errors={errors}>{a => <input {...a} type="date" value={d.deadline} onChange={e => set({ deadline: e.target.value })} />}</Field>
          <Field label="Ends on" name="expires" errors={errors}>{a => <input {...a} type="date" value={d.expires} onChange={e => set({ expires: e.target.value })} />}</Field>
          <Field label="Task budget" name="maxTasks" errors={errors}>{a => <input {...a} type="number" min={1} max={500} value={d.maxTasks} onChange={e => set({ maxTasks: Number(e.target.value) })} />}</Field>
        </div>
        <fieldset className="field"><legend>Actions work for this goal may use</legend>
          {[["file.read", "Read files in folders you registered"], ["local.generate", "Write text with a local model"], ["local.review", "Check results with a local model"]].map(([k, text]) => (
            <Check key={k} label={text} checked={d.permitted.includes(k)} onChange={on => set({ permitted: on ? [...d.permitted, k] : d.permitted.filter(x => x !== k) })} />
          ))}
        </fieldset>
        <Choice label="Priority" value={d.priority} options={[["low", "Low"], ["normal", "Normal"], ["high", "High"]]} onChange={priority => set({ priority })} />
        <Check label="Notify me when a criterion is met" checked={d.milestones} onChange={milestones => set({ milestones })} />
        <div className="actions"><button type="button" className="btn secondary" onClick={() => void draftPlan()} disabled={!d.title.trim()}>Preview a task plan</button></div>
        {plan ? (
          <div className="caption" role="status" aria-label="Task plan proposal">
            <p><strong>Proposal only</strong> — nothing is created from it until you build and approve a task or schedule.</p>
            {plan.steps.length ? <ol>{plan.steps.map(s => <li key={s.id}>{s.id}: {s.kind}</li>)}</ol> : null}
            {plan.problems.length ? <ul>{plan.problems.map(p => <li key={p}>{p}</li>)}</ul> : null}
          </div>
        ) : null}
      </>
    )}</Flow>
  );
}

function ScheduleForm({ projects, models, roots, onDone }: { projects: { id: string; name: string }[]; models: string[]; roots: { id: string; label: string }[]; onDone: () => void }) {
  const store = useIsland();
  const monitors = (store.proactive?.monitors ?? []).filter(m => m.state === "ACTIVE" || m.state === "AWAITING_APPROVAL");
  const [d, setD] = useState<ScheduleDraft>({ title: "", projectId: projects[0]?.id ?? "", when: "daily", date: today(1), time: "18:00", timeZone: ZONES[0], days: [1, 2, 3, 4, 5], monitorId: "", starts: "", expires: today(30),
    task: "summarize", text: "", root: roots[0]?.id ?? "", paths: "", model: models[0] ?? "", review: true, missedPolicy: "skip", background: false, maxModelCalls: 4, maxMinutes: 30, maxRunsPerDay: 2, notifyCompleted: true, notifyFailed: true });
  useEffect(() => { if (!d.root && roots[0]) setD(x => ({ ...x, root: roots[0].id })); }, [roots]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (patch: Partial<ScheduleDraft>) => setD({ ...d, ...patch });
  return (
    <Flow kind="schedule" title="New schedule" onDone={onDone} build={() => buildSchedule(d, Date.now())}>{errors => (
      <>
        <Field label="Name" name="title" errors={errors}>{a => <input {...a} maxLength={120} value={d.title} onChange={e => set({ title: e.target.value })} />}</Field>
        <Field label="Project" name="projectId" errors={errors}>{a => <select {...a} value={d.projectId} onChange={e => set({ projectId: e.target.value })}>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}</Field>
        <Choice label="What Bunny-A does" value={d.task} options={[["remind", "Remind me"], ["check", "Check files (no model)"], ["summarize", "Summarize files"]]} onChange={task => set({ task })} />
        {d.task === "remind" ? (
          <Field label="Reminder" name="text" errors={errors}>{a => <input {...a} maxLength={200} value={d.text} onChange={e => set({ text: e.target.value })} />}</Field>
        ) : (
          <>
            <Field label="Folder" name="root" errors={errors} hint={roots.length ? undefined : "Register a folder in Settings first; Bunny-A reads only registered folders."}>{a => <select {...a} value={d.root} onChange={e => set({ root: e.target.value })}>{roots.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}</select>}</Field>
            <Field label="Files in that folder (up to 4, comma or line separated)" name="paths" errors={errors}>{a => <textarea {...a} value={d.paths} onChange={e => set({ paths: e.target.value })} />}</Field>
            {d.task === "summarize" ? (
              <>
                <Field label="Local model" name="model" errors={errors} hint="This exact model is pinned; no other model is ever used.">{a => <select {...a} value={d.model} onChange={e => set({ model: e.target.value })}>{models.length ? models.map(m => <option key={m} value={m}>{m}</option>) : <option value="">No local model installed</option>}</select>}</Field>
                <Check label="Have a Reviewer check the summary against the files" checked={d.review} onChange={review => set({ review, maxModelCalls: Math.max(d.maxModelCalls, review ? 2 : 1) })} />
              </>
            ) : null}
          </>
        )}
        <Choice label="When" value={d.when} options={[["once", "Once"], ["daily", "Every day"], ["weekly", "Some days"], ["condition", "When a monitor sees a change"]]} onChange={when => set({ when })} />
        {d.when === "condition" ? (
          <Field label="Monitor" name="monitorId" errors={errors} hint={monitors.length ? undefined : "Create and approve a monitor first."}>{a => <select {...a} value={d.monitorId} onChange={e => set({ monitorId: e.target.value })}><option value="">Choose…</option>{monitors.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}</select>}</Field>
        ) : (
          <div className="proactive-row">
            {d.when === "once" ? <Field label="Date" name="date" errors={errors}>{a => <input {...a} type="date" value={d.date} onChange={e => set({ date: e.target.value })} />}</Field> : null}
            <Field label="Time" name="time" errors={errors}>{a => <input {...a} type="time" value={d.time} onChange={e => set({ time: e.target.value })} />}</Field>
            <Field label="Time zone" name="timeZone" errors={errors}>{a => <select {...a} value={d.timeZone} onChange={e => set({ timeZone: e.target.value })}>{ZONES.map(z => <option key={z} value={z}>{z}</option>)}</select>}</Field>
          </div>
        )}
        {d.when === "weekly" ? (
          <fieldset className="field"><legend>Days</legend>
            <div className="task-filters">{DAYS.map((name, i) => <button key={name} type="button" aria-pressed={d.days.includes(i)} onClick={() => set({ days: d.days.includes(i) ? d.days.filter(x => x !== i) : [...d.days, i] })}>{name}</button>)}</div>
            {errors.days ? <small className="caption field-error" role="alert">{errors.days}</small> : null}
          </fieldset>
        ) : null}
        <div className="proactive-row">
          <Field label="Starts (optional)" name="starts" errors={errors}>{a => <input {...a} type="date" value={d.starts} onChange={e => set({ starts: e.target.value })} />}</Field>
          <Field label="Ends on" name="expires" errors={errors}>{a => <input {...a} type="date" value={d.expires} onChange={e => set({ expires: e.target.value })} />}</Field>
        </div>
        <Choice label="If Bunny-A was off or asleep at that time" value={d.missedPolicy} options={[["skip", "Skip it and tell me"], ["run_once", "Run the latest one once"]]} onChange={missedPolicy => set({ missedPolicy })} />
        {d.task !== "remind" ? (
          <>
            <Check label="Allow it to run while Bunny-A's windows are closed" hint="Only while the Host runs, and only if background work is also on" checked={d.background} onChange={background => set({ background })} />
            <div className="proactive-row">
              <Field label="Model calls per run (at most)" name="maxModelCalls" errors={errors}>{a => <input {...a} type="number" min={0} max={500} value={d.maxModelCalls} onChange={e => set({ maxModelCalls: Number(e.target.value) })} />}</Field>
              <Field label="Minutes per run (at most)" name="maxMinutes" errors={errors}>{a => <input {...a} type="number" min={1} max={1440} value={d.maxMinutes} onChange={e => set({ maxMinutes: Number(e.target.value) })} />}</Field>
              <Field label="Runs per day (at most)" name="maxRunsPerDay" errors={errors}>{a => <input {...a} type="number" min={1} max={48} value={d.maxRunsPerDay} onChange={e => set({ maxRunsPerDay: Number(e.target.value) })} />}</Field>
            </div>
            <Check label="Notify me when a run completes" checked={d.notifyCompleted} onChange={notifyCompleted => set({ notifyCompleted })} />
            <Check label="Notify me when a run fails" checked={d.notifyFailed} onChange={notifyFailed => set({ notifyFailed })} />
          </>
        ) : null}
      </>
    )}</Flow>
  );
}

function MonitorForm({ projects, roots, onDone }: { projects: { id: string; name: string }[]; roots: { id: string; label: string }[]; onDone: () => void }) {
  const store = useIsland();
  const minMinutes = Math.max(1, Math.round((store.proactive?.policy.minIntervalMs ?? 60_000) / 60_000));
  const tasks = (store.persistentTasks?.tasks ?? []).flatMap(t => t.corrupt ? [] : [{ id: t.id, title: t.title, projectId: t.projectId }]);
  const [d, setD] = useState<MonitorDraft>({ title: "", label: "", projectId: projects[0]?.id ?? "", source: "json", root: roots[0]?.id ?? "", path: "", field: "status", taskId: "", condition: "transition", value: "", from: "PASS", to: "FAIL",
    everyMinutes: Math.max(5, minMinutes), maxChecksPerHour: 12, dedupMinutes: 30, notify: true, priority: "normal", expires: today(30) });
  useEffect(() => { if (!d.root && roots[0]) setD(x => ({ ...x, root: roots[0].id })); }, [roots]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (patch: Partial<MonitorDraft>) => setD({ ...d, ...patch });
  return (
    <Flow kind="monitor" title="New monitor" onDone={onDone} build={() => buildMonitor(d, Date.now(), minMinutes)}>{errors => (
      <>
        <Field label="Name" name="title" errors={errors}>{a => <input {...a} maxLength={120} value={d.title} onChange={e => set({ title: e.target.value })} />}</Field>
        <Field label="Short label (shown on the phone and notch; no paths)" name="label" errors={errors}>{a => <input {...a} maxLength={60} value={d.label} onChange={e => set({ label: e.target.value })} />}</Field>
        <Field label="Project" name="projectId" errors={errors}>{a => <select {...a} value={d.projectId} onChange={e => set({ projectId: e.target.value })}>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}</Field>
        <Choice label="Source" value={d.source} options={[["json", "A status field in a JSON file"], ["file", "A file's first line"], ["task", "One of my tasks"]]} onChange={source => set({ source, condition: source === "task" ? "equals" : d.condition, value: source === "task" ? "COMPLETED" : d.value })} />
        {d.source === "task" ? (
          <Field label="Task" name="taskId" errors={errors}>{a => <select {...a} value={d.taskId} onChange={e => set({ taskId: e.target.value })}><option value="">Choose…</option>{tasks.filter(t => t.projectId === d.projectId).map(t => <option key={t.id} value={t.id}>{t.title}</option>)}</select>}</Field>
        ) : (
          <>
            <Field label="Folder" name="root" errors={errors} hint={roots.length ? undefined : "Register a folder in Settings first."}>{a => <select {...a} value={d.root} onChange={e => set({ root: e.target.value })}>{roots.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}</select>}</Field>
            <Field label="File inside that folder" name="path" errors={errors}>{a => <input {...a} value={d.path} placeholder="build/status.json" onChange={e => set({ path: e.target.value })} />}</Field>
            {d.source === "json" ? <Field label="Field" name="field" errors={errors}>{a => <input {...a} value={d.field} onChange={e => set({ field: e.target.value })} />}</Field> : null}
          </>
        )}
        <Choice label="Act when" value={d.condition} options={[["transition", "It changes from one value to another"], ["equals", "It becomes a value"], ["changed", "It changes at all"]]} onChange={condition => set({ condition })} />
        {d.condition === "transition" ? (
          <div className="proactive-row">
            <Field label="From (optional)" name="from" errors={errors}>{a => <input {...a} value={d.from} onChange={e => set({ from: e.target.value })} />}</Field>
            <Field label="To" name="to" errors={errors}>{a => <input {...a} value={d.to} onChange={e => set({ to: e.target.value })} />}</Field>
          </div>
        ) : d.condition === "equals" ? <Field label="Value" name="value" errors={errors}>{a => <input {...a} value={d.value} onChange={e => set({ value: e.target.value })} />}</Field> : null}
        <div className="proactive-row">
          <Field label="Check every (minutes)" name="everyMinutes" errors={errors}>{a => <input {...a} type="number" min={minMinutes} max={1440} value={d.everyMinutes} onChange={e => set({ everyMinutes: Number(e.target.value) })} />}</Field>
          <Field label="Checks per hour (at most)" name="maxChecksPerHour" errors={errors}>{a => <input {...a} type="number" min={1} max={120} value={d.maxChecksPerHour} onChange={e => set({ maxChecksPerHour: Number(e.target.value) })} />}</Field>
          <Field label="Ends on" name="expires" errors={errors}>{a => <input {...a} type="date" value={d.expires} onChange={e => set({ expires: e.target.value })} />}</Field>
        </div>
        <Check label="Notify me when it happens" checked={d.notify} onChange={notify => set({ notify })} />
        <Choice label="Notification priority" value={d.priority} options={[["low", "Low"], ["normal", "Normal"], ["high", "High"]]} onChange={priority => set({ priority })} />
      </>
    )}</Flow>
  );
}
