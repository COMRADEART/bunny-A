// M-A-3 T13 phone RE-CAPTURE (wave 3). BROWSER SIMULATION, not physical-phone acceptance.
// Drives the REAL app at /?companion=1 on the dev server (127.0.0.1:8097) against a DISPOSABLE Host on 43890 seeded by
// final/seed-host.mjs. Nothing is overridden in the page: every status is the Host's own answer, except where a phase
// labels a network stall (route hold) or a wrong credential. Only exact PIDs started by this harness are stopped.
// Usage: node capture.mjs <phase>   phases: live | pairing | stale | host-changed | offline
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync, copyFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const here = resolve(import.meta.dirname);
const repo = resolve(here, "../../../../..");
const SCR = "C:/Users/allam/AppData/Local/Temp/claude/C--Users-allam-Documents-new-bun-router/35b0c361-0c81-44b1-8728-b68995af842f/scratchpad";
const HOST_ROOT = `${SCR}/t13-phone-final-host`;
const DATA = `${HOST_ROOT}/state`;
const WORK = `${HOST_ROOT}/workspace`;
const HOST_CREDS = `${DATA}/credentials.json`;
const DEV_CREDS = `${SCR}/dev-credentials.json`;
const PORT = 43890;
const BASE = "http://127.0.0.1:8097/";
const phase = process.argv[2];
if (!phase) throw new Error("phase required");
const shotsDir = join(here, "shots", phase);
mkdirSync(shotsDir, { recursive: true });
const hostState = JSON.parse(readFileSync(join(here, "host-state.json"), "utf8"));
if (hostState.port !== PORT) throw new Error("refusing: host-state port is not the assigned 43890");
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), phase, ...a);

const readHostCreds = () => JSON.parse(readFileSync(HOST_CREDS, "utf8"));
const hostGet = async (path, token) => {
  const r = await fetch(`http://127.0.0.1:${PORT}${path}`, { headers: { authorization: `Bearer ${token}` } });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const stateAgents = async () => {
  const c = readHostCreds();
  return (await hostGet("/state", c.token)).body;
};
const killPid = (pid) => { try { execFileSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* already gone */ } };
const hostAlive = async () => { try { const c = readHostCreds(); return (await hostGet("/state", c.token)).status === 200; } catch { return false; } };

// Runs inside the page: overflow, tap targets (44 px) and text contrast over the composited background.
const measure = () => {
  const root = document.querySelector(".pc-root");
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
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
  };
  const doc = document.documentElement;
  const overflowX = doc.scrollWidth - doc.clientWidth;
  const rootOverflowX = root.scrollWidth - root.clientWidth;
  const smallTargets = [];
  let targets = 0;
  const targetSel = "button, a[href], input, select, textarea, [role='button'], [role='tab'], [role='switch'], [role='checkbox']";
  for (const el of root.querySelectorAll(targetSel)) {
    if (el.closest(".skip-link") || !visible(el)) continue;
    targets++;
    const r = el.getBoundingClientRect();
    if (r.width < 44 || r.height < 44) {
      smallTargets.push({
        label: (el.getAttribute("aria-label") || el.textContent || el.getAttribute("placeholder") || el.tagName).trim().replace(/\s+/g, " ").slice(0, 48),
        tag: el.tagName.toLowerCase(),
        w: Math.round(r.width * 10) / 10,
        h: Math.round(r.height * 10) / 10,
        disabled: !!el.disabled,
      });
    }
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
    if (r < need) lowContrast.push({ text: el.textContent.trim().slice(0, 48), ratio: Math.round(r * 100) / 100, need, size });
  }
  const text = root.innerText.replace(/\s+/g, " ");
  return {
    status: root.getAttribute("data-status"),
    motion: root.getAttribute("data-motion"),
    overflowX,
    rootOverflowX,
    targets,
    smallTargets,
    lowContrast,
    checked,
    minRatio: Number.isFinite(minRatio) ? Math.round(minRatio * 100) / 100 : null,
    text: text.slice(0, 600),
    keywords: {
      voiceOnPc: text.includes("Voice is available on your PC"),
      talkToBunny: text.includes("Talk to Bunny"),
      thisWorkstation: text.includes("This workstation"),
      pairedDevice: text.includes("Paired device"),
      lastKnown: text.includes("Showing last known state"),
      unreachable: text.includes("unreachable"),
      pairingRequired: text.includes("Pairing required"),
      differentHost: text.includes("Different Bunny-A Host"),
      connecting: text.includes("Connecting to Host"),
    },
  };
};

