/**
 * M-A-3 T13 Personal Agent Studio, client side. Edits are PRESENTATION only: a name, a description, a weapon, a binding
 * to one of the user's own Agents. Nothing here grants, revokes or changes what an Agent may do, and the Host re-validates
 * every draft on save (personal-agents.ts validatePersonalAgentSlots). This model mirrors those rules so the form can say
 * what is wrong before a round trip. It never reports a save as done: only the Host's acknowledgment does that.
 */
import {
  INTERACTION_STYLES,
  PERSONAL_AGENT_LIMITS,
  RESPONSIBILITIES,
  SLOT_IDS,
  WEAPONS,
  WEAPON_LABEL,
  type InteractionStyle,
  type PersonalAgentSlotConfig,
  type PersonalAgentsSnapshot,
  type Responsibility,
  type SlotId,
  type WeaponId,
} from "../../lib/bunny-host/personal-agents.ts";

export type StudioSlot = PersonalAgentSlotConfig;

/** The editable copy of the Host's four slots, in slot order. Presentation fields only. */
export function draftFromSnapshot(snapshot: Pick<PersonalAgentsSnapshot, "slots">): StudioSlot[] {
  return [...snapshot.slots]
    .map(
      ({ slot, weapon, displayName, description, purpose, style, responsibilities, agentId, active }): StudioSlot => ({
        slot,
        weapon,
        displayName,
        description,
        purpose,
        style,
        responsibilities: [...responsibilities],
        agentId,
        active,
      }),
    )
    .sort((a, b) => a.slot - b.slot);
}

export type StudioField = "displayName" | "description" | "purpose" | "weapon" | "agentId" | "responsibilities" | "slots";
export type StudioFieldError = { slot: SlotId | null; field: StudioField; message: string };

/**
 * Client-side mirror of the Host's rules: four slots once each, each weapon exactly once, text within its limits, tags from
 * the known list, and a binding only to one of the bindable (user-facing) Agents, never twice. An empty name is allowed:
 * the Host names the slot after its weapon.
 */
export function validateDraft(slots: readonly StudioSlot[], bindable: ReadonlySet<string>): StudioFieldError[] {
  const errors: StudioFieldError[] = [];
  if (slots.length !== SLOT_IDS.length) errors.push({ slot: null, field: "slots", message: "Four Personal Agent slots are required." });
  const slotIds = slots.map((slot) => slot.slot);
  if (new Set(slotIds).size !== slotIds.length || slotIds.some((id) => !SLOT_IDS.includes(id))) {
    errors.push({ slot: null, field: "slots", message: "Slots must be 1, 2, 3 and 4, once each." });
  }
  const weapons = slots.map((slot) => slot.weapon);
  if (new Set(weapons).size !== weapons.length || weapons.some((weapon) => !WEAPONS.includes(weapon))) {
    errors.push({ slot: null, field: "weapon", message: "Each of Gada, Spear, Vishnu Chakra and Sword must be used exactly once." });
  }
  const agents = new Set<string>();
  for (const slot of slots) {
    if (slot.displayName.trim().length > PERSONAL_AGENT_LIMITS.displayName)
      errors.push({ slot: slot.slot, field: "displayName", message: `Name is longer than ${PERSONAL_AGENT_LIMITS.displayName} characters.` });
    if (slot.description.trim().length > PERSONAL_AGENT_LIMITS.description)
      errors.push({ slot: slot.slot, field: "description", message: `Description is longer than ${PERSONAL_AGENT_LIMITS.description} characters.` });
    if (slot.purpose.trim().length > PERSONAL_AGENT_LIMITS.purpose)
      errors.push({ slot: slot.slot, field: "purpose", message: `Purpose is longer than ${PERSONAL_AGENT_LIMITS.purpose} characters.` });
    if (slot.responsibilities.some((tag) => !RESPONSIBILITIES.includes(tag)) || slot.responsibilities.length > RESPONSIBILITIES.length)
      errors.push({ slot: slot.slot, field: "responsibilities", message: "Unsupported responsibility." });
    if (slot.agentId !== null) {
      if (!bindable.has(slot.agentId)) errors.push({ slot: slot.slot, field: "agentId", message: "Only your own Agents can fill a slot." });
      if (agents.has(slot.agentId)) errors.push({ slot: slot.slot, field: "agentId", message: "An Agent can fill only one slot." });
      agents.add(slot.agentId);
    }
  }
  return errors;
}

/** Errors that belong to one slot, for inline messages next to its fields. */
export const slotErrors = (errors: readonly StudioFieldError[], slot: SlotId) => errors.filter((error) => error.slot === slot);

/**
 * Gives `weapon` to `slot`. The weapon it held moves to the slot that had it, so the four weapons stay unique and every
 * slot keeps one. The bindings and names are untouched: a weapon is a face, not an assignment.
 */
