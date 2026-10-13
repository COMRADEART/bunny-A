import ts from 'typescript';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
const paths = ['src/components/island/desktop.tsx', 'src/lib/bunny-host/agent-runtime.server.ts', 'src/lib/bunny-host/http.server.ts', 'src/lib/bunny-host/manager.server.ts', 'src/lib/bunny-host/presentation.ts', 'src/lib/bunny-missions/manager.server.ts', 'src/lib/orch/host.ts', 'src/store/use-island.ts'];
const tokens = source => { const scan=ts.createScanner(ts.ScriptTarget.Latest,true,ts.LanguageVariant.JSX,source); const out=[]; while(scan.scan()!==ts.SyntaxKind.EndOfFileToken) out.push({key:scan.getTokenText().replaceAll("\r\n","\n"),start:scan.getTokenPos(),end:scan.getTextPos()}); return out.filter((t,i)=> !(t.key==="," && [")", "]", "}"].includes(out[i+1]?.key))); };
for(const path of paths) {
 const before=execFileSync('git',['show',`697d9abb8de5ed3e85de6f323e5486e76347f356:${path}`],{encoding:'utf8',maxBuffer:4*1024*1024}); const current=readFileSync(path,'utf8');
 const a=tokens(before),b=tokens(current);
 const py="import sys,json,difflib\nx=json.load(sys.stdin)\na=x['a'];b=x['b'];s=x['before'].encode('utf-16-le');c=x['current'].encode('utf-16-le')\nops=difflib.SequenceMatcher(None,[t['key'] for t in a],[t['key'] for t in b],autojunk=False).get_opcodes()\nfor tag,i,j,k,l in reversed(ops):\n if tag=='equal':continue\n start=a[i]['start'] if i<len(a) else len(s)//2\n end=a[j]['start'] if j<len(a) else len(s)\n first=b[k]['start'] if k<len(b) else len(c)//2\n last=b[l]['start'] if l<len(b) else len(c)\n s=s[:start*2]+c[first*2:last*2]+s[end*2:]\nprint(s.decode('utf-16-le'),end='')";
 const next=execFileSync('python',['-X','utf8','-c',py],{input:JSON.stringify({before,current,a,b}),encoding:'utf8',maxBuffer:4*1024*1024});
 if(JSON.stringify(tokens(next).map(t=>t.key))!==JSON.stringify(b.map(t=>t.key)))throw Error(`Token preservation failed ${path}`);
 writeFileSync(path,next);
}
console.log('Preserved original layout and all implementation tokens.');
