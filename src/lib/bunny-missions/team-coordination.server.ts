import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { MissionManager } from "./manager.server.ts";
import type { CapabilityRequest } from "./capabilities/bus.server.ts";
import type { OrchTask, TaskConstraints } from "../orch/types.ts";
import type { AuthorizationEnvelope, Handoff, Mission, MissionStep, TeamView } from "./types.ts";
import { canonical, within } from "./paths.server.ts";
import { runsLocally } from "../bunny-host/router.ts";
import { isRemoteOllamaTag } from "../orch/exec.server.ts";
import {
  checkRequirements, checkTeamOutput, dataBlock, extractOutput, outputGrammar, plannerPrompt, roleLabel, taskPrompt, teamDrafts,
  TEAM_PLANNER_ID, validateTeamPlan,
  type MissionTeam, type StepTeam, type TeamOffer, type TeamOutputContract, type TeamRole,
} from "./team.ts";

/**
 * M-A-3 T11 — the Team Mission parts of MissionManager, kept in their own module for size. Every function here is
 * called only by MissionManager on its own records; none schedules, routes, grants or executes on its own.
 */

const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
/** Context window loaded for team generations (Ollama num_ctx) and the prompt bound checked against it. */
export const TEAM_CONTEXT_TOKENS = 8192;
const PROMPT_TOKEN_BOUND = 5200;
const estimateTokens = (text: string) => Math.ceil(text.length / 3.2);
const SENSITIVE_NAME = /(^|[\\/])(\.|node_modules$|credentials?|secrets?|id_rsa|id_ed25519|.*\.(?:pem|key|pfx|sqlite|db)$)/i;

/** Test-only fault seeding, constructed in-process by an acceptance harness; unreachable from HTTP, env or config. */
export type TeamFaults = {
  seedOutput?: (input: { missionId: string; stepId: string; kind: StepTeam["kind"]; role: TeamRole; attempt: number; round: number; text: string }) => string | null;
};

export const isTeam = (mission: Pick<Mission, "team">): mission is Mission & { team: MissionTeam } => !!mission.team;
export const planningPhase = (steps: MissionStep[]) => steps.length > 0 && steps.every((step) => step.team?.kind === "plan");
/** Steps that count for completion: not a reserved replica, not superseded by its rework. */
export const liveTeamSteps = (steps: MissionStep[]) => steps.filter((step) => !step.team?.dormant && !step.team?.supersededBy);

// ── owners ─────────────────────────────────────────────────────────────────
export type OwnerRow = { id: string; missionId: string | null; paused: boolean; stopped: boolean; state: string; coordinatorId: string | null; role: string | null };
export function ownerRow(m: MissionManager, agentId: string | null | undefined): OwnerRow | null {
  if (!agentId) return null;
  const row = m.tasks.db.db.prepare("SELECT mission_id,paused,stopped,state,record FROM agents WHERE id=?").get(agentId) as { mission_id: string | null; paused: number; stopped: number; state: string; record: string } | undefined;
  if (!row) return null;
  let team: { coordinatorId?: string | null; role?: string } | undefined;
  try { team = (JSON.parse(row.record) as { team?: { coordinatorId?: string | null; role?: string } }).team; } catch { team = undefined; }
  return { id: agentId, missionId: row.mission_id, paused: !!row.paused, stopped: !!row.stopped, state: row.state, coordinatorId: team?.coordinatorId ?? null, role: team?.role ?? null };
}
/** Why a team step may not be newly admitted now (owner paused, stopped, missing or foreign). Null = admissible. */
export function ownerHold(m: MissionManager, step: MissionStep, includePause = true): string | null {
  if (!step.team) return null;
  if (!step.team.agentId) return "TEAM_OWNER: the step has no owning Agent; the plan must be reviewed again.";
  const owner = ownerRow(m, step.team.agentId);
  if (!owner || owner.missionId !== step.missionId) return "TEAM_OWNER: the owning Agent identity is missing or belongs to another Mission.";
  if (owner.stopped) return `TEAM_OWNER: the ${roleLabel(step.team.role)} Agent was stopped; its work is never admitted again.`;
  if (includePause && owner.paused) return `TEAM_OWNER: the ${roleLabel(step.team.role)} Agent is paused.`;
  return null;
}

