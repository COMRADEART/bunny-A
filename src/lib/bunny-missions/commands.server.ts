import type { Mode, ProviderId } from "../orch/types.ts";
import type { MissionManager } from "./manager.server.ts";
import type { GrantPolicy, SkillStep, SkillValidation } from "./types.ts";
import { isAbsolute } from "node:path";
import { statSync } from "node:fs";
import { scopedPath } from "./paths.server.ts";
import { CommandRefusedError } from "../bunny-host/failure.server.ts";

const PROVIDERS: ProviderId[] = ["codex", "claude", "ollama", "opencode", "cline", "cursor"];
const GRANTS: GrantPolicy[] = ["always_allow", "allow_for_mission", "ask_every_time", "read_only", "never_allow"];
function text(value: unknown, max = 8000): string { if (typeof value !== "string" || !value.trim() || value.length > max) throw new CommandRefusedError("Invalid or oversized text."); return value; }
function id(value: unknown): string { const out = text(value, 200); if (!/^[A-Za-z0-9._:-]+$/.test(out)) throw new CommandRefusedError("Invalid id."); return out; }
function object(value: unknown): Record<string, unknown> { if (value === undefined) return {}; if (!value || typeof value !== "object" || Array.isArray(value)) throw new CommandRefusedError("Expected an object."); return value as Record<string, unknown>; }

export const MISSION_ACTIONS = new Set([
  "mission.create", "mission.plan", "mission.replan", "mission.approve", "mission.start", "mission.stop", "mission.retry", "mission.respond", "mission.get", "mission.configure", "mission.revoke_batch",
  "inbox.ack", "capability.run", "capability.grant", "capability.revoke_grant", "capability.refresh",
  "skill.run", "skill.versions", "skill.repair", "skill.verify", "skill.record",
  "trigger.create", "trigger.enable", "trigger.disable", "trigger.delete",
]);
/** What a paired phone may do: create, inspect, answer approvals (once or small batch) and stop. Everything else needs the workstation. */
const REMOTE = new Set(["mission.create", "mission.approve", "mission.start", "mission.stop", "mission.respond", "mission.get", "mission.revoke_batch", "inbox.ack"]);

