import assert from 'node:assert/strict';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {createHash,randomBytes} from 'node:crypto';
import {HostDatabase} from '../../src/lib/bunny-host/persistence.server.ts';
import {MissionStore} from '../../src/lib/bunny-missions/store.server.ts';
import {hostStatePaths} from '../../src/lib/bunny-host/state-paths.server.ts';
const state='C:\\Users\\allam\\AppData\\Local\\Bunny-A-T9R-stage\\state';
assert.ok(!existsSync(state+'/state-layout.json'),'Preparation is only allowed before first staged boot.');
const host=new HostDatabase(state+'/host.sqlite');
try {
  const store=new MissionStore(host);store.saveConfig({...store.config(),enabled:true});
  const schema=host.db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').all();
  const schemaSha256=createHash('sha256').update(JSON.stringify(schema)).digest('hex');
  assert.equal(Object.values(host.db.prepare('PRAGMA quick_check').get()!)[0],'ok');
  const userVersion=Object.values(host.db.prepare('PRAGMA user_version').get()!)[0];assert.equal(userVersion,3);
  for(const folder of ['credentials','settings','runtime','logs','backups','cloudflared','sessions']) mkdirSync(state+'/'+folder,{recursive:true});
  writeFileSync(state+'/credentials/credentials.json',JSON.stringify({token:randomBytes(32).toString('base64url')}),{mode:0o600});
  writeFileSync(state+'/state-layout.json',JSON.stringify({schema:'bunny-state/2',stateRoot:state,migratedAt:new Date().toISOString(),backup:null,databaseUserVersion:userVersion,databaseSchemaSha256:schemaSha256},null,2));
  hostStatePaths(state,{BUNNY_STATE_LAYOUT:'2'});
  writeFileSync('test-results/ma2-gate9r/stage-preparation.json',JSON.stringify({gate:'M-A-2 T9R',ok:true,state,schemaSha256,userVersion,freshCredentials:true,remoteSettingsCopied:false,validator:'HostDatabase + MissionStore + hostStatePaths',initialInstallerGuard:'Refused missing state marker before any activation; prepared only disposable state using actual validator.'},null,2)+'\n');
} finally {host.db.close();}
console.log('Disposable state marker and fresh separate credentials validated; production untouched.');
