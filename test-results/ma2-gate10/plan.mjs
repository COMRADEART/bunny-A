import{readFileSync,writeFileSync}from'node:fs';
const brief=readFileSync('C:/Users/allam/.codex/attachments/98db835f-4fd0-45f1-87d1-083525b0dad3/Pasted text.txt','utf8');
const blocks=[...brief.matchAll(/(?:^|\n)(\d+)\. ([^\r\n]+)[\s\S]*?\n={10,}\r?\n([\s\S]*?)(?=\n={10,}\r?\n\d+\.|$)/g)];
const groups=[[7,10,'T1'],[11,14,'T2'],[15,19,'T3'],[20,24,'T4'],[25,29,'T5'],[30,37,'T6'],[38,41,'T7'],[42,47,'T8'],[48,56,'T9'],[57,61,'T9R'],[62,75,'XG']];
const plan=blocks.filter(b=>Number(b[1])>=7&&Number(b[1])<=75).map(b=>{const section=Number(b[1]),g=groups.find(([lo,hi])=>section>=lo&&section<=hi);return{attackId:'T10-'+g[2]+'-'+String(section-g[0]+1).padStart(2,'0'),section,gate:g[2],title:b[2],expected:b[3].trim(),status:'PLANNED',classification:null,evidence:[]};});
if(plan.length!==69)throw Error('Expected all 69 requested attacks; got '+plan.length);
writeFileSync('test-results/ma2-gate10/attack-plan.json',JSON.stringify({gate:'M-A-2 T10',plannedAttacks:plan.length,attacks:plan},null,2)+'\n');
writeFileSync('test-results/ma2-gate10/threat-matrix.md','# T10 adversarial threat matrix\n\nBefore execution: every result is PLANNED. Dangerous mechanics use disposable roots; production disruption requires separate explicit authorization.\n\n| Attack ID | Invariant | Attack | Expected containment | Evidence | Classification | Result |\n|---|---|---|---|---|---|---|\n'+plan.map(a=>'| '+a.attackId+' | '+a.gate+' | §'+a.section+' '+a.title.replace(/\|/g,'/')+' | Preserve accepted authority/state/ownership; refuse invalid input or contain according to current policy | Pending | Pending | PLANNED |').join('\n')+'\n');
console.log('All 69 T10 attacks planned with stable IDs.');
