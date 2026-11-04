import test from "node:test";
import assert from "node:assert/strict";
import {
  CONTEXT_INLINE_WIDTH, MIN_MAIN_INLINE, WORKSPACE_COLUMN_GAP, WORKSPACE_LAYOUT_KEY, escapeClosesDrawer,
  parseWorkspaceLayout, readWorkspaceLayout, writeWorkspaceLayout, workspacePlacements,
} from "./workspace-layout.ts";

/** Widget sidebar (320px) and the expanded context panel (280px) are the F01 evidence combination. */
const SIDEBAR = { widgetSidebar: true, widgetSidebarWidth: 320, contextExpanded: true };

test("E5B allocation: unmeasured keeps today's layout so the server and the client render the same split", () => {
  assert.deepEqual(workspacePlacements(SIDEBAR, null), { widgets: "inline", context: "inline", columns: 3 });
  assert.deepEqual(workspacePlacements({ ...SIDEBAR, contextExpanded: false }, null), { widgets: "inline", context: "rail", columns: 3 });
  assert.deepEqual(workspacePlacements({ ...SIDEBAR, widgetSidebar: false }, null), { widgets: "absent", context: "inline", columns: 2 });
});

test("E5B allocation: at 1181px with saved widget Sidebar and Context expanded, the context inspector leaves first", () => {
  // 1181 viewport - app sidebar 216 - workspace gutters 64 = 901 inline for the row; both columns would leave 269px for main.
  const placements = workspacePlacements(SIDEBAR, 901);
  assert.deepEqual(placements, { widgets: "inline", context: "drawer", columns: 2 });
  // The widget sidebar stays only while the main pane keeps its usable minimum beside it.
  assert.ok(901 - 320 - 16 >= MIN_MAIN_INLINE, "the widget sidebar keeps the main pane usable at this width");
});

test("E5B allocation: at 1280px with both optional columns the main pane is still usable and Settings never shrinks to 50px", () => {
  assert.deepEqual(workspacePlacements(SIDEBAR, 1000), { widgets: "inline", context: "drawer", columns: 2 });
  // Main pane 664px: after content gutters (64) and the Settings nav (210 + 24 gap) the panel keeps ~366px, not 134px.
  const mainpane = 1000 - 320 - 16;
  assert.ok(mainpane >= MIN_MAIN_INLINE);
  assert.ok(mainpane - 64 - 210 - 24 > 300);
});

test("E5B allocation: both columns only stay inline from the exact size that keeps the main pane usable", () => {
  const threshold = MIN_MAIN_INLINE + 320 + CONTEXT_INLINE_WIDTH + 2 * WORKSPACE_COLUMN_GAP;
  assert.deepEqual(workspacePlacements(SIDEBAR, threshold).columns, 3);
  assert.deepEqual(workspacePlacements(SIDEBAR, threshold - 1).context, "drawer");
});

test("E5B allocation: at phone width no optional column stays in the grid", () => {
  assert.deepEqual(workspacePlacements(SIDEBAR, 343), { widgets: "drawer", context: "drawer", columns: 1 });
});

test("E5B allocation: the context inspector alone stays inline until main would drop below the minimum", () => {
  const wide = workspacePlacements({ widgetSidebar: false, widgetSidebarWidth: 320, contextExpanded: true }, 1000);
  assert.deepEqual(wide, { widgets: "absent", context: "inline", columns: 2 });
  const narrow = workspacePlacements({ widgetSidebar: false, widgetSidebarWidth: 320, contextExpanded: true }, 700);
  assert.deepEqual(narrow, { widgets: "absent", context: "drawer", columns: 1 });
});

test("E5B allocation: the collapsed rail never demotes and is always counted in the grid", () => {
  assert.deepEqual(
    workspacePlacements({ widgetSidebar: true, widgetSidebarWidth: 320, contextExpanded: false }, 343),
    { widgets: "drawer", context: "rail", columns: 2 },
  );
  assert.deepEqual(
    workspacePlacements({ widgetSidebar: false, widgetSidebarWidth: 320, contextExpanded: false }, 1200),
    { widgets: "absent", context: "rail", columns: 2 },
  );
});

