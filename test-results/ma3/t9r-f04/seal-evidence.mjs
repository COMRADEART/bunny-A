// Seals T9R-F04 evidence with SHA-256 (package binary directories excluded) and verifies an existing seal.
import {readFileSync,writeFileSync,readdirSync,existsSync} from 'node:fs';
import {join,resolve,relative,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const root=resolve('.'),evidence=join(root,'test-results/ma3/t9r-f04'),index=join(evidence,'INDEX.sha256');
const sha=data=>createHash('sha256').update(data).digest('hex');
const walk=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?(e.name.startsWith('windows-package')?[]:walk(join(dir,e.name))):[join(dir,e.name)]);
if(process.argv.includes('--verify')||process.argv.includes('--verify-staged')){
 const entries=readFileSync(index,'utf8').trim().split(/\r?\n/).map(line=>{const m=/^([a-f0-9]{64})  (.+)$/.exec(line);if(!m)throw new Error('Invalid seal line');const file=resolve(root,m[2]);if(!file.startsWith(root+sep))throw new Error('Seal path outside repository');
  const data=process.argv.includes('--verify-staged')?execFileSync('git',['show',':'+m[2]],{maxBuffer:100_000_000,windowsHide:true}):existsSync(file)?readFileSync(file):null;return{path:m[2],ok:data!==null&&sha(data)===m[1]};});
 const failed=entries.filter(e=>!e.ok);console.log(JSON.stringify({result:failed.length?'FAIL':'PASS',files:entries.length,failed}));if(failed.length)process.exitCode=1;
}else{
 const selected=walk(evidence).filter(f=>f!==index);selected.push(join(root,'MA3_T9R_F04_PROVIDER_PROCESS_CONTAINMENT.md'));
 selected.sort((a,b)=>relative(root,a).localeCompare(relative(root,b)));
 writeFileSync(index,selected.map(f=>sha(readFileSync(f))+'  '+relative(root,f).replaceAll('\\','/')).join('\n')+'\n');
 console.log(JSON.stringify({result:'SEALED',files:selected.length,excluded:'windows-package* binary directories (release-manifest copied as windows-package-release-manifest.json)'}));
}
