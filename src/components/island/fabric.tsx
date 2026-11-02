import { useIsland } from "@/store/use-island";
import { Empty } from "./ui";
import { Telemetry } from "./telemetry";
import { Proactive } from "./proactive";
import { shortId } from "./remote-view-model";
import {
  COORDINATION_NOT_CONFIGURED, fabricDeviceRows, fabricEvents, fabricOverview, fabricProfiles, fabricUsageRows,
} from "./fabric-model";
import "./fabric.css";

const when = (ms: number | null | undefined) => (ms ? new Date(ms).toLocaleString() : "—");
const short = (value: string | null | undefined, size = 8) => (value ? shortId(value).slice(0, size) : "—");

/**
 * M-E4 Server Control / Device Fabric — a workstation management surface over THIS Host's real snapshot. Every
 * section renders rows the Host actually serves today; coordinator work (leases/epochs/topology) shows its one
 * truthful not-configured state until the owner-gated integration slice lands. Mutation stays on the surfaces that
 * own it (Devices); this view is read-only by design.
 */
export function FabricWorkspace({ now, freshness }: { now: number; freshness: string }) {
  const store = useIsland();
  const viewer = store.viewer?.kind === "device" ? "device" : "workstation";
  if (viewer === "device") {
    return (
      <div className="fabric">
        <Empty title="Server Control is a workstation surface." detail="A paired phone reads its devices page only. Controls and decisions live on your Bunny-A Host." />
      </div>
    );
  }
  const overview = fabricOverview({
    hostIdentity: store.hostIdentity,
    tasks: store.tasks,
    agents: store.agents ?? undefined,
    devices: store.devices,
    projects: store.projects,
  });
  const devices = fabricDeviceRows(store.devices, now);
  const events = fabricEvents(store.events);
  const usage = fabricUsageRows(store.sessionLedger);
  const profiles = fabricProfiles(store.performance);

  return (
    <div className="fabric">
      <div className="t8-surface fabric-head">
        <h2>Server Control</h2>
        <p>
          Management view over this workstation's Bunny-A Host — not a separate deployed server. Everything below
          comes from the Host's own snapshot ({freshness}).
        </p>
        <dl className="fabric-facts">
          <div>
            <dt>Host</dt>
            <dd>{short(overview.hostId, 12)}</dd>
          </div>
          <div>
            <dt>Epoch</dt>
            <dd>{short(overview.epoch, 12)}</dd>
          </div>
          <div>
            <dt>Started</dt>
            <dd>{when(overview.startedAt)}</dd>
          </div>
          <div>
            <dt>Work in progress</dt>
            <dd>
              {overview.tasks} tasks · {overview.agents} agents · {overview.devices} devices · {overview.projects} projects
            </dd>
          </div>
        </dl>
      </div>

      <section className="t8-surface" aria-labelledby="fabric-fabric">
        <h3 id="fabric-fabric">Device Fabric</h3>
        {devices.length === 0 ? (
          <Empty title="No devices are registered." detail="Pairing happens on the Devices page." />
        ) : (
          <table className="fabric-table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">ID</th>
                <th scope="col">Paired</th>
                <th scope="col">Last seen</th>
                <th scope="col">State</th>
              </tr>
            </thead>
            <tbody>
              {devices.map((row) => (
                <tr key={row.id}>
                  <td>{row.name}</td>
                  <td className="mono">{short(row.id)}</td>
                  <td>{when(row.createdAt)}</td>
                  <td>{when(row.lastSeenAt)}</td>
                  <td data-state={row.state}>{row.state}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="fabric-note">
          <button className="btn secondary" type="button" onClick={() => store.setSheet("devices")}>
            Pair or revoke on the Devices page
          </button>
          <small>Device actions stay on the Devices page; this view reads the registry only.</small>
        </p>
      </section>

      <section className="t8-surface" aria-labelledby="fabric-coordination">
        <h3 id="fabric-coordination">Coordinator</h3>
        <p className="fabric-unavailable" role="note">
          {COORDINATION_NOT_CONFIGURED}
        </p>
      </section>

      <section className="t8-surface" aria-labelledby="fabric-jobs">
        <h3 id="fabric-jobs">Schedules &amp; Jobs</h3>
        <Proactive />
      </section>

      <section className="t8-surface" aria-labelledby="fabric-routing">
        <h3 id="fabric-routing">Routing &amp; Providers</h3>
        {profiles.length === 0 ? (
          <Empty title="No performance profiles yet." detail="Profiles appear as real tasks complete." />
        ) : (
          <table className="fabric-table">
            <thead>
              <tr>
                <th scope="col">Provider</th>
                <th scope="col">Task type</th>
                <th scope="col">Tasks</th>
                <th scope="col">Completed</th>
                <th scope="col">Verified</th>
                <th scope="col">Routable</th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((row) => (
                <tr key={`${row.provider}/${row.taskType}`}>
                  <td>{row.provider}</td>
                  <td>{row.taskType}</td>
                  <td>{row.count}</td>
                  <td>{row.completed}</td>
                  <td>{row.verified}</td>
                  <td>{row.sufficient ? "yes" : "not yet"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <h4>Usage ledger (known costs only)</h4>
        {usage.length === 0 ? (
          <p className="fabric-empty">No ledger rows in this session yet. Unknown costs stay unknown here.</p>
        ) : (
          <table className="fabric-table">
            <thead>
              <tr>
                <th scope="col">Provider</th>
                <th scope="col">Model</th>
                <th scope="col">Outcome</th>
                <th scope="col">Tokens</th>
                <th scope="col">Cost</th>
              </tr>
            </thead>
            <tbody>
              {usage.map((row, index) => (
                <tr key={index}>
                  <td>{row.provider}</td>
                  <td>{row.model ?? "provider default"}</td>
                  <td>{row.outcome}</td>
                  <td>
                    {row.input ?? "?"} / {row.output ?? "?"}
                  </td>
                  <td>{row.costKnown ? `US$${row.cost}` : "unknown"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="fabric-note">
          <button className="btn secondary" type="button" onClick={() => store.setSheet("provider")}>
            Model, routing and privacy controls
          </button>
          <small>Those live on the Models page; capabilities there are shown verified, reported or unavailable.</small>
        </p>
      </section>

      <section className="t8-surface" aria-labelledby="fabric-telemetry">
        <h3 id="fabric-telemetry">Events &amp; Telemetry</h3>
        <Telemetry />
        {events.length === 0 ? (
          <Empty title="No events yet." />
        ) : (
          <table className="fabric-table">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">When</th>
                <th scope="col">Type</th>
                <th scope="col">Detail</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.sequence}>
                  <td className="mono">{event.sequence}</td>
                  <td>{when(event.at)}</td>
                  <td>{event.type}</td>
                  <td className="fabric-detail">{event.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="t8-surface" aria-labelledby="fabric-security">
        <h3 id="fabric-security">Security</h3>
        <p>
          This window holds full workstation authority. {devices.filter((row) => row.state === "revoked").length}{" "}
          device(s) are revoked;{" "}
          {devices.filter((row) => row.state === "active" || row.state === "idle").length} are trusted.
          {store.remoteConfigured ? " A remote dashboard gateway is configured." : " No remote dashboard gateway is configured."}{" "}
          Credentials themselves are never shown anywhere; sensitive approvals are decided on the Approval inbox,
          always by a real action.
        </p>
      </section>

      <section className="t8-surface" aria-labelledby="fabric-settings">
        <h3 id="fabric-settings">Settings</h3>
        <p className="fabric-empty">
          No server-specific settings exist yet. Server Control gains settings only with the owner-approved
          coordinator integration gate.
        </p>
      </section>
    </div>
  );
}