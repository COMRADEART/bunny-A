// T13 interaction check against the disposable Host (43800) through the dev server (8092).
// A: edit slot 1 in the Studio, save, confirm the Host revision increments and the Personal Agents strip shows the new name.
// B: a stale save is refused by the Host; the refusal text is shown and no success is claimed.
import { chromium } from "playwright";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";

const here = resolve("test-results/ma3/t13/web");
const credentials = JSON.parse(readFileSync(resolve(here, "credentials.json"), "utf8"));
const BASE = "http://127.0.0.1:8092";
const hostUrl = `http://127.0.0.1:${credentials.port}`;
const hostAuth = { authorization: `Bearer ${credentials.token}`, "content-type": "application/json" };
assert.equal(credentials.port, 43800, "disposable Host only");

const hostState = async () => {
  const response = await fetch(`${hostUrl}/state`, { headers: hostAuth });
  return response.json();
};
const configure = async (slots, expectRevision) => {
  const response = await fetch(`${hostUrl}/command`, {
    method: "POST",
    headers: hostAuth,
    body: JSON.stringify({ action: "personal_agents.configure", data: { slots, expectRevision } }),
  });
  return { status: response.status, body: await response.json() };
};
const revisionOf = (state) => state?.personalAgents?.revision ?? state?.snapshot?.personalAgents?.revision ?? null;
const slotsOf = (state) => (state?.personalAgents ?? state?.snapshot?.personalAgents).slots.map((row) => ({
  slot: row.slot,
  weapon: row.weapon,
  displayName: row.displayName,
  description: row.description,
  purpose: row.purpose,
  style: row.style,
  responsibilities: row.responsibilities,
  agentId: row.agentId,
  active: row.active,
}));

const log = [];
const note = (step, value) => {
  log.push({ step, value });
  console.log(step, typeof value === "string" ? value : JSON.stringify(value));
};

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 240)));
page.on("pageerror", (e) => errors.push(`pageerror ${e.message.slice(0, 240)}`));
try {
  const before = await hostState();
  const startRevision = revisionOf(before);
  note("host.revision.start", startRevision);

  await page.goto(`${BASE}/?view=agents&theme=light`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.getByRole("heading", { name: "Personal Agent Studio" }).waitFor({ timeout: 60_000 });
  await page.getByText(/Revision \d+/).first().waitFor({ timeout: 60_000 });
  note("studio.revision.label", await page.getByText(/Revision \d+/).first().textContent());

  // A: happy path.
  await page.getByRole("button", { name: /Edit slot 1/ }).click();
  const editor = page.locator("section[aria-labelledby='studio-editor']");
  const runName = `Ledger ${Date.now() % 10000}`;
  await editor.getByLabel("Name").fill(runName);
  await editor.getByLabel("Description").fill("Reads and checks every receipt before filing.");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByText("Saved on your Host.").waitFor({ timeout: 30_000 });
  const afterA = await hostState();
  note("host.revision.afterSave", revisionOf(afterA));
  assert.equal(revisionOf(afterA), startRevision + 1, "the Host revision increments once");
  assert.equal(slotsOf(afterA).find((row) => row.slot === 1).displayName, runName, "the Host stores the name");
  const strip = await page.locator(".cx-panel").getByText(runName, { exact: true }).first().textContent();
  note("context.strip.shows", strip);
  assert.equal(strip, runName, "the Personal Agents strip shows the saved name");

  // B: stale save refused. The draft is dirty; an external write bumps the revision; the UI save must be refused by the Host.
  await page.getByRole("button", { name: /Edit slot 2/ }).click();
  const editor2 = page.locator("section[aria-labelledby='studio-editor']");
  await editor2.getByLabel("Name").fill("Spear Two");
  const current = await hostState();
  const external = await configure(slotsOf(current), revisionOf(current));
  assert.equal(external.status, 200, "external write accepted");
  note("host.revision.afterExternal", revisionOf(await hostState()));
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByRole("alert").waitFor({ timeout: 30_000 });
  const refusal = await page.getByRole("alert").textContent();
  note("studio.refusal.text", refusal);
  assert.match(refusal ?? "", /changed since this view was loaded/, "the Host's refusal words are shown");
  assert.equal(await page.getByText("Saved on your Host.").count(), 0, "no success claim after a refusal; the earlier notice is cleared by the new edit");
  const afterB = await hostState();
  assert.equal(slotsOf(afterB).find((row) => row.slot === 2).displayName, "Spear", "the refused edit is not stored");
  note("host.slot2.name", slotsOf(afterB).find((row) => row.slot === 2).displayName);

  note("console.errors", errors);
} catch (error) {
  note("failure", String(error?.message ?? error));
  note("console.errors", errors);
  writeFileSync(resolve(here, "studio-interaction.png.txt"), "failure");
  await page.screenshot({ path: resolve(here, "shots", "studio-interaction-failure.png") }).catch(() => {});
  process.exitCode = 1;
} finally {
  await page.screenshot({ path: resolve(here, "shots", "studio-interaction-final.png") }).catch(() => {});
  await browser.close();
  writeFileSync(resolve(here, "studio-interaction.json"), JSON.stringify(log, null, 2) + "\n");
  console.log(existsSync(resolve(here, "studio-interaction.json")) ? "wrote studio-interaction.json" : "no log");
}
