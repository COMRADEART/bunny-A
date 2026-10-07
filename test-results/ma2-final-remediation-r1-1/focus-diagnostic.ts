import {getState,getMission,saveRecord} from './live-client.ts';
const state=await getState(),mission=state.missions?.missions.find(m=>m.title==='R11 focus loss and fresh approval');
if(!mission)throw new Error('Owned focus fixture not found');
const detail=await getMission(mission.id);saveRecord('focus-first-refusal.json',{recordedAt:new Date().toISOString(),classification:'LIVE VERIFIED retained harness refusal diagnostic',missionId:mission.id,detail,requests:detail.mission.requests.map(r=>({id:r.id,action:r.action,reason:r.reason,batchOffer:r.batchOffer,resolution:r.resolution})),productionRuntimeChanged:false});
console.log(JSON.stringify(detail.mission.requests.map(r=>({action:r.action,reason:r.reason,batchOffered:r.batchOffer!==null,resolution:r.resolution}))));
