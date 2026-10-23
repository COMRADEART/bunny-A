// Targeted replacement of a prompt-contaminated planning case; reference answer/validator unchanged.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { freemem, tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { fixtures, version } from './fixtures.mjs';
import { execute, probeOllama } from '../../src/lib/orch/exec.server.ts';
import { TaskManager } from '../../src/lib/bunny-host/manager.server.ts';
import { HostDatabase } from '../../src/lib/bunny-host/persistence.server.ts';
import { ModelCapabilityRegistry } from '../../src/lib/bunny-host/model-capability.server.ts';
import { OllamaAdapter } from '../../src/lib/bunny-host/adapters.server.ts';
const allowed = ['qwen2.5-coder:7b', 'huihui_ai/qwen2.5-abliterate:7b'], fixture = fixtures.find(f=>f.id==='planning');
const original = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const u = new URL(String(input)); assert.equal(u.origin, 'http://127.0.0.1:11434');
  if (u.pathname === '/api/generate') assert.ok(allowed.includes(JSON.parse(String(init.body)).model));
  return original(input,init);
};
const ps = await (await fetch('http://127.0.0.1:11434/api/ps')).json(); assert.equal(ps.models.length, 0);
assert.ok(freemem() > 7 * 1024 ** 3);
const tags = await (await fetch('http://127.0.0.1:11434/api/tags')).json();
for (const model of allowed) { const t = tags.models.find(t=>t.name===model); assert.ok(t && !t.remote_host && !t.remote_model && t.size < 5e9); }
const dir=mkdtempSync(join(tmpdir(),'bunny-s1r-plan-')), db=new HostDatabase(':memory:');
const registry=new ModelCapabilityRegistry(db,{availableProviders:()=>['ollama'],ollamaProbe:async()=>{const p=await probeOllama();return {...p,models:p.models.filter(m=>allowed.includes(m))};}});
const manager=new TaskManager(db,dir,[new OllamaAdapter()],{modelRegistry:registry});
const samples=[];
const unload = model => fetch('http://127.0.0.1:11434/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model,keep_alive:0}),signal:AbortSignal.timeout(5000)});
const hash = s => createHash('sha256').update(s).digest('hex');
try {
  await manager.discover();
  for (const model of allowed) {
    const start=Date.now();const r=await execute({taskId:'planning-'+model,provider:'ollama',model,prompt:fixture.prompt,localOnly:true,numCtx:2048,numPredict:160},{stream:()=>{},timeoutMs:45000});
    samples.push({arm:'model',model,caseId:'planning',ok:r.ok,correct:r.ok&&fixture.valid(r.output),latencyMs:Date.now()-start,receipt:r.receipt??null,syntheticOutput:r.output,outputHash:hash(r.output??'')});await unload(model);
  }
  for (const arm of ['auto','fixed']) {
    const start=Date.now();const t=manager.submit({prompt:fixture.prompt,mode:'fast',override:'auto',modelOverride:arm==='fixed'?allowed[0]:null,executionScope:{access:'read'},constraints:{localOnly:true,providerAllowlist:['ollama'],modelAllowlist:allowed,contextTokens:2048,outputTokens:160,maxRuntimeMs:45000}});
    manager.approve(t.id);const end=Date.now()+60000;
    while (!['completed','failed','stopped'].includes(db.get(t.id).state)) {assert.ok(Date.now()<end);await new Promise(r=>setTimeout(r,25));}
    const result=db.get(t.id);samples.push({arm,model:result.model,caseId:'planning',ok:result.state==='completed',correct:result.state==='completed'&&fixture.valid(result.output),latencyMs:Date.now()-start,syntheticOutput:result.output,outputHash:hash(result.output),inputTokens:result.usage?.inputTokens??null,outputTokens:result.usage?.outputTokens??null});await unload(result.model);
  }
} finally {
  await Promise.all([...manager.sessions.keys()].map(id=>manager.stop(id,'Qualification cleanup')));manager.dispose();db.close();
  for(const model of allowed) await unload(model);
  if(resolve(dir).startsWith(resolve(tmpdir())+'\\')) rmSync(dir,{recursive:true,force:true});
  globalThis.fetch=original;
  writeFileSync('docs/ma4-s1r/evidence/planning-v3.json',JSON.stringify({version,at:new Date().toISOString(),fixtureHash:hash(JSON.stringify(fixtures.map(({id,prompt,format})=>({id,prompt,format})))),prompt:fixture.prompt,referenceAnswerChanged:false,concurrentActivity:'Existing regression tests running; latency is descriptive only',samples},null,2)+'\n');
}
console.log(JSON.stringify(samples.map(s=>({arm:s.arm,model:s.model,correct:s.correct}))));
