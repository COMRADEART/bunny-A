import assert from 'node:assert/strict';
import {mkdirSync,existsSync,copyFileSync,writeFileSync,readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createHash,randomBytes} from 'node:crypto';
import {join} from 'node:path';
const rec='test-results/ma2-final-remediation-r1',root=join(process.env.LOCALAPPDATA,'Bunny-A-R1-stage'),state=join(root,'state'),workspace=join(process.env.USERPROFILE,'Bunny-Workspace-R1-stage');
assert.ok(!existsSync(join(state,'host.sqlite')),'Never replace previous stage state');
mkdirSync(state,{recursive:true});mkdirSync(workspace,{recursive:true});copyFileSync(join(root,'backups/production-r1-baseline.sqlite'),join(state,'host.sqlite'));
const db=new DatabaseSync(join(state,'host.sqlite'));
try{
 db.prepare('UPDATE devices SET revoked_at=? WHERE revoked_at IS NULL').run(Date.now());
 const row=db.prepare("SELECT value FROM settings WHERE key='missions_config'").get(),config=JSON.parse(row?.value??'{}');config.enabled=true;config.triggersEnabled=false;
 db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('missions_config',?)").run(JSON.stringify(config));
 for(const folder of ['credentials','settings','runtime','logs','backups','cloudflared','sessions'])mkdirSync(join(state,folder),{recursive:true});
 writeFileSync(join(state,'credentials/credentials.json'),JSON.stringify({token:randomBytes(32).toString('base64url')}));
 const schema=db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').all();
 writeFileSync(join(state,'state-layout.json'),JSON.stringify({schema:'bunny-state/2',stateRoot:state,migratedAt:new Date().toISOString(),databaseUserVersion:3,databaseSchemaSha256:createHash('sha256').update(JSON.stringify(schema)).digest('hex')}));
 writeFileSync(join(rec,'stage-prepared.json'),JSON.stringify({recordedAt:new Date().toISOString(),classification:'DISPOSABLE LIVE',installRoot:root,stateRoot:state,workspace,hostPort:46129,gatewayPort:8089,dbSource:'SQLite-consistent immutable production backup',copiedDeviceAuthorityRevokedInStageOnly:true,separateRandomHostToken:true,credentialsNotRecorded:true,productionChanged:false},null,2)+'\n');
}finally{db.close();}
