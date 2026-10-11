// M-A-3 T10 diagnostic: reproduce barge-in scenario B03 (push-to-talk press while Bunny speaks) and print the error.
import { setTimeout as sleep } from "node:timers/promises";
import { startHost, pollVoice } from "./host-driver.mjs";
const host = await startHost({ port: 43880 });
try {
  await host.command("voice.session.open", { mode: "push_to_talk" });
  await host.command("voice.text", { text: "Explain in five full sentences how a rainbow forms." });
  const s = (await pollVoice(host, (x) => x.playing, { timeoutMs: 120000, everyMs: 40 })).snap;
  await sleep(800);
  const l = await host.command("voice.listen.start", { source: "push_to_talk" });
  console.log("listen.start ->", l.status, l.body.data?.state, JSON.stringify(l.body.data?.error));
  const r = await pollVoice(host, (x) => x.state !== "ARMING", { timeoutMs: 8000, everyMs: 30 });
  console.log("timeline", JSON.stringify(r.timeline.map((t) => [t.state, t.capturing, t.playing, t.error?.code, t.error?.message])));
  await sleep(1500);
  await host.command("voice.listen.end", { turnId: l.body.data?.turnId });
  const e = await pollVoice(host, (x) => !x.capturing && x.state !== "TRANSCRIBING", { timeoutMs: 15000 });
  console.log("end", e.snap?.state, JSON.stringify(e.snap?.error), "interrupt", JSON.stringify(e.snap?.lastInterrupt));
} finally { await host.command("voice.session.close").catch(() => {}); await host.stop(); }