export async function missionCommand(missions: MissionManager, action: string, data: Record<string, unknown>, access: { local: boolean; actor: string }): Promise<{ mission?: unknown; data?: unknown }> {
  if (!access.local && !REMOTE.has(action)) throw new CommandRefusedError(`${action} requires workstation access.`);
  const roots = () => [...missions.tasks.db.projects().map((project) => project.path), missions.tasks.defaultRoot];
  const direct = (cwd: unknown) => {
    const all = roots();
    const folder = cwd === undefined ? missions.tasks.defaultRoot : text(cwd, 2000);
    if (!isAbsolute(folder) || [...folder].some((char) => char.charCodeAt(0) < 32) || process.platform === "win32" && (/^(\\\\|\/\/)/.test(folder) || /:[^\\/]/.test(folder.slice(2)))) throw new CommandRefusedError("Working directory must be a plain absolute project path.");
    const canonical = scopedPath(missions.tasks.defaultRoot, folder, all);
    if (!statSync(canonical).isDirectory()) throw new CommandRefusedError("Working directory must be an existing approved folder.");
    return { missionId: null, stepId: null, envelope: null, origin: `workstation`, cwd: canonical, roots: all };
  };
  switch (action) {
    case "mission.create": {
      const mode = data.mode;
      if (!["fast", "balanced", "deep"].includes(String(mode))) throw new CommandRefusedError("Unknown mission mode.");
      if (data.steps !== undefined && !access.local) throw new CommandRefusedError("Explicit mission graphs can only be supplied from the workstation.");
      let providers: ProviderId[] | null = null;
      if (data.providers !== undefined) { if (!Array.isArray(data.providers) || data.providers.some((p) => !PROVIDERS.includes(p as ProviderId))) throw new CommandRefusedError("Invalid provider list."); providers = data.providers as ProviderId[]; }
      if (data.localOnly !== undefined && typeof data.localOnly !== "boolean") throw new CommandRefusedError("localOnly must be true or false.");
      return { mission: missions.create({ objective: text(data.objective), title: data.title === undefined ? undefined : text(data.title, 200), mode: mode as Mode, projectId: data.projectId == null ? null : id(data.projectId), steps: data.steps, localOnly: data.localOnly === true, providers, origin: access.actor }) };
    }
    case "mission.plan": case "mission.replan":
      return { mission: await missions.replan(id(data.id), access.actor, data.steps, data.objective === undefined ? undefined : text(data.objective)) };
    case "mission.approve": return { mission: missions.approve(id(data.id), access.actor, data.start !== false) };
    case "mission.start": {
      missions.requireEnabled();
      const mission = missions.mission(id(data.id));
      if (mission.state !== "ready") throw new CommandRefusedError("Only an approved (ready) mission can be started.");
      return { mission: missions.view(missions.start(mission)) };
    }
    case "mission.stop": return { mission: await missions.stop(id(data.id), access.actor) };
    case "mission.retry": return { mission: missions.retry(id(data.id), access.actor) };
    case "mission.respond": {
      if (data.decision !== "allow_once" && data.decision !== "allow_batch" && data.decision !== "deny") throw new CommandRefusedError("Decision must be allow_once, allow_batch or deny.");
      // Only-shrink knobs on the batch button; the manager clamps both to what the offer stated.
      const options: { maxActions?: number; ttlMs?: number } = {};
      for (const [key, min] of [["maxActions", 1] as const, ["ttlMs", 1000] as const]) {
        const value = data[key];
        if (value === undefined) continue;
        const n = Number(value);
        if (!Number.isInteger(n) || n < min) throw new CommandRefusedError(`${key} must be an integer of at least ${min}.`);
        options[key] = n;
      }
      return { mission: await missions.respond(id(data.requestId), data.decision, access.actor, options) };
    }
    case "mission.get": return { data: missions.get(id(data.id)) };
    case "mission.revoke_batch": return { mission: missions.revokeBatch(id(data.missionId), id(data.batchId), access.actor) };
    case "mission.configure": return { data: missions.configure(object(data), access.actor) };
    case "inbox.ack": return { data: missions.inbox.acknowledge(id(data.id)) };
    case "capability.refresh": await missions.bus.refreshHealth(); return { data: missions.bus.list() };
    case "capability.run": {
      missions.requireEnabled();
      const outcome = await missions.bus.request({ ...direct(data.cwd), action: text(data.action, 100), params: object(data.params), direct: { confirmed: data.confirmed === true } });
      return { data: outcome };
    }
    case "capability.grant": {
      const policy = data.policy as GrantPolicy; if (!GRANTS.includes(policy)) throw new CommandRefusedError("Unknown grant policy.");
      const scope = data.scope === undefined ? "global" : text(data.scope, 100); if (scope !== "global" && !/^mission:[0-9a-f-]{36}$/.test(scope)) throw new CommandRefusedError("Scope must be global or mission:<id>.");
      const pattern = text(data.action, 100); if (!/^([a-z]+\.([a-z_]+|\*)|\*)$/.test(pattern)) throw new CommandRefusedError("Grant action must be capability.action, capability.* or *.");
      if (pattern === "*" && (policy === "always_allow" || policy === "allow_for_mission")) throw new CommandRefusedError("A blanket allow for every capability is refused.");
      missions.store.setGrant(pattern, scope, policy, access.actor);
      missions.emit("capability.grant_changed", `${access.actor} set ${pattern} (${scope}) to ${policy}.`, scope.startsWith("mission:") ? scope.slice(8) : null);
      return { data: missions.store.grants() };
    }
    case "capability.revoke_grant": missions.store.clearGrant(text(data.action, 100), data.scope === undefined ? "global" : text(data.scope, 100)); missions.emit("capability.grant_changed", `${access.actor} cleared ${String(data.action)}.`, null); return { data: missions.store.grants() };
    case "skill.run": missions.requireEnabled(); return { data: await missions.skills.run(id(data.id), object(data.params), { ...direct(data.cwd), direct: { confirmed: data.confirmed === true } }) };
    case "skill.versions": return { data: missions.skills.versions(id(data.id)) };
    case "skill.repair": {
      if (!Array.isArray(data.steps)) throw new CommandRefusedError("steps must be an array.");
      const steps = data.steps.map((raw) => { const step = object(raw); return { action: text(step.action, 100), params: object(step.params), label: step.label === undefined ? text(step.action, 100) : text(step.label, 100) } as SkillStep; });
      return { data: missions.skills.proposeRepair(id(data.id), steps, data.validations as SkillValidation[] | undefined) };
    }
    case "skill.verify": missions.requireEnabled(); return { data: await missions.skills.verifyCandidate(id(data.id), Number(data.version), object(data.params), { ...direct(data.cwd), direct: { confirmed: data.confirmed === true } }) };
    case "skill.record": {
      if (!Array.isArray(data.runIds) || data.runIds.some((value) => typeof value !== "string")) throw new CommandRefusedError("runIds must be an array of run ids.");
      return { data: missions.skills.record(id(data.id), text(data.name, 80), data.runIds as string[]) };
    }
    case "trigger.create": return { data: missions.triggers.create(object(data), access.actor) };
    case "trigger.enable": return { data: missions.triggers.setEnabled(id(data.id), true, access.actor) };
    case "trigger.disable": return { data: missions.triggers.setEnabled(id(data.id), false, access.actor) };
    case "trigger.delete": missions.triggers.remove(id(data.id), access.actor); return {};
  }
  throw new CommandRefusedError("Unknown mission action.");
}