// ── offer, prompts and constraints ─────────────────────────────────────────
/** Host-observed candidate files for the planner (names only; privacy-filtered; bounded). */
export function observableFiles(root: string, outputDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string, depth: number) => {
    let entries: string[] = [];
    try { entries = readdirSync(dir).sort(); } catch { return; }
    for (const name of entries) {
      if (out.length >= 40) return;
      const rel = prefix ? `${prefix}/${name}` : name;
      if (SENSITIVE_NAME.test(name) || (!prefix && name.toLowerCase() === outputDir.toLowerCase())) continue;
      let info; try { info = statSync(join(dir, name)); } catch { continue; }
      if (info.isDirectory()) { if (depth < 1) walk(join(dir, name), rel, depth + 1); }
      else if (info.isFile() && info.size <= 64 * 1024 && /\.(csv|tsv|json|md|txt|ya?ml)$/i.test(name)) out.push(rel);
    }
  };
  walk(root, "", 0);
  return out;
}
export function teamOffer(m: MissionManager, mission: Mission & { team: MissionTeam }): TeamOffer {
  return { objective: mission.objective, outputDir: mission.team.outputDir, requirements: mission.team.requirements, files: mission.team.offerFiles,
    git: mission.team.git, limits: mission.team.limits,
    // Completed earlier planner runs are kept in the graph and count against the Host step limit too.
    stepLimit: m.cached.limits.maxSteps - Math.max(0, m.store.steps(mission.id).filter((step) => step.team?.kind === "plan").length - 1) };
}

/** The tool-free, local-only constraints of every team model step; nothing from the planner reaches them. */
export function teamConstraints(step: MissionStep, offer: TeamOffer | null): TaskConstraints {
  const grammar = step.team ? outputGrammar(step.team.kind, offer) : null;
  return {
    missionAccess: "read", localOnly: true, offlineOnly: true, providerAllowlist: ["ollama"],
    requiresFilesystem: false, requiresTerminal: false, requiresGit: false,
    maxRuntimeMs: Math.max(1000, Math.min(step.timeoutMs, 3_600_000)), contextTokens: TEAM_CONTEXT_TOKENS,
    ...(grammar ? { responseFormat: grammar } : {}),
  };
}
/** A neutral routing text: planner prose never steers the router's capability inference. */
export const TEAM_ROUTING_PROMPT = "Tool-free local text generation for a Bunny team task.";

/** Host check of a routed team task: tool-free Ollama, read access, local model, no filesystem need. */
export function teamProviderViolation(m: MissionManager, task: OrchTask): string | null {
  if (!task.mission) return null;
  let step: MissionStep;
  try { step = m.store.step(task.mission.stepId); } catch { return null; }
  if (!step.team) return null;
  const live = m.tasks.live().find((provider) => provider.id === task.provider);
  if (task.provider !== "ollama") return `TEAM_TOOL_FREE: team model work runs only as tool-free Ollama generation; ${task.provider} was refused.`;
  if (task.executionScope?.access !== "read") return "TEAM_TOOL_FREE: team model work has read-only provider-session authority.";
  if (task.constraints?.requiresFilesystem || task.constraints?.requiresTerminal || task.constraints?.requiresGit) return "TEAM_TOOL_FREE: team model work never needs workspace tools.";
  if (!runsLocally(live, task.model) || isRemoteOllamaTag({ name: task.model })) return `TEAM_TOOL_FREE: ${task.model} is not a local model.`;
  const hold = ownerHold(m, step, false);
  return hold;
}

// ── handoffs ───────────────────────────────────────────────────────────────
type Source = { step: MissionStep; artifactId: string; sha256: string; body: string; type: Handoff["artifactType"] };
/** A verified, hash-rechecked artifact of a completed dependency, or the reason it cannot be handed off. */
export function verifiedSource(m: MissionManager, missionId: string, depId: string): Source | { refused: string } {
  let dep: MissionStep;
  try { dep = m.store.step(depId); } catch { return { refused: "unknown dependency" }; }
  if (dep.missionId !== missionId) return { refused: "cross-Mission dependency" };
  // A file delivery hands off the bytes of its verified producer (identical, checked by team_file).
  const producer = dep.team?.kind === "write_file" && dep.team.content ? m.store.step(dep.team.content) : dep;
  for (const item of producer === dep ? [dep] : [dep, producer])
    if (item.state !== "completed" || item.result?.verified !== true) return { refused: `${item.role} output is not Host-verified (state ${item.state})` };
  const ref = producer.result?.outputRef ?? producer.result?.artifactIds[0];
  if (!ref) return { refused: `${producer.role} has no canonical artifact` };
  let record;
  try { record = m.artifacts.get(ref); } catch { return { refused: "artifact unavailable" }; }
  const { artifact, body } = record;
  if (!body) return { refused: "artifact body is not held inline" };
  if (artifact.missionId !== missionId || artifact.stepId !== producer.id) return { refused: "artifact provenance differs from the dependency" };
  if (artifact.verification !== "verified") return { refused: `artifact verification is ${artifact.verification}` };
  if (artifact.sha256.startsWith("not-hashed") || sha(body) !== artifact.sha256) return { refused: "HASH_MISMATCH: artifact bytes no longer match their recorded sha256" };
  return { step: producer, artifactId: artifact.id, sha256: artifact.sha256, body, type: artifact.type };
}
export function recordHandoff(m: MissionManager, mission: Mission, source: { stepId: string; agentId: string | null; artifactId: string; sha256: string; type: Handoff["artifactType"] } | null, destination: MissionStep, purpose: Handoff["purpose"], refused: string | null, sourceStepId: string): Handoff {
  const handoff: Handoff = {
    id: crypto.randomUUID(), missionId: mission.id, sourceAgentId: source?.agentId ?? null, destinationAgentId: destination.team?.agentId ?? null,
    sourceStepId: source?.stepId ?? sourceStepId, destinationStepId: destination.id, destinationAttempt: destination.attempts.length + 1,
    artifactId: source?.artifactId ?? "", artifactSha256: source?.sha256 ?? "", artifactType: source?.type ?? "text", purpose,
    state: refused ? "REFUSED" : "DELIVERED", reason: refused, createdAt: Date.now(),
  };
  m.store.addHandoff(handoff);
  m.emit(refused ? "mission.team.handoff_refused" : "mission.team.handoff", JSON.stringify({ kind: "team-handoff", id: handoff.id, from: handoff.sourceAgentId, to: handoff.destinationAgentId, sourceStepId: handoff.sourceStepId, destinationStepId: destination.id, sha256: handoff.artifactSha256, purpose, ...(refused ? { reason: refused.slice(0, 200) } : {}) }), mission.id);
  return handoff;
}

