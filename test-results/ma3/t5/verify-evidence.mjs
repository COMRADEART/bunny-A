import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const root='test-results/ma3/t5/';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const index=readFileSync(root+'INDEX.md');
if(hash(index)!==readFileSync(root+'INDEX.sha256','utf8').split(/\s/)[0])throw new Error('Index seal mismatch');
const records=[...index.toString().matchAll(/^\| \[([^\]]+)\]\([^)]*\) \| (\d+) \| ([a-f0-9]{64}) \|$/gm)];
for(const [,name,length,sha]of records){const bytes=readFileSync(root+name);if(bytes.length!==+length||hash(bytes)!==sha)throw new Error('Evidence mismatch: '+name);if(process.argv.includes('--staged')){const staged=spawnSync('git',['show',':'+root+name],{windowsHide:true,maxBuffer:20*1024*1024});if(staged.status||hash(staged.stdout)!==sha)throw new Error('Staged bytes mismatch: '+name);}}
console.log(`Verified ${records.length} artifact hashes and index seal${process.argv.includes('--staged')?' against staged Git bytes':''}.`);
