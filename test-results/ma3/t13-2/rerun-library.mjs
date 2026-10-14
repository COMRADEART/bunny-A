import{spawn,execFileSync}from'node:child_process';import{readFileSync,writeFileSync,copyFileSync,appendFileSync}from'node:fs';import{resolve,join}from'node:path';
const ev=resolve('test-results/ma3/t13-2'),root=join(ev,'source-checkout'),out=join(ev,'regression-final');const pin=JSON.parse(readFileSync(join(ev,'source-provenance.json'))).sourceCommit;
if(execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim()!==pin)throw Error('Wrong test source');
if(execFileSync('git',['diff','--name-only','--','src','package.json'],{cwd:root,encoding:'utf8'}).trim())throw Error('Test/source files changed');
copyFileSync(join(out,'library.log'),join(out,'library-cleanup-failed.log'));copyFileSync(join(out,'exits.txt'),join(out,'exits-with-cleanup-failure.txt'));
const lines=readFileSync(join(out,'exits.txt'),'utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('library '));writeFileSync(join(out,'exits.txt'),lines.join('\n')+'\n');writeFileSync(join(out,'library.log'),'');
const command=JSON.parse(readFileSync(join(root,'package.json'))).scripts.test.split(' && ')[1];const start=Date.now();
const child=spawn(command,{cwd:root,shell:true,env:{...process.env,FORCE_COLOR:'0'}});child.stdout.on('data',c=>appendFileSync(join(out,'library.log'),c));child.stderr.on('data',c=>appendFileSync(join(out,'library.log'),c));
child.on('exit',code=>{appendFileSync(join(out,'exits.txt'),`library exit=${code} ms=${Date.now()-start} retry=temporary-Windows-cleanup-lock\n`);console.log(`library exit=${code}`);process.exitCode=code??1;});
