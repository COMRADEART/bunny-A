import { useEffect, useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useIsland } from "@/store/use-island";
import { UI_THEMES } from "@/lib/bunny-host/ui-theme";
import { WEAPON_LABEL, type PersonalAgentView, type SlotId } from "@/lib/bunny-host/personal-agents";
import type { ConversationIdentity } from "@/lib/bunny-host/personal-agent-context";
import type { PhoneRoute } from "./phone-model";
import type { MissionView } from "@/lib/bunny-missions/types";
import {
  CORE_WIDGET_IDS, LIBRARY_WIDGET_IDS, WIDGET_DENSITIES, WIDGET_EDGES, WIDGET_GAPS,
  WIDGET_LAYOUTS, WIDGET_MOTIONS, WIDGET_SIZES, drawerEdgeFor, moveItem, reorderItem, resizeItem,
  setItemHidden, snapResize, visibleItems, widgetDefinition, widgetMayRender,
  type CoreWidgetId, type WidgetEdge, type WidgetItem, type WidgetLayout, type WidgetPreference, type WidgetSize,
} from "@/lib/bunny-host/widgets";
import {
  agentWidget, lotusWidget, missionWidget, notchWidgetLine, reconciliationWidget, usageWidget, voiceWidget, widgetViewer,
  type MissionFact,
} from "./widget-model";
import { useReconcileItems } from "./reconciliation";
import { WeaponCharacter, usePrefersReducedMotion } from "./characters";
import { appearanceFor } from "./character-style-model";
import { useShownTheme, ThemedDialogContent } from "./theme";
import "./widgets.css";

const LAYOUT_LABEL: Record<WidgetLayout, string> = { board: "Board", sidebar: "Sidebar", drawer: "Drawer" };
const SIZE_LABEL: Record<WidgetSize, string> = { compact: "Compact", standard: "Standard", wide: "Wide", tall: "Tall" };

function missionFacts(missions: readonly MissionView[]): MissionFact[] {
  return missions.map((mission) => ({
    id: mission.id,
    title: mission.title,
    projectId: mission.projectId,
    state: mission.state,
    updatedAt: mission.updatedAt,
    failure: !!mission.failure,
    steps: mission.steps.map((step) => ({
      id: step.id,
      role: step.role,
      state: step.state,
      dependsOn: step.dependsOn,
      verified: step.result?.verified ?? null,
      reconcile: !!step.reconciliation?.required,
    })),
  }));
}

type Openers = {
  mission: (id: string) => void;
  agent: (slot: number) => void;
  usage: () => void;
  memory: () => void;
  reconcile: () => void;
};

/**
 * The widget studio. Layout edits stay in a draft until Apply, so the board you see is the preview.
 * Opening a widget, choosing a speaker and the microphone call the Host directly: those are not layout preferences.
 */
