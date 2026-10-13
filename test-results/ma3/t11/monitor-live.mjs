import {readFileSync} from 'node:fs';
import {join} from 'node:path';
const live='test-results/ma3/t11/live/final-pinned';
const start=JSON.parse(readFileSync(join(live,'live-run-start.json'),'utf8'));
const credentials=JSON.parse(readFileSync(join(start.parent,'state/credentials.json'),'utf8'));
const response=await fetch('http://127.0.0.1:'+start.port+'/state',{headers:{authorization:'Bearer '+credentials.token}});
if(!response.ok)throw Error('Disposable live Host unavailable: '+response.status);
const state=await response.json();
console.log(JSON.stringify({elapsedMinutes:Math.round((Date.now()-start.startedAt)/6000)/10,
  missions:state.missions.missions.filter(m=>m.team).map(m=>({name:m.title,state:m.state,phase:m.teamView.phase,liveSteps:m.steps.filter(s=>!s.team?.dormant).length,completedSteps:m.steps.filter(s=>s.state==='completed').length,rework:m.teamView.reworkRounds})),
  agents:state.agents.agents.length,modelTasks:state.tasks.length,completedModelTasks:state.tasks.filter(t=>t.state==='completed').length,
  runningModelTasks:state.tasks.filter(t=>['running','launching'].includes(t.state)).length}));
