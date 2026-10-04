import type { HostEvent, HostSnapshot } from "../../lib/bunny-host/contracts.ts";
import { projectEvents, type PublicActivity } from "../../lib/bunny-host/presentation.ts";

export type SnapshotPosition = {
  instanceId: string | null;
  revision: number;
  cursor: number;
  events: HostEvent[];
  activities: PublicActivity[];
};
/** Snapshot fields are canonical; only bounded journal presentation survives between reads. */
export function reconcileSnapshot(
  previous: SnapshotPosition,
  snapshot: HostSnapshot,
  after: number,
) {
  const restarted = previous.instanceId !== null && previous.instanceId !== snapshot.instanceId;
  const revision = snapshot.presentation?.revision ?? snapshot.cursor;
  if (
    !restarted &&
    previous.instanceId !== null &&
    (snapshot.cursor < previous.cursor || revision < previous.revision)
  )
    return null;
  const resumeCursor = after || previous.cursor;
  const gap =
    !restarted && resumeCursor > 0 && (snapshot.presentation?.retainedFrom ?? 0) > resumeCursor + 1;
  const incoming = [
    ...new Map(
      snapshot.events
        .filter((event) => Number.isSafeInteger(event.sequence))
        .map((event) => [event.sequence, event]),
    ).values(),
  ].sort((a, b) => a.sequence - b.sequence);
  const base = restarted || gap ? [] : previous.events;
  const map = new Map(base.map((event) => [event.sequence, event]));
  for (const event of incoming) if (!map.has(event.sequence)) map.set(event.sequence, event);
  const events = [...map.values()].sort((a, b) => a.sequence - b.sequence).slice(-200);
  const activities = [
    ...(snapshot.presentation?.activities ?? projectEvents(snapshot.events, snapshot.tasks)),
  ];
  if (!restarted && !gap)
    for (const item of previous.activities)
      if (item.source === "journal" && !activities.some((row) => row.id === item.id))
        activities.push(item);
  // Non-journal rows always come from the new canonical records, never stale UI memory.
  activities.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  const cursor =
    after > 0 && incoming.length === 500 && (incoming.at(-1)?.sequence ?? 0) < snapshot.cursor
      ? incoming.at(-1)!.sequence
      : snapshot.cursor;
  return {
    instanceId: snapshot.instanceId,
    revision,
    cursor,
    events,
    activities: activities.slice(-240),
    gap,
    restarted,
    fresh:
      previous.instanceId === null || restarted
        ? []
        : incoming.filter((event) => event.sequence > previous.cursor),
  };
}
