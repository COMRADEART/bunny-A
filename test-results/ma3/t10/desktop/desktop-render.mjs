// M-A-3 T10 desktop render check: a DISPOSABLE Host (temp data dir, non-production port) plus the dev web UI bound to
// 127.0.0.1 only (never 0.0.0.0, never 8080/8084), driven headless by Playwright. Opens a voice session from the
// composer, sends a typed fallback turn, captures desktop + mobile screenshots and the console. Production untouched.
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright";
import { startHost } from "../live/host-driver.mjs";

const root = resolve(import.meta.dirname, "../../../..");
const outDir = import.meta.dirname;
mkdirSync(outDir, { recursive: true });
const host = await startHost({ port: 43861 });
const uiPort = 8095;
const vite = spawn(process.execPath, ["scripts/with-app-env.mjs", process.execPath, "node_modules/vite/bin/vite.js", "dev", "--host", "127.0.0.1", "--port", String(uiPort), "--strictPort"], {
  cwd: root,
  env: { ...process.env, BUNNY_HOST_DATA_DIRECTORY: host.dir },
  stdio: ["ignore", "pipe", "pipe"],
});
let viteLog = "";
vite.stdout.on("data", (d) => (viteLog += d));
vite.stderr.on("data", (d) => (viteLog += d));
const receipt = { classification: "LIVE render: disposable Host + loopback dev UI, headless Chromium", hostPort: host.port, uiPort, steps: [], console: [] };
const browser = await chromium.launch();
try {
  for (let i = 0; i < 120; i++) { try { if ((await fetch(`http://127.0.0.1:${uiPort}/`)).ok) break; } catch { /* starting */ } await sleep(500); }
  for (const view of [{ name: "desktop", width: 1440, height: 900 }, { name: "mobile", width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport: { width: view.width, height: view.height } });
    page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") receipt.console.push({ view: view.name, type: m.type(), text: m.text().slice(0, 400) }); });
    page.on("pageerror", (e) => receipt.console.push({ view: view.name, type: "pageerror", text: String(e).slice(0, 400) }));
    await page.goto(`http://127.0.0.1:${uiPort}/`, { waitUntil: "networkidle", timeout: 90000 });
    await page.getByText(/Live|Host connected/).first().waitFor({ timeout: 30000 }).catch(() => {});
    await sleep(2500);
    await page.screenshot({ path: join(outDir, `${view.name}-home.png`) });
    // The composer (and its mic entry point) lives in Bunny chat; "Ask Bunny" opens it from Home.
    const ask = page.getByRole("button", { name: "Ask Bunny" }).first();
    if (await ask.count()) { await ask.click(); await sleep(1200); }
    const start = page.getByRole("button", { name: /Start voice session/i }).first();
    const found = (await start.count()) > 0;
    receipt.steps.push({ view: view.name, step: "start-button-found", found });
    if (!found) { await page.close(); continue; }
    await start.click();
    await page.getByRole("region", { name: /Voice session/i }).first().waitFor({ timeout: 20000 }).catch(() => {});
    await sleep(1500);
    await page.screenshot({ path: join(outDir, `${view.name}-voice-open.png`) });
    const vs = (await host.command("voice.state")).body.data;
    receipt.steps.push({ view: view.name, step: "session-open", open: vs?.open, state: vs?.state, capturing: vs?.capturing, engines: vs?.engines });
    const typed = page.getByRole("textbox").filter({ hasText: "" }).last();
    const input = page.locator(".voice-panel input, .voice-panel textarea").first();
    if (await input.count()) {
      await input.fill("What is my agent doing?");
      await input.press("Enter");
      for (let i = 0; i < 60; i++) { const s = (await host.command("voice.state")).body.data; if (s?.answer && !s.playing) break; await sleep(500); }
      await sleep(1200);
      await page.screenshot({ path: join(outDir, `${view.name}-voice-answer.png`) });
      const s = (await host.command("voice.state")).body.data;
      receipt.steps.push({ view: view.name, step: "typed-turn", kind: s?.turnKind, answer: s?.answer, answerSource: s?.answerSource, state: s?.state });
    } else receipt.steps.push({ view: view.name, step: "typed-input-missing", note: String(typed) });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    receipt.steps.push({ view: view.name, step: "horizontal-overflow", overflow });
    const end = page.getByRole("button", { name: /End session/i }).first();
    if (await end.count()) await end.click();
    await sleep(1500);
    const after = (await host.command("voice.state")).body.data;
    receipt.steps.push({ view: view.name, step: "end-session", open: after?.open, capturing: after?.capturing, playing: after?.playing });
    await page.close();
  }
} finally {
  await browser.close();
  vite.kill();
  await host.command("voice.session.close").catch(() => {});
  await host.stop();
  receipt.viteLogTail = viteLog.slice(-1500);
  writeFileSync(join(outDir, "desktop-render-receipt.json"), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify({ steps: receipt.steps, consoleCount: receipt.console.length }, null, 1));
}