export function WidgetSurface({
  mode, page, openers, surface = "desktop",
}: {
  mode: WidgetLayout;
  page?: string;
  openers: Openers;
  surface?: "desktop" | "phone";
}) {
  const store = useIsland();
  const saved = store.shownWidgets();
  const [draft, setDraft] = useState<WidgetPreference | null>(null);
  const [selected, setSelected] = useState<CoreWidgetId>("mission");
  const [studio, setStudio] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // The Host revision the draft was copied from; Apply sends it so a newer layout from another window is never overwritten.
  const draftRevision = useRef<number | undefined>(undefined);
  const preference = draft ?? saved;
  // Layout edits only on Settings — everywhere else the board is read-only Host truth.
  const editable = page === "settings";
  // An unapplied draft belongs to Settings; leaving the page discards it so no other page shows a layout that was never saved.
  useEffect(() => {
    if (editable) return;
    setDraft(null);
    setStudio(false);
  }, [editable]);
  const review = page === "approvals" || page === "decision";
  const showDrawer = mode === "drawer" && preference.drawerOpen && !review;
  if (mode === "board" && (page === "design-preview" || review)) return null;
  if (mode === "sidebar" && page === "design-preview") return null;
  return (
    <div
      className={mode === "drawer" ? "wd-drawer-anchor" : "wd-root"}
      data-surface={surface}
      data-widget-layout={surface === "phone" ? "board" : mode}
      data-widget-density={preference.density}
      data-widget-motion={preference.motion}
      data-open={mode === "drawer" ? showDrawer : undefined}
      style={{ ["--wd-gap" as string]: `${preference.gap}px`, ["--wd-side" as string]: `${preference.sidebarWidth}px` }}
    >
      {mode === "drawer" && (
        <button type="button" className="wd-drawer-toggle" aria-expanded={showDrawer} onClick={() => void store.setWidgets({ drawerOpen: !saved.drawerOpen }, setNote)}>
          {showDrawer ? "Close widgets" : "Open widgets"}
        </button>
      )}
      {mode === "drawer" && review && (
        <p className="wd-note" role="status">The widget drawer stays closed on this review so the uncertain outcome remains visible. Leave this page to open it.</p>
      )}
      {mode === "sidebar" && editable && (
        <button type="button" className="wd-text" aria-expanded={!preference.sidebarCollapsed} onClick={() => patch({ sidebarCollapsed: !preference.sidebarCollapsed })}>
          {preference.sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        </button>
      )}
      {(mode !== "drawer" || showDrawer) && !(mode === "sidebar" && preference.sidebarCollapsed) && (
        <WidgetStudio
          preference={preference}
          selected={selected}
          studio={editable && studio}
          editable={editable}
          note={note}
          edge={drawerEdgeFor(preference.notchEdge)}
          surface={surface}
          onSelect={setSelected}
          onPatch={patch}
          onOpenStudio={() => { draftRevision.current = store.widgets?.revision; setDraft(saved); setStudio(true); }}
          onApply={() => {
            if (!draft) return;
            void store.setWidgets(draft, setNote, draftRevision.current).then((ok) => {
              if (ok) { setDraft(null); setStudio(false); return; }
              // Refused (usually stale): the note says why; Apply again now saves this draft over the newer layout on purpose.
              draftRevision.current = useIsland.getState().widgets?.revision;
            });
          }}
          onCancel={() => { setDraft(null); setNote(null); setStudio(false); }}
          onReset={() => { setDraft(null); setStudio(false); void store.resetWidgets(setNote); }}
          onEscape={mode === "drawer" && showDrawer ? () => { setDraft((current) => current ? { ...current, drawerOpen: false } : null); void store.setWidgets({ drawerOpen: false }, setNote); } : undefined}
          openers={openers}
        />
      )}
    </div>
  );

  function patch(part: Partial<WidgetPreference>) {
    if (!editable) return;
    const base = draft ?? saved;
    if (!draft) draftRevision.current = store.widgets?.revision;
    setDraft({ ...base, ...part, focus: part.focus ?? base.focus, items: part.items ?? base.items });
    setStudio(true);
  }
}

function WidgetStudio({
  preference, selected, studio, editable, note, edge, surface, onSelect, onPatch, onOpenStudio, onApply, onCancel, onReset, onEscape, openers,
}: {
  preference: WidgetPreference;
  selected: CoreWidgetId;
  studio: boolean;
  editable: boolean;
  note: string | null;
  edge: WidgetEdge;
  surface: "desktop" | "phone";
  onSelect: (id: CoreWidgetId) => void;
  onPatch: (part: Partial<WidgetPreference>) => void;
  onOpenStudio: () => void;
  onApply: () => void;
  onCancel: () => void;
  onReset: () => void;
  onEscape?: () => void;
  openers: Openers;
}) {
  const items = visibleItems(preference);
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!onEscape) return;
    const onKey = (event: KeyboardEvent) => {
      // Only from inside the drawer: Escape in the composer or another dialog belongs to that control.
      if (event.key !== "Escape" || event.defaultPrevented || !panelRef.current?.contains(document.activeElement)) return;
      event.preventDefault();
      onEscape();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onEscape]);
  return (
    <div className="wd-studio" data-edge={edge} ref={panelRef}>
      <div className="wd-grid" role="list" aria-label="Widgets">
        {items.map((item) => (
          <WidgetCard key={item.id} item={item} selected={editable && selected === item.id} editable={editable} preference={preference} onSelect={() => onSelect(item.id)} onPatch={onPatch} openers={openers} />
        ))}
        {items.length === 0 && <p className="wd-note">Every widget is hidden. Restore them from the inspector.</p>}
      </div>
      {editable ? (
        <div className="wd-inspector-wrap">
          {studio && surface === "phone" ? (
            <Dialog.Root open onOpenChange={(open) => { if (!open) onCancel(); }}>
              <ThemedDialogContent className="wd-sheet" aria-describedby="wd-inspector-title">
                <Dialog.Title className="wd-sr">Widget Inspector</Dialog.Title>
                <Inspector preference={preference} selected={selected} note={note} onSelect={onSelect} onPatch={onPatch} onApply={onApply} onCancel={onCancel} onReset={onReset} />
              </ThemedDialogContent>
            </Dialog.Root>
          ) : studio ? (
            <Inspector preference={preference} selected={selected} note={note} onSelect={onSelect} onPatch={onPatch} onApply={onApply} onCancel={onCancel} onReset={onReset} />
          ) : (
            <button type="button" className="wd-text" onClick={onOpenStudio}>Customize widgets</button>
          )}
          {surface === "desktop" && <NotchPreview preference={preference} />}
        </div>
      ) : null}
    </div>
  );
}

