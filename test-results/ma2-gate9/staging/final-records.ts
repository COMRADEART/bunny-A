import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { verifyRelease, sourceCheck, importClosure, fileSha256 } from '../../../scripts/bunny-release.mjs';
import { getState, getMission, health, saveRecord, STAGE_STATE } from './live-shared.ts';

const pin = JSON.parse(readFileSync('install/release-pin.json', 'utf8'));
const series = pin.release.match(/v([0-9]+)-T9/)[0].split('-')[0];
const prod = 'C:/Users/allam/AppData/Local/Bunny-A';
const stage = 'C:/Users/allam/AppData/Local/Bunny-A-T9-stage';
const evidenceRoot = 'test-results/ma2-gate9';
const digest = (bytes: unknown) => createHash('sha256').update(bytes as string).digest('hex');
const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
const recordedAt = new Date().toISOString();

const folder = join('releases', pin.release);
const manifest = readJson(join(folder, 'release-manifest.json'));
const zip = folder + '.zip';
const packageSha256 = fileSha256(zip);
const packageHashSidecar = readFileSync(zip + '.sha256', 'utf8').trim().split(/\s+/)[0].toLowerCase();
assert.equal(packageHashSidecar, packageSha256);
assert.equal(manifest.sourceCommit, pin.sourceCommit);
assert.equal(manifest.release, pin.release);
const assets = manifest.files.filter((file) => file.path.startsWith('.output/public/')).map(({ path, sha256, bytes }) => ({ path, sha256, bytes }));
assert.equal(digest(JSON.stringify(assets)), manifest.dashboard.assetManifestSha256);
const config = readJson(join(stage, 'install.json'));
assert.equal(config.currentRelease.name, pin.release);
const integrity = verifyRelease(folder), sources = sourceCheck(process.cwd(), folder), closure = importClosure(folder);
const installedIntegrity = verifyRelease(config.currentRelease.folder);
assert.ok(integrity.ok && sources.ok && closure.ok && installedIntegrity.ok);
assert.equal(fileSha256(join(config.currentRelease.folder, 'release-manifest.json')), fileSha256(join(folder, 'release-manifest.json')));
saveRecord(series + '-candidate-package.json', {
  gate: 'M-A-2 T9', recordedAt, release: pin.release, sourceCommit: manifest.sourceCommit,
  toolingCommit: manifest.toolingCommit, builtAt: manifest.builtAt, pin,
  package: { path: zip.replaceAll('\\', '/'), size: statSync(zip).size, sha256: packageSha256, sidecarMatches: true },
  manifest: { path: join(folder, 'release-manifest.json').replaceAll('\\', '/'), sha256: fileSha256(join(folder, 'release-manifest.json')) },
  dashboard: manifest.dashboard, assets, integrity, sourceCheck: sources, importClosure: closure,
  installedIntegrity, staging: { installRoot: stage, stateRoot: STAGE_STATE, workspace: config.workspace, hostPort: 44119, startupDirectory: stage + '/startup', productionActivated: false },
  exactGitBlobs: true, dirtyWorkingTreeInput: false, earlierCandidatesPreserved: true,
});

