// Supplementary DOM checks: positive tabindex, autofocus, approval actions,
// connection banner semantics, error-state roles.
import { writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { chromium } from "playwright";

const dir = resolve(import.meta.dirname);
const browser = await chromium.launch();
try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e).slice(0, 200)));
  await page.goto("http://127.0.0.1:8080/", { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(1200);
  const home = await page.evaluate(() => ({
    positiveTabindex: [...document.querySelectorAll("[tabindex]")].filter((e) => Number(e.getAttribute("tabindex")) > 0).length,
    autofocus: [...document.querySelectorAll("[autofocus],#task-prompt")].map((e) => e.tagName + "#" + (e.id || "")).slice(0, 5),
    banner: [...document.querySelectorAll("[class*=anner],[class*=onnection]")].slice(0, 6).map((e) => ({ cls: e.className.toString().slice(0, 50), role: e.getAttribute("role"), live: e.getAttribute("aria-live"), text: (e.textContent || "").trim().slice(0, 80) })),
    handoff: document.body.innerHTML.includes("Agent handoff"),
  }));
  await page.goto("http://127.0.0.1:8080/?view=approvals", { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(1200);
  const appr = await page.evaluate(() => ({
    buttons: [...document.querySelectorAll("button")].filter((b) => b.getClientRects().length > 0).map((b) => (b.getAttribute("aria-label") || b.textContent || "").trim().replace(/\s+/g, " ").slice(0, 50)),
    alerts: [...document.querySelectorAll("[role=alert]")].map((e) => e.textContent.trim().slice(0, 100)),
    statuses: [...document.querySelectorAll("[role=status]")].map((e) => e.textContent.trim().slice(0, 100)).slice(0, 6),
    dialogRoles: document.querySelectorAll("[role=dialog],[role=alertdialog]").length,
  }));
  const out = { home, approvals: appr, pageerrors: errs, finished: true };
  writeFileSync(join(dir, "a11y-supplement.json"), JSON.stringify(out, null, 2) + "\n");
  console.log("positiveTabindex:", home.positiveTabindex);
  console.log("autofocus:", JSON.stringify(home.autofocus));
  console.log("approval buttons:", appr.buttons.length, JSON.stringify(appr.buttons.slice(0, 12)));
  console.log("dialogRoles:", appr.dialogRoles, "alerts:", appr.alerts.length);
} finally {
  await browser.close();
}
