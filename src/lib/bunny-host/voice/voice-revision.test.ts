import test from "node:test";
import assert from "node:assert/strict";
import { VoiceSessionManager } from "./voice-session.server.ts";
import type { VoiceWorkerPort } from "./voice-worker.server.ts";
import { VOICE_PROTOCOL, type WorkerCommand, type WorkerEvent } from "./voice-protocol.ts";
import { COMPANION_INTERRUPT_MS, companionState } from "./voice-companion.ts";

/** M-A-3 T13: the voice snapshot revision and companion facts, driven through the real session manager. */

/** An in-process worker: answers `devices` and `ready` like the real worker, and records every command. */
class ReadyWorker implements VoiceWorkerPort {
  readonly id = "fake-revision";
  readonly stdinBytes = 0;
  sent: WorkerCommand[] = [];
  private listeners: ((event: WorkerEvent) => void)[] = [];
  private resolveExit!: (code: number | null) => void;
  readonly exited = new Promise<number | null>((resolve) => (this.resolveExit = resolve));
  send(command: WorkerCommand) {
    this.sent.push(command);
    if (command.op === "devices") {
      queueMicrotask(() =>
        this.emit({
          ev: "devices",
          inputs: [],
          outputs: [],
          defaultInput: { name: "Fake mic", muted: false, volume: null, present: true },
          defaultOutput: { name: "Fake speaker", muted: false, volume: null, present: true },
          micPrivacy: "allow",
        }),
      );
    }
  }
  onEvent(listener: (event: WorkerEvent) => void) {
    this.listeners.push(listener);
  }
  async close() {
    this.resolveExit(0);
  }
  emit(event: Record<string, unknown>) {
    const full = { t: 1, mono: 1, ...event } as WorkerEvent;
    for (const listener of this.listeners) listener(full);
  }
}

const ready = { ev: "ready", protocol: VOICE_PROTOCOL, pid: 1, stt: { engine: "fake-stt", recognizer: null, culture: null, local: true }, tts: { engine: "fake-tts", voices: [], local: true } };

function setup() {
  let clock = 10_000;
  const session = new VoiceSessionManager({
    hostEpoch: "epoch-revision",
    dataDirectory: "C:/unused-test-data",
    platform: "win32",
    launch: async () => {
      const worker = new ReadyWorker();
      setImmediate(() => worker.emit(ready));
      return worker;
    },
    // No chat or Agent traffic is needed to open, mute and close: the ports are never reached.
    chat: {} as never,
    agents: { rows: () => [], facts: () => ({ agents: [], missions: [], approvals: [] }), command: async () => undefined } as never,
    journal: () => undefined,
    now: () => clock,
    schedule: () => () => undefined,
  });
  const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
  return {
    session,
    settle,
    advance: (ms: number) => {
      clock += ms;
    },
    now: () => clock,
  };
}

test("T13 revision: a fresh session starts at zero and strictly increases across every touch and close", async () => {
  const h = setup();
  const seen: number[] = [h.session.snapshot().revision ?? -1];
  assert.equal(seen[0], 0);

  await h.session.open("push_to_talk");
  await h.settle();
  seen.push(h.session.snapshot().revision ?? -1);
  h.session.mute(true);
  seen.push(h.session.snapshot().revision ?? -1);
  h.session.mute(false);
  seen.push(h.session.snapshot().revision ?? -1);
  await h.session.close("button");
  seen.push(h.session.snapshot().revision ?? -1);
  await h.session.open("push_to_talk");
  await h.settle();
  seen.push(h.session.snapshot().revision ?? -1);

  for (let index = 1; index < seen.length; index += 1) {
    assert.ok(seen[index] > seen[index - 1], `revision ${seen[index]} after ${seen[index - 1]} at step ${index}`);
  }
});

test("T13 revision: reading a snapshot never advances it, so an unchanged view keeps its revision", async () => {
  const h = setup();
  await h.session.open("push_to_talk");
  await h.settle();
  const first = h.session.snapshot().revision;
  assert.equal(h.session.snapshot().revision, first);
  assert.equal(h.session.snapshot().revision, first);
});

test("T13 companion: the expression follows the facts, and since holds while the state is unchanged", async () => {
  const h = setup();
  const closed = h.session.snapshot().companion;
  assert.equal(closed?.state, "SLEEPING");
  const sleepingSince = closed?.since;
  h.advance(100);

  await h.session.open("push_to_talk");
  await h.settle();
  const opened = h.session.snapshot().companion;
  assert.equal(opened?.state, "READY");
  assert.equal(opened?.since, h.now(), "since is the instant the state was entered");
  assert.notEqual(opened?.since, sleepingSince, "a new state gets a new since");
  const readySince = opened!.since;

  // Clock moves on; a touch that leaves the state READY must not move `since`.
  h.advance(5_000);
  h.session.mute(false);
  const touched = h.session.snapshot();
  assert.equal(touched.companion?.state, "READY");
  assert.equal(touched.companion?.since, readySince, "the same state keeps its since");

  h.advance(1_000);
  h.session.mute(true);
  const muted = h.session.snapshot().companion;
  assert.equal(muted?.state, "MUTED");
  assert.equal(muted?.since, h.now(), "a changed state is re-stamped with the change time");

  h.session.mute(false);
  assert.equal(h.session.snapshot().companion?.state, "READY");
});

test("T13 companion: the snapshot companion agrees with companionState on the same facts", async () => {
  const h = setup();
  await h.session.open("push_to_talk");
  await h.settle();
  h.session.mute(true);
  const snap = h.session.snapshot();
  assert.deepEqual(
    { state: snap.companion?.state, reason: snap.companion?.reason },
    companionState(snap, h.now()),
    "the Host and the pure derivation never disagree at the instant of the touch",
  );
});

test("T13 companion: a time-based expression ends on its own at read time and advances the revision", async () => {
  const h = setup();
  await h.session.open("push_to_talk");
  await h.settle();
  h.session.interrupt("button");
  const interrupted = h.session.snapshot();
  assert.equal(interrupted.companion?.state, "INTERRUPTED", "a button interrupt on an idle session leaves a receipt");
  const receiptRevision = interrupted.revision ?? 0;

  h.advance(COMPANION_INTERRUPT_MS + 1);
  const later = h.session.snapshot();
  assert.equal(later.companion?.state, "READY", "the receipt window ended without any new touch");
  assert.equal(later.companion?.since, h.now(), "the new expression is stamped when it was observed");
  assert.ok((later.revision ?? 0) > receiptRevision, "a changed expression is a changed view");

  const again = h.session.snapshot().revision;
  assert.equal(h.session.snapshot().revision, again, "reading an unchanged expression does not advance the revision");
});

test("T13 companion: closing the session returns the expression to SLEEPING and keeps the revision monotonic", async () => {
  const h = setup();
  await h.session.open("push_to_talk");
  await h.settle();
  const before = h.session.snapshot().revision ?? 0;
  await h.session.close("button");
  const after = h.session.snapshot();
  assert.equal(after.companion?.state, "SLEEPING");
  assert.ok((after.revision ?? 0) > before, "the close advances the revision");
  assert.equal(after.open, false);
});