const state = await getState();
const db = new DatabaseSync(STAGE_STATE + '/host.sqlite', { readOnly: true });
const allBatches = db.prepare('SELECT record FROM approval_batches').all().map((row) => JSON.parse(String(row.record)));
const allEvents = db.prepare("SELECT sequence,at,type,mission_id,detail FROM events WHERE type LIKE 'approval.batch_%' ORDER BY sequence").all();
const ids = [...new Set(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'G2', 'H', 'S', 'R', 'J', 'I'].map((phase) => {
  const value = readJson(join(evidenceRoot, series + '-' + phase + '-live.json'));
  assert.equal(value.ok, true, phase + ' live record must pass');
  return value.evidence.missionId ?? value.evidence.missionA;
}).filter(Boolean))];
const details = await Promise.all(ids.map(getMission));
const probe = 'T9_REDACTION_PROBE';
assert.ok(!JSON.stringify(state).includes(probe), 'Host renderer snapshot must redact original typed input');
assert.ok(!JSON.stringify(details).includes(probe), 'Mission detail response must redact original typed input');
assert.ok(!JSON.stringify(allEvents).includes(probe));
assert.ok(!JSON.stringify(allBatches).includes(probe));
const requests = db.prepare('SELECT record FROM permission_requests').all();
assert.ok(!JSON.stringify(requests).includes(probe));
const runs = db.prepare('SELECT record FROM capability_runs').all();
assert.ok(!JSON.stringify(runs).includes(probe));
db.close();
saveRecord(series + '-privacy.json', {
  gate: 'M-A-2 T9', recordedAt, ok: true, rendererSnapshotsScanned: 1,
  missionDetailResponsesScanned: details.length, requestRecordsScanned: requests.length,
  capabilityRunRecordsScanned: runs.length, batchRecordsScanned: allBatches.length,
  batchEventsScanned: allEvents.length, probeFound: false, sensitiveProbeExecuted: false,
  canonicalHostInput: 'Original plan input stays in the private Host execution record; renderer responses replace typed text with a character count and redact secret-key fields. Authority uses original inputs, never redacted UI inputs.',
  visibleUi: 'Desktop/mobile approval and sensitive-pause screenshots inspected; no typed values or selectors rendered; browser console errors zero.',
});
const currentBatches = allBatches.filter((batch) => ids.includes(batch.missionId));
const currentEvents = allEvents.filter((event) => ids.includes(event.mission_id));
for (const batch of currentBatches) {
  assert.ok(batch.usedCount <= batch.maxActions && batch.maxActions <= 12);
  const consumed = currentEvents.filter((event) => event.mission_id === batch.missionId && event.type === 'approval.batch_consumed');
  assert.equal(consumed.length, batch.usedCount, 'exactly one journal consumption per canonical admission');
  const exhausted = currentEvents.find((event) => event.mission_id === batch.missionId && event.type === 'approval.batch_exhausted');
  if (exhausted) assert.ok(Number(consumed.at(-1)?.sequence) < Number(exhausted.sequence));
}
const uiId = readJson(join(evidenceRoot, series + '-I-live.json')).evidence.missionId;
const ui = details.find((detail) => detail.mission.id === uiId)!;
const uiBatch = currentBatches.find((batch) => batch.missionId === uiId);
assert.equal(ui.mission.state, 'stopped'); assert.equal(uiBatch?.usedCount, 2);
assert.equal(uiBatch?.endReason, 'mission_ended'); assert.equal(ui.runs.length, 2);
saveRecord(series + '-ui-live.json', {
  gate: 'M-A-2 T9', recordedAt, ok: true, release: pin.release, missionId: uiId,
  desktopAndMobileCardInspected: true, explicitBatchButtonClicked: true,
  primaryChoice: 'Allow once', target: 'Calculator only', actionLimit: 6, ttlMs: 120000,
  riskAndExternalEffectsShown: true, canonicalUsedAfterApprovalAndReload: 2,
  reloadCreatedAuthority: false, sensitiveInputApprovalOfferedBatch: false,
  stopFromUi: true, futureAdmissions: 0, batch: uiBatch, browserConsoleErrors: 0,
  physicalPhoneTested: false, phoneRepresentation: 'Same MissionsSection in companion view; responsive UI tested. Paired-device command tested independently. No public tunnel configured for staging.',
});
saveRecord(series + '-journal.json', { gate: 'M-A-2 T9', recordedAt, ok: true, canonicalConsumptionMatchesEvents: true, consumedBeforeExhausted: true, events: currentEvents, batches: currentBatches });

