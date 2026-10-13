import { pathToFileURL, fileURLToPath } from "node:url";
import { join } from "node:path";
const fixture=JSON.parse(process.env.BUNNY_T4_FIXTURE);
const runtime=fixture.release?join(fixture.release,"Bunny-Host.mjs"):fileURLToPath(new URL("../bunny-host.mjs",import.meta.url));
const {host}=await import(pathToFileURL(runtime).href);
if(!host)throw new Error("Disposable Host failed to start.");
host.missions.configure({enabled:true,triggersEnabled:false,limits:{maxRetriesPerStep:0,maxConcurrentAgents:3}},"T4 disposable test");
await host.missions.bus.refreshHealth();
const reply=(id,value)=>process.send({type:"reply",id,value});
process.on("message",message=>{
  if(message.type==="fatal") {setTimeout(()=>Promise.reject(new Error("T4 Git fatal integration fixture")),0);return;}
  if(message.type==="close") {host.containment.background({subsystem:"fixture"},async()=>{await host.close();process.exit(0);});return;}
  host.containment.background({subsystem:"fixture"},async()=>{
    try {
      if(message.type==="mission") {
        const project={id:crypto.randomUUID(),name:"T4 fixture",path:message.repo,createdAt:Date.now()};host.manager.db.project(project);
        const mission=host.missions.create({objective:"T4 harmless Git operation",title:message.name,mode:"fast",origin:"fixture",projectId:project.id,steps:[{role:"Git",objective:"Run harmless local Git",access:"write",isolation:"shared",timeoutMs:message.timeoutMs??20000,executor:{kind:"capability",action:message.action??"git.commit",params:message.params??{message:"T4 fixture commit"}}}]});
        host.missions.approve(mission.id,"T4 disposable test");reply(message.id,{missionId:mission.id,stepId:mission.steps[0].id});
      } else if(message.type==="stop") {await host.missions.stop(message.missionId,"T4 Stop");reply(message.id,host.missions.get(message.missionId));}
      else if(message.type==="get") reply(message.id,host.missions.get(message.missionId));
      else if(message.type==="direct") reply(message.id,await host.missions.bus.request({action:message.action,params:message.params,missionId:null,stepId:null,envelope:null,origin:"fixture",cwd:message.repo,roots:[message.repo],direct:{confirmed:true},timeoutMs:message.timeoutMs??10000}));
      else if(message.type==="summary") reply(message.id,{health:host.containment.snapshot(),instanceId:host.manager.instanceId,tasks:host.manager.db.tasks().length,projects:host.manager.db.projects().length,missionsEnabled:host.missions.config().enabled,triggersEnabled:host.missions.config().triggersEnabled,codex:host.manager.providers.find(p=>p.id==="codex")});
    } catch(error) {reply(message.id,{error:String(error)});}
  });
});
process.send({type:"ready",pid:process.pid,instanceId:host.manager.instanceId});
