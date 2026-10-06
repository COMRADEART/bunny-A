import test from 'node:test';
import assert from 'node:assert/strict';
import {ownedAcquisition,safeCleanupTargets} from './t9-calculator-fixture.mjs';
const target = (handle='1') => ({handle,processId:10,processStartedAt:'100',contentProcessId:11,contentStartedAt:'101',verifiedMicrosoftCalculator:true});
const provenance={missionId:'test-Mission',capabilityRunId:'approved-run'};
test('T9R harness cleanup selects only its explicitly created target, preserving user targets',()=>{
  const user=target('user'), created=target();
  const owned=ownedAcquisition({targets:[user]},{targets:[user,created]},provenance);
  assert.deepEqual(safeCleanupTargets({preexistingHandles:['user'],targets:[owned]},{targets:[user,created]}),[owned]);
});
test('T9R harness refuses user-owned or pre-existing windows even with a plausible PID',()=>{
  assert.throws(()=>safeCleanupTargets({preexistingHandles:[],targets:[target()]},{targets:[target()]}),/explicitly/);
  const owned=ownedAcquisition({targets:[]},{targets:[target()]},provenance);
  assert.throws(()=>safeCleanupTargets({preexistingHandles:['1'],targets:[owned]},{targets:[target()]}),/Pre-existing/);
});
test('T9R harness refuses stale PID/native handle and content lifetime',()=>{
  const owned=ownedAcquisition({targets:[]},{targets:[target()]},provenance);
  for(const changed of [{processStartedAt:'200'},{contentStartedAt:'200'},{contentProcessId:99}]) {
    assert.throws(()=>safeCleanupTargets({preexistingHandles:[],targets:[owned]},{targets:[{...target(),...changed}]}),/lifetime/);
  }
});
test('T9R harness refuses ambiguous ownership and unverified package identity',()=>{
  assert.throws(()=>ownedAcquisition({targets:[]},{targets:[target('1'),target('2')]},provenance),/Exactly one/);
  assert.throws(()=>ownedAcquisition({targets:[]},{targets:[{...target(),verifiedMicrosoftCalculator:false}]},provenance),/Verified/);
});