test("E5B allocation: a narrow saved sidebar is still allocated from its real width", () => {
  const narrowSidebar = workspacePlacements({ ...SIDEBAR, widgetSidebarWidth: 240 }, 1000);
  // 1000 - 240 - 280 - 32 = 448 < 560: the context inspector still leaves first.
  assert.deepEqual(narrowSidebar, { widgets: "inline", context: "drawer", columns: 2 });
});

test("E5B layout pref: strict parse never half-applies a damaged value", () => {
  assert.deepEqual(parseWorkspaceLayout({ contextCollapsed: true }), { contextCollapsed: true });
  assert.deepEqual(parseWorkspaceLayout({ contextCollapsed: false, stray: 1 }), { contextCollapsed: false }, "unknown keys reset the whole pref");
  assert.deepEqual(parseWorkspaceLayout({ contextCollapsed: "collapsed" }), { contextCollapsed: false });
  assert.deepEqual(parseWorkspaceLayout("collapsed"), { contextCollapsed: false });
  assert.deepEqual(parseWorkspaceLayout(null), { contextCollapsed: false });
});

test("E5B layout pref: persistence round-trips through guarded storage", () => {
  withStorage((store) => {
    assert.deepEqual(readWorkspaceLayout(), { contextCollapsed: false });
    writeWorkspaceLayout({ contextCollapsed: true });
    assert.deepEqual(readWorkspaceLayout(), { contextCollapsed: true });
    assert.equal(store.get(WORKSPACE_LAYOUT_KEY), JSON.stringify({ contextCollapsed: true }));
  });
});

test("E5B layout pref: the context panel's own old key is carried over once the shared key is absent", () => {
  withStorage((store) => {
    store.set("bunny-a.context-panel.v1", "collapsed");
    assert.deepEqual(readWorkspaceLayout(), { contextCollapsed: true });
    store.set("bunny-a.context-panel.v1", "expanded");
    assert.deepEqual(readWorkspaceLayout(), { contextCollapsed: false });
    // Once the shared key exists it owns the value and the legacy row no longer wins.
    store.set(WORKSPACE_LAYOUT_KEY, JSON.stringify({ contextCollapsed: false }));
    store.set("bunny-a.context-panel.v1", "collapsed");
    assert.deepEqual(readWorkspaceLayout(), { contextCollapsed: false });
  });
});

test("E5B layout pref: storage that throws leaves the default in place", () => {
  withStorage(() => { /* intact storage */ }, {
    getItem: () => { throw new Error("blocked"); },
    setItem: () => { throw new Error("blocked"); },
  });
  assert.deepEqual(readWorkspaceLayout(), { contextCollapsed: false });
  writeWorkspaceLayout({ contextCollapsed: true });
});

test("E5B drawers: Escape closes only when the focus is inside the drawer and no other handler took it", () => {
  assert.equal(escapeClosesDrawer({ key: "Escape", defaultPrevented: false }, true), true);
  assert.equal(escapeClosesDrawer({ key: "Escape", defaultPrevented: false }, false), false, "focus elsewhere belongs to that control");
  assert.equal(escapeClosesDrawer({ key: "Escape", defaultPrevented: true }, true), false);
  assert.equal(escapeClosesDrawer({ key: "Enter", defaultPrevented: false }, true), false);
});

type Store = { get(key: string): string | null; set(key: string, value: string): void };
function withStorage(run: (store: Store) => void, overrides?: Partial<Storage>): void {
  const map = new Map<string, string>();
  const store: Store = { get: (key) => map.get(key) ?? null, set: (key, value) => void map.set(key, value) };
  const backing = {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
    ...overrides,
  };
  const previous = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = { localStorage: backing };
  try {
    run(store);
  } finally {
    (globalThis as { window?: unknown }).window = previous;
  }
}