/**
 * Builds a team model step's prompt from verified handoffs. Returns a refusal (and records it) when any input fails
 * its hash, verification or ownership check, or when the prompt would not fit the loaded context window.
 */
export async function teamPrompt(m: MissionManager, mission: Mission & { team: MissionTeam }, step: MissionStep, envelope: AuthorizationEnvelope): Promise<{ prompt: string } | { refused: string }> {
  const team = step.team!;
  if (team.kind === "plan") {
    const repair = step.attempts.at(-1)?.category === "verification_failed" ? step.attempts.at(-1)!.detail.split("; ").filter(Boolean) : null;
    const offer = teamOffer(m, mission);
    const prompt = plannerPrompt(mission.team.revisionNote ? { ...offer, objective: `${offer.objective}\nUser revision note: ${mission.team.revisionNote}` } : offer, repair);
    return estimateTokens(prompt) > PROMPT_TOKEN_BOUND ? { refused: "CONTEXT_BOUND: the planner prompt exceeds the loaded context window." } : { prompt };
  }
  const data: string[] = [];
  const destinationOwner = ownerRow(m, team.agentId);
  if (!destinationOwner || destinationOwner.stopped) {
    recordHandoff(m, mission, null, step, "context", "destination Agent is stopped or missing", team.inputs[0]?.stepId ?? step.id);
    return { refused: "HANDOFF_REFUSED: the destination Agent is stopped or missing; no handoff restarts stopped work." };
  }
  for (const input of team.inputs) {
    if (input.purpose === "review_subject") {
      const subject = m.store.step(input.stepId);
      const verified = verifiedSource(m, mission.id, input.stepId);
      if ("refused" in verified) { recordHandoff(m, mission, null, step, input.purpose, verified.refused, input.stepId); return { refused: `HANDOFF_REFUSED: ${verified.refused}` }; }
      // The reviewer critiques what is on disk now: a fresh Host observation under the reviewer step's own authority.
      const path = `${mission.team.outputDir}/${subject.team?.target}`;
      const outcome = await m.bus.request({ ...m.capabilityRequest(mission, step, envelope, "filesystem.read", { path }, mission.root), agentId: team.agentId });
      const text = (outcome.result?.output as { text?: string } | null)?.text;
      if (outcome.run?.status !== "succeeded" || typeof text !== "string") {
        recordHandoff(m, mission, null, step, input.purpose, `observation failed: ${outcome.decision.reason}`.slice(0, 300), input.stepId);
        return { refused: `HANDOFF_REFUSED: the review subject could not be observed (${outcome.decision.reason.slice(0, 200)}).` };
      }
      const observed = sha(text);
      const artifact = await m.artifacts.create({ missionId: mission.id, stepId: step.id, type: "source_file", title: `Observed ${subject.team?.target}`, inline: text, mediaType: "text/plain", provenance: `bunny:capability:${outcome.run.id}`, verification: observed === verified.sha256 ? "verified" : "unverified" });
      recordHandoff(m, mission, { stepId: subject.id, agentId: subject.team?.agentId ?? null, artifactId: artifact.id, sha256: observed, type: "source_file" }, step, input.purpose, null, subject.id);
      data.push(dataBlock(`review subject ${subject.team?.target} (${observed === verified.sha256 ? "matches the Host-verified write" : "DIFFERS from the Host-verified write"})`, observed, text, 9000));
      continue;
    }
    const source = verifiedSource(m, mission.id, input.stepId);
    if ("refused" in source) { recordHandoff(m, mission, null, step, input.purpose, source.refused, input.stepId); return { refused: `HANDOFF_REFUSED: ${source.refused}` }; }
    recordHandoff(m, mission, { stepId: source.step.id, agentId: source.step.team?.agentId ?? null, artifactId: source.artifactId, sha256: source.sha256, type: source.type }, step, input.purpose, null, input.stepId);
    m.artifacts.consume(source.artifactId, step.id);
    const label = source.step.team ? `${roleLabel(source.step.team.role)} ${source.step.team.kind}${source.step.team.source && "path" in source.step.team.source ? ` of ${source.step.team.source.path}` : ""}` : source.step.role;
    data.push(dataBlock(label, source.sha256, source.body, 7000));
  }
  const requirements = mission.team.requirements.filter((requirement) => !team.requirements || team.requirements.includes(requirement.id));
  const prompt = taskPrompt({
    role: team.role, kind: team.kind, objective: step.objective, missionObjective: mission.objective, schema: team.schema,
    requirements: team.kind === "generate_markdown" ? requirements.filter((item) => item.target === "markdown") : requirements.filter((item) => item.target === "html"),
    data, repair: step.attempts.at(-1)?.category === "verification_failed" ? step.attempts.at(-1)!.detail : team.repair ?? null,
    reviewerFindings: team.reviewerFindings ?? null, outputDir: mission.team.outputDir,
  });
  return estimateTokens(prompt) > PROMPT_TOKEN_BOUND ? { refused: "CONTEXT_BOUND: verified inputs exceed the loaded context window; the step needs a smaller plan." } : { prompt };
}

