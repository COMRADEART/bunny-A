import { startHost } from "../src/lib/bunny-host/http.server.ts";
import { spawn } from "node:child_process";
import { resolve, join } from "node:path";
import { developmentStateDirectory } from "../src/lib/bunny-host/state-paths.server.ts";
const dataDirectory=resolve(developmentStateDirectory(),"real-provider-validation",process.env.BUNNY_VALIDATION_PROVIDER ?? "claude");
const host=await startHost({dataDirectory,port:43139,root:process.cwd()});
try {
  const code=await new Promise((resolveExit,reject)=>{
    const child=spawn(process.execPath,["--experimental-strip-types","scripts/validate-bunny-agents.mjs"],{stdio:"inherit",windowsHide:true,env:{...process.env,BUNNY_VALIDATION_CREDENTIALS:join(dataDirectory,"credentials.json")}});
    child.on("error",reject);child.on("exit",resolveExit);
  });
  process.exitCode=code ?? 1;
} finally {await host.close();}
