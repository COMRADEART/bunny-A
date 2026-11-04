/**
 * F01/F07 shared workspace allocation (docs/ux/e5a/DEFECTS.md). Pure, so the split, the context inspector, the widget
 * sidebar and later E5C screens all read one contract: the main pane keeps a usable inline width and the optional
 * columns leave the grid into fixed drawers before it is squeezed — never after, and never by hiding content.
 * The drawer geometry itself is the widget drawer's contract made shell-wide (glass.css `.ws-drawer`), with the edge
 * chosen away from the Notch by drawerEdgeFor().
 *
 * E5D: on the phone profile (phoneViewportProfile) a fixed drawer would be a sheet over nearly the whole screen —
 * the model hands the phone the "dock": collapsed by default as the rail, and when the owner explicitly expands,
 * a section in the split's own flow (glass.css phone band), never an overlay.
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
  /** True on the phone/touch profile: the context inspector presents as the collapsible in-flow dock. */
  phone?: boolean;
};

export type WorkspacePlacements = {
  widgets: "inline" | "drawer" | "absent";
  /** "rail" is the owner's collapsed rail: it never demotes, it is already the collapsed form.
      "dock" is the phone dock: collapsed by default (the rail), expanded it is a section in the split's flow. */
  context: "inline" | "drawer" | "rail" | "dock";
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
  const placements = allocate(inputs.widgetSidebar, inputs.contextExpanded, availableInline, inputs.widgetSidebarWidth);
  // E5D: on the phone profile the context is never an inline column and never a fixed drawer — the dock (collapsed by
  // default; expanded it is a section in the split's flow, glass.css phone band) replaces both, and it holds no column.
  if (inputs.phone === true && (placements.context === "inline" || placements.context === "drawer")) {
    return { ...placements, context: "dock", columns: (1 + (placements.widgets === "inline" ? 1 : 0)) as WorkspacePlacements["columns"] };
  }
  return placements;
}

function allocate(
  widgets: boolean,
  context: boolean,
  availableInline: number | null,
  widgetSidebarWidth: number,
): WorkspacePlacements {
  if (availableInline === null) return fold(widgets ? "inline" : "absent", context ? "inline" : "rail");
  // The main pane size when the given columns stay inline (each inline column also costs one gap).
  const mainAfter = (inlineWidgets: boolean, inlineContext: boolean) =>
    availableInline
    - (inlineWidgets ? widgetSidebarWidth : 0)
    - (inlineContext ? CONTEXT_INLINE_WIDTH : 0)
    - WORKSPACE_COLUMN_GAP * ((inlineWidgets ? 1 : 0) + (inlineContext ? 1 : 0));
  const widgetsWanted = widgets;
  const contextWanted = context;
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

export type WorkspaceLayoutPref = { contextCollapsed: boolean; contextTouched: boolean };
const DEFAULT_LAYOUT: WorkspaceLayoutPref = { contextCollapsed: false, contextTouched: false };
const LAYOUT_KEYS = new Set(Object.keys(DEFAULT_LAYOUT));

/**
 * E5D: on the phone profile the context dock starts collapsed unless the owner has ever explicitly toggled it —
 * the shipped desktop default (expanded) must not open a sheet over the phone workspace. An explicit choice wins
 * on every profile, so this is derived, never written back.
 */
export function initialLayoutPref(pref: WorkspaceLayoutPref, phone: boolean): WorkspaceLayoutPref {
  return phone && !pref.contextTouched && !pref.contextCollapsed ? { ...pref, contextCollapsed: true } : pref;
}

/** The phone/touch profile the CSS bands and this hook share: narrow phones and landscape phones (premium.css bands). */
export const PHONE_PROFILE_QUERY = "(max-width: 767px), (max-height: 500px) and (min-width: 768px)";

/** Strict: an unknown key or a present-but-non-boolean falls back to the whole default rather than half-applying. */
export function parseWorkspaceLayout(input: unknown): WorkspaceLayoutPref {
  if (!input || typeof input !== "object") return { ...DEFAULT_LAYOUT };
  const record = input as Record<string, unknown>;
  for (const key of Object.keys(record)) if (!LAYOUT_KEYS.has(key)) return { ...DEFAULT_LAYOUT };
  // A missing key takes its default (writers before the touched field stored only contextCollapsed).
  if (record.contextCollapsed !== undefined && typeof record.contextCollapsed !== "boolean") return { ...DEFAULT_LAYOUT };
  if (record.contextTouched !== undefined && typeof record.contextTouched !== "boolean") return { ...DEFAULT_LAYOUT };
  return {
    contextCollapsed: record.contextCollapsed ?? DEFAULT_LAYOUT.contextCollapsed,
    contextTouched: record.contextTouched ?? DEFAULT_LAYOUT.contextTouched,
  };
}

/** Collapsed state is a per-viewer convenience only. Storage can be blocked, so every access is guarded. */
export function readWorkspaceLayout(): WorkspaceLayoutPref {
  if (typeof window === "undefined") return { ...DEFAULT_LAYOUT };
  try {
    const raw = window.localStorage.getItem(WORKSPACE_LAYOUT_KEY);
    if (raw === null) {
      // Carry the old per-component choice over once; the new key then owns the value. The legacy value was an
      // explicit choice, so an owner who stored one keeps it as the phone dock's default too.
      const legacy = window.localStorage.getItem(LEGACY_CONTEXT_KEY);
      const carried = parseWorkspaceLayout({ contextCollapsed: legacy === "collapsed" });
      return legacy === null ? carried : { ...carried, contextTouched: true };
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

/**
 * The phone/touch profile, re-evaluated when the viewer rotates or resizes across the band. The server render and
 * the first client render stay on the desktop default (no window, no profile): every phone-derived value applies in
 * a post-hydration pass, like the measured inline size, so hydration never sees a server/client disagreement.
 */
function usePhoneProfile(): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(PHONE_PROFILE_QUERY);
    const update = () => setPhone(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return phone;
}

/** Measures the split and owns the shared collapsed preference the island and the context panel both read. */
export function useWorkspaceLayout(
  splitRef: RefObject<HTMLElement | null>,
  inputs: Omit<WorkspaceInputs, "contextExpanded">,
): { placements: WorkspacePlacements; contextCollapsed: boolean; setContextCollapsed: (collapsed: boolean) => void } {
  const availableInline = useInlineSize(splitRef);
  const [stored, setStored] = useState<WorkspaceLayoutPref>(readWorkspaceLayout);
  const phone = usePhoneProfile();
  const layout = initialLayoutPref(stored, phone);
  const setContextCollapsed = (collapsed: boolean) => {
    const next = { contextCollapsed: collapsed, contextTouched: true };
    setStored(next);
    writeWorkspaceLayout(next);
  };
  return {
    placements: workspacePlacements({ ...inputs, contextExpanded: !layout.contextCollapsed, phone }, availableInline),
    contextCollapsed: layout.contextCollapsed,
    setContextCollapsed,
  };
}