/** The canonical content Bunny keeps from a team model reply (plus test-only seeding, recorded as such). */
export function canonicalOutput(m: MissionManager, mission: Mission, step: MissionStep, raw: string): { text: string; seeded: boolean; rawSha256: string } {
  const contract = (step.verification.find((check) => check.kind === "team_output") as { contract: TeamOutputContract } | undefined)?.contract;
  const format = contract?.format === "markdown" ? "markdown" : contract?.format === "html" ? "html" : "json";
  const extracted = extractOutput(format, raw);
  let text = extracted.ok ? extracted.text : raw;
  let seeded = false;
  const seed = m.teamFaults?.seedOutput?.({ missionId: mission.id, stepId: step.id, kind: step.team!.kind, role: step.team!.role, attempt: step.attempts.length, round: step.team!.round, text });
  if (typeof seed === "string" && seed !== text) {
    m.emit("mission.team.seeded", JSON.stringify({ kind: "team-seed", stepId: step.id, role: step.team!.role, attempt: step.attempts.length, canonicalSha256: sha(text), seededSha256: sha(seed), note: "Acceptance-harness fault injection replaced this attempt's canonical output." }), mission.id);
    text = seed; seeded = true;
  }
  return { text, seeded, rawSha256: sha(raw) };
}

// ── Host verification criteria ─────────────────────────────────────────────
export type TeamCheckResult = { ok: boolean; lines: string[]; artifactIds: string[]; ask?: { action: string; risk: string; reason: string; decision: import("./types.ts").PermissionDecision } };
export async function verifyTeamCriterion(m: MissionManager, mission: Mission, step: MissionStep, envelope: AuthorizationEnvelope, check: Extract<import("./types.ts").VerificationCriterion, { kind: "team_output" | "team_file" | "team_requirements" }>, artifactIds: string[]): Promise<TeamCheckResult> {
  if (check.kind === "team_output") {
    const id = artifactIds[0];
    const body = id ? m.artifacts.get(id).body : null;
    if (!body) return { ok: false, lines: ["team output: no canonical artifact"], artifactIds: [] };
    const result = checkTeamOutput(check.contract, body, isTeam(mission) ? teamOffer(m, mission) : undefined);
    return { ok: result.ok, lines: result.ok ? [`team ${check.contract.format} output: passed Host checks`] : result.problems.map((problem) => `team ${check.contract.format} output failed: ${problem}`), artifactIds: [] };
  }
  const outcome = await m.bus.request({ ...m.capabilityRequest(mission, step, envelope, "filesystem.read", { path: check.path }, mission.root), agentId: step.team?.agentId ?? null });
  if (outcome.decision.decision === "ask") return { ok: false, lines: [], artifactIds: [], ask: { action: "filesystem.read", risk: outcome.decision.risk, reason: outcome.decision.reason, decision: outcome.decision } };
  const output = outcome.result?.output as { text?: string; sha256?: string } | null;
  if (outcome.run?.status !== "succeeded" || typeof output?.text !== "string") return { ok: false, lines: [`${check.path}: unreadable (${outcome.run?.summary ?? outcome.decision.reason})`], artifactIds: outcome.artifactIds };
  const actual = sha(output.text);
  if (check.kind === "team_file") {
    const source = verifiedSource(m, mission.id, check.fromStep);
    if ("refused" in source) return { ok: false, lines: [`${check.path}: source not handoff-valid (${source.refused})`], artifactIds: outcome.artifactIds };
    const ok = actual === source.sha256;
    return { ok, lines: [`${check.path} sha256 ${actual.slice(0, 16)} ${ok ? "equals" : "DIFFERS FROM"} the verified source ${source.sha256.slice(0, 16)} (independent disk read)`], artifactIds: outcome.artifactIds };
  }
  if (!isTeam(mission)) return { ok: false, lines: ["requirements check outside a team Mission"], artifactIds: [] };
  const requirements = mission.team.requirements.filter((requirement) => check.requirements.includes(requirement.id));
  let dataset: unknown = null;
  if (check.datasetStep) {
    const source = verifiedSource(m, mission.id, check.datasetStep);
    if ("refused" in source) return { ok: false, lines: [`dataset for requirements is not handoff-valid (${source.refused})`], artifactIds: outcome.artifactIds };
    try { dataset = JSON.parse(source.body); } catch { dataset = null; }
  }
  // The file must still be exactly what the team's verified write produced; a changed file voids that verification.
  const subject = step.team?.subject ? m.store.step(step.team.subject) : null;
  const written = subject ? verifiedSource(m, mission.id, subject.id) : null;
  const lines: string[] = [];
  let ok = true;
  if (written && !("refused" in written) && written.sha256 !== actual) { ok = false; lines.push(`STALE_VERIFICATION: ${check.path} changed after its verified write (now ${actual.slice(0, 16)}, verified ${written.sha256.slice(0, 16)}); the earlier verification no longer applies`); }
  const target = check.path.toLowerCase().endsWith(".md") ? "markdown" : "html";
  const results = checkRequirements(requirements, output.text, target, dataset, null);
  for (const result of results) { ok &&= result.passed; lines.push(`${result.id} ${result.passed ? "passed" : "failed"} — ${result.detail}`); }
  if (!results.length) lines.push("no requirement targets this file; structure only");
  return { ok, lines, artifactIds: outcome.artifactIds };
}

