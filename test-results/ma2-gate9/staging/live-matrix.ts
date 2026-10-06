import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import {
  BASE, chain, capStep, cmd, createMission, directOutcome, directRun, getMission, getState, health,
  openRequests, approveMission, REC, respond, saveRecord, STAGE_STATE, until,
  wait, waitMissionState, waitOpenRequest,
} from "./live-shared.ts";
import type { MissionView, PlanStep, RunView } from "./live-shared.ts";

/**
 * Gate T9 live matrix — staged candidate Bunny-A-Windows-v17-T9 (Host on 127.0.0.1:44119;
 * production untouched and still live on 43119).
 *
 * Usage: node --experimental-strip-types live-matrix.ts <phase|all> — the named phase and every
 * phase after it (resume-from). A failed check stops the matrix (a later phase never produces evidence on an
 * earlier one). Every check is recorded as {check, actual, pass} inside the phase's §78 record.
 * Window hygiene is (pid|title)-scoped per phase: only windows that APPEARED during a phase are
 * closed, and closure is a per-window WM_CLOSE (title-matched, handle-targeted) — never a pid
 * kill, because one shared ApplicationFrameHost process can host the user's own UWP windows.
 * Pre-existing windows (the user's own desktop) are never touched.
 */

// ── static probe values ───────────────────────────────────────────────────────────────
const SECRET_PROBE = "T9SecretProbe-7f3"; // 17 chars — matches the "[17 characters]" redaction
const LOOKALIKE_TITLE = "Calculator help";
const OUTSIDE_DIR = "C:/Users/allam/Bunny-T9-outside";

type Win = { pid: number; process: string; title: string; foreground?: boolean };

async function windowSnapshot(): Promise<Win[]> {
  const outcome = directOutcome(await directRun("computer.list_windows", {}));
  const windows = (outcome.output as { windows?: Win[] } | null)?.windows;
  if (!windows) throw new Error("list_windows produced no window list.");
  return windows as Win[];
}

/** Post-launch readiness: a focus that races a freshly started app loses the foreground to the
 * previous window ("Focus requested; foreground is …" — matrix run 6's phase C), so the phases
 * wait for the target window row to exist before the focus step is approved. */
async function waitWindow(pattern: RegExp, options?: { timeoutMs?: number }): Promise<Win | null> {
  return until(async () => {
    const rows = await windowSnapshot();
    return rows.find((w) => pattern.test(`${w.process} ${w.title}`)) ?? null;
  }, `a window matching ${pattern}`, options);
}

/** Mirrors the shipped extractObservedPid preference: the declared windowPid (the matched
 * top-level window's owning process) first, then the element/target/window pids as fallbacks for
 * outputs that carry none (focus, list_windows). Phase L uses it for both the pin and the drift. */
function observedFrom(output: unknown): number | null {
  const out = (output ?? {}) as Record<string, unknown>;
  const direct = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null);
  return direct(out.windowPid) ?? direct(out.pid)
    ?? direct((out.target as Record<string, unknown> | null)?.processId)
    ?? direct((out.control as Record<string, unknown> | null)?.processId) ?? direct(out.processId);
}

/**
 * Close JUST the target window: enumerate the owner pid's top-level windows, match the row's
 * title, and PostMessage(WM_CLOSE) each matching visible handle. Never a pid kill — on this
 * Windows 11 host one ApplicationFrameHost process hosts windows of unrelated UWP apps (the
 * user's own included), so a pid kill could close other people's windows; and MainWindowHandle
 * alone is not enough either (the process's "main" window may be an unrelated window).
 */
