import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PHONE_PROFILE_QUERY } from "./workspace-layout.ts";

/**
 * E5D dock fixes: the phone-profile bands in glass.css (the dock's expanded content) and premium.css (the offline
 * toast) must stay word-for-word in lockstep with workspace-layout.ts's probe, so the shell and the dock always
 * choose the same profile; each band keeps the exact rule shape the captures need.
 */
const glass = readFileSync(fileURLToPath(new URL("./glass.css", import.meta.url)), "utf8");
const premium = readFileSync(fileURLToPath(new URL("./premium.css", import.meta.url)), "utf8");

const band = (css: string) =>
  /@media \(max-width: 767px\), \(max-height: 500px\) and \(min-width: 768px\) \{[\s\S]*?\n\}/.exec(css);

test("E5D dock: the phone band query is the model's own profile in both stylesheets", () => {
  assert.ok(glass.includes(`@media ${PHONE_PROFILE_QUERY}`), "the glass.css dock band matches the probe");
  assert.ok(premium.includes(`@media ${PHONE_PROFILE_QUERY}`), "the premium.css toast band matches the probe");
});

test("E5D dock: the expanded dock joins the split's flow on the phone band, never the fixed drawer", () => {
  const block = band(glass);
  assert.ok(block, "the glass.css phone band exists");
  assert.ok(
    block[0].includes('.cx-panel[data-collapsed="false"]:not(.ws-drawer)'),
    "the rule keys the expanded in-flow panel and leaves the narrow-desktop drawer alone",
  );
  assert.ok(block[0].includes("position: static"), "no fixed overlay over the workspace");
  assert.ok(block[0].includes("grid-column: 1 / -1"), "the dock takes its own full-width row");
  assert.ok(block[0].includes("max-height: none"), "the flow section is not height-clamped");
});

test("E5D dock: the phone toast band lifts the notice above the reopen strip and never over the companion dock", () => {
  const block = band(premium);
  assert.ok(block, "the premium.css phone band exists");
  assert.ok(
    block[0].includes(':not([data-surface="companion"]) .bunny-toast'),
    "the companion phone surface keeps its own dock zone",
  );
  assert.ok(block[0].includes("bottom: calc(var(--s3) + 52px)"), "the toast stacks above the reopen-control strip");
});