const prodConfig = readJson(join(prod, 'install.json'));
assert.equal(prodConfig.currentRelease.name, 'Bunny-A-Windows-v17-T6');
const baselineFiles = readJson(join(evidenceRoot, 'production-preservation.json')).files;
const unchangedConfig = baselineFiles.filter((file) => !file.path.startsWith('state/host.sqlite')).map((file) => {
  const sha256 = fileSha256(join(prod, file.path));
  assert.equal(sha256, file.sha256, 'Production protected file changed: ' + file.path);
  return { path: file.path, sha256, baselineSha256: file.sha256, unchanged: true };
});
const prodIntegrity = verifyRelease(prodConfig.currentRelease.folder); assert.ok(prodIntegrity.ok);
const prodManifestPath = join(prodConfig.currentRelease.folder, 'release-manifest.json');
assert.equal(fileSha256(prodManifestPath), 'f5bf648c92711baba3fe4a24ea46c449fd8f226c0afa018f8f9cf93da52fde88');
const prodDb = new DatabaseSync(join(prod, 'state/host.sqlite'), { readOnly: true });
const tableExists = !!prodDb.prepare("SELECT name FROM sqlite_master WHERE name='approval_batches'").get();
assert.equal(tableExists, false, 'Production must not be migrated to T9');
const computerRuns = prodDb.prepare("SELECT COUNT(*) n FROM capability_runs WHERE action LIKE 'computer.%'").get()!.n;
const permissionRequests = prodDb.prepare('SELECT COUNT(*) n FROM permission_requests').get()!.n;
assert.equal(computerRuns, 0); assert.equal(permissionRequests, 0);
const quickCheck = Object.values(prodDb.prepare('PRAGMA quick_check').get()!)[0]; assert.equal(quickCheck, 'ok');
const userVersion = Object.values(prodDb.prepare('PRAGMA user_version').get()!)[0]; prodDb.close();
const productionHealth = await fetch('http://127.0.0.1:43119/health').then((response) => response.json());
const credentials = readJson(join(prod, 'state/credentials/credentials.json'));
assert.equal(productionHealth.pid, credentials.pid); assert.equal(productionHealth.instanceId, credentials.instanceId);
assert.equal(productionHealth.operationalState, 'healthy');
assert.notEqual(credentials.token, readJson(join(STAGE_STATE, 'credentials/credentials.json')).token);
const rollbackFoldersExist = existsSync(join(prod, 'rollback'));
assert.ok(rollbackFoldersExist);
const productionStartup = 'C:/Users/allam/AppData/Roaming/Microsoft/Windows/Start Menu/Programs/Startup/Bunny-A.lnk';
const startupSha256 = fileSha256(productionStartup);
assert.equal(startupSha256, 'a7a3e9425019854797fc48477ec24885e517e0d0c8735989502d37f2ae776d0c');
saveRecord('final-production.json', {
  gate: 'M-A-2 T9', recordedAt, ok: true, activatedT9: false,
  release: prodConfig.currentRelease.name, sourceCommit: readJson(prodManifestPath).sourceCommit,
  manifestSha256: fileSha256(prodManifestPath), integrity: prodIntegrity, productionHealth,
  stateRoot: prod + '/state', workspace: prodConfig.workspace, stateOutsideGit: true,
  unchangedConfig, database: { inspectedReadOnly: true, quickCheck, userVersion, t9TablePresent: false, computerRuns, permissionRequests },
  sqliteByteParityClaimed: false, sqliteNote: 'The live production Host may append ordinary telemetry/events. Protected configuration/credential bytes and desktop-approval history are unchanged; no production writes, install switch, process stop or migration performed by T9.',
  startup: { path: productionStartup, sha256: startupSha256, matchesAcceptedT8: true, stagingOnlyWritesOwnStartupDirectory: true },
  rollbackFoldersExist, productionBackupForActivation: 'Not created: no activation authorized or performed. Existing T8 rollback material retained.',
  stage: { release: pin.release, host: await health(), separateTokenVerified: true, remoteConfigured: false },
});
console.log('T9 final package, privacy, journal, UI and production records PASS');
