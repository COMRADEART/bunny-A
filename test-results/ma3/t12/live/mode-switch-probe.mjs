// M-A-3 T12: does voice.session.open {mode: hands_free} switch an open push-to-talk session that is listening? (disposable Host)
import { setTimeout as sleep } from "node:timers/promises";
import { startHost } from "./lib.mjs";
const host = await startHost({ label: "t12-mode" });
const show = (label, r) => console.log(label, r.status, JSON.stringify({ open: r.body?.data?.open, mode: r.body?.data?.mode, state: r.body?.data?.state, capturing: r.body?.data?.capturing, error: r.body?.error ?? r.body?.data?.error ?? null }));
try {
  show("open ptt", await host.command("voice.session.open", { mode: "push_to_talk" }));
  await sleep(1500);
  show("listen button", await host.command("voice.listen.start", { source: "button" }));
  await sleep(1000);
  show("open hands_free while listening", await host.command("voice.session.open", { mode: "hands_free" }));
  await sleep(1000);
  show("state", { status: 200, body: { data: await host.voice() } });
  show("listen hands_free", await host.command("voice.listen.start", { source: "hands_free" }));
  await sleep(2500);
  const v = await host.voice();
  console.log("final", JSON.stringify({ mode: v.mode, state: v.state, duplex: v.duplex }));
} finally { await host.stop(); }
