import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {rowDigest,tableDumps,VOLATILE_TABLE} from '../ma2-gate8/tools/22-rowdigest.mjs';
import {fileSha256} from '../../scripts/bunny-release.mjs';
const rec='test-results/ma2-final-remediation-r1-1',read=p=>JSON.parse(readFileSync(p,'utf8').replace(/^\uFEFF/,'')),sha=b=>createHash('sha256').update(b).digest('hex'),phase=process.argv[2]??'immediate';
const pre=read(rec+'/preflight/production.json'),ledger=read(rec+'/preflight/protected-row-ledger.json'),root=join(process.env.LOCALAPPDATA,'Bunny-A'),cfg=read(join(root,'install.json')),state=cfg.stateRoot;
assert.equal(cfg.stateRoot,pre.config.stateRoot);assert.equal(cfg.workspace,pre.config.workspace);assert.equal(cfg.hostPort,pre.config.hostPort);
const backup=join(state,'backups/ma2-final-remediation-r1-1/'+phase+'-'+Date.now()+'.sqlite'),db=new DatabaseSync(join(state,'host.sqlite'),{readOnly:true});db.prepare('VACUUM INTO ?').run(backup);db.close();
const snap=new DatabaseSync(backup,{readOnly:true});assert.equal(snap.prepare('PRAGMA integrity_check').get().integrity_check,'ok');snap.exec('BEGIN');const missing=[],changed=[],added=[];
for(const [table,old] of Object.entries(ledger.tables))if(!VOLATILE_TABLE.has(table)){const {pk,rows}=tableDumps(snap,table),now=Object.fromEntries(rows.map(r=>[String(r[pk]),rowDigest(table,r).digest]));for(const [id,digest] of Object.entries(old.rows)){if(!now[id])missing.push({table,id});else if(now[id]!==digest)changed.push({table,id});}for(const row of rows)if(!(String(row[pk]) in old.rows)){let record;try{record=JSON.parse(row.record);}catch{}added.push({table,id:String(row[pk]),digest:now[String(row[pk])],type:row.type??record?.type});}}
const newTables=snap.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().filter(r=>!(r.name in ledger.tables)).map(r=>({name:r.name,count:snap.prepare('SELECT COUNT(*) count FROM "'+r.name+'"').get().count}));
const devices=snap.prepare('SELECT * FROM devices').all().map(d=>({id:d.id,name:d.name,revokedAt:d.revoked_at,tokenHashSha256:sha(d.token_hash),fullRowSha256:sha(JSON.stringify(d))})),settings=snap.prepare('SELECT * FROM settings').all().map(r=>({key:r.key,valueSha256:sha(r.value)}));
for(const before of ledger.devices){assert.deepEqual(devices.find(d=>d.id===before.id),before,'Historical device changed');}const newDevices=devices.filter(d=>!ledger.devices.some(x=>x.id===d.id));if(phase==='final')assert.ok(newDevices.every(d=>d.revokedAt!==null));
for(const prior of ledger.settings)assert.deepEqual(settings.find(s=>s.key===prior.key),prior,'Original setting changed');
const appendedSettings=settings.filter(s=>!ledger.settings.some(p=>p.key===s.key));
if(appendedSettings.length){
 const owned=read(rec+'/calculator-owned-ledger.json').targets[0],ownIds=new Set(read(rec+'/production-authority-cleanup.json').ownedFixtureMissionIds);
 for(const s of appendedSettings){
  assert.match(s.key,/^computer\.target:(mission|direct):[a-f0-9-]+$/);
  const target=JSON.parse(snap.prepare('SELECT value FROM settings WHERE key=?').get(s.key).value);
  for(const key of ['handle','processId','processStartedAt','contentProcessId','contentStartedAt'])assert.equal(target.identity[key],owned[key],'Unexpected appended target identity');
  const run=JSON.parse(snap.prepare('SELECT record FROM capability_runs WHERE id=?').get(target.runId).record);
  assert.ok(run.createdAt>=Date.parse(pre.recordedAt)||run.startedAt>=Date.parse(pre.recordedAt));
  if(s.key.includes(':mission:')){const id=s.key.slice('computer.target:mission:'.length);assert.ok(ownIds.has(id));assert.equal(run.missionId,id);}
  else {assert.equal(s.key,'computer.target:direct:'+run.id);assert.equal(run.action,'computer.read_calculator');assert.equal(run.missionId,null);}
  s.provenanceRunId=run.id;s.matchesExplicitOwnedFixture=true;s.executionIdentityOnlyNeverGrant=true;
 }
}
const phone=devices.find(d=>d.name==='Phone companion');assert.ok(phone&&phone.revokedAt===null);
snap.exec('ROLLBACK');snap.close();
writeFileSync(rec+'/production-preservation-'+phase+'.json',JSON.stringify({recordedAt:new Date().toISOString(),classification:'LIVE VERIFIED',phase,protectedHistoricalRows:{missing,changed},appendedRows:added,newTables,devices,temporaryDevices:newDevices,settings,originalSettingsUnchanged:true,appendedSettings,missionConfig:ledger.missionConfig,phonePreserved:true,privateConsistentBackup:{path:backup,sha256:fileSha256(backup),bytes:statSync(backup).size,integrity:'ok'},externalCanonicalStatePreserved:true,workspacePreserved:true,hostPortPreserved:true},null,2)+'\n');
assert.equal(missing.length,0);assert.equal(changed.length,0);
console.log(JSON.stringify({phase,missing:missing.length,changed:changed.length,appended:added.length,newTables,devices:devices.length,temporaryDevices:newDevices.length,phonePreserved:true,settingsEqual:true}));
