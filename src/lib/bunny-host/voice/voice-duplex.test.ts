import test from "node:test";
import assert from "node:assert/strict";
import { VoiceSessionManager, type VoiceTaskEvent } from "./voice-session.server.ts";
import type { VoiceWorkerPort } from "./voice-worker.server.ts";
import { VOICE_LIMITS, VOICE_PROTOCOL, type WorkerCommand, type WorkerEvent } from "./voice-protocol.ts";
import { VoiceTurnTaking, echoMatch, echoOverlap, echoTokens, tokenize, type TurnEvidence } from "./voice-turn-taking.ts";

/** Synthetic protocol regression only: a fake worker and a virtual clock. These tests make no acoustic or hardware claims. */
class Worker implements VoiceWorkerPort {
  readonly id = "synthetic-duplex";
  stdinBytes = 0;
  sent: WorkerCommand[] = [];
  closed = false;
  /** When true the worker never acknowledges duplex.stop (release timeout path). */
  silentStop = false;
  /** When true the worker never confirms duplex.start (in-flight path). */
  refuseDuplex = false;
  private listeners: ((event: WorkerEvent) => void)[] = [];
  private resolveExit!: (code: number | null) => void;
  readonly exited = new Promise<number | null>((resolve) => (this.resolveExit = resolve));
  onEvent(listener: (event: WorkerEvent) => void) {
    this.listeners.push(listener);
  }
  send(command: WorkerCommand) {
    this.sent.push(command);
    this.stdinBytes += Buffer.byteLength(JSON.stringify(command), "utf8") + 1;
    if (command.op === "devices") queueMicrotask(() => this.emit({ ev: "devices", inputs: [], outputs: [], defaultInput: { name: "fake", muted: false, volume: null, present: true }, defaultOutput: { name: "fake", muted: false, volume: null, present: true }, micPrivacy: "allow" }));
    if (command.op === "duplex.start" && !this.refuseDuplex) queueMicrotask(() => this.emit({ ev: "duplex.started", session: command.session, aec: "fixture:no-aec", reference: "fixture", inputId: null, outputId: null, renderDevice: -1, fixture: true }));
    if (command.op === "capture.start") queueMicrotask(() => this.emit({ ev: "capture.started", turn: command.turn, gen: command.gen, device: { index: -2, name: "fixture" }, sampleRate: 16000, channels: 1 }));
    if (command.op === "duplex.stop" && !this.silentStop) queueMicrotask(() => this.emit({ ev: "duplex.stopped", session: command.session, reason: "stop" }));
  }
  emit(value: Record<string, unknown>) {
    for (const listener of [...this.listeners]) listener({ t: 1, mono: 1, ...value } as WorkerEvent);
  }
  async close() {
    this.closed = true;
    this.resolveExit(0);
  }
  exit(code: number | null = 1) {
    this.resolveExit(code);
  }
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
/** Long enough for the chunker to cut it (a chunk needs 40 speakable characters at a sentence end). */
const SENTENCE = "The moon circles Earth once every twenty seven days and always shows us the same face. ";
type Capture = Extract<WorkerCommand, { op: "capture.start" }>;

/** A virtual clock: `advance` fires every timer due within the window, in order. Real time is never used. */
async function harness(options: { softBudget?: number; hardBudget?: number; duplex?: boolean } = {}) {
  let clock = 10_000;
  const timers: { at: number; fn: () => void; done: boolean }[] = [];
  const schedule = (fn: () => void, ms: number) => {
    const timer = { at: clock + ms, fn, done: false };
    timers.push(timer);
    return () => {
      timer.done = true;
    };
  };
  const advance = (ms: number) => {
    const target = clock + ms;
    for (;;) {
      let next: (typeof timers)[number] | undefined;
      for (const timer of timers) if (!timer.done && timer.at <= target && (!next || timer.at < next.at)) next = timer;
      if (!next) break;
      next.done = true;
      clock = Math.max(clock, next.at);
      next.fn();
    }
    clock = target;
  };
  const workers: Worker[] = [];
  const outputs = new Map<string, (event: VoiceTaskEvent) => void>();
  const admissions: string[] = [], stops: string[] = [], controls: string[] = [], journal: string[] = [];
  /** T12: Missions drafted through the canonical port by a spoken request. */
  const drafted: { objective: string; projectId: string | null }[] = [];
  let count = 0;
  let stopGate: Promise<void> | null = null;
  let releaseStop: () => void = () => undefined;
  const session = new VoiceSessionManager({
    hostEpoch: "synthetic-epoch",
    dataDirectory: "unused",
    platform: "win32",
    now: () => clock,
    schedule,
    ...(options.softBudget ? { workerStdinSoftBudget: options.softBudget } : {}),
    ...(options.hardBudget ? { workerStdinHardBudget: options.hardBudget } : {}),
    launch: async () => {
      const worker = new Worker();
      workers.push(worker);
      setImmediate(() => worker.emit({ ev: "ready", protocol: VOICE_PROTOCOL, pid: 1, stt: { engine: "fixture", recognizer: null, culture: null, local: true }, tts: { engine: "fixture", voices: [], local: true }, duplex: { supported: options.duplex !== false, backend: "fixture" } }));
      return worker;
    },
    chat: {
      submit: () => ({ taskId: `voice-${++count}`, provider: "ollama", model: "fixture", state: "waiting_for_approval", hasMission: false, mayLaunch: true }),
      admit: (id: string) => {
        admissions.push(id);
      },
      onOutput: (id: string, listener: (event: VoiceTaskEvent) => void) => {
        outputs.set(id, listener);
        return () => {
          outputs.delete(id);
        };
      },
      stop: async (id: string) => {
        stops.push(id);
        outputs.delete(id);
        if (stopGate) await stopGate;
      },
    },
    agents: {
      rows: () => [{ id: "a1", name: "Builder", state: "RUNNING", revision: 3 }],
      facts: () => ({ agents: [], missions: [], approvals: [] }),
      draftMission: (input: { objective: string; projectId: string | null }) => {
        drafted.push(input);
        return { id: `draft-${drafted.length}`, title: input.objective.slice(0, 40), state: "waiting_for_approval" };
      },
      projects: () => [],
      command: async (action: string) => {
        controls.push(action);
      },
    },
    journal: (type, detail) => journal.push(`${type}: ${detail}`),
  });
  await session.open("hands_free");
  const worker = () => workers.at(-1)!;
  const input = (target = worker()): Capture => {
    const command = target.sent.filter((c) => c.op === "capture.start").at(-1);
    if (!command || command.op !== "capture.start") throw new Error("no input turn has been armed");
    return command;
  };
  const emitInput = (value: Record<string, unknown>, target = input()) => worker().emit({ turn: target.turn, gen: target.gen, ...value });
  return {
    session,
    workers,
    worker,
    input,
    emitInput,
    advance,
    admissions,
    stops,
    drafted,
    controls,
    journal,
    outputs,
    begin: async () => {
      await session.listenStart("hands_free");
      await tick();
    },
    /** One user utterance: speech onset, then the recognizer's final for it. */
    final: async (text = "Explain the moon", confidence = 0.9) => {
      emitInput({ ev: "vad", state: "speech_start" });
      emitInput({ ev: "stt.final", text, confidence });
      await tick();
    },
    /** Bunny starts speaking the answer to the last admitted Task. */
    speaking: (text = SENTENCE) => {
      outputs.get(admissions.at(-1)!)?.({ text });
      const snap = session.snapshot();
      worker().emit({ ev: "playback.started", turn: snap.turnId, gen: snap.generation, seq: 0 });
    },
    done: (state = "completed") => {
      outputs.get(admissions.at(-1)!)?.({ done: true, state });
    },
    blockProviderStop: () => {
      stopGate = new Promise<void>((resolve) => (releaseStop = resolve));
    },
    releaseProviderStop: () => releaseStop(),
  };
}

const duplexStarts = (w: Worker) => w.sent.filter((c): c is Extract<WorkerCommand, { op: "duplex.start" }> => c.op === "duplex.start");
const pauses = (w: Worker) => w.sent.filter((c): c is Extract<WorkerCommand, { op: "speak.pause" }> => c.op === "speak.pause");

// -----------------------------------------------------------------------------------------------------------------
// Lifecycle and the explicit grant (P2, P4, P5, items 5-7)
// -----------------------------------------------------------------------------------------------------------------

test("T12 grant: opening hands-free alone has no microphone and no grant; the explicit start opens it with the grant as the lifetime bound", async () => {
  const h = await harness();
  assert.equal(h.session.snapshot().capturing, false);
  // T12-PRIV-01: only a Start hands-free creates the grant. A mode open or switch never does, so no duplex.start follows it.
  assert.equal(h.session.snapshot().duplex?.grantExpiresAt, null, "open(hands_free) records no grant");
  assert.equal(duplexStarts(h.worker()).length, 0, "open(hands_free) sends no duplex.start");
  await h.begin();
  assert.equal(h.session.snapshot().capturing, true);
  assert.equal(duplexStarts(h.worker())[0].maxMs, VOICE_LIMITS.duplexGrantMs);
  assert.equal(h.session.snapshot().turnId, null);
  await h.session.close();
});

test("T12 grant: starting is visible while duplex.start is in flight, and nothing is captured until it is confirmed", async () => {
  const h = await harness();
  h.worker().refuseDuplex = true;
  await h.session.listenStart("hands_free");
  await tick();
  assert.equal(h.session.snapshot().duplex?.starting, true);
  assert.equal(h.session.snapshot().capturing, false);
  const start = duplexStarts(h.worker())[0];
  h.worker().emit({ ev: "duplex.started", session: start.session, aec: "fixture:no-aec", reference: "fixture", fixture: true });
  const snap = h.session.snapshot();
  assert.equal(snap.duplex?.starting, false);
  assert.equal(snap.duplex?.active, true);
  assert.equal(snap.capturing, true);
  await h.session.close();
});

test("T12 grant: a lifetime stop revokes the grant, so a typed answer and the next idle re-arm never reopen the microphone", async () => {
  const h = await harness();
  await h.begin();
  const start = duplexStarts(h.worker())[0];
  h.worker().emit({ ev: "duplex.stopped", session: start.session, reason: "lifetime" });
  await tick();
  assert.equal(h.session.snapshot().duplex?.active, false);
  assert.equal(h.session.snapshot().duplex?.stopped?.reason, "lifetime");
  assert.equal(h.session.snapshot().duplex?.grantExpiresAt, null);
  await h.session.text("What is the moon?");
  h.done();
  await tick();
  h.advance(1_000);
  await tick();
  assert.equal(duplexStarts(h.worker()).length, 1, "no duplex.start without a live grant");
  await h.session.listenStart("hands_free");
  await tick();
  assert.equal(duplexStarts(h.worker()).length, 2, "a user start after that works");
  await h.session.close();
});

test("T12 grant: a button press without a live grant is an ordinary turn, never a duplex start", async () => {
  const h = await harness();
  await h.begin();
  h.worker().emit({ ev: "duplex.error", session: duplexStarts(h.worker())[0].session, code: "DEVICE_LOST", message: "device gone" });
  await tick();
  assert.equal(h.session.snapshot().duplex?.grantExpiresAt, null);
  await h.session.listenStart("button");
  await tick();
  assert.equal(duplexStarts(h.worker()).length, 1);
  assert.equal(h.input().duplex, undefined, "the turn is half-duplex, not on the duplex lane");
  await h.session.close();
});

test("T12 idle release (item 6): no speech and no output for duplexIdleMs stops duplex, revokes the grant and journals it without transcripts", async () => {
  const h = await harness();
  await h.begin();
  h.advance(VOICE_LIMITS.duplexIdleMs - 1);
  assert.equal(h.session.snapshot().duplex?.active, true);
  h.advance(2);
  await tick();
  assert.equal(h.session.snapshot().duplex?.active, false);
  assert.equal(h.session.snapshot().duplex?.stopped?.reason, "idle");
  assert.equal(h.session.snapshot().duplex?.grantExpiresAt, null);
  assert.ok(h.journal.some((line) => line.startsWith("voice.duplex") && line.includes("idle")));
  assert.ok(!h.journal.some((line) => line.includes("moon")), "the journal carries no transcripts");
  await h.session.listenStart("button");
  await tick();
  assert.equal(duplexStarts(h.worker()).length, 1);
  await h.session.close();
});

test("T12 idle release: speech re-arms the idle timer, so the microphone stays open while the user talks", async () => {
  const h = await harness();
  await h.begin();
  h.advance(VOICE_LIMITS.duplexIdleMs - 1_000);
  h.emitInput({ ev: "vad", state: "speech_start" });
  h.emitInput({ ev: "vad", state: "speech_end", speechMs: 900, short: false });
  h.advance(VOICE_LIMITS.duplexIdleMs - 1_000);
  assert.equal(h.session.snapshot().duplex?.active, true, "the timer was re-armed by the speech onset");
  h.advance(2_000);
  await tick();
  assert.equal(h.session.snapshot().duplex?.stopped?.reason, "idle");
  await h.session.close();
});

test("T12 lifecycle (item 7): a worker exit clears all duplex state, the grant and the held reply", async () => {
  const h = await harness();
  await h.begin();
  await h.final();
  h.speaking();
  h.emitInput({ ev: "vad", state: "speech_start" });
  assert.equal(h.session.snapshot().outputHeld, true);
  h.worker().exit(1);
  await tick();
  await tick();
  const snap = h.session.snapshot();
  assert.equal(snap.capturing, false);
  assert.equal(snap.duplex?.active, false);
  assert.equal(snap.duplex?.starting, false);
  assert.equal(snap.duplex?.releasing, false);
  assert.equal(snap.duplex?.grantExpiresAt, null);
  assert.equal(snap.duplex?.stopped?.reason, "worker_exit");
  assert.equal(snap.inputTurnId, null);
  assert.equal(snap.outputHeld, false);
  assert.equal(snap.error?.code, "WORKER_EXITED");
});

test("T12 lifecycle: a push-to-talk press stops duplex with reason user and keeps the grant; the press awaits the release cleanly", async () => {
  const h = await harness();
  await h.begin();
  await h.session.listenStart("push_to_talk");
  await tick();
  const snap = h.session.snapshot();
  assert.equal(snap.duplex?.stopped?.reason, "user");
  assert.ok(snap.duplex?.grantExpiresAt, "a user stop keeps the grant");
  assert.equal(snap.duplex?.releasing, false);
  assert.ok(h.worker().sent.some((c) => c.op === "duplex.stop"));
  assert.equal(h.input().duplex, undefined);
  await h.session.close();
});

test("T12 lifecycle: switching to push_to_talk stops duplex with reason mode and revokes the grant", async () => {
  const h = await harness();
  await h.begin();
  await h.session.open("push_to_talk");
  await tick();
  assert.equal(h.session.snapshot().duplex?.stopped?.reason, "mode");
  assert.equal(h.session.snapshot().duplex?.grantExpiresAt, null);
  assert.equal(h.session.snapshot().capturing, false);
  await h.session.close();
});

test("T12 lifecycle: a close during a pending release keeps the first reason, and the release timer never overwrites a normal close", async () => {
  const h = await harness();
  await h.begin();
  h.worker().silentStop = true;
  h.session.mute(true);
  assert.equal(h.session.snapshot().duplex?.releasing, true);
  await h.session.close();
  h.advance(2_000);
  await tick();
  const snap = h.session.snapshot();
  assert.equal(snap.open, false);
  assert.equal(snap.error, null, "the release timer did not write an error into the closed session");
  assert.equal(snap.duplex?.stopped?.reason, "mute");
  assert.equal(h.worker().closed, true);
});

test("T12 security (AUD-09): missing release acknowledgment settles only the owned worker and keeps capture truth until then", async () => {
  const h = await harness();
  await h.begin();
  h.worker().silentStop = true;
  h.session.mute(true);
  assert.equal(h.session.snapshot().capturing, true, "physical capture release is not yet confirmed");
  assert.equal(h.session.snapshot().duplex?.releasing, true);
  h.advance(1_501);
  await tick();
  assert.equal(h.worker().closed, true);
  assert.equal(h.session.snapshot().capturing, false);
  assert.equal(h.session.snapshot().open, false);
  assert.equal(h.controls.length, 0);
});

test("T12 security: a late provider stop cannot delay owned microphone worker cleanup", async () => {
  const h = await harness();
  await h.begin();
  await h.final();
  h.speaking();
  h.blockProviderStop();
  const closing = h.session.close();
  await tick();
  assert.equal(h.worker().closed, true, "owned resource cleanup starts independently of provider stop");
  await closing;
  assert.equal(h.session.snapshot().capturing, false);
});

test("T12 AUD-08: an inference stop that misses its deadline is recorded requested, and its later answer updates the receipt while it is current", async () => {
  const h = await harness();
  await h.begin();
  await h.final();
  h.speaking();
  h.blockProviderStop();
  await h.session.close();
  const receipt = h.session.snapshot().lastInterrupt;
  assert.equal(receipt?.inferenceCancellation, "requested");
  assert.equal(receipt?.inferenceStopped, null);
  h.releaseProviderStop();
  await tick();
  await tick();
  assert.equal(h.session.snapshot().lastInterrupt?.inferenceCancellation, "acknowledged");
  assert.ok(h.journal.some((line) => line.includes("Inference stop acknowledged")));
});

test("T12 AUD-11/12: an inference timeout barges in with source timeout", async () => {
  const h = await harness();
  await h.begin();
  await h.final("Tell me a story");
  h.advance(VOICE_LIMITS.inferenceTimeoutMs);
  await tick();
  assert.equal(h.session.snapshot().lastInterrupt?.source, "timeout");
  await h.session.close();
});

test("T12 AUD-14/item 8: a soft-budget relaunch during hands-free happens at a safe point, keeps the grant, and restarts duplex within it", async () => {
  const h = await harness({ softBudget: 400 });
  await h.begin();
  await h.final("Hi there");
  h.done();
  await tick();
  for (let i = 0; i < 4; i += 1) await tick();
  assert.equal(h.workers.length, 2, "one relaunch at the safe point");
  assert.equal(h.workers[0].closed, true);
  const restarted = duplexStarts(h.workers[1]);
  assert.equal(restarted.length, 1, "the duplex restarts on the new worker");
  assert.ok(restarted[0].maxMs <= VOICE_LIMITS.duplexGrantMs && restarted[0].maxMs > 0);
  assert.ok(h.session.snapshot().duplex?.grantExpiresAt, "the grant is kept across the relaunch");
  assert.ok(h.journal.some((line) => line.includes("relaunch")));
  await h.session.close();
});

test("T12 item 7: the input budget ending the session clears the duplex lane, its grant and any held reply", async () => {
  const h = await harness({ hardBudget: 200 });
  await h.begin();
  const snap = h.session.snapshot();
  assert.equal(snap.open, false, "the turn that would cross the hard budget ends the session");
  assert.equal(snap.duplex?.active, false);
  assert.equal(snap.duplex?.grantExpiresAt, null);
  assert.equal(snap.duplex?.stopped?.reason, "budget");
  assert.equal(snap.capturing, false);
  assert.equal(snap.error?.code, "INTERNAL");
});

test("T12 AUD-06: no relaunch while the user is mid-speech", async () => {
  const h = await harness({ softBudget: 200 });
  await h.begin();
  const first = h.input();
  h.emitInput({ ev: "vad", state: "speech_start" }, first);
  h.emitInput({ ev: "capture.stopped", reason: "max", bufferedPeakBytes: 0 }, first);
  await tick();
  await tick();
  assert.equal(h.workers.length, 1, "the turn that was in speech is still finalizing, so no relaunch");
  await h.session.close();
});

// -----------------------------------------------------------------------------------------------------------------
// Input lane, identity and recognition (items 9-11)
// -----------------------------------------------------------------------------------------------------------------

test("T12 VT-08: the next input turn is armed at the previous capture's stop, and the finalizing turn's final is accepted exactly once", async () => {
  const h = await harness();
  await h.begin();
  const first = h.input();
  h.emitInput({ ev: "vad", state: "speech_start" }, first);
  h.emitInput({ ev: "capture.stopped", reason: "vad", bufferedPeakBytes: 0 }, first);
  await tick();
  const armed = h.worker().sent.filter((c) => c.op === "capture.start");
  assert.equal(armed.length, 2, "the next turn is armed at capture.stopped, before the final");
  assert.notEqual(h.input().turn, first.turn);
  h.emitInput({ ev: "stt.final", text: "Explain the moon", confidence: 0.9 }, first);
  await tick();
  assert.equal(h.admissions.length, 1, "the finalizing turn's final is accepted");
  h.emitInput({ ev: "stt.final", text: "Explain the moon", confidence: 0.9 }, first);
  await tick();
  assert.equal(h.admissions.length, 1, "and accepted exactly once");
  assert.equal(h.worker().sent.filter((c) => c.op === "capture.start").length, 2, "no extra arming from the late final");
  await h.session.close();
});

test("T12 item 9: a recognition deadline drops only that input turn, resumes any held reply, and keeps the session open", async () => {
  const h = await harness();
  await h.begin();
  const first = h.input();
  h.emitInput({ ev: "capture.stopped", reason: "vad", bufferedPeakBytes: 0 }, first);
  await tick();
  h.advance(VOICE_LIMITS.transcribeWaitMs);
  const abort = h.worker().sent.find((c): c is Extract<WorkerCommand, { op: "capture.abort" }> => c.op === "capture.abort" && c.turn === first.turn);
  assert.ok(abort, "capture.abort names the input turn");
  assert.equal(abort.gen, first.gen);
  assert.equal(h.session.snapshot().open, true, "the session stays open");
  assert.equal(h.session.snapshot().duplex?.active, true, "the duplex lane stays live");
  h.emitInput({ ev: "capture.stopped", reason: "abort", bufferedPeakBytes: 0 }, first);
  await tick();
  h.advance(VOICE_LIMITS.transcribeWaitMs);
  assert.equal(h.worker().closed, false, "an acknowledged abort does not close the session");
  await h.session.close();
});

test("T12 item 9: without acknowledgment within 2 s more, the worker is closed as before", async () => {
  const h = await harness();
  await h.begin();
  const first = h.input();
  h.emitInput({ ev: "capture.stopped", reason: "vad", bufferedPeakBytes: 0 }, first);
  await tick();
  h.advance(VOICE_LIMITS.transcribeWaitMs);
  h.advance(2_001);
  await tick();
  await tick();
  assert.equal(h.worker().closed, true);
  assert.equal(h.session.snapshot().open, false);
  assert.equal(h.session.snapshot().error?.code, "STT_UNAVAILABLE");
});

test("T12 item 9: a held reply is released once recognition gives up on its turn, and it is resumed, not cancelled", async () => {
  const h = await harness();
  await h.begin();
  await h.final();
  h.speaking();
  const first = h.input();
  h.emitInput({ ev: "vad", state: "speech_start" }, first);
  assert.equal(h.session.snapshot().outputHeld, true);
  h.emitInput({ ev: "capture.stopped", reason: "vad", bufferedPeakBytes: 0 }, first);
  await tick();
  h.advance(VOICE_LIMITS.transcribeWaitMs);
  await tick();
  assert.equal(h.session.snapshot().outputHeld, false);
  assert.ok(pauses(h.worker()).some((c) => !c.on), "the held reply was resumed, not cancelled");
  assert.equal(h.stops.length, 0, "no Task was cancelled");
  assert.equal(h.session.snapshot().duplex?.active, true, "the lane keeps listening");
  await h.session.close();
});

test("T12 item 10: interrupt while idle-listening keeps capture truth, aborts only the input turn (with its turn and gen) and re-arms", async () => {
  const h = await harness();
  await h.begin();
  const before = h.input();
  h.session.interrupt("button");
  await tick();
  const snap = h.session.snapshot();
  assert.equal(snap.capturing, true, "capture truth is not cleared");
  assert.equal(snap.duplex?.active, true);
  const aborts = h.worker().sent.filter((c) => c.op === "capture.abort");
  assert.ok(aborts.length >= 1);
  assert.ok(aborts.every((c) => c.turn !== undefined), "every capture.abort on the duplex lane names its turn");
  assert.ok(aborts.some((c) => c.turn === before.turn && c.gen === before.gen));
  assert.notEqual(h.input().turn, before.turn, "a fresh input turn is armed");
  await h.session.close();
});

test("T12 item 15: typed text during hands-free does not stop duplex; it barges in on output and proceeds", async () => {
  const h = await harness();
  await h.begin();
  await h.session.text("What is the moon?");
  await tick();
  assert.equal(h.worker().sent.some((c) => c.op === "duplex.stop"), false, "no duplex stop");
  assert.equal(h.session.snapshot().duplex?.active, true);
  assert.equal(h.session.snapshot().capturing, true);
  assert.ok(h.worker().sent.every((c) => c.op !== "capture.abort" || c.turn !== undefined), "no generation-only abort of the lane");
  assert.equal(h.admissions.length, 1, "the typed turn proceeds");
  await h.session.close();
});

test("T12 manual end is bound to the input lane while speech keeps its own identity", async () => {
  const h = await harness();
  await h.begin();
  await h.final();
  h.speaking();
  const input = h.input();
  h.session.listenEnd(input.turn);
  assert.ok(h.worker().sent.some((c) => c.op === "capture.end" && c.turn === input.turn && c.gen === input.gen));
  assert.equal(h.session.snapshot().playing, true);
  await h.session.close();
});

test("T12 forged or revised finals never create a second Task", async () => {
  const h = await harness();
  await h.begin();
  const old = h.input();
  await h.final();
  h.emitInput({ ev: "stt.final", text: "different request", confidence: 1 }, old);
  h.emitInput({ ev: "stt.final", text: "forged future", confidence: 1, gen: h.input().gen + 1 });
  await tick();
  assert.equal(h.admissions.length, 1);
  assert.ok(h.session.staleEventsDropped >= 2);
  await h.session.close();
});

// -----------------------------------------------------------------------------------------------------------------
// Echo gate, held output and the decision (items 1-4)
// -----------------------------------------------------------------------------------------------------------------

test("T12 echo (item 1): a partial and a final of the exact sentence being spoken never interrupt or create a Task", async () => {
  const h = await harness();
  await h.begin();
  await h.final("Explain the moon");
  h.speaking();
  const before = h.session.snapshot();
  const admitted = h.admissions.length;
  h.emitInput({ ev: "vad", state: "speech_start" });
  h.emitInput({ ev: "stt.partial", text: "the moon circles earth" });
  assert.equal(h.session.snapshot().generation, before.generation, "the partial did not interrupt");
  h.emitInput({ ev: "stt.final", text: "The moon circles Earth once every twenty seven days", confidence: 0.95 });
  await tick();
  const snap = h.session.snapshot();
  assert.equal(snap.generation, before.generation);
  assert.equal(h.admissions.length, admitted, "no Task");
  assert.equal(h.stops.length, 0);
  assert.equal(snap.turnDecision?.action, "drop");
  assert.equal(snap.turnDecision?.reason, "echo_of_own_speech");
  assert.equal(snap.lastBargeIn?.echoRejected, 1);
  assert.ok(pauses(h.worker()).some((c) => !c.on && c.gen === before.generation), "held output resumes");
  assert.equal(snap.outputHeld, false);
  await h.session.close();
});

test("T12 echo: a transcript that is not Bunny's speech is not treated as echo", async () => {
  const h = await harness();
  await h.begin();
  await h.final("Explain the moon");
  h.speaking();
  h.emitInput({ ev: "vad", state: "speech_start" });
  // AEC-03: a final during output interrupts only with audible speech behind it; 600 ms of the user's voice is heard here.
  h.emitInput({ ev: "level", rms: 0.05, peak: 0.1, speech: true, speechMs: 600 });
  h.emitInput({ ev: "stt.final", text: "Wait, what about Mars and the rovers", confidence: 0.9 });
  await tick();
  assert.equal(h.session.snapshot().turnDecision?.action, "interrupt");
  assert.equal(h.admissions.length, 2);
  await h.session.close();
});

test("T12 confirm (item 2): a confirm spoken over Bunny's own output never executes the proposal, and the proposal stays", async () => {
  const h = await harness();
  await h.begin();
  await h.final("pause the agent");
  const proposal = h.session.snapshot().proposal;
  assert.equal(proposal?.action, "agent.pause");
  const turn = h.session.snapshot().turnId!;
  const gen = h.session.snapshot().generation;
  h.worker().emit({ ev: "playback.started", turn, gen, seq: 0 });
  h.worker().emit({ ev: "playback.idle", turn, gen });
  // The proposal sentence Bunny just spoke ("say confirm") is echo for 12 s; the user's own confirm comes after that window.
  h.advance(VOICE_LIMITS.echoWindowMs + 1);
  await h.final("explain the moon");
  h.speaking();
  h.emitInput({ ev: "vad", state: "speech_start" });
  // AEC-03: a lone "confirm" over output is unconfirmed speech and resumes the reply; "confirm it" with 600 ms of voice interrupts and
  // is routed, and the overlapped turn is refused as a confirmation.
  h.emitInput({ ev: "level", rms: 0.05, peak: 0.1, speech: true, speechMs: 600 });
  h.emitInput({ ev: "stt.final", text: "confirm it", confidence: 0.9 });
  await tick();
  const snap = h.session.snapshot();
  assert.deepEqual(h.controls, [], "no canonical command ran");
  assert.equal(snap.proposal?.id, proposal?.id, "the proposal is kept");
  assert.match(snap.answer ?? "", /To confirm, say confirm again after I finish/);
  await h.session.close();
});

test("T12 confirm: once Bunny has finished speaking, a confirm executes the proposal through the canonical command", async () => {
  const h = await harness();
  await h.begin();
  await h.final("pause the agent");
  const turn = h.session.snapshot().turnId!;
  const gen = h.session.snapshot().generation;
  h.worker().emit({ ev: "playback.started", turn, gen, seq: 0 });
  h.worker().emit({ ev: "playback.idle", turn, gen });
  h.advance(VOICE_LIMITS.echoWindowMs + 1);
  // The turn armed while the proposal was being spoken is "overlapped" by contract (it was armed during output). A turn
  // that ends without speech is closed; the next turn is armed after Bunny has finished, so it is not overlapped.
  h.emitInput({ ev: "stt.none", reason: "no_speech" });
  await h.final("confirm");
  await tick();
  assert.deepEqual(h.controls, ["agent.pause"]);
  await h.session.close();
});

test("T12 hold (item 3): a 200 ms burst during output resumes the reply on the burst's end and is never routed", async () => {
  const h = await harness();
  await h.begin();
  await h.final();
  h.speaking();
  const gen = h.session.snapshot().generation;
  const admitted = h.admissions.length;
  h.emitInput({ ev: "vad", state: "speech_start", onsetMono: 50, mono: 60 });
  assert.ok(pauses(h.worker()).some((c) => c.on && c.gen === gen), "onset pauses the reply");
  assert.equal(h.session.snapshot().outputHeld, true);
  assert.equal(h.session.snapshot().playing, false, "a held reply is not playing");
  h.emitInput({ ev: "level", rms: 0.02, peak: 0.04, speech: true, speechMs: 200 });
  h.emitInput({ ev: "vad", state: "speech_end", speechMs: 200, short: true });
  await tick();
  assert.ok(pauses(h.worker()).some((c) => !c.on && c.gen === gen), "resumed on the burst's end");
  const snap = h.session.snapshot();
  assert.equal(snap.outputHeld, false);
  assert.equal(snap.generation, gen, "no barge-in");
  assert.equal(h.stops.length, 0);
  assert.equal(h.admissions.length, admitted);
  assert.equal(snap.lastBargeIn?.outcome, "resumed");
  await h.session.close();
});

test("T12 live trial 4: real speech whose recognition is late keeps the reply held past heldResumeMs; the late question interrupts", async () => {
  const h = await harness();
  await h.begin();
  await h.final();
  h.speaking();
  const gen = h.session.snapshot().generation;
  const admitted = h.admissions.length;
  h.emitInput({ ev: "vad", state: "speech_start", onsetMono: 50, mono: 60 });
  h.emitInput({ ev: "level", rms: 0.02, peak: 0.04, speech: true, speechMs: 900 });
  h.emitInput({ ev: "vad", state: "speech_end", speechMs: 900 });
  h.advance(VOICE_LIMITS.heldResumeMs + 1500);
  assert.equal(h.session.snapshot().outputHeld, true, "the reply waits for the user's words, not for the resume timer");
  assert.ok(!pauses(h.worker()).some((c) => !c.on && c.gen === gen), "no pause-off was sent before recognition reported");
  h.emitInput({ ev: "stt.final", text: "What is two plus two?", confidence: 0.85 });
  await tick();
  assert.equal(h.session.snapshot().lastBargeIn?.outcome, "interrupted");
  assert.ok(!pauses(h.worker()).some((c) => !c.on && c.gen === gen), "the old answer never resumes");
  assert.equal(h.admissions.length, admitted + 1, "the late question is routed exactly once");
  await h.session.close();
});

test("T12 live trial 4: the late-recognition hold is still bounded by heldMaxMs (cancel, never a stale resume)", async () => {
  const h = await harness();
  await h.begin();
  await h.final();
  h.speaking();
  const gen = h.session.snapshot().generation;
  h.emitInput({ ev: "vad", state: "speech_start", onsetMono: 50, mono: 60 });
  h.emitInput({ ev: "level", rms: 0.02, peak: 0.04, speech: true, speechMs: 900 });
  h.emitInput({ ev: "vad", state: "speech_end", speechMs: 900 });
  h.advance(VOICE_LIMITS.heldMaxMs + 10);
  assert.equal(h.session.snapshot().outputHeld, false);
  assert.equal(h.session.snapshot().lastBargeIn?.outcome, "interrupted");
  assert.ok(!pauses(h.worker()).some((c) => !c.on && c.gen === gen), "never resumed stale");
  await h.session.close();
});

test("T12 hold: without an end marker, a held reply resumes at heldResumeMs after the last activity and not before", async () => {
  const h = await harness();
  await h.begin();
  await h.final();
  h.speaking();
  const gen = h.session.snapshot().generation;
  h.emitInput({ ev: "vad", state: "speech_start" });
  h.advance(VOICE_LIMITS.heldResumeMs - 100);
  assert.equal(h.session.snapshot().outputHeld, true);
  h.advance(200);
  assert.equal(h.session.snapshot().outputHeld, false);
  assert.ok(pauses(h.worker()).some((c) => !c.on && c.gen === gen));
  assert.equal(h.session.snapshot().generation, gen);
  await h.session.close();
});

test("T12 backchannel (item 4): 'uh-huh', 'Yep.' and 'mm-hmm' during output resume the reply and never route", async () => {
  const h = await harness();
  await h.begin();
  await h.final();
  h.speaking();
  const gen = h.session.snapshot().generation;
  const admitted = h.admissions.length;
  for (const text of ["uh-huh", "Yep.", "mm-hmm"]) {
    h.emitInput({ ev: "vad", state: "speech_start" });
    h.emitInput({ ev: "stt.final", text, confidence: 0.8 });
    await tick();
    assert.equal(h.session.snapshot().turnDecision?.action, "resume", text);
  }
  assert.equal(h.admissions.length, admitted, "no duplicate user turn");
  assert.equal(h.session.snapshot().generation, gen);
  assert.equal(h.stops.length, 0);
  await h.session.close();
});

test("T12 hesitation (item 4): 'um' with no output creates no Task and keeps listening", async () => {
  const h = await harness();
  await h.begin();
  await h.final("um");
  assert.equal(h.session.snapshot().turnDecision?.action, "drop");
  assert.equal(h.session.snapshot().turnDecision?.reason, "hesitation_only");
  assert.equal(h.admissions.length, 0);
  assert.equal(h.session.snapshot().duplex?.active, true);
  await h.session.close();
});

test("T12 acknowledgment: a wordless 'mm-hmm' with no output is dropped, while 'yes' is still a user turn", async () => {
  const h = await harness();
  await h.begin();
  for (const text of ["Mm-hmm.", "uh-huh", "hmm"]) {
    await h.final(text);
    assert.equal(h.session.snapshot().turnDecision?.action, "drop", text);
    assert.equal(h.session.snapshot().turnDecision?.reason, "acknowledgment_only", text);
  }
  assert.equal(h.admissions.length, 0, "no model turn for a wordless acknowledgment");
  await h.final("yes");
  assert.equal(h.session.snapshot().turnDecision?.action, "accept", "a spoken yes can still answer a pending confirmation");
  await h.session.close();
});

test("T12 interrupt (item 4): 'wait, did the tests pass' during output interrupts and is routed once", async () => {
  const h = await harness();
  await h.begin();
  await h.final();
  h.speaking();
  const oldGen = h.session.snapshot().generation;
  const waitTurn = h.input();
  h.emitInput({ ev: "vad", state: "speech_start" }, waitTurn);
  h.emitInput({ ev: "level", rms: 0.02, peak: 0.04, speech: true, speechMs: 240 }, waitTurn);
  h.emitInput({ ev: "stt.final", text: "Wait, did the tests pass?", confidence: 0.9 }, waitTurn);
  await tick();
  assert.deepEqual(h.stops, ["voice-1"], "only the old answer was stopped");
  assert.ok(h.worker().sent.some((c) => c.op === "speak.cancel" && c.gen === oldGen));
  assert.equal(h.session.snapshot().turnKind, "agent_verification", "the question is routed to Host facts");
  assert.equal(h.session.snapshot().lastBargeIn?.outcome, "interrupted");
  h.emitInput({ ev: "stt.final", text: "Wait, did the tests pass?", confidence: 0.9 }, waitTurn);
  await tick();
  assert.equal(h.journal.filter((line) => line.includes("classified as agent_verification")).length, 1, "routed once");
  assert.equal(h.controls.length, 0);
  await h.session.close();
});

test("T12 level alone never interrupts: sustained audible speech without transcript keeps the reply held, then resumes", async () => {
  const h = await harness();
  await h.begin();
  await h.final();
  h.speaking();
  const gen = h.session.snapshot().generation;
  h.emitInput({ ev: "vad", state: "speech_start" });
  h.emitInput({ ev: "level", rms: 0.05, peak: 0.1, speech: true, speechMs: 5_000 });
  await tick();
  assert.equal(h.session.snapshot().generation, gen, "no barge-in from energy");
  assert.equal(h.stops.length, 0);
  assert.equal(h.session.snapshot().lastInterrupt, null);
  await h.session.close();
});

test("T12 held (item 3): a reply held past heldMaxMs is cancelled, and it is never resumed stale", async () => {
  const h = await harness();
  await h.begin();
  await h.final();
  h.speaking();
  const gen = h.session.snapshot().generation;
  h.emitInput({ ev: "vad", state: "speech_start" });
  for (let elapsed = 0; elapsed < VOICE_LIMITS.heldMaxMs + 1_000; elapsed += 500) {
    h.advance(500);
    h.emitInput({ ev: "level", rms: 0.02, peak: 0.04, speech: true, speechMs: elapsed });
  }
  await tick();
  const snap = h.session.snapshot();
  assert.equal(snap.lastBargeIn?.outcome, "interrupted");
  assert.equal(snap.lastBargeIn?.reason, "held_too_long");
  assert.ok(h.worker().sent.some((c) => c.op === "speak.cancel" && c.gen === gen));
  assert.ok(!pauses(h.worker()).some((c) => !c.on && c.gen === gen), "never resumed");
  assert.equal(snap.outputHeld, false);
  await h.session.close();
});

test("T12 receipts (item 3): detection-to-silence and onset-to-silence come from the worker's monotonic receipts", async () => {
  const h = await harness();
  await h.begin();
  await h.final();
  h.speaking();
  const gen = h.session.snapshot().generation;
  const turn = h.session.snapshot().turnId!;
  h.emitInput({ ev: "vad", state: "speech_start", onsetMono: 1000, mono: 1100 });
  h.worker().emit({ ev: "playback.paused", turn, gen, on: true, requestMono: 1120, silentMono: 1300, meterSilentMs: 180, wasAudible: true });
  const receipt = h.session.snapshot().lastBargeIn;
  assert.equal(receipt?.onsetMono, 1000);
  assert.equal(receipt?.detectMono, 1100);
  assert.equal(receipt?.pauseRequestMono, 1120);
  assert.equal(receipt?.silentMono, 1300);
  assert.equal(receipt?.wasAudible, true);
  assert.equal(receipt?.detectionToSilenceMs, 200);
  assert.equal(receipt?.onsetToSilenceMs, 300);
  await h.session.close();
});

test("T12 playback (item 3): a playback.paused receipt never desyncs snap.playing; only a resume receipt makes it playing again", async () => {
  const h = await harness();
  await h.begin();
  await h.final();
  h.speaking();
  const gen = h.session.snapshot().generation;
  const turn = h.session.snapshot().turnId!;
  h.emitInput({ ev: "vad", state: "speech_start" });
  assert.equal(h.session.snapshot().playing, false);
  h.emitInput({ ev: "vad", state: "speech_end", speechMs: 100, short: true });
  assert.equal(h.session.snapshot().playing, false, "a resume is not a playing fact until the worker's receipt");
  h.worker().emit({ ev: "playback.paused", turn, gen, on: false });
  assert.equal(h.session.snapshot().playing, true, "resume receipt, with chunks outstanding");
  await h.session.close();
});

test("T12 barge-in (item 14): a second rapid barge-in keeps the latest receipt and journals the first one's acknowledgment", async () => {
  const h = await harness();
  await h.begin();
  await h.final("Tell me a story");
  h.speaking();
  h.session.interrupt("button");
  await h.final("Tell me another story");
  h.session.interrupt("hotkey");
  assert.equal(h.session.snapshot().lastInterrupt?.source, "hotkey");
  assert.ok(h.journal.some((line) => line.includes("Inference stop acknowledged")), "the first receipt's stop acknowledgment is still journaled");
  await h.session.close();
});

test("T12 security: AEC or reference failure is truthful and never switches to raw simultaneous capture", async () => {
  const h = await harness();
  await h.begin();
  const start = duplexStarts(h.worker())[0];
  h.worker().emit({ ev: "duplex.error", session: start.session, code: "AEC_UNAVAILABLE", message: "reference lost" });
  await tick();
  assert.equal(h.session.snapshot().capturing, false);
  assert.equal(h.session.snapshot().duplex?.active, false);
  assert.equal(h.session.snapshot().error?.code, "AEC_UNAVAILABLE");
  assert.equal(h.session.snapshot().duplex?.grantExpiresAt, null);
  assert.ok(h.worker().sent.filter((c) => c.op === "capture.start").every((c) => c.op === "capture.start" && c.duplex === true), "only duplex-lane captures were armed");
  await h.session.close();
});

test("T12 restart fences old continuous-session callbacks", async () => {
  const h = await harness();
  await h.begin();
  const old = duplexStarts(h.worker())[0];
  await h.session.open("push_to_talk");
  await h.session.open("hands_free");
  await h.begin();
  h.worker().emit({ ev: "duplex.stopped", session: old.session, reason: "late" });
  assert.equal(h.session.snapshot().capturing, true);
  await h.session.close();
});

test("T12 mute and close release duplex; old events cannot restart capture or change Agents", async () => {
  const h = await harness();
  await h.begin();
  const input = h.input();
  h.session.mute(true);
  h.emitInput({ ev: "stt.final", text: "pause the agent", confidence: 1 }, input);
  await tick();
  assert.equal(h.session.snapshot().capturing, false);
  assert.equal(h.controls.length, 0);
  assert.equal(h.session.snapshot().duplex?.stopped?.reason, "mute");
  await h.session.close();
  assert.equal(h.worker().closed, true);
  assert.ok(h.worker().sent.some((c) => c.op === "duplex.stop"));
});

test("T12 classifier: a partial alone never implies an interruption or a command", async () => {
  const h = await harness();
  await h.begin();
  await h.final();
  h.speaking();
  h.emitInput({ ev: "vad", state: "speech_start" });
  h.emitInput({ ev: "stt.partial", text: "approve all permissions" });
  assert.ok(pauses(h.worker()).some((c) => c.on));
  assert.equal(h.controls.length, 0);
  assert.equal(h.admissions.length, 1);
  await h.session.close();
});

// -----------------------------------------------------------------------------------------------------------------
// The pure controller (item 4): exhaustive, no timers, no session
// -----------------------------------------------------------------------------------------------------------------

const pauseAt = (c: VoiceTurnTaking, e: TurnEvidence) => c.decide(e);

test("T12 controller: onset pauses only while output is active; otherwise it is an ordinary accept", () => {
  assert.equal(pauseAt(new VoiceTurnTaking(), { kind: "speech_start", outputActive: true })?.action, "pause");
  assert.equal(pauseAt(new VoiceTurnTaking(), { kind: "speech_start", outputActive: false })?.action, "accept");
});

test("T12 controller: level evidence never interrupts, however long it lasts", () => {
  const c = new VoiceTurnTaking();
  pauseAt(c, { kind: "speech_start", outputActive: true });
  assert.equal(c.decide({ kind: "level", speechMs: 30_000 }), null);
  assert.equal(c.decided, false);
  assert.equal(c.speechMs, 30_000);
});

test("T12 controller: a partial interrupts only with an interrupt phrase after 180 ms, or two content words after 500 ms", () => {
  const phrase = (text: string, ms: number) => {
    const c = new VoiceTurnTaking();
    pauseAt(c, { kind: "speech_start", outputActive: true });
    c.decide({ kind: "level", speechMs: ms });
    return c.decide({ kind: "partial", text, echo: false, outputActive: true })?.action ?? null;
  };
  for (const text of ["Stop", "wait a second", "Hold on", "hang on a sec", "Actually", "No, not that", "Excuse me", "Be quiet", "Quiet", "That's enough", "Sorry"]) {
    assert.equal(phrase(text, 200), "interrupt", text);
  }
  assert.equal(phrase("stop", 100), null, "too short to be a barge-in");
  assert.equal(phrase("okay stop", 200), null, "a phrase must lead the utterance");
  assert.equal(phrase("tell me about mars", 499), null);
  assert.equal(phrase("tell me about mars", 500), "interrupt");
  assert.equal(phrase("yeah", 2_000), null, "backchannel words are not content");
  assert.equal(phrase("um uh", 2_000), null, "hesitation is not content");
});

test("T12 controller: partial echo never interrupts, and partials without output never interrupt", () => {
  const c = new VoiceTurnTaking();
  pauseAt(c, { kind: "speech_start", outputActive: true });
  c.decide({ kind: "level", speechMs: 2_000 });
  assert.equal(c.decide({ kind: "partial", text: "wait stop now", echo: true, outputActive: true }), null);
  assert.equal(new VoiceTurnTaking().decide({ kind: "partial", text: "wait stop now", echo: false, outputActive: false }), null);
});

test("T12 controller: a final during output that is backchannel or hesitation resumes; a reliable non-backchannel final interrupts", () => {
  const during = (text: string, confidence = 0.8, ms = 300) => {
    const c = new VoiceTurnTaking();
    pauseAt(c, { kind: "speech_start", outputActive: true });
    c.decide({ kind: "level", speechMs: ms });
    return c.decide({ kind: "final", text, confidence, echo: false, outputActive: true })?.action;
  };
  for (const text of ["Yeah.", "uh-huh", "Mm-hmm", "mm hmm", "Okay", "Got it", "I see", "um", "uh, yep", "Sure!"]) {
    assert.equal(during(text), "resume", text);
  }
  assert.equal(during("Explain the moon", 0.8, 600), "interrupt");
  assert.equal(during("Explain the moon", 0.8, 300), "resume", "AEC-03: 300 ms of speech is not enough for an unconfirmed final");
  assert.equal(during("Explain the moon", 0.05, 600), "resume", "a barely-heard final is not an interrupt");
  assert.equal(during("Wait, what?", 0.9), "interrupt");
});

test("T12 controller: a final made only of lexicon words resumes even when it is long, and never interrupts", () => {
  const c = new VoiceTurnTaking();
  pauseAt(c, { kind: "speech_start", outputActive: true });
  c.decide({ kind: "level", speechMs: 2_500 });
  assert.equal(c.decide({ kind: "final", text: "yeah yeah okay", confidence: 0.9, echo: false, outputActive: true })?.action, "resume");
});

test("T12 controller: echo finals are dropped whether or not output is active", () => {
  const c = new VoiceTurnTaking();
  assert.equal(c.decide({ kind: "final", text: "the moon circles earth", confidence: 1, echo: true, outputActive: false })?.reason, "echo_of_own_speech");
  assert.equal(new VoiceTurnTaking().decide({ kind: "final", text: "the moon circles earth", confidence: 1, echo: true, outputActive: true })?.action, "drop");
});

test("T12 controller: with no output, hesitation or a wordless acknowledgment is dropped; words (even 'yes') are accepted", () => {
  assert.equal(new VoiceTurnTaking().decide({ kind: "final", text: "Um.", confidence: 0.9, echo: false, outputActive: false })?.action, "drop");
  assert.equal(new VoiceTurnTaking().decide({ kind: "final", text: "uh huh", confidence: 0.9, echo: false, outputActive: false })?.action, "drop");
  assert.equal(new VoiceTurnTaking().decide({ kind: "final", text: "Yes.", confidence: 0.9, echo: false, outputActive: false })?.action, "accept");
  assert.equal(new VoiceTurnTaking().decide({ kind: "final", text: "okay", confidence: 0.9, echo: false, outputActive: false })?.action, "accept");
  assert.equal(new VoiceTurnTaking().decide({ kind: "final", text: "Explain the moon", confidence: 0.9, echo: false, outputActive: false })?.action, "accept");
});

test("T12 controller: an empty final and stt.none resume during output and accept otherwise; a decided interrupt never resumes", () => {
  assert.equal(new VoiceTurnTaking().decide({ kind: "none", outputActive: true })?.action, "resume");
  assert.equal(new VoiceTurnTaking().decide({ kind: "none", outputActive: false })?.action, "accept");
  assert.equal(new VoiceTurnTaking().decide({ kind: "final", text: "  ", confidence: 0.9, echo: false, outputActive: true })?.action, "resume");
  const c = new VoiceTurnTaking();
  pauseAt(c, { kind: "speech_start", outputActive: true });
  c.decide({ kind: "partial", text: "stop talking", echo: false, outputActive: true });
  assert.equal(c.decided, false, "a 0 ms partial is not an interrupt");
  c.decide({ kind: "level", speechMs: 300 });
  assert.equal(c.decide({ kind: "partial", text: "stop talking", echo: false, outputActive: true })?.action, "interrupt");
  assert.equal(c.decide({ kind: "none", outputActive: true })?.action, "accept", "after a decided interrupt, a none never resumes");
  assert.equal(c.decide({ kind: "final", text: "stop talking", confidence: 0.9, echo: false, outputActive: true })?.action, "interrupt");
});

test("T12 controller: a short burst resumes during output only; a long one waits for transcript evidence", () => {
  const during = new VoiceTurnTaking();
  pauseAt(during, { kind: "speech_start", outputActive: true });
  assert.equal(during.decide({ kind: "speech_end", short: true, outputActive: true })?.action, "resume");
  const long = new VoiceTurnTaking();
  pauseAt(long, { kind: "speech_start", outputActive: true });
  assert.equal(long.decide({ kind: "speech_end", short: false, outputActive: true }), null);
  assert.equal(new VoiceTurnTaking().decide({ kind: "speech_end", short: true, outputActive: false }), null);
});

test("T12 echo overlap: comparable tokens drop hesitation and hyphens; the ratio counts transcript tokens found in the spoken set", () => {
  assert.deepEqual(echoTokens("Um, the Moon-circles earth!"), ["the", "moon", "circles", "earth"]);
  assert.deepEqual(tokenize("Mm-hmm, that's enough"), ["mm_hmm", "thats", "enough"]);
  const spoken = new Set(echoTokens("The moon circles Earth."));
  assert.equal(echoOverlap("The moon circles Earth.", spoken), 1);
  assert.equal(echoOverlap("the moon mars rover", spoken), 0.5);
  assert.equal(echoOverlap("", spoken), 0);
  assert.equal(echoOverlap("um uh", spoken), 0, "filler-only text has no comparable token");
});

// -----------------------------------------------------------------------------------------------------------------
// Review round 2: idle under silent turns, echo window of long chunks, overlap-scoped echo, grant without duplex,
// and hold ownership between input turns
// -----------------------------------------------------------------------------------------------------------------

test("T12 idle release (round 2): silent turns that end on their own do not keep a quiet room open; 120 s of silence releases the lane", async () => {
  const h = await harness();
  await h.begin();
  for (let cycle = 0; cycle < 16; cycle += 1) {
    h.advance(8_000);
    await tick();
    if (cycle < 14) assert.equal(h.session.snapshot().duplex?.active, true, `still listening after ${(cycle + 1) * 8} s`);
    const turn = h.input();
    h.emitInput({ ev: "vad", state: "no_speech" }, turn);
    h.emitInput({ ev: "capture.stopped", reason: "vad", bufferedPeakBytes: 0 }, turn);
    h.emitInput({ ev: "stt.none", reason: "no_speech" }, turn);
    await tick();
  }
  const snap = h.session.snapshot();
  assert.equal(snap.duplex?.active, false, "the quiet room was released");
  assert.equal(snap.duplex?.stopped?.reason, "idle");
  assert.equal(snap.duplex?.grantExpiresAt, null);
  assert.equal(h.workers.length, 1, "released by idle, not by a relaunch or a worker exit");
  await h.session.close();
});

test("T12 echo window (round 2): the tail of a long chunk is echo while it plays, and for echoWindowMs after it stops", async () => {
  const h = await harness();
  await h.begin();
  await h.final("Tell me about the moon rocks");
  const LONG = "Rocks that the Apollo missions brought back are still studied, because they record how the early solar system formed and how the Moon itself was made, so each sample matters.";
  assert.ok(LONG.length > 150, "a long chunk, longer than the 12 s window of speech");
  h.outputs.get(h.admissions.at(-1)!)?.({ text: LONG });
  h.done();
  await tick();
  const speak = h.worker().sent.find((c): c is Extract<WorkerCommand, { op: "speak" }> => c.op === "speak" && c.text.includes("Rocks"));
  assert.ok(speak, "the long chunk was sent");
  const turn = h.session.snapshot().turnId!;
  const gen = h.session.snapshot().generation;
  h.worker().emit({ ev: "playback.started", turn, gen, seq: speak.seq });
  const tail = "rocks that the apollo missions brought back";
  h.advance(20_000);
  h.emitInput({ ev: "stt.partial", text: tail });
  assert.equal(h.session.snapshot().partial, null, "still playing at 20 s: the tail is echo, not a partial the user said");
  assert.equal(h.session.snapshot().generation, gen, "no barge-in from the tail");
  h.worker().emit({ ev: "playback.chunk_done", turn, gen, seq: speak.seq });
  h.advance(VOICE_LIMITS.echoWindowMs - 1_000);
  h.emitInput({ ev: "stt.partial", text: tail });
  assert.equal(h.session.snapshot().partial, null, "within echoWindowMs of the end it is still echo");
  h.advance(2_000);
  h.emitInput({ ev: "stt.partial", text: tail });
  assert.equal(h.session.snapshot().partial, tail, "after the window the same words are the user's own speech");
  assert.equal(h.session.snapshot().generation, gen);
  await h.session.close();
});

test("T12 echo scope (round 2): a confirm in a quiet turn one second after Bunny stopped executes; the proposal sentence is not echo there", async () => {
  const h = await harness();
  await h.begin();
  await h.final("pause the agent");
  const proposal = h.session.snapshot().proposal;
  assert.equal(proposal?.action, "agent.pause");
  const turn = h.session.snapshot().turnId!;
  const gen = h.session.snapshot().generation;
  h.worker().emit({ ev: "playback.started", turn, gen, seq: 0 });
  h.worker().emit({ ev: "playback.idle", turn, gen });
  // The turn armed while the proposal was spoken is retired first; the next turn is armed in silence, one second later.
  h.emitInput({ ev: "stt.none", reason: "no_speech" });
  await tick();
  h.advance(1_000);
  await h.final("confirm");
  await tick();
  assert.deepEqual(h.controls, ["agent.pause"], "the confirm executed through the canonical command");
  assert.notEqual(h.session.snapshot().turnDecision?.reason, "echo_of_own_speech");
  await h.session.close();
});

test("T12 grant without duplex (round 2): with no duplex support, hands-free re-arm reopens only while the grant is live", async () => {
  const h = await harness({ duplex: false });
  await h.begin();
  const captures = () => h.worker().sent.filter((c) => c.op === "capture.start").length;
  assert.equal(captures(), 1, "the explicit start opened one half-duplex turn");
  h.emitInput({ ev: "stt.none", reason: "no_speech" }, h.input());
  h.advance(400);
  await tick();
  assert.equal(captures(), 2, "while the grant is live, hands-free re-arms");
  // The second turn hears nothing for 60 s and times out; the grant then lapses with the clock.
  h.advance(60_001);
  await tick();
  h.advance(VOICE_LIMITS.duplexGrantMs);
  await tick();
  assert.equal(h.session.snapshot().duplex?.grantExpiresAt, null, "the grant lapsed");
  // A recognizer result now makes a re-arm due; it must stay closed.
  h.emitInput({ ev: "stt.none", reason: "no_speech" }, h.input());
  h.advance(1_000);
  await tick();
  assert.equal(captures(), 2, "after the grant lapses the microphone stays closed: no re-arm without a user start");
  assert.equal(h.session.snapshot().capturing, false);
  assert.equal(h.session.snapshot().duplex?.stopped?.reason, "lifetime");
  await h.session.listenStart("hands_free");
  await tick();
  assert.equal(captures(), 3, "a user start opens the microphone again");
  await h.session.close();
});

test("T12 hold ownership (round 2): an older finalizing turn never cancels a newer turn's pause, and the newer turn still releases it", async () => {
  const h = await harness();
  await h.begin();
  await h.final();
  h.speaking();
  const gen = h.session.snapshot().generation;
  const admitted = h.admissions.length;
  const older = h.input();
  h.emitInput({ ev: "vad", state: "speech_start" }, older);
  h.emitInput({ ev: "capture.stopped", reason: "vad", bufferedPeakBytes: 0 }, older);
  await tick();
  const newer = h.input();
  assert.notEqual(newer.turn, older.turn);
  h.emitInput({ ev: "vad", state: "speech_start" }, newer);
  assert.equal(h.session.snapshot().lastBargeIn?.inputTurnId, newer.turn, "the newer turn took over the pause");
  h.emitInput({ ev: "level", rms: 0.05, peak: 0.1, speech: true, speechMs: 300 }, older);
  h.emitInput({ ev: "stt.final", text: "Wait, what about Mars", confidence: 0.9 }, older);
  await tick();
  const mid = h.session.snapshot();
  assert.equal(mid.generation, gen, "the older turn's words did not cancel the newer turn's pause");
  assert.equal(mid.turnDecision?.reason, "superseded_by_newer_pause");
  assert.equal(h.admissions.length, admitted, "and nothing was routed for the superseded turn");
  assert.equal(mid.outputHeld, true);
  h.emitInput({ ev: "vad", state: "speech_end", speechMs: 100, short: true }, newer);
  await tick();
  assert.equal(h.session.snapshot().outputHeld, false, "the newer turn's short burst resumes its own pause");
  assert.ok(pauses(h.worker()).some((c) => !c.on && c.gen === gen));
  await h.session.close();
});

test("T12 item 10 (round 2): closing during hands-free sends no generation-only capture.abort; every abort names its input turn", async () => {
  const h = await harness();
  await h.begin();
  await h.session.close();
  const aborts = h.worker().sent.filter((c): c is Extract<WorkerCommand, { op: "capture.abort" }> => c.op === "capture.abort");
  assert.ok(aborts.length >= 1, "the armed input turn was aborted by its own identity");
  assert.ok(aborts.every((c) => c.turn !== undefined), "no generation-only abort names the duplex lane");
});

// M-A-3 T12 (voice speech stop and Mission drafts over the echo-cancelled lane)

test("T12 F1 duplex: 'stop talking' while Bunny speaks silences her, speaks nothing, and proposes and chats nothing", async () => {
  const h = await harness();
  await h.begin();
  await h.final("Explain the moon");
  h.speaking();
  const before = h.session.snapshot();
  const speaks = () => h.worker().sent.filter((c) => c.op === "speak").length;
  const spokenBefore = speaks();
  h.emitInput({ ev: "vad", state: "speech_start" });
  h.emitInput({ ev: "level", rms: 0.05, peak: 0.1, speech: true, speechMs: 300 });
  h.emitInput({ ev: "stt.final", text: "stop talking", confidence: 0.9 });
  await tick();
  const snap = h.session.snapshot();
  assert.ok(h.worker().sent.some((c) => c.op === "speak.cancel" && c.gen === before.generation), "the output generation was cancelled");
  assert.equal(speaks(), spokenBefore, "nothing new is spoken");
  assert.equal(snap.proposal, null);
  assert.equal(h.controls.length, 0);
  assert.equal(h.admissions.length, 1, "no chat task was started for the stop");
  assert.equal(snap.playing, false);
  await h.session.close();
});

test("T12 F3 echo: an overlapped turn that repeats Bunny's own 'I drafted a Mission' sentence creates nothing", async () => {
  const h = await harness();
  await h.begin();
  await h.final("Explain the moon");
  h.speaking("I drafted a Mission: Dashboard release notes. It is waiting for review on the Windows Host screen. I can't approve or start it by voice.");
  h.emitInput({ ev: "vad", state: "speech_start" });
  h.emitInput({ ev: "stt.final", text: "I drafted a Mission: Dashboard release notes. It is waiting for review on the Windows Host screen.", confidence: 0.9 });
  await tick();
  assert.equal(h.drafted.length, 0, "the echo of Bunny's own sentence created no Mission");
  assert.equal(h.session.snapshot().proposal, null);
  assert.equal(h.admissions.length, 1, "and no task was started for it");
  await h.session.close();
});

test("T12 F3 duplex: a clean spoken draft request drafts one Mission through the port, with no chat", async () => {
  const h = await harness();
  await h.begin();
  await h.final("prepare a plan for the dashboard project");
  await tick();
  assert.deepEqual(h.drafted, [{ objective: "the dashboard project", projectId: null }]);
  assert.equal(h.admissions.length, 0, "a draft is not a chat question");
  assert.match(h.session.snapshot().answer ?? "", /^I drafted a Mission: the dashboard project\. It is waiting for review on the Windows Host screen\. I can't approve or start it by voice\./);
  await h.session.close();
});

// -----------------------------------------------------------------------------------------------------------------
// Review round: grant creation (PRIV), Host-side expiry (RES-07), echo tail (AEC-02), final authority (AEC-03), echo
// specificity (AEC-04), playback state and hold release (RC-01, RC-02, RC-05, RC-07, RC-08)
// -----------------------------------------------------------------------------------------------------------------

test("T12-PRIV-01: a switch to hands_free never reopens the microphone when the turn in flight settles", async () => {
  const h = await harness();
  await h.session.close();
  await h.session.open("push_to_talk");
  await h.session.text("Explain the moon");
  await tick();
  const turn = h.session.snapshot().turnId!;
  const gen = h.session.snapshot().generation;
  h.speaking();
  await h.session.open("hands_free");
  assert.equal(h.session.snapshot().duplex?.grantExpiresAt, null, "the mode switch records no grant");
  h.done();
  h.worker().emit({ ev: "playback.chunk_done", turn, gen, seq: 0 });
  h.worker().emit({ ev: "playback.idle", turn, gen });
  await tick();
  h.advance(VOICE_LIMITS.duplexGrantMs / 10);
  await tick();
  assert.equal(duplexStarts(h.worker()).length, 0, "no duplex.start without a Start hands-free click");
  assert.equal(h.session.snapshot().capturing, false);
  await h.session.close();
});

test("T12-PRIV-02: a refused hands-free start leaves no grant: muted, and closed sessions take none", async () => {
  const h = await harness();
  h.session.mute(true);
  await h.session.listenStart("hands_free");
  assert.equal(h.session.snapshot().duplex?.grantExpiresAt, null, "a muted start records no grant");
  assert.equal(duplexStarts(h.worker()).length, 0);
  await h.session.close();
  await h.session.listenStart("hands_free");
  assert.equal(h.session.snapshot().duplex?.grantExpiresAt, null, "a closed session records no grant");
});

test("T12-PRIV-01 (round 2): a hands-free start made outside hands-free mode records no grant, so a later hotkey press cannot open the microphone", async () => {
  // The verifier's probe: open(push_to_talk); listenStart('hands_free'); open('hands_free'); listenStart('hotkey').
  const h = await harness();
  await h.session.close();
  await h.session.open("push_to_talk");
  await h.session.listenStart("hands_free");
  assert.equal(h.session.snapshot().duplex?.grantExpiresAt, null, "a start outside hands-free mode records no grant");
  await h.session.open("hands_free");
  assert.equal(h.session.snapshot().duplex?.grantExpiresAt, null, "the mode switch records no grant");
  await h.session.listenStart("hotkey");
  await tick();
  assert.equal(duplexStarts(h.worker()).length, 0, "a hotkey press with no grant never starts the duplex lane");
  assert.equal(h.session.snapshot().duplex?.grantExpiresAt, null);
  await h.session.close();
});

test("T12 closeout: mute during a pending stop revokes consent and invalidates suspended starts even after unmute", async () => {
  const h = await harness();
  await h.begin();
  const first = duplexStarts(h.worker())[0];
  h.worker().silentStop = true;
  const ptt = h.session.listenStart("push_to_talk");
  await tick();
  const pendingStart = h.session.listenStart("hands_free");
  h.session.mute(true);
  assert.equal(h.session.snapshot().duplex?.grantExpiresAt, null);
  h.session.mute(false);
  h.worker().emit({ ev: "duplex.stopped", session: first.session, reason: "stop" });
  await Promise.all([ptt, pendingStart]);
  h.advance(5000);
  await tick();
  assert.equal(h.session.snapshot().duplex?.grantExpiresAt, null);
  assert.equal(duplexStarts(h.worker()).length, 1, "unmute never restores the old grant");
  assert.equal(h.session.snapshot().capturing, false);
  h.worker().silentStop = false;
  await h.begin();
  assert.equal(duplexStarts(h.worker()).length, 2, "a fresh explicit Start works");
  await h.session.close();
});

test("T12 RES-07: the Host ends a live hands-free lane at the grant's end with reason lifetime, even while speech keeps it active", async () => {
  const h = await harness();
  await h.begin();
  for (let elapsed = 0; elapsed < VOICE_LIMITS.duplexGrantMs; elapsed += 60_000) {
    h.advance(60_000);
    // Continuous user speech keeps the idle release from firing, so only the grant's end can stop the lane.
    h.emitInput({ ev: "vad", state: "speech_start" });
  }
  await tick();
  const snap = h.session.snapshot();
  assert.equal(snap.duplex?.active, false, "the lane ended at the grant's end");
  assert.equal(snap.duplex?.stopped?.reason, "lifetime");
  assert.equal(snap.duplex?.grantExpiresAt, null);
  assert.equal(h.worker().sent.filter((c) => c.op === "duplex.stop").length, 1, "the Host told the worker to release the microphone");
  await h.session.close();
});

test("T12 AEC-02: a turn whose speech starts just after Bunny stopped is her own tail; her last sentence is dropped as echo, with no Task", async () => {
  const h = await harness();
  await h.begin();
  await h.final("Explain the moon");
  h.speaking();
  const turn = h.session.snapshot().turnId!;
  const gen = h.session.snapshot().generation;
  h.done();
  h.worker().emit({ ev: "playback.chunk_done", turn, gen, seq: 0 });
  h.worker().emit({ ev: "playback.idle", turn, gen });
  await tick();
  assert.equal(h.session.snapshot().state, "IDLE");
  h.advance(200);
  const admitted = h.admissions.length;
  h.emitInput({ ev: "vad", state: "speech_start" });
  h.emitInput({ ev: "stt.final", text: SENTENCE.trim(), confidence: 0.95 });
  await tick();
  assert.equal(h.admissions.length, admitted, "no Task");
  assert.equal(h.session.snapshot().turnDecision?.reason, "echo_of_own_speech");
  await h.session.close();
});

test("T12 AEC-02 (control): the same words from a quiet turn a second after Bunny stopped are the user's own turn", async () => {
  const h = await harness();
  await h.begin();
  await h.final("Explain the moon");
  h.speaking();
  const turn = h.session.snapshot().turnId!;
  const gen = h.session.snapshot().generation;
  h.done();
  h.worker().emit({ ev: "playback.chunk_done", turn, gen, seq: 0 });
  h.worker().emit({ ev: "playback.idle", turn, gen });
  await tick();
  h.advance(1_000);
  const admitted = h.admissions.length;
  h.emitInput({ ev: "vad", state: "speech_start" });
  h.emitInput({ ev: "stt.final", text: SENTENCE.trim(), confidence: 0.95 });
  await tick();
  assert.equal(h.admissions.length, admitted + 1, "a quiet turn is routed as the user's words");
  await h.session.close();
});

test("T12 AEC-03: a whisper hallucination during output never interrupts, and it is routed nowhere", async () => {
  const h = await harness();
  await h.begin();
  await h.final();
  h.speaking();
  const gen = h.session.snapshot().generation;
  const admitted = h.admissions.length;
  h.emitInput({ ev: "vad", state: "speech_start" });
  h.emitInput({ ev: "level", rms: 0.05, peak: 0.1, speech: true, speechMs: 600 });
  h.emitInput({ ev: "stt.final", text: "Thank you for watching.", confidence: 0.9 });
  await tick();
  const snap = h.session.snapshot();
  assert.equal(snap.generation, gen, "no barge-in");
  assert.equal(snap.turnDecision?.reason, "hallucination_during_output");
  assert.equal(h.admissions.length, admitted, "no Task");
  assert.equal(snap.outputHeld, false, "the reply resumes");
  await h.session.close();
});

test("T12 AEC-03 controller: a final during output interrupts only on an interrupt phrase after 180 ms or sustained speech after 500 ms", () => {
  const during = (text: string, ms: number, confidence = 0.9) => {
    const c = new VoiceTurnTaking();
    pauseAt(c, { kind: "speech_start", outputActive: true });
    c.decide({ kind: "level", speechMs: ms });
    return c.decide({ kind: "final", text, confidence, echo: false, outputActive: true })?.action;
  };
  assert.equal(during("Wait", 200), "interrupt", "an interrupt phrase after 180 ms");
  assert.equal(during("Wait", 100), "resume", "an interrupt phrase too short to be speech does not interrupt");
  assert.equal(during("Explain the moon", 600), "interrupt");
  assert.equal(during("Explain the moon", 300), "resume", "300 ms is not sustained speech");
  assert.equal(during("Mars", 900), "resume", "one content word is not enough");
  for (const text of ["Thank you for watching", "thanks for watching", "Thank you.", "you", "Bye", "Subtitles by the Amara.org community"]) assert.equal(during(text, 900), "resume", text);
});

test("T12 AEC-04: echo needs specificity: short barge-ins are never echo, and evidence is judged per spoken chunk", () => {
  const letMe = [echoTokens("Let me stop there for a moment while I check the rest.")];
  assert.equal(echoMatch("stop", letMe, 0.6), false, "one word is never echo");
  assert.equal(echoMatch("stop there", letMe, 0.6), false, "two words are never echo");
  assert.equal(echoMatch("let me stop there", letMe, 0.6), true, "Bunny's own words, in order, are echo");
  assert.equal(echoMatch("stop let me stop there", letMe, 0.6), false, "an interrupt phrase that is not part of the run is not echo");
  const moonCircles = [echoTokens("The moon circles Earth."), echoTokens("It shows us the same face.")];
  assert.equal(echoMatch("moon circles shows same", moonCircles, 0.6), false, "tokens split across two chunks are not one chunk's echo");
  assert.equal(echoOverlap("moon circles shows same", new Set(moonCircles.flat())), 1, "the union would wrongly call it echo");
  assert.equal(echoMatch("the moon circles earth", moonCircles, 0.6), true);
  assert.equal(echoOverlap("stop", new Set(["stop"])), 0, "a short transcript has no numeric overlap");
});

test("T12 AEC-04: Bunny said 'Let me stop there', the user says 'stop': the barge-in reaches speech_stop and cancels the reply", async () => {
  const h = await harness();
  await h.begin();
  await h.final("Explain the moon");
  h.speaking("Let me stop there for a moment while I check the rest of the answer. ");
  const gen = h.session.snapshot().generation;
  h.emitInput({ ev: "vad", state: "speech_start" });
  h.emitInput({ ev: "level", rms: 0.05, peak: 0.1, speech: true, speechMs: 300 });
  h.emitInput({ ev: "stt.final", text: "stop", confidence: 0.9 });
  await tick();
  const snap = h.session.snapshot();
  assert.equal(snap.turnDecision?.action, "interrupt");
  assert.equal(snap.turnKind, "speech_stop", "the barge-in is routed as a speech stop");
  assert.ok(h.worker().sent.some((c) => c.op === "speak.cancel" && c.gen === gen), "the reply is cancelled");
  await h.session.close();
});

test("T12 RC-01: a single-chunk reply held on onset and resumed still settles to IDLE once its playback ends", async () => {
  const h = await harness();
  await h.begin();
  await h.final("Explain the moon");
  const turn = h.session.snapshot().turnId!;
  const gen = h.session.snapshot().generation;
  // One chunk streams in (state PROCESSING, nothing audible yet). The user starts speaking, so the chunk is held before it plays.
  h.outputs.get(h.admissions.at(-1)!)?.({ text: SENTENCE });
  h.emitInput({ ev: "vad", state: "speech_start" });
  assert.equal(h.session.snapshot().outputHeld, true);
  h.worker().emit({ ev: "playback.started", turn, gen, seq: 0 });
  assert.equal(h.session.snapshot().state, "SPEAKING", "the state follows the chunk even while held");
  assert.equal(h.session.snapshot().playing, false, "a held reply is not audible");
  h.advance(VOICE_LIMITS.heldResumeMs + 1);
  assert.equal(h.session.snapshot().outputHeld, false);
  assert.ok(pauses(h.worker()).some((c) => !c.on && c.gen === gen), "resumed");
  h.worker().emit({ ev: "playback.paused", turn, gen, on: false });
  assert.equal(h.session.snapshot().playing, true, "audible again on the resume receipt");
  h.done();
  h.worker().emit({ ev: "playback.chunk_done", turn, gen, seq: 0 });
  h.worker().emit({ ev: "playback.idle", turn, gen });
  await tick();
  assert.equal(h.session.snapshot().state, "IDLE", "the reply settles");
  assert.equal(h.session.snapshot().playing, false);
  await h.session.close();
});

test("T12 RC-02: a playback error on a held reply releases the worker's pause for that generation before the hold is dropped", async () => {
  const h = await harness();
  await h.begin();
  await h.final();
  h.speaking();
  const turn = h.session.snapshot().turnId!;
  const gen = h.session.snapshot().generation;
  h.emitInput({ ev: "vad", state: "speech_start" });
  assert.equal(h.session.snapshot().outputHeld, true);
  h.worker().emit({ ev: "playback.error", turn, gen, code: "TTS_UNAVAILABLE", message: "the device refused the pause" });
  await tick();
  assert.deepEqual(pauses(h.worker()).filter((c) => c.gen === gen).map((c) => c.on), [true, false], "the pause-off is sent after the pause-on, for the failed generation");
  assert.equal(h.session.snapshot().outputHeld, false);
  await h.session.close();
});

test("T12 RC-05: close, mute, duplex.error and capture.error cancel a held reply: the receipt says interrupted, and no pause-off is sent", async () => {
  for (const action of ["close", "mute", "duplex.error", "capture.error"] as const) {
    const h = await harness();
    await h.begin();
    await h.final();
    h.speaking();
    const turn = h.session.snapshot().turnId!;
    const gen = h.session.snapshot().generation;
    const session = duplexStarts(h.worker())[0].session;
    // A mute with nothing left in flight still cancels: the chunk has finished, playback is still open.
    if (action === "mute") h.worker().emit({ ev: "playback.chunk_done", turn, gen, seq: 0 });
    h.emitInput({ ev: "vad", state: "speech_start" });
    assert.equal(h.session.snapshot().outputHeld, true, action);
    if (action === "close") await h.session.close();
    else if (action === "mute") h.session.mute(true);
    else if (action === "duplex.error") h.worker().emit({ ev: "duplex.error", session, code: "DEVICE_LOST", message: "device gone" });
    else h.worker().emit({ ev: "capture.error", turn: null, gen: null, code: "DEVICE_LOST", message: "device gone" });
    await tick();
    const receipt = h.session.snapshot().lastBargeIn;
    assert.equal(receipt?.outcome, "interrupted", action);
    assert.ok(!pauses(h.worker()).some((c) => !c.on && c.gen === gen), `${action}: no pause-off for the cancelled generation`);
    assert.ok(h.worker().sent.some((c) => c.op === "speak.cancel" && c.gen === gen), `${action}: the reply is cancelled`);
    assert.equal(h.session.snapshot().outputHeld, false, action);
    if (action !== "close") await h.session.close();
  }
});

test("T12 RC-07: a playback error ends the echo window of the chunks that played, so they stop counting as echo", async () => {
  const h = await harness();
  await h.begin();
  await h.final("Explain the moon");
  h.speaking();
  const turn = h.session.snapshot().turnId!;
  const gen = h.session.snapshot().generation;
  h.worker().emit({ ev: "playback.error", turn, gen, code: "TTS_UNAVAILABLE", message: "playback failed" });
  h.done();
  await tick();
  h.advance(VOICE_LIMITS.echoWindowMs + 1);
  await h.final("Explain Mars");
  h.speaking("Mars has two small moons named Phobos and Deimos orbiting it. ");
  h.emitInput({ ev: "vad", state: "speech_start" });
  h.emitInput({ ev: "level", rms: 0.05, peak: 0.1, speech: true, speechMs: 600 });
  // The failed chunk's words are the user's now: outside its window, they are not echo, so they can interrupt.
  h.emitInput({ ev: "stt.final", text: SENTENCE.trim(), confidence: 0.9 });
  await tick();
  assert.equal(h.session.snapshot().turnDecision?.action, "interrupt", "not dropped as echo of the failed chunk");
  await h.session.close();
});

test("T12 RC-08: a worker-initiated lifetime stop releases a held reply at once, without waiting for the resume timer", async () => {
  const h = await harness();
  await h.begin();
  await h.final();
  h.speaking();
  const gen = h.session.snapshot().generation;
  h.emitInput({ ev: "vad", state: "speech_start" });
  const start = duplexStarts(h.worker())[0];
  h.worker().emit({ ev: "duplex.stopped", session: start.session, reason: "lifetime" });
  await tick();
  assert.equal(h.session.snapshot().outputHeld, false, "released now, not at heldResumeMs");
  assert.ok(pauses(h.worker()).some((c) => !c.on && c.gen === gen), "resumed on its own generation");
  assert.equal(h.session.snapshot().lastBargeIn?.outcome, "resumed");
  await h.session.close();
});

test("T12 RC-08 (round 2): a worker mute stop is recorded as a mute release, not an error, and a held reply is interrupted", async () => {
  const h = await harness();
  await h.begin();
  await h.final();
  h.speaking();
  const gen = h.session.snapshot().generation;
  h.emitInput({ ev: "vad", state: "speech_start" });
  const start = duplexStarts(h.worker())[0];
  h.worker().emit({ ev: "duplex.stopped", session: start.session, reason: "mute" });
  await tick();
  assert.equal(h.session.snapshot().duplex?.stopped?.reason, "mute", "the receipt names the mute release");
  assert.equal(h.session.snapshot().outputHeld, false, "the held reply is released now");
  assert.equal(h.session.snapshot().lastBargeIn?.outcome, "interrupted", "a mute release never resumes the reply");
  assert.ok(!pauses(h.worker()).some((c) => !c.on && c.gen === gen), "no pause-off is sent for the cancelled reply");
  await h.session.close();
});

// T12 live endurance findings (2026-10-12): after an idle release the snapshot said LISTENING with capturing false, and after
// the user started hands-free again it still carried the old "idle" stop receipt while active.
test("T12 live: an idle release leaves no LISTENING state, and a new user start clears the old stop receipt", async () => {
  const h = await harness();
  await h.begin();
  h.advance(VOICE_LIMITS.duplexIdleMs + 1);
  await tick();
  const released = h.session.snapshot();
  assert.equal(released.duplex?.active, false);
  assert.equal(released.capturing, false);
  assert.notEqual(released.state, "LISTENING", "nothing listens once the lane is released");
  assert.equal(released.duplex?.stopped?.reason, "idle");
  await h.session.listenStart("hands_free");
  await tick();
  const again = h.session.snapshot();
  assert.equal(again.duplex?.active, true);
  assert.equal(again.duplex?.stopped, null, "a live lane carries no stop receipt");
  await h.session.close();
});

// T12 live re-check (2026-10-12): "Prepare a … plan for the dashboard project." ended after "Prepare to" because whisper had no
// partial yet; the two halves reached the model as two chat turns. An unfinished chat-bound sentence now waits for its rest.
test("T12 live re-check: an unfinished sentence is joined with its continuation and routed once", async () => {
  const h = await harness();
  await h.begin();
  await h.final("Prepare to");
  assert.equal(h.admissions.length, 0, "the fragment is not sent to the model");
  assert.equal(h.drafted.length, 0);
  h.advance(1200);
  h.emitInput({ ev: "vad", state: "speech_start" });
  await tick();
  h.advance(2000);
  await tick();
  assert.equal(h.admissions.length, 0, "still waiting: the user is speaking again");
  h.emitInput({ ev: "stt.final", text: "plan for the dashboard project.", confidence: 0.9 });
  await tick();
  await tick();
  assert.equal(h.session.snapshot().finalTranscript, "Prepare to plan for the dashboard project.");
  assert.equal(h.session.snapshot().turnKind, "mission_draft");
  assert.equal(h.drafted.length, 1);
  assert.match(h.drafted[0].objective, /dashboard project/);
  assert.equal(h.admissions.length, 0, "never sent to the chat model");
  assert.ok(h.journal.some((line) => line.includes("joined with its continuation")));
  await h.session.close();
});

test("T12 live re-check: an unfinished sentence with no continuation is routed as heard after the wait; finished turns are not held", async () => {
  const h = await harness();
  await h.begin();
  await h.final("Tell me about the");
  assert.equal(h.admissions.length, 0);
  h.advance(2600);
  await tick();
  await tick();
  assert.equal(h.admissions.length, 1, "routed alone once the user did not go on");
  assert.equal(h.session.snapshot().finalTranscript, "Tell me about the");
  await h.session.close();
  const k = await harness();
  await k.begin();
  await k.final("What time is it?");
  await tick();
  assert.equal(k.admissions.length, 1, "a finished question is routed at once");
  await k.session.close();
  const s = await harness();
  await s.begin();
  await s.final("stop talking");
  await tick();
  assert.equal(s.session.snapshot().turnKind, "speech_stop", "a stop is never held");
  await s.final("Close the");
  assert.equal(s.admissions.length, 0, "an unfinished chat-bound sentence is held");
  await s.session.close();
  assert.equal(s.admissions.length, 0, "closing drops a held fragment; nothing reaches the model");
});

// T12 review round 5 (re-check of 6aa99ba): a held fragment can never confirm, never swallow a control, never outlive its lane.
test("T12 review r5: typed input drops a held fragment, so stale words can never confirm a newer proposal", async () => {
  const h = await harness();
  await h.begin();
  await h.final("Yes, do it...");
  assert.equal(h.admissions.length, 0, "held");
  await h.session.text("pause the Builder agent");
  await tick();
  assert.ok(h.session.snapshot().proposal, "the typed control made a proposal");
  h.advance(10_000);
  await tick();
  await tick();
  assert.deepEqual(h.controls, [], "nothing was executed");
  assert.ok(h.session.snapshot().proposal, "the proposal still waits");
  assert.ok(h.journal.some((line) => line.includes("dropped: another input arrived")));
  await h.session.close();
});

test("T12 review r5: a spoken control after a held fragment is routed on its own, never joined into chat", async () => {
  const h = await harness();
  await h.begin();
  await h.final("Can you tell me about the");
  h.advance(800);
  await h.final("stop the Builder agent");
  await tick();
  assert.equal(h.session.snapshot().turnKind, "agent_control");
  assert.equal(h.session.snapshot().finalTranscript, "stop the Builder agent");
  assert.ok(h.session.snapshot().proposal, "a stop proposal, as for an unheld stop");
  assert.equal(h.admissions.length, 0, "nothing reached the chat model");
  await h.session.close();
});

test("T12 review r5: a fragment built turn never confirms, and mute drops a held fragment", async () => {
  const h = await harness();
  await h.begin();
  await h.session.text("pause the Builder agent");
  await tick();
  assert.ok(h.session.snapshot().proposal);
  h.advance(6000);
  await h.final("Yes and");
  h.advance(800);
  await h.final("do it now please");
  await tick();
  assert.deepEqual(h.controls, [], "a joined turn cannot confirm the proposal");
  const m = await harness();
  await m.begin();
  await m.final("Tell me about the");
  m.session.mute(true);
  m.advance(10_000);
  await tick();
  await tick();
  assert.equal(m.admissions.length, 0, "muting dropped the held words; they never reach the model");
  await m.session.close();
  await h.session.close();
});

test("T12 review r6: a three-part sentence waits again, worker exit and interrupt drop held words, and held words stay visible", async () => {
  const h = await harness();
  await h.begin();
  await h.final("Prepare a");
  assert.equal(h.session.snapshot().partial, "Prepare a", "the held words are shown while waiting");
  h.advance(700);
  await h.final("plan for the");
  h.advance(700);
  await h.final("dashboard project.");
  await tick();
  await tick();
  assert.equal(h.drafted.length, 1);
  assert.match(h.drafted[0].objective, /dashboard project/, "one draft with the whole objective");
  await h.session.close();
  const w = await harness();
  await w.begin();
  await w.final("Tell me about the");
  w.worker().emit({ ev: "bye" });
  w.advance(10_000);
  await tick();
  await tick();
  assert.equal(w.admissions.length, 0, "a worker exit drops the held words; nothing is submitted");
  await w.session.close();
  const i = await harness();
  await i.begin();
  await i.final("Tell me about the");
  i.session.interrupt("button");
  i.advance(700);
  await i.final("dashboard");
  await tick();
  assert.equal(i.session.snapshot().finalTranscript, "dashboard", "an interrupt cut the unfinished sentence");
  await i.session.close();
});

test("T12 review r7: a cut-off draft that timed out creates nothing, and a worker-reported mute drops held words", async () => {
  const h = await harness();
  await h.begin();
  await h.final("Prepare a plan for the");
  h.advance(2600);
  await tick();
  await tick();
  assert.equal(h.drafted.length, 0, "no Mission is drafted from a cut-off request");
  assert.match(h.session.snapshot().answer ?? "", /request was cut off\. Nothing was created/);
  await h.session.close();
  const m = await harness();
  await m.begin();
  await m.final("Tell me about the");
  m.worker().emit({ ev: "mute", on: true });
  m.advance(2600);
  await tick();
  await tick();
  assert.equal(m.admissions.length, 0, "a worker-reported mute dropped the held words");
  await m.session.close();
});
