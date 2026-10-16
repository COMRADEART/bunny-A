import test from "node:test";
import assert from "node:assert/strict";
import { UI_THEME_IDS, themeManifest } from "./ui-theme.ts";
import {
  CORE_WIDGET_IDS, DEFAULT_WIDGET_PREFERENCE, LIBRARY_WIDGET_IDS, WIDGET_REGISTRY, benchLayout, columnSpan,
  drawerEdgeFor, moveItem, notchCue, parseWidgetPreference, reorderItem, resizeItem, setItemHidden, snapResize,
  validateWidgetPreference, visibleItems, widgetMayRender,
} from "./widgets.ts";

test("the registry installs six live widgets and keeps future widgets declared", () => {
  const live = WIDGET_REGISTRY.filter((row) => row.availability === "live");
  assert.deepEqual(live.map((row) => row.id), [...CORE_WIDGET_IDS]);
  assert.equal(WIDGET_REGISTRY.filter((row) => row.availability === "declared").length, LIBRARY_WIDGET_IDS.length);
  assert.equal(WIDGET_REGISTRY.some((row) => row.thirdParty), false);
  for (const id of LIBRARY_WIDGET_IDS) assert.equal(widgetMayRender(id), false);
  for (const row of WIDGET_REGISTRY) {
    assert.ok(row.capability && row.dataSource && row.permissions && row.platforms.length && row.sizes.length);
    assert.ok(row.refresh && row.offline && row.privacy && row.interaction);
  }
});

test("layout edits reorder, resize and hide inside the six widgets, and reset is the default", () => {
  const moved = moveItem(DEFAULT_WIDGET_PREFERENCE, "voice", -1);
  assert.equal(moved.items.at(-2)?.id, "voice");
  assert.equal(moveItem(DEFAULT_WIDGET_PREFERENCE, "mission", -1), DEFAULT_WIDGET_PREFERENCE);
  const reordered = reorderItem(DEFAULT_WIDGET_PREFERENCE, "voice", "mission");
  assert.equal(reordered.items[0].id, "voice");
  const sized = resizeItem(DEFAULT_WIDGET_PREFERENCE, "usage", "tall");
  assert.equal(sized.items.find((item) => item.id === "usage")?.size, "tall");
  const hidden = setItemHidden(DEFAULT_WIDGET_PREFERENCE, "lotus", true);
  assert.deepEqual(visibleItems(hidden).map((item) => item.id), ["mission", "agents", "usage", "reconciliation", "voice"]);
  assert.equal(columnSpan("wide"), 2);
  assert.equal(columnSpan("tall"), 1);
  assert.equal(snapResize("standard", 80, 0, ["compact", "standard", "wide", "tall"]), "wide");
  assert.equal(snapResize("standard", -80, 0, ["standard", "wide"]), "standard");
});

test("a preference refuses markup, unknown keys, a disabled widget and a free coordinate", () => {
  assert.throws(() => validateWidgetPreference({ layout: "<script>" }), /layout/);
  assert.throws(() => validateWidgetPreference({ approve: true }), /approve/);
  assert.throws(() => validateWidgetPreference({ items: [{ id: "calendar", size: "standard", hidden: false }] }), /disabled|include each/);
  assert.throws(() => validateWidgetPreference({ focus: { projectId: "javascript:alert(1)", slot: null } }), /project/);
  assert.throws(() => validateWidgetPreference({ sidebarWidth: 900 }), /240/);
  const parsed = parseWidgetPreference({ schema: "nope", layout: "drawer" });
  assert.equal(parsed.layout, "board");
  const saved = validateWidgetPreference({ layout: "sidebar", density: "compact", gap: 8, drawerOpen: true }, DEFAULT_WIDGET_PREFERENCE);
  assert.equal(saved.layout, "sidebar");
  assert.equal(saved.items.length, 6);
});

test("the drawer sits opposite the Notch, and the Notch cue is a short reconcile count or nothing", () => {
  assert.equal(drawerEdgeFor("top"), "bottom");
  assert.equal(drawerEdgeFor("left"), "right");
  assert.equal(notchCue(0), null);
  assert.equal(notchCue(2), "Reconcile 2");
  assert.ok((notchCue(2) ?? "").length < 24);
});

test("all 22 themes differ by more than colour for a widget that uses their tokens", () => {
  const rows = UI_THEME_IDS.map((id) => {
    const manifest = themeManifest(id);
    return { id, material: manifest.material, radius: manifest.geometry.rMd, border: manifest.geometry.border, font: manifest.typography.display };
  });
  assert.equal(rows.length, 22);
  assert.ok(new Set(rows.map((row) => row.material)).size > 4);
  assert.ok(new Set(rows.map((row) => row.radius)).size > 4);
  assert.ok(new Set(rows.map((row) => row.font)).size > 4);
  assert.ok(rows.some((row) => row.border === 0) && rows.some((row) => row.border > 0));
});

test("reordering and resizing a few thousand times stays on this machine's clock", () => {
  const timing = benchLayout(2000);
  assert.equal(timing.iterations, 2000);
  assert.ok(timing.reorderMs >= 0 && timing.resizeMs >= 0);
  assert.ok(timing.reorderMs < 1000 && timing.resizeMs < 1000, JSON.stringify(timing));
});
