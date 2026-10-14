import {execFileSync} from 'node:child_process';import{writeFileSync,unlinkSync}from'node:fs';
const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim();
const tracked=git('diff','--name-only','--','src').split(/\r?\n/).filter(Boolean);
const created=['src/components/island/accounts.tsx','src/components/island/account-model.ts','src/components/island/account-model.test.ts','src/lib/bunny-host/connections.ts','src/lib/bunny-host/connections.server.ts','src/lib/bunny-host/connections.test.ts','src/lib/bunny-host/connections-host.test.ts','src/lib/bunny-host/usage-retention.server.ts'];
git('add','--',...tracked,...created);
const pkg=JSON.parse(git('show','HEAD:package.json'));pkg.scripts.test=pkg.scripts.test.replace('src/lib/bunny-host/intelligence-host.test.ts','src/lib/bunny-host/intelligence-host.test.ts src/lib/bunny-host/connections.test.ts src/lib/bunny-host/connections-host.test.ts');
const temp='test-results/ma3/t13-2/package-index.tmp';writeFileSync(temp,JSON.stringify(pkg,null,2)+'\n'); const blob=git('hash-object','-w',temp);unlinkSync(temp);git('update-index','--cacheinfo',`100644,${blob},package.json`);
const staged=git('diff','--cached','--name-only').split(/\r?\n/);if(staged.some(p=>p!== 'package.json'&&!p.startsWith('src/')))throw Error('Unexpected staged file');
console.log(git('diff','--cached','--stat'));git('commit','-m','Implement T13.2 unified account registry and bound provider consent');console.log(git('rev-parse','HEAD'));
