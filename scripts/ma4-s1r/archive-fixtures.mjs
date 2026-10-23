import { fixtures, version } from './fixtures.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const current = fixtures.map(({id,prompt,format})=>({id,prompt,format}));
const previous = current.map(c => c.id==='planning' ? {...c,prompt:'Put these dependent steps in order: package depends on test; test depends on compile. Reply only compile,test,package.'} : c);
const hash = input => createHash('sha256').update(JSON.stringify(input)).digest('hex');
const raw = JSON.parse(readFileSync('docs/ma4-s1r/evidence/benchmarks.json','utf8'));
assert.equal(hash(previous),raw.fixtureHash,'Archived v2 prompt bytes must match the original receipt.');
writeFileSync('docs/ma4-s1r/evidence/fixture-sets.json',JSON.stringify({referenceValidators:'scripts/ma4-s1r/fixtures.mjs; unchanged across versions',sets:[
  {version:raw.version,sha256:hash(previous),cases:previous,planningCaseExcluded:true},
  {version,sha256:hash(current),cases:current,planningAnswerNotInPrompt:true}
]},null,2)+'\n');
console.log('Archived exact synthetic prompt sets; v2 hash matches original evidence.');
