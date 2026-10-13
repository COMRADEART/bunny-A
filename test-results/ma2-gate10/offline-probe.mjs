import assert from 'node:assert/strict';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {toJSON} from 'seroval';
const root='C:/Users/allam/AppData/Local/Bunny-A-T10-stage',read=p=>JSON.parse(readFileSync(p,'utf8').replace(/^\uFEFF/,'')),config=read(root+'/install.json'),secret=read(config.stateRoot+'/credentials/credentials.json').token;
const ssr=join(config.currentRelease.folder,'.output/server/_ssr'),text=readdirSync(ssr).filter(f=>f.endsWith('.mjs')).map(f=>readFileSync(join(ssr,f),'utf8')).join('\n');
const records=[];
for(const name of ['readBunnyHost','commandBunnyHost']){
 const id=text.match(new RegExp('id: "([a-f0-9]+)",\\s*name: "'+name+'"'))?.[1];assert.ok(id);
 const response=await fetch('http://127.0.0.1:8088/_serverFn/'+id,{method:'POST',headers:{'content-type':'application/json','x-tsr-serverfn':'true',origin:'http://127.0.0.1:8088'},body:JSON.stringify(toJSON({data:name==='readBunnyHost'?{after:0}:{action:'mission.create',data:{objective:'Offline refusal',mode:'fast'}}}))});
 const body=await response.text();assert.ok(/fetch failed|unavailable|ECONNREFUSED/i.test(body),'Wire request must reach the actual offline Host boundary');assert.ok(!body.includes(secret));assert.ok(!/"tasks"\s*:|"missions"\s*:|"providers"\s*:/.test(body));
 records.push({name,status:response.status,truthfulUnavailable:true,protectedStateReturned:false,tokenAbsent:true,responseSha256:createHash('sha256').update(body).digest('hex')});
}
const crash=read('test-results/ma2-gate10/stage-v24-crash.json'),before=read('test-results/ma2-gate10/restart-active-before-v24.json');assert.ok(Date.parse(crash.recordedAt)<before.batch.expiresAt,'Hard kill happened while batch was active');
writeFileSync('test-results/ma2-gate10/offline-gateway-v24-valid-wire.json',JSON.stringify({recordedAt:new Date().toISOString(),classification:'DISPOSABLE LIVE',attackIds:['T10-XG-05','T10-XG-08'],exactInstalledGateway:true,validSerovalPayload:true,hostKilledWhileGrantActive:true,publicTunnelRestartClassification:'NOT TESTED; production disruption not separately authorized',records},null,2)+'\n');
