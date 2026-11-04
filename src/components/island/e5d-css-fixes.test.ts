import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Source locks for the E5D low fixes: the stale-pairing reveal and the AI & Models tabs reach the 44px thumb bar on
 * touch/container-narrow contexts, and in forced colours the theme-card titles keep OS CanvasText instead of the
 * disabled-button GrayText (each rule beside the shared patterns it extends).
 */
const glass = readFileSync(fileURLToPath(new URL("./glass.css", import.meta.url)), "utf8");
const premium = readFileSync(fileURLToPath(new URL("./premium.css", import.meta.url)), "utf8");

test("E5D targets: the stale-pairing reveal reaches the 44px bar on the phone bands only", () => {
  const band = /@media \(max-width: 767px\), \(max-height: 500px\) and \(min-width: 768px\) \{[\s\S]*?\n\}/.exec(premium);
  assert.ok(band, "the phone band exists");
  assert.ok(band[0].includes(".offline-note .button"), "the rule targets the stale-pairing reveal");
  assert.ok(band[0].includes("min-height: 44px"), "the thumb bar");
  // The note's loopback-only origin text and the desktop geometry stay in settings.tsx / bunny.css untouched.
  assert.doesNotMatch(band[0].slice(band[0].indexOf(".offline-note")), /display:\s*none/, "the offline state is never hidden");
});

test("E5D targets: the AI & Models tabs reach 44px inside a narrow settings container and fill their rows", () => {
  const block = /@container \(max-width: 560px\) \{[\s\S]*?\n\}/.exec(premium);
  assert.ok(block, "the container band exists");
  assert.ok(block[0].includes('.ai-tabs [role="tab"]'), "the rule targets the tab pills");
  assert.ok(block[0].includes("min-height: 44px"), "the thumb bar");
  assert.ok(block[0].includes("flex: 1 1 auto"), "rows fill instead of ragging");
});

test("E5D colors: forced colours resolve the theme-card titles (and their in-use tag) to CanvasText", () => {
  // glass.css keeps one F05 block near the surface family and one late well block; the rule must live in the F05 one.
  const block = /@media \(forced-colors: active\) \{[\s\S]*?\n\}/.exec(glass);
  assert.ok(block, "the F05 forced-colours block exists");
  assert.ok(
    /\.bunny-app\.t8-app :is\(\.tg-preset, \.tg-preset \.tg-tag\) \{\s*color: CanvasText;/.test(block[0]),
    "the one scoped title rule is inside the shared block",
  );
  // The miniatures keep colour of their own (each theme card must still draw its real design, 6ba186c).
  const gallery = readFileSync(fileURLToPath(new URL("./theme-gallery.css", import.meta.url)), "utf8");
  assert.match(gallery, /\.tg-mini\s*\{[^}]*forced-color-adjust:\s*none/, "the miniature keeps its own design");
});
test("E6A targets: character chips, intensity/high-contrast rows and policy rows reach 44px on the phone bands only", () => {
  const band = /@media \(max-width: 767px\), \(max-height: 500px\) and \(min-width: 768px\) \{[\s\S]*?\n\}/.exec(glass);
  assert.ok(band, "the glass phone band exists");
  assert.ok(band[0].includes(".ch-chip") && band[0].includes("min-height: 44px"), "character chips reach the thumb bar");
  assert.ok(band[0].includes(".ca-intensity label") && band[0].includes(".ca-check"), "intensity and high-contrast rows reach the thumb bar");
  assert.ok(band[0].includes(".policy-row"), "the background-task policy rows reach the thumb bar");
  const ptasks = readFileSync(fileURLToPath(new URL("./ptasks.tsx", import.meta.url)), "utf8");
  assert.ok(ptasks.includes('className="caption policy-row"'), "the policy labels carry the row class the band rules target");
});
