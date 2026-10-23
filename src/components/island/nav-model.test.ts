import test from "node:test";
import assert from "node:assert/strict";
import {
  activeNavView,
  deepLinkFromSearch,
  isAdvancedNavSheet,
  isMainNavSheet,
  NAV_ADVANCED,
  NAV_PRIMARY,
  NAV_SYSTEM,
  NAV_VIEWS,
  sheetForView,
  VIEW_ALIASES,
} from "./nav-model.ts";

test("T13 nav: everyday navigation is Home, Tasks, Projects, Agents", () => {
  assert.deepEqual(
    NAV_PRIMARY.map((item) => item.label),
    ["Home", "Tasks", "Projects", "Agents"],
  );
  assert.equal(NAV_PRIMARY[0].sheet, "chat", "Home is the default landing");
  for (const item of NAV_PRIMARY) assert.equal(isMainNavSheet(item.sheet), true);
});

test("T13 nav: advanced destinations keep every previous capability off the everyday path", () => {
  assert.deepEqual(NAV_ADVANCED.map((item) => item.label), [
    "Missions",
    "Agentic teams",
    "Studio",
    "Widgets",
    "Characters",
    "Files",
    "Approvals",
    "Activity",
    "Telemetry",
    "Models",
    "Devices",
    "Settings",
  ]);
  for (const item of NAV_ADVANCED) assert.equal(isMainNavSheet(item.sheet), false, `${item.label} is not an everyday destination`);
  assert.deepEqual(NAV_SYSTEM.map((item) => item.label), ["Models", "Devices"]);
  assert.equal(isAdvancedNavSheet("studio"), true);
});

test("T13 nav: every canonical view resolves to a surface, and the design preview is never a main destination", () => {
  assert.equal(NAV_VIEWS.length, 17);
  for (const view of NAV_VIEWS) assert.ok(sheetForView(view), `${view} resolves`);
  assert.equal(isMainNavSheet("design-preview"), false, "the design preview is deep-link only");
  assert.equal(sheetForView("studio"), "studio");
  assert.equal(sheetForView("agents"), "agents", "Agents is the overview; Studio has its own view");
});

test("T13 nav: every legacy ?view value keeps working", () => {
  assert.equal(sheetForView("today"), "chat");
  assert.equal(sheetForView("agentic"), "missions", "agentic is the Missions surface");
  assert.equal(sheetForView("agents"), "agents", "agents is the Personal Agent overview");
  assert.equal(sheetForView("studio"), "studio");
  assert.equal(sheetForView("home"), "chat");
  assert.equal(sheetForView("telemetry"), "system");
  assert.equal(sheetForView("models"), "provider");
  assert.equal(sheetForView("projects"), "project");
  assert.equal(sheetForView("history"), "tasks");
  assert.equal(sheetForView("notifications"), "extensions");
  assert.equal(sheetForView("system"), "system");
  assert.equal(sheetForView("compose"), "compose");
  assert.equal(sheetForView("constellation"), "constellation");
  assert.equal(Object.keys(VIEW_ALIASES).length, 26);
});

test("T13 nav: unknown or missing views resolve to nothing so the caller keeps its surface", () => {
  assert.equal(sheetForView("nope"), null);
  assert.equal(sheetForView(""), null);
  assert.equal(sheetForView(null), null);
  assert.equal(sheetForView("__proto__"), null, "an inherited key is never a view");
});

test("T13 nav: deep links read view, theme and focus, and ignore unknown theme values", () => {
  assert.deepEqual(deepLinkFromSearch(""), { companion: false, sheet: null, theme: null, taskId: null, missionId: null, agentId: null });
  assert.equal(deepLinkFromSearch("?view=files").sheet, "files");
  assert.equal(deepLinkFromSearch("?theme=dark").theme, "dark");
  assert.equal(deepLinkFromSearch("?theme=neon").theme, null);
});

test("T13 nav: mission and agent focus open Missions, and a task focus opens the task", () => {
  assert.equal(deepLinkFromSearch("?view=chat&mission=m1").sheet, "missions", "a mission link overrides the view, as before");
  assert.equal(deepLinkFromSearch("?agent=a1").sheet, "missions");
  assert.equal(deepLinkFromSearch("?task=t1").sheet, "task");
  assert.equal(deepLinkFromSearch("?task=t1").taskId, "t1");
});

test("T13 nav: ?companion=1 always renders the companion, never the Devices page, whatever else is in the link", () => {
  assert.equal(deepLinkFromSearch("?companion=1").sheet, "phone");
  assert.equal(deepLinkFromSearch("?companion=1&view=devices").sheet, "phone");
  assert.equal(deepLinkFromSearch("?companion=1&view=chat").companion, true);
  assert.equal(deepLinkFromSearch("?companion=1&task=t1").sheet, "phone", "the companion wins over every other link");
  assert.equal(deepLinkFromSearch("?view=devices").companion, false);
  assert.equal(deepLinkFromSearch("?view=devices").sheet, "devices", "Devices stays reachable at view=devices");
});

test("T13 nav: the active item follows the surface, including drill-down surfaces", () => {
  assert.equal(activeNavView(null), "chat", "the default landing is Home");
  assert.equal(activeNavView("decision"), "approvals");
  assert.equal(activeNavView("task"), "tasks");
  assert.equal(activeNavView("tasks"), "tasks");
  assert.equal(activeNavView("activity"), "activity");
  assert.equal(activeNavView("studio"), "studio");
  assert.equal(activeNavView("teams"), "teams");
  assert.equal(activeNavView("system"), "telemetry");
  assert.equal(activeNavView("provider"), "models");
  assert.equal(activeNavView("phone"), "devices");
  assert.equal(activeNavView("design-preview"), "settings");
  assert.equal(activeNavView("project"), "projects");
  assert.equal(activeNavView("agentic"), "missions", "a legacy agentic sheet is the Missions surface");
  assert.equal(activeNavView("today"), "chat", "a legacy today sheet is the Home landing");
});
