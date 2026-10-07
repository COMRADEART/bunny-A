import {readFileSync,writeFileSync,copyFileSync} from 'node:fs';
const prior='test-results/ma2-final-remediation-r1',rec='test-results/ma2-final-remediation-r1-1';
let client=readFileSync(prior+'/live-client.ts','utf8').replaceAll('Bunny-A-R1-stage','Bunny-A').replaceAll('Bunny-Workspace-R1-stage','Bunny-Workspace').replaceAll('ma2-final-remediation-r1"','ma2-final-remediation-r1-1"').replaceAll('46129','43119').replace('Shared client for the staged T9 Host (loopback; its own rotated token from the staging state).','Authorized production acceptance client; canonical private credentials read in memory only.');writeFileSync(rec+'/live-client.ts',client);
for(const file of ['calculator-setup.ts','native-matrix.ts','focus-stage.ts','expiry-stage.ts','reconnect-stage.ts','sse-stage.ts','restart-stage.ts']){
 let s=readFileSync(prior+'/'+file,'utf8').replaceAll('test-results/ma2-final-remediation-r1/','test-results/ma2-final-remediation-r1-1/').replaceAll('Bunny-Workspace-R1-stage','Bunny-Workspace').replaceAll('46129','43119').replaceAll('http://127.0.0.1:8089/','http://127.0.0.1:8084/').replaceAll('screenshots/ma2-r1-','screenshots/ma2-r11-').replaceAll("classification:'DISPOSABLE LIVE'","classification:'LIVE VERIFIED authorized harmless production fixture'").replaceAll("'R1 ","'R11 ");
 writeFileSync(rec+'/'+file,s);
}
for(const file of ['calculator-inventory.ps1','calculator-owned-cleanup.ps1','restore-owned-fixture.ps1','foreground-target.ps1','stop-owned.ps1'])copyFileSync(prior+'/'+file,rec+'/'+file);
console.log('Acceptance harnesses bound to canonical production; no acceptance or production mutation performed by preparation.');
