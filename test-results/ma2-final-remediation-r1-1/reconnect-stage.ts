import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';
import {chain,capStep,cmd,createMission,approveMission,waitOpenRequest,respond,getMission,saveRecord,REC} from './live-client.ts';
const open=()=>capStep('Acquire','computer.open_app',{app:'calculator'},'Reuse the sole test-owned Calculator');
const m=await createMission({title:'R11 real dashboard reconnect',objective:'Reload cannot create native launch or authority.',steps:chain([open(),capStep('Pause','computer.type',{title:'Calculator',name:'Never execute',text:'R1_RECONNECT_NOT_EXECUTED'},'Never approve this request'),open()])});
let browser:any;
try {
 await approveMission(m.id);const ask=await waitOpenRequest(m.id);assert.equal((await respond(ask.id,'allow_batch')).status,200);await waitOpenRequest(m.id,{action:'computer.type'});
 const before=await getMission(m.id);assert.equal(before.runs.length,1);assert.equal(before.mission.batch?.usedCount,1);
 browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1280,height:800}});
 const errors:string[]=[];page.on('pageerror',(e:Error)=>errors.push(e.message));page.on('console',(m:any)=>{if(m.type()==='error')errors.push(m.text());});
 const first=await page.goto('http://127.0.0.1:8084/',{waitUntil:'networkidle'});assert.equal(first?.status(),200);assert.ok((await page.locator('body').innerText()).includes('Bunny'));
 await page.screenshot({path:'screenshots/ma2-r11-reconnect-before.png',fullPage:true});
 const reloaded=await page.reload({waitUntil:'networkidle'});assert.equal(reloaded?.status(),200);assert.ok((await page.locator('body').innerText()).length>500);
 await page.screenshot({path:'screenshots/ma2-r11-reconnect-after.png',fullPage:true});
 assert.deepEqual(errors,[]);
 const after=await getMission(m.id);assert.equal(after.runs.length,before.runs.length);assert.equal(after.mission.batch?.id,before.mission.batch?.id);assert.equal(after.mission.batch?.usedCount,before.mission.batch?.usedCount);
 execFileSync('powershell.exe',['-NoProfile','-File',REC+'/calculator-inventory.ps1','-OutputPath',REC+'/reconnect-calculator.json'],{windowsHide:true});
 const i=JSON.parse(readFileSync(REC+'/reconnect-calculator.json','utf8').replace(/^\uFEFF/,''));assert.equal(i.count,1);
 const owned=JSON.parse(readFileSync(REC+'/calculator-owned-ledger.json','utf8')).targets[0];
 for(const key of ['handle','processId','processStartedAt','contentProcessId','contentStartedAt'])assert.equal(i.targets[0][key],owned[key]);
 saveRecord('ui-reconnect-stage.json',{recordedAt:new Date().toISOString(),classification:'LIVE VERIFIED authorized harmless production fixture',missionId:m.id,realBrowserReload:true,browser:'Microsoft Edge via repository-permitted Playwright fallback after both agent-browser attempts failed; CUA kernel unavailable',statuses:[first?.status(),reloaded?.status()],errors,runCountBefore:before.runs.length,runCountAfter:after.runs.length,usedCountBefore:before.mission.batch?.usedCount,usedCountAfter:after.mission.batch?.usedCount,grantIdUnchanged:true,noAdditionalLaunch:true,nativeIdentityPreserved:true});
}finally{await browser?.close();await cmd('mission.stop',{id:m.id});}
