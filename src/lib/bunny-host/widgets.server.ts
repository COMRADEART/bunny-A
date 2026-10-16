import type { HostDatabase } from "./persistence.server.ts";
import {
  DEFAULT_WIDGET_PREFERENCE, WIDGET_SCHEMA, parseWidgetPreference, widgetView, validateWidgetPreference,
  type WidgetPreference, type WidgetView,
} from "./widgets.ts";

const MIGRATION = "bunny-a.widgets.v1";

/**
 * The workstation's widget layout. One versioned row, kept apart from execution tables. A layout change never touches
 * a Mission, a Task, an Agent, Lotus memory, routing or an approval. A damaged row reads back as the default layout.
 */
export class WidgetStore {
  private readonly db: HostDatabase;
  constructor(db: HostDatabase) {
    this.db = db;
    db.db.exec("CREATE TABLE IF NOT EXISTS widget_preference(id INTEGER PRIMARY KEY CHECK(id=1),value TEXT NOT NULL,revision INTEGER NOT NULL,updated_at INTEGER NOT NULL)");
    db.db.prepare("INSERT OR IGNORE INTO migrations(key) VALUES (?)").run(MIGRATION);
  }
  private row(): { value: string; revision: number } | undefined {
    return this.db.db.prepare("SELECT value,revision FROM widget_preference WHERE id=1").get() as { value: string; revision: number } | undefined;
  }
  get(): { preference: WidgetPreference; revision: number } {
    const row = this.row();
    if (!row) return { preference: structuredClone(DEFAULT_WIDGET_PREFERENCE), revision: 0 };
    try {
      return { preference: parseWidgetPreference(JSON.parse(row.value)), revision: row.revision };
    } catch {
      return { preference: structuredClone(DEFAULT_WIDGET_PREFERENCE), revision: row.revision };
    }
  }
  set(input: unknown, now: number, expectRevision?: number | null): { preference: WidgetPreference; revision: number } {
    const current = this.get();
    if (expectRevision !== undefined && expectRevision !== null && expectRevision !== current.revision)
      throw new StaleWidgetError(current.revision);
    const preference = validateWidgetPreference(input, current.preference);
    const revision = current.revision + 1;
    this.db.db
      .prepare("INSERT INTO widget_preference(id,value,revision,updated_at) VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value,revision=excluded.revision,updated_at=excluded.updated_at")
      .run(JSON.stringify({ schema: WIDGET_SCHEMA, ...preference }), revision, now);
    return { preference, revision };
  }
  reset(now: number, expectRevision?: number | null): { preference: WidgetPreference; revision: number } {
    const current = this.get().revision;
    if (expectRevision !== undefined && expectRevision !== null && expectRevision !== current) throw new StaleWidgetError(current);
    const revision = current + 1;
    const preference = structuredClone(DEFAULT_WIDGET_PREFERENCE);
    this.db.db
      .prepare("INSERT INTO widget_preference(id,value,revision,updated_at) VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value,revision=excluded.revision,updated_at=excluded.updated_at")
      .run(JSON.stringify({ schema: WIDGET_SCHEMA, ...preference }), revision, now);
    return { preference, revision };
  }
  view(): WidgetView {
    const { preference, revision } = this.get();
    return widgetView(preference, revision);
  }
}

export class StaleWidgetError extends Error {
  readonly current: number;
  constructor(current: number) {
    super(`The widget layout changed since this window loaded it (current revision ${current}). Nothing was changed.`);
    this.current = current;
  }
}
