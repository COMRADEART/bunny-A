import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startHost } from "../http.server.ts";
import { VOICE_ACTIONS } from "./voice-protocol.ts";

async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

type Body = Record<string, unknown> & { error?: string; code?: string; data?: Record<string, unknown>; snapshot?: unknown; voice?: Record<string, unknown> };

async function fixture(options: { voice?: { workerExtraArgs?: string[] } } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "bunny-voice-host-"));
  const root = join(directory, "project");
  mkdirSync(root);
  writeFileSync(join(root, "seed.txt"), "seed");
  const port = await freePort();
  const host = await startHost({
    dataDirectory: directory,
    root,
    port,
    // Test-only worker flags (fixture output sink). Passed by the test, never read from the environment or HTTP.
    voice: options.voice,
    adapters: [],
    sample: async () => ({ at: Date.now(), cpu: { utilization: null, clockMhz: null, temperatureC: null }, memory: { usedBytes: 0, availableBytes: 1, totalBytes: 1 }, gpus: [], notes: ["voice disposable telemetry"] }),
  });
  const base = `http://127.0.0.1:${port}`;
  const command = async (action: string, data: unknown = {}, token = host.token) => {
    const response = await fetch(`${base}/command`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ action, data }),
    });
    return { status: response.status, body: (await response.json()) as Body };
  };
  const state = async (token = host.token) => {
    const response = await fetch(`${base}/state`, { headers: { authorization: `Bearer ${token}` } });
    return { status: response.status, body: (await response.json()) as Body };
  };
  const pair = async (name = "voice disposable phone") => {
    const code = (await command("pairing.create")).body.pairCode;
    const response = await fetch(`${base}/pair`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, name }) });
    assert.equal(response.status, 200);
    return (await response.json()) as { token: string };
  };
  const close = async () => {
    await host.close();
    rmSync(directory, { recursive: true, force: true });
  };
  return { host, command, state, pair, close };
}

test("V38 V53 a paired device is refused every voice action, before anything is read or dispatched", async () => {
  const f = await fixture();
  try {
    const device = await f.pair();
    for (const action of VOICE_ACTIONS) {
      const response = await f.command(action, { mode: "hands_free", text: "pause the agent", on: true }, device.token);
      assert.notEqual(response.status, 200, action);
      assert.equal(response.body.data, undefined, `${action} returned no voice data to a device`);
      assert.equal(response.body.voice, undefined, action);
    }
  } finally {
    await f.close();
  }
});

test("V01 V02 the workstation can read voice state without opening a session; nothing is opened at Host start", async () => {
  const f = await fixture();
  try {
    const response = await f.command("voice.state");
    assert.equal(response.status, 200);
    assert.equal(response.body.snapshot, undefined, "voice.state does not carry the dashboard snapshot");
    const data = response.body.data as Record<string, unknown>;
    assert.equal(data.open, false);
    assert.equal(data.capturing, false);
    assert.equal(data.playing, false);
    assert.equal(data.state, "IDLE");
    assert.equal(data.protocol, "bunny-voice/1");
  } finally {
    await f.close();
  }
});

test("V02 V24 V57 an explicit open either starts contained or reports an honest reason, never a silent success", async () => {
  const f = await fixture();
  try {
    const response = await f.command("voice.session.open", { mode: "push_to_talk" });
    assert.equal(response.status, 200);
    const data = response.body.data as { open: boolean; error: { code: string } | null };
    if (process.platform === "win32") {
      // The worker exe is built separately; without its build record the Host refuses to launch it.
      if (data.open === false) assert.ok(["WORKER_INTEGRITY", "INTERNAL", "TIMEOUT"].includes(data.error?.code ?? ""), JSON.stringify(data.error));
    } else {
      assert.equal(data.open, false);
      assert.equal(data.error?.code, "NOT_WINDOWS");
    }
    await f.command("voice.session.close");
    const closed = await f.command("voice.state");
    assert.equal((closed.body.data as { open: boolean }).open, false);
  } finally {
    await f.close();
  }
});

