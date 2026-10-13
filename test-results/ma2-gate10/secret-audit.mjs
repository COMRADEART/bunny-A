import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';import {createHash} from 'node:crypto';
const rec='test-results/ma2-gate10',read=p=>JSON.parse(readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const hash=v=>createHash('sha256').update(v).digest('hex');
const walk=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(dir,e.name)):[join(dir,e.name)]);
const secretValues=[];
function add(value,kind){if(typeof value==='string'&&value.length>=12&&!/^[a-f0-9]{64}$/i.test(value))secretValues.push({value,kind,fingerprint:hash(value)});}
for(const root of ['C:/Users/allam/AppData/Local/Bunny-A','C:/Users/allam/AppData/Local/Bunny-A-T10-stage']){const p=join(root,'state/credentials/credentials.json');if(existsSync(p))add(read(p).token,'Host credential');}
function privateKeys(value){if(!value||typeof value!=='object')return;for(const [k,v]of Object.entries(value)){if(/^(access_token|refresh_token|id_token|api_key|OPENAI_API_KEY|token|password|secret|cookie)$/i.test(k))add(v,'provider credential');else if(v&&typeof v==='object')privateKeys(v);}}
for(const p of ['C:/Users/allam/.codex/auth.json','C:/Users/allam/.claude/.credentials.json'])if(existsSync(p))privateKeys(read(p));
for(const [k,v]of Object.entries(process.env))if(/API_KEY|ACCESS_TOKEN|AUTH_TOKEN|PASSWORD|PRIVATE_KEY|COOKIE/i.test(k))add(v,'environment credential');
const artifacts=[...walk(rec).filter(p=>!p.endsWith('secret-audit/result.json')), ...readdirSync('screenshots').filter(n=>n.startsWith('t10-')).map(n=>join('screenshots',n)),...['MA2_T10_ADVERSARIAL_OPERATIONAL_AUDIT.md','MA2_ACCEPTANCE_MATRIX.md','MA2_IMPLEMENTATION_REPORT.md','MA2_INDEPENDENT_REVIEW_PACKET.md'].filter(existsSync)];
const matches=[];for(const p of artifacts){const b=readFileSync(p);for(const s of secretValues)if(b.includes(Buffer.from(s.value)))matches.push({path:p,kind:s.kind,fingerprint:s.fingerprint});}
const fixtureOutput=read(join(rec,'stop-composition.json')).secretErrorBoundaryResults;assert.equal(fixtureOutput.length,5);for(const x of fixtureOutput){assert.match(x.safe.message,/redacted/);assert.ok(!/T10_FAILURE_FIXTURE_DO_NOT_PUBLISH|T10_FIXTURE_SECRET/.test(x.safe.message));}
const generic=[];for(const p of artifacts.filter(p=>/\.(json|log|md)$/.test(p))){const s=readFileSync(p,'utf8');if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(s))generic.push({path:p,type:'private-key block'});if(/Bearer\s+[a-zA-Z0-9_\-.]{30,}/.test(s))generic.push({path:p,type:'long raw Bearer value'});}
mkdirSync(join(rec,'secret-audit'),{recursive:true});writeFileSync(join(rec,'secret-audit/result.json'),JSON.stringify({recordedAt:new Date().toISOString(),classification:'STATIC VERIFIED',attackIds:['T10-T5-01','T10-T5-02','T10-XG-10'],filesScanned:artifacts.length,privateValuesChecked:secretValues.map(({kind,fingerprint})=>({kind,fingerprint})),rawPrivateValuesRecorded:false,realSecretMatches:matches,genericSecretMatches:generic,fixtureFailureBoundaries:fixtureOutput.map(x=>({boundary:x.boundary,redacted:true})),fixtureInputsInSource:'Explicit safe test inputs are not public-output leaks',historicRevokedDeviceTokenAbsence:'Tokens not retained; current credentials and all available private provider/environment values checked; canonical DB retains hashes only'},null,2)+'\n');
assert.equal(matches.length,0);assert.equal(generic.length,0);console.log('Secret audit PASS; '+artifacts.length+' artifacts checked without emitting private values.');
