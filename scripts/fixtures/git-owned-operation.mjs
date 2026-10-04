import { runCommand } from "../../src/lib/bunny-missions/capabilities/process.server.ts";
const fixture=JSON.parse(process.env.BUNNY_T4_OPERATION);
const result=await runCommand(fixture.git,["commit","-m","must not finish"],{cwd:fixture.repo,env:process.env,signal:new AbortController().signal,timeoutMs:10000,owner:{dataDirectory:fixture.state,missionId:"hard-kill",action:"git.commit"}});
process.send?.({result});
