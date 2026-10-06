import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startHost } from "./http.server.ts";
import { providerBase } from "./adapters.server.ts";
import type { ProviderAdapter } from "./contracts.ts";

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "bunny-t10-authority-"));
  const unapprovedFixture: ProviderAdapter = {
    id: "claude",
    detect: async () => ({ ...providerBase("claude"), installed: true, authenticated: true, availability: "ready", capabilities: ["text"] }),
    launch: () => assert.fail("The unapproved stream fixture must never launch a provider"),
  };
  const host = await startHost({ dataDirectory: directory, root: directory, port: 45139, adapters: [unapprovedFixture] });
  const base = "http://127.0.0.1:45139";
  const command = (action: string, data: unknown = {}, token = host.token) => fetch(base + "/command", { method: "POST", headers: { authorization: "Bearer " + token, "content-type": "application/json" }, body: JSON.stringify({ action, data }) });
  const pair = async () => {
    const code = (await (await command("pairing.create")).json()).pairCode;
    const response = await fetch(base + "/pair", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, name: "T10 disposable client" }) });
    assert.equal(response.status, 200);
    return await response.json() as { token: string; deviceId: string };
  };
  const controllers: AbortController[] = [];
  const stream = async (token: string, path = "/events") => {
    const abort = new AbortController(); controllers.push(abort);
    const response = await fetch(base + path, { headers: { authorization: "Bearer " + token }, signal: abort.signal });
    assert.equal(response.status, 200);
    const reader = response.body!.getReader();
    await reader.read();
    return reader;
  };
  const emit = (message: string, taskId: string | null = null) => host.manager.emit(host.manager.db.event("t10.safe_probe", taskId, message));
  const close = async () => { for (const c of controllers) c.abort(); await host.close(); rmSync(directory, { recursive: true, force: true }); };
  return { host, base, command, pair, stream, emit, close };
}
async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, marker: string) {
  let text = "";
  for (let i = 0; i < 20; i++) {
    const next = await Promise.race([reader.read(), new Promise<never>((_, reject) => setTimeout(() => reject(new Error("bounded stream read timed out")), 2000))]);
    if (next.done) return { text, closed: true };
    text += new TextDecoder().decode(next.value);
    if (text.includes(marker)) return { text, closed: false };
  }
  throw new Error("bounded stream batch limit");
}
for (const taskScoped of [false, true]) test(`T10-T6-04: revocation ends an already authenticated ${taskScoped ? "task" : "Host"} SSE before future delivery`, async () => {
  const f = await fixture();
  try {
    const device = await f.pair();
    const taskId = taskScoped ? f.host.manager.submit({ prompt: "Safe unapproved stream fixture", mode: "balanced" }).id : null;
    const reader = await f.stream(device.token, taskId ? "/events?task=" + taskId : "/events");
    f.emit("AUTHORIZED_POSITIVE_CONTROL", taskId);
    assert.equal((await readUntil(reader, "AUTHORIZED_POSITIVE_CONTROL")).closed, false);
    assert.equal((await f.command("device.revoke", { id: device.deviceId })).status, 200);
    f.emit("POST_REVOKE_FORBIDDEN_DELIVERY", taskId);
    try {
      const remaining = await readUntil(reader, "POST_REVOKE_FORBIDDEN_DELIVERY");
      assert.equal(remaining.closed, true);
      assert.ok(!remaining.text.includes("POST_REVOKE_FORBIDDEN_DELIVERY"));
    } catch (error) {
      // Destroyed HTTP streams report termination as a fetch TypeError on Node.
      assert.ok(error instanceof TypeError, String(error));
    }
    assert.equal((await fetch(f.base + "/events", { headers: { authorization: "Bearer " + device.token } })).status, 401);
    assert.equal((await fetch(f.base + "/state", { headers: { authorization: "Bearer " + device.token } })).status, 401);
    assert.equal((await f.command("stop", { id: "unknown" }, device.token)).status, 401);
  } finally { await f.close(); }
});
test("T10-T6-04: revoking one device preserves workstation and independently paired streams", async () => {
  const f = await fixture();
  try {
    const a = await f.pair(), b = await f.pair();
    const workstation = await f.stream(f.host.token), other = await f.stream(b.token);
    assert.equal((await f.command("device.revoke", { id: a.deviceId })).status, 200);
    f.emit("UNRELATED_AUTHORITY_SURVIVES");
    for (const reader of [workstation, other]) assert.equal((await readUntil(reader, "UNRELATED_AUTHORITY_SURVIVES")).closed, false);
    assert.equal((await fetch(f.base + "/state", { headers: { authorization: "Bearer " + b.token } })).status, 200);
  } finally { await f.close(); }
});
