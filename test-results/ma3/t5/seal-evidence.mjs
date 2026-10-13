import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
const directory='test-results/ma3/t5';
const baseline='70fead3618aa5948f1cc3c8c6a73914f32dec654';
const git=(...args)=>{const result=spawnSync('git',args,{encoding:'utf8',windowsHide:true});if(result.status)throw new Error('Git metadata read failed');return result.stdout.trim();};
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const sourceCommit='1be6bc0b6e24989fe26b069e7bcc09808079776a';
const changed=git('diff','--name-only',baseline,sourceCommit).split('\n').filter(Boolean);
writeFileSync(join(directory,'source-commit.json'),JSON.stringify({classification:'STATIC VERIFIED',sourceCommit,baseline,branch:git('branch','--show-current'),sourceFilesChanged:changed.length,files:changed,sourceCommits:[{id:'78d7ad20f17dc923888c16359ce51d0cb08b8f7e',purpose:'T5 implementation'},{id:sourceCommit,purpose:'Private Host state boundary and actual retry accounting'}],remotePush:false},null,2)+'\n');
writeFileSync(join(directory,'source-files.txt'),changed.join('\n')+'\n');
const protectedBefore=JSON.parse(readFileSync(join(directory,'protected-baseline.json'),'utf8').replace(/^\uFEFF/,''));
const protectedAfter=protectedBefore.protected.map(row=>({path:row.path,sha256:hash(row.path),unchanged:hash(row.path)===row.sha256}));
if(protectedAfter.some(row=>!row.unchanged))throw new Error('Protected user material changed');
writeFileSync(join(directory,'protected-final.json'),JSON.stringify(protectedAfter,null,2)+'\n');
// Read only this task's disposable credential file, keep values entirely inside the scanner.
const credentialsPath=join(tmpdir(),'bunny-t5-preview-bun-router','credentials.json');
const known=[];
const collect=(value,key='')=>{if(typeof value==='string'&&value.length>=24&&/token|secret|key|credential/i.test(key))known.push(value);else if(value&&typeof value==='object')Object.entries(value).forEach(([child,item])=>collect(item,child));};
if(existsSync(credentialsPath))collect(JSON.parse(readFileSync(credentialsPath,'utf8')));
const extensions=/\.(?:json|log|md|mjs|ts|tsx|css|txt|sh)$/;
const textFiles=[...changed,'MA3_T5_AGENTIC_AUTHORIZATION_ACCEPTANCE.md',...readdirSync(directory).filter(name=>extensions.test(name)&&!['secret-scan-results.json','INDEX.md'].includes(name)).map(name=>join(directory,name))].filter(path=>existsSync(path));
const patterns=[['private-key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],['api-key',/\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b/g],['bearer-value',/\bBearer\s+[A-Za-z0-9_.-]{24,}/g],['jwt',/\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{16,}/g]];
const candidates=[];let knownCredentialMatches=0;
for(const path of textFiles){const text=readFileSync(path,'utf8');for(const secret of known)if(text.includes(secret)){knownCredentialMatches++;candidates.push({path,kind:'known-disposable-credential',classification:'UNRESOLVED'});}for(const [kind,pattern]of patterns){pattern.lastIndex=0;for(const match of text.matchAll(pattern))candidates.push({path,kind,line:text.slice(0,match.index).split('\n').length,classification:'REVIEW_REQUIRED'});}}
writeFileSync(join(directory,'secret-scan-results.json'),JSON.stringify({classification:'STATIC VERIFIED',sourceCommit,filesScanned:textFiles.length,scope:'Changed source and root-level text evidence only; no binary database or private state included',knownDisposableCredentialsComparedPrivately:known.length,knownCredentialMatches,patternCandidates:candidates,rawValuesEmitted:false,limitations:'Pattern scan and known disposable credential comparison; not a claim of universal secret detection.'},null,2)+'\n');
if(candidates.length)throw new Error('Secret scan requires review; no values were printed');
if(process.argv.includes('--scan-only')){console.log(`Secret scan passed across ${textFiles.length} text files; protected material unchanged.`);process.exit(0);}
const report='MA3_T5_AGENTIC_AUTHORIZATION_ACCEPTANCE.md';
copyFileSync(report,join(directory,report));
for(const name of ['ma3-t5-committed-dev.png','ma3-t5-committed-dev-mobile.png','ma3-t5-committed-dev.json','ma3-t5-committed-built.png','ma3-t5-committed-built-mobile.png','ma3-t5-committed-built.json','ma3-t5-ui-revoked.png','ma3-t5-ui-revoked-mobile.png'])copyFileSync(join('screenshots',name),join(directory,name));
const names=readdirSync(directory,{withFileTypes:true}).filter(entry=>entry.isFile()&&!['INDEX.md','INDEX.sha256'].includes(entry.name)).map(entry=>entry.name).sort();
const index=`# M-A-3 T5 sealed evidence\n\nSource commit: ${sourceCommit}\n\nBaseline: ${baseline}\n\nClassification: STATIC VERIFIED (index hashes). Each artifact declares its own evidence class. Earlier failed attempts are retained; the final report identifies authoritative successful runs.\n\nSHA-256 applies to exact file bytes. Scoped Git attributes preserve these bytes. The index excludes itself and its detached hash to avoid a hash cycle.\n\n| Artifact | Bytes | SHA-256 |\n| --- | ---: | --- |\n${names.map(name=>`| [${name}](${name}) | ${readFileSync(join(directory,name)).length} | ${hash(join(directory,name))} |`).join('\n')}\n`;
writeFileSync(join(directory,'INDEX.md'),index);
writeFileSync(join(directory,'INDEX.sha256'),`${hash(join(directory,'INDEX.md'))}  INDEX.md\n`);
console.log(`Sealed ${names.length} artifacts for ${sourceCommit}; no secret candidates.`);
