import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalInferenceQueue } from "./local-inference.ts";

const tick = () => new Promise((r) => setImmediate(r));

/** Enqueues `id` and records the order in which requests are admitted. */
function track(q: LocalInferenceQueue, order: string[]) {
  const releases = new Map<string, () => void>();
  const add = (id: string, cls: "interactive" | "background", signal?: AbortSignal) =>
    q.acquire(id, cls, signal).then((release) => { order.push(id); releases.set(id, release); });
  const done = async (id: string) => { releases.get(id)!(); await tick(); };
  return { add, done };
}

test("P4-2 a waiting voice turn is admitted before waiting agent work, and never pre-empts the running one", async () => {
  const q = new LocalInferenceQueue(1);
  const order: string[] = [];
  const { add, done } = track(q, order);
  void add("bg1", "background");
  void add("bg2", "background");
  void add("bg3", "background");
  void add("voice", "interactive");
  await tick();
  assert.deepEqual(order, ["bg1"], "one slot: only the first request runs; the voice turn waits, nothing is cancelled");
  assert.equal(q.isWaiting("voice"), true);
  assert.equal(q.stats().running, 1);
  await done("bg1");
  assert.deepEqual(order, ["bg1", "voice"], "the voice turn goes next, ahead of bg2 and bg3");
  assert.equal(q.isWaiting("voice"), false);
  await done("voice");
  await done("bg2");
  assert.deepEqual(order, ["bg1", "voice", "bg2", "bg3"], "background stays FIFO");
  const voice = q.recent().find((a) => a.id === "voice")!;
  assert.equal(voice.aheadAtEnqueue, 3);
  assert.equal(voice.cls, "interactive");
});

test("P4-2 background work is not starved: after 3 voice admissions in a row the oldest agent request goes next", async () => {
  const q = new LocalInferenceQueue(1, 3);
  const order: string[] = [];
  const { add, done } = track(q, order);
  void add("bg0", "background");
  await tick();
  void add("bg1", "background");
  for (let i = 1; i <= 5; i++) void add(`v${i}`, "interactive");
  await tick();
  for (const id of ["bg0", "v1", "v2", "v3", "bg1", "v4"]) await done(id);
  assert.deepEqual(order, ["bg0", "v1", "v2", "v3", "bg1", "v4", "v5"]);
  assert.equal(q.stats().admitted.starvationOverrides, 1);
  assert.equal(q.recent().find((a) => a.id === "bg1")!.overrode, true);
});

test("P4-2 a request stopped while queued leaves the queue and never runs; release is idempotent; slots bound concurrency", async () => {
  const q = new LocalInferenceQueue(2);
  const order: string[] = [];
  const { add, done } = track(q, order);
  void add("a", "background");
  void add("b", "background");
  const controller = new AbortController();
  const stopped = add("c", "interactive", controller.signal);
  void add("d", "background");
  await tick();
  assert.deepEqual(order, ["a", "b"], "two slots, two running");
  controller.abort();
  await assert.rejects(stopped, /Stopped before local inference/);
  assert.equal(q.isWaiting("c"), false);
  await done("a");
  await done("a"); // a second release must not free a second slot
  assert.deepEqual(order, ["a", "b", "d"]);
  assert.equal(q.stats().running, 2);
  await assert.rejects(q.acquire("e", "background", AbortSignal.abort()), /Stopped/);
  assert.equal(q.stats().waiting.background, 0);
});
