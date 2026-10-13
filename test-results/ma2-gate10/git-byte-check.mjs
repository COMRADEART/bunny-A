import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {execFileSync} from 'node:child_process';import {createHash} from 'node:crypto';
const root='test-results/ma2-gate10',index=JSON.parse(readFileSync(root+'/evidence/index.json','utf8'));
const files=['.gitattributes',...index.documentationSources.map(d=>d.source),...index.entries.map(e=>root+'/'+e.path),root+'/evidence/index.json'];
for(const p of files){const disk=readFileSync(p),staged=execFileSync('git',['show',':'+p],{maxBuffer:4e6});assert.equal(createHash('sha256').update(disk).digest('hex'),createHash('sha256').update(staged).digest('hex'),p);}
console.log('Git staged bytes match disk/sealed evidence for '+files.length+' authorized files.');
