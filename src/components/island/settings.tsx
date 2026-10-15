import { useState, type ReactNode } from "react";
import { Bell, ChevronRight, ShieldCheck } from "lucide-react";
import { liveProviders, useIsland } from "@/store/use-island";
import { NAMES, ProviderStatus } from "./ui";
import { Pairing } from "./phone";
import { MissionSettings } from "./mission";
import { AiModelsSettings } from "./ai-models";
import { NotificationFrequencySetting, VoicePersonalization } from "./voice-personalization";
import { ThemeGallery } from "./theme-gallery";

const GROUPS = [
  "General",
  "Providers",
  "AI & Models",
  "Privacy and permissions",
  "Workspace",
  "Devices",
  "Notifications",
  "Voice",
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
  const [group, setGroup] = useState<Group>(store.accountFocus ? "AI & Models" : "Appearance");
  const [notification, setNotification] = useState("");
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Settings</p>
          <h1>Make Bunny feel like yours.</h1>
        </div>
      </div>
      {store.host !== "online" &&
      typeof window !== "undefined" &&
      ["127.0.0.1", "localhost"].includes(window.location.hostname) ? (
        <div className="offline-note">
          <p>
            A pairing from an earlier test can prevent this browser from connecting to the
            workstation.
          </p>
          <button className="button" onClick={() => void store.clearStalePairing()}>
            Clear stale browser pairing
          </button>
        </div>
      ) : null}
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
            <ThemeGallery />
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
          ) : group === "AI & Models" ? (
            <AiModelsSettings />
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
          ) : group === "Voice" ? (
            <VoicePersonalization />
          ) : group === "Notifications" ? (
            <>
              <NotificationFrequencySetting />
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
              <Setting
                label="Design preview"
                detail="A labelled preview of the character and glass system with fixture data. Not live Host data."
              >
                <button className="btn secondary" onClick={() => store.setSheet("design-preview")}>
                  Open design preview
                </button>
              </Setting>
            </>
          )}
        </section>
      </div>
    </>
  );
}
