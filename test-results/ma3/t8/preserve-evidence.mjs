import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
const git=(...args)=>execFileSync('git',args,{windowsHide:true,maxBuffer:30*1024*1024});
const changed=git('diff','--name-only','--','test-results/ma3/t5','test-results/ma3/t6','test-results/ma3/t7').toString().trim().split(/\r?\n/).filter(Boolean);
const records=[];
for(const path of changed){
 const retained=join('test-results/ma3/t8','regression-'+path.split('/')[2],...path.split('/').slice(3));
 mkdirSync(dirname(retained),{recursive:true});
 const generated=readFileSync(path),original=git('show','HEAD:'+path);
 writeFileSync(retained,generated);writeFileSync(path,original);
 records.push({path,retained,restoredExactly:readFileSync(path).equals(original),rerunSha256:createHash('sha256').update(generated).digest('hex')});
}
writeFileSync('test-results/ma3/t8/historical-evidence-preservation.json',JSON.stringify(records,null,2)+'\n');
console.log(`${records.length} regenerated prior-gate evidence files retained under T8; original evidence restored byte-for-byte.`);