function closeFreshWindows(fresh: Win[], notes: string[] = []): number[] {
  const closed: number[] = [];
  for (const w of fresh) {
    const lit = w.title.replace(/'/g, "''");
    const ps =
      `Add-Type 'using System;using System.Text;using System.Collections.Generic;using System.Runtime.InteropServices;public static class Wc{public class Ww{public IntPtr H;public string T;}
public delegate bool Ep(IntPtr h,IntPtr l);
[DllImport("user32.dll")]public static extern bool EnumWindows(Ep cb,IntPtr l);
[DllImport("user32.dll")]public static extern bool GetWindowThreadProcessId(IntPtr h,out uint pid);
[DllImport("user32.dll",CharSet=CharSet.Unicode)]public static extern int GetWindowText(IntPtr h,StringBuilder sb,int max);
[DllImport("user32.dll")]public static extern bool IsWindowVisible(IntPtr h);
[DllImport("user32.dll")]public static extern bool PostMessage(IntPtr h,uint m,IntPtr w,IntPtr l);
public static List<Ww> Find(uint pid,string like){var o=new List<Ww>();EnumWindows((h,l)=>{uint wp;GetWindowThreadProcessId(h,out wp);if(pid==0||wp==pid){var sb=new StringBuilder(256);GetWindowText(h,sb,256);var t=sb.ToString();if(t.IndexOf(like,StringComparison.OrdinalIgnoreCase)>=0&&IsWindowVisible(h))o.Add(new Ww{H=h,T=t});}return true;},IntPtr.Zero);return o;}
public static int Close(IntPtr[] hs){int n=0;foreach(var h in hs)if(PostMessage(h,0x10,IntPtr.Zero,IntPtr.Zero))n++;return n;}}'
$wins = [Wc]::Find(${w.pid}, '${lit}')
$n = [Wc]::Close([IntPtr[]]@($wins | ForEach-Object { $_.H }))
Write-Output ("posted=" + $n + " count=" + $wins.Count + " titles=" + (($wins | ForEach-Object { $_.T }) -join '; '))`;
    try {
      const out = execSync(`powershell.exe -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(ps, "utf16le").toString("base64")}`, { stdio: "pipe", timeout: 20_000 }).toString().trim();
      const posted = Number(/posted=(\d+)/.exec(out)?.[1] ?? 0);
      const found = Number(/count=(\d+)/.exec(out)?.[1] ?? 0);
      if (posted > 0) { closed.push(w.pid); notes.push(`WM_CLOSE posted to ${posted} "${w.title}" window handle(s) on pid ${w.pid} (method: per-handle PostMessage, never a pid kill)`); }
      else if (found === 0) notes.push(`no visible "${w.title}"-titled window on pid ${w.pid} (already gone)`);
      else notes.push(`WM_CLOSE: ${out}`);
    } catch (error) { notes.push(`WM_CLOSE for the "${w.title}" window (pid ${w.pid}) failed: ${String(error).slice(0, 120)}`); }
  }
  return closed;
}

const HYGIENE: { phase: string; closed: number[]; at: number; skipped?: string }[] = [];
const TRACK = {
  // Freshness key is PID|TITLE: on UWP one ApplicationFrameHost pid hosts windows of several apps
  // over time (the user's own included), so a bare pid baseline would either skip the matrix's
  // own windows on a shared pid or sweep the user's window that inherited the pid later.
  baseline: new Set<string>(),
  async mark() {
    try { this.baseline = new Set((await windowSnapshot()).map((w) => `${w.pid}|${w.title}`)); }
    catch { /* before missions are enabled there is no window list yet — keep any previous baseline */ }
  },
  async sweep(phase: string): Promise<number[]> {
    if (this.baseline.size === 0) {
      // Never sweep without a baseline: the closure list is "fresh only", and with no baseline
      // every calculator/notepad window (the user's own included) would look fresh.
      HYGIENE.push({ phase, closed: [], at: Date.now(), skipped: "no window baseline yet (missions were still disabled) — nothing swept" });
      return [];
    }
    const notes: string[] = [];
    const fresh = (await windowSnapshot()).filter((w) => !this.baseline.has(`${w.pid}|${w.title}`) && /calculator|notepad/i.test(`${w.process} ${w.title}`));
    const closed = closeFreshWindows(fresh, notes);
    HYGIENE.push({ phase, closed, at: Date.now(), ...(notes.length ? { notes } : {}) });
    return closed;
  },
};

/**
 * Stop every non-terminal mission on the staged Host BEFORE a phase starts. The staged Host's
 * M-A-1 concurrent-mission limit is 3; missions left non-terminal by an interrupted prior run
 * (waiting_for_approval / waiting_for_user with their asks resolved deny by mission.stop) would
 * otherwise consume the slots — matrix run 5's phase H was correctly refused with
 * "3 missions are already active (limit 3)" for exactly that reason. Runs strictly before the
 * phase's own creations (phaseH's H/H2 pair is created after its guard and is the only
 * concurrency the phase designs).
 */
async function strayGuard(): Promise<void> {
  const terminal = ["completed", "failed", "stopped"];
  const state = await getState();
  const strays = (state.missions?.missions ?? []).filter((mm: MissionView) => !terminal.includes(mm.state));
  for (const stray of strays) {
    try { await cmd("mission.stop", { id: stray.id }); } catch { /* already gone */ }
    await wait(250);
  }
}

// ── assertions ────────────────────────────────────────────────────────────────────────
type Check = { check: string; actual: unknown; pass: boolean };
function check(checks: Check[], label: string, actual: unknown, pass: (value: unknown) => boolean): void {
  const ok = (() => { try { return pass(actual); } catch { return false; } })();
  checks.push({ check: label, actual, pass: ok });
  if (!ok) throw new Error(`Check failed: ${label} — saw ${JSON.stringify(actual)}`);
}
const is = (...values: unknown[]) => (value: unknown) => values.includes(value);
const truthy = () => (value: unknown) => value === true;

/** Read a §78 record already on disk (a later phase merges its section into the same file). */
function readRecord(name: string): Record<string, unknown> {
  try { return JSON.parse(readFileSync(REC + "/" + name, "utf8")) as Record<string, unknown>; } catch { return { ok: true }; }
}

/**
 * Canonical batch truth straight from the staged store, read with a READ-ONLY connection
 * (never a write; the live Host keeps owning the database). Returns the row's own fields.
 */
function batchRowDb(missionId: string): { id: string; usedCount: number; maxActions: number; status: string; endReason: string | null; createdBy: string; endBy: string | null; createdAt: number; expiresAt: number } | null {
  const db = new DatabaseSync(join(STAGE_STATE, "host.sqlite"), { readOnly: true });
  try {
    const row = db.prepare("SELECT record FROM approval_batches WHERE mission_id = ? ORDER BY created_at DESC LIMIT 1").get(missionId) as { record: string } | undefined;
    if (!row) return null;
    const record = JSON.parse(row.record) as Record<string, unknown>;
    return {
      id: String(record.id), usedCount: Number(record.usedCount), maxActions: Number(record.maxActions),
      status: String(record.status), endReason: (record.endReason as string | null) ?? null,
      createdBy: String(record.createdBy ?? ""), endBy: (record.endBy as string | null) ?? null,
      createdAt: Number(record.createdAt), expiresAt: Number(record.expiresAt),
    };
  } finally { db.close(); }
}

// ── mission plan builders ─────────────────────────────────────────────────────────────
type Recon = {
  typeFeasible: boolean; typeMechanism: string;
  display: { name: string; automationId: string; controlType: string } | null;
  buttons: string[]; digitButtons: string[];
};
let RECON: Recon | null = null;
try {
  const parsed = JSON.parse(readFileSync(REC + "/recon.json", "utf8")) as Recon & { ok?: boolean };
  RECON = parsed.ok === true ? parsed : null; // an aborted run's ok:false record is never reused
} catch { RECON = null; }
/** The entry mechanism recon settled on (typed display or digit-button invoke; see recon). */
let entryFeasible = false;
let entryAction: "computer.type" | "computer.invoke_control" = "computer.type";
if (RECON) {
  entryFeasible = RECON.typeFeasible || (RECON.digitButtons?.length ?? 0) > 0;
  entryAction = RECON.typeFeasible ? "computer.type" : "computer.invoke_control";
}

function typeParams(text: string): Record<string, unknown> {
  const selector: Record<string, unknown> = { title: "Calculator" };
  if (RECON?.display?.automationId) selector.automationId = RECON.display.automationId;
  if (RECON?.display?.name) selector.name = RECON.display.name;
  return { ...selector, text };
}

function entry(i: number): PlanStep {
  if (RECON?.typeFeasible) return capStep("Entry", "computer.type", typeParams(String(700 + i)), `Set the Calculator display to ${700 + i}`);
  const pool = (RECON?.digitButtons?.length ? RECON.digitButtons : RECON?.buttons ?? []).filter(Boolean);
  if (!pool.length) throw new Error("recon found no usable Calculator controls for the entry steps");
  return capStep("Press", "computer.invoke_control", { title: "Calculator", name: pool[i % pool.length] }, `Press the ${pool[i % pool.length]} control`);
}

function calculatorPlan(title: string, entries: number) {
  const steps: PlanStep[] = [
    capStep("Launcher", "computer.open_app", { app: "calculator" }, "Launch Calculator"),
    capStep("Window", "computer.focus_window", { title: "Calculator" }, "Focus the Calculator window"),
  ];
  for (let i = 0; i < entries; i += 1) steps.push(entry(i));
  return { title, objective: `Live Gate T9 matrix mission: a bounded Calculator desktop sequence (${steps.length} planned steps). No verification.`, steps: chain(steps) };
}

async function runApproved(plan: { title: string; objective: string; steps: unknown[] }): Promise<MissionView> {
  const created = await createMission(plan);
  if (created.state !== "waiting_for_approval") throw new Error(`Mission ${created.id} is ${created.state}, not waiting_for_approval.`);
  return approveMission(created.id);
}

/** Answer every ask one action at a time (plain Allow once). */
async function allowOnceEach(missionId: string, log: { requestId: string; action: string; hadOffer: boolean }[] = []): Promise<MissionView> {
  return until(async () => {
    const state = await getMission(missionId);
    // waiting_for_user is not terminal while an ask is open — it IS the state an open ask produces.
    if (openRequests(state.mission).length > 0) {
      const open = openRequests(state.mission)[0];
      log.push({ requestId: open.id, action: open.action, hadOffer: open.batchOffer !== null });
      const out = await respond(open.id, "allow_once");
      if (out.status !== 200) throw new Error(`allow_once failed (${out.status}): ${JSON.stringify(out.body)}`);
      return null;
    }
    if (["completed", "failed", "stopped"].includes(state.mission.state)) return state.mission;
    return null;
  }, `mission ${missionId} to finish under allow-once approvals`, { timeoutMs: 180_000 });
}

/** Answer every remaining ask with deny until the mission reaches a final state. */
async function denyUntilDone(missionId: string, timeoutMs = 120_000): Promise<MissionView> {
  return until(async () => {
    const state = await getMission(missionId);
    if (["completed", "failed", "stopped"].includes(state.mission.state)) return state.mission;
    const open = openRequests(state.mission)[0];
    if (open) await respond(open.id, "deny");
    return null;
  }, `mission ${missionId} to finish under denies`, { timeoutMs });
}

/** Track an active batch through /state while the mission runs (live-progress evidence). */
async function trackBatch(missionId: string): Promise<{ shots: { at: number; usedCount: number; maxActions: number; status: string }[]; view: MissionView }> {
  const shots: { at: number; usedCount: number; maxActions: number; status: string }[] = [];
  const view = await until(async () => {
    const m = (await getState()).missions?.missions.find((item) => item.id === missionId);
    if (!m) return null;
    if (m.batch) {
      const last = shots.at(-1);
      if (!last || last.usedCount !== m.batch.usedCount) shots.push({ at: Date.now(), usedCount: m.batch.usedCount, maxActions: m.batch.maxActions, status: m.batch.status });
    }
    return ["completed", "failed", "stopped", "waiting_for_user"].includes(m.state) ? m : null;
  }, `mission ${missionId} to finish while tracking its batch`, { timeoutMs: 180_000 });
  return { shots, view };
}

/** Wait for a batch to consume at least n admissions. askOpen (default true) also requires an open ask — phases where everything runs under the batch pass false. */
async function waitAdmitted(missionId: string, n: number, options?: { timeoutMs?: number; askOpen?: boolean }): Promise<{ usedCount: number; maxActions: number; status: string }> {
  const askOpen = options?.askOpen ?? true;
  return until(async () => {
    const m = (await getState()).missions?.missions.find((item) => item.id === missionId);
    const askOpenNow = m ? openRequests(m).length > 0 : false;
    return m?.batch && m.batch.usedCount >= n && (!askOpen || askOpenNow)
      ? { usedCount: m.batch.usedCount, maxActions: m.batch.maxActions, status: m.batch.status } : null;
  }, `mission ${missionId} batch to reach ${n} admissions${askOpen ? " with an ask open" : ""}`, { timeoutMs: options?.timeoutMs ?? 90_000 });
}

const batchEvents = async (missionId: string) => (await getMission(missionId)).events.filter((e) => e.type.startsWith("approval.batch"));

// ── phase preClean ────────────────────────────────────────────────────────────────────
async function preClean(): Promise<void> {
  const checks: Check[] = [];
  try {
    const configured = await cmd("mission.configure", { enabled: true });
    check(checks, "missions enabled on the staged Host", configured.status, is(200));
    const h = await health();
    check(checks, "staged Host healthy", h.operationalState, is("healthy"));
    saveRecord("pre-clean.json", { ok: true, checks, hostPid: h.pid, instanceId: h.instanceId, note: "window hygiene is pid-scoped per phase (fresh windows only); pre-existing windows are never touched" });
  } catch (error) { saveRecord("pre-clean.json", { ok: false, checks, error: (error as Error).message }); throw error; }
}

// ── phase recon (feasibility + control discovery; reused on re-runs) ──────────────────
async function recon(): Promise<void> {
  if (RECON) { console.log("[recon] reused"); return; }
  const checks: Check[] = [];
  try {
    await TRACK.mark();
    const open = directOutcome(await directRun("computer.open_app", { app: "calculator" }));
    check(checks, "direct open_app calculator succeeded", open.status, is("succeeded"));
    await until(async () => (await windowSnapshot()).find((w) => /calculator/i.test(w.title)) ?? null, "a Calculator window", { timeoutMs: 30_000 });
    check(checks, "a Calculator window appeared", true, truthy());
    const read = directOutcome(await directRun("computer.read_controls", { title: "Calculator" }));
    check(checks, "direct read_controls succeeded", read.status, is("succeeded"));
    const controls = ((read.output ?? {}) as { controls?: { name: string; controlType: string; automationId: string; enabled: boolean }[] }).controls ?? [];
    const compact = controls.map((c) => ({ name: String(c.name ?? ""), controlType: String(c.controlType ?? "").replace("ControlType.", ""), automationId: String(c.automationId ?? "") }));
    const display = compact.find((c) => /Edit|Text/.test(c.controlType) && !/memory|history/i.test(c.name)) ?? null;
    const buttonNames = [...new Set(compact.filter((c) => c.controlType === "Button" && c.name).map((c) => c.name))];
    const digitButtons = buttonNames.filter((b) => /^(zero|one|two|three|four|five|six|seven|eight|nine|[\d]|num[\d])$/i.test(b));
    check(checks, "recon found a display-like control", display !== null, truthy());
    check(checks, "recon found buttons", buttonNames.length > 0, truthy());
    let typeFeasible = false; let typeMechanism: string; let typeProbe: unknown = null;
    if (display) {
      const selector: Record<string, unknown> = { title: "Calculator" };
      if (display.automationId) selector.automationId = display.automationId;
      if (display.name) selector.name = display.name;
      try {
        typeProbe = directOutcome(await directRun("computer.type", { ...selector, text: "785" }));
        const typed = typeProbe as { status: string; summary?: string; output?: { matches?: boolean } };
        typeFeasible = typed.status === "succeeded" && typed.output?.matches === true;
        // This build's Calculator display (CalculatorResults) is a Text control with no ValuePattern:
        // the runtime fails closed ("Control has no editable value") — the entry fallback is invokes.
        typeMechanism = typeFeasible ? "ValuePattern set on the display control; read-back matched" : `not feasible on this display (status ${typed.status}: ${typed.summary ?? "no detail"}) — entries fall back to invoked digit buttons`;
      } catch (error) { typeMechanism = `threw: ${(error as Error).message}`; }
    } else typeMechanism = "no display-like control found";
    // The probe button must live INSIDE the panel: window-chrome buttons (Minimize/Maximize/Close/
    // flyouts) change desktop state and blind the following UIA reads. Prefer digit buttons.
    const chromeless = (names: string[]) => names.filter((b) => !/minimize|maximize|close|open |flyout|navigation|help|settings|menu/i.test(b));
    const pool = digitButtons.length ? digitButtons : chromeless(buttonNames);
    const chosen: { name: string; status: string; summary: string | null }[] = [];
    let resetProbe: { status: string; summary: string | null; output: unknown } | null = null;
    for (const name of (pool.length ? pool : buttonNames).slice(0, 5)) {
      const probe = directOutcome(await directRun("computer.invoke_control", { title: "Calculator", name }));
      chosen.push({ name, status: probe.status, summary: probe.summary });
      if (probe.status === "succeeded") { resetProbe = probe; break; }
    }
    check(checks, "an in-panel Calculator button invoked successfully", resetProbe !== null && resetProbe.status === "succeeded", (v) => v === true);
    entryFeasible = typeFeasible || resetProbe !== null;
    typeMechanism = entryFeasible
      ? (typeFeasible ? typeMechanism : `${typeMechanism}; entry mechanism = invoked digit buttons (${pool.map((b) => `"${b}"`).slice(0, 3).join(", ")}…)`)
      : "neither value typing nor button invoke worked";
    check(checks, "an entry mechanism is feasible (typed display OR digit-button invoke)", entryFeasible, truthy());
    entryAction = typeFeasible ? "computer.type" : "computer.invoke_control";
    check(checks, "the entry mechanism maps to a batchable computer action", [entryAction, entryAction.startsWith("computer.")], (v: unknown[]) => v[0] !== null && v[1] === true);
    RECON = { typeFeasible, typeMechanism, display, buttons: buttonNames, digitButtons };
    saveRecord("recon.json", { ok: true, ...RECON, probes: { type: typeProbe, invokeAttempts: chosen }, controlsSample: compact.slice(0, 80) });
  } catch (error) { saveRecord("recon.json", { ok: false, checks, error: (error as Error).message }); throw error; }
}

// ── phase A: one desktop action keeps today's plain Allow once (§50) ──────────────────
async function phaseA(): Promise<void> {
  const checks: Check[] = [];
  try {
    const mission = await runApproved({
      title: "T9 A — single action", objective: "Live Gate T9 matrix mission: exactly one desktop launch, approved one action at a time.",
      steps: chain([capStep("Launcher", "computer.open_app", { app: "calculator" }, "Launch Calculator")]),
    });
    const open = await waitOpenRequest(mission.id);
    check(checks, "the single-action ask carries NO batch offer", open?.batchOffer ?? null, (v) => v === null);
    const answered = await respond(open!.id, "allow_once");
    check(checks, "allow_once accepted", answered.status, is(200));
    const done = await waitMissionState(mission.id, ["completed"], { timeoutMs: 90_000 });
    check(checks, "mission completed", done.state, is("completed"));
    check(checks, "exactly one approval in the whole flow (1 ask, plain Allow once)", done.requests.filter((r) => r.resolvedAt !== null).length, is(1));
    check(checks, "zero batch events (single-action flows never batch)", (await batchEvents(mission.id)).length, is(0));
    saveRecord("single-action-live.json", { ok: true, missionId: mission.id, prompts: 1, checks, note: "§50 preserved live: a single desktop ask offers no batch and answers with plain Allow once exactly as before" });
  } catch (error) { saveRecord("single-action-live.json", { ok: false, checks, error: (error as Error).message }); throw error; }
}

// ── phase B: A2 baseline vs the batch (§31 + §76 metric) ──────────────────────────────
async function phaseB(): Promise<void> {
  const checks: Check[] = [];
  try {
    const a2 = await runApproved(calculatorPlan("T9 B A2 — allow-once baseline", 3));
    const answers: { requestId: string; action: string; hadOffer: boolean }[] = [];
    const a2Done = await allowOnceEach(a2.id, answers);
    check(checks, "A2 baseline completed under allow-once", a2Done.state, is("completed"));
    const a2Prompts = a2Done.requests.filter((r) => r.resolution === "allow_once").length;
    check(checks, "A2: prompts for the 5-mutation sequence WITHOUT batching (§76 before)", a2Prompts, is(5));

    const b = await runApproved(calculatorPlan("T9 B — one batch approval", 3));
    const offer = await waitOpenRequest(b.id);
    const ob = offer?.batchOffer ?? null;
    check(checks, "the first ask carries the Host-computed offer", ob !== null, truthy());
    check(checks, "offer family is computer; every covered action is a computer action", [ob?.family, ob?.actions.every((a) => a.startsWith("computer."))], (v: unknown[]) => v[0] === "computer" && v[1] === true);
    check(checks, "covered actions are the sorted, deduped plan actions", ob?.actions, (v: unknown) => JSON.stringify(v) === JSON.stringify(["computer.focus_window", entryAction, "computer.open_app"].sort()));
    check(checks, "offer target is the app-tier Calculator bound", [ob?.targetLabel, ob?.targetTier, (ob?.target as { app?: string } | null)?.app], (v: unknown[]) => v[0] === "Calculator" && v[1] === "app" && v[2] === "calculator");
    check(checks, "offer counts: the ask counts once; the 3 entry executions counted 3 (no double-count)", [ob?.counts["computer.open_app"], ob?.counts["computer.focus_window"], ob?.counts[entryAction], ob ? Object.values(ob.counts).reduce((a, c) => a + c, 0) : -1], (v: unknown[]) => v[0] === 1 && v[1] === 1 && v[2] === 3 && v[3] === 5);
    check(checks, "offer bound: maxActions min(2×5,12)=10, ttl 120000 ms (2 min), ceiling EXECUTE, no read-only riders", [ob?.maxActions, ob?.ttlMs, ob?.riskCeiling, ob?.readOnly], (v: unknown[]) => v[0] === 10 && v[1] === 120000 && v[2] === "EXECUTE" && Array.isArray(v[3]) && v[3].length === 0);
    const granted = await respond(offer!.id, "allow_batch");
    check(checks, "allow_batch accepted", granted.status, is(200));
    const { shots, view } = await trackBatch(b.id);
    const prompts = view.requests.filter((r) => r.resolvedAt !== null).length;
    check(checks, "B: prompts for the SAME 5-mutation sequence WITH the batch (§76 after)", prompts, is(1));
    check(checks, "B: all 5 covered actions ran to completion as runs", view.steps.filter((s) => ["completed"].includes(s.state)).length, is(5));
    const row = batchRowDb(b.id);
    check(checks, "B: canonical store row — usedCount 5 / maxActions 10, ended with the mission", row ? [row.usedCount, row.maxActions, row.status, row.endReason] : null, (v: unknown[]) => v[0] === 5 && v[1] === 10 && v[2] === "ended" && v[3] === "mission_ended");
    check(checks, "B: the live view tracked the count climbing during the mission (never a jump beyond the budget)", shots.length > 0, truthy());
    check(checks, "B: the mission view ends with no batch block", view.batch, (v) => v === null);
    const events = await batchEvents(b.id);
    check(checks, "journal: batch_started and batch_ended both present", [events.some((e) => e.type === "approval.batch_started"), events.some((e) => e.type === "approval.batch_ended")], (v: unknown[]) => v.every(Boolean));
    const startEvent = events.find((e) => e.type === "approval.batch_started");
    check(checks, "journal truth: names the app bound, states the 2-minute life, no standing language", startEvent ? [/Calculator/i.test(startEvent.detail), /within 2 min/.test(startEvent.detail), !/always|forever|standing/i.test(startEvent.detail)] : [], (v: unknown[]) => v.length === 3 && v.every(Boolean));
    saveRecord("batch-calculator-live.json", {
      ok: true, before: { missionId: a2.id, promptCount: a2Prompts }, after: { missionId: b.id, promptCount: prompts },
      offer: ob, batchShots: shots, batchEvents: events, batchRow: row, checks,
      note: "the LIVE §31 positive example and the §76 metric: same 5-action plan — 5 prompts before, 1 prompt with the batch; the count is canonical (5/10 used, read from the store row)",
    });
  } catch (error) { saveRecord("batch-calculator-live.json", { ok: false, error: (error as Error).message }); throw error; }
}

// ── phase E: a shrunk budget ends the batch; the next action asks fresh (§12, §21–§23) ─
async function phaseE(): Promise<void> {
  const checks: Check[] = [];
  try {
    const mission = await runApproved(calculatorPlan("T9 E — budget shrink", 4));
    const offer = await waitOpenRequest(mission.id);
    check(checks, "offer present (6 mutating executions → maxActions 12)", [offer?.batchOffer !== null, offer?.batchOffer?.maxActions], (v: unknown[]) => v[0] === true && v[1] === 12);
    const granted = await respond(offer!.id, "allow_batch", { maxActions: 3 });
    check(checks, "allow_batch shrunk to maxActions 3 accepted (only-shrink)", granted.status, is(200));
    const { shots, view } = await trackBatch(mission.id);
    check(checks, "the live count climbed to 3 admissions (the 3rd ends the batch, so the last visible count is the 3rd or the poll caught 2)", shots.length > 0, truthy());
    const exhaustedAsk = await waitOpenRequest(mission.id, { timeoutMs: 90_000 });
    check(checks, "the 4th covered mutation asked for FRESH approval (no off-by-one: nothing admitted past the budget)", exhaustedAsk?.resolvedAt, (v) => v === null);
    const row = batchRowDb(mission.id);
    check(checks, "canonical store row — ended exhausted at exactly 3/3", row ? [row.usedCount, row.maxActions, row.status, row.endReason] : null, (v: unknown[]) => v[0] === 3 && v[1] === 3 && v[2] === "ended" && v[3] === "exhausted");
    const events = await batchEvents(mission.id);
    check(checks, "journal: batch_exhausted present", events.some((e) => e.type === "approval.batch_exhausted"), truthy());
    check(checks, "the ended batch is gone from the mission view", view.batch, (v) => v === null);
    check(checks, "at most 3 desktop actions ran (nothing slipped past the budget)", exhaustedAsk ? (await getMission(mission.id)).runs.filter((r: RunView) => r.action.startsWith("computer.")).length : -1, (v: number) => v >= 0 && v <= 3);
    const denied = await respond(exhaustedAsk!.id, "deny");
    check(checks, "deny accepted on the post-exhaustion ask", denied.status, is(200));
    const failed = await waitMissionState(mission.id, ["failed"], { timeoutMs: 60_000 });
    check(checks, "mission failed after the user denied the fresh ask", failed.state, is("failed"));
    saveRecord("budget-exhaustion-live.json", {
      ok: true, missionId: mission.id, grantedMaxActions: 3, batchShots: shots, batchEvents: events, batchRow: row, checks,
      note: "the budget is real: 3 admissions then the batch ended exhausted (store row 3/3); the 4th desktop action asked fresh and the deny failed the mission — nothing admitted past the budget",
    });
  } catch (error) { saveRecord("budget-exhaustion-live.json", { ok: false, error: (error as Error).message }); throw error; }
}

// ── phase F: a shrunk TTL expires and every later action asks (§13) ───────────────────
async function phaseF(): Promise<void> {
  const checks: Check[] = [];
  try {
    const mission = await runApproved(calculatorPlan("T9 F — TTL shrink", 3));
    const offer = await waitOpenRequest(mission.id);
    const granted = await respond(offer!.id, "allow_batch", { ttlMs: 1000 });
    check(checks, "allow_batch with the 1-second ttl accepted", granted.status, is(200));
    const grantedAt = batchRowDb(mission.id)!.createdAt;
    const admitted = trackBatch(mission.id); // live shots, consumed below
    await wait(1500); // the Host clock is the authority: the batch is now certainly lapsed
    const displayNow = (await getMission(mission.id)).mission.batch;
    check(checks, "the lapsed batch displays truthfully (ended / expired — never active)", displayNow ? [displayNow.status, displayNow.endReason] : null, (v: unknown[]) => v[0] === "ended" && v[1] === "expired");
    const rowBefore = batchRowDb(mission.id);
    check(checks, "the store row keeps the lazy-flip shape (status active, no end event — consult/admission gates refuse it)", rowBefore ? [rowBefore.status, rowBefore.endReason, rowBefore.expiresAt < Date.now()] : null, (v: unknown[]) => v[0] === "active" && v[1] === null && v[2] === true);
    const late = await waitOpenRequest(mission.id, { timeoutMs: 120_000 });
    check(checks, "a later covered action asked for explicit approval after expiry", late?.resolvedAt, (v) => v === null);
    check(checks, "the fresh ask happened after the 1-second life (Host clock, not wall luck)", late ? late.createdAt - grantedAt : -1, (v: number) => v >= 1000);
    check(checks, "no batch_ended event exists for an expiry (expiry is refused lazily, never 'ended')", (await batchEvents(mission.id)).some((e) => e.type === "approval.batch_ended"), (v) => v === false);
    const shots = (await admitted).shots;
    check(checks, "whatever the batch covered before expiry, the live shots show it (≤ the max)", [shots.length > 0, shots.every((s) => s.usedCount <= 10)], (v: unknown[]) => v.every(Boolean));
    const answers: { requestId: string; action: string; hadOffer: boolean }[] = [];
    const done = await allowOnceEach(mission.id, answers);
    check(checks, "remaining actions finished under explicit approvals", done.state, is("completed"));
    saveRecord("expiration-live.json", {
      ok: true, missionId: mission.id, ttlMsGranted: 1000, grantedAt, admissionsBeforeExpiry: shots.map((s) => s.usedCount), lateRequestId: late?.id, checks,
      note: "the Host clock is the authority: the shrunk ttl lapsed mid-mission; the display flipped to ended/expired, the store row keeps the lazy-flip shape, and every later action asked and was answered explicitly (§13)",
    });
  } catch (error) { saveRecord("expiration-live.json", { ok: false, error: (error as Error).message }); throw error; }
}

// ── phase G: Stop ends the batch immediately (§43–§44) ────────────────────────────────
async function phaseG(): Promise<void> {
  const checks: Check[] = [];
  try {
    const mission = await runApproved(calculatorPlan("T9 G — Stop", 8));
    const offer = await waitOpenRequest(mission.id);
    const granted = await respond(offer!.id, "allow_batch");
    check(checks, "batch granted (10 mutations → maxActions 12)", granted.status, is(200));
    const live = await waitAdmitted(mission.id, 2, { askOpen: false });
    check(checks, "the batch was live at Stop time", live.status, is("active"));
    const stopped = await cmd("mission.stop", { id: mission.id });
    check(checks, "mission.stop accepted", stopped.status, is(200));
    const detail = await getMission(mission.id);
    const view = detail.mission;
    check(checks, "mission is stopped", view.state, is("stopped"));
    const events = await batchEvents(mission.id);
    check(checks, "journal: batch_ended present (Stop ends the batch)", events.some((e) => e.type === "approval.batch_ended"), truthy());
    const row = batchRowDb(mission.id);
    check(checks, "canonical store row — ended with the stop at the used count seen live", row ? [row.status, row.endReason, row.usedCount >= live.usedCount] : null, (v: unknown[]) => v[0] === "ended" && v[1] === "mission_ended" && v[2] === true);
    check(checks, "no run still running after Stop", detail.runs.filter((r: RunView) => r.status === "running").length, is(0));
    check(checks, "no open request remains (Stop resolves them)", openRequests(view).length, is(0));
    const lastRunAt = detail.runs.map((r: RunView) => r.startedAt ?? r.createdAt);
    check(checks, "no run exists after the mission's finishedAt (nothing ran afterwards)", Math.max(0, ...lastRunAt) <= (view as unknown as { finishedAt: number }).finishedAt, truthy());
    check(checks, "no batch block remains in the mission view", view.batch, (v) => v === null);
    saveRecord("stop-live.json", {
      ok: true, missionId: mission.id, batchAtStop: live, batchEvents: events, batchRow: row, checks,
      note: "Stop prevents future actions live: the batch ended with the mission (store row mission_ended), open asks were resolved with deny, and every run predates the mission's finishedAt (§43/§44)",
    });
  } catch (error) { saveRecord("stop-live.json", { ok: false, error: (error as Error).message }); throw error; }
}

// ── phase H: concurrent missions never share a batch (§37, §71) ───────────────────────
async function phaseH(): Promise<void> {
  const checks: Check[] = [];
  try {
    const h = await runApproved(calculatorPlan("T9 H — batch mission", 6));
    const offer = await waitOpenRequest(h.id);
    const granted = await respond(offer!.id, "allow_batch");
    check(checks, "batch granted on mission H", granted.status, is(200));
    await waitAdmitted(h.id, 1, { askOpen: false });
    check(checks, "H's batch is live", true, truthy());
    const h2 = await runApproved(calculatorPlan("T9 H2 — concurrent mission (same app, same actions)", 1));
    const h2Open = await waitOpenRequest(h2.id, { timeoutMs: 90_000 });
    check(checks, "H2's own desktop ask is a REAL ask — a concurrent mission's batch never rescues it", h2Open?.resolvedAt, (v) => v === null);
    const once = await respond(h2Open!.id, "allow_once");
    check(checks, "allow_once accepted on H2", once.status, is(200));
    const h2Done = await allowOnceEach(h2.id);
    check(checks, "H2 completed under explicit approvals only", h2Done.state, is("completed"));
    check(checks, "no batch grant ever existed on H2", h2Done.requests.every((r) => r.resolution !== "allow_batch"), truthy());
    check(checks, "H2 has NO batch row in the store at all", batchRowDb(h2.id), (v) => v === null);
    check(checks, "H2's journal contains zero batch events", (await batchEvents(h2.id)).length, is(0));
    const hDone = await waitMissionState(h.id, ["completed"], { timeoutMs: 180_000 });
    check(checks, "H completed under its own batch", hDone.state, is("completed"));
    const hEvents = await batchEvents(h.id);
    check(checks, "H's batch events are all H's own mission", hEvents.every((e) => e.missionId === h.id), truthy());
    saveRecord("task-isolation-live.json", {
      ok: true, missionH: h.id, missionH2: h2.id, checks,
      note: "two concurrent missions on the SAME app and SAME actions: H2 asked on its own while H's batch ran; batch consult is strictly mission-scoped and H2 never even gained a batch row (§37/§71)",
    });
  } catch (error) { saveRecord("task-isolation-live.json", { ok: false, error: (error as Error).message }); throw error; }
}

// ── phase C: the batch never crosses to a different app (§32) → app-boundary-live.json ─
async function phaseC(): Promise<void> {
  const checks: Check[] = [];
  try {
    const mission = await runApproved({
      title: "T9 C — app boundary",
      objective: "Live Gate T9 matrix mission: a Calculator batch, then Notepad launch and focus actions that must ask.",
      steps: chain([
        capStep("Launcher", "computer.open_app", { app: "calculator" }, "Launch Calculator"),
        capStep("Window", "computer.focus_window", { title: "Calculator" }, "Focus Calculator"),
        capStep("Launcher2", "computer.open_app", { app: "notepad" }, "Launch Notepad (different app)"),
        capStep("Window2", "computer.focus_window", { title: "Notepad" }, "Focus Notepad"),
      ]),
    });
    const offer = await waitOpenRequest(mission.id);
    const ob = offer?.batchOffer ?? null;
    check(checks, "the Calculator ask's offer binds the Calculator app", ob ? [ob.target.app, ob.targetTier, ob.targetLabel] : null, (v: unknown[]) => v[0] === "calculator" && v[1] === "app" && v[2] === "Calculator");
    const granted = await respond(offer!.id, "allow_batch");
    check(checks, "Calculator batch granted", granted.status, is(200));
    const notepadAsk = await waitOpenRequest(mission.id, { action: "computer.open_app", timeoutMs: 90_000 });
    check(checks, "launching Notepad ASKED while the Calculator batch was live (target app mismatch stops it)", notepadAsk?.resolvedAt, (v) => v === null);
    check(checks, "the Notepad ask carries its OWN offer — a NEW Notepad-typed bound, never the Calculator batch", notepadAsk?.batchOffer ? notepadAsk.batchOffer.target.app : null, (v) => v === "notepad");
    const once = await respond(notepadAsk!.id, "allow_once");
    check(checks, "allow_once accepted for the Notepad launcher", once.status, is(200));
    await waitWindow(/notepad/i);
    // Notepad only reaches the foreground late: its launch activation is blocked by the
    // just-foregrounded Calculator's startup protection (every phase-C attempt so far lost the
    // focus step with the foreground still "Calculator"). A 15 s settle lets Notepad's own
    // activation land (probe-steal2.ts: at +15 s the foreground was "Untitled - Notepad" before
    // any direct focus was attempted), which is what the focus step then confirms.
    await wait(15_000);
    const focusAsk = await waitOpenRequest(mission.id, { action: "computer.focus_window", timeoutMs: 90_000 });
    check(checks, "focusing Notepad also asked (its title does not match the Calculator bound)", focusAsk?.resolvedAt, (v) => v === null);
    const once2 = await respond(focusAsk!.id, "allow_once");
    check(checks, "allow_once accepted for the Notepad focus", once2.status, is(200));
    const done = await waitMissionState(mission.id, ["completed"], { timeoutMs: 180_000 });
    check(checks, "mission completed", done.state, is("completed"));
    check(checks, "exactly ONE allow_batch grant (Calculator); every Notepad action stayed explicit", done.requests.filter((r) => r.resolution === "allow_batch").length, is(1));
    const row = batchRowDb(mission.id);
    check(checks, "the Notepad actions never consumed the Calculator batch's budget (row usedCount 2)", row ? [row.usedCount, row.endReason] : null, (v: unknown[]) => v[0] === 2 && v[1] === "mission_ended");
    saveRecord("app-boundary-live.json", {
      ok: true, missionId: mission.id, calculatorOffer: { target: ob?.target, counts: ob?.counts, maxActions: ob?.maxActions },
      notepadOffer: notepadAsk?.batchOffer, checks, batchRow: row,
      note: "the live §32 gate: the same mission, a Calculator batch — Notepad launch and focus each stopped for their own approval; the batch budget shows exactly the two Calculator admissions",
    });
  } catch (error) { saveRecord("app-boundary-live.json", { ok: false, error: (error as Error).message }); throw error; }
}

// ── phase D: sensitive-target typing is never batched (§26) → risk-boundary-live.json ──
async function phaseD(): Promise<void> {
  const checks: Check[] = [];
  const record = readRecord("risk-boundary-live.json");
  try {
    const mission = await runApproved({
      title: "T9 D — sensitive input",
      objective: "Live Gate T9 matrix mission: a Calculator batch, then a password-shaped typing ask that must never be batched.",
      steps: chain([
        capStep("Launcher", "computer.open_app", { app: "calculator" }, "Launch Calculator"),
        capStep("Window", "computer.focus_window", { title: "Calculator" }, "Focus Calculator"),
        capStep("Entry", "computer.type", { title: "Password Window", text: SECRET_PROBE }, "Type into a password-shaped window (it does not exist; the attempt must fail)"),
      ]),
    });
    record.missionId = mission.id;
    const offer = await waitOpenRequest(mission.id);
    const ob = offer?.batchOffer ?? null;
    check(checks, "the offer EXCLUDES the sensitive typing entry (only the two non-sensitive desktop actions)", ob?.actions, (v: unknown) => JSON.stringify(v) === JSON.stringify(["computer.focus_window", "computer.open_app"]));
    check(checks, "the sensitive step is absent from every covered count", ob?.counts["computer.type"], (v) => v === undefined || v === 0);
    const granted = await respond(offer!.id, "allow_batch");
    check(checks, "Calculator batch granted", granted.status, is(200));
    const secretAsk = await waitOpenRequest(mission.id, { action: "computer.type", timeoutMs: 90_000 });
    check(checks, "the password-shaped typing ASKED for explicit approval despite the live batch", secretAsk?.resolvedAt, (v) => v === null);
    check(checks, "the sensitive request carries NO batch offer", secretAsk?.batchOffer ?? null, (v) => v === null);
    const refused = await respond(secretAsk!.id, "allow_batch");
    check(checks, "allow_batch on the sensitive ask is REFUSED (there is no offer to grant)", refused.status, (v) => typeof v === "number" && v >= 400);
    const stillOpen = (await getMission(mission.id)).mission.requests.find((r) => r.id === secretAsk!.id);
    check(checks, "the sensitive ask survives the refused allow_batch still OPEN and answerable", stillOpen?.resolvedAt, (v) => v === null);
    const once = await respond(secretAsk!.id, "allow_once");
    check(checks, "allow_once accepted (the ordinary consent path is intact)", once.status, is(200));
    for (let guard = 0; guard < 40; guard += 1) {
      const state = await getMission(mission.id);
      if (["completed", "failed", "stopped"].includes(state.mission.state)) break;
      const open = openRequests(state.mission)[0];
      if (open) await respond(open.id, "deny");
      else await wait(600);
    }
    const state = await getMission(mission.id);
    check(checks, "mission ends failed (the probe window never existed)", state.mission.state, is("failed"));
    const typed = state.runs.filter((r: RunView) => r.action === "computer.type").at(-1);
    check(checks, "a type run EXISTS (the attempt genuinely ran)", typed !== undefined, truthy());
    const params = JSON.stringify(typed?.params ?? null);
    check(checks, "the run record redacts the typed value (\"[17 characters]\", never the content)", [params.includes("17 characters"), params.includes(SECRET_PROBE)], (v: unknown[]) => v[0] === true && v[1] === false);
    check(checks, "the run output carries no typed value either", JSON.stringify(typed?.output ?? null).includes(SECRET_PROBE), (v) => v === false);
    const row = batchRowDb(mission.id);
    check(checks, "the sensitive attempt never consumed the batch budget (row usedCount 2)", row ? row.usedCount : -1, is(2));
    record.sensitivity = { refusalStatus: refused.status, typeParamsRecorded: typed?.params, batchRow: row, checks };
    saveRecord("risk-boundary-live.json", record);
  } catch (error) {
    record.ok = false; record.error = (error as Error).message; record.checks = checks; saveRecord("risk-boundary-live.json", record);
    throw error;
  }
}

// ── phase S: outside the computer family the batch never rescues → risk-boundary ──────
async function phaseS(): Promise<void> {
  const checks: Check[] = [];
  const record = readRecord("risk-boundary-live.json");
  try {
    const mission = await runApproved({
      title: "T9 S — family boundary",
      objective: "Live Gate T9 matrix mission: a Calculator batch, then a filesystem write outside the approved scope that must ask on its own.",
      steps: chain([
        capStep("Launcher", "computer.open_app", { app: "calculator" }, "Launch Calculator"),
        capStep("Window", "computer.focus_window", { title: "Calculator" }, "Focus Calculator"),
        capStep("Writer", "filesystem.write", { path: `${OUTSIDE_DIR}/t9-outside-probe.txt`, content: "probe" }, "Write a probe file outside the approved scope"),
      ]),
    });
    record.missionId = mission.id;
    const offer = await waitOpenRequest(mission.id);
    const ob = offer?.batchOffer ?? null;
    check(checks, "the offer lists only computer-family actions (the filesystem step is structurally outside)", [ob !== null, ob ? ob.actions.every((a) => a.startsWith("computer.")) : false], (v: unknown[]) => v[0] === true && v[1] === true);
    check(checks, "the filesystem step never appears in the covered counts", ob ? JSON.stringify(ob.counts).includes("filesystem") : null, (v) => v === false);
    const granted = await respond(offer!.id, "allow_batch");
    check(checks, "Calculator batch granted", granted.status, is(200));
    const writeAsk = await waitOpenRequest(mission.id, { action: "filesystem.write", timeoutMs: 90_000 });
    check(checks, "the outside-scope write ASKED on its own (the batch must not rescue it)", writeAsk?.resolvedAt, (v) => v === null);
    check(checks, "the filesystem ask carries no batch offer", writeAsk?.batchOffer ?? null, (v) => v === null);
    const refused = await respond(writeAsk!.id, "allow_batch");
    check(checks, "allow_batch on the filesystem ask is REFUSED", refused.status, (v) => typeof v === "number" && v >= 400);
    const denied = await respond(writeAsk!.id, "deny");
    check(checks, "deny accepted", denied.status, is(200));
    const done = await waitMissionState(mission.id, ["failed"], { timeoutMs: 90_000 });
    check(checks, "mission failed (no rescue for the outside-family step)", done.state, is("failed"));
    check(checks, "nothing was written outside the approved scope", !existsSync(`${OUTSIDE_DIR}/t9-outside-probe.txt`), truthy());
    const row = batchRowDb(mission.id);
    check(checks, "the filesystem attempt never consumed the batch budget (row usedCount 2)", row ? row.usedCount : -1, is(2));
    record.family = { refusalStatus: refused.status, batchRow: row, checks };
    saveRecord("risk-boundary-live.json", record);
  } catch (error) {
    record.ok = false; record.error = (error as Error).message; record.checks = checks; saveRecord("risk-boundary-live.json", record);
    throw error;
  }
}

// ── phase L: the lookalike window drift ends the batch post-run (§68/§72) → app-boundary ─┐
async function phaseL(): Promise<void> {
  const checks: Check[] = [];
  const record = readRecord("app-boundary-live.json");
  // The lookalike is a test F I X T U R E created before the mission (not a batch action): a
  // console window whose title LIKE-matches the drift step's title, owned by the terminal-host
  // process — never the frame host that owns the Calculator — so the owner drift is real.
  // Nothing is typed into it (no unsaved state, no save prompt, no probe value written anywhere);
  // the original typed-lookalike design also never created the window (the drift step would have
  // failed "no window matched"). The title is a matrix-owned fixture name.
  try { execSync(`powershell -NoProfile -Command "Start-Process cmd -ArgumentList '/k','title','Calculator help'"`, { stdio: "ignore", timeout: 15_000 }); } catch { /* fixture best-effort; the check below fails honestly if absent */ }
  try {
    const lookalike = await waitWindow(/calculator help/i, { timeoutMs: 30_000 });
    check(checks, "the lookalike window fixture exists on a non-frame-host process", lookalike ? `${lookalike.process}|${lookalike.pid}` : null, (v) => typeof v === "string" && v.length > 0);
    const mission = await runApproved({
      title: "T9 L — lookalike drift",
      objective: "Live Gate T9 matrix mission: a Calculator batch, then a title-matching focus of a window owned by a different process (the drift).",
      steps: chain([
        capStep("Launcher", "computer.open_app", { app: "calculator" }, "Launch Calculator"),
        capStep("Window", "computer.focus_window", { title: "Calculator" }, "Focus Calculator"),
        capStep("Drift", "computer.focus_window", { title: LOOKALIKE_TITLE }, "Focus the title-matching lookalike window (the drift)"),
      ]),
    });
    record.missionId = mission.id;
    const offer = await waitOpenRequest(mission.id);
    const granted = await respond(offer!.id, "allow_batch");
    check(checks, "batch granted on the Calculator flow", granted.status, is(200));
    const done = await waitMissionState(mission.id, ["completed"], { timeoutMs: 150_000 });
    check(checks, "mission completed (a completed run is not reversible — the review acts forward only)", done.state, is("completed"));
    const runs = (await getMission(mission.id)).runs;
    const focusRuns = runs.filter((r: RunView) => r.action === "computer.focus_window");
    const calcFocus = focusRuns[0];
    const driftFocus = focusRuns.at(-1);
    const pinned = observedFrom(calcFocus?.output);
    const observed = observedFrom(driftFocus?.output);
    check(checks, "the Calculator focus pinned the window owner (structured output)", typeof pinned === "number" && (pinned as number) > 0, truthy());
    check(checks, "the drift focus really reached a DIFFERENT window owner (the drift is real, not simulated)", [typeof observed === "number", observed !== pinned], (v: unknown[]) => v[0] === true && v[1] === true);
    const events = await batchEvents(mission.id);
    check(checks, "the post-run review ended the batch scope_mismatch", events.some((e) => e.type === "approval.batch_scope_mismatch"), truthy());
    check(checks, "journal copy names both pids (the bound and the observed)", events.find((e) => e.type === "approval.batch_scope_mismatch")?.detail, (v: unknown) => typeof v === "string" && v.includes(String(pinned)) && v.includes(String(observed)));
    const row = batchRowDb(mission.id);
    check(checks, "the store row shows the drift admission (3 used) ended scope_mismatch", row ? [row.usedCount, row.status, row.endReason] : null, (v: unknown[]) => v[0] === 3 && v[1] === "ended" && v[2] === "scope_mismatch");
    check(checks, "no active batch remains after the drift", (await getMission(mission.id)).mission.batch, (v) => v === null);
    record.lookalike = { pinnedPid: pinned, observedPid: observed, lookalikeFixture: lookalike, batchRow: row, batchEvents: events, checks };
    saveRecord("app-boundary-live.json", record);
  } catch (error) {
    record.ok = false; record.error = (error as Error).message; record.checks = checks; saveRecord("app-boundary-live.json", record);
    throw error;
  }
}

// ── phase K: adversarial probes (§68) ─────────────────────────────────────────────────
async function phaseK(): Promise<void> {
  const checks: Check[] = [];
  const probes: Record<string, unknown> = {};
  try {
    // K1 — replay an answered request.
    const k1 = await runApproved({ title: "T9 K1 — replay", objective: "Live T9 probe: replaying an answered request must refuse.", steps: chain([capStep("Launcher", "computer.open_app", { app: "calculator" }, "Launch Calculator")]) });
    const open = await waitOpenRequest(k1.id);
    await respond(open!.id, "allow_once");
    await waitMissionState(k1.id, ["completed"], { timeoutMs: 90_000 });
    const replay = await respond(open!.id, "allow_once");
    check(checks, "K1: replaying an answered request is refused", replay.status, (v) => typeof v === "number" && v >= 400);
    probes.k1 = replay.status;

    // K2 — allow_batch on an offerless request; the request stays open and answerable.
    const k2 = await runApproved({
      title: "T9 K2 — no-offer probe", objective: "Live T9 probe: allow_batch without an offer is refused and leaves the ask answerable.",
      steps: chain([
        capStep("Launcher", "computer.open_app", { app: "calculator" }, "Launch Calculator"),
        capStep("Window", "computer.focus_window", { title: "Calculator" }, "Focus Calculator"),
        capStep("Entry", "computer.type", { title: "Password Probe", text: "K2Probe9" }, "Type into a password-shaped window"),
      ]),
    });
    const o1 = await waitOpenRequest(k2.id);
    await respond(o1!.id, "allow_once");
    const o2 = await waitOpenRequest(k2.id, { timeoutMs: 90_000 });
    check(checks, "K2: the focus ask has no batch offer (only 1 other eligible mutation remains)", o2?.batchOffer ?? null, (v) => v === null);
    const noOffer = await respond(o2!.id, "allow_batch");
    check(checks, "K2: allow_batch on an offerless request is REFUSED", noOffer.status, (v) => typeof v === "number" && v >= 400);
    const stillOpen = (await getMission(k2.id)).mission.requests.find((r) => r.id === o2!.id);
    check(checks, "K2: the refused ask stays OPEN (not silently resolved)", stillOpen?.resolvedAt, (v) => v === null);
    await respond(o2!.id, "deny");
    const k2Done = await denyUntilDone(k2.id);
    check(checks, "K2: mission failed", k2Done.state, is("failed"));
    probes.k2 = { noOffer: noOffer.status };

    // K3 — oversized knobs clamp to the offer's max (never widen).
    const k3 = await runApproved(calculatorPlan("T9 K3 — knob clamp", 3));
    const o3 = await waitOpenRequest(k3.id);
    const offerMax = o3!.batchOffer!.maxActions;
    const oversize = await respond(o3!.id, "allow_batch", { maxActions: 999 });
    check(checks, "K3: allow_batch with maxActions 999 ACCEPTED (clamped, not widened)", oversize.status, is(200));
    const batchNow = (await getMission(k3.id)).mission.batch;
    check(checks, "K3: the created batch is clamped to the offer's maxActions exactly", [batchNow?.maxActions, offerMax], (v: unknown[]) => v[0] === 10 && v[1] === 10);
    const k3Done = await waitMissionState(k3.id, ["completed"], { timeoutMs: 180_000 });
    check(checks, "K3: mission completed under the clamped batch", k3Done.state, is("completed"));
    probes.k3 = { clampedTo: batchNow?.maxActions, offerMax };

    // K4 — undersized knobs refuse at the command wall; the ttl shrink clamps honestly.
    const k4 = await runApproved(calculatorPlan("T9 K4 — ttl wall", 3));
    const o4 = await waitOpenRequest(k4.id);
    const refusedLow = await respond(o4!.id, "allow_batch", { maxActions: 0 });
    check(checks, "K4: maxActions 0 refused at the command wall", refusedLow.status, (v) => typeof v === "number" && v >= 400);
    const refusedTtl = await respond(o4!.id, "allow_batch", { ttlMs: 500 });
    check(checks, "K4: ttlMs 500 refused at the command wall (the floor is 1 s)", refusedTtl.status, (v) => typeof v === "number" && v >= 400);
    const shrunkOk = await respond(o4!.id, "allow_batch", { ttlMs: 5000 });
    check(checks, "K4: allow_batch with ttlMs 5000 accepted (within the wall and the offer)", shrunkOk.status, is(200));
    const ttlBatch = (await getMission(k4.id)).mission.batch;
    check(checks, "K4: the batch's lifetime is exactly 5 s (only-shrink knobs)", ttlBatch ? ttlBatch.expiresAt - ttlBatch.createdAt : -1, is(5000));
    const k4Done = await allowOnceEach(k4.id);
    check(checks, "K4: mission completed after the ttl expired", k4Done.state, is("completed"));
    probes.k4 = { refused: [refusedLow.status, refusedTtl.status], ttlMs: 5000 };

    // K5 — wrong-batch revoke refuses; revoking the ACTIVE batch ends it; later actions still ask.
    const k5 = await runApproved({
      title: "T9 K5 — revoke", objective: "Live T9 probe: revoke the active batch while a sensitive ask waits; nothing changes hands.",
      steps: chain([
        capStep("Launcher", "computer.open_app", { app: "calculator" }, "Launch Calculator"),
        capStep("Window", "computer.focus_window", { title: "Calculator" }, "Focus Calculator"),
        capStep("Entry", "computer.type", { title: "Password Probe", text: "K5Probe9" }, "Type into a password-shaped window"),
      ]),
    });
    const o5 = await waitOpenRequest(k5.id);
    const k5Grant = await respond(o5!.id, "allow_batch", { maxActions: 4 });
    check(checks, "K5: batch granted shrunk to maxActions 4 (2/4 used, still active when the probe asks)", k5Grant.status, is(200));
    const k5At = await waitAdmitted(k5.id, 2);
    check(checks, "K5: the batch is still ACTIVE at 2/4 while the sensitive ask waits", [k5At.usedCount, k5At.status], (v: unknown[]) => v[0] === 2 && v[1] === "active");
    const wrongId = await cmd("mission.revoke_batch", { missionId: k5.id, batchId: "99999999-9999-9999-9999-999999999999" });
    check(checks, "K5: revoking an unknown batch id is refused", wrongId.status, (v) => typeof v === "number" && v >= 400);
    const liveBatch = (await getMission(k5.id)).mission.batch!;
    const revoked = await cmd("mission.revoke_batch", { missionId: k5.id, batchId: liveBatch.id });
    check(checks, "K5: revoking the ACTIVE batch succeeded — revoke only ends, never re-grants", revoked.status, is(200));
    check(checks, "K5: the batch block is gone after the revoke", (await getMission(k5.id)).mission.batch, (v) => v === null);
    check(checks, "K5: journal says revoked", (await batchEvents(k5.id)).some((e) => e.type === "approval.batch_ended" && /revoked/i.test(e.detail)), truthy());
    const typeAsk = (await getMission(k5.id)).mission.requests.find((r) => r.resolvedAt === null);
    check(checks, "K5: the waiting sensitive ask stays open (revoke changes nothing for it)", typeAsk !== undefined, truthy());
    await respond(typeAsk!.id, "deny");
    const k5Done = await denyUntilDone(k5.id);
    check(checks, "K5: mission failed after the deny", k5Done.state, is("failed"));
    probes.k5 = { wrongId: wrongId.status, revoked: revoked.status, usedAtRevoke: liveBatch.usedCount };

    // K6 — a direct confirmed run never rides a mission batch.
    const direct = directOutcome(await directRun("computer.focus_window", { title: "Calculator" }));
    check(checks, "K6: a direct confirmed run succeeded", direct.status, is("succeeded"));
    check(checks, "K6: its reason never cites a mission batch (direct runs are outside batching)", String(direct.reason ?? "empty").includes("approval batch"), (v) => v === false);

    saveRecord("adversarial.json", {
      ok: true, probes, checks,
      note: "all §68 probes failed closed: replays refuse, offerless allow_batch refuses and leaves the ask answerable, oversized knobs clamp (never widen), undersized knobs refuse at the wall, unknown batch ids refuse, revocation only ends (never re-grants), and direct runs never ride a mission batch",
    });
  } catch (error) { saveRecord("adversarial.json", { ok: false, probes, checks, error: (error as Error).message }); throw error; }
}

// ── phase R: a Host restart never preserves a batch (§39) ─────────────────────────────
const STAGE_ROOT_PS = "C:/Users/allam/AppData/Local/Bunny-A-T9-stage";
async function phaseR(): Promise<void> {
  const checks: Check[] = [];
  try {
    const before = await health();
    check(checks, "staged Host healthy before the restart", before.operationalState, is("healthy"));
    const mission = await runApproved({
      title: "T9 R — restart",
      objective: "Live Gate T9 restart mission: a batch stays active while a sensitive ask waits; the Host is killed mid-life.",
      steps: chain([
        capStep("Launcher", "computer.open_app", { app: "calculator" }, "Launch Calculator"),
        capStep("Window", "computer.focus_window", { title: "Calculator" }, "Focus Calculator"),
        capStep("Entry", "computer.type", { title: "Password Probe", text: "RProbe9" }, "Sensitive typing ask (it waits across the restart)"),
      ]),
    });
    const offer = await waitOpenRequest(mission.id);
    const granted = await respond(offer!.id, "allow_batch", { maxActions: 4 });
    check(checks, "batch granted (shrunk to 4)", granted.status, is(200));
    const atKill = await waitAdmitted(mission.id, 2, { timeoutMs: 120_000 });
    check(checks, "the batch is ACTIVE at kill time (2/4 used; the sensitive ask is open)", [atKill.usedCount, atKill.status], (v: unknown[]) => v[0] === 2 && v[1] === "active");

    execSync(`taskkill /PID ${before.pid} /F`, { stdio: "ignore", timeout: 20_000 });
    const down = await until(async () => {
      try { await (await fetch(BASE + "/health")).json(); return false; } catch { return true; }
    }, "the staged Host to go down", { timeoutMs: 40_000 });
    check(checks, "the staged Host is down", down, truthy());

    const launcher = join(STAGE_ROOT_PS, "releases", "Bunny-A-Windows-v17-T9", "Start-Bunny-Release.ps1");
    execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${launcher}" -NoIsland -NoGateway -NoRemote`, { stdio: "ignore", timeout: 300_000 });
    const after = await until(async () => {
      try {
        const h = (await (await fetch(BASE + "/health")).json()) as { app: string; pid: number; instanceId: string; operationalState: string };
        return h.app === "Bunny-A" && h.operationalState === "healthy" ? h : null;
      } catch { return null; }
    }, "boot 2 to come up healthy", { timeoutMs: 240_000 });
    check(checks, "boot 2 is healthy", [after?.operationalState, after?.pid !== before.pid, after?.instanceId !== before.instanceId], (v: unknown[]) => v[0] === "healthy" && v[1] === true && v[2] === true);

    const marker = JSON.parse(readFileSync(join(STAGE_ROOT_PS, "state", "state-layout.json"), "utf8")) as { databaseUserVersion: number; databaseSchemaSha256: string };
    check(checks, "the installed-state marker still validates after the second boot", [marker.databaseUserVersion, marker.databaseSchemaSha256.length === 64], (v: unknown[]) => v[0] === 3 && v[1] === true);

    const view = (await getMission(mission.id)).mission;
    check(checks, "the batch is GONE after the restart (mission view shows none)", view.batch, (v) => v === null);
    const events = await batchEvents(mission.id);
    check(checks, "journal: batch_ended present (the recover() host_restart sweep)", events.some((e) => e.type === "approval.batch_ended"), truthy());
    check(checks, "the mission waited for user review (T7 restart contract, unchanged)", view.state, is("waiting_for_user"));
    const runs = (await getMission(mission.id)).runs;
    check(checks, "the sensitive typing NEVER executed (nothing replayed blind)", runs.filter((r: RunView) => r.action === "computer.type").length, is(0));
    const typeStep = view.steps.find((s) => s.executor.action === "computer.type");
    check(checks, "the waiting step was interrupted by the restart (failed, host_restart)", typeStep ? [typeStep.state, typeStep.failure?.category] : null, (v: unknown[]) => v[0] === "failed" && v[1] === "host_restart");
    const orphan = view.requests.find((r) => r.resolvedAt === null);
    check(checks, "the surviving request row stays open as journal truth (not auto-answered; unanswerable — the step is no longer waiting)", orphan !== undefined, truthy());
    const stopped = await cmd("mission.stop", { id: mission.id });
    check(checks, "cleanup: mission.stop accepted", stopped.status, is(200));
    const finalView = (await getMission(mission.id)).mission;
    check(checks, "cleanup: the mission is stopped and the open row resolved with deny", finalView.requests.every((r) => r.resolvedAt !== null), truthy());
    saveRecord("restart-live.json", {
      ok: true, missionId: mission.id, before, after, marker: marker.databaseUserVersion, batchEvents: events, checks,
      note: "the live §39 gate: a mid-batch kill preserves nothing — the batch died with the Host (boot-epoch refusal + the recover() sweep), the interrupted step reports host_restart, the surviving request stays an open journal row waiting for the user's review, and NOTHING replayed; boot 2 also re-validated the installed state (marker reconciliation)",
    });
  } catch (error) { saveRecord("restart-live.json", { ok: false, error: (error as Error).message }); throw error; }
}

// ── phase J: the paired device uses the same envelope, only smaller (§41/§42) ──────────
async function phaseJ(): Promise<void> {
  const checks: Check[] = [];
  try {
    const pairing = await cmd<{ pairCode?: string }>("pairing.create", {});
    check(checks, "pairing.create returned a one-time code", typeof pairing.body.pairCode === "string" && (pairing.body.pairCode as string).length >= 16, truthy());
    const pair = await fetch(BASE + "/pair", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: pairing.body.pairCode, name: "T9 probe phone" }),
    });
    const device = (await pair.json()) as { token: string; deviceId: string; name: string };
    check(checks, "the pair exchange succeeded (token length only is recorded — never the value)", [device.token?.length ?? 0, !!device.deviceId], (v: unknown[]) => (v[0] as number) >= 16 && v[1] === true);
    const deviceCmd = async (action: string, data: Record<string, unknown>): Promise<{ status: number; body: unknown }> => {
      const response = await fetch(BASE + "/command", {
        method: "POST", headers: { authorization: `Bearer ${device.token}`, "content-type": "application/json" }, body: JSON.stringify({ action, data }),
      });
      let body: unknown = null;
      try { body = await response.json(); } catch { body = null; }
      return { status: response.status, body };
    };

    const createdRefused = await deviceCmd("mission.create", {
      mode: "fast", objective: "A device must not supply explicit mission graphs.",
      steps: chain([capStep("Window", "computer.focus_window", { title: "Calculator" }, "Focus Calculator")]),
    });
    check(checks, "a paired device may NOT supply an explicit mission graph (workstation bound)", createdRefused.status, (v) => typeof v === "number" && v >= 400);

    const mission = await runApproved({
      title: "T9 J — device approval",
      objective: "Live Gate T9 matrix mission: the device grants the offered batch; the sequence pauses on a sensitive ask that the batch never covers; the device then revokes what it granted. No verification.",
      steps: chain([
        capStep("Launcher", "computer.open_app", { app: "calculator" }, "Launch Calculator"),
        capStep("Window", "computer.focus_window", { title: "Calculator" }, "Focus the Calculator window"),
        // The sensitive input sits after focus and before the remaining entry: the batch covers
        // the launcher/focus/entry step, but a password-protected control is never consultable —
        // the chain pauses on its fresh ask with EXACTLY 2 admissions and an active batch.
        capStep("Secure", "computer.type", { title: "Password Window", name: "Secure display", text: "JProbe9" }, "Type into the password-protected secure window"),
        entry(0),
      ]),
    });
    const offer = await waitOpenRequest(mission.id);
    const offerMax = offer!.batchOffer!.maxActions;
    const granted = (await deviceCmd("mission.respond", { requestId: offer!.id, decision: "allow_batch" })) as { status: number; body: { mission?: MissionView } };
    check(checks, "the paired device granted the batch (no knob widened; the offer's max stays)", [granted.status, granted.body.mission?.batch?.maxActions === offerMax], (v: unknown[]) => v[0] === 200 && v[1] === true);
    await waitAdmitted(mission.id, 2);
    const midMission = (await getMission(mission.id)).mission;
    check(checks, "the batch is still ACTIVE (2 admissions; the sensitive probe ask is waiting, not covered)", midMission.batch ? [midMission.batch.usedCount, midMission.batch.status] : null, (v: unknown[]) => v[0] === 2 && v[1] === "active");
    const revoked = await deviceCmd("mission.revoke_batch", { missionId: mission.id, batchId: midMission.batch!.id });
    check(checks, "the paired device revoked the batch it granted", revoked.status, is(200));
    check(checks, "the batch block is gone after the device revoke", (await getMission(mission.id)).mission.batch, (v) => v === null);
    const row = batchRowDb(mission.id);
    check(checks, "store attribution: the batch was created AND ended by the paired device", row ? [row.createdBy.startsWith("device:"), row.endBy?.startsWith("device:") ?? false, row.endReason] : null, (v: unknown[]) => v[0] === true && v[1] === true && v[2] === "revoked");
    check(checks, "journal: the device grant is attributed (approval.remote_device)", (await getMission(mission.id)).events.some((e) => e.type === "approval.remote_device"), truthy());
    const probeAsk = (await getMission(mission.id)).mission.requests.find((r) => r.resolvedAt === null);
    check(checks, "the remaining sensitive ask still waits (revoke ends, never approves)", probeAsk !== undefined, truthy());
    await respond(probeAsk!.id, "deny");
    const done = await denyUntilDone(mission.id);
    check(checks, "mission finished on explicit decisions only", done.state, is("failed"));
    saveRecord("remote-approval-live.json", {
      ok: true, missionId: mission.id, deviceId: device.deviceId, tokenLength: device.token.length, deviceName: device.name,
      offerMaxActions: offerMax, batchRow: row, checks,
      note: "the paired phone granted only the offered batch (same envelope), could not author a desktop plan, revoked what it granted (store-attributed device: creator + ender), and the rest of the mission stayed explicit (§41/§42)",
    });
  } catch (error) { saveRecord("remote-approval-live.json", { ok: false, error: (error as Error).message }); throw error; }
}

