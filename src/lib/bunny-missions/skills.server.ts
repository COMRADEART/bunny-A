import { existsSync } from "node:fs";
import { join } from "node:path";
import type { CapabilityBus, CapabilityRequest } from "./capabilities/bus.server.ts";
import type { MissionStore } from "./store.server.ts";
import type { CapabilityRun, PermissionDecision, Skill, SkillStep, SkillValidation } from "./types.ts";

const builtin = (skill: Omit<Skill, "version" | "provenance" | "status" | "previousVersion" | "reliability" | "createdAt">): Skill => ({ ...skill, version: 1, provenance: "builtin", status: "active", previousVersion: null, reliability: { runs: 0, successes: 0, lastSuccessAt: null, lastFailureAt: null }, createdAt: 0 });
export const BUILTIN_SKILLS: Skill[] = [
  builtin({ id: "project.test", name: "Run project tests", description: "npm test in the project folder; passes only on exit 0.", requirements: ["terminal.exec"], preconditions: [{ kind: "file_exists", path: "package.json" }], parameters: [], steps: [{ action: "terminal.exec", params: { command: "npm", args: ["test"] }, label: "npm test" }], validations: [{ kind: "exit_code", step: 0, equals: 0 }], cleanup: [] }),
  builtin({ id: "project.build", name: "Build project", description: "npm run build in the project folder.", requirements: ["terminal.exec"], preconditions: [{ kind: "file_exists", path: "package.json" }], parameters: [], steps: [{ action: "terminal.exec", params: { command: "npm", args: ["run", "build"] }, label: "npm run build" }], validations: [{ kind: "exit_code", step: 0, equals: 0 }], cleanup: [] }),
  builtin({ id: "project.typecheck", name: "Typecheck project", description: "npm run typecheck in the project folder.", requirements: ["terminal.exec"], preconditions: [{ kind: "file_exists", path: "package.json" }], parameters: [], steps: [{ action: "terminal.exec", params: { command: "npm", args: ["run", "typecheck"] }, label: "npm run typecheck" }], validations: [{ kind: "exit_code", step: 0, equals: 0 }], cleanup: [] }),
  builtin({ id: "project.lint", name: "Lint project", description: "npm run lint in the project folder.", requirements: ["terminal.exec"], preconditions: [{ kind: "file_exists", path: "package.json" }], parameters: [], steps: [{ action: "terminal.exec", params: { command: "npm", args: ["run", "lint"] }, label: "npm run lint" }], validations: [{ kind: "exit_code", step: 0, equals: 0 }], cleanup: [] }),
  builtin({ id: "git.snapshot", name: "Git snapshot", description: "Branch, status and diff of the working tree.", requirements: ["git.status", "git.diff"], preconditions: [{ kind: "git_repository" }], parameters: [], steps: [{ action: "git.status", params: {}, label: "git status" }, { action: "git.diff", params: {}, label: "git diff" }], validations: [{ kind: "status_succeeded", step: 0 }, { kind: "status_succeeded", step: 1 }], cleanup: [] }),
  builtin({ id: "git.worktree", name: "Create git worktree", description: "Isolated worktree on a new bunny/* branch under the Host data folder.", requirements: ["git.worktree_add"], preconditions: [{ kind: "git_repository" }], parameters: [{ name: "name", type: "string", required: true, description: "Worktree name." }], steps: [{ action: "git.worktree_add", params: { name: "${name}" }, label: "git worktree add" }], validations: [{ kind: "status_succeeded", step: 0 }], cleanup: [] }),
  builtin({ id: "screen.capture", name: "Capture screen", description: "Whole-screen PNG through the Computer Runtime.", requirements: ["computer.capture"], preconditions: [{ kind: "capability_available", action: "computer.capture" }], parameters: [], steps: [{ action: "computer.capture", params: {}, label: "capture screen" }], validations: [{ kind: "status_succeeded", step: 0 }], cleanup: [] }),
  builtin({ id: "web.capture_page", name: "Capture web page", description: "Open a public URL in the Bunny browser, read it and screenshot it.", requirements: ["browser.navigate", "browser.read", "browser.screenshot"], preconditions: [{ kind: "capability_available", action: "browser.navigate" }], parameters: [{ name: "url", type: "string", required: true, description: "Public URL." }], steps: [{ action: "browser.navigate", params: { url: "${url}" }, label: "open" }, { action: "browser.read", params: {}, label: "read" }, { action: "browser.screenshot", params: { fullPage: false }, label: "screenshot" }], validations: [{ kind: "status_succeeded", step: 0 }, { kind: "status_succeeded", step: 2 }], cleanup: [] }),
  builtin({ id: "web.download", name: "Download artifact", description: "Download a public file into the Host artifacts folder.", requirements: ["browser.download"], preconditions: [{ kind: "capability_available", action: "browser.download" }], parameters: [{ name: "url", type: "string", required: true, description: "File URL." }], steps: [{ action: "browser.download", params: { url: "${url}" }, label: "download" }], validations: [{ kind: "status_succeeded", step: 0 }], cleanup: [] }),
  builtin({ id: "archive.extract", name: "Extract archive", description: "tar -xf an archive into a folder inside the project.", requirements: ["terminal.exec"], preconditions: [], parameters: [{ name: "archive", type: "string", required: true, description: "Archive path." }, { name: "destination", type: "string", required: true, description: "Destination folder (must exist)." }], steps: [{ action: "terminal.exec", params: { command: "tar", args: ["-xf", "${archive}", "-C", "${destination}"] }, label: "tar -xf" }], validations: [{ kind: "exit_code", step: 0, equals: 0 }], cleanup: [] }),
  builtin({ id: "app.open", name: "Open application", description: "Start an allowlisted desktop application.", requirements: ["computer.open_app"], preconditions: [{ kind: "capability_available", action: "computer.open_app" }], parameters: [{ name: "app", type: "string", required: true, description: "notepad, calculator, paint, explorer or terminal." }], steps: [{ action: "computer.open_app", params: { app: "${app}" }, label: "open app" }], validations: [{ kind: "status_succeeded", step: 0 }], cleanup: [] }),
  builtin({ id: "project.open", name: "Open project folder", description: "Open the project folder in File Explorer.", requirements: ["computer.open_app"], preconditions: [{ kind: "capability_available", action: "computer.open_app" }], parameters: [], steps: [{ action: "computer.open_app", params: { app: "explorer", target: "." }, label: "open folder" }], validations: [{ kind: "status_succeeded", step: 0 }], cleanup: [] }),
];

