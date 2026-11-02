/**
 * Visual Experience 2.0: which theme a window shows (pure). The workstation's theme lives on the Host so every window and the
 * native Notch agree; a paired device may follow it or keep its own look on the device. A gallery preview and a `?uitheme=`
 * link only change what this window shows, never what is saved. Nothing here can change what anyone may do.
 */
import {
  DEFAULT_UI_PREFERENCE, PREFERENCE_SCHEMAS, UI_THEME_SCHEMA, isUiThemeId, parseUiPreference, validateUiPreference,
  type UiThemeId, type UiThemePreference, type UiThemeView, type VariantChoice,
} from "../../lib/bunny-host/ui-theme.ts";

export const THEME_CACHE_KEY = "bunny-a.ui-theme.v1";
export const DEVICE_THEME_KEY = "bunny-a.device-theme.v1";

export type ThemeOrigin = "preview" | "link" | "device" | "host" | "cache" | "default";
export type ThemeInputs = {
  host: UiThemeView | null;
  viewer: "workstation" | "device";
  /** A device's own look; ignored on the workstation (the Host's choice is the workstation's). */
  device: UiThemePreference | null;
  preview: UiThemePreference | null;
  link: { theme: UiThemeId | null; variant: "light" | "dark" | null; glassIntensity: number | null };
  cached: UiThemePreference | null;
};

/** The preference this window shows and where it came from. Precedence: preview, link, device choice, Host, cache, default. */
export function effectivePreference(input: ThemeInputs): { preference: UiThemePreference; origin: ThemeOrigin } {
  const withLink = (preference: UiThemePreference): UiThemePreference => ({
    ...preference,
    ...(input.link.theme ? { theme: input.link.theme } : {}),
    ...(input.link.variant ? { variant: input.link.variant } : {}),
    ...(input.link.glassIntensity !== null ? { glassIntensity: input.link.glassIntensity } : {}),
  });
  if (input.preview) return { preference: withLink(input.preview), origin: "preview" };
  const base: { preference: UiThemePreference; origin: ThemeOrigin } =
    input.viewer === "device" && input.device
      ? { preference: input.device, origin: "device" }
      : input.host
        ? { preference: input.host.preference, origin: "host" }
        : input.cached
          ? { preference: input.cached, origin: "cache" }
          : { preference: { ...DEFAULT_UI_PREFERENCE }, origin: "default" };
  if (input.link.theme || input.link.variant || input.link.glassIntensity !== null) return { preference: withLink(base.preference), origin: "link" };
  return base;
}

/** `?uitheme=` selects a theme for this window only (screenshots, support links); unknown values are ignored. */
export function themeLinkFromSearch(search: string): ThemeInputs["link"] {
  const query = new URLSearchParams(search);
  const theme = query.get("uitheme");
  const variant = query.get("theme");
  const glass = query.get("glassintensity");
  const parsed = glass === null ? Number.NaN : Number(glass);
  const glassIntensity = Number.isInteger(parsed) && parsed >= 0 && parsed <= 100 ? parsed : null;
  return {
    theme: isUiThemeId(theme) ? theme : null,
    variant: variant === "light" || variant === "dark" ? variant : null,
    glassIntensity,
  };
}

/** A cached or stored value: schema-checked (v1 rows read in unchanged; v2 carries glassIntensity), strictly validated, or null. */
export function readStoredPreference(raw: string | null): UiThemePreference | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || !(PREFERENCE_SCHEMAS as readonly unknown[]).includes(parsed.schema)) return null;
    const { schema: _schema, ...rest } = parsed;
    return validateUiPreference(rest);
  } catch {
    return null;
  }
}
export const storedPreference = (preference: UiThemePreference) => JSON.stringify({ schema: UI_THEME_SCHEMA, ...preference });

/** The patch a light/dark toggle sends: an explicit variant, so "system" never hides the toggle's effect. */
export const variantToggle = (current: "light" | "dark"): { variant: VariantChoice } => ({ variant: current === "dark" ? "light" : "dark" });

/** A preview starts from what is shown now and swaps the theme; the rest of the user's tuning carries over. */
export const previewOf = (shown: UiThemePreference, theme: UiThemeId): UiThemePreference => ({ ...shown, theme });

/** Parses a Host view defensively (an older window reading a newer-or-older Host accepts both known preference schemas). */
export function hostView(value: unknown): UiThemeView | null {
  if (!value || typeof value !== "object") return null;
  const view = value as UiThemeView;
  if (typeof view.revision !== "number" || !(PREFERENCE_SCHEMAS as readonly unknown[]).includes(view.schema)) return null;
  return { ...view, preference: parseUiPreference(view.preference) };
}

/** Before any Host theme was saved (revision 0), the workstation's legacy light/dark choice is its appearance. */
export function withLegacyVariant(view: UiThemeView | null, legacy: VariantChoice): UiThemeView | null {
  return view && view.revision === 0 ? { ...view, preference: { ...view.preference, variant: legacy } } : view;
}

/**
 * The legacy per-window glass lever maps deterministically onto Glass Intensity (E1); medium is exactly the new default 85.
 * The lever keeps its compatibility behavior until its removal, and the gallery explains the mapping.
 */
export const LEGACY_GLASS_MAP = { low: 30, medium: 85, high: 100 } as const;
export const legacyGlassToIntensity = (glass: "low" | "medium" | "high"): number => LEGACY_GLASS_MAP[glass];

/** The note shown when materials cannot render glass at all; the stored intensity preference is retained either way. */
export function glassLimitedNote(preference: UiThemePreference): string | null {
  return preference.highContrast || preference.transparency === "low" ? "Effective intensity limited — stored preference retained." : null;
}
