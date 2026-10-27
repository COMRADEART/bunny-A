import test from "node:test";
import assert from "node:assert/strict";
import { nativeCompanionState } from "./native-companion.server.ts";
import { authorizeBridge } from "./host-bridge.server.ts";
import { startHost } from "../bunny-host/http.server.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
const request = () => new Request("https://companion.example/api/bunny-native-v1-state");

test("native state refuses local and unpaired requests before contacting the Host", async () => {
  let sent = 0;
  const fetchHost: typeof fetch = async () => { sent++; throw new Error("must not dispatch"); };
  for (const access of [{ local: true, token: null }, { local: false, token: null }]) {
    const response = await nativeCompanionState(request(), { authorize: () => access, hostPort: () => 43119, fetchHost });
    assert.ok(response.status === 401 || response.status === 403);
  }
  assert.equal(sent, 0);
});

test("native state forwards only the device credential to the loopback Host and refuses redirects", async () => {
  let url = "", auth = "", redirect = "";
  const fetchHost: typeof fetch = async (input, init) => {
    url = String(input); auth = new Headers(init?.headers).get("authorization") ?? ""; redirect = String(init?.redirect);
    return Response.json({ hostIdentity: { hostId: "host-fixture" }, persistentTasks: { schema: "ma4.ptask.snapshot.v1", tasks: [] } });
  };
  const response = await nativeCompanionState(request(), { authorize: () => ({ local: false, token: "device-fixture" }), hostPort: () => 43119, fetchHost });
  assert.equal(response.status, 200); assert.equal(url, "http://127.0.0.1:43119/state");
  assert.equal(auth, "Bearer device-fixture"); assert.equal(redirect, "error"); assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json() as { schema: string; snapshot: { hostIdentity: { hostId: string } } };
  assert.equal(body.schema, "bunny.native.state.v1"); assert.equal(body.snapshot.hostIdentity.hostId, "host-fixture");
});

test("native state reports a revoked device without exposing Host errors", async () => {
  const response = await nativeCompanionState(request(), { authorize: () => ({ local: false, token: "device-fixture" }), hostPort: () => 43119, fetchHost: async () => Response.json({ error: "sensitive host detail" }, { status: 401 }) });
  assert.equal(response.status, 401); assert.equal((await response.text()).includes("sensitive host detail"), false);
});




test("native state uses the existing HTTPS remote gate and rejects cross-origin requests", async () => {
  const previous=process.env.BUNNY_REMOTE_ORIGIN;
  process.env.BUNNY_REMOTE_ORIGIN="https://companion.example";
  try {
    let sent=0;
    const deps={ authorize:(r: Request) => authorizeBridge(r,"127.0.0.1"), hostPort:() => 43119, fetchHost:async () => {sent++;return Response.json({});} };
    const headers={"x-forwarded-proto":"https",cookie:"bunny_device=device-fixture",origin:"https://companion.example"};
    const ok=await nativeCompanionState(new Request("https://companion.example/api/bunny-native-v1-state",{headers}),deps);
    assert.equal(ok.status,200); assert.equal(sent,1);
    const denied=await nativeCompanionState(new Request("https://companion.example/api/bunny-native-v1-state",{headers:{...headers,origin:"https://evil.example"}}),deps);
    assert.equal(denied.status,403); assert.equal(sent,1);
  } finally {
    if(previous===undefined) delete process.env.BUNNY_REMOTE_ORIGIN; else process.env.BUNNY_REMOTE_ORIGIN=previous;
  }
});


test("device-scoped native state works with a real disposable Host and stops after revocation", {timeout: 60_000}, async () => {
  const directory=mkdtempSync(join(tmpdir(),"bunny-native-bridge-"));
  const listener=createServer(); await new Promise<void>(resolve => listener.listen(0,"127.0.0.1",resolve));
  const address=listener.address(); assert.ok(address && typeof address !== "string"); const port=address.port;
  await new Promise<void>(resolve => listener.close(() => resolve()));
  const previous=process.env.BUNNY_REMOTE_ORIGIN; process.env.BUNNY_REMOTE_ORIGIN="https://companion.example";
  let host: Awaited<ReturnType<typeof startHost>> | undefined;
  try {
    host=await startHost({dataDirectory:directory,root:directory,port,adapters:[]});
    const base=`http://127.0.0.1:${port}`;
    const owner={authorization:`Bearer ${host.token}`,"content-type":"application/json",connection:"close"};
    const command=async (action: string, data: object = {}) => fetch(`${base}/command`,{method:"POST",headers:owner,body:JSON.stringify({action,data})});
    const offered=await command("pairing.create"); assert.equal(offered.status,200);
    const pairCode=(await offered.json() as {pairCode:string}).pairCode;
    const paired=await fetch(`${base}/pair`,{method:"POST",headers:{"content-type":"application/json",connection:"close"},body:JSON.stringify({code:pairCode,name:"Native integration fixture"})});
    assert.equal(paired.status,200);
    const device=await paired.json() as {token:string;deviceId:string;hostId:string};
    const makeRequest=() => new Request("https://companion.example/api/bunny-native-v1-state",{headers:{origin:"https://companion.example","x-forwarded-proto":"https",cookie:`bunny_device=${device.token}`}});
    const deps={authorize:(r: Request) => authorizeBridge(r,"127.0.0.1"),hostPort:() => port,fetchHost:fetch};
    const observed=await nativeCompanionState(makeRequest(),deps); assert.equal(observed.status,200);
    const raw=await observed.text(); assert.equal(raw.includes(host.token),false); assert.equal(raw.includes(device.token),false);
    const body=JSON.parse(raw) as {schema:string;snapshot:{hostIdentity:{hostId:string}}};
    assert.equal(body.schema,"bunny.native.state.v1"); assert.equal(body.snapshot.hostIdentity.hostId,device.hostId);
    assert.equal((await command("device.revoke",{id:device.deviceId})).status,200);
    assert.equal((await nativeCompanionState(makeRequest(),deps)).status,401);
  } finally {
    if(host) await host.close();
    rmSync(directory,{recursive:true,force:true,maxRetries:5});
    if(previous===undefined) delete process.env.BUNNY_REMOTE_ORIGIN; else process.env.BUNNY_REMOTE_ORIGIN=previous;
  }
});


test("native state preserves Host rate limiting without returning internal details", async () => {
  const response=await nativeCompanionState(request(), { authorize: () => ({ local:false, token:"device-fixture" }), hostPort:() => 43119, fetchHost:async () => Response.json({error:"internal detail"},{status:429}) });
  assert.equal(response.status,429);
  const body=await response.json() as {code:string;error:string};
  assert.equal(body.code,"RATE_LIMITED"); assert.equal(body.error.includes("internal detail"),false);
});