/** ${name} placeholders in string params (and string arrays) are filled from the skill's parameters. */
export function fill(value: unknown, params: Record<string, string | number>): unknown {
  if (typeof value === "string") return value.replace(/\$\{(\w+)\}/g, (_, key: string) => { if (!(key in params)) throw new Error(`Missing skill parameter ${key}.`); return String(params[key]); });
  if (Array.isArray(value)) return value.map((item) => fill(item, params));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, fill(item, params)]));
  return value;
}
function validationPassed(validation: SkillValidation, runs: (CapabilityRun | null)[], outputs: unknown[]): boolean {
  const run = runs[validation.step];
  if (!run) return false;
  if (validation.kind === "status_succeeded") return run.status === "succeeded";
  const output = outputs[validation.step] as { exitCode?: number; stdout?: string } | null;
  if (validation.kind === "exit_code") return output?.exitCode === validation.equals;
  return typeof output?.stdout === "string" && output.stdout.includes(validation.text);
}

export type SkillRunResult = {
  ok: boolean; skill: string; version: number; runs: CapabilityRun[]; outputs: unknown[]; artifactIds: string[];
  failure: { step: number; label: string; status: string; summary: string } | null;
  /** Set when the skill reached a step that needs the user's permission; nothing after it ran. */
  permission: ({ step: number; action: string; reason: string } & Partial<Pick<PermissionDecision, "risk" | "desktopRequired" | "desktopOperation" | "remoteReview">>) | null;
  repairNeeded: boolean;
  /** T13.3 N-C: the cleanup actions a failing run executed; they count toward whether a retry could repeat a change. */
  cleanupRuns?: CapabilityRun[];
};

/**
 * Reusable deterministic workflows. A skill runs semantic capability actions through the bus (the
 * same permission decisions as anything else). A failing skill stops, records the failure and asks for
 * repair; a repaired version is saved as a candidate and becomes active only after a verified run.
 */
