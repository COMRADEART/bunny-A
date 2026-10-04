import { Check, Circle, ShieldCheck, Square, X } from "lucide-react";
import { useIsland } from "@/store/use-island";
import type { PublicActivity } from "@/lib/bunny-host/presentation";

export function ActivityTimeline({
  taskId,
  missionId,
  limit = 12,
}: {
  taskId?: string;
  missionId?: string;
  limit?: number;
}) {
  const store = useIsland();
  const activities = store.activities
    .filter(
      (item) => (!taskId || item.taskId === taskId) && (!missionId || item.missionId === missionId),
    )
    .slice(-limit)
    .reverse();
  return (
    <section className="safe-activity" aria-label="Host activity">
      <div className="section-heading">
        <h3 className="eyebrow">Activity</h3>
        <span className="caption">From the Host</span>
      </div>
      {store.syncStatus ? (
        <p className="activity-resync caption" role="status">
          {store.syncStatus}
        </p>
      ) : null}
      {activities.length ? (
        <ol className="activity-timeline">
          {activities.map((item) => (
            <ActivityRow key={item.id} item={item} />
          ))}
        </ol>
      ) : (
        <p className="caption">No recent activity retained.</p>
      )}
    </section>
  );
}
function ActivityRow({ item }: { item: PublicActivity }) {
  const Icon =
    item.state === "Verified"
      ? ShieldCheck
      : ["Succeeded", "Completed"].includes(item.state)
        ? Check
        : ["Failed", "Denied", "Unknown effect"].includes(item.state)
          ? X
          : ["Stopped", "Interrupted"].includes(item.state)
            ? Square
            : Circle;
  return (
    <li data-activity-id={item.id} data-activity-state={item.state}>
      <time>
        {new Date(item.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
      </time>
      <Icon size={13} className="activity-state-icon" aria-hidden="true" />
      <div>
        <strong>{item.title}</strong>
        <span className="activity-outcome">{item.state}</span>
        <p>{item.detail}</p>
      </div>
    </li>
  );
}