// ── writes ─────────────────────────────────────────────────────────────────
/**
 * The exact write a team write_file step may perform: content from its verified producer, and the pre-image the
 * destination must have (absent, or exactly what this Mission last wrote there). `already` means the destination
 * already holds these exact bytes (a restart after the write landed): nothing is written again.
 */
export function teamWrite(m: MissionManager, mission: Mission & { team: MissionTeam }, step: MissionStep, record = true): { params: Record<string, unknown> } | { conflict: string } | { refused: string } | { already: true } {
  const team = step.team!;
  const source = verifiedSource(m, mission.id, team.content!);
  if ("refused" in source) { if (record) recordHandoff(m, mission, null, step, "content", source.refused, team.content!); return { refused: `HANDOFF_REFUSED: ${source.refused}` }; }
  const relative = `${mission.team.outputDir}/${team.target}`;
  const path = resolve(mission.root, relative);
  if (!within(canonical(join(mission.root, mission.team.outputDir)), canonical(path))) return { conflict: "FILE_CONFLICT: the target escapes the team output folder." };
  const current = existsSync(path) ? (statSync(path).isFile() ? sha(readFileSync(path)) : "not-a-file") : "absent";
  if (current === source.sha256) return { already: true };
  // The last bytes THIS Mission wrote at this path: a completed (possibly superseded) team write of the same target.
  const prior = m.store.steps(mission.id).filter((item) => item.id !== step.id && item.team?.kind === "write_file" && item.team.target === team.target && item.state === "completed" && item.result?.verified === true)
    .map((item) => { const written = verifiedSource(m, mission.id, item.team!.content!); return "refused" in written ? null : written.sha256; });
  const expected = current === "absent" ? "absent" : prior.includes(current) ? current : null;
  if (!expected) return { conflict: `FILE_CONFLICT: ${relative} exists with sha256 ${current.slice(0, 16)}, which this Mission did not write; it is preserved for review.` };
  if (record) {
    recordHandoff(m, mission, { stepId: source.step.id, agentId: source.step.team?.agentId ?? null, artifactId: source.artifactId, sha256: source.sha256, type: source.type }, step, "content", null, source.step.id);
    m.artifacts.consume(source.artifactId, step.id);
  }
  return { params: { path: relative, content: source.body, overwrite: expected !== "absent", expectBeforeSha256: expected } };
}

