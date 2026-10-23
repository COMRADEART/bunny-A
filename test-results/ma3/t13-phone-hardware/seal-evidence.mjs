import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
const out=import.meta.dirname,repo=resolve(out,'../../..');
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const read=p=>JSON.parse(readFileSync(join(out,p),'utf8').replace(/^\uFEFF/,''));
const save=(p,data)=>writeFileSync(join(out,p),JSON.stringify(data,null,2)+'\n');
const before=read('source-preservation-before.json');
const preservation=before.files.map(row=>({...row,preserved:existsSync(join(repo,row.path))&&hash(join(repo,row.path))===row.sha256}));
const delta=execFileSync('git',['diff','--name-only',before.baseline,'--','src','android','scripts','install','native','public','package.json','package-lock.json','vite.config.ts','tsconfig.json'],{cwd:repo,encoding:'utf8'}).trim();
save('source-preservation-after.json',{recordedAt:new Date().toISOString(),checked:preservation.length,allPreserved:preservation.every(r=>r.preserved),mismatches:preservation.filter(r=>!r.preserved),candidateExecutableSourceUnchanged:delta==='',sourceDifferences:delta?delta.split('\n'):[],stagedBeforeCommit:execFileSync('git',['diff','--cached','--name-only'],{cwd:repo,encoding:'utf8'}).trim().split('\n').filter(Boolean)});
if(preservation.some(r=>!r.preserved)||delta)throw new Error('Source/unrelated-file preservation failed.');
const ignored=new Set(['local-build','local-tools','node_modules','.git','INDEX.sha256','commit-files.json','secret-scan.json']);
const files=[];
function walk(dir){for(const item of readdirSync(dir)){if(ignored.has(item))continue;const p=join(dir,item);if(statSync(p).isDirectory())walk(p);else if(item==='.gitattributes'||/\.(?:md|json|mjs|ps1|java|log|png)$/.test(p))files.push(p);}}
walk(out);
const patterns=[['credential-value',/"(?:token|accessToken|refreshToken|secret|password|apiKey|pairCode)"\s*:\s*"[A-Za-z0-9._~+/=-]{6,}"/i],['bearer',/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/],['private-key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],['provider-key',/\b(?:sk-|gh[pousr]_)[A-Za-z0-9_-]{20,}/],['phone-ip',/\b10\.0\.0\.\d{1,3}\b/],['raw-six-digit-code',/(?<![\w.#])\d{6}(?![\w.])/]];
const findings=[];
for(const file of files){if(file.endsWith('.png'))continue;const lines=readFileSync(file,'utf8').split(/\r?\n/);for(let i=0;i<lines.length;i++)for(const [pattern,re]of patterns)if(re.test(lines[i]))findings.push({file:relative(out,file).replaceAll('\\','/'),line:i+1,pattern});}
save('secret-scan.json',{recordedAt:new Date().toISOString(),filesScanned:files.filter(f=>!f.endsWith('.png')).length,patterns:patterns.map(([n])=>n),findings,pass:findings.length===0,screenshots:'Only masked, app-focused native screenshots eligible; visual review required separately.',limitation:'Pattern scan and selective retention; not proof against all secret encodings. QR and raw UI/APK scratch excluded.'});
if(findings.length){console.log(JSON.stringify({findings}));process.exit(1);}
files.push(join(out,'secret-scan.json'));
files.sort();
writeFileSync(join(out,'INDEX.sha256'),files.map(p=>hash(p)+'  '+relative(out,p).replaceAll('\\','/')).join('\n')+'\n');
save('commit-files.json',[...files.map(p=>relative(out,p).replaceAll('\\','/')),'INDEX.sha256']);
console.log(JSON.stringify({sealedFiles:files.length,preservedUnrelatedFiles:preservation.length,sourceUnchanged:delta==='',secretFindings:0}));
