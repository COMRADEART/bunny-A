import type { HostDatabase } from "./persistence.server.ts";
import type { SlotId } from "./personal-agents.ts";
import {
  DEFAULT_APPEARANCE, appearanceView, parseAppearance, validateAppearance,
  type CharacterAppearance, type CharacterAppearanceView,
} from "./character-style.ts";

const MIGRATION = "bunny-a.character-appearance.v1";

/**
 * M-A-3 T13.3 Gate H (§25): per-slot character appearance. Kept apart from the revisioned Personal Agent configuration
 * on purpose: a style change is presentation only, so it never bumps that revision, never touches a Mission, an owner,
 * a profile or the conversation identity, and a weapon swap keeps the slot's chosen look.
 */
export class CharacterAppearanceStore {
  private readonly db: HostDatabase;
  constructor(db: HostDatabase) {
    this.db = db;
    db.db.exec("CREATE TABLE IF NOT EXISTS personal_agent_appearance(slot INTEGER PRIMARY KEY,value TEXT NOT NULL,updated_at INTEGER NOT NULL)");
    db.db.prepare("INSERT OR IGNORE INTO migrations(key) VALUES (?)").run(MIGRATION);
  }
  get(slot: SlotId): CharacterAppearance {
    const row = this.db.db.prepare("SELECT value FROM personal_agent_appearance WHERE slot=?").get(slot) as { value: string } | undefined;
    if (!row) return { ...DEFAULT_APPEARANCE };
    try {
      return parseAppearance(JSON.parse(row.value));
    } catch {
      return { ...DEFAULT_APPEARANCE };
    }
  }
  set(slot: SlotId, input: unknown, now: number): CharacterAppearance {
    const next = validateAppearance(input, this.get(slot));
    this.db.db
      .prepare("INSERT INTO personal_agent_appearance(slot,value,updated_at) VALUES(?,?,?) ON CONFLICT(slot) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at")
      .run(slot, JSON.stringify(next), now);
    return next;
  }
  /** Back to the signature appearance: the row is removed, so the slot follows its weapon's signature again. */
  reset(slot: SlotId): CharacterAppearance {
    this.db.db.prepare("DELETE FROM personal_agent_appearance WHERE slot=?").run(slot);
    return { ...DEFAULT_APPEARANCE };
  }
  view(): CharacterAppearanceView {
    return appearanceView((slot) => this.get(slot));
  }
}
