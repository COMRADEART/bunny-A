import {randomUUID} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
const [folder,action,data='{}']=process.argv.slice(2),id=randomUUID();
if(!/^test-results\/ma3\/t9r\/(protocol|continuity)$/.test(folder))throw Error('Only named disposable fixtures accepted');
writeFileSync(folder+'/fixture-request.tmp',JSON.stringify({id,action,data:JSON.parse(data)}));renameSync(folder+'/fixture-request.tmp',folder+'/fixture-request.json');
const deadline=Date.now()+30000;
while(Date.now()<deadline){const path=folder+'/fixture-response-'+id+'.json';if(existsSync(path)){const result=JSON.parse(readFileSync(path));if(result.error)throw Error(result.error);if(action==='snapshot')writeFileSync(folder+'/last-snapshot.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(action==='snapshot'?{result:'saved',path:folder+'/last-snapshot.json'}:result));process.exit(0);}await new Promise(done=>setTimeout(done,100));}
throw Error('Fixture control timeout');
