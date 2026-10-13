import test from 'node:test';
import assert from 'node:assert/strict';
import { teamSetup, createTeam, reachReview, approvePlan, missionOf, teamRows } from '../../../../src/lib/bunny-host/agent-team.fixture.ts';
import { agentCommand } from '../../../../src/lib/bunny-host/agent-runtime.server.ts';
import { teamConstraints } from '../../../../src/lib/bunny-missions/team-coordination.server.ts';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const wait = async (fn, label, timeout=15000) => {
  const start=Date.now();
  while(Date.now()-start<timeout){const result=fn();if(result)return result;await new Promise(r=>setTimeout(r,10));}
  throw new Error('Timeout: '+label);
};

test('LC-01 coordinator pause after first admission blocks subsequent steps', async () => {
  const env=await teamSetup('lc01');
  try {
    const {coordinatorId,missionId}=createTeam(env);
    await reachReview(env,coordinatorId,missionId);
    env.control.hold=true;
    await approvePlan(env,coordinatorId,missionId);
    const tick=env.missions.tickOnce(missionId);
    env.agents.pause(coordinatorId,'workstation');
    const pauseSequence=env.db.events().filter(e=>e.type==='agent.paused'&&JSON.parse(e.detail).agentId===coordinatorId).at(-1).sequence;
    await tick;
    await new Promise(r=>setTimeout(r,100));
    const after=env.db.events().filter(e=>e.sequence>pauseSequence&&e.type==='mission.step.running').map(e=>e.detail);
    console.log(JSON.stringify({probe:'LC-01',coordinatorPaused:env.agents.store.agentFlags(coordinatorId).paused,launchedKinds:env.launched.map(l=>l.step?.team?.kind),stepStates:missionOf(env,missionId).steps.filter(s=>!s.team?.dormant).map(s=>[s.team?.key,s.state]),afterPauseRunning:after}));
    assert.equal(env.launched.some(l=>l.step?.team?.kind==='generate_markdown'),false,'a new model step was admitted after the Coordinator pause');
  } finally {await env.cleanup();}
});

test('LC-02 stopped member never launches through a delayed prompt', async () => {
  const env=await teamSetup('lc02');
  try {
    const {coordinatorId,missionId}=createTeam(env);
    await reachReview(env,coordinatorId,missionId);
    const documenter=teamRows(env).find(a=>a.team?.role==='documenter');
    env.control.hold=true;
    await approvePlan(env,coordinatorId,missionId);
    const tick=env.missions.tickOnce(missionId);
    await env.agents.stop(documenter.id,'workstation');
    await tick;
    await new Promise(r=>setTimeout(r,100));
    assert.equal(env.launched.some(l=>l.step?.team?.kind==='generate_markdown'),false);
    console.log(JSON.stringify({probe:'LC-02',memberStopped:env.agents.store.agentFlags(documenter.id).stopped,launches:env.launched.map(l=>l.step?.team?.kind)}));
  } finally {await env.cleanup();}
});

test('LC-03 revoking team consent via a member stops all admitted team work', async () => {
  const env=await teamSetup('lc03');
  try {
    const {coordinatorId,missionId}=createTeam(env);
    await reachReview(env,coordinatorId,missionId);
    await agentCommand(env.agents,'agent.authorization.propose',{id:coordinatorId},'workstation');
    const offered=env.missions.agentic.forMission(missionId);
    env.control.hold=true;
    await agentCommand(env.agents,'agent.authorization.approve',{id:coordinatorId,revision:offered.revision},'workstation');
    await wait(()=>env.launched.some(l=>l.step?.team?.kind==='generate_json'),'two admitted models');
    const reviewer=teamRows(env).find(a=>a.team?.role==='reviewer');
    const active=env.missions.agentic.forMission(missionId);
    await agentCommand(env.agents,'agent.authorization.revoke',{id:reviewer.id,revision:active.revision},'workstation');
    await new Promise(r=>setTimeout(r,100));
    const unended=env.launched.filter(l=>l.step?.team?.kind!=='plan'&&!l.stopped);
    console.log(JSON.stringify({probe:'LC-03',consent:env.missions.agentic.forMission(missionId).current_state,mission:missionOf(env,missionId).state,coordinator:teamRows(env).find(a=>a.id===coordinatorId).state,runningAfterRevoke:unended.map(l=>l.step?.team?.kind)}));
    assert.equal(unended.length,0,'revoked Coordinator consent left other member sessions running');
    assert.equal(env.agents.store.agentFlags(coordinatorId).stopped,true);
  } finally {await env.cleanup();}
});