export function swapWeapon(slots: readonly StudioSlot[], slot: SlotId, weapon: WeaponId): StudioSlot[] {
  const current = slots.find((row) => row.slot === slot);
  if (!current || current.weapon === weapon) return slots.map((row) => ({ ...row }));
  const holder = slots.find((row) => row.weapon === weapon);
  return slots.map((row) => {
    if (row.slot === slot) return { ...row, weapon };
    if (holder && row.slot === holder.slot) return { ...row, weapon: current.weapon };
    return { ...row };
  });
}

/**
 * Binds `agentId` to `slot` (null unassigns). An Agent that already fills another slot is released from it first, so one
 * Agent never appears in two slots. Binding never changes the Agent's authority; it only decides which character stands for it.
 */
export function bindAgent(slots: readonly StudioSlot[], slot: SlotId, agentId: string | null): StudioSlot[] {
  return slots.map((row) => {
    if (row.slot === slot) return { ...row, agentId, active: agentId === null ? row.active : true };
    if (agentId !== null && row.agentId === agentId) return { ...row, agentId: null };
    return { ...row };
  });
}

/** Whether the draft differs from what the Host last confirmed. Compared by content, not identity. */
export function isDirty(draft: readonly StudioSlot[], saved: readonly StudioSlot[]): boolean {
  return JSON.stringify(normalize(draft)) !== JSON.stringify(normalize(saved));
}
const normalize = (slots: readonly StudioSlot[]) =>
  [...slots]
    .sort((a, b) => a.slot - b.slot)
    .map((row) => ({ ...row, responsibilities: [...row.responsibilities].sort() }));

/** The Host's own words for a refused save; a lost acknowledgment is named as unknown, never as failure or success. */
export function saveRefusalText(result: { code: string; message: string; outcome?: "refused" | "unknown" }): string {
  if (result.outcome === "unknown") return "Outcome unknown. Checking the Host before saving again.";
  if (result.code === "HOST_UNREACHABLE" || result.code === "GATEWAY_REFUSED") return "Bunny-A Host is unreachable. Nothing was saved.";
  return result.message || "The Host refused this change. Nothing was saved.";
}

/** The Studio is editable only on the workstation; a paired device reads the same slots and sees why it cannot edit them. */
export function studioMode(viewer: "workstation" | "device" | null): { editable: boolean; caption: string } {
  if (viewer === "device") return { editable: false, caption: "Paired devices can see your Personal Agents here. Changes are made on your Windows PC." };
  return { editable: true, caption: "Names and looks never change what an Agent may do. Permissions stay where they are." };
}

export const WEAPON_OPTIONS: readonly { weapon: WeaponId; label: string }[] = WEAPONS.map((weapon) => ({ weapon, label: WEAPON_LABEL[weapon] }));
export const STYLE_LABEL: Record<InteractionStyle, string> = { concise: "Concise", detailed: "Detailed", conversational: "Conversational" };
export const STYLE_OPTIONS: readonly InteractionStyle[] = INTERACTION_STYLES;
export const RESPONSIBILITY_LABEL: Record<Responsibility, string> = {
  research: "Research",
  coding: "Coding",
  testing: "Testing",
  files: "Files",
  planning: "Planning",
  review: "Review",
  writing: "Writing",
};

/** The execution-authority read-out: what the bound Agent's authorization projection says, nothing invented. */
export type AuthorityFacts = {
  stateLabel: string;
  remainingActions: number | null;
  remainingMinutes: number | null;
  pendingAsks: number;
};
const AUTHORITY_LABEL: Record<string, string> = {
  PROPOSED: "Proposed, not granted",
  WAITING_FOR_USER: "Waiting for your consent",
  ACTIVE: "Active",
  PAUSED: "Paused",
  EXPIRED: "Expired",
  REVOKED: "Revoked",
  EXHAUSTED: "Action budget used up",
  COMPLETED: "Completed",
};
export function authorityFacts(
  authorization: { state: string; remainingActions: number; remainingMs: number; pending: readonly unknown[] } | null | undefined,
): AuthorityFacts | null {
  if (!authorization) return null;
  return {
    stateLabel: AUTHORITY_LABEL[authorization.state] ?? "Status unknown",
    remainingActions: Number.isFinite(authorization.remainingActions) ? authorization.remainingActions : null,
    remainingMinutes: Number.isFinite(authorization.remainingMs) ? Math.max(0, Math.round(authorization.remainingMs / 60_000)) : null,
    pendingAsks: authorization.pending.length,
  };
}

/** Why a bound Agent cannot be scheduled from the Studio. The Host has no scheduler, so this is always the answer. */
export const SCHEDULE_NOTICE = "Not available. The Host does not schedule Agents.";