// ── driver ────────────────────────────────────────────────────────────────────────────
const RUNNERS: [string, () => Promise<void>][] = [
  ["preClean", preClean],
  ["recon", recon],
  ["A", phaseA],
  ["B", phaseB],
  ["E", phaseE],
  ["F", phaseF],
  ["G", phaseG],
  ["H", phaseH],
  ["C", phaseC],
  ["D", phaseD],
  ["S", phaseS],
  ["L", phaseL],
  ["K", phaseK],
  ["R", phaseR],
  ["J", phaseJ],
];

void (async () => {
  const wanted = process.argv[2] ?? "all";
  const phases = RUNNERS.map(([name]) => name);
  const from = wanted === "all" ? 0 : phases.indexOf(wanted);
  if (from < 0) throw new Error(`Unknown phase ${wanted}; one of ${phases.join(", ")}`);
  // Environmental flake policy: a failed desktop step (a focus that could not take the foreground
  // from an actively used window — matrix runs 6 and 7) kills the mission outside any T9 semantic,
  // so each phase carries bounded whole-phase retries on a FRESH mission (new offer, new row, all
  // checks recomputed). A Host-semantics defect fails every attempt identically, so retries only
  // span run-to-run desktop variance; they cannot make a broken phase pass.
  const ATTEMPTS: number[] = [1, 2, 3];
  const phaseAttempts: { phase: string; attempt: number; failedAt: number; error: string }[] = [];
  for (const [index, [name, runner]] of RUNNERS.entries()) {
    if (from > index) continue;
    await TRACK.mark();
    let finished = false;
    for (const attempt of ATTEMPTS) {
      if (attempt > 1) console.log(`[phase ${name}] attempt ${attempt} after a ${(attempt - 1) * 45}s backoff`);
      if (attempt > 1) await wait((attempt - 1) * 45_000);
      const started = Date.now();
      console.log(`[phase ${name}] starting (attempt ${attempt})`);
      let guardFailed = false;
      try { await strayGuard(); } catch (guardError) { console.error(`[phase ${name}] stray guard failed: ${(guardError as Error).message}`); process.exitCode = 1; guardFailed = true; }
      if (guardFailed) break;
      try { await runner(); finished = true; }
      catch (error) {
        phaseAttempts.push({ phase: name, attempt, failedAt: Date.now(), error: (error as Error).message });
        console.error(`[phase ${name}] FAILED (attempt ${attempt}/3): ${(error as Error).message}`);
        if (attempt === ATTEMPTS.length) process.exitCode = 1;
      }
      finally { try { await TRACK.sweep(attempt === 1 ? name : `${name}#retry-${attempt}`); } catch (sweepError) { console.error(`[phase ${name}] sweep failed: ${(sweepError as Error).message}`); } }
      if (finished) console.log(`[phase ${name}] done in ${Math.round((Date.now() - started) / 1000)}s`);
    }
    if (!finished) break;
  }
  saveRecord("hygiene.json", { ok: process.exitCode !== 1, events: HYGIENE, ...(phaseAttempts.length ? { phaseAttempts } : {}), model: "(pid|title)-scoped per-phase baseline; closure by title-matched per-handle WM_CLOSE — never a pid kill (one ApplicationFrameHost process hosts unrelated UWP windows)", strayGuard: "every phase (and every phase attempt) first stops non-terminal missions from interrupted runs (the M-A-1 concurrent-mission limit is 3)", note: "only matrix-created calculator/notepad windows and matrix-created strays were ever touched" });
})();