test('LC-04 direct child approval cannot start new work for a paused member', async () => {
  const env=await teamSetup('lc04');
  try {
    const {coordinatorId,missionId}=createTeam(env);
    await reachReview(env,coordinatorId,missionId);
    const documenter=teamRows(env).find(a=>a.team?.role==='documenter');
    await approvePlan(env,coordinatorId,missionId);
    const step=missionOf(env,missionId).steps.find(s=>s.team?.key==='t3');
    env.agents.pause(documenter.id,'workstation');
    env.control.hold=true;
    const task=env.tasks.submit({prompt:'# Inventory\n## Usage',mode:'balanced',override:'auto',constraints:teamConstraints(step,null),verify:null},{missionId,stepId:step.id,cwd:env.root,executionScope:{access:'read'}});
    const ready=env.missions.setStep(step,{state:'ready'});
    env.missions.setStep(ready,{state:'waiting_for_approval',taskId:task.id});
    let refused=null;
    try{env.tasks.approve(task.id);}catch(error){refused=error.message;}
    await new Promise(r=>setTimeout(r,100));
    const newWork=env.launched.find(l=>l.task.id===task.id);
    console.log(JSON.stringify({probe:'LC-04',paused:env.agents.store.agentFlags(documenter.id).paused,newWorkStarted:!!newWork,refused}));
    assert.equal(!!newWork,false,'direct approval started a new session while member remained paused');
  } finally {await env.cleanup();}
});

test('LC-05 recovery verifies a landed team write without repeating the effect', async () => {
  let env=await teamSetup('lc05');
  try {
    const {coordinatorId,missionId}=createTeam(env);
    await reachReview(env,coordinatorId,missionId);
    const original=env.missions.bus.request.bind(env.missions.bus);
    let landed=false;
    env.missions.bus.request=async request=>{
      const outcome=await original(request);
      if(request.action==='filesystem.write'&&String(request.params.path).endsWith('index.html')){
        landed=outcome.run?.status==='succeeded';
        return await new Promise(()=>{});
      }
      return outcome;
    };
    await approvePlan(env,coordinatorId,missionId);
    await wait(()=>landed&&existsSync(join(env.root,'team-out','index.html')),'landed write not yet consumed');
    const before=readFileSync(join(env.root,'team-out','index.html'),'utf8');
    const beforeWrites=env.missions.store.runs({missionId,limit:500}).filter(r=>r.action==='filesystem.write'&&r.params?.path==='team-out/index.html').length;
    env=await env.reopen();
    await wait(()=>missionOf(env,missionId).state==='completed','recovery completion',30000);
    const afterWrites=env.missions.store.runs({missionId,limit:500}).filter(r=>r.action==='filesystem.write'&&r.params?.path==='team-out/index.html').length;
    console.log(JSON.stringify({probe:'LC-05',beforeWrites,afterWrites,reconciled:missionOf(env,missionId).steps.find(s=>s.team?.key==='t5')?.result?.summary}));
    assert.equal(readFileSync(join(env.root,'team-out','index.html'),'utf8'),before);
    assert.equal(afterWrites,beforeWrites,'write was repeated after recovery');
  } finally {await env.cleanup();}
});
