// Visual Experience 2.0 Gate E: in every masthead (topnav) theme, all ten destinations fit the masthead without hidden
// horizontal scrolling at 1440 and 1280 px, and a focused control below the fold is scrolled clear of the sticky masthead.
// Usage: node topnav-fit.mjs <base> <out.json>
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import { UI_THEME_IDS, themeManifest } from "../../../src/lib/bunny-host/ui-theme.ts";

const [base, out] = process.argv.slice(2);
const themes = UI_THEME_IDS.filter((id) => themeManifest(id).layout === "topnav");
const browser = await chromium.launch();
const rows = [];
for (const id of themes) {
  const variant = themeManifest(id).defaultVariant;
  for (const width of [1440, 1280]) {
    const page = await (await browser.newContext({ viewport: { width, height: 900 }, colorScheme: variant })).newPage();
    await page.goto(`${base}/?view=chat&theme=${variant}&uitheme=${id}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.waitForFunction((t) => !!document.querySelector(`.bunny-app[data-ui-theme="${t}"]`) && !!document.querySelector('.stream-indicator[data-connection="live"]'), id, { timeout: 120_000 });
    await page.waitForTimeout(1_500);
    const fit = await page.evaluate(() => {
      const nav = document.querySelector(".app-sidebar nav");
      const tops = new Set([...nav.querySelectorAll("button")].map((b) => Math.round(b.getBoundingClientRect().top)));
      const hidden = [...nav.querySelectorAll("button")].filter((b) => { const r = b.getBoundingClientRect(), n = nav.getBoundingClientRect(); return r.right > n.right + 1 || r.left < n.left - 1; }).length;
      return { scrollWidth: nav.scrollWidth, clientWidth: nav.clientWidth, rows: tops.size, hidden, fits: nav.scrollWidth <= nav.clientWidth + 1 && hidden === 0 };
    });
    // Focus the last control on the page (far below the fold) and check that it is not under the sticky masthead.
    const obscured = await page.evaluate(() => {
      const controls = [...document.querySelectorAll(".workspace-content button, .workspace-content a[href]")].filter((el) => el.getClientRects().length);
      const target = controls.at(-1);
      target.focus();
      const masthead = document.querySelector(".app-sidebar").getBoundingClientRect();
      const rect = target.getBoundingClientRect();
      // The sticky context panel's toggle (the control the keyboard walk found covered) must be on top at its centre.
      // Focused from below the fold, as the keyboard walk reaches it: focus scrolls it into view, where it must be on top.
      const toggle = [...document.querySelectorAll('button[aria-label="Context panel"]')].find((b) => b.getBoundingClientRect().width < 60);
      toggle.focus();
      const t = toggle.getBoundingClientRect();
      const hit = document.elementFromPoint(t.left + t.width / 2, t.top + t.height / 2);
      const toggleClear = !!hit && (hit === toggle || toggle.contains(hit));
      return { masthead: Math.round(masthead.bottom), top: Math.round(rect.top), toggleClear, clear: rect.top >= masthead.bottom - 1 && toggleClear };
    });
    rows.push({ theme: id, width, ...fit, focus: obscured, ok: fit.fits && obscured.clear });
    console.log(`${id} @${width}: nav ${fit.scrollWidth}/${fit.clientWidth} ${fit.fits ? "fits" : "OVERFLOWS"} in ${fit.rows} row(s); focus top ${obscured.top} vs masthead ${obscured.masthead} ${obscured.clear ? "clear" : "OBSCURED"} (context toggle ${obscured.toggleClear ? "on top" : "COVERED"})`);
    await page.context().close();
  }
}
await browser.close();
writeFileSync(out, JSON.stringify({ base, rows, ok: rows.every((r) => r.ok) }, null, 2));
console.log(JSON.stringify({ ok: rows.every((r) => r.ok), checked: rows.length }));
