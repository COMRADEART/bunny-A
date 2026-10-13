// Byte seal for retained evidence only. Package binary provenance is recorded by the final manifest, not recommitted.
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { resolve, join, relative, sep } from "node:path";
import { createHash } from "node:crypto";
const ev=resolve(import.meta.dirname), root=resolve(ev,"../../..");
const sha=data=>createHash("sha256").update(data).digest("hex");
const index=join(ev,"INDEX.md"), seal=join(ev,"INDEX.sha256");
const allowedRootFiles=new Set(["MA3_T12_FULL_DUPLEX_VOICE_ACCEPTANCE.md",".gitattributes"]);
const checked=rel=>{
  const absolute=resolve(root,rel);
  if (!absolute.startsWith(ev+sep) && !allowedRootFiles.has(rel)) throw Error("Seal path is outside T12 evidence");
  return absolute;
};
if(process.argv[2]==="--verify"){
  const entries=readFileSync(seal,"utf8").trim().split(/\r?\n/).map(line=>{
    const m=/^([0-9a-f]{64})  (.+)$/.exec(line);
    if(!m)throw Error("Malformed seal line");
    return {sha256:m[1],path:m[2]};
  });
  const failures=entries.filter(entry=>sha(readFileSync(checked(entry.path)))!==entry.sha256);
  if(failures.length)throw Error("Seal mismatch: "+failures.map(x=>x.path).join(", "));
  console.log(JSON.stringify({result:"PASS",checked:entries.length,sourceCommit:"86cc164d103edb97b7c39de0f520bc37d40e1db4"}));
}else if(process.argv[2]==="--write"){
  const files=[];
  const walk=directory=>{
    for(const name of readdirSync(directory).sort()){
      const path=join(directory,name), stat=statSync(path);
      if(stat.isDirectory()){
        if(/^(?:windows-package-|disposable-aec-probe$)/.test(name))continue;
        walk(path);
      }else if(path!==index && path!==seal && /\.(?:md|mjs|mts|ps1|json|jsonl|log|txt|out|png)$/i.test(name))files.push(path);
    }
  };
  walk(ev);
  files.push(...[...allowedRootFiles].map(name=>join(root,name)));
  const paths=files.map(path=>relative(root,path).replaceAll("\\","/")).sort();
  writeFileSync(index,[
    "# MA3 T12 retained evidence index","",
    "Final executable/tooling source: 86cc164d103edb97b7c39de0f520bc37d40e1db4.",
    "The local evidence commit is separate. This index and every listed artifact are byte-sealed in INDEX.sha256.",
    "",
    "Historical human/device trials preserve their original scope. Final source has separate regression, independent",
    "review and packaged capture/playback checks. Before-closeout failures and superseded records are retained.",
    "",
    "Binary package folders/archives, disposable probe state, native binaries/model assets and synthetic audio files",
    "are excluded from this evidence commit. package/final-release-manifest.json pins the final 393-file package.",
    "No raw human audio or credentials are included. This is a local test package; production was not installed or restarted.",
    "",
    "Verify from the repository with node test-results/ma3/t12/seal-evidence.mjs --verify.",
    "",
    "Retained artifacts: "+paths.length+".","",
    ...paths.map(path=>"- ["+path+"]("+relative(ev,join(root,path)).replaceAll("\\","/")+")"),
    ""
  ].join("\n"));
  const sealedPaths=[...paths,relative(root,index).replaceAll("\\","/")].sort();
  writeFileSync(seal,sealedPaths.map(path=>sha(readFileSync(checked(path)))+"  "+path).join("\n")+"\n");
  console.log(JSON.stringify({result:"WRITTEN",artifacts:sealedPaths.length}));
}else throw Error("Use --write or --verify");