export class SkillLibrary {
  store: MissionStore; bus: CapabilityBus; emit: (type: string, detail: string, missionId: string | null) => void;
  constructor(store: MissionStore, bus: CapabilityBus, emit: (type: string, detail: string, missionId: string | null) => void) {
    this.store = store; this.bus = bus; this.emit = emit;
    for (const skill of BUILTIN_SKILLS) if (!this.store.skill(skill.id)) this.store.saveSkill({ ...skill, createdAt: Date.now() }, true);
  }
  list() { return this.store.activeSkills(); }
  get(id: string) { const skill = this.store.skill(id); if (!skill) throw new Error(`Unknown skill ${id}.`); return skill; }
  versions(id: string) { return this.store.skillVersions(id); }
  params(skill: Skill, input: Record<string, unknown>): Record<string, string | number> {
    const out: Record<string, string | number> = {};
    for (const parameter of skill.parameters) {
      const value = input[parameter.name] ?? parameter.default;
      if (value === undefined) { if (parameter.required) throw new Error(`Skill ${skill.id} needs parameter ${parameter.name}.`); continue; }
      if (parameter.type === "number" ? typeof value !== "number" : typeof value !== "string") throw new Error(`Skill parameter ${parameter.name} must be a ${parameter.type}.`);
      out[parameter.name] = value as string | number;
    }
    return out;
  }
  preconditions(skill: Skill, cwd: string): string | null {
    for (const condition of skill.preconditions) {
      if (condition.kind === "file_exists" && !existsSync(join(cwd, condition.path))) return `${condition.path} not found in ${cwd}.`;
      if (condition.kind === "git_repository" && !existsSync(join(cwd, ".git"))) return `${cwd} is not the root of a git repository.`;
      if (condition.kind === "capability_available" && !["available", "degraded"].includes(this.bus.availability(condition.action))) return `${condition.action} is ${this.bus.availability(condition.action)}.`;
    }
    return null;
  }
  /** Runs the active (or a given) version. `request` supplies the mission context for every action. */
  async run(id: string, input: Record<string, unknown>, request: Omit<CapabilityRequest, "action" | "params">, version?: number): Promise<SkillRunResult> {
    const skill = version ? this.store.skill(id, version) : this.store.skill(id);
    if (!skill) throw new Error(`Unknown skill ${id}${version ? ` v${version}` : ""}.`);
    if (!version && skill.status !== "active") throw new Error(`Skill ${id} v${skill.version} is an unverified candidate; verify it before use.`);
    const base: SkillRunResult = { ok: false, skill: id, version: skill.version, runs: [], outputs: [], artifactIds: [], failure: null, permission: null, repairNeeded: false };
    const blocked = this.preconditions(skill, request.cwd);
    if (blocked) { this.emit("skill.failed", `${id} v${skill.version} precondition: ${blocked}`, request.missionId); return { ...base, failure: { step: -1, label: "preconditions", status: "failed", summary: blocked } }; }
    const params = this.params(skill, input);
    const runs: (CapabilityRun | null)[] = []; const outputs: unknown[] = []; const artifactIds: string[] = [];
    // T13.3 N-C: every step's permission is settled before any step runs, so the re-run an approved ask causes never
    // repeats a write that already landed.
    for (const [index, step] of skill.steps.entries()) {
      const ask = this.bus.preflight({ ...request, action: step.action, params: fill(step.params, params) as Record<string, unknown> });
      if (ask) return { ...base, runs: [], outputs, artifactIds, permission: { step: index, action: step.action, reason: ask.reason, risk: ask.risk, desktopRequired: ask.desktopRequired, desktopOperation: ask.desktopOperation, remoteReview: ask.remoteReview } };
    }
    for (const [index, step] of skill.steps.entries()) {
      const outcome = await this.bus.request({ ...request, action: step.action, params: fill(step.params, params) as Record<string, unknown> });
      if (outcome.decision.decision === "ask") return { ...base, runs: runs.filter(Boolean) as CapabilityRun[], outputs, artifactIds, permission: { step: index, action: step.action, reason: outcome.decision.reason, risk: outcome.decision.risk, desktopRequired: outcome.decision.desktopRequired, desktopOperation: outcome.decision.desktopOperation, remoteReview: outcome.decision.remoteReview } };
      runs.push(outcome.run); outputs.push(outcome.result?.output ?? null); artifactIds.push(...outcome.artifactIds);
      if (!outcome.run || outcome.run.status !== "succeeded") {
        // Unsafe continuation stops here: later steps assumed this one worked.
        const failure = { step: index, label: step.label, status: outcome.run?.status ?? "failed", summary: outcome.run?.summary ?? "No run recorded." };
        const cleanupRuns: CapabilityRun[] = [];
        for (const cleanup of skill.cleanup) { const done = await this.bus.request({ ...request, action: cleanup.action, params: fill(cleanup.params, params) as Record<string, unknown> }).catch(() => null); if (done?.run) cleanupRuns.push(done.run); }
        this.recordOutcome(skill, false);
        const environmental = ["denied", "unavailable", "unconfigured", "unsupported"].includes(failure.status);
        this.emit("skill.failed", `${id} v${skill.version} stopped at step ${index + 1} (${step.label}): ${failure.summary}${environmental ? "" : " Repair candidate needed; the last-known-good version is unchanged."}`, request.missionId);
        return { ...base, runs: runs as CapabilityRun[], outputs, artifactIds, failure, repairNeeded: !environmental, cleanupRuns };
      }
    }
    const passed = skill.validations.every((validation) => validationPassed(validation, runs, outputs));
    this.recordOutcome(skill, passed);
    this.emit(passed ? "skill.executed" : "skill.failed", `${id} v${skill.version} ${passed ? "passed its validations" : "ran but failed its validations"}.`, request.missionId);
    return { ...base, ok: passed, runs: runs as CapabilityRun[], outputs, artifactIds, failure: passed ? null : { step: skill.steps.length - 1, label: "validations", status: "failed", summary: "Validations failed." }, repairNeeded: !passed };
  }
  recordOutcome(skill: Skill, success: boolean) {
    const current = this.store.skill(skill.id, skill.version) ?? skill;
    const reliability = { ...current.reliability, runs: current.reliability.runs + 1, successes: current.reliability.successes + (success ? 1 : 0), ...(success ? { lastSuccessAt: Date.now() } : { lastFailureAt: Date.now() }) };
    this.store.saveSkill({ ...current, reliability }, false);
  }
  /** A repaired workflow is stored as a new candidate version; the active version is not touched. */
  proposeRepair(id: string, steps: SkillStep[], validations?: SkillValidation[]): Skill {
    const active = this.get(id);
    if (!steps.length || steps.length > 20) throw new Error("A repaired skill needs 1–20 steps.");
    for (const step of steps) if (!this.bus.find(step.action)) throw new Error(`Unknown capability action ${step.action}.`);
    const latest = Math.max(...this.store.skillVersions(id).map((skill) => skill.version));
    const candidate: Skill = { ...active, version: latest + 1, steps, validations: validations ?? active.validations, provenance: "repaired", status: "candidate", previousVersion: active.version, reliability: { runs: 0, successes: 0, lastSuccessAt: null, lastFailureAt: null }, createdAt: Date.now() };
    this.store.saveSkill(candidate, false);
    this.emit("skill.candidate", `${id} v${candidate.version} saved as a candidate (active stays v${active.version}).`, null);
    return candidate;
  }
  /** Runs a candidate; only a run that passes every validation promotes it. */
  async verifyCandidate(id: string, version: number, input: Record<string, unknown>, request: Omit<CapabilityRequest, "action" | "params">): Promise<{ promoted: boolean; result: SkillRunResult }> {
    const candidate = this.store.skill(id, version);
    if (!candidate || candidate.status !== "candidate") throw new Error(`${id} v${version} is not a candidate.`);
    const result = await this.run(id, input, request, version);
    if (!result.ok) return { promoted: false, result };
    const previous = this.store.skill(id)!;
    if (previous.version !== version) this.store.saveSkill({ ...previous, status: "retired" }, false);
    this.store.saveSkill({ ...this.store.skill(id, version)!, status: "active" }, true);
    this.emit("skill.promoted", `${id} v${version} verified and promoted${previous.version !== version ? `; v${previous.version} retained as history` : ""}.`, request.missionId);
    return { promoted: true, result };
  }
  /** Record/replay over semantic actions: builds a candidate skill from successful capability runs. */
  record(id: string, name: string, runIds: string[]): Skill {
    if (!/^[a-z][a-z0-9._-]{2,40}$/.test(id)) throw new Error("Skill id must be lowercase and short.");
    if (this.store.skill(id)) throw new Error(`Skill ${id} already exists; propose a repair instead.`);
    const runs = runIds.map((runId) => this.store.run(runId));
    if (!runs.length || runs.length > 20) throw new Error("Record 1–20 capability runs.");
    if (runs.some((run) => run.status !== "succeeded")) throw new Error("Only successful runs can be recorded.");
    if (runs.some((run) => Object.values(run.params).some((value) => typeof value === "string" && /^\[(redacted|\d+ characters)\]$/.test(value)))) throw new Error("Runs with redacted or private parameters cannot be replayed.");
    const skill: Skill = { id, version: 1, name: name.slice(0, 80), description: `Recorded from ${runs.length} capability run(s).`, requirements: [...new Set(runs.map((run) => run.action))], preconditions: [], parameters: [], steps: runs.map((run) => ({ action: run.action, params: run.params, label: run.action })), validations: runs.map((_, step) => ({ kind: "status_succeeded" as const, step })), cleanup: [], provenance: "recorded", status: "candidate", previousVersion: null, reliability: { runs: 0, successes: 0, lastSuccessAt: null, lastFailureAt: null }, createdAt: Date.now() };
    this.store.saveSkill(skill, true);
    this.emit("skill.candidate", `${id} v1 recorded from ${runs.length} run(s); it stays a candidate until a verified run.`, null);
    return skill;
  }
}
