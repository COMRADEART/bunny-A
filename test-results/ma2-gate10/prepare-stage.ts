import assert from 'node:assert/strict';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {createHash,randomBytes} from 'node:crypto';
import {HostDatabase} from '../../src/lib/bunny-host/persistence.server.ts';
import {MissionStore} from '../../src/lib/bunny-missions/store.server.ts';
import {hostStatePaths} from '../../src/lib/bunny-host/state-paths.server.ts';
import {resolve} from 'node:path';
const root='C:/Users/allam/AppData/Local/Bunny-A-T10-stage',state=resolve(root,'state');
assert.ok(!existsSync(state+'/host.sqlite'),'Never replace existing stage state');
mkdirSync(state,{recursive:true});mkdirSync('C:/Users/allam/Bunny-Workspace-T10-stage',{recursive:true});
const db=new HostDatabase(state+'/host.sqlite');
try {
 const store=new MissionStore(db);store.saveConfig({...store.config(),enabled:true,triggersEnabled:false});
 const schema=db.db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').all();
 const fingerprint=createHash('sha256').update(JSON.stringify(schema)).digest('hex');
 for(const folder of ['credentials','settings','runtime','logs','backups','cloudflared','sessions'])mkdirSync(state+'/'+folder,{recursive:true});
 writeFileSync(state+'/credentials/credentials.json',JSON.stringify({token:randomBytes(32).toString('base64url')}));
 writeFileSync(state+'/state-layout.json',JSON.stringify({schema:'bunny-state/2',stateRoot:state,migratedAt:new Date().toISOString(),backup:null,databaseUserVersion:3,databaseSchemaSha256:fingerprint}));
 hostStatePaths(state,{BUNNY_STATE_LAYOUT:'2'});
 writeFileSync('test-results/ma2-gate10/staging.json',JSON.stringify({recordedAt:new Date().toISOString(),classification:'DISPOSABLE LIVE',root,state,workspace:'C:/Users/allam/Bunny-Workspace-T10-stage',port:45129,freshDisposableDatabase:true,productionBackupSeparate:true,remoteCredentialsCopied:false,missionsEnabledOnlyInStage:true,productionActivated:false},null,2)+'\n');
}finally{db.close();}
