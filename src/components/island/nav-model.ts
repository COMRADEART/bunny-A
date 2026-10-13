/**
 * M-A-3 T13 navigation truth. Pure: the shell and the store read the same table, so a deep link, a nav click and an
 * "open this" link always land on the same surface. Chat is the default landing; Models and Devices sit in a separate
 * System group; the design preview is reachable only by deep link and from Settings > About (never the main nav).
 */

/** Surfaces the shell can render. `null` in the store means the default landing (Chat). */
export type ShellSheet =
  | "chat"
  | "missions"
  | "agents"
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
  "missions",
  "agents",
  "projects",
  "files",
  "approvals",
  "activity",
  "settings",
  "models",
  "devices",
  "design-preview",
] as const;
export type NavView = (typeof NAV_VIEWS)[number];

export type NavItem = { view: NavView; sheet: ShellSheet; label: string };

/** Desktop navigation, in order. Chat is first and is the landing surface. */
export const NAV_MAIN: readonly NavItem[] = [
  { view: "chat", sheet: "chat", label: "Chat" },
  { view: "missions", sheet: "missions", label: "Missions" },
  { view: "agents", sheet: "agents", label: "Agents" },
  { view: "projects", sheet: "project", label: "Projects" },
  { view: "files", sheet: "files", label: "Files" },
  { view: "approvals", sheet: "approvals", label: "Approvals" },
  { view: "activity", sheet: "activity", label: "Activity" },
  { view: "settings", sheet: "settings", label: "Settings" },
];

/** The separated System group. */
export const NAV_SYSTEM: readonly NavItem[] = [
  { view: "models", sheet: "provider", label: "Models" },
  { view: "devices", sheet: "devices", label: "Devices" },
];

/** Every legacy `?view=` value that must keep working, mapped to the surface it opens. */
export const VIEW_ALIASES: Readonly<Record<string, ShellSheet>> = {
  today: "chat",
  chat: "chat",
  agents: "agents",
  agentic: "missions",
  missions: "missions",
  models: "provider",
  activity: "activity",
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
    case "missions":
    case "agentic":
      return "missions";
    case "agents":
      return "agents";
    case "project":
      return "projects";
    case "files":
      return "files";
    case "approvals":
    case "decision":
      return "approvals";
    case "activity":
    case "task":
    case "tasks":
    case "extensions":
      return "activity";
    case "settings":
    case "system":
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
export const isMainNavSheet = (sheet: ShellSheet | null) => NAV_MAIN.some((item) => item.sheet === sheet);
