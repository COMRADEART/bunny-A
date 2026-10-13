import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,readdirSync,existsSync} from 'node:fs';
import {resolve,join,relative} from 'node:path';
import {createHash} from 'node:crypto';

const root=resolve('.'),base=join(root,'test-results/ma3/t8');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const save=(file,value)=>writeFileSync(join(base,file),JSON.stringify(value,null,2)+'\n');
const walk=path=>readdirSync(path,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(join(path,entry.name)):[join(path,entry.name)]);
const excluded=path=>relative(base,path).replaceAll('\\','/').startsWith('package/')||['ui-host-approved.log','INDEX.md','INDEX.sha256','secret-scan.json'].includes(relative(base,path));
let files=walk(base).filter(path=>!excluded(path));
const report=join(root,'MA3_T8_PREMIUM_UI_ACCEPTANCE.md');files.push(report);
for(const path of files) {
  if(/\.(?:md|mjs|ps1|json|log|txt|sha256)$/.test(path))writeFileSync(path,readFileSync(path,'utf8').replace(/^\uFEFF/,'').replace(/\r\n/g,'\n'));
}
const fixture=JSON.parse(readFileSync(join(base,'ui-fixture.json'),'utf8'));
const credential=JSON.parse(readFileSync(join(fixture.data,'credentials.json'),'utf8'));
assert.equal(typeof credential.token,'string');assert(credential.token.length>20);
const findings=[];
for(const file of files) {
  const path=relative(root,file).replaceAll('\\','/');
  if(/\.(?:sqlite|sqlite3|db|env|exe|node|dll|zip|tar)$/.test(file)||/credentials\.json$/.test(file))findings.push({path,rule:'forbidden payload type'});
  const bytes=readFileSync(file);
  if(bytes.includes(Buffer.from(credential.token)))findings.push({path,rule:'disposable Host bearer credential'});
  if(/\.(?:md|mjs|ps1|json|log|txt)$/.test(file)) {
    const text=bytes.toString('utf8');
    if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text))findings.push({path,rule:'private key'});
    if(/\bsk-[A-Za-z0-9_-]{32,}\b/.test(text))findings.push({path,rule:'provider key format'});
    if(/"(?:token|apiKey|password|refreshToken|accessToken)"\s*:\s*"(?!\[redacted\]|UNKNOWN|UNAVAILABLE)[A-Za-z0-9_+\/.=-]{24,}"/.test(text))findings.push({path,rule:'raw high-entropy credential field'});
  }
}
save('secret-scan.json',{classification:'STATIC VERIFIED',sourceCommit:'987afeace77520b9f4ef49e27b137dd01fb3fee8',scannedFiles:files.length,rules:['Exact currently active disposable Host token','Private-key headers','Provider-key format','Raw high-entropy credential fields','No database/env/executable/native/payload credential files'],findings,passed:findings.length===0,excluded:['package/**: uncommitted local test payloads','ui-host-approved.log: active-session log; frozen copy retained'],privateProviderTranscriptsUsed:false,productionCredentialsRead:false,limitation:'Pattern/exact-token scanning is not a proof about every conceivable secret format.'});
assert.deepEqual(findings,[]);
files.push(join(base,'secret-scan.json'));
const required=['baseline.md','existing-ui-inventory.json','information-architecture.md','design-tokens.md','component-inventory.json','agentic-workspace-contract.md','ui-host-command-mapping.json','activity-stream-acceptance.json','agent-controls-acceptance.json','authorization-ui-acceptance.json','projects-regression.json','models-usage-truth.json','bunny-bar-acceptance.json','responsive-matrix.json','accessibility-results.json','keyboard-navigation.json','built-desktop-acceptance.json','integrated-ui-acceptance.json','restart-reconnect.json','adversarial-matrix.json','security-regression.json','regression-inventory.json','production-final.json','secret-scan.json','MA3_T8_PREMIUM_UI_ACCEPTANCE.md'];
for(const name of required)assert(existsSync(join(base,name)),name);
const rows=files.sort().map(file=>({file,relative:relative(root,file).replaceAll('\\','/'),sha256:sha(readFileSync(file)),bytes:readFileSync(file).length}));
const index=`# T8 evidence index

Implementation source: 987afeace77520b9f4ef49e27b137dd01fb3fee8. Branch: codex/ma3-t8-premium-ui. Gate: PASS WITH LIMITATIONS. Local evidence commit follows this seal; it contains no executable implementation changes.

See [acceptance report](MA3_T8_PREMIUM_UI_ACCEPTANCE.md), [73-case acceptance matrix](acceptance-matrix.json), [regression inventory](regression-inventory.json), [production comparison](production-final.json) and [attempts/repairs](failed-attempts-and-repairs.md). Classifications distinguish LIVE VERIFIED, DISPOSABLE LIVE VERIFIED, SIMULATED, STATIC VERIFIED and NOT TESTED.

INDEX.sha256 contains workspace-relative paths and SHA-256 of all selected committed evidence, including the root acceptance report and this index. INDEX.sha256 excludes itself to avoid a circular hash. Text evidence is UTF-8 without BOM and LF line endings; screenshots retain original PNG bytes.

The package/** payload directory and active-session ui-host-approved.log are excluded from Git/seal. The final R4 package is represented by package-manifest.json, package-integrity.json, inherited release-pin metadata and native/render evidence. ui-host-session-frozen.log is the retained snapshot of the active-session log. Temporary state credentials/databases and generated executables are excluded. Protected pre-existing reports and memory are unchanged and untracked.

| Evidence file | Bytes | SHA-256 |
| --- | ---: | --- |
${rows.map(row=>`| [${relative(base,row.file).replaceAll('\\','/')}](<${relative(base,row.file).replaceAll('\\','/')}>) | ${row.bytes} | ${row.sha256} |`).join('\n')}
`;
const indexFile=join(base,'INDEX.md');writeFileSync(indexFile,index);files.push(indexFile);
files.sort();
const shaFile=join(base,'INDEX.sha256');writeFileSync(shaFile,files.map(file=>sha(readFileSync(file))+'  '+relative(root,file).replaceAll('\\','/')).join('\n')+'\n');files.push(shaFile);
for(const line of readFileSync(shaFile,'utf8').trim().split('\n')) {
  const [digest,path]=line.split('  ');assert.equal(sha(readFileSync(join(root,path))),digest,path);
}
const stageFile=join(root,'.grok/t8-evidence-paths.bin');
writeFileSync(stageFile,files.map(file=>relative(root,file).replaceAll('\\','/')).join('\0')+'\0');
console.log(JSON.stringify({sealedFiles:files.length,secretFindings:findings.length,stagePathspec:'.grok/t8-evidence-paths.bin',packagePayloadExcluded:true}));
