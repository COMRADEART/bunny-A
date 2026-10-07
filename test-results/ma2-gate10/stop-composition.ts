import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {HostDatabase} from '../../src/lib/bunny-host/persistence.server.ts';
import {TaskManager} from '../../src/lib/bunny-host/manager.server.ts';
import {providerBase} from '../../src/lib/bunny-host/adapters.server.ts';
import {MissionManager} from '../../src/lib/bunny-missions/manager.server.ts';
import {ComputerCapability} from '../../src/lib/bunny-missions/capabilities/computer.server.ts';
import {runWindowsOwnedProcess} from '../../src/lib/bunny-host/owned-process-group.server.ts';
import {safeError} from '../../src/lib/bunny-host/failure.server.ts';
const root=mkdtempSync(join(tmpdir(),'bunny-t10-composition-')),data=join(root,'state');mkdirSync(data);
const db=new HostDatabase(join(data,'host.sqlite')),records:any[]=[];
let providerTask:any=null, missionId:string|null=null;const cancels:AbortController[]=[],pending:Promise<any>[]=[];
const adapter:any={id:'claude',detect:async()=>({...providerBase('claude'),installed:true,authenticated:true,availability:'ready',capabilities:['filesystem','terminal','text']}),launch:(task:any)=>{
 assert.ok(task.executionScope);providerTask=task;const abort=new AbortController();cancels.push(abort);
 const done=runWindowsOwnedProcess(process.execPath,['-e','setInterval(()=>{},1000)'],{cwd:task.cwd,signal:abort.signal,timeoutMs:30000,owner:{dataDirectory:data,missionId:task.mission.missionId,stepId:task.mission.stepId,action:'T10 harmless provider child',records}}).then(r=>({ok:false,output:'',stopped:r.aborted,exitCode:r.exitCode}));
 pending.push(done);return {done,stop:async()=>{abort.abort();await done;}};
}};
const tasks=new TaskManager(db,root,[adapter]);await tasks.discover();
const missions=new MissionManager(tasks,{dataDirectory:data,adapters:[new ComputerCapability(data,{load:owner=>missions.store.calculatorTarget(owner),save:(owner,target)=>missions.store.saveCalculatorTarget(owner,target)})]});missions.configure({enabled:true},'T10');await missions.bus.refreshHealth();
const sentinel=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});
const waitFor=async(probe:()=>any)=>{for(let i=0;i<500;i++){if(probe())return;await new Promise(r=>setTimeout(r,20));}throw new Error('Composition positive control timed out');};
try {
 const m=missions.create({objective:'Disposable Stop composition',title:'T10 Stop provider plus desktop',mode:'fast',origin:'workstation',steps:[{role:'Acquire',objective:'Reuse Calculator',executor:{kind:'capability',action:'computer.open_app',params:{app:'calculator'}}},{role:'Provider',objective:'Harmless owned child',dependsOn:[0],executor:{kind:'model'}},{role:'Later GUI',objective:'Must not run after Stop',dependsOn:[1],executor:{kind:'capability',action:'computer.open_app',params:{app:'calculator'}}}]});missionId=m.id;missions.approve(m.id,'workstation',false);
 // Simulated narrower capability consent; provider-session consent stays explicit and independent.
 // Narrowing cannot create authority. This ensures Stop sees both a live desktop batch and a child.
 const approved=missions.store.mission(m.id),envelope=missions.store.authorization(approved.authorizationId!)!;
 missions.store.saveAuthorization({...envelope,riskClasses:['READ']});missions.start(approved);
 await waitFor(()=>missions.store.requests(m.id).some(r=>!r.resolvedAt));const request=missions.store.requests(m.id).find(r=>!r.resolvedAt)!;assert.ok(request.batchOffer);await missions.respond(request.id,'allow_batch','workstation');await waitFor(()=>records[0]?.launcherPid>0&&providerTask);const ownedPid=records[0].launcherPid;process.kill(ownedPid,0);process.kill(sentinel.pid!,0);
 const before=missions.store.runs({missionId:m.id,limit:500}).length;await missions.stop(m.id,'workstation');await new Promise(r=>setTimeout(r,250));assert.equal(missions.store.runs({missionId:m.id,limit:500}).length,before);assert.equal(missions.store.mission(m.id).state,'stopped');assert.equal(tasks.db.get(providerTask.id).state,'stopped');assert.throws(()=>process.kill(ownedPid,0));process.kill(sentinel.pid!,0);assert.equal(missions.store.batches(m.id)[0].status,'ended');
 const fixture='T10_FAILURE_FIXTURE_DO_NOT_PUBLISH';const errors=['provider','desktop','gateway','rollback','tunnel'].map(boundary=>({boundary,safe:safeError(new Error(boundary+' password='+fixture+' Authorization: Bearer '+fixture),[fixture])}));assert.ok(!JSON.stringify(errors).includes(fixture));
 writeFileSync('test-results/ma2-gate10/stop-composition.json',JSON.stringify({recordedAt:new Date().toISOString(),classification:'DISPOSABLE LIVE',providerPolicyClassification:'SIMULATED harmless adapter; actual native owned process',attackIds:['T10-XG-04','T10-XG-10','T10-T4-02','T10-T4-05'],missionId:m.id,taskId:providerTask.id,desktopGrantEnded:true,noLaterDesktopRun:true,ownedPid,ownedChildExited:true,sentinelPid:sentinel.pid,sentinelSurvived:true,ownership:records,secretErrorBoundaryResults:errors},null,2)+'\n');
}catch(error){writeFileSync('test-results/ma2-gate10/stop-composition-harness-failure.json',JSON.stringify({recordedAt:new Date().toISOString(),classification:'DISPOSABLE LIVE',error:safeError(error),mission:missionId?missions.get(missionId):null,ownership:records},null,2));throw error;}
finally{for(const c of cancels)c.abort();await Promise.allSettled(pending);if(missionId&&!['stopped','completed'].includes(missions.store.mission(missionId).state))await missions.stop(missionId,'T10 cleanup');await missions.close();sentinel.kill();await new Promise(r=>sentinel.once('exit',r));db.close();rmSync(root,{recursive:true,force:true,maxRetries:30,retryDelay:100});}
