import assert from 'node:assert/strict';

export const identityOf = target => ({
  handle: target.handle, processId: target.processId, processStartedAt: target.processStartedAt,
  contentProcessId: target.contentProcessId, contentStartedAt: target.contentStartedAt,
});
export function ownedAcquisition(before, after, provenance) {
  assert.ok(provenance?.missionId && provenance?.capabilityRunId, 'Ownership needs the exact acquisition run.');
  const baseline = new Set(before.targets.map(target => target.handle));
  const created = after.targets.filter(target => !baseline.has(target.handle));
  assert.equal(created.length, 1, 'Exactly one target must be attributable to this controlled acquisition. Never sweep ambiguous/new windows.');
  assert.ok(created[0].verifiedMicrosoftCalculator && created[0].processStartedAt && created[0].contentStartedAt, 'Verified native/frame/content identity required.');
  return { ...created[0], createdByTest: true, ownership: 'test-owned', provenance };
}
export function safeCleanupTargets(ledger, current) {
  return ledger.targets.map(target => {
    assert.ok(target.createdByTest && target.ownership === 'test-owned' && target.provenance, 'Only explicitly created test targets can be closed.');
    assert.ok(!ledger.preexistingHandles.includes(target.handle), 'Pre-existing target cannot be closed.');
    const fresh = current.targets.find(row => row.handle === target.handle);
    assert.ok(fresh?.verifiedMicrosoftCalculator, 'Current package identity required.');
    assert.deepEqual(identityOf(fresh), identityOf(target), 'Current frame/content lifetime must match; old PID or handle is insufficient.');
    return target;
  });
}
