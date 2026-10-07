import {getMission,getState,saveRecord} from './live-client.ts';
const state=await getState();
const id=process.argv[2];
const detail=id?await getMission(id):null;
saveRecord('resumed-fixture-diagnosis.json',{recordedAt:new Date().toISOString(),classification:'DISPOSABLE LIVE',detail,missions:state.missions?.missions.map(m=>({id:m.id,title:m.title,state:m.state,batch:m.batch}))});
console.log(JSON.stringify(detail?{state:detail.mission.state,steps:detail.mission.steps.map(s=>({state:s.state,failure:s.failure})),requests:detail.mission.requests.map(r=>({action:r.action,resolved:r.resolvedAt,reason:r.reason})),runs:detail.runs.map(r=>({action:r.action,status:r.status,summary:r.summary}))}:state.missions?.missions.map(m=>({id:m.id,title:m.title,state:m.state})),null,2));