// ── operation scope (hard deny) ────────────────────────────────────────────
/** The only capability operations a team step's role and Host-built plan entry permit. */
export function teamOperationDeny(m: MissionManager, request: CapabilityRequest): string | null {
  let step: MissionStep;
  try { step = m.store.step(request.stepId!); } catch { return null; }
  if (!step.team) return null;
  const mission = m.store.mission(step.missionId);
  if (!isTeam(mission) || request.missionId !== mission.id) return "TEAM_SCOPE: cross-Mission team operation.";
  const owner = ownerRow(m, step.team.agentId);
  if (!owner || owner.missionId !== mission.id || owner.stopped) return `TEAM_SCOPE: the ${roleLabel(step.team.role)} Agent is stopped or missing; nothing runs for it.`;
  const target = (relative: string) => canonical(resolve(mission.root, relative));
  const path = typeof request.params.path === "string" ? canonical(resolve(request.cwd, request.params.path)) : null;
  const allowed: { action: string; path: string | null }[] = [];
  const kind = step.team.kind;
  if (kind === "observe" && step.executor.kind === "capability") allowed.push({ action: step.executor.action, path: typeof step.executor.params.path === "string" ? target(step.executor.params.path) : null });
  if (kind === "write_file" || kind === "verify_output") { allowed.push({ action: "filesystem.read", path: target(`${mission.team.outputDir}/${step.team.target}`) }); }
  if (kind === "write_file") allowed.push({ action: "filesystem.write", path: target(`${mission.team.outputDir}/${step.team.target}`) });
  if (kind === "review" && step.team.target) allowed.push({ action: "filesystem.read", path: target(`${mission.team.outputDir}/${step.team.target}`) });
  const match = allowed.find((item) => item.action === request.action && (item.path === null ? path === null : path !== null && path.toLowerCase() === item.path.toLowerCase()));
  if (!match) return `TEAM_SCOPE: the ${roleLabel(step.team.role)} Agent's ${kind} task may not run ${request.action}${path ? " on that resource" : ""}; Agent-specific scope is the reviewed plan entry.`;
  if (request.action === "git.log" && JSON.stringify(request.params) !== JSON.stringify({ limit: 15 })) return "TEAM_SCOPE: only the planned bounded Git log is permitted.";
  return null;
}

// ── plan install ───────────────────────────────────────────────────────────
export function teamPlanReference(steps: MissionStep[]): string {
  const material = steps.filter((step) => step.team).map((step) => ({
    id: step.id, role: step.role, objective: step.objective, dependsOn: step.dependsOn, executor: step.executor, scope: step.scope, verification: step.verification,
    requiredCapabilities: step.requiredCapabilities, providerConstraints: step.providerConstraints, maxRetries: step.maxRetries, timeoutMs: step.timeoutMs,
    team: { role: step.team!.role, agentId: step.team!.agentId, kind: step.team!.kind, inputs: step.team!.inputs, target: step.team!.target ?? null, content: step.team!.content ?? null, subject: step.team!.subject ?? null, round: step.team!.round, reworkOf: step.team!.reworkOf ?? null, requirements: step.team!.requirements ?? null },
  }));
  return `team:${sha(JSON.stringify(material))}`;
}

/** After the planner step verified, turn its plan into the reviewed execution graph (never auto-approved). */
export async function installTeamPlan(m: MissionManager, mission: Mission & { team: MissionTeam }, planner: MissionStep): Promise<void> {
  const ref = planner.result?.outputRef ?? planner.result?.artifactIds[0];
  const body = ref ? m.artifacts.get(ref).body : null;
  const offer = teamOffer(m, mission);
  const validation = validateTeamPlan(body ? JSON.parse(body) : null, offer);
  if (!validation.ok) throw new Error(`The verified plan no longer validates: ${validation.errors.join("; ")}`);
  const drafts = teamDrafts(validation.plan, mission.team.outputDir, mission.team.limits.maxReworkRounds, Math.min(2, m.cached.limits.maxRetriesPerStep));
  const agents = m.teamAllocator?.(mission.id, validation.roles);
  if (!agents) throw new Error("No Agent runtime is available to hold the team's identities.");
  for (const draft of drafts) {
    const agentId = agents[draft.team!.role];
    if (!agentId) throw new Error(`No ${draft.team!.role} Agent identity was allocated.`);
    draft.team = { ...draft.team!, agentId };
  }
  const members = validation.roles.map((role) => ({ agentId: agents[role]!, role }));
  const fresh = m.store.mission(mission.id);
  let current = m.setMission(fresh, { state: "waiting_for_user", team: { ...fresh.team!, members: [...fresh.team!.members.filter((member) => member.role === "planner"), ...members], proposal: { artifactId: ref!, sha256: m.artifacts.get(ref!).artifact.sha256, tasks: validation.plan.tasks.length, validatedAt: Date.now() } } },
    "mission.team.plan_proposed", `Planner Agent proposed ${validation.plan.tasks.length} task(s) for ${members.length} member Agent(s); Bunny validated the plan. Estimated ${validation.estimate.modelCalls} model call(s) and ${validation.estimate.writes} file write(s) (ESTIMATED).`);
  // The planning approval ends here: nothing it allowed carries into execution (replan semantics).
  m.revokeForReplan(current.id, "bunny-host", "Team plan installed; the planning approval ended.");
  current = m.setMission(m.store.mission(current.id), { authorizationId: null, planning: { ...current.planning, planner: TEAM_PLANNER_ID } });
  m.plan(current, undefined, { complexity: "complex", rationale: [`Model-backed plan from the Planner Agent, validated by Bunny: ${validation.plan.summary}`, `${members.map((member) => roleLabel(member.role)).join(", ")} Agents; ${drafts.filter((draft) => draft.team?.dormant).length} reserved rework step(s).`], steps: drafts });
}

