import assert from 'node:assert/strict';
import {mock} from 'node:test';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {writeFileSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const mode=process.argv[2],baseline=process.argv.includes('--baseline');
const runtime=process.env.BUNNY_STOP_TEST_RELEASE ? pathToFileURL(join(process.env.BUNNY_STOP_TEST_RELEASE,'src/lib/bunny-host/')).href : new URL('../src/lib/bunny-host/',import.meta.url).href;
const treeUrl=new URL('process-tree.server.ts',runtime).href;
const tree=await import(treeUrl),calls=[],trace=[];
mock.module(treeUrl,{exports:{...tree,killProcess:async identity=>{calls.push(identity); if(mode==='positive' || mode==='final-failure' || mode==='native-reuse') await tree.killProcess(identity);if(mode==='kill-failure')throw new Error('fixture termination refused');}}});
let oldPath;
let managerUrl=new URL('manager.server.ts',runtime).href;
if(baseline){
  const old=execFileSync('git',['show','deb83e80443759fb02abd351d72033aa982a7303:src/lib/bunny-host/manager.server.ts'],{encoding:'utf8'});
  // Only import resolution is adapted; the old Stop body executes unchanged.
  oldPath=join(process.cwd(),'test-results/ma2-final-remediation-r1/baseline-manager.ts');
  writeFileSync(oldPath,old.replace(/from "(\.[^"]+)"/g,(_,relative)=>'from "'+new URL(relative,runtime).href+'"'));
  managerUrl=pathToFileURL(oldPath).href;
}
const {TaskManager}=await import(managerUrl);
const {HostDatabase}=await import(new URL('persistence.server.ts',runtime));
const {providerBase}=await import(new URL('adapters.server.ts',runtime));
const db=new HostDatabase(':memory:');let manager,finish,child,sentinel;
try {
  child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'});
  sentinel=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'});
  await Promise.all([once(child,'spawn'),once(sentinel,'spawn')]);
  const row=(await tree.processTable()).find(r=>r.pid===child.pid);assert.ok(row);assert.ok(row.createdAt);
  let reads=0,stopped=false;
  const adapter={id:'claude',detect:async()=>({...providerBase('claude'),installed:true,authenticated:true,availability:'ready'}),launch:()=>({pid:()=>child.pid,done:new Promise(r=>finish=r),stop:async()=>{trace.push('session.stop');if(['inspection-failure','reuse','before-failure','unknown-birth','image-change'].includes(mode)){const exit=once(child,'exit');child.kill();await exit;}stopped=true;finish({ok:false,output:'',stopped:true});}})};
  const before=mode==='unknown-birth'?{...row,createdAt:null}:row;
  const read=async()=>{
    reads++;trace.push('inspect-'+reads);
    if(reads===1){if(mode==='before-failure')throw new Error('pre-stop inspection failed');return[before];}
    assert.equal(stopped,true);
    if(mode==='inspection-failure' || mode==='final-failure'&&reads>2)throw new Error('fresh inspection failed');
    if(mode==='reuse')return[{...row,createdAt:row.createdAt+10000,name:'simulated-bystander.exe',ppid:sentinel.pid}];
    if(mode==='image-change')return[{...row,name:'simulated-bystander.exe'}];
    if(mode==='native-reuse'&&reads===2)return[row];
    if(mode==='positive'&&reads>2)return(await tree.processTable()).filter(r=>r.pid===child.pid);
    return child.exitCode!==null || child.signalCode!==null ? [] : [before];
  };
  // The last-hop race is simulated in the identity passed to the real native primitive.
  if(mode==='native-reuse') before.createdAt-=10000;
  manager=new TaskManager(db,process.cwd(),[adapter],{processTable:read});await manager.discover();
  const task=manager.submit({prompt:'IR-H1 '+mode+' disposable task',mode:'fast'});manager.approve(task.id);
  const result=await manager.stop(task.id);await new Promise(r=>setTimeout(r,40));
  assert.equal(sentinel.exitCode,null);assert.equal(sentinel.signalCode,null);process.kill(sentinel.pid,0);
  assert.equal(result.state,'stopped');assert.ok(trace.includes('session.stop'));assert.ok(reads>=2);
  if(['inspection-failure','reuse','before-failure','unknown-birth','image-change'].includes(mode))assert.deepEqual(calls,[],'stale/unverified PID must never reach destructive termination');
  if(['inspection-failure','before-failure','unknown-birth','final-failure'].includes(mode)){
    assert.equal(result.stopCleanup?.status,'ownership_unverified');assert.match(result.latestEvent.detail,/unverified|unresolved/);assert.ok(db.events().some(e=>e.type==='task.cleanup_incomplete'));assert.doesNotMatch(result.latestEvent.detail,/none remain/);
  }
  if(mode==='positive'){assert.equal(calls.length,1);assert.equal(child.exitCode===null&&child.signalCode===null,false);assert.equal(result.stopCleanup.status,'complete');}
  if(mode==='kill-failure' || mode==='native-reuse'){assert.equal(calls.length,1);assert.equal(child.exitCode,null);assert.equal(child.signalCode,null);assert.equal(result.stopCleanup.status,'cleanup_incomplete');assert.equal(result.stopCleanup.terminationFailures,1);}
  console.log('IR_H1_RESULT '+JSON.stringify({recordedAt:new Date().toISOString(),mode,runtime,classification:['reuse','native-reuse','image-change','unknown-birth'].includes(mode)?'DISPOSABLE LIVE + SIMULATED':'DISPOSABLE LIVE',trace,readCount:reads,before,destructiveCalls:calls,sentinel:{pid:sentinel.pid,alive:true},cleanup:result.stopCleanup,detail:result.latestEvent.detail,realTaskManagerStop:true,actualOsPidReuse:false}));
} finally {
  for(const fixture of [child,sentinel])if(fixture&&fixture.exitCode===null&&fixture.signalCode===null){const exit=once(fixture,'exit');fixture.kill();await exit;}
  finish?.({ok:false,output:'',stopped:true});if(manager)for(const id of manager.treeTimers.keys())manager.stopTree(id);
  await new Promise(r=>setTimeout(r,40));db.close();if(oldPath)unlinkSync(oldPath);mock.restoreAll();
}
