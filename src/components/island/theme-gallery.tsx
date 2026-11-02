import { memo, useEffect, useMemo, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Check, Eye, RotateCcw } from "lucide-react";
import { FONT_SCALES, useIsland, type Appearance } from "@/store/use-island";
import {
  DENSITIES, TRANSPARENCIES, UI_THEMES, UI_THEME_IDS, accentUsable, notchTheme, resolveTheme,
  type ThemeManifest, type UiThemeId, type UiThemePreference, type VariantChoice,
} from "@/lib/bunny-host/ui-theme";
import { previewOf, withLegacyVariant, glassLimitedNote } from "./theme-model";
import { scopeFor, usePrefersDark, useShownTheme } from "./theme";
import "./theme-gallery.css";

const DENSITY_LABEL: Record<(typeof DENSITIES)[number], string> = { theme: "Theme default", compact: "Compact", comfortable: "Comfortable", spacious: "Spacious" };
const TRANSPARENCY_LABEL: Record<(typeof TRANSPARENCIES)[number], string> = { low: "Opaque", medium: "Theme default", high: "More glass" };
const VARIANT_LABEL: Record<VariantChoice, string> = { system: "System", light: "Light", dark: "Dark" };

/** The live preview of one theme: a miniature desktop, phone and Notch drawn from that theme's own tokens. Memoized: the
 *  gallery re-renders on every Host snapshot, the 22 miniatures only when the preference they are drawn from changes. */
const ThemeMiniature = memo(function ThemeMiniature({ theme, base, dark }: { theme: ThemeManifest; base: UiThemePreference; dark: boolean }) {
  const resolved = useMemo(() => resolveTheme({ ...base, theme: theme.id }, dark), [base, theme.id, dark]);
  const scope = useMemo(() => scopeFor(resolved, "off"), [resolved]);
  const notch = useMemo(() => notchTheme({ ...base, theme: theme.id }), [base, theme.id]);
  const colors = notch[resolved.variant];
  const notchStyle: CSSProperties = {
    background: `linear-gradient(180deg, ${colors.fill}, ${colors.fillEnd})`,
    color: colors.ink,
    borderColor: colors.stroke,
    borderWidth: Math.max(1, Math.min(notch.border, 3)),
    borderRadius: notch.shape === "pill" || notch.shape === "capsule" ? 999 : Math.min(notch.radius, 16),
    boxShadow: notch.glow ? `0 0 10px ${colors.glow}66` : undefined,
  };
  return (
    <div className="tg-mini" {...scope} aria-hidden="true">
      <div className="tg-desktop">
        <div className="tg-nav">
          <span className="tg-brand" />
          <span className="tg-item" data-current="true" />
          <span className="tg-item" />
          <span className="tg-item" />
          <span className="tg-item" />
        </div>
        <div className="tg-main">
          <span className="tg-eyebrow">Today</span>
          <strong className="tg-title">Good morning</strong>
          <div className="tg-row">
            <span className="tg-tile">
              <span className="tg-well" />
              <span className="tg-lines" />
            </span>
            <span className="tg-tile">
              <span className="tg-lines" />
              <span className="tg-button">Ask</span>
            </span>
          </div>
        </div>
      </div>
      <div className="tg-side">
        <div className="tg-phone">
          <span className="tg-phone-hero" />
          <span className="tg-phone-card" />
          <span className="tg-phone-tabs" />
        </div>
        <div className="tg-notch" style={notchStyle}>
          <span className="tg-notch-dot" style={{ background: colors.accent }} />
          <span>Ready</span>
        </div>
      </div>
    </div>
  );
});

/**
 * Settings → Appearance → Theme Gallery. All 22 designs, each with a live miniature of the desktop, phone and Notch drawn
 * from its own tokens; Preview restyles this whole window without saving; Apply saves (on the Host from the workstation,
 * on this device from a paired device). A theme never changes what Bunny or an Agent may do.
 */
