import { chromium } from "playwright";
const b = await chromium.launch({ headless: true });
const p = await b.newPage({ viewport: { width: 1366, height: 768 }, colorScheme: "dark" });
const errs = []; p.on("pageerror", (e) => errs.push(String(e.message).slice(0, 200)));
for (const v of ["chat", "agents", "missions"]) {
  await p.goto(`http://127.0.0.1:8094/?view=${v}&theme=dark`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await p.waitForTimeout(6000);
  const info = await p.evaluate(() => ({ weapons: [...document.querySelectorAll(".wc-weapon")].map((e) => [e.dataset.weapon, e.dataset.state, e.dataset.slot, e.dataset.cue ?? null, e.querySelector("img")?.alt]), companions: document.querySelectorAll(".wc-companion").length, text: document.body.innerText.slice(0, 300).replace(/\n+/g, " | ") }));
  console.log(v, JSON.stringify(info));
}
console.log("errors", errs);
await b.close();
