/**
 * Widget Design Studio: presentation registry and layout preference (pure).
 *
 * A widget is a view of Host facts the window already holds. Nothing here authorizes a Mission, a Task, a model
 * route, a memory read or a reconciliation decision. Preference data is plain JSON: enums, booleans and short ids.
 * It is rejected if it carries markup, a URL or an unknown key, so a layout file cannot become code.
 */

export const WIDGET_SCHEMA = "bunny-a.widgets.v1";

export const CORE_WIDGET_IDS = ["mission", "agents", "usage", "lotus", "reconciliation", "voice"] as const;
export type CoreWidgetId = (typeof CORE_WIDGET_IDS)[number];

/** Declared for a later build. They are not rendered and cannot be turned on from a preference file. */
export const LIBRARY_WIDGET_IDS = [
  "project-explorer", "file-activity", "worker-graph", "notifications", "approval-queue", "model-harness",
  "resource-monitor", "task-history", "calendar", "notes", "research", "browser-tasks", "local-model-health",
] as const;
export type LibraryWidgetId = (typeof LIBRARY_WIDGET_IDS)[number];

export const WIDGET_SIZES = ["compact", "standard", "wide", "tall"] as const;
export type WidgetSize = (typeof WIDGET_SIZES)[number];
export const WIDGET_LAYOUTS = ["board", "sidebar", "drawer"] as const;
export type WidgetLayout = (typeof WIDGET_LAYOUTS)[number];
export const WIDGET_DENSITIES = ["comfortable", "compact"] as const;
export type WidgetDensity = (typeof WIDGET_DENSITIES)[number];
export const WIDGET_EDGES = ["top", "bottom", "left", "right"] as const;
export type WidgetEdge = (typeof WIDGET_EDGES)[number];
export const WIDGET_MOTIONS = ["theme", "reduced", "off"] as const;
export type WidgetMotion = (typeof WIDGET_MOTIONS)[number];
export const WIDGET_GAPS = [8, 12, 16] as const;

export type WidgetPlatform = "windows" | "phone" | "notch";
export type WidgetPrivacy = "projection" | "workstation" | "agent-private";
export type WidgetAvailability = "live" | "declared" | "disabled";

export type WidgetDefinition = {
  id: string;
  name: string;
  description: string;
  capability: string;
  dataSource: string;
  permissions: readonly string[];
  platforms: readonly WidgetPlatform[];
  sizes: readonly WidgetSize[];
  refresh: "snapshot";
  offline: string;
  privacy: WidgetPrivacy;
  interaction: string;
  availability: WidgetAvailability;
  /** Third-party widgets stay disabled until a reviewed sandbox exists. None are registered. */
  thirdParty: boolean;
};

const live = (
  id: CoreWidgetId,
  name: string,
  description: string,
  dataSource: string,
  permissions: readonly string[],
  privacy: WidgetPrivacy,
  interaction: string,
): WidgetDefinition => ({
  id, name, description, capability: id, dataSource, permissions,
  platforms: privacy === "projection" ? ["windows", "phone", "notch"] : ["windows"],
  sizes: WIDGET_SIZES, refresh: "snapshot",
  offline: "Shows the last Host snapshot as stale, or an offline note. It does not invent progress.",
  privacy, interaction, availability: "live", thirdParty: false,
});

