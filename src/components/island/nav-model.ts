/**
 * M-A-3 T13 navigation truth. Pure: the shell and the store read the same table, so a deep link, a nav click and an
 * "open this" link always land on the same surface. Home is the default landing. Everyday work is Home, Tasks,
 * Projects and Agents. Everything else stays reachable under Advanced. The design preview stays off the nav.
 */

/** Surfaces the shell can render. `null` in the store means the default landing (Home). */
export type ShellSheet =
  | "chat"
  | "missions"
  | "agents"
  | "studio"
  | "teams"
  | "widgets"
  | "characters"
  | "project"
  | "files"
  | "approvals"
  | "activity"
  | "settings"
  | "provider"
  | "devices"
  | "design-preview"
  | "phone"
  | "system"
  | "tasks"
  | "task"
  | "decision"
  | "extensions"
  | "compose"
  | "constellation";

/** Canonical deep-link view names (`?view=`). */
export const NAV_VIEWS = [
  "chat",
  "tasks",
  "projects",
  "agents",
  "missions",
  "teams",
  "studio",
  "widgets",
  "characters",
  "files",
  "approvals",
  "activity",
  "telemetry",
  "models",
  "devices",
  "settings",
  "design-preview",
] as const;
export type NavView = (typeof NAV_VIEWS)[number];

export type NavItem = { view: NavView; sheet: ShellSheet; label: string };

/** Everyday navigation, in order. Home is first and is the landing surface. */
export const NAV_PRIMARY: readonly NavItem[] = [
  { view: "chat", sheet: "chat", label: "Home" },
  { view: "tasks", sheet: "tasks", label: "Tasks" },
  { view: "projects", sheet: "project", label: "Projects" },
  { view: "agents", sheet: "agents", label: "Agents" },
];

/** Capabilities that stay available without sitting on the everyday path. */
export const NAV_ADVANCED: readonly NavItem[] = [
  { view: "missions", sheet: "missions", label: "Missions" },
  { view: "teams", sheet: "teams", label: "Agentic teams" },
  { view: "studio", sheet: "studio", label: "Studio" },
  { view: "widgets", sheet: "widgets", label: "Widgets" },
  { view: "characters", sheet: "characters", label: "Characters" },
  { view: "files", sheet: "files", label: "Files" },
  { view: "approvals", sheet: "approvals", label: "Approvals" },
  { view: "activity", sheet: "activity", label: "Activity" },
  { view: "telemetry", sheet: "system", label: "Telemetry" },
  { view: "models", sheet: "provider", label: "Models" },
  { view: "devices", sheet: "devices", label: "Devices" },
  { view: "settings", sheet: "settings", label: "Settings" },
];

/** @deprecated Everyday nav. Kept so older imports still read the primary list. */
export const NAV_MAIN: readonly NavItem[] = NAV_PRIMARY;

/** Provider and device settings, also listed under Advanced. */
export const NAV_SYSTEM: readonly NavItem[] = NAV_ADVANCED.filter((item) => item.view === "models" || item.view === "devices");

/** Every legacy `?view=` value that must keep working, mapped to the surface it opens. */
export const VIEW_ALIASES: Readonly<Record<string, ShellSheet>> = {
  today: "chat",
  home: "chat",
  chat: "chat",
  tasks: "tasks",
  agents: "agents",
  studio: "studio",
  teams: "teams",
  widgets: "widgets",
  characters: "characters",
  agentic: "missions",
  missions: "missions",
  models: "provider",
  activity: "activity",
  telemetry: "system",
  devices: "devices",
  projects: "project",
  project: "project",
  files: "files",
  approvals: "approvals",
  system: "system",
  settings: "settings",
  history: "tasks",
  notifications: "extensions",
  compose: "compose",
  constellation: "constellation",
  "design-preview": "design-preview",
};

/** The sheet a view name opens, or null for an unknown name (the caller keeps its current surface). */
export function sheetForView(view: string | null | undefined): ShellSheet | null {
  if (!view) return null;
  return Object.prototype.hasOwnProperty.call(VIEW_ALIASES, view) ? VIEW_ALIASES[view] : null;
}

/** Which main-nav entry a surface belongs to, so the right item is current. */
export function activeNavView(sheet: string | null | undefined): NavView {
  switch (sheet) {
    case "tasks":
    case "task":
      return "tasks";
    case "missions":
    case "agentic":
      return "missions";
    case "teams":
      return "teams";
    case "agents":
      return "agents";
    case "studio":
      return "studio";
    case "widgets":
      return "widgets";
    case "characters":
      return "characters";
    case "project":
      return "projects";
    case "files":
      return "files";
    case "approvals":
    case "decision":
      return "approvals";
    case "activity":
    case "extensions":
      return "activity";
    case "system":
      return "telemetry";
    case "settings":
    case "design-preview":
      return "settings";
    case "provider":
      return "models";
    case "devices":
    case "phone":
      return "devices";
    default:
      return "chat";
  }
}

export type DeepLink = {
  /** `?companion=1`: the full-screen touch-first companion (Phone), never the Devices page. */
  companion: boolean;
  sheet: ShellSheet | null;
  theme: "light" | "dark" | null;
  taskId: string | null;
  missionId: string | null;
  agentId: string | null;
};

/** Reads every shell deep link from a query string. Unknown views fall back to the default landing. */
export function deepLinkFromSearch(search: string): DeepLink {
  const query = new URLSearchParams(search);
  const theme = query.get("theme");
  const companion = query.get("companion") === "1";
  const taskId = query.get("task") || null;
  const missionId = query.get("mission") || null;
  const agentId = query.get("agent") || null;
  // Precedence matches the shell's historical hydrate order: a view, then a task, mission or agent focus overrides it.
  let sheet = sheetForView(query.get("view"));
  if (taskId) sheet = "task";
  if (missionId || agentId) sheet = "missions";
  // The companion is the whole-screen Phone, so it wins over every other surface link.
  if (companion) sheet = "phone";
  return {
    companion,
    sheet,
    theme: theme === "dark" || theme === "light" ? theme : null,
    taskId,
    missionId,
    agentId,
  };
}

/** Whether a surface is one the design preview may be reached through (never a main-nav destination). */
export const isMainNavSheet = (sheet: ShellSheet | null) => NAV_PRIMARY.some((item) => item.sheet === sheet);
export const isAdvancedNavSheet = (sheet: ShellSheet | null) => NAV_ADVANCED.some((item) => item.sheet === sheet);
