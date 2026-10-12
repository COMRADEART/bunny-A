import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Reads the glass tokens from glass.css itself (not a copy), composites the translucent glass over each page colour and wash,
 * and checks body and muted text against the WCAG 4.5:1 threshold in both themes.
 */
const css = readFileSync(fileURLToPath(new URL("./glass.css", import.meta.url)), "utf8");
const lightBlock = css.slice(css.indexOf("/* Light workspace"), css.indexOf("/* Dark workspace"));
const darkBlock = css.slice(css.indexOf("/* Dark workspace"), css.indexOf("/* Glass surfaces"));

function token(block: string, name: string): string {
  const match = new RegExp(`--${name}:\\s*([^;]+);`).exec(block);
  assert.ok(match, `token --${name} is defined`);
  return match[1].trim();
}

type RGB = [number, number, number];
const hex = (value: string): RGB => {
  const v = value.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16)) as RGB;
};
function rgba(value: string): { color: RGB; alpha: number } {
  if (value.startsWith("#")) return { color: hex(value), alpha: 1 };
  const match = /rgba?\(([^)]+)\)/.exec(value);
  assert.ok(match, `${value} is a colour`);
  const parts = match[1].split(",").map((part) => Number(part.trim()));
  return { color: [parts[0], parts[1], parts[2]], alpha: parts.length > 3 ? parts[3] : 1 };
}
/** Source-over compositing of a translucent colour over an opaque backdrop. */
const over = (top: { color: RGB; alpha: number }, below: RGB): RGB =>
  top.color.map((c, i) => Math.round(c * top.alpha + below[i] * (1 - top.alpha))) as RGB;
function luminance([r, g, b]: RGB): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
function contrast(a: RGB, b: RGB): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function check(theme: string, block: string) {
  const page = hex(token(block, "page"));
  const washes = [hex(token(block, "page-wash-a")), hex(token(block, "page-wash-b"))];
  const glass = rgba(token(block, "glass"));
  const fg = hex(token(block, "fg"));
  const muted = hex(token(block, "muted"));
  const field = rgba(token(block, "field"));
  const elevated = rgba(token(block, "elevated"));
  const backdrops = [page, ...washes];
  for (const base of backdrops) {
    const surface = over(glass, base);
    assert.ok(contrast(fg, surface) >= 4.5, `${theme}: body text on glass over ${base} is ${contrast(fg, surface).toFixed(2)}:1`);
    assert.ok(contrast(muted, surface) >= 4.5, `${theme}: muted text on glass over ${base} is ${contrast(muted, surface).toFixed(2)}:1`);
    const fieldSurface = over(field, surface);
    assert.ok(contrast(fg, fieldSurface) >= 4.5, `${theme}: text in a field is ${contrast(fg, fieldSurface).toFixed(2)}:1`);
    const elevatedSurface = over(elevated, surface);
    assert.ok(contrast(muted, elevatedSurface) >= 4.5, `${theme}: muted text on an elevated card is ${contrast(muted, elevatedSurface).toFixed(2)}:1`);
  }
}

test("T13 glass: body and muted text reach 4.5:1 on every light glass surface", () => {
  check("light", lightBlock);
});

test("T13 glass: primary button labels reach 4.5:1 on their action colour in both themes", () => {
  assert.ok(contrast(hex(token(lightBlock, "action-ink")), hex(token(lightBlock, "action"))) >= 4.5, "light primary label");
  assert.ok(contrast(hex(token(darkBlock, "action-ink")), hex(token(darkBlock, "action"))) >= 4.5, "dark primary label");
});

test("T13 glass: body and muted text reach 4.5:1 on every dark glass surface", () => {
  check("dark", darkBlock);
});

test("T13 glass: unbound context rows never fade their text below the contrast bar", () => {
  // An opacity fade composites every character in the row below 4.5:1 on light glass even though the token by
  // itself passes, so the unbound-row rule must convey state with colour alone (spec section 11).
  const rule = /\.cx-row\[data-bound="false"\]\s*\{[^}]*\}/.exec(css);
  assert.ok(rule, "the unbound cx-row rule is defined");
  assert.doesNotMatch(rule[0], /opacity\s*:/, "unbound rows must not apply an opacity fade");
});

test("T13 glass: the opaque fallbacks are the solid tokens and the character well is always dark", () => {
  assert.match(css, /--glass-solid:\s*#f6f7fb;/);
  assert.match(css, /--glass-solid:\s*#141824;/);
  assert.match(css, /\.cx-well\s*\{[^}]*#07080d/);
  assert.match(css, /prefers-reduced-transparency: reduce/);
  assert.match(css, /forced-colors: active/);
  assert.match(css, /@supports not \(/);
});

test("T13 glass: the shell's tokens are defined once, with a selector that outranks bunny.css and premium.css", () => {
  // Both older sources use specificity (0,2,0) for their light block. The glass light selector must be (0,3,0) for the
  // theme-attribute form, so the cascade no longer depends on which stylesheet loads first.
  assert.match(css, /\.bunny-app\.t8-app\[data-theme="light"\]\s*\{/);
  assert.match(css, /\.bunny-app\.t8-app\[data-theme="dark"\]\s*\{/);
});