function WidgetCard({
  item, selected, editable, preference, onSelect, onPatch, openers,
}: {
  item: WidgetItem;
  selected: boolean;
  editable: boolean;
  preference: WidgetPreference;
  onSelect: () => void;
  onPatch: (part: Partial<WidgetPreference>) => void;
  openers: Openers;
}) {
  const definition = widgetDefinition(item.id);
  const drag = useRef<{ x: number; y: number; size: WidgetSize } | null>(null);
  const move = (direction: -1 | 1) => onPatch({ items: moveItem(preference, item.id, direction).items });
  const onDrop = (event: DragEvent) => {
    if (!editable) return;
    event.preventDefault();
    const from = event.dataTransfer.getData("text/plain");
    if (widgetMayRender(from)) onPatch({ items: reorderItem(preference, from, item.id).items });
  };
  const onPointerDown = (event: ReactPointerEvent) => {
    if (!editable) return;
    drag.current = { x: event.clientX, y: event.clientY, size: item.size };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };
  const onPointerUp = (event: ReactPointerEvent) => {
    const start = drag.current;
    drag.current = null;
    if (!editable || !start || !definition) return;
    const size = snapResize(start.size, event.clientX - start.x, event.clientY - start.y, definition.sizes);
    if (size !== item.size) onPatch({ items: resizeItem(preference, item.id, size).items });
  };
  return (
    <section
      className="wd-card"
      role="listitem"
      data-size={item.size}
      data-selected={selected}
      aria-label={`${definition?.name ?? item.id} widget`}
      tabIndex={0}
      onKeyDown={(event) => {
        if (!editable || !event.altKey) return;
        if (event.key === "ArrowUp") { event.preventDefault(); move(-1); }
        if (event.key === "ArrowDown") { event.preventDefault(); move(1); }
      }}
      onDragOver={editable ? (event) => event.preventDefault() : undefined}
      onDrop={onDrop}
    >
      <header className="wd-titlebar">
        <div>
          <p className="wd-kicker">{definition?.name}</p>
          <h3 className="wd-title">{definition?.description}</h3>
        </div>
        {editable ? (
          <div className="wd-actions">
            <button type="button" className="wd-icon" draggable aria-label={`Drag to reorder ${definition?.name}`} onDragStart={(event) => { event.dataTransfer.setData("text/plain", item.id); event.dataTransfer.effectAllowed = "move"; }}>Move</button>
            <button type="button" className="wd-icon" onClick={onSelect} aria-pressed={selected}>Customize</button>
            <button type="button" className="wd-icon" onClick={() => move(-1)} aria-label={`Move ${definition?.name} earlier`}>Earlier</button>
            <button type="button" className="wd-icon" onClick={() => move(1)} aria-label={`Move ${definition?.name} later`}>Later</button>
            <button type="button" className="wd-icon" onClick={() => onPatch({ items: setItemHidden(preference, item.id, true).items })} aria-label={`Hide ${definition?.name}`}>Hide</button>
          </div>
        ) : null}
      </header>
      <WidgetBody id={item.id} preference={preference} openers={openers} />
      {editable ? (
        <button type="button" className="wd-resize" aria-label={`Resize ${definition?.name}. Drag to snap to the next size.`} onPointerDown={onPointerDown} onPointerUp={onPointerUp}>{SIZE_LABEL[item.size]}</button>
      ) : null}
    </section>
  );
}

