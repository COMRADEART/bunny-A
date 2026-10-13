// M-A-3 T10 live harness: drives a DISPOSABLE Bunny Host (temp data dir, non-production port) over its real
// authenticated HTTP surface. It never touches production (43119/8084) or production credentials.
// Usage: node host-driver.mjs <scenario> [outJson]
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const root = resolve(import.meta.dirname, "../../../..");
export async function startHost({ port = 43800 + Math.floor(Math.random() * 100), dataDir } = {}) {
  if (port === 43119) throw new Error("refusing the production port");
  const dir = dataDir ?? mkdtempSync(join(tmpdir(), "bunny-t10-host-"));
  const child = spawn(process.execPath, ["--experimental-strip-types", "scripts/bunny-host.mjs"], {
    cwd: root,
    env: { ...process.env, BUNNY_HOST_DATA_DIRECTORY: dir, BUNNY_HOST_PORT: String(port), BUNNY_STATE_LAYOUT: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  const credPath = join(dir, "credentials.json");
  for (let i = 0; i < 200 && !existsSync(credPath); i++) await sleep(100);
  if (!existsSync(credPath)) throw new Error("Host did not write credentials: " + log.slice(-2000));
  const { token } = JSON.parse(readFileSync(credPath, "utf8"));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(base + "/health")).ok) break; } catch { /* starting */ }
    await sleep(100);
  }
  const command = async (action, data = {}) => {
    const res = await fetch(base + "/command", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ action, data }) });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  };
  const state = async () => (await fetch(base + "/state", { headers: { authorization: `Bearer ${token}` } })).json();
  return { child, dir, port, base, token, command, state, log: () => log, stop: async () => { child.kill(); await sleep(500); } };
}

export async function pollVoice(host, until, { timeoutMs = 60000, everyMs = 100, onSnap } = {}) {
  const t0 = Date.now();
  const timeline = [];
  let last = null;
  while (Date.now() - t0 < timeoutMs) {
    const { body } = await host.command("voice.state");
    const s = body.data;
    if (s) {
      const sig = `${s.state}|${s.capturing}|${s.playing}|${s.partial}|${s.finalTranscript}|${s.answer?.length}`;
      if (sig !== last) { timeline.push({ at: Date.now(), state: s.state, capturing: s.capturing, playing: s.playing, partial: s.partial, final: s.finalTranscript, answerChars: s.answer?.length ?? 0, turnKind: s.turnKind, route: s.route, error: s.error }); last = sig; }
      onSnap?.(s);
      if (until(s)) return { snap: s, timeline };
    }
    await sleep(everyMs);
  }
  return { snap: null, timeline, timedOut: true };
}

if (import.meta.url === `file://${process.argv[1].replaceAll("\\", "/")}` || process.argv[1]?.endsWith("host-driver.mjs")) {
  const scenario = process.argv[2] ?? "typed-chat";
  const out = process.argv[3];
  const host = await startHost();
  const result = { scenario, port: host.port, startedAt: new Date().toISOString(), steps: [] };
  try {
    const open = await host.command("voice.session.open", { mode: "push_to_talk" });
    result.steps.push({ step: "open", status: open.status, state: open.body.data?.state, engines: open.body.data?.engines, devices: open.body.data?.devices, error: open.body.data?.error ?? open.body.error });
    if (scenario === "typed-chat") {
      const t = await host.command("voice.text", { text: process.argv[4] ?? "What is the capital of France?" });
      result.steps.push({ step: "text", status: t.status, error: t.body.error });
      const r = await pollVoice(host, (s) => s.answer && !s.playing && (s.state === "IDLE" || s.state === "ERROR"), { timeoutMs: 120000 });
      result.steps.push({ step: "answer", answer: r.snap?.answer, route: r.snap?.route, timing: r.snap?.timing, timeline: r.timeline, timedOut: r.timedOut ?? false });
    }
    if (scenario === "listen-silence" || scenario === "loopback") {
      const l = await host.command("voice.listen.start", { source: "button" });
      result.steps.push({ step: "listen.start", status: l.status, state: l.body.data?.state, error: l.body.data?.error ?? l.body.error });
      if (scenario === "loopback") {
        // Acoustic loopback: a SEPARATE process speaks a synthetic 'user' phrase through the default speakers so
        // the real microphone hears it. Labelled synthetic: this is not a human speaker.
        const phrase = process.argv[4] ?? "What is my agent doing right now?";
        await sleep(1200);
        spawn("powershell.exe", ["-NoProfile", "-Command", `Add-Type -AssemblyName System.Speech; $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.SelectVoice('Microsoft Zira Desktop'); $s.Rate=0; $s.Speak('${phrase.replaceAll("'", "''")}')`], { stdio: "ignore" });
        result.steps.push({ step: "loopback.play", phrase, at: Date.now() });
      }
      const r = await pollVoice(host, (s) => s.state === "IDLE" && !s.capturing && !s.playing && (s.finalTranscript || s.turnKind || s.timing?.completedAt || Date.now() - (s.timing?.activatedAt ?? Date.now()) > 12000), { timeoutMs: 90000 });
      result.steps.push({ step: "turn", final: r.snap?.finalTranscript, turnKind: r.snap?.turnKind, answer: r.snap?.answer, devices: r.snap?.devices, error: r.snap?.error, timing: r.snap?.timing, timeline: r.timeline, timedOut: r.timedOut ?? false });
    }
    const close = await host.command("voice.session.close");
    result.steps.push({ step: "close", status: close.status, open: close.body.data?.open });
  } finally {
    result.hostLogTail = host.log().slice(-3000);
    await host.stop();
  }
  if (out) writeFileSync(out, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2).slice(0, 12000));
}
