/**
 * Visual Experience 2.0: which theme a window shows (pure). The workstation's theme lives on the Host so every window and the
 * native Notch agree; a paired device may follow it or keep its own look on the device. A gallery preview and a `?uitheme=`
 * link only change what this window shows, never what is saved. Nothing here can change what anyone may do.
 */
import {
  DEFAULT_UI_PREFERENCE, UI_THEME_SCHEMA, isUiThemeId, parseUiPreference, validateUiPreference,
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
  link: { theme: UiThemeId | null; variant: "light" | "dark" | null };
  cached: UiThemePreference | null;
};

/** The preference this window shows and where it came from. Precedence: preview, link, device choice, Host, cache, default. */
export function effectivePreference(input: ThemeInputs): { preference: UiThemePreference; origin: ThemeOrigin } {
  const withLink = (preference: UiThemePreference): UiThemePreference => ({
    ...preference,
    ...(input.link.theme ? { theme: input.link.theme } : {}),
    ...(input.link.variant ? { variant: input.link.variant } : {}),
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
  if (input.link.theme || input.link.variant) return { preference: withLink(base.preference), origin: "link" };
  return base;
}

/** `?uitheme=` selects a theme for this window only (screenshots, support links); unknown values are ignored. */
export function themeLinkFromSearch(search: string): ThemeInputs["link"] {
  const query = new URLSearchParams(search);
  const theme = query.get("uitheme");
  const variant = query.get("theme");
  return {
    theme: isUiThemeId(theme) ? theme : null,
    variant: variant === "light" || variant === "dark" ? variant : null,
  };
}

/** A cached or stored value: schema-checked and strictly validated, or null (never a partial or foreign value). */
export function readStoredPreference(raw: string | null): UiThemePreference | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || parsed.schema !== UI_THEME_SCHEMA) return null;
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

/** Parses a Host view defensively (a newer Host may send a schema this window does not know). */
export function hostView(value: unknown): UiThemeView | null {
  if (!value || typeof value !== "object") return null;
  const view = value as UiThemeView;
  if (view.schema !== UI_THEME_SCHEMA || typeof view.revision !== "number") return null;
  return { ...view, preference: parseUiPreference(view.preference) };
}

/** Before any Host theme was saved (revision 0), the workstation's legacy light/dark choice is its appearance. */
export function withLegacyVariant(view: UiThemeView | null, legacy: VariantChoice): UiThemeView | null {
  return view && view.revision === 0 ? { ...view, preference: { ...view.preference, variant: legacy } } : view;
}
