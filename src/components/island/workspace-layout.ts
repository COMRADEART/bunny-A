/**
 * F01/F07 shared workspace allocation (docs/ux/e5a/DEFECTS.md). Pure, so the split, the context inspector, the widget
 * sidebar and later E5C screens all read one contract: the main pane keeps a usable inline width and the optional
 * columns leave the grid into fixed drawers before it is squeezed — never after, and never by hiding content.
 * The drawer geometry itself is the widget drawer's contract made shell-wide (glass.css `.ws-drawer`), with the edge
 * chosen away from the Notch by drawerEdgeFor().
 */
import { useEffect, useState, type RefObject } from "react";

export const WORKSPACE_LAYOUT_KEY = "bunny-a.workspace-layout.v1";
/** The context panel's own key before collapse moved into the shared model; read once for carry-over only. */
const LEGACY_CONTEXT_KEY = "bunny-a.context-panel.v1";

/** The main pane keeps at least this inline width; below it an optional column must leave the grid. */
export const MIN_MAIN_INLINE = 560;
/** Inline width the expanded context inspector takes in the split (glass.css .cx-panel). */
export const CONTEXT_INLINE_WIDTH = 280;
/** Column gap of .workspace-split (var(--s4)). */
export const WORKSPACE_COLUMN_GAP = 16;

export type WorkspaceInputs = {
  /** A widget sidebar column wants a place in the split (saved layout "sidebar"). */
  widgetSidebar: boolean;
  widgetSidebarWidth: number;
  /** The context inspector is expanded (the owner has not collapsed it). */
  contextExpanded: boolean;
};

export type WorkspacePlacements = {
  widgets: "inline" | "drawer" | "absent";
  /** "rail" is the owner's collapsed rail: it never demotes, it is already the collapsed form. */
  context: "inline" | "drawer" | "rail";
  /** Grid columns for .workspace-split[data-cols]: the main pane plus the columns that stay in flow. */
  columns: 1 | 2 | 3;
};

/**
 * Allocation from the actually remaining inline size: the context inspector is the more optional column and leaves
 * first, then the widget sidebar. `availableInline === null` means unmeasured (server render or the first frame);
 * it keeps today's layout so the server and the client agree before the ResizeObserver fires.
 */
export function workspacePlacements(
  inputs: WorkspaceInputs,
  availableInline: number | null,
): WorkspacePlacements {
  if (availableInline === null) return fold(inputs.widgetSidebar ? "inline" : "absent", inputs.contextExpanded ? "inline" : "rail");
  // The main pane size when the given columns stay inline (each inline column also costs one gap).
  const mainAfter = (widgets: boolean, context: boolean) =>
    availableInline
    - (widgets ? inputs.widgetSidebarWidth : 0)
    - (context ? CONTEXT_INLINE_WIDTH : 0)
    - WORKSPACE_COLUMN_GAP * ((widgets ? 1 : 0) + (context ? 1 : 0));
  const widgetsWanted = inputs.widgetSidebar;
  const contextWanted = inputs.contextExpanded;
  if (mainAfter(widgetsWanted, contextWanted) >= MIN_MAIN_INLINE) return fold(widgetsWanted ? "inline" : "absent", contextWanted ? "inline" : "rail");
  if (mainAfter(widgetsWanted, false) >= MIN_MAIN_INLINE) return fold(widgetsWanted ? "inline" : "absent", contextWanted ? "drawer" : "rail");
  return fold(widgetsWanted ? "drawer" : "absent", contextWanted ? "drawer" : "rail");
}

function fold(widgets: WorkspacePlacements["widgets"], context: WorkspacePlacements["context"]): WorkspacePlacements {
  return {
    widgets,
    context,
    columns: (1 + (widgets === "inline" ? 1 : 0) + (context === "inline" || context === "rail" ? 1 : 0)) as WorkspacePlacements["columns"],
  };
}

export type WorkspaceLayoutPref = { contextCollapsed: boolean };
const DEFAULT_LAYOUT: WorkspaceLayoutPref = { contextCollapsed: false };
const LAYOUT_KEYS = new Set(Object.keys(DEFAULT_LAYOUT));

/** Strict: an unknown key or a non-boolean falls back to the whole default rather than half-applying. */
export function parseWorkspaceLayout(input: unknown): WorkspaceLayoutPref {
  if (!input || typeof input !== "object") return { ...DEFAULT_LAYOUT };
  const record = input as Record<string, unknown>;
  for (const key of Object.keys(record)) if (!LAYOUT_KEYS.has(key)) return { ...DEFAULT_LAYOUT };
  if (typeof record.contextCollapsed !== "boolean") return { ...DEFAULT_LAYOUT };
  return { contextCollapsed: record.contextCollapsed };
}

/** Collapsed state is a per-viewer convenience only. Storage can be blocked, so every access is guarded. */
export function readWorkspaceLayout(): WorkspaceLayoutPref {
  if (typeof window === "undefined") return { ...DEFAULT_LAYOUT };
  try {
    const raw = window.localStorage.getItem(WORKSPACE_LAYOUT_KEY);
    if (raw === null) {
      // Carry the old per-component choice over once; the new key then owns the value.
      return parseWorkspaceLayout({ contextCollapsed: window.localStorage.getItem(LEGACY_CONTEXT_KEY) === "collapsed" });
    }
    return parseWorkspaceLayout(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_LAYOUT };
  }
}

export function writeWorkspaceLayout(pref: WorkspaceLayoutPref): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(WORKSPACE_LAYOUT_KEY, JSON.stringify(pref));
  } catch {
    // Storage is unavailable: the choice still works for this visit.
  }
}

/**
 * Shared Escape contract for drawer panels: only from inside the drawer, so Escape in the composer or another
 * dialog belongs to that control — the same guard the widget drawer panel uses.
 */
export function escapeClosesDrawer(event: { key: string; defaultPrevented: boolean }, focusInside: boolean): boolean {
  return event.key === "Escape" && !event.defaultPrevented && focusInside;
}

/** The workspace row's content-box inline size, or null until measured (and on runtimes without ResizeObserver). */
export function useInlineSize(ref: RefObject<HTMLElement | null>): number | null {
  const [size, setSize] = useState<number | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      const inline = entry?.contentBoxSize?.[0]?.inlineSize ?? entry?.contentRect.width ?? null;
      setSize(inline === null ? null : Math.round(inline));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

/** Measures the split and owns the shared collapsed preference the island and the context panel both read. */
export function useWorkspaceLayout(
  splitRef: RefObject<HTMLElement | null>,
  inputs: Omit<WorkspaceInputs, "contextExpanded">,
): { placements: WorkspacePlacements; contextCollapsed: boolean; setContextCollapsed: (collapsed: boolean) => void } {
  const availableInline = useInlineSize(splitRef);
  const [layout, setLayout] = useState<WorkspaceLayoutPref>(readWorkspaceLayout);
  const setContextCollapsed = (collapsed: boolean) => {
    const next = { contextCollapsed: collapsed };
    setLayout(next);
    writeWorkspaceLayout(next);
  };
  return {
    placements: workspacePlacements({ ...inputs, contextExpanded: !layout.contextCollapsed }, availableInline),
    contextCollapsed: layout.contextCollapsed,
    setContextCollapsed,
  };
}