export const WIDGET_REGISTRY: readonly WidgetDefinition[] = [
  live("mission", "Mission Control", "The Mission a Personal Agent owns, as step counts from the Host.", "missions + personalAgents", ["missions.read"], "projection", "Opens that Mission."),
  live("agents", "Personal Agents", "The four weapon characters and the Missions they own.", "personalAgents", ["personal-agents.read"], "projection", "Opens that Agent's workspace and makes it the one that answers in chat."),
  live("usage", "Session Usage", "This Host run's ledger. Unknown cost and quota stay unknown.", "sessionLedger", ["session.read"], "workstation", "Opens Models. It cannot change a route."),
  live("lotus", "Lotus Memory", "Whether memory is available, and the titles of recent changes. Values stay hidden.", "personalAgentContext", ["lotus.metadata"], "agent-private", "Opens the Agent workspace. It does not reveal memory text."),
  live("reconciliation", "Reconciliation", "Uncertain write outcomes the owner must review. Nothing is replayed from here.", "reconciliation", ["reconcile.review"], "workstation", "Opens the existing owner review on the workstation."),
  live("voice", "Bunny Voice", "Who is answering, and the Host's voice session, including when it has not reported.", "voice + personalAgentContext", ["voice.use"], "workstation", "Uses the existing voice and foreground commands."),
  ...LIBRARY_WIDGET_IDS.map((id): WidgetDefinition => ({
    id,
    name: id.replaceAll("-", " "),
    description: "Declared only. This widget is not installed.",
    capability: id,
    dataSource: "none",
    permissions: [],
    platforms: ["windows"],
    sizes: ["standard"],
    refresh: "snapshot",
    offline: "Not installed.",
    privacy: "workstation",
    interaction: "No control is enabled.",
    availability: "declared",
    thirdParty: false,
  })),
];

const byId = new Map(WIDGET_REGISTRY.map((row) => [row.id, row]));
export function widgetDefinition(id: string): WidgetDefinition | null {
  return byId.get(id) ?? null;
}
export function isCoreWidget(id: string): id is CoreWidgetId {
  return (CORE_WIDGET_IDS as readonly string[]).includes(id);
}
/** A widget may be shown only when the registry says it is live and first-party. */
export function widgetMayRender(id: string): id is CoreWidgetId {
  const row = byId.get(id);
  return !!row && row.availability === "live" && !row.thirdParty && isCoreWidget(id);
}

export type WidgetItem = { id: CoreWidgetId; size: WidgetSize; hidden: boolean };
export type WidgetFocus = { projectId: string | null; slot: 1 | 2 | 3 | 4 | null };
export type WidgetPreference = {
  layout: WidgetLayout;
  density: WidgetDensity;
  gap: (typeof WIDGET_GAPS)[number];
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  drawerOpen: boolean;
  drawerEdge: WidgetEdge;
  /** The edge the Notch occupies. The drawer opens on the opposite edge. This does not move the Notch. */
  notchEdge: WidgetEdge;
  motion: WidgetMotion;
  focus: WidgetFocus;
  items: WidgetItem[];
};

const PREFERENCE_KEYS = new Set(["layout", "density", "gap", "sidebarWidth", "sidebarCollapsed", "drawerOpen", "drawerEdge", "notchEdge", "motion", "focus", "items"]);
const FOCUS_KEYS = new Set(["projectId", "slot"]);
const ITEM_KEYS = new Set(["id", "size", "hidden"]);
const PROJECT_ID = /^[A-Za-z0-9_-]{1,80}$/;

const defaultItem = (id: CoreWidgetId, size: WidgetSize): WidgetItem => ({ id, size, hidden: false });
export const DEFAULT_WIDGET_PREFERENCE: WidgetPreference = {
  layout: "board",
  density: "comfortable",
  gap: 12,
  sidebarWidth: 320,
  sidebarCollapsed: false,
  drawerOpen: false,
  drawerEdge: "right",
  notchEdge: "top",
  motion: "theme",
  focus: { projectId: null, slot: null },
  items: [
    defaultItem("mission", "wide"),
    defaultItem("agents", "wide"),
    defaultItem("usage", "standard"),
    defaultItem("lotus", "standard"),
    defaultItem("reconciliation", "standard"),
    defaultItem("voice", "compact"),
  ],
};

export type WidgetView = { schema: typeof WIDGET_SCHEMA; revision: number; preference: WidgetPreference };

const copy = (preference: WidgetPreference): WidgetPreference => ({
  ...preference,
  focus: { ...preference.focus },
  items: preference.items.map((item) => ({ ...item })),
});

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], label: string): T => {
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) return value as T;
  throw new Error(`Unsupported widget ${label}.`);
};
const flag = (value: unknown, label: string): boolean => {
  if (typeof value !== "boolean") throw new Error(`${label} must be true or false.`);
  return value;
};

function readItems(value: unknown): WidgetItem[] {
  if (!Array.isArray(value)) throw new Error("Widget order must be a list.");
  const seen = new Set<string>();
  const items: WidgetItem[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("A widget entry must be an object.");
    const record = row as Record<string, unknown>;
    for (const key of Object.keys(record)) if (!ITEM_KEYS.has(key)) throw new Error(`Unsupported widget field: ${key}.`);
    if (typeof record.id !== "string" || !widgetMayRender(record.id)) throw new Error("Unknown or disabled widget.");
    if (seen.has(record.id)) throw new Error("A widget is listed twice.");
    seen.add(record.id);
    const definition = widgetDefinition(record.id)!;
    const size = oneOf(record.size, WIDGET_SIZES, "size");
    if (!definition.sizes.includes(size)) throw new Error("That size is not available for this widget.");
    items.push({ id: record.id, size, hidden: flag(record.hidden, "Hidden") });
  }
  if (items.length !== CORE_WIDGET_IDS.length || CORE_WIDGET_IDS.some((id) => !seen.has(id)))
    throw new Error("The layout must include each installed widget once.");
  return items;
}

function readFocus(value: unknown): WidgetFocus {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Widget focus must be an object.");
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) if (!FOCUS_KEYS.has(key)) throw new Error(`Unsupported widget focus: ${key}.`);
  const projectId = record.projectId;
  if (projectId !== null && (typeof projectId !== "string" || !PROJECT_ID.test(projectId))) throw new Error("Unsupported project filter.");
  const slot = record.slot;
  if (slot !== null && slot !== 1 && slot !== 2 && slot !== 3 && slot !== 4) throw new Error("Unsupported Agent filter.");
  return { projectId, slot };
}

/** Strict merge. Unknown keys, markup and disabled widgets are refused. */
export function validateWidgetPreference(input: unknown, current: WidgetPreference = DEFAULT_WIDGET_PREFERENCE): WidgetPreference {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Widget settings must be an object.");
  const record = input as Record<string, unknown>;
  for (const key of Object.keys(record)) if (!PREFERENCE_KEYS.has(key)) throw new Error(`Unsupported widget setting: ${key}.`);
  const next = copy(current);
  if ("layout" in record) next.layout = oneOf(record.layout, WIDGET_LAYOUTS, "layout");
  if ("density" in record) next.density = oneOf(record.density, WIDGET_DENSITIES, "density");
  if ("gap" in record) {
    if (record.gap !== 8 && record.gap !== 12 && record.gap !== 16) throw new Error("Unsupported widget spacing.");
    next.gap = record.gap;
  }
  if ("sidebarWidth" in record) {
    if (typeof record.sidebarWidth !== "number" || !Number.isInteger(record.sidebarWidth) || record.sidebarWidth < 240 || record.sidebarWidth > 480)
      throw new Error("Sidebar width must be a whole number from 240 to 480.");
    next.sidebarWidth = record.sidebarWidth;
  }
  if ("sidebarCollapsed" in record) next.sidebarCollapsed = flag(record.sidebarCollapsed, "Sidebar collapsed");
  if ("drawerOpen" in record) next.drawerOpen = flag(record.drawerOpen, "Drawer open");
  if ("drawerEdge" in record) next.drawerEdge = oneOf(record.drawerEdge, WIDGET_EDGES, "drawer edge");
  if ("notchEdge" in record) next.notchEdge = oneOf(record.notchEdge, WIDGET_EDGES, "Notch edge");
  if ("motion" in record) next.motion = oneOf(record.motion, WIDGET_MOTIONS, "motion");
  if ("focus" in record) next.focus = readFocus(record.focus);
  if ("items" in record) next.items = readItems(record.items);
  return next;
}

