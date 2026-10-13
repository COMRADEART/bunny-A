// M-A-3 T13 phone browser simulation driver (NOT physical-phone acceptance).
// Drives the real Phone (src/components/island/phone.tsx) through the temporary harness page on the dev server
// (127.0.0.1:8093) against the DISPOSABLE Host (438xx) seeded by seed-host.mjs. Device, offline, stale, pairing and
// host-changed states are simulated by overriding store fields in the harness; every other value is the Host's own.
// Writes screenshots under phone/shots and a JSON report of tap-target, overflow and contrast measurements.
// Credentials are read into memory only and never written to the report.
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const here = resolve(import.meta.dirname);
const shots = join(here, "shots");
mkdirSync(shots, { recursive: true });
const hostState = JSON.parse(readFileSync(join(here, "host-state.json"), "utf8"));
const credentials = JSON.parse(readFileSync(hostState.credentialsFile, "utf8"));
const hostGet = async (path) => (await fetch(`http://127.0.0.1:${credentials.port}${path}`, { headers: { authorization: `Bearer ${credentials.token}` } })).json();
const snapshot = await hostGet("/state");
const missionOf = (name) => snapshot.agents.agents.find((agent) => agent.name === name)?.missionId ?? null;
const waitingMission = missionOf("Permission review");
const verifiedMission = missionOf("Receipt verification");

const BASE = "http://127.0.0.1:8093/";
const DARK = { appearance: { theme: "dark", motion: "full" } };
const LIGHT = { appearance: { theme: "light", motion: "full" } };
const now = () => Date.now();
const offline = { connection: { state: "offline", snapshotAt: now() - 120_000, streamAt: null, streamOpenedAt: null, streamErrors: 0, readFailures: 2, pairingCode: null } };
const stale = { connection: { state: "polling", snapshotAt: now() - 60_000, streamAt: null, streamOpenedAt: null, streamErrors: 0, readFailures: 0, pairingCode: null } };
const pairing = { pairingRequired: true, connection: { state: "pairing", snapshotAt: null, streamAt: null, streamOpenedAt: null, streamErrors: 0, readFailures: 0, pairingCode: "AUTH_REQUIRED" } };
const hostChanged = { connection: { state: "host-changed", snapshotAt: now() - 2_000, streamAt: null, streamOpenedAt: null, streamErrors: 0, readFailures: 0, pairingCode: null } };
const device = (rights) => ({ viewer: { kind: "device", deviceId: "dev-sim-1", name: "Phone companion (simulated)", role: "paired-device", pairedAt: now() - 86_400_000, expiresAt: now() + 30 * 86_400_000, lastSeenAt: now(), rights } });
const FULL = ["agent.get", "agent.list", "agent.pause", "agent.resume", "agent.stop", "mission.respond", "mission.approve", "submit", "device.revoke"];
const READ_ONLY = ["agent.get", "agent.list", "mission.get", "project.list"];

const CORE = [
  { name: "home", query: "", overrides: DARK },
  { name: "agent-verified", query: "?slot=1", overrides: DARK },
  { name: "agent-waiting", query: "?slot=2", overrides: DARK },
  { name: "agent-paused", query: "?slot=3", overrides: DARK },
  { name: "missions", query: "?tab=missions", overrides: DARK },
  { name: "mission-detail", query: `?mission=${waitingMission}`, overrides: DARK },
  { name: "chat", query: "?tab=chat", overrides: DARK },
  { name: "agents", query: "?tab=agents", overrides: DARK },
  { name: "settings", query: "?tab=settings", overrides: DARK },
  { name: "offline", query: "", overrides: { ...DARK, ...offline } },
  { name: "stale", query: "", overrides: { ...DARK, ...stale } },
  { name: "pairing", query: "", overrides: { ...DARK, ...pairing } },
];
const EXTRA = [
  { name: "home-light", query: "", overrides: LIGHT },
  { name: "host-changed", query: "", overrides: { ...DARK, ...hostChanged } },
  { name: "device-home", query: "", overrides: { ...DARK, ...device(FULL) } },
  { name: "device-agent-detail", query: "?slot=2", overrides: { ...DARK, ...device(FULL) } },
  { name: "device-readonly-home", query: "", overrides: { ...DARK, ...device(READ_ONLY) } },
];
const VIEWPORTS = [
  { w: 320, h: 640, label: "320" },
  { w: 375, h: 812, label: "375" },
  { w: 390, h: 844, label: "390" },
  { w: 430, h: 932, label: "430" },
  { w: 844, h: 390, label: "landscape" },
];

