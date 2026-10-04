import { createFileRoute } from "@tanstack/react-router";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { authorizeBridge, clientKey } from "../../lib/orch/host-bridge.server.ts";
import { developmentStateDirectory } from "../../lib/bunny-host/state-paths.server.ts";

export const Route=createFileRoute("/api/bunny-pair")({server:{handlers:{POST:async({request})=>{
  try {
    const access=authorizeBridge(request);
    if(access.local) return Response.json({error:"Use this endpoint from your configured HTTPS companion origin."},{status:400});
    const data=await request.json() as {code?:string;name?:string};
    if(typeof data.code!=="string" || typeof data.name!=="string" || data.code.length>100 || data.name.length>100) return Response.json({error:"Invalid pairing input."},{status:400});
    const credentials=JSON.parse(readFileSync(process.env.BUNNY_HOST_CREDENTIALS_FILE ?? join(resolve(process.env.BUNNY_HOST_DATA_DIRECTORY ?? developmentStateDirectory()),process.env.BUNNY_STATE_LAYOUT==="2" ? "credentials/credentials.json" : "credentials.json"),"utf8")) as {port:number};
    const response=await fetch(`http://127.0.0.1:${credentials.port}/pair`,{method:"POST",headers:{"content-type":"application/json","x-bunny-pair-client":clientKey(request)},body:JSON.stringify(data),signal:AbortSignal.timeout(5000)});
    const result=await response.json();if(!response.ok) return Response.json({error:result.error},{status:response.status});
    return Response.json({paired:true,deviceId:result.deviceId},{headers:{"set-cookie":`bunny_device=${result.token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=31536000`,"cache-control":"no-store"}});
  } catch {return Response.json({error:"Pairing unavailable. Verify the configured companion connection."},{status:403});}
}}}});
