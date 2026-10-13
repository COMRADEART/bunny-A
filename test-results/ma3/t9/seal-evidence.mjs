import {readFileSync,writeFileSync,readdirSync,existsSync} from 'node:fs';
import {join,resolve,relative,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

const root=resolve('.'), evidence=join(root,'test-results/ma3/t9');
const index=join(evidence,'INDEX.sha256');
const sha=data=>createHash('sha256').update(data).digest('hex');
const walk=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(dir,e.name)):[join(dir,e.name)]);
if(process.argv.includes('--verify')||process.argv.includes('--verify-staged')){
 const entries=readFileSync(index,'utf8').trim().split(/\r?\n/).map(line=>{
   const match=/^([a-f0-9]{64})  (.+)$/.exec(line);
   if(!match)throw new Error('Invalid seal line');
   const file=resolve(root,match[2]);
   if(!file.startsWith(root+sep))throw new Error('Seal path outside repository');
   const data=process.argv.includes('--verify-staged')?execFileSync('git',['show',':'+match[2]],{maxBuffer:20_000_000,windowsHide:true}):existsSync(file)?readFileSync(file):null;
   return {path:match[2],ok:data!==null&&sha(data)===match[1]};
 });
 const failed=entries.filter(e=>!e.ok);
 console.log(JSON.stringify({result:failed.length?'FAIL':'PASS',files:entries.length,failed}));
 if(failed.length)process.exitCode=1;
}else{
 const selected=walk(evidence).filter(file=>file!==index&&!relative(evidence,file).startsWith('windows-package'+sep));
 selected.push(join(root,'MA3_T9_PHONE_REMOTE_ACCEPTANCE.md'));
 selected.push(join(root,'.gitattributes'));
 selected.push(...readdirSync(join(root,'screenshots')).filter(name=>name.startsWith('t9-')&&!/^t9-v(19|20)-/.test(name)).map(name=>join(root,'screenshots',name)));
 selected.sort((a,b)=>relative(root,a).localeCompare(relative(root,b)));
 writeFileSync(index,selected.map(file=>sha(readFileSync(file))+'  '+relative(root,file).replaceAll('\\','/')).join('\n')+'\n');
 console.log(JSON.stringify({result:'SEALED',files:selected.length,package:'Separate release-manifest.json; binaries excluded',screenshots:'Current MA3 T9 only; historical MA2 v19/v20 excluded'}));
}
