/**
 * E6A item 5 — populated approval, consent, artifact, device and Server Control states, exercised
 * on the authorized isolated harness: the desktop adapter (:8082) with an isolated Host state
 * directory whose Host answers the real loopback API. Every row is created by the Host's own
 * authenticated commands (Bearer from credentials.json) — never a mocked or hand-inserted record,
 * and never on a production Host.
 *
 *   E5D_ISOLATED_HOST=1 E6A_FIXTURE_HOST=1 BUNNY_HOST_DATA_DIRECTORY=<isolated data dir> \
 *     node scripts/e6a-populated-captures.mjs [base=http://127.0.0.1:8082/] [outdir]
 *
 * Protocol (inherits E5A/E5D capture honesty): UI-only navigation on the isolated adapter, the
 * approval offer is left pending until captured, one real revoke is executed through the real UI
 * dialog against a device that was paired for that purpose, and the workstation sign-out gate —
 * which the desktop adapter serves outside UI reach — is recorded as out of scope rather than
 * forced.
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

if (process.env.E5D_ISOLATED_HOST !== "1")
  throw Error("Set E5D_ISOLATED_HOST=1 only after starting the isolated capture Host (same discipline as the E5D matrix).");
if (process.env.E6A_FIXTURE_HOST !== "1")
  throw Error("Set E6A_FIXTURE_HOST=1 to authorize populating the isolated host through its real API.");

const base = process.argv[2] ?? "http://127.0.0.1:8082/";
const out = resolve(process.argv[3] ?? "docs/ux/e6a/evidence/populated");
mkdirSync(out, { recursive: true });

const dataDirectory = process.env.BUNNY_HOST_DATA_DIRECTORY;
if (!dataDirectory) throw Error("BUNNY_HOST_DATA_DIRECTORY must name the isolated Host data directory.");
const credentials = JSON.parse(readFileSync(join(dataDirectory, "credentials.json"), "utf8"));
const hostOrigin = `http://127.0.0.1:${credentials.port}`;

const api = async (action, data = {}) => {
  const response = await fetch(`${hostOrigin}/command`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${credentials.token}` },
    body: JSON.stringify({ action, data }),
  });
  const body = await response.json();
  if (!response.ok) throw Error(`${action}: ${body.error}`);
  return body;
};
const state = async () => (await (await fetch(`${hostOrigin}/state`, { headers: { authorization: `Bearer ${credentials.token}` } })).json());

const record = { classification: "POPULATED ISOLATED FIXTURE", base, steps: [], statesSeen: {}, dialogs: {}, consoleErrors: [], evidence: [] };
const note = (step, value) => (record.steps.push({ step, ...(value === undefined ? {} : { value: value === Object(value) ? value : String(value) }) }), value);

// The fixture populates a fresh isolated Host; a dirty one would double-count offers.
const preexisting = (await state()).agents.agents.length;
if (preexisting) throw Error(`This Host state already holds ${preexisting} Agents — restart the harness on a fresh BUNNY_HOST_DATA_DIRECTORY before running the fixture.`);

// One real fixture workspace per run, inside the Host's approved default root (the checkout), so
// the read/verify steps resolve like the X53 acceptance's (its disposable host preset the root;
// the long-lived harness uses the checkout root). Relative paths stay inside that approved scope.
const scopeDir = join(resolve("test-results"), `e6a-populated-fixture-${process.pid}`);
mkdirSync(scopeDir, { recursive: true });
const instructionPath = relative(resolve("."), join(scopeDir, "instruction.txt")).split("\\").join("/");
writeFileSync(join(scopeDir, "instruction.txt"), "E6A approved result\n", "utf8");

// A read-only one-step mission: the same op vocabulary the X53 acceptance uses, nothing consequential.
// The read/verify paths resolve against the Host's approved default root (the checkout) — the long-lived
// harness keeps its scope, unlike the disposable X53 host which preset a temp root.
const steps = (agentName) => [
  {
    role: "Inspect", objective: agentName, access: "read",
    executor: { kind: "capability", action: "filesystem.read", params: { path: instructionPath } },
    verification: [{ kind: "capability", action: "filesystem.compare", params: { path: instructionPath, content: "E6A approved result\n" }, expect: { field: "matches", equals: true } }],
    crossApp: true, dependsOn: [],
  },
];

const waitAgentState = async (id, want, budgetMs = 60_000) => {
  const end = Date.now() + budgetMs;
  while (Date.now() < end) {
    const agent = (await state()).agents.agents.find((row) => row.id === id);
    const hit =
      want === "WAITING_FOR_USER"
        ? agent?.authorization?.state === "WAITING_FOR_USER" || agent?.authorization?.revision
        : agent?.state === want;
    if (hit && agent) return agent;
    if (agent && want !== "WAITING_FOR_USER" && ["FAILED", "STOPPED"].includes(agent.state)) throw Error(`Agent ${id} reached ${agent.state} before ${want}`);
    await new Promise((r) => setTimeout(r, 250));
  }
  throw Error(`Timeout waiting for ${want}`);
};

try {
  await api("mission.configure", { enabled: true });

  // Consent-pending offer: propose and leave it waiting so the approvals surface holds a real offer.
  // agent.create answers with the full snapshot: always pick the created Agent by name, never by index.
  const byName = (snapshot, name) => snapshot.agents.agents.find((row) => row.name === name);
  const pending = await api("agent.create", {
    name: "E6A Pending consent", objective: "Read the approved instruction, ask once for consent",
    steps: steps("E6A Pending consent"),
  });
  const pendingId = byName(pending, "E6A Pending consent").id;
  await api("agent.authorization.propose", { id: pendingId });
  await waitAgentState(pendingId, "WAITING_FOR_USER");
  record.statesSeen.pendingApproval = pendingId;
  note("pending approval offer created", { agentId: pendingId });

  // Consent granted, real artifacts: the second agent is approved and completes its read/verify.
  const grantedName = "E6A Granted consent";
  const granted = await api("agent.create", { name: grantedName, objective: "Read the approved instruction", steps: steps(grantedName) });
  const grantedId = byName(granted, grantedName).id;
  const proposal = await api("agent.authorization.propose", { id: grantedId });
  await api("agent.authorization.approve", { id: grantedId, revision: proposal.agents.agents[0].authorization.revision });
  const completed = await waitAgentState(grantedId, "COMPLETED");
  record.statesSeen.consentGranted = grantedId;
  record.evidence.push({ kind: "artifacts", from: completed, artifacts: completed.activity?.artifacts ?? [] });
  note("granted consent agent completed", { agentId: grantedId, artifacts: completed.activity?.artifacts?.length ?? 0 });

  // Two real paired devices: one stays for the device row, one is revoked through the real UI dialog.
  const pairOne = async (name) => {
    const created = await api("pairing.create");
    const pairResponse = await fetch(`${hostOrigin}/pair`, {
      method: "POST", headers: { "content-type": "application/json", "x-bunny-pair-client": "e6a-fixture" },
      body: JSON.stringify({ name, code: created.pairCode }),
    });
    const body = await pairResponse.json();
    if (!pairResponse.ok) throw Error(`pairing ${name}: ${body.error}`);
    return body;
  };
  await pairOne("E6A QA Phone");
  const revocable = await pairOne("E6A Revoke Phone");
  const devicesAfterPairing = (await state()).devices?.devices ?? (await state()).devices ?? [];
  record.statesSeen.pairedDevices = devicesAfterPairing.map((row) => row.id ?? row.deviceId ?? row.name);
  note("paired devices", { count: devicesAfterPairing.length, names: devicesAfterPairing.map((row) => row.name) });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", (e) => record.consoleErrors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") record.consoleErrors.push(m.text()); });

  const appReady = () =>
    page.locator('.bunny-app[data-theme]').waitFor({ timeout: 25_000 })
      .then(() => page.locator('[data-connection], .stream-indicator').first().waitFor({ timeout: 20_000 }).catch(() => {}));

  const shot = async (name, locator) => {
    await page.waitForTimeout(400);
    const file = `${name}.png`;
    if (locator) await locator.screenshot({ path: resolve(out, file) });
    else await page.screenshot({ path: resolve(out, file) });
    record.evidence.push({ kind: "screenshot", file });
    return file;
  };

  await page.goto(new URL("/?view=approvals", base).href, { waitUntil: "domcontentloaded" });
  await appReady();
  await page.waitForTimeout(800);
  record.dialogs.approvalsPage = await shot("e6a-approvals-populated");

  // The Agent panel holds the live authorization card and the consent dialog family. "Open Agent"
  // navigates there from the offer row; the Deny and Revoke dialogs are the stop-with-consent contract.
  const openCard = page.getByRole("button", { name: "Open Agent" }).first();
  if (await openCard.count()) {
    await openCard.click();
    await page.waitForTimeout(700);
    record.dialogs.agentPanel = await shot("e6a-agent-panel-authorization");
    // The authorization card opens behind the panel's "Review access" control.
    const review = page.getByRole("button", { name: "Review access" }).first();
    if (await review.count()) {
      await review.click();
      await page.waitForTimeout(500);
      record.dialogs.authorizationCard = await shot("e6a-authorization-card");
    }
    const denyButton = page.getByRole("button", { name: "Deny" }).first();
    if (await denyButton.count()) {
      await denyButton.click();
      await page.waitForTimeout(400);
      const confirm = page.locator(".t8-dialog").first();
      if (await confirm.count()) {
        record.dialogs.denyConsentDialog = await shot("e6a-deny-consent-dialog", confirm);
        record.dialogs.denyConsentTitle = await confirm.evaluate((d) => (d.textContent ?? "").slice(0, 80));
        // Keyboard contract: focus sits inside the dialog and Escape closes it.
        record.dialogs.denyConsentFocusInside = await page.evaluate(() => !!document.activeElement?.closest(".t8-dialog"));
        await page.keyboard.press("Escape");
        await page.waitForTimeout(300);
        record.dialogs.denyConsentEscapeCloses = !(await confirm.count()) || !(await confirm.isVisible());
        // Reopen and cancel: the offer stays pending for the record — the dialog is exercised, the state kept.
        await denyButton.click();
        await page.waitForTimeout(400);
        const confirmAgain = page.locator(".t8-dialog").first();
        const keep = confirmAgain.getByRole("button", { name: "Keep access" }).first();
        if (await keep.count()) { await keep.click(); await page.waitForTimeout(300); record.dialogs.denyConsentEffect = "cancelled; offer intact"; }
      }
    }
    // Revoke the pending consent for real: the dialog confirms, the authorization ends, the Agent stops.
    const revokeConsent = page.getByRole("button", { name: "Revoke access" }).first();
    if (await revokeConsent.count()) {
      await revokeConsent.click();
      await page.waitForTimeout(400);
      const confirm = page.locator(".t8-dialog").first();
      if (await confirm.count()) {
        record.dialogs.revokeConsentDialog = await shot("e6a-revoke-consent-dialog", confirm);
        record.dialogs.revokeConsentTitle = await confirm.evaluate((d) => (d.textContent ?? "").slice(0, 80));
        const yes = confirm.getByRole("button", { name: "Revoke access" }).first();
        if (await yes.count()) { await yes.click(); await page.waitForTimeout(600); record.dialogs.revokeConsentEffect = "revoked"; }
      }
    }
    try {
      const agent = await waitAgentState(pendingId, "STOPPED", 30_000);
      record.statesSeen.pendingAfterConsentRevoke = agent.state;
      note("consent revoke exercised", { pending: "STOPPED" });
    } catch (error) {
      record.statesSeen.pendingAfterConsentRevoke = `pending: ${String(error)}`;
    }
    await page.goto(new URL("/?view=approvals", base).href, { waitUntil: "domcontentloaded" });
    await appReady();
  }

  await page.goto(new URL("/?view=activity", base).href, { waitUntil: "domcontentloaded" });
  await appReady();
  record.dialogs.activityArtifacts = await shot("e6a-activity-artifacts");

  await page.goto(new URL("/?view=server", base).href, { waitUntil: "domcontentloaded" });
  await appReady();
  record.dialogs.serverControl = await shot("e6a-server-control-populated");

  await page.goto(new URL("/?view=devices", base).href, { waitUntil: "domcontentloaded" });
  await appReady();
  record.dialogs.devicesPage = await shot("e6a-devices-populated");
  // Revoke through the real UI: the row control for the paired-for-revocation device, then confirm.
  // The row walk must stop at an ancestor holding ONLY the target device (the shell root holds both).
  const revokeButtons = page.getByRole("button", { name: "Revoke access" });
  let revokeTarget = null;
  for (let i = 0; i < (await revokeButtons.count()); i++) {
    const owned = await revokeButtons.nth(i).evaluate((el) => {
      let row = el.parentElement;
      while (row && !((row.textContent ?? "").includes("E6A Revoke Phone") && !(row.textContent ?? "").includes("E6A QA Phone"))) row = row.parentElement;
      return !!row;
    });
    if (owned) { revokeTarget = revokeButtons.nth(i); break; }
  }
  if (revokeTarget) {
    await revokeTarget.click();
    await page.waitForTimeout(400);
    const confirm = page.locator(".t8-dialog").first();
    const confirmVisible = (await confirm.count()) && (await confirm.isVisible());
    record.dialogs.revokeDialog = await shot("e6a-revoke-dialog", confirmVisible ? confirm : null);
    const confirmedName = confirmVisible ? await confirm.evaluate((d) => (d.textContent ?? "").slice(0, 80)) : null;
    record.dialogs.revokeDialogTitle = confirmedName;
    const confirmButton = confirmVisible ? confirm.getByRole("button", { name: "Revoke access" }).first() : null;
    if (confirmButton && (await confirmButton.count())) {
      await confirmButton.click();
      await page.waitForTimeout(600);
      const after = (await state()).devices ?? [];
      record.statesSeen.devicesAfterRevoke = after.map((row) => ({ name: row.name, revoked: !!row.revoked }));
      record.dialogs.revokeEffect = after.some((row) => row.name === "E6A Revoke Phone" && !row.revoked) ? "revoke not applied" : "revoke applied";
    }
  } else {
    record.dialogs.revokeDialog = "row not reachable from this view";
  }

  // The stop contract (E5D's "stop" dialog) is the consent dialog family above: Deny/Revoke both
  // stop the Agent, so the same exercise covers it; the state was verified when the revoke applied.

  await context.close();
  await browser.close();
} finally {
  record.at = new Date().toISOString();
  record.fixtureWorkspace = scopeDir;
  writeFileSync(resolve(out, "e6a-populated-states.json"), JSON.stringify(record, null, 2));
  rmSync(scopeDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  console.log(`${record.classification}: steps ${record.steps.length}, evidence ${record.evidence.length}, consoleErrors ${record.consoleErrors.length}`);
  if (record.consoleErrors.length) console.log(record.consoleErrors.join("\n"));
}