// Runs inside the page: overflow, tap targets, and text contrast over the composited background.
const measure = () => {
  const root = document.querySelector("#t13-mount .pc-root");
  if (!root) return { missing: true };
  const parse = (value) => {
    const m = value.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const hex = (value) => {
    const m = value.trim().match(/^#([0-9a-f]{6})$/i);
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  };
  const over = (top, bottom) => ({ r: top.r * top.a + bottom.r * (1 - top.a), g: top.g * top.a + bottom.g * (1 - top.a), b: top.b * top.a + bottom.b * (1 - top.a), a: 1 });
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
  const pageBase = hex(getComputedStyle(root).getPropertyValue("--pc-bg")) ?? { r: 255, g: 255, b: 255, a: 1 };
  const backdropFor = (el) => {
    const chain = [];
    for (let node = el; node && node !== document.documentElement; node = node.parentElement) chain.unshift(node);
    let bg = pageBase;
    for (const node of chain) {
      const color = parse(getComputedStyle(node).backgroundColor);
      if (color && color.a > 0) bg = over(color, bg);
    }
    return bg;
  };
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
  const doc = document.documentElement;
  const overflowX = doc.scrollWidth - doc.clientWidth;
  const smallTargets = [];
  for (const el of root.querySelectorAll("button, a[href]")) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 44 || r.height < 44) smallTargets.push({ label: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 40), w: Math.round(r.width), h: Math.round(r.height) });
  }
  const lowContrast = [];
  let checked = 0;
  let minRatio = Infinity;
  for (const el of root.querySelectorAll("*")) {
    const direct = [...el.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim().length > 0);
    if (!direct || !visible(el) || el.closest("button:disabled")) continue;
    const style = getComputedStyle(el);
    const fg0 = parse(style.color);
    if (!fg0) continue;
    const bg = backdropFor(el);
    const fg = over(fg0, bg);
    const r = ratio(fg, bg);
    const size = parseFloat(style.fontSize);
    const bold = Number(style.fontWeight) >= 700;
    const need = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
    checked++;
    minRatio = Math.min(minRatio, r);
    if (r < need) lowContrast.push({ text: el.textContent.trim().slice(0, 40), ratio: Math.round(r * 100) / 100, need, size });
  }
  return { overflowX, smallTargets, lowContrast, checked, minRatio: Number.isFinite(minRatio) ? Math.round(minRatio * 100) / 100 : null, status: root.getAttribute("data-status"), motion: root.getAttribute("data-motion") };
};

const browser = await chromium.launch({ headless: true });
const report = { classification: "BROWSER SIMULATION (not physical-phone acceptance)", host: { port: hostState.port, classification: hostState.classification }, shots: [] };
const runOne = async (scenario, viewport) => {
  const context = await browser.newContext({ viewport: { width: viewport.w, height: viewport.h }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text().slice(0, 200)); });
  page.on("pageerror", (err) => errors.push(`pageerror: ${String(err.message).slice(0, 200)}`));
  const url = `${BASE}?companion=1${scenario.query ? `&${scenario.query.slice(1)}` : ""}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForSelector(".pc-root", { timeout: 60_000 });
  await page.evaluate(() => import("/src/t13-phone-harness.tsx"));
  await page.waitForSelector("#t13-mount .pc-root", { timeout: 60_000 });
  await page.evaluate((overrides) => window.__t13.apply(overrides), scenario.overrides);
  await page.waitForTimeout(1800);
  const metrics = await page.evaluate(measure);
  const name = `${scenario.name}-${viewport.label}`;
  await page.screenshot({ path: join(shots, `${name}.png`), fullPage: false });
  report.shots.push({ name, viewport: `${viewport.w}x${viewport.h}`, ...metrics, consoleErrors: errors.slice(0, 5) });
  await context.close();
  console.log(`${name}: overflow=${metrics.overflowX} smallTargets=${metrics.smallTargets?.length} lowContrast=${metrics.lowContrast?.length} minRatio=${metrics.minRatio} status=${metrics.status} errors=${errors.length}`);
};

const only = process.argv[2] ? process.argv[2].split(",") : null;
for (const scenario of CORE) {
  if (only && !only.includes(scenario.name)) continue;
  for (const viewport of VIEWPORTS) await runOne(scenario, viewport);
}
for (const scenario of EXTRA) {
  if (only && !only.includes(scenario.name)) continue;
  await runOne(scenario, VIEWPORTS[2]);
}
await browser.close();
writeFileSync(join(here, "report.json"), JSON.stringify(report, null, 2) + "\n");
console.log(`wrote report with ${report.shots.length} shots`);
