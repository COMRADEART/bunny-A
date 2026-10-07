import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const tree = await import('../../src/lib/bunny-host/process-tree.server.ts');
const selected = [];
mock.module('../../src/lib/bunny-host/process-tree.server.ts', { namedExports: { ...tree, killProcess: async pid => { selected.push(pid); } } });
const { TaskManager } = await import('../../src/lib/bunny-host/manager.server.ts');
const { HostDatabase } = await import('../../src/lib/bunny-host/persistence.server.ts');
const { providerBase } = await import('../../src/lib/bunny-host/adapters.server.ts');
const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { windowsHide: true, stdio: 'ignore' });
const sentinel = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { windowsHide: true, stdio: 'ignore' });
await Promise.all([once(child, 'spawn'), once(sentinel, 'spawn')]);
const before = (await tree.processTable()).filter(r => r.pid === child.pid);
assert.equal(before.length, 1);
const trace = [], db = new HostDatabase(':memory:');
let finish, stopped = false, reads = 0;
const adapter = { id: 'claude', detect: async()=>({...providerBase('claude'), installed:true, authenticated:true, availability:'ready'}), launch:()=>({pid:()=>child.pid, done:new Promise(r=>finish=r), stop:async()=>{trace.push('session.stop'); const exit=once(child,'exit'); child.kill(); await exit; stopped=true; trace.push('owned-child-exited'); finish({ok:false,output:'',stopped:true});}}) };
const bystander = {...before[0], ppid: sentinel.pid, name:'fabricated-bystander.exe', createdAt: before[0].createdAt + 10000};
const manager = new TaskManager(db, process.cwd(), [adapter], {processTable: async()=>{reads++; if(reads===1){trace.push('before-snapshot');return before;} assert.equal(stopped,true); trace.push('post-stop-inspection-rejected');throw new Error('forced fresh inspection failure');}});
try {
  await manager.discover();const task=manager.submit({prompt:'IR-H1 disposable reproduction',mode:'fast'});manager.approve(task.id);
  const result=await manager.stop(task.id);await new Promise(r=>setTimeout(r,30));
  assert.ok(trace.indexOf('session.stop')<trace.indexOf('post-stop-inspection-rejected'));
  assert.ok(selected.includes(before[0].pid));assert.equal(sentinel.exitCode,null);
  assert.deepEqual(tree.survivors(before,[bystander]),[]);
  const source=execFileSync('git',['show','HEAD:src/lib/bunny-host/manager.server.ts']);
  mkdirSync('test-results/ma2-final-remediation-r1',{recursive:true});
  writeFileSync('test-results/ma2-final-remediation-r1/ir-h1-reproduction.json',JSON.stringify({recordedAt:new Date().toISOString(),classification:'DISPOSABLE LIVE + SIMULATED',sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceSha256:createHash('sha256').update(source).digest('hex'),realTaskManagerStop:true,before,trace,inspectionCalls:reads,simulatedReusedIdentity:bystander,selectedIntegerPids:selected,stalePidSelected:selected.includes(before[0].pid),allDestructiveCallsIntercepted:true,noBystanderKilled:true,sentinel:{pid:sentinel.pid,alive:true},resultState:result.state,detail:result.latestEvent?.detail,osPidReuse:false},null,2)+'\n');
  console.log('REPRODUCED: real TaskManager Stop selected stale PID after rejected post-stop inspection; destructive calls intercepted.');
} finally {
  for(const fixture of [child,sentinel]) if(fixture.exitCode===null && fixture.signalCode===null){const exit=once(fixture,'exit');fixture.kill();await exit;}
  await new Promise(r=>setTimeout(r,30));db.close();mock.restoreAll();
}