// ── rework ─────────────────────────────────────────────────────────────────
/** Activates the reviewed dormant replica chain of a verify step after a Host-observed postcondition failure. */
export function activateRework(m: MissionManager, mission: Mission & { team: MissionTeam }, failed: MissionStep, detail: string): boolean {
  const steps = m.store.steps(mission.id);
  const replicaVerify = steps.find((step) => step.team?.reworkOf === failed.id && step.team.dormant && step.state === "pending");
  if (!replicaVerify || mission.team.reworkRounds >= mission.team.limits.maxReworkRounds) return false;
  const replicaWrite = steps.find((step) => step.id === replicaVerify.team!.subject);
  const replicaGenerator = replicaWrite ? steps.find((step) => step.id === replicaWrite.team!.content) : undefined;
  if (!replicaWrite || !replicaGenerator) return false;
  const envelope = mission.authorizationId ? m.store.authorization(mission.authorizationId) : null;
  if (!envelope || envelope.revokedAt || envelope.expiresAt <= Date.now()) return false;
  if ([replicaVerify, replicaWrite, replicaGenerator].some((step) => ownerHold(m, step, false))) return false;
  const originalWrite = failed.team?.subject ? steps.find((step) => step.id === failed.team!.subject) : undefined;
  const originalGenerator = originalWrite?.team?.content ? steps.find((step) => step.id === originalWrite.team!.content) : undefined;
  // Advisory reviewer findings on the failed delivery travel as data with the Host's own failure evidence.
  const findings = steps.filter((step) => step.team?.kind === "review" && step.team.subject === originalWrite?.id && step.state === "completed").map((step) => {
    const id = step.result?.outputRef ?? step.result?.artifactIds[0];
    try { return id ? m.artifacts.get(id).body ?? "" : ""; } catch { return ""; }
  }).filter(Boolean).join("\n").slice(0, 2000) || null;
  const attempts = failed.attempts.map((attempt, index) => index === failed.attempts.length - 1 ? { ...attempt, finishedAt: Date.now(), outcome: "failed" as const, category: "verification_failed" as const, detail: detail.slice(0, 1500) } : attempt);
  m.setStep(failed, { state: "failed", finishedAt: Date.now(), attempts, failure: { category: "verification_failed", detail: detail.slice(0, 2000) }, team: { ...failed.team!, supersededBy: replicaVerify.id } }, "mission.step.failed", `${failed.role} failed Host verification; reviewed rework round ${replicaVerify.team!.round} activated.`);
  for (const original of [originalWrite, originalGenerator]) if (original) m.setStep(original, { team: { ...original.team!, supersededBy: original === originalWrite ? replicaWrite.id : replicaGenerator.id } });
  m.setStep(replicaGenerator, { team: { ...replicaGenerator.team!, dormant: false, repair: `Bunny's independent check of the delivered file failed: ${detail.slice(0, 1200)}`, reviewerFindings: findings } });
  for (const replica of [replicaWrite, replicaVerify]) m.setStep(replica, { team: { ...replica.team!, dormant: false } });
  // Anything that waited on the failed verification now waits on its replica.
  for (const step of steps) if (!step.team?.dormant && step.dependsOn.includes(failed.id) && ["pending", "blocked"].includes(step.state))
    m.setStep(m.store.step(step.id), { ...(step.state === "blocked" ? { state: "pending", failure: null } : {}), dependsOn: step.dependsOn.map((dep) => dep === failed.id ? replicaVerify.id : dep) });
  const current = m.store.mission(mission.id);
  m.setMission(current, { team: { ...current.team!, reworkRounds: current.team!.reworkRounds + 1 } }, "mission.team.rework", JSON.stringify({ kind: "team-rework", round: replicaVerify.team!.round, failedStepId: failed.id, replicas: [replicaGenerator.id, replicaWrite.id, replicaVerify.id], reviewerFindings: !!findings }));
  m.schedule(mission.id);
  return true;
}

