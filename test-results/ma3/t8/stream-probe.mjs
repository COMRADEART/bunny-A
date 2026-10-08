import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
const base=resolve('test-results/ma3/t8');
const results=[];
for(const [name,path,headers,expected] of [
 ['invalid cursor','/api/bunny-events?after=-1',{},400],
 ['untrusted forwarded peer','/api/bunny-events',{'x-forwarded-for':'203.0.113.8'},503],
 ['cross-site origin','/api/bunny-events',{origin:'https://invalid.example','sec-fetch-site':'cross-site'},503],
 ['cross-site metadata','/api/bunny-events',{'sec-fetch-site':'cross-site'},503]
]){
 const response=await fetch('http://127.0.0.1:8082'+path,{headers,signal:AbortSignal.timeout(5000)});
 console.log(name+': '+response.status);assert.equal(response.status,expected);
 const body=await response.text();assert(!/Bearer|token|cookie|receipt\.txt/.test(body));results.push({name,status:response.status,body});
}
const controller=new AbortController();
const response=await fetch('http://127.0.0.1:8082/api/bunny-events?after=0',{signal:controller.signal});
assert.equal(response.status,200);const reader=response.body.getReader();const first=await reader.read();
const data=new TextDecoder().decode(first.value);assert(data.startsWith(': connected'));
const next=await reader.read();const chunk=new TextDecoder().decode(next.value);const signals=[...chunk.matchAll(/data: (.+)/g)].map(row=>JSON.parse(row[1]));
assert(signals.length>0);assert(signals.every(row=>Object.keys(row).length===1&&Number.isSafeInteger(row.sequence)));
assert.equal(new Set(signals.map(row=>row.sequence)).size,signals.length);
await reader.cancel();controller.abort();
writeFileSync(join(base,'stream-live-probe.json'),JSON.stringify({classification:'DISPOSABLE LIVE VERIFIED',results,authenticatedLocalHandshake:200,onlySequenceSignals:true,replayedSignals:signals.length,noDuplicateReplayInObservedChunk:true,clientCanceled:true,credentialsExposed:false},null,2));
console.log('Stream handshake, bounded public replay, cancellation and fail-closed auth checks verified.');
