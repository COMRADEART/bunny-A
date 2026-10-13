import {readFileSync,writeFileSync} from 'node:fs';
const root='test-results/ma2-gate10/';
let source=readFileSync(root+'public-probe.mjs','utf8');
source="import {toJSON} from 'seroval';\nconst wire=value=>JSON.stringify(toJSON(value));\n"+source;
source=source.replaceAll('body:JSON.stringify(', 'body:wire(');
source=source.replace("const headers={'content-type':'application/json',origin:url.origin};", "const headers={'content-type':'application/json','x-tsr-serverfn':'true',origin:url.origin};");
source=source.replace('public-denials.json','public-denials-valid-wire.json');
writeFileSync(root+'public-probe-valid-wire.mjs',source);
