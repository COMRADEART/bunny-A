import type { HostDatabase } from "./persistence.server.ts";
import {
  DEFAULT_UI_PREFERENCE, UI_THEME_SCHEMA, parseUiPreference, uiThemeView, validateUiPreference,
  type UiThemePreference, type UiThemeView,
} from "./ui-theme.ts";

const MIGRATION = "bunny-a.ui-theme.v1";

/**
 * Visual Experience 2.0: the workstation's UI theme preference. One versioned row, kept apart from every execution table:
 * a theme change never touches a Mission, a Task, an Agent, a Personal Agent profile, Lotus memory, routing, consent or
 * any approval, and nothing here is read by an authorization path. A damaged or foreign-schema row reads back as the
 * system default (Glassmorphism) instead of failing the Host.
 */
export class UiThemeStore {
  private readonly db: HostDatabase;
  constructor(db: HostDatabase) {
    this.db = db;
    db.db.exec("CREATE TABLE IF NOT EXISTS ui_theme_preference(id INTEGER PRIMARY KEY CHECK(id=1),value TEXT NOT NULL,revision INTEGER NOT NULL,updated_at INTEGER NOT NULL)");
    db.db.prepare("INSERT OR IGNORE INTO migrations(key) VALUES (?)").run(MIGRATION);
  }
  private row(): { value: string; revision: number } | undefined {
    return this.db.db.prepare("SELECT value,revision FROM ui_theme_preference WHERE id=1").get() as { value: string; revision: number } | undefined;
  }
  get(): { preference: UiThemePreference; revision: number } {
    const row = this.row();
    if (!row) return { preference: { ...DEFAULT_UI_PREFERENCE }, revision: 0 };
    try {
      return { preference: parseUiPreference(JSON.parse(row.value)), revision: row.revision };
    } catch {
      return { preference: { ...DEFAULT_UI_PREFERENCE }, revision: row.revision };
    }
  }
  /** Strict merge of a partial preference. `expectRevision` refuses a stale write instead of overwriting a newer choice. */
  set(input: unknown, now: number, expectRevision?: number | null): { preference: UiThemePreference; revision: number } {
    const current = this.get();
    if (expectRevision !== undefined && expectRevision !== null && expectRevision !== current.revision)
      throw new StaleThemeError(current.revision);
    const preference = validateUiPreference(input, current.preference);
    const revision = current.revision + 1;
    this.db.db
      .prepare("INSERT INTO ui_theme_preference(id,value,revision,updated_at) VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value,revision=excluded.revision,updated_at=excluded.updated_at")
      .run(JSON.stringify({ schema: UI_THEME_SCHEMA, ...preference }), revision, now);
    return { preference, revision };
  }
  /** Back to the system default: glass, following Windows light/dark, which also hands the native Notch back its own
   *  appearance setting. The revision still advances so every open window notices. */
  reset(now: number, expectRevision?: number | null): { preference: UiThemePreference; revision: number } {
    const current = this.get().revision;
    if (expectRevision !== undefined && expectRevision !== null && expectRevision !== current) throw new StaleThemeError(current);
    const revision = current + 1;
    const preference: UiThemePreference = { ...DEFAULT_UI_PREFERENCE, variant: "system" };
    this.db.db
      .prepare("INSERT INTO ui_theme_preference(id,value,revision,updated_at) VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value,revision=excluded.revision,updated_at=excluded.updated_at")
      .run(JSON.stringify({ schema: UI_THEME_SCHEMA, ...preference }), revision, now);
    return { preference, revision };
  }
  view(): UiThemeView {
    const { preference, revision } = this.get();
    return uiThemeView(preference, revision);
  }
}

export class StaleThemeError extends Error {
  readonly current: number;
  constructor(current: number) {
    super(`The theme changed since this window loaded it (current revision ${current}). Nothing was changed.`);
    this.current = current;
  }
}