const SCREENS = [
  { name: "home", query: "" },
  { name: "agent-verified", query: "?slot=1" },
  { name: "agent-waiting", query: "?slot=2" },
  { name: "agent-paused", query: "?slot=3" },
  { name: "agent-idle", query: "?slot=4" },
  { name: "agents", query: "?tab=agents" },
  { name: "missions", query: "?tab=missions" },
  { name: "mission-detail", query: "__MISSION__" },
  { name: "chat", query: "?tab=chat" },
  { name: "settings", query: "?tab=settings" },
];
const VIEWPORTS = [
  { w: 320, h: 640, label: "320" },
  { w: 375, h: 812, label: "375" },
  { w: 390, h: 844, label: "390" },
  { w: 430, h: 932, label: "430" },
  { w: 844, h: 390, label: "landscape-844x390" },
];

const browser = await chromium.launch({ headless: true });
const report = {
  classification: "BROWSER SIMULATION (not physical-phone acceptance). Page = LIVE real app at /?companion=1; Host = LIVE disposable Host on 43890.",
  phase,
  dev: { port: 8097, classification: "LIVE dev server (repo working tree)" },
  host: { port: PORT, seed: hostState.classification },
  runs: [],
};

const newPage = async (viewport, extraRoutes = null) => {
  const context = await browser.newContext({ viewport: { width: viewport.w, height: viewport.h }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const errors = [];
  const requests = new Set();
  page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text().slice(0, 240)); });
  page.on("pageerror", (err) => errors.push(`pageerror: ${String(err.message).slice(0, 240)}`));
  page.on("request", (req) => { try { const u = new URL(req.url()); if (u.origin === new URL(BASE).origin && !u.pathname.startsWith("/src/") && !u.pathname.startsWith("/@") && !u.pathname.startsWith("/node_modules/")) requests.add(`${req.method()} ${u.pathname}`); } catch { /* ignore */ } });
  if (extraRoutes) await extraRoutes(page);
  return { context, page, errors, requests };
};

const waitStatus = async (page, statuses, timeout) => {
  const list = Array.isArray(statuses) ? statuses : [statuses];
  try {
    await page.waitForFunction((l) => l.includes(document.querySelector(".pc-root")?.getAttribute("data-status")), list, { timeout, polling: 250 });
    return true;
  } catch { return false; }
};

const capture = async (page, errors, requests, name, viewport, { fullPage = false } = {}) => {
  await sleep(1200);
  const metrics = await page.evaluate(measure);
  const file = `${name}-${viewport.label}.png`;
  await page.screenshot({ path: join(shotsDir, file), fullPage });
  const run = { name, viewport: `${viewport.w}x${viewport.h}`, screenshot: `shots/${phase}/${file}`, ...metrics, consoleErrors: errors.slice(0, 8), serverRequests: [...requests].slice(0, 20) };
  report.runs.push(run);
  log(`${name}@${viewport.label}: status=${run.status} overflow=${run.overflowX}/${run.rootOverflowX} small=${run.smallTargets.length}/${run.targets} lowC=${run.lowContrast.length} minR=${run.minRatio} errs=${errors.length}`);
  return run;
};

const flush = () => writeFileSync(join(here, `report-${phase}.json`), JSON.stringify(report, null, 2) + "\n");

const missionFor = async (name) => {
  const snap = await stateAgents();
  return snap?.agents?.agents?.find((a) => a.name === name)?.missionId ?? null;
};

