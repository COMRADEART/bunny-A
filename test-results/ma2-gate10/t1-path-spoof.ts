import assert from 'node:assert/strict';
import {existsSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';
import {hostStatePaths} from '../../src/lib/bunny-host/state-paths.server.ts';
const root=mkdtempSync(join(tmpdir(),'bunny-t10-path-'));
const candidate=JSON.parse(await (await import('node:fs/promises')).readFile('test-results/ma2-gate10/candidate-package.json','utf8'));
const records=[];
try {
 const cases=[['relative','relative/state',{BUNNY_STATE_LAYOUT:'2'}],['repository',resolve('test-results/t10-invalid-state'),{BUNNY_STATE_LAYOUT:'2'}],['release-local','C:/Users/allam/AppData/Local/Bunny-A-T10-stage/releases/'+candidate.release+'/invalid-state',{BUNNY_STATE_LAYOUT:'2'}],['temporary unprovisioned',join(root,'invalid-state'),{BUNNY_STATE_LAYOUT:'2'}],['unknown environment layout',join(root,'layout'),{BUNNY_STATE_LAYOUT:'999'}]] as const;
 for(const [name,path,env]of cases){assert.throws(()=>hostStatePaths(path,env));assert.equal(existsSync(join(path,'host.sqlite')),false);records.push({name,refused:true,freshDatabaseCreated:false});}
 const positive=hostStatePaths('C:/Users/allam/AppData/Local/Bunny-A-T10-stage/state',{BUNNY_STATE_LAYOUT:'2'});assert.equal(positive.installed,true);
 writeFileSync('test-results/ma2-gate10/t1-path-spoof.json',JSON.stringify({recordedAt:new Date().toISOString(),classification:'DISPOSABLE LIVE',attackId:'T10-T1-02',records,canonicalStagePositiveControl:true,productionTouched:false,scope:'Unprovisioned spoof paths fail; legitimate explicit validated disposable state may reside in a temporary directory'},null,2)+'\n');
}finally{rmSync(root,{recursive:true,force:true});}
