import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const root=resolve('.'),base=join(root,'test-results/ma3/t8');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const staged=process.argv.includes('--staged'),prefix=staged?':':'HEAD:';
const entries=readFileSync(join(base,'INDEX.sha256'),'utf8').trim().split('\n').map(line=>{const [digest,path]=line.split('  ');return{digest,path};});
const paths=entries.map(row=>row.path).concat('test-results/ma3/t8/INDEX.sha256');
const data=execFileSync('git',['cat-file','--batch'],{input:paths.map(path=>prefix+path).join('\n')+'\n',maxBuffer:30*1024*1024,windowsHide:true});
let offset=0;
for(let i=0;i<paths.length;i++) {
  const end=data.indexOf(10,offset);assert(end>=0);
  const header=data.subarray(offset,end).toString('utf8');assert.match(header,/^[0-9a-f]+ blob \d+$/);
  const size=Number(header.split(' ')[2]);offset=end+1;
  const bytes=data.subarray(offset,offset+size);offset+=size+1;
  assert.deepEqual(bytes,readFileSync(join(root,paths[i])),paths[i]+' Git bytes differ');
  if(i<entries.length)assert.equal(sha(bytes),entries[i].digest,paths[i]);
}
const selected=execFileSync('git',staged?['diff','--cached','--name-only','-z']:['diff-tree','--no-commit-id','--name-only','-r','-z','HEAD'],{windowsHide:true}).toString('utf8').split('\0').filter(Boolean);
assert.deepEqual([...selected].sort(),[...paths].sort());
assert(!selected.some(path=>path.startsWith('test-results/ma3/t8/package/')||/\.(sqlite|db|exe|node)$/.test(path)));
console.log(JSON.stringify({classification:'STATIC VERIFIED',mode:staged?'staged':'committed',verifiedFiles:paths.length,committedBytesMatchSeal:true,unexpectedPaths:[]}));
