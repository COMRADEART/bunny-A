import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {health,saveRecord,STAGE_ROOT,STAGE_STATE,bearer} from './live-client.ts';
const cfg=JSON.parse(readFileSync(STAGE_ROOT+'/install.json','utf8'));
const {idleCheck}=await import(pathToFileURL(cfg.currentRelease.folder+'/scripts/bunny-rollback-preflight.mjs').href);
const idle=await idleCheck(cfg.hostPort,bearer(),STAGE_STATE);
assert.equal(idle.idle,true);assert.equal(idle.missionsEnabled,false);assert.equal(idle.triggersEnabled,false);
saveRecord('final-canonical-idle.json',{recordedAt:new Date().toISOString(),classification:'LIVE VERIFIED canonical read-only installed preflight',health:await health(),idle,originalFlagsRestored:true});