test("the workstation /state carries the voice snapshot and a paired device projection never does", async () => {
  const f = await fixture();
  try {
    const workstation = await f.state();
    assert.equal(workstation.status, 200);
    assert.equal((workstation.body.voice as { open: boolean }).open, false);
    const device = await f.pair();
    const phone = await f.state(device.token);
    assert.equal(phone.status, 200);
    assert.equal(phone.body.voice, undefined, "voice is stripped from the device projection");
  } finally {
    await f.close();
  }
});

test("voice actions are not in the device rights and unknown voice actions are refused on the workstation", async () => {
  const f = await fixture();
  try {
    const response = await f.command("voice.bogus");
    assert.notEqual(response.status, 200);
  } finally {
    await f.close();
  }
});

test("V44 a Host restart never revives a voice session: the new Host starts closed", async () => {
  const f = await fixture();
  const first = await f.state();
  assert.equal((first.body.voice as { open: boolean }).open, false);
  await f.close();
  const again = await fixture();
  try {
    const second = await again.state();
    assert.equal((second.body.voice as { open: boolean; sessionId: unknown }).open, false);
    assert.equal((second.body.voice as { sessionId: unknown }).sessionId, null);
  } finally {
    await again.close();
  }
});

// M-A-3 T10 round 2 (H10, H11): the degraded Host and the journal over the real HTTP surface.

test("T10 H10 a degraded Host keeps stop, mute, release and state working and refuses starting or speaking", async () => {
  const f = await fixture();
  try {
    f.host.containment.degrade("*", "T10 H10 fixture: the Host is degraded.");
    const state = await f.command("voice.state");
    assert.equal(state.status, 200, "voice.state is readable while degraded");
    for (const action of ["voice.interrupt", "voice.mute", "voice.session.close", "voice.control.cancel"]) {
      const response = await f.command(action, action === "voice.mute" ? { on: false } : {});
      assert.equal(response.status, 200, `${action} still works while degraded`);
    }
    const listen = await f.command("voice.listen.start", { source: "button" });
    assert.notEqual(listen.status, 200, "voice.listen.start is refused while degraded");
    const typed = await f.command("voice.text", { text: "hello there" });
    assert.notEqual(typed.status, 200, "voice.text is refused while degraded");
    const opened = await f.command("voice.session.open", { mode: "push_to_talk" });
    assert.notEqual(opened.status, 200, "opening voice is refused while degraded");
    const still = await f.command("voice.state");
    assert.equal((still.body.data as { open: boolean }).open, false, "a refused open leaves no session behind");
  } finally {
    await f.close();
  }
});

test("T10 H11 a full voice turn over the Host HTTP surface journals no transcript or answer text", { skip: process.platform !== "win32" && "Windows only" }, async () => {
  const f = await fixture({ voice: { workerExtraArgs: ["--output", "null"] } });
  const transcript = "What is the capital of France, my private question?";
  try {
    const opened = await f.command("voice.session.open", { mode: "push_to_talk" });
    assert.equal((opened.body.data as { open: boolean }).open, true, JSON.stringify(opened.body.data));
    await f.command("voice.text", { text: transcript });
    let snapshot = {} as { state?: string; answer?: string | null };
    const settled = await until(async () => {
      snapshot = ((await f.command("voice.state")).body.data ?? {}) as typeof snapshot;
      return snapshot.state === "IDLE" && typeof snapshot.answer === "string" && snapshot.answer.length > 0;
    }, 20_000);
    assert.equal(settled, true, `the turn settled (last state ${snapshot.state})`);
    const answer = snapshot.answer!;
    await f.command("voice.session.close");
    const rows = f.host.manager.snapshot(0).events.filter((event) => event.type.startsWith("voice."));
    assert.ok(rows.length >= 2, "the voice turn was journaled");
    for (const row of rows) {
      assert.equal(row.detail.includes(transcript), false, `${row.type} must not contain the transcript`);
      assert.equal(row.detail.includes(answer.slice(0, 24)), false, `${row.type} must not contain answer text`);
    }
  } finally {
    await f.close();
  }
});

async function until(check: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const started = Date.now();
  while (!(await check())) {
    if (Date.now() - started > timeoutMs) return false;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return true;
}
