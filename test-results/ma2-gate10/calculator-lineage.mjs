import assert from'node:assert/strict';import{readFileSync,writeFileSync}from'node:fs';import{DatabaseSync}from'node:sqlite';
const rec='test-results/ma2-gate10/',read=p=>JSON.parse(readFileSync(rec+p,'utf8').replace(/^\uFEFF/,'')),original=read('calculator-pre.json');
const db=new DatabaseSync('C:/Users/allam/AppData/Local/Bunny-A-T10-stage/state/host.sqlite',{readOnly:true});
try{
 const rows=db.prepare('SELECT record FROM capability_runs').all().map(x=>JSON.parse(x.record));
 const launched=rows.filter(r=>r.action==='computer.open_app'&&r.evidence?.some(e=>e.startsWith('Calculator target launched:'))).map(r=>({runId:r.id,missionId:r.missionId,startedAt:r.startedAt,evidence:r.evidence.filter(e=>e.startsWith('Calculator target launched:')),identity:JSON.parse(r.evidence.find(e=>e.startsWith('Calculator target launched:')).split(': ').slice(1).join(': '))}));
 assert.equal(launched.length,1,'One controlled audit launch after original target disappeared');
 assert.ok(!original.targets.some(t=>t.handle===launched[0].identity.handle));
 writeFileSync(rec+'calculator-launch-lineage.json',JSON.stringify({recordedAt:new Date().toISOString(),classification:'DISPOSABLE LIVE',attackIds:['T10-T9R-01','T10-T9R-03','T10-T9R-04','T10-T9R-05'],originalIdentity:original.targets[0],originalPreservedInEarlierNativePass:true,originalDisappearanceCause:'NOT ESTABLISHED across execution interruption; no T10 cleanup or name kill targeted it',launched,originalLifetimePreservedAcrossEntireRun:false},null,2)+'\n');
 writeFileSync(rec+'calculator-owned-ledger.json',JSON.stringify({preexistingHandles:original.targets.map(t=>t.handle),targets:launched.map(t=>({...t.identity,ownership:'test-owned',createdByTest:true,provenance:{missionId:t.missionId,capabilityRunId:t.runId,record:'calculator-launch-lineage.json',test:'T10 controlled acquisition after interruption'}}))},null,2)+'\n');
}finally{db.close();}