try {
  if (phase === "live") {
    const waitingMission = await missionFor("Permission review");
    report.missionUsed = waitingMission ? "Permission review" : null;
    for (const viewport of VIEWPORTS) {
      for (const screen of SCREENS) {
        const query = screen.query === "__MISSION__" ? `?mission=${waitingMission}` : screen.query;
        const { context, page, errors, requests } = await newPage(viewport);
        const url = `${BASE}?companion=1${query.startsWith("?") ? "&" + query.slice(1) : ""}`;
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
        await page.waitForSelector(".pc-root", { timeout: 60_000 });
        const live = await waitStatus(page, "live", 45_000);
        const run = await capture(page, errors, requests, screen.name, viewport, { fullPage: viewport.label === "390" });
        run.reachedLive = live;
        await context.close();
      }
    }
    // Host-side truth for the states the screens show (the Host's own presentation per slot).
    const snap = await stateAgents();
    report.hostPersonalAgents = (snap?.personalAgents?.slots ?? []).map((s) => ({ slot: s.slot, weapon: s.weapon, agent: s.agent?.name ?? null, state: s.presentation?.state ?? null, label: s.presentation?.label ?? null }));
  } else if (phase === "pairing") {
    // The page is pointed at a WRONG token for a live Host: the Host answers 401 and the page must show pairing.
    writeFileSync(DEV_CREDS, JSON.stringify({ token: "t13-wrong-token-not-the-host", port: PORT }));
    for (const viewport of [VIEWPORTS[0], VIEWPORTS[2]]) {
      const { context, page, errors, requests } = await newPage(viewport);
      await page.goto(`${BASE}?companion=1`, { waitUntil: "domcontentloaded", timeout: 90_000 });
      await page.waitForSelector(".pc-root", { timeout: 60_000 });
      const reached = await waitStatus(page, "pairing", 60_000);
      const run = await capture(page, errors, requests, "pairing", viewport);
      run.reachedExpectedState = reached;
      await context.close();
    }
    const c = readHostCreds();
    writeFileSync(DEV_CREDS, JSON.stringify(c));
  } else if (phase === "stale") {
    // Live Host, but the page's server calls are held (no response). The retained view must present as stale.
    writeFileSync(DEV_CREDS, JSON.stringify(readHostCreds()));
    for (const viewport of [VIEWPORTS[0], VIEWPORTS[2]]) {
      const hold = async (page) => {
        await page.route((url) => url.pathname.includes("_serverFn") || url.pathname.startsWith("/api"), () => { /* never answered: a stalled network */ });
      };
      const { context, page, errors, requests } = await newPage(viewport, null);
      await page.goto(`${BASE}?companion=1`, { waitUntil: "domcontentloaded", timeout: 90_000 });
      await page.waitForSelector(".pc-root", { timeout: 60_000 });
      const live = await waitStatus(page, "live", 45_000);
      await hold(page);
      const seen = [];
      const started = Date.now();
      let reached = false;
      while (Date.now() - started < 60_000) {
        const s = await page.evaluate(() => document.querySelector(".pc-root")?.getAttribute("data-status"));
        seen.push(`${Math.round((Date.now() - started) / 1000)}s:${s}`);
        if (s === "stale") { reached = true; break; }
        await sleep(1000);
      }
      const run = await capture(page, errors, requests, "stale", viewport);
      run.reachedLiveBeforeStall = live;
      run.reachedStale = reached;
      run.statusTrajectory = seen.slice(-40);
      await context.close();
    }
  } else if (phase === "host-changed") {
    // A live page sees the Host go away; a NEW Host instance (new generation, same credentials path and port) answers.
    writeFileSync(DEV_CREDS, JSON.stringify(readHostCreds()));
    const viewport = VIEWPORTS[2];
    const { context, page, errors, requests } = await newPage(viewport);
    await page.goto(`${BASE}?companion=1`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.waitForSelector(".pc-root", { timeout: 60_000 });
    const live = await waitStatus(page, "live", 45_000);
    report.beforeSwap = { live, instance: readHostCreds().instanceId };
    killPid(hostState.pid);
    log("stopped Host1 pid", hostState.pid);
    const child = spawn(process.execPath, ["--experimental-strip-types", join(repo, "scripts/fixtures/project-host-worker.mjs"), DATA, WORK, String(PORT)], { cwd: repo, stdio: "ignore", windowsHide: true });
    report.host2Pid = child.pid;
    let up = false;
    for (let i = 0; i < 150 && !up; i++) { await sleep(400); up = await hostAlive(); }
    report.host2Up = up;
    const creds2 = readHostCreds();
    report.afterSwap = { instance: creds2.instanceId };
    writeFileSync(DEV_CREDS, JSON.stringify(creds2));
    log("Host2 pid", child.pid, "up", up, "instance", creds2.instanceId);
    const seen = [];
    const started = Date.now();
    let reached = false;
    while (Date.now() - started < 120_000) {
      const s = await page.evaluate(() => document.querySelector(".pc-root")?.getAttribute("data-status"));
      seen.push(`${Math.round((Date.now() - started) / 1000)}s:${s}`);
      if (s === "host-changed") { reached = true; break; }
      await sleep(1000);
    }
    const run = await capture(page, errors, requests, "host-changed", viewport);
    run.reachedHostChanged = reached;
    run.statusTrajectory = seen.slice(-60);
    await context.close();
    report.host2 = { pid: child.pid, instance: creds2.instanceId };
    killPid(child.pid);
    await sleep(800);
  } else if (phase === "offline") {
    // Host live -> page opened and live -> Host stopped while the page is open -> the page must show unreachable.
    writeFileSync(DEV_CREDS, JSON.stringify(readHostCreds()));
    let currentHostPid = Number(process.env.T13_OFFLINE_HOST_PID ?? 0);
    if (!currentHostPid) throw new Error("T13_OFFLINE_HOST_PID required (the live Host started by this harness)");
    report.offlineHostPid = currentHostPid;
    for (const viewport of [VIEWPORTS[0], VIEWPORTS[2]]) {
      const { context, page, errors, requests } = await newPage(viewport);
      await page.goto(`${BASE}?companion=1`, { waitUntil: "domcontentloaded", timeout: 90_000 });
      await page.waitForSelector(".pc-root", { timeout: 60_000 });
      const live = await waitStatus(page, "live", 45_000);
      killPid(currentHostPid);
      const seen = [];
      const started = Date.now();
      let reached = false;
      while (Date.now() - started < 150_000) {
        const s = await page.evaluate(() => document.querySelector(".pc-root")?.getAttribute("data-status"));
        seen.push(`${Math.round((Date.now() - started) / 1000)}s:${s}`);
        if (s === "offline") { reached = true; break; }
        await sleep(1000);
      }
      const run = await capture(page, errors, requests, "offline", viewport);
      run.reachedLiveBeforeStop = live;
      run.reachedOffline = reached;
      run.statusTrajectory = seen.slice(-60);
      await context.close();
      // Restart the Host on the same data for the second viewport so the offline capture at 390 starts from live.
      if (viewport === VIEWPORTS[0]) {
        const child = spawn(process.execPath, ["--experimental-strip-types", join(repo, "scripts/fixtures/project-host-worker.mjs"), DATA, WORK, String(PORT)], { cwd: repo, stdio: "ignore", windowsHide: true });
        for (let i = 0; i < 150; i++) { await sleep(400); if (await hostAlive()) break; }
        writeFileSync(DEV_CREDS, JSON.stringify(readHostCreds()));
        currentHostPid = child.pid;
        report.restartedForSecondViewport = { pid: child.pid };
      }
    }
    // Stop whatever Host this phase left running (exact pid only).
    killPid(currentHostPid);
  } else {
    throw new Error(`unknown phase ${phase}`);
  }
} finally {
  await browser.close();
  flush();
  log("wrote", join(here, `report-${phase}.json`), "runs", report.runs.length);
}