/** A stored row. A damaged value falls back to the default and never throws. */
export function parseWidgetPreference(input: unknown): WidgetPreference {
  try {
    if (!input || typeof input !== "object") return copy(DEFAULT_WIDGET_PREFERENCE);
    const record = input as Record<string, unknown>;
    if (record.schema !== undefined && record.schema !== WIDGET_SCHEMA) return copy(DEFAULT_WIDGET_PREFERENCE);
    const { schema: _schema, revision: _revision, ...rest } = record;
    return validateWidgetPreference(rest);
  } catch {
    return copy(DEFAULT_WIDGET_PREFERENCE);
  }
}

export function widgetView(preference: WidgetPreference, revision: number): WidgetView {
  return { schema: WIDGET_SCHEMA, revision, preference: copy(preference) };
}

export function moveItem(preference: WidgetPreference, id: CoreWidgetId, direction: -1 | 1): WidgetPreference {
  const items = preference.items.map((item) => ({ ...item }));
  const index = items.findIndex((item) => item.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= items.length) return preference;
  const [row] = items.splice(index, 1);
  items.splice(target, 0, row!);
  return { ...preference, items };
}

export function reorderItem(preference: WidgetPreference, fromId: CoreWidgetId, toId: CoreWidgetId): WidgetPreference {
  if (fromId === toId) return preference;
  const items = preference.items.map((item) => ({ ...item }));
  const from = items.findIndex((item) => item.id === fromId);
  const to = items.findIndex((item) => item.id === toId);
  if (from < 0 || to < 0) return preference;
  const [row] = items.splice(from, 1);
  items.splice(to, 0, row!);
  return { ...preference, items };
}

export function resizeItem(preference: WidgetPreference, id: CoreWidgetId, size: WidgetSize): WidgetPreference {
  const definition = widgetDefinition(id);
  if (!definition?.sizes.includes(size)) throw new Error("That size is not available for this widget.");
  return { ...preference, items: preference.items.map((item) => item.id === id ? { ...item, size } : item) };
}

/** Drag distance snaps to a permitted size. It never stores a free coordinate. */
export function snapResize(size: WidgetSize, dx: number, dy: number, allowed: readonly WidgetSize[]): WidgetSize {
  const step = 56;
  let next = size;
  if (dx >= step && allowed.includes("wide")) next = "wide";
  else if (dx <= -step && allowed.includes("compact")) next = "compact";
  else if (dy >= step && allowed.includes("tall")) next = "tall";
  else if (dy <= -step && allowed.includes("standard")) next = "standard";
  return allowed.includes(next) ? next : size;
}

export function setItemHidden(preference: WidgetPreference, id: CoreWidgetId, hidden: boolean): WidgetPreference {
  return { ...preference, items: preference.items.map((item) => item.id === id ? { ...item, hidden } : item) };
}

export const visibleItems = (preference: WidgetPreference) => preference.items.filter((item) => !item.hidden);
export const columnSpan = (size: WidgetSize) => size === "wide" ? 2 : 1;

/** The drawer opens opposite the Notch so the strip stays reachable. */
export function drawerEdgeFor(notchEdge: WidgetEdge): WidgetEdge {
  switch (notchEdge) {
    case "top": return "bottom";
    case "bottom": return "top";
    case "left": return "right";
    case "right": return "left";
  }
}

/** One line for the Notch, or null when there is nothing the strip should add. */
export function notchCue(reconcileCount: number): string | null {
  if (!Number.isInteger(reconcileCount) || reconcileCount <= 0) return null;
  return reconcileCount === 1 ? "Reconcile 1" : `Reconcile ${Math.min(reconcileCount, 99)}`;
}

/** Layout operations only, so a test can time them without a browser. */
export function benchLayout(iterations = 2000): { reorderMs: number; resizeMs: number; iterations: number } {
  let preference = copy(DEFAULT_WIDGET_PREFERENCE);
  const reorderStart = performance.now();
  for (let i = 0; i < iterations; i++) preference = moveItem(preference, "voice", i % 2 === 0 ? -1 : 1);
  const reorderMs = performance.now() - reorderStart;
  const resizeStart = performance.now();
  for (let i = 0; i < iterations; i++) preference = resizeItem(preference, "mission", i % 2 === 0 ? "standard" : "wide");
  return { reorderMs, resizeMs: performance.now() - resizeStart, iterations };
}