function WidgetBody({ id, preference, openers }: { id: CoreWidgetId; preference: WidgetPreference; openers: Openers }) {
  const store = useIsland();
  const reduced = usePrefersReducedMotion();
  const online = store.host === "online";
  const viewer = widgetViewer(store.viewer);
  const slots = store.personalAgents?.slots ?? [];
  if (id === "mission") {
    const model = missionWidget({
      online,
      missions: missionFacts(store.missions?.missions ?? []),
      slots: slots.map((slot) => ({ slot: slot.slot, name: slot.displayName, missionId: slot.agent?.missionId ?? null })),
      focus: preference.focus,
    });
    return (
      <div className="wd-body">
        <p>{model.note}</p>
        {model.mission && (
          <button type="button" className="wd-link" onClick={() => openers.mission(model.mission!.id)}>
            <strong>{model.mission.title}</strong>
            <span>{model.mission.owner ? `Owned by ${model.mission.owner}` : "No Personal Agent owns this Mission"}</span>
            <span>{model.mission.active ? `Active step: ${model.mission.active}` : "No step is running"}</span>
            <span>{model.mission.verified} verified · {model.mission.pending} pending · {model.mission.waiting} waiting · {model.mission.failed} failed · {model.mission.dependencies} dependencies</span>
            {model.mission.failure && <span className="wd-bad">A step failed. The Host recorded the failure.</span>}
            {model.mission.reconcile && <span className="wd-bad">A step needs reconciliation.</span>}
          </button>
        )}
      </div>
    );
  }
  if (id === "agents") {
    const model = agentWidget(slots, online);
    return (
      <ul className="wd-agents">
        {model.rows.length === 0 && <li>The Host has not reported the four Personal Agents.</li>}
        {model.rows.map((row) => {
          const slot = slots.find((item) => item.slot === row.slot) as PersonalAgentView | undefined;
          return (
            <li key={row.slot}>
              <button type="button" className="wd-agent" onClick={() => openers.agent(row.slot)}>
                {slot && <WeaponCharacter weapon={row.weapon} state={online ? slot.presentation.state : "OFFLINE"} slot={slot.slot} size="compact" reduced={reduced} label={row.name} displayName={row.name} basis={slot.presentation.basis} appearance={appearanceFor(store.characterAppearance, slot.slot)} />}
                <span><strong>{row.name}</strong><small>{WEAPON_LABEL[row.weapon]} · {row.status}</small>{row.mission && <small>{row.mission}</small>}{row.activity && <small>{row.activity}</small>}</span>
              </button>
            </li>
          );
        })}
      </ul>
    );
  }
  if (id === "usage") {
    const model = usageWidget(store.sessionLedger, viewer);
    return (
      <div className="wd-body">
        <p>{model.note}</p>
        {model.state === "ready" && (
          <button type="button" className="wd-link" onClick={openers.usage}>
            <span>Session {model.sessionId}</span>
            <span>Reservations {model.reserved}</span>
            <span>Observed cost {model.cost}</span>
            {model.local && <span>{model.local}</span>}
            <span>{model.limits}</span>
            <span>Routes {model.routes}</span>
          </button>
        )}
      </div>
    );
  }
  if (id === "lotus") {
    const slotId = preference.focus.slot ?? (typeof store.personalAgentContext?.foreground === "number" ? store.personalAgentContext.foreground : null);
    const slot = slots.find((item) => item.slot === slotId) ?? slots[0];
    const context = store.personalAgentContext?.slots.find((item) => item.slot === slot?.slot);
    const projectId = slot?.agent?.missionId ? store.missions?.missions.find((mission) => mission.id === slot.agent?.missionId)?.projectId ?? null : null;
    const model = lotusWidget({
      viewer,
      agentName: viewer === "device" ? null : slot?.displayName ?? null,
      projectName: viewer === "device" || !projectId ? null : store.projects.find((project) => project.id === projectId)?.name ?? null,
      memories: viewer === "device" ? null : context ? context.memories.map((memory) => ({ id: memory.id, scope: memory.scope, layer: memory.layer, trust: memory.trust, updatedAt: memory.updatedAt })) : null,
    });
    return (
      <div className="wd-body">
        <p>{model.note}</p>
        {model.state !== "withheld" && <button type="button" className="wd-link" onClick={openers.memory}><span>{model.agent ?? "No Agent selected"}{model.project ? ` · ${model.project}` : ""}</span><span>{model.count === null ? "Availability unknown" : `${model.count} memories in scope`}</span></button>}
        {model.recent.length > 0 && <ul>{model.recent.map((row) => <li key={row.id}>{row.layer} · {row.trust} · {row.scope}</li>)}</ul>}
      </div>
    );
  }
  if (id === "reconciliation") return <ReconcileBody open={openers.reconcile} />;
  return <VoiceBody />;
}

function ReconcileBody({ open }: { open: () => void }) {
  const store = useIsland();
  const items = useReconcileItems();
  const model = reconciliationWidget(items, store.viewer);
  return (
    <div className="wd-body">
      <p className={model.rows.length ? "wd-bad" : undefined}>{model.headline}</p>
      {model.rows.map((row) => <p key={row.key}>{[row.agent, row.mission, row.task].filter(Boolean).join(" · ") || row.title}</p>)}
      {model.canDecide && model.rows.length > 0 ? <button type="button" className="wd-link" onClick={open}>Open the owner review</button> : null}
      {!model.canDecide && <p>Only the workstation owner can decide. Nothing is replayed from this phone.</p>}
    </div>
  );
}

function VoiceBody() {
  const store = useIsland();
  const model = voiceWidget({
    viewer: widgetViewer(store.viewer),
    speaker: store.personalAgentContext ? (store.personalAgentContext.foreground === "bunny" ? "Bunny" : store.personalAgents?.slots.find((slot) => slot.slot === store.personalAgentContext?.foreground)?.displayName ?? "Agent") : null,
    voice: store.voice,
  });
  const slots = store.personalAgents?.slots ?? [];
  const choose = (identity: ConversationIdentity) => void store.personalAgentCommand("personal_agent.foreground", { identity });
  return (
    <div className="wd-body">
      <p>{model.note}</p>
      {model.state === "ready" && <p>Session {model.session}. Microphone {model.microphone}.{model.uncertainty ? ` ${model.uncertainty}` : ""}</p>}
      {model.state === "unreported" && <p>{model.uncertainty}</p>}
      {model.state !== "withheld" && (
        <div className="wd-row">
          <button type="button" className="wd-text" aria-pressed={store.personalAgentContext?.foreground === "bunny"} onClick={() => choose("bunny")}>Bunny</button>
          {slots.map((slot) => <button type="button" key={slot.slot} className="wd-text" aria-pressed={store.personalAgentContext?.foreground === slot.slot} onClick={() => choose(slot.slot)}>{slot.displayName || WEAPON_LABEL[slot.weapon]}</button>)}
          <button type="button" className="wd-text" disabled={!store.voice} onClick={() => void (store.voice?.open ? store.setVoiceMute(!store.voice.muted) : store.openVoice())}>{!store.voice ? "Microphone unreported" : store.voice.muted ? "Unmute" : store.voice.open ? "Mute" : "Open microphone"}</button>
          {store.voice?.open && <button type="button" className="wd-text" onClick={() => void store.closeVoice()}>Close voice</button>}
        </div>
      )}
    </div>
  );
}

function Inspector({
  preference, selected, note, onSelect, onPatch, onApply, onCancel, onReset,
}: {
  preference: WidgetPreference;
  selected: CoreWidgetId;
  note: string | null;
  onSelect: (id: CoreWidgetId) => void;
  onPatch: (part: Partial<WidgetPreference>) => void;
  onApply: () => void;
  onCancel: () => void;
  onReset: () => void;
}) {
  const store = useIsland();
  const theme = useShownTheme();
  const definition = widgetDefinition(selected);
  const item = preference.items.find((row) => row.id === selected);
  const online = store.host === "online";
  const viewer = widgetViewer(store.viewer);
  const manifest = UI_THEMES[theme.preference.theme];
  const source = definition?.dataSource ?? "none";
  return (
    <section className="wd-inspector" aria-labelledby="wd-inspector-title" id="widget-inspector">
      <h2 id="wd-inspector-title">Widget Inspector</h2>
      <p className="wd-kicker">Changes preview on the panel. Apply saves them. Cancel discards the preview.</p>
      {note && <p role="alert">{note}</p>}
      <label>Selected widget
        <select value={selected} onChange={(event) => onSelect(event.target.value as CoreWidgetId)}>
          {CORE_WIDGET_IDS.map((id) => <option key={id} value={id}>{widgetDefinition(id)?.name}</option>)}
        </select>
      </label>
      <dl>
        <dt>Description</dt><dd>{definition?.description}</dd>
        <dt>Status</dt><dd>{online ? "Host snapshot" : "Offline"} · {viewer}</dd>
        <dt>Data source</dt><dd>{source}</dd>
        <dt>Permissions</dt><dd>{definition?.permissions.join(", ")}</dd>
        <dt>Refresh</dt><dd>With the Host snapshot. This widget does not poll on its own.</dd>
      </dl>
      <fieldset>
        <legend>Appearance</legend>
        <label>Size
          <select value={item?.size ?? "standard"} onChange={(event) => onPatch({ items: resizeItem(preference, selected, event.target.value as WidgetSize).items })}>
            {(definition?.sizes ?? WIDGET_SIZES).map((size) => <option key={size} value={size}>{SIZE_LABEL[size]}</option>)}
          </select>
        </label>
        <label>Density
          <select value={preference.density} onChange={(event) => onPatch({ density: event.target.value as WidgetPreference["density"] })}>
            {WIDGET_DENSITIES.map((density) => <option key={density} value={density}>{density}</option>)}
          </select>
        </label>
        <p>Theme inheritance: {manifest.name}. The panel follows the workstation theme. This does not change Agent skins or permissions.</p>
        <p>Visual variant: this widget has no alternate variant.</p>
        <label>Animation
          <select value={preference.motion} onChange={(event) => onPatch({ motion: event.target.value as WidgetPreference["motion"] })}>
            {WIDGET_MOTIONS.map((motion) => <option key={motion} value={motion}>{motion}</option>)}
          </select>
        </label>
      </fieldset>
      <fieldset>
        <legend>Layout</legend>
        <div className="wd-row" role="group" aria-label="Panel composition">
          {WIDGET_LAYOUTS.map((layout) => <button type="button" key={layout} className="wd-text" aria-pressed={preference.layout === layout} onClick={() => onPatch({ layout })}>{LAYOUT_LABEL[layout]}</button>)}
        </div>
        <label>Spacing
          <select value={preference.gap} onChange={(event) => onPatch({ gap: Number(event.target.value) as WidgetPreference["gap"] })}>
            {WIDGET_GAPS.map((gap) => <option key={gap} value={gap}>{gap}px</option>)}
          </select>
        </label>
        <label>Sidebar width
          <input type="range" min={240} max={480} step={10} value={preference.sidebarWidth} onChange={(event) => onPatch({ sidebarWidth: Number(event.target.value) })} aria-valuetext={`${preference.sidebarWidth} pixels`} />
        </label>
        <div className="wd-row">
          <button type="button" className="wd-text" onClick={() => onPatch({ items: moveItem(preference, selected, -1).items })}>Move earlier</button>
          <button type="button" className="wd-text" onClick={() => onPatch({ items: moveItem(preference, selected, 1).items })}>Move later</button>
          <button type="button" className="wd-text" onClick={() => item && onPatch({ items: setItemHidden(preference, selected, !item.hidden).items })}>{item?.hidden ? "Show widget" : "Hide widget"}</button>
          <button type="button" className="wd-text" onClick={() => onPatch({ items: preference.items.map((row) => ({ ...row, hidden: false })) })}>Show all</button>
        </div>
      </fieldset>
      <fieldset>
        <legend>Data</legend>
        <label>Project
          <select value={preference.focus.projectId ?? ""} onChange={(event) => onPatch({ focus: { ...preference.focus, projectId: event.target.value || null } })}>
            <option value="">All projects in this view</option>
            {store.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
        </label>
        <label>Agent
          <select value={preference.focus.slot ?? ""} onChange={(event) => onPatch({ focus: { ...preference.focus, slot: event.target.value ? Number(event.target.value) as 1 | 2 | 3 | 4 : null } })}>
            <option value="">All four Agents</option>
            {(store.personalAgents?.slots ?? []).map((slot) => <option key={slot.slot} value={slot.slot}>{slot.displayName || WEAPON_LABEL[slot.weapon]}</option>)}
          </select>
        </label>
        <p>Scope: {definition?.privacy}. A phone does not receive workstation usage, voice or private memory.</p>
        <button type="button" className="wd-text" onClick={() => void store.refreshOllama()}>Refresh from Host</button>
      </fieldset>
      <fieldset>
        <legend>Library</legend>
        <ul>
          {LIBRARY_WIDGET_IDS.map((id) => <li key={id}><button type="button" disabled>{widgetDefinition(id)?.name}: not installed</button></li>)}
        </ul>
      </fieldset>
      <fieldset>
        <legend>Notch edge the drawer avoids</legend>
        <div className="wd-row">
          {WIDGET_EDGES.map((notchEdge) => <button type="button" key={notchEdge} className="wd-text" aria-pressed={preference.notchEdge === notchEdge} onClick={() => onPatch({ notchEdge })}>{notchEdge}</button>)}
        </div>
        <p>This does not move the Notch. Set the Notch on the Notch itself.</p>
      </fieldset>
      <div className="wd-row">
        <button type="button" className="wd-primary" onClick={onApply}>Apply</button>
        <button type="button" className="wd-text" onClick={onCancel}>Cancel</button>
        <button type="button" className="wd-text" onClick={onReset}>Reset</button>
      </div>
    </section>
  );
}

function NotchPreview({ preference }: { preference: WidgetPreference }) {
  const items = useReconcileItems();
  const cue = notchWidgetLine(items.length);
  return (
    <div className="wd-notch" aria-label="Notch summary">
      {WIDGET_EDGES.map((edge) => (
        <p key={edge} data-current={preference.notchEdge === edge}>{edge}: {preference.notchEdge === edge ? (cue.line ?? "Agents") : "—"}</p>
      ))}
      <p>The full studio stays in this workspace.</p>
    </div>
  );
}

export type WidgetOpeners = Openers;

export function PhoneWidgets({ go }: { go: (route: PhoneRoute) => void }) {
  const openers: Openers = {
    mission: (id) => go({ kind: "mission", missionId: id, from: "home" }),
    agent: (slot) => go({ kind: "agent", slot: slot as SlotId, from: "home" }),
    usage: () => go({ kind: "tab", tab: "settings" }),
    memory: () => go({ kind: "agent", slot: 1, from: "home" }),
    reconcile: () => go({ kind: "tab", tab: "missions" }),
  };
  return <WidgetSurface mode="board" surface="phone" openers={openers} />;
}