// ── per-member stop ────────────────────────────────────────────────────────
/** Stops exactly one member's open work; other Agents' admitted work continues and nothing is reversed. */
export async function stopTeamAgentSteps(m: MissionManager, missionId: string, agentId: string, by: string): Promise<number> {
  const owned = m.store.steps(missionId).filter((step) => step.team?.agentId === agentId && !["completed", "skipped", "stopped", "failed"].includes(step.state));
  for (const step of owned) {
    await m.bus.cancel({ stepId: step.id });
    if (step.taskId) {
      try { const task = m.tasks.db.get(step.taskId); if (task.mission?.stepId === step.id && !["completed", "failed", "stopped"].includes(task.state)) await m.tasks.stop(task.id, `Agent stopped by ${by}.`).catch(() => {}); } catch { /* task already gone */ }
    }
    const current = m.store.step(step.id);
    if (["completed", "skipped", "stopped", "failed"].includes(current.state)) continue;
    const attempts = current.attempts.map((attempt, index) => index === current.attempts.length - 1 && attempt.outcome === "running" ? { ...attempt, finishedAt: Date.now(), outcome: "stopped" as const, category: "user_stopped" as const, detail: `Agent stopped by ${by}` } : attempt);
    m.setStep(current, { state: "stopped", finishedAt: Date.now(), attempts, failure: { category: "user_stopped", detail: `${roleLabel(current.team!.role)} Agent stopped by ${by}.` }, ...(current.approvedOnce ? { approvedOnce: null } : {}) }, "mission.step.stopped", `${current.role} stopped with its Agent.`);
    for (const request of m.store.requests(missionId)) if (request.stepId === step.id && !request.resolvedAt)
      m.store.saveRequest({ ...request, resolvedAt: Date.now(), resolution: "deny", resolvedBy: `${by} (Agent stopped)` });
    m.workspace.release(step.id);
  }
  const steps = m.store.steps(missionId);
  for (const stopped of owned) for (const dependent of steps.filter((step) => step.dependsOn.includes(stopped.id) && ["pending", "ready"].includes(step.state) && !step.team?.dormant))
    m.setStep(m.store.step(dependent.id), { state: "blocked", failure: { category: "dependency_failed", detail: `${stopped.role}'s Agent was stopped.` } }, "mission.step.blocked", `${dependent.role} blocked: its input's Agent was stopped.`);
  m.emit("mission.team.agent_stopped", JSON.stringify({ kind: "team-agent-stop", agentId, steps: owned.length }), missionId);
  m.schedule(missionId);
  return owned.length;
}

// ── projection ─────────────────────────────────────────────────────────────
export function teamView(m: MissionManager, mission: Mission & { team: MissionTeam }, steps: MissionStep[]): TeamView {
  const phase: TeamView["phase"] = ["completed", "failed", "stopped"].includes(mission.state) ? "ended" : planningPhase(steps) ? "planning" : mission.state === "waiting_for_approval" ? "review" : "executing";
  const findings = steps.filter((step) => step.team?.kind === "review" && step.state === "completed").map((step) => {
    let parsed: { verdict?: string; findings?: { requirement?: string | null; severity?: string; summary?: string }[] } = {};
    try { const id = step.result?.outputRef ?? step.result?.artifactIds[0]; parsed = id ? JSON.parse(m.artifacts.get(id).body ?? "{}") : {}; } catch { parsed = {}; }
    const verify = steps.filter((item) => item.team?.kind === "verify_output" && item.team.subject === step.team!.subject && item.result);
    const hostLine = (requirement: string) => verify.flatMap((item) => item.result?.verification ?? []).find((line) => line.startsWith(`${requirement} `)) ?? null;
    return { stepId: step.id, agentId: step.team!.agentId, verdict: parsed.verdict ?? "unknown",
      findings: (parsed.findings ?? []).slice(0, 12).map((finding) => {
        const line = finding.requirement ? hostLine(finding.requirement) : null;
        return { requirement: finding.requirement ?? null, severity: finding.severity ?? "advisory", summary: String(finding.summary ?? "").slice(0, 300), confirmedByHost: line ? / failed /.test(line) : null };
      }) };
  });
  return { coordinatorAgentId: mission.team.coordinatorAgentId, phase, outputDir: mission.team.outputDir, limits: mission.team.limits,
    requirements: mission.team.requirements.map((requirement) => ({ id: requirement.id, text: requirement.text, target: requirement.target })),
    members: mission.team.members, planRevisions: mission.team.planRevisions, reworkRounds: mission.team.reworkRounds, proposal: mission.team.proposal,
    rejected: mission.team.rejected.slice(-5), handoffs: m.store.handoffs(mission.id, 50), findings,
    requirementResults: mission.team.requirements.map((requirement) => {
      // Latest Tester check that covered this requirement and finished (a superseded failure stays visible until its replica runs).
      const checks = steps.filter((step) => step.team?.kind === "verify_output" && (step.team.requirements ?? []).includes(requirement.id) && (step.state === "completed" || step.state === "failed"))
        .sort((a, b) => (b.team!.round - a.team!.round) || ((b.finishedAt ?? 0) - (a.finishedAt ?? 0)));
      const check = checks[0];
      const lines = check ? [...(check.result?.verification ?? []), ...(check.failure?.detail ?? "").split(/;\s*|\n/)] : [];
      const line = lines.find((item) => item.startsWith(`${requirement.id} `)) ?? null;
      // A failed check records only its failing lines; a requirement absent from them passed in that same check.
      const requirementFailures = lines.some((item) => /^R[0-9]{1,2} failed /.test(item));
      const passed = line ? / passed /.test(line) : check?.state === "failed" && requirementFailures ? true : null;
      const detail = line ? line.slice(requirement.id.length + 1, 300) : passed ? "passed in the same check" : null;
      return { id: requirement.id, text: requirement.text, passed, detail, stepId: check?.id ?? null, round: check?.team?.round ?? null };
    }),
    planReference: phase === "review" ? teamPlanReference(steps) : null };
}
export const teamTargetOf = (mission: Mission & { team: MissionTeam }, step: MissionStep) => step.team?.target ? `${mission.team.outputDir}/${step.team.target}` : null;