export function ThemeGallery() {
  const store = useIsland();
  const { preference: shown, origin } = useShownTheme();
  const dark = usePrefersDark();
  const [refusal, setRefusal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const themeAccent = shown.accent ?? UI_THEMES[shown.theme].palettes[UI_THEMES[shown.theme].defaultVariant]!.action;
  const [accentDraft, setAccentDraft] = useState(themeAccent);
  // Follows the shown theme and its saved accent (another window, a preview, a reset) instead of keeping a stale draft.
  useEffect(() => setAccentDraft(themeAccent), [themeAccent]);
  const device = store.viewer?.kind === "device";
  const host = withLegacyVariant(store.uiTheme, store.appearance.theme)?.preference;
  const saved = device ? (store.deviceTheme ?? host ?? shown) : (host ?? shown);
  const resolved = resolveTheme(shown, dark);
  const previewing = store.themePreview !== null;
  const canSave = device || (store.host === "online" && store.uiTheme !== null);

  // Glass Intensity (E1): dragging previews live through the same channel as theme previews; commit saves once.
  const [glassDraft, setGlassDraft] = useState<number | null>(null);
  useEffect(() => setGlassDraft(null), [saved]);
  const shownGlass = glassDraft ?? shown.glassIntensity;
  const onGlassInput = (value: number) => {
    setGlassDraft(value);
    store.setThemePreview(previewing && store.themePreview ? { ...store.themePreview!, glassIntensity: value } : { ...saved, glassIntensity: value });
  };
  const commitGlass = () => {
    if (glassDraft === null) return;
    const wasPreview = store.themePreview !== null;
    const value = glassDraft;
    setGlassDraft(null);
    if (!canSave || busy) return; // keep the live preview; it is visibly labelled as unsaved
    void save(wasPreview && store.themePreview ? store.themePreview : { glassIntensity: value });
  };
  const setGlassStep = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    // Shift + arrow jumps 10; the input's own arrow handling is suppressed so the step is exact.
    if (!event.shiftKey || (event.key !== "ArrowRight" && event.key !== "ArrowLeft")) return;
    event.preventDefault();
    if (event.key === "ArrowRight") event.currentTarget.value = String(Math.min(100, Number(event.currentTarget.value) + 10));
    else event.currentTarget.value = String(Math.max(0, Number(event.currentTarget.value) - 10));
    onGlassInput(Number(event.currentTarget.value));
  };

  useEffect(() => {
    if (!previewing) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") store.setThemePreview(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [previewing, store]);

  const save = async (patch: Partial<UiThemePreference>) => {
    if (busy) return;
    setBusy(true);
    setRefusal(null);
    try {
      const ok = await store.setUiTheme(patch, setRefusal);
      if (ok) store.setThemePreview(null);
    } finally {
      setBusy(false);
    }
  };
  const tune = (patch: Partial<UiThemePreference>) => {
    // While previewing, tuning changes the preview; otherwise it is saved straight away.
    if (previewing) store.setThemePreview({ ...store.themePreview!, ...patch });
    else void save(patch);
  };
  const local = <K extends keyof Appearance>(key: K, value: Appearance[K]) => store.setAppearance({ [key]: value } as Partial<Appearance>);

  return (
    <div className="tg">
      <div className="tg-status" role="status">
        <strong>{UI_THEMES[shown.theme].name}</strong>
        <span>
          {previewing
            ? "Previewing in this window only. Nothing is saved until you apply it."
            : origin === "device"
              ? "This phone's own look, kept on this device."
              : origin === "host"
                ? device
                  ? "Following the workstation's theme."
                  : "Saved on your Host: every window and the Notch use it."
                : origin === "link"
                  ? "Shown from this link only; nothing is saved."
                  : "The system default until the Host answers."}
        </span>
        {resolved.notes.map((note) => (
          <small key={note}>{note}</small>
        ))}
        {!canSave && !previewing && <small>Reconnect to the Host to save a theme. You can still preview any design.</small>}
      </div>
      {refusal && (
        <p className="st-error" role="alert">
          {refusal}
        </p>
      )}
      {previewing && (
        <div className="tg-preview-bar">
          <span>Previewing {UI_THEMES[store.themePreview!.theme].name}</span>
          <button className="btn primary" type="button" disabled={!canSave || busy} onClick={() => void save(store.themePreview!)}>
            <Check size={16} /> Apply {UI_THEMES[store.themePreview!.theme].name}
          </button>
          <button className="btn secondary" type="button" onClick={() => store.setThemePreview(null)}>
            Keep {UI_THEMES[saved.theme].name}
          </button>
        </div>
      )}

      {/* Not disabled while saving: that would drop keyboard focus mid-save; save() ignores repeats while busy. */}
      <fieldset className="tg-tuning">
        <legend className="sr-only">Customize the theme</legend>
        <div className="setting-row">
          <div>
            <strong>Theme</strong>
            <p>Two built-in Liquid Glass defaults. The full catalogue stays under Explore Themes below.</p>
          </div>
          <div className="tg-presets">
            {([["light", "Silver Liquid Glass"], ["dark", "Graphite Liquid Glass"]] as const).map(([variant, name]) => {
              const currentGlass = saved.theme === "glass" && saved.variant === variant;
              return (
                <button
                  key={variant}
                  className="tg-preset"
                  type="button"
                  data-variant={variant}
                  aria-pressed={currentGlass}
                  disabled={busy || (!device && !canSave)}
                  onClick={() => void save({ theme: "glass", variant })}
                >
                  <span className="tg-preset-well" aria-hidden="true" />
                  <span>{name}</span>
                  {currentGlass && <small className="tg-tag">In use</small>}
                </button>
              );
            })}
          </div>
        </div>
        <div className="setting-row">
          <div>
            <strong>Appearance</strong>
            <p>
              {UI_THEMES[shown.theme].variants.length > 1
                ? "System follows Windows' light or dark choice."
                : `${UI_THEMES[shown.theme].name} has one appearance.`}
            </p>
          </div>
          <div className="tg-segment" role="radiogroup" aria-label="Appearance">
            {(["system", "light", "dark"] as const).map((choice) => {
              const available = choice === "system" || UI_THEMES[shown.theme].variants.includes(choice);
              return (
                <button
                  key={choice}
                  type="button"
                  role="radio"
                  aria-checked={shown.variant === choice}
                  disabled={!available}
                  title={available ? undefined : `${UI_THEMES[shown.theme].name} has no ${choice} appearance`}
                  onClick={() => tune({ variant: choice })}
                >
                  {VARIANT_LABEL[choice]}
                </button>
              );
            })}
          </div>
        </div>
        <div className="setting-row">
          <div>
            <strong>Glass Intensity</strong>
            <p id="tg-glass-help">
              0–100 rim, sheen, refraction and depth — not a blur control; blur follows Transparency. Window glass now
              follows Glass Intensity.
            </p>
          </div>
          <span className="tg-glass">
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              aria-label="Glass intensity"
              aria-describedby="tg-glass-help"
              value={shownGlass}
              onChange={(event) => onGlassInput(Number(event.currentTarget.value))}
              onKeyDown={(event) => setGlassStep(event)}
              onPointerUp={commitGlass}
              onKeyUp={commitGlass}
              onBlur={commitGlass}
            />
            <output aria-hidden="true">{shownGlass}%</output>
          </span>
        </div>
        {glassLimitedNote(shown) && (
          <small className="tg-glass-note" role="note">
            {glassLimitedNote(shown)}
          </small>
        )}
        <div className="setting-row">
          <div>
            <strong>Transparency</strong>
            <p>Opaque surfaces are easier to read over busy backgrounds.</p>
          </div>
          <select aria-label="Transparency" value={shown.transparency} onChange={(event) => tune({ transparency: event.target.value as UiThemePreference["transparency"] })}>
            {TRANSPARENCIES.map((value) => (
              <option key={value} value={value}>
                {TRANSPARENCY_LABEL[value]}
              </option>
            ))}
          </select>
        </div>
        <div className="setting-row">
          <div>
            <strong>High contrast</strong>
            <p>Solid surfaces, full-strength outlines and text, and no decorative layers.</p>
          </div>
          <button className="switch" type="button" role="switch" aria-checked={shown.highContrast} aria-label="High contrast" onClick={() => tune({ highContrast: !shown.highContrast })}>
            <span />
          </button>
        </div>
        <div className="setting-row">
          <div>
            <strong>Accent colour</strong>
            <p>Used for primary buttons and selection. It is applied only where labels stay readable.</p>
          </div>
          <span className="tg-accent">
            <input type="color" aria-label="Accent colour" value={accentDraft} onChange={(event) => setAccentDraft(event.target.value)} />
            <button
              className="btn secondary"
              type="button"
              disabled={!accentUsable(accentDraft)}
              onClick={() => tune({ accent: accentDraft.toLowerCase() })}
            >
              Use accent
            </button>
            {shown.accent && (
              <button className="btn quiet" type="button" onClick={() => tune({ accent: null })}>
                Theme accent
              </button>
            )}
          </span>
        </div>
        <div className="setting-row">
          <div>
            <strong>Density</strong>
            <p>Spacing between controls.</p>
          </div>
          <select aria-label="Density" value={shown.density} onChange={(event) => tune({ density: event.target.value as UiThemePreference["density"] })}>
            {DENSITIES.map((value) => (
              <option key={value} value={value}>
                {DENSITY_LABEL[value]}
              </option>
            ))}
          </select>
        </div>
      </fieldset>
      <fieldset className="tg-tuning">
        <legend>This window</legend>
        <div className="setting-row">
          <div>
            <strong>Text size</strong>
            <p>Applies to this window only.</p>
          </div>
          <select aria-label="Text size" value={String(store.appearance.fontScale)} onChange={(event) => local("fontScale", Number(event.target.value) as Appearance["fontScale"])}>
            {FONT_SCALES.map((scale) => (
              <option key={scale} value={scale}>
                {Math.round(scale * 100)}%
              </option>
            ))}
          </select>
        </div>
        <div className="setting-row">
          <div>
            <strong>Animation</strong>
            <p>Windows' reduce-motion setting always wins.</p>
          </div>
          <select aria-label="Animation" value={store.appearance.motion} onChange={(event) => local("motion", event.target.value as Appearance["motion"])}>
            <option value="full">Full</option>
            <option value="reduced">Reduced</option>
            <option value="off">Off</option>
          </select>
        </div>
        <div className="setting-row">
          <div>
            <strong>Agent characters</strong>
            <p>Each Personal Agent keeps its own character look, chosen in Agent Studio. Themes frame it but never replace it.</p>
          </div>
          <button className="btn secondary" type="button" onClick={() => store.setSheet("agents")}>
            Open Agent Studio
          </button>
        </div>
        <div className="setting-row">
          <div>
            <strong>Notch position</strong>
            <p>Top, bottom, left or right of your screen. Choose it from the Notch's own menu, or drag the Notch to an edge.</p>
          </div>
          <span className="caption">Set on the Notch</span>
        </div>
        <div className="setting-row">
          <div>
            <strong>Sync preference</strong>
            <p>The workstation shows the Host's theme; a phone follows it or keeps its own look on the device.</p>
          </div>
          {device ? (
            store.deviceTheme ? (
              <button className="btn quiet" type="button" onClick={() => store.followWorkstationTheme()}>
                Follow the workstation
              </button>
            ) : (
              <span className="caption">This device follows the workstation</span>
            )
          ) : (
            <span className="caption">Saved on the workstation</span>
          )}
        </div>
      </fieldset>

      <div className="section-heading">
        <h3 id="tg-heading">Explore Themes</h3>
        <span className="tg-reset">
          <button className="btn quiet" type="button" disabled={busy || (!device && !canSave)} onClick={async () => {
            setRefusal(null);
            setBusy(true);
            try {
              if (await store.resetUiTheme(setRefusal)) store.setThemePreview(null);
            } finally {
              setBusy(false);
            }
          }}>
            <RotateCcw size={14} /> Reset to system default
          </button>
        </span>
      </div>
      <ul className="tg-grid" aria-labelledby="tg-heading">
        {UI_THEME_IDS.map((id) => {
          const theme = UI_THEMES[id];
          const current = saved.theme === id;
          const inPreview = store.themePreview?.theme === id;
          return (
            <li key={id} className="tg-card" data-current={current} data-previewing={inPreview}>
              <ThemeMiniature theme={theme} base={shown} dark={dark} />
              <div className="tg-copy">
                <h4>
                  {theme.name}
                  {current && <span className="tg-tag">In use</span>}
                  {inPreview && <span className="tg-tag">Previewing</span>}
                </h4>
                <p>{theme.description}</p>
                <small>
                  {theme.variants.length > 1 ? "Light and dark" : theme.variants[0] === "dark" ? "Dark only" : "Light only"}
                  {" · "}
                  {theme.motion.language} motion
                </small>
              </div>
              <div className="tg-actions">
                <button
                  className="btn secondary"
                  type="button"
                  aria-pressed={inPreview}
                  aria-label={`Preview ${theme.name} without applying it`}
                  onClick={() => store.setThemePreview(inPreview ? null : previewOf(saved, id as UiThemeId))}
                >
                  <Eye size={16} /> {inPreview ? "Stop preview" : "Preview"}
                </button>
                <button
                  className="btn primary"
                  type="button"
                  disabled={current && !previewing ? true : !canSave || busy}
                  aria-label={`Apply ${theme.name}`}
                  onClick={() => void save({ theme: id })}
                >
                  {current && !previewing ? "Applied" : "Apply"}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The bar every window shows while a preview is active, so it is never mistaken for the saved theme. */
export function ThemePreviewBar() {
  const store = useIsland();
  if (!store.themePreview) return null;
  const name = UI_THEMES[store.themePreview.theme].name;
  return (
    <div className="tg-global-preview" role="status">
      <span>
        Previewing <strong>{name}</strong> in this window. Nothing is saved.
      </span>
      <button className="btn secondary" type="button" onClick={() => store.setSheet("settings")}>
        Review
      </button>
      <button className="btn secondary" type="button" onClick={() => store.setThemePreview(null)}>
        End preview
      </button>
    </div>
  );
}
