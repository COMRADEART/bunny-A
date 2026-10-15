import { forwardRef, useEffect, useMemo, useState, useSyncExternalStore, type ComponentPropsWithoutRef, type CSSProperties } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useIsland } from "@/store/use-island";
import {
  resolveTheme, themeAttributes, themeCssVars, type ResolvedTheme, type UiThemePreference,
} from "@/lib/bunny-host/ui-theme";
import { effectivePreference, withLegacyVariant } from "./theme-model";
import "./themes/fonts";
import "./themes/engine.css";
import "./themes/themes.css";

const subscribeDark = (notify: () => void) => {
  const query = window.matchMedia?.("(prefers-color-scheme: dark)");
  query?.addEventListener("change", notify);
  return () => query?.removeEventListener("change", notify);
};
const prefersDark = () => !!window.matchMedia?.("(prefers-color-scheme: dark)").matches;
export const usePrefersDark = () => useSyncExternalStore(subscribeDark, prefersDark, () => false);

/** The preference this window shows (preview, link, device choice, Host, cache or the default). */
export function useShownTheme(): { preference: UiThemePreference; origin: ReturnType<typeof effectivePreference>["origin"] } {
  const uiTheme = useIsland((s) => s.uiTheme);
  const preview = useIsland((s) => s.themePreview);
  const device = useIsland((s) => s.deviceTheme);
  const link = useIsland((s) => s.themeLink);
  const cached = useIsland((s) => s.themeCache);
  const viewer = useIsland((s) => s.viewer?.kind);
  const legacyVariant = useIsland((s) => s.appearance.theme);
  return useMemo(() => {
    return effectivePreference({ host: withLegacyVariant(uiTheme, legacyVariant), viewer: viewer === "device" ? "device" : "workstation", device, preview, link, cached });
  }, [uiTheme, preview, device, link, cached, viewer, legacyVariant]);
}

export function useResolvedTheme(): ResolvedTheme {
  const { preference } = useShownTheme();
  const dark = usePrefersDark();
  return useMemo(() => resolveTheme(preference, dark), [preference, dark]);
}

export type ThemeScope = { [attribute: `data-${string}`]: string } & { style: CSSProperties };
/** Props for any element that hosts themed UI (the shell, a portaled dialog, the phone root, a gallery preview). */
export function scopeFor(resolved: ResolvedTheme, motion: string): ThemeScope {
  return { ...themeAttributes(resolved), "data-motion": motion, style: themeCssVars(resolved) as CSSProperties };
}
export function useThemeScope(): ThemeScope {
  const resolved = useResolvedTheme();
  const motion = useIsland((s) => s.appearance.motion);
  return useMemo(() => scopeFor(resolved, motion), [resolved, motion]);
}

/** Document-level effects of the shown theme: text size, page colour behind overscroll, and the OS colour scheme. */
export function useDocumentTheme() {
  const resolved = useResolvedTheme();
  const fontScale = useIsland((s) => s.appearance.fontScale);
  useEffect(() => {
    const root = document.documentElement;
    root.style.fontSize = fontScale === 1 ? "" : `${16 * fontScale}px`;
    root.dataset.uiTheme = resolved.manifest.id;
    root.style.colorScheme = resolved.variant;
    document.body.style.background = resolved.palette.page;
  }, [resolved, fontScale]);
}

/** A Radix dialog surface that carries the shown theme (it is portaled outside the shell, so it needs its own scope). */
export const ThemedDialogContent = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<typeof Dialog.Content>>(function ThemedDialogContent({ style, ...props }, ref) {
  const scope = useThemeScope();
  return <Dialog.Content ref={ref} {...scope} {...props} style={{ ...scope.style, ...style }} />;
});

/**
 * Whether ambient (decorative, looping) theme motion may run: only while this window is visible and was used in the last
 * 45 s. Real Agent and Host state indicators are not ambient and are not paused by this.
 */
export const AMBIENT_IDLE_MS = 45_000;
export function useAmbient(): "on" | "off" {
  const [on, setOn] = useState(true);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let woke = 0;
    const wake = () => {
      if (document.hidden) return;
      // At most one timer reset per second: pointermove fires many times a frame.
      const now = Date.now();
      if (now - woke < 1_000) return;
      woke = now;
      setOn(true);
      clearTimeout(timer);
      timer = setTimeout(() => setOn(false), AMBIENT_IDLE_MS);
    };
    const visibility = () => {
      if (document.hidden) {
        clearTimeout(timer);
        setOn(false);
      } else {
        woke = 0;
        wake();
      }
    };
    wake();
    const events = ["pointermove", "pointerdown", "keydown", "wheel", "touchstart"] as const;
    for (const event of events) window.addEventListener(event, wake, { passive: true });
    document.addEventListener("visibilitychange", visibility);
    return () => {
      clearTimeout(timer);
      for (const event of events) window.removeEventListener(event, wake);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  return on ? "on" : "off";
}
