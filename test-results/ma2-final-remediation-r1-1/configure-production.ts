import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {cmd,getState,REC,saveRecord} from './live-client.ts';
const phase=process.argv[2],pre=JSON.parse(readFileSync(REC+'/preflight/production.json','utf8'));
const config=phase==='enable'?{...pre.missionConfig,enabled:true,triggersEnabled:false}:pre.missionConfig;
assert.equal((await cmd('mission.configure',config)).status,200);
const state=await getState();assert.equal(state.missions?.enabled,config.enabled);assert.equal((state.missions as any)?.config?.triggersEnabled,config.triggersEnabled);
saveRecord('mission-policy-'+phase+'.json',{recordedAt:new Date().toISOString(),classification:'LIVE VERIFIED explicitly authorized temporary acceptance configuration',phase,original:pre.missionConfig,configured:config,canonicalApiUsed:true,triggersKeptDisabled:true});
