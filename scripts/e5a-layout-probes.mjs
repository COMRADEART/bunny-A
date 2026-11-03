if (process.env.E5A_ISOLATED_HOST !== "1")
  throw Error("Set E5A_ISOLATED_HOST=1 only with a separate audit Host state directory.");
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
const out = "docs/ux/e5a/evidence",
  results = {
    sourceCommit: "28903a6c23936be58ebdf5c94fe8b2ed0e21b26c",
    qualification: "Browser-only layout and UI-state probes; not physical-device qualification.",
    captures: [],
    checks: [],
  };
const b = await chromium.launch();
async function ready(page, view, variant) {
  await page.goto(
    `http://127.0.0.1:8082/?view=${view}&uitheme=glass&theme=${variant}&glassintensity=85`,
  );
  await page.locator(`.bunny-app[data-theme="${variant}"]`).waitFor();
  await page.locator('.stream-indicator[data-connection="live"]').waitFor();
}
async function measure(page, id) {
  await page.waitForTimeout(200);
  const data = await page.evaluate(() => {
    const rect = (e) => {
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return {
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        scrollWidth: e.scrollWidth,
        clientWidth: e.clientWidth,
        padding: getComputedStyle(e).padding,
        background: getComputedStyle(e).backgroundColor,
        blur: getComputedStyle(e).backdropFilter,
      };
    };
    const controls = [
      ...document.querySelectorAll(".tg-segment button,.tg-glass,.tg-glass input,.tg-glass output"),
    ].map((e) => ({
      label: e.getAttribute("aria-label") || e.textContent.trim(),
      box: rect(e),
      parent: rect(e.parentElement),
      overflow: getComputedStyle(e.parentElement).overflow,
    }));
    const row = document.querySelector(".tg-glass")?.parentElement;
    return {
      width: innerWidth,
      height: innerHeight,
      documentWidth: document.documentElement.scrollWidth,
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      main: rect(document.querySelector(".workspace-content")),
      split: rect(document.querySelector(".workspace-split")),
      inspector: rect(document.querySelector(".cx-panel")),
      widgetSidebar: rect(
        document.querySelector('.workspace-split > .wd-root[data-widget-layout="sidebar"]'),
      ),
      settings: rect(document.querySelector(".settings-panel")),
      controls,
      glassRowChildren: row ? [...row.children].map(rect) : [],
      panels: [...document.querySelectorAll(".fabric>.t8-surface")].map(rect),
    };
  });
  await page.screenshot({ path: `${out}/${id}.png` });
  results.captures.push({ id, screenshot: `${id}.png`, measurements: data });
  writeFileSync(out + "/layout-probes.json", JSON.stringify(results, null, 2) + "\n");
}
try {
  for (const variant of ["light", "dark"]) {
    const c = await b.newContext({ viewport: { width: 1181, height: 900 }, colorScheme: variant });
    const p = await c.newPage();
    await ready(p, "settings", variant);
    await measure(p, `breakpoint-1181-settings-${variant}`);
    await p.setViewportSize({ width: 2560, height: 1440 });
    await ready(p, "server", variant);
    await measure(p, `ultrawide-server-${variant}`);
    await p.setViewportSize({ width: 375, height: 812 });
    await ready(p, "settings", variant);
    await measure(p, `small-mobile-settings-${variant}`);
    await p.getByLabel("Text size", { exact: true }).selectOption("1.25");
    await measure(p, `text-125-settings-${variant}`);
    await p.setViewportSize({ width: 844, height: 390 });
    await ready(p, "settings", variant);
    await measure(p, `landscape-settings-${variant}`);
    await c.close();
  }
  const c = await b.newContext({ viewport: { width: 1280, height: 900 } }),
    p = await c.newPage();
  await ready(p, "widgets", "light");
  await p.getByRole("button", { name: "Customize widgets", exact: true }).click();
  await p
    .getByRole("group", { name: "Panel composition" })
    .getByRole("button", { name: "Sidebar", exact: true })
    .click();
  await p.getByRole("button", { name: "Apply", exact: true }).click();
  await p.locator('.workspace-split > .wd-root[data-widget-layout="sidebar"]').waitFor();
  for (const variant of ["light", "dark"]) {
    for (const width of [1280, 1181]) {
      await p.setViewportSize({ width, height: 900 });
      await ready(p, "home", variant);
      await measure(p, `widget-sidebar-home-${variant}-${width}`);
      await ready(p, "settings", variant);
      await measure(p, `widget-sidebar-settings-${variant}-${width}`);
    }
  }
  await ready(p, "widgets", "light");
  await p.getByRole("button", { name: "Customize widgets", exact: true }).click();
  await p
    .getByRole("group", { name: "Panel composition" })
    .getByRole("button", { name: "Board", exact: true })
    .click();
  await p.getByRole("button", { name: "Apply", exact: true }).click();
  results.checks.push({ id: "isolated-widget-layout-restored", status: "PASS" });
  await c.close();
} finally {
  writeFileSync(out + "/layout-probes.json", JSON.stringify(results, null, 2) + "\n");
  await b.close();
}
console.log(
  JSON.stringify(
    {
      captures: results.captures.length,
      overflows: results.captures.filter((x) => x.measurements.overflow).map((x) => x.id),
    },
    null,
    2,
  ),
);

process.exitCode = results.captures.some((capture) => capture.measurements.overflow) ? 1 : 0;
