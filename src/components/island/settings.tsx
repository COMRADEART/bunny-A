import { useState, type ReactNode } from "react";
import { Bell, ChevronRight, ShieldCheck } from "lucide-react";
import { liveProviders, useIsland, type Appearance } from "@/store/use-island";
import { NAMES, ProviderStatus } from "./ui";
import { Pairing } from "./phone";
import { MissionSettings } from "./mission";

const GROUPS = [
  "General",
  "Providers",
  "Models",
  "Privacy and permissions",
  "Workspace",
  "Devices",
  "Notifications",
  "Runtime diagnostics",
  "Appearance",
  "About Bunny",
] as const;
type Group = (typeof GROUPS)[number];
function Setting({
  label,
  detail,
  children,
}: {
  label: string;
  detail?: string;
  children: ReactNode;
}) {
  return (
    <div className="setting-row">
      <div>
        <strong>{label}</strong>
        {detail ? <p>{detail}</p> : null}
      </div>
      {children}
    </div>
  );
}
export function Settings() {
  const store = useIsland();
  const [group, setGroup] = useState<Group>("Appearance");
  const [notification, setNotification] = useState("");
  const choice = <K extends keyof Appearance>(
    key: K,
    options: { value: Appearance[K]; label: string }[],
  ) => (
    <select
      aria-label={
        key === "size"
          ? "Island size"
          : key === "position"
            ? "Island position"
            : key === "idle"
              ? "Idle content"
              : key === "glass"
                ? "Glass strength"
                : key === "collapse"
                  ? "Auto-collapse"
                  : key === "motion"
                    ? "Motion"
                    : "Theme"
      }
      value={String(store.appearance[key])}
      onChange={(e) =>
        store.setAppearance({
          [key]: key === "collapse" ? Number(e.target.value) : e.target.value,
        } as Partial<Appearance>)
      }
    >
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Settings</p>
          <h1>Make Bunny feel like yours.</h1>
        </div>
      </div>
      <div className="settings-layout">
        <nav className="settings-nav glass" aria-label="Settings groups">
          {GROUPS.map((g) => (
            <button
              key={g}
              onClick={() => setGroup(g)}
              aria-current={g === group ? "page" : undefined}
            >
              {g}
              <ChevronRight size={14} />
            </button>
          ))}
        </nav>
        <section className="settings-panel glass" key={group}>
          <h2>{group}</h2>
          {group === "Appearance" ? (
            <>
              <p className="caption">
                Preferences for this browser. Native Island preferences are available from its menu.
              </p>
              <Setting label="Island size">
                {choice("size", [
                  { value: "compact", label: "Compact" },
                  { value: "normal", label: "Normal" },
                  { value: "detailed", label: "Detailed" },
                ])}
              </Setting>
              <Setting label="Island position">
                {choice("position", [
                  { value: "left", label: "Top left" },
                  { value: "center", label: "Top center" },
                  { value: "right", label: "Top right" },
                ])}
              </Setting>
              <Setting label="Idle content">
                {choice("idle", [
                  { value: "providers", label: "Provider usage" },
                  { value: "temperatures", label: "Temperatures" },
                  { value: "tasks", label: "Active tasks" },
                  { value: "clock", label: "Clock" },
                  { value: "minimal", label: "Minimal" },
                  { value: "mixed", label: "Mixed · providers + system" },
                ])}
              </Setting>
              <Setting label="Glass strength">
                {choice("glass", [
                  { value: "low", label: "Low" },
                  { value: "medium", label: "Medium" },
                  { value: "high", label: "High" },
                ])}
              </Setting>
              <Setting label="Auto-collapse" detail="After a finished task">
                {choice("collapse", [
                  { value: 5, label: "5 sec" },
                  { value: 10, label: "10 sec" },
                  { value: 30, label: "30 sec" },
                  { value: 0, label: "Never" },
                ])}
              </Setting>
              <Setting label="Motion" detail="OS reduced-motion preferences always take priority.">
                {choice("motion", [
                  { value: "full", label: "Full" },
                  { value: "reduced", label: "Reduced" },
                  { value: "off", label: "Off" },
                ])}
              </Setting>
              <Setting label="Theme">
                {choice("theme", [
                  { value: "system", label: "System" },
                  { value: "dark", label: "Dark" },
                  { value: "light", label: "Light" },
                ])}
              </Setting>
              <div className="primary-settings">
                <strong>Primary providers</strong>
                <p className="caption">Choose up to three for the idle Island.</p>
                {liveProviders(store).map((p) => (
                  <label className="provider-checkbox" key={p.id}>
                    <input
                      type="checkbox"
                      checked={store.appearance.primary.includes(p.id)}
                      disabled={
                        !store.appearance.primary.includes(p.id) &&
                        store.appearance.primary.length >= 3
                      }
                      onChange={(e) =>
                        store.setAppearance({
                          primary: e.target.checked
                            ? [...store.appearance.primary, p.id]
                            : store.appearance.primary.filter((id) => id !== p.id),
                        })
                      }
                    />
                    <span>{NAMES[p.id]}</span>
                    <ProviderStatus provider={p} />
                  </label>
                ))}
              </div>
            </>
          ) : group === "General" ? (
            <>
              <Setting
                label="Startup"
                detail="Windows login starts the Host and the compact native Island."
              >
                <span className="caption">Dashboard stays closed</span>
              </Setting>
              <Setting
                label="Task ownership"
                detail="Closing a UI leaves approved sessions with Bunny Host."
              >
                <ShieldCheck size={18} />
              </Setting>
              <Setting
                label="Offline drafts"
                detail="Saved on this device. Review each draft before routing."
              >
                <span className="caption">{store.drafts.length} saved</span>
              </Setting>
            </>
          ) : group === "Providers" ? (
            <>
              {liveProviders(store).map((p) => (
                <Setting key={p.id} label={NAMES[p.id]} detail={p.detail}>
                  <ProviderStatus provider={p} />
                </Setting>
              ))}
            </>
          ) : group === "Models" ? (
            <>
              <Setting
                label="Approval before launch"
                detail="Every new route waits for an explicit Run action."
              >
                <span className="caption">Required by Host</span>
              </Setting>
              <Setting label="Next Task depth">
                <select
                  aria-label="Default task depth"
                  value={store.mode}
                  onChange={(e) => store.setMode(e.target.value as "fast" | "balanced" | "deep")}
                >
                  <option value="fast">Fast</option>
                  <option value="balanced">Balanced</option>
                  <option value="deep">Deep</option>
                </select>
              </Setting>
              <Setting label="Local only" detail="A hard routing constraint for your next task.">
                <button
                  className="switch"
                  role="switch"
                  aria-checked={store.localOnly}
                  aria-label="Local-only routing"
                  onClick={() => store.setLocalOnly(!store.localOnly)}
                >
                  <span />
                </button>
              </Setting>
            </>
          ) : group === "Privacy and permissions" ? (
            <MissionSettings />
          ) : group === "Workspace" ? (
            <>
              <p className="caption">Project folders and preferences come from the Host.</p>
              {store.projects.map((p) => (
                <Setting key={p.id} label={p.name} detail={p.path}>
                  <span className="caption">Router selects per Task</span>
                </Setting>
              ))}
              <button className="btn secondary" onClick={() => store.setSheet("project")}>
                Manage projects <ChevronRight size={14} />
              </button>
            </>
          ) : group === "Devices" ? (
            <Pairing compact />
          ) : group === "Notifications" ? (
            <>
              <Setting
                label="Browser notifications"
                detail="Foreground session events; background phone push is unavailable."
              >
                <button
                  className="btn secondary"
                  onClick={async () => {
                    if (!("Notification" in window)) {
                      setNotification("Unavailable in this browser.");
                      return;
                    }
                    setNotification(`Permission: ${await Notification.requestPermission()}`);
                  }}
                >
                  <Bell size={14} />
                  Enable
                </button>
              </Setting>
              <p className="caption" role="status">
                {notification}
              </p>
              <button className="btn secondary" onClick={() => store.setSheet("extensions")}>
                View notifications <ChevronRight size={14} />
              </button>
            </>
          ) : group === "Runtime diagnostics" ? (
            <>
              <Setting
                label="CPU warning"
                detail="Shown only when a temperature sensor is available."
              >
                <label className="threshold-input">
                  <input
                    aria-label="CPU warning temperature"
                    type="number"
                    min={40}
                    max={110}
                    value={store.cpuWarn}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (n >= 40 && n <= 110) store.setCpuWarn(n);
                    }}
                  />
                  °C
                </label>
              </Setting>
              <Setting label="GPU warning">
                <label className="threshold-input">
                  <input
                    aria-label="GPU warning temperature"
                    type="number"
                    min={40}
                    max={110}
                    value={store.gpuWarn}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (n >= 40 && n <= 110) store.setGpuWarn(n);
                    }}
                  />
                  °C
                </label>
              </Setting>
              <Setting
                label="Automatic thermal Stop"
                detail="Warnings require your explicit choice."
              >
                <span className="caption">Off</span>
              </Setting>
            </>
          ) : (
            <>
              <Setting
                label="Terminal attachment"
                detail="Current executors do not expose a supported attachment path."
              >
                <span className="caption">Unavailable</span>
              </Setting>
              <Setting
                label="Sleep detection"
                detail="Connection loss cannot establish that a workstation is sleeping."
              >
                <span className="caption">Unavailable</span>
              </Setting>
              <Setting
                label="Provider recovery"
                detail="Authentication, process-tree isolation, and persisted sessions remain Host managed."
              >
                <ShieldCheck size={18} />
              </Setting>
              <Setting
                label="Installed Host"
                detail={
                  store.release
                    ? `${store.release.release} · ${store.release.sourceCommit.slice(0, 12)}`
                    : "Development Host or build identity unavailable"
                }
              >
                <span className="caption">{store.release?.version ?? "Unavailable"}</span>
              </Setting>
              <Setting
                label="Dashboard build"
                detail={
                  store.release?.dashboard
                    ? `Source ${store.release.dashboard.sourceCommit.slice(0, 12)} · ${store.release.dashboard.assets} packaged assets`
                    : "Dashboard build identity unavailable"
                }
              >
                <span className="caption">
                  {store.release?.dashboard?.builtAt
                    ? new Date(store.release.dashboard.builtAt).toLocaleDateString()
                    : "Unavailable"}
                </span>
              </Setting>
            </>
          )}
        </section>
      </div>
    </>
  );
}
