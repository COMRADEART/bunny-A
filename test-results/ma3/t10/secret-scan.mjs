// Static secret scan of retained T10 text evidence. Exact production credential values are compared, never printed.
import {readFileSync,writeFileSync,readdirSync,statSync,existsSync} from 'node:fs';
import {join,relative,resolve} from 'node:path';
const root=resolve('test-results/ma3/t10');
const walk=d=>readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?(e.name.startsWith('windows-package')?[]:walk(join(d,e.name))):[join(d,e.name)]);
const text=/\.(json|log|md|txt|mjs|ps1|sha256)$/i;
const files=walk(root).filter(f=>text.test(f)&&statSync(f).size<50_000_000);
const exact=[];
const cfg=JSON.parse(readFileSync(join(process.env.LOCALAPPDATA,'Bunny-A','install.json'),'utf8'));
const cred=join(cfg.stateRoot,'credentials','credentials.json');
if(existsSync(cred)){const c=JSON.parse(readFileSync(cred,'utf8'));for(const v of Object.values(c))if(typeof v==='string'&&v.length>=16)exact.push(v);}
const patterns=[['bearer',/Bearer\s+[A-Za-z0-9_\-.]{24,}/],['device-cookie',/bunny_device=[A-Za-z0-9_\-.%]{16,}/],['token-field',/"(?:token|masterToken|bearer|secret)"\s*:\s*"[A-Za-z0-9_\-.]{24,}"/],['pair-code',/"pairCode"\s*:\s*"[^"]+"/],['private-key',/-----BEGIN [A-Z ]*PRIVATE KEY-----/],['api-key',/\b(?:sk-[A-Za-z0-9]{20,}|xai-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,})\b/]];
const findings=[];
// T10 §24: no raw user audio may be retained. Any audio-like file (by extension or RIFF/WAVE header) is a finding.
const audioExt=/\.(wav|pcm|raw|mp3|ogg|flac|m4a|webm|opus)$/i;
const audioFiles=walk(root).filter(f=>audioExt.test(f)||(()=>{try{const b=readFileSync(f).subarray(0,12);return b.toString('latin1',0,4)==='RIFF'&&b.toString('latin1',8,12)==='WAVE';}catch{return false;}})());
for(const f of audioFiles)findings.push({file:relative(process.cwd(),f).replaceAll('\\','/'),pattern:'audio-file'});
for(const f of files){const t=readFileSync(f,'utf8');for(const [name,re] of patterns)if(re.test(t))findings.push({file:relative(process.cwd(),f).replaceAll('\\','/'),pattern:name});for(const v of exact)if(t.includes(v))findings.push({file:relative(process.cwd(),f).replaceAll('\\','/'),pattern:'production-credential-exact-value'});}
writeFileSync(join(root,'secret-scan.json'),JSON.stringify({classification:'STATIC pattern + exact production credential value scan of retained T10 text evidence',result:findings.length?'FINDINGS':'PASS',filesScanned:files.length,exactProductionValuesChecked:exact.length,patterns:[...patterns.map(p=>p[0]),'audio-file (extension or RIFF/WAVE header, all files)'],audioFilesFound:audioFiles.length,findings,
 excluded:['windows-package*/ (binary release payloads; integrity verified by release manifest instead)'],
 limitations:['Disposable fixture device tokens existed only in RAM of deleted temporary Hosts; they are not reconstructable for exact-value comparison','Binary files are not decoded']},null,2)+'\n');
console.log(JSON.stringify({files:files.length,findings}));
