package com.routeragent.jev;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * E3-A: the phone keeps its OWN look, on this device only (it never changes the workstation's theme or gains any
 * authority by looking different). A validated variant (system/light/dark) plus a whole Glass Intensity 0-100
 * (default 85) drive two deterministic decoration terms — panel clear and edge rim — with the same published formulas
 * as the workstation's mapper (docs/ux/BUNNY_A_MASTER_UX_DESIGN.md section 4.3). Intensity is never a blur control:
 * the phone has no blur to change. The material colors are the workstation's accepted glass palettes as fixed ints.
 * Pure JDK: the schema reader, validation and mapping are unit-tested on the JVM; the Context-facing
 * load/save/resolve helpers live in NativeCompanionActivity.
 */
public final class CompanionAppearance {
    public static final String SCHEMA = "bunny.native.appearance.v1";
    /** SharedPreferences file/key the appearance row lives in (one row, one versioned schema, like the session store). */
    public static final String PREF_FILE = "native_appearance_v1";
    public static final String PREF_KEY = "appearance";

    public static final int DEFAULT_GLASS_INTENSITY = 85;
    /** Panel alpha floor 0.45 so intensity can never thin a panel until text loses its surface. */
    public static final int MIN_PANEL_ALPHA = 115;

    private static final Pattern KEY = Pattern.compile("\"([A-Za-z]+)\"\\s*:");

    private final String variant;
    private final int glassIntensity;

    private CompanionAppearance(String variant, int glassIntensity) {
        this.variant = variant;
        this.glassIntensity = glassIntensity;
    }

    /** The factory default: follow the OS, default intensity. */
    public static final CompanionAppearance DEFAULT = new CompanionAppearance("system", DEFAULT_GLASS_INTENSITY);

    public String variant() { return variant; }
    public int glassIntensity() { return glassIntensity; }

    /** Strict: only the three canonical variants and a whole 0-100 intensity. Any refusal reads as the default. */
    public static CompanionAppearance of(String variant, int glassIntensity) {
        if (variant == null) return null;
        if (!"system".equals(variant) && !"light".equals(variant) && !"dark".equals(variant)) return null;
        if (glassIntensity < 0 || glassIntensity > 100) return null;
        return new CompanionAppearance(variant, glassIntensity);
    }

    /** One versioned row: a damaged, foreign-schema, unknown-key or missing-field value reads back as DEFAULT. */
    public static CompanionAppearance parse(String raw) {
        if (raw == null || raw.indexOf('"') < 0) return DEFAULT;
        if (!SCHEMA.equals(quotedValue(raw, "schema"))) return DEFAULT;
        String variant = quotedValue(raw, "variant");
        Integer intensity = numberValue(raw, "glassIntensity");
        if (variant == null || intensity == null) return DEFAULT;
        // This object carries exactly schema, variant and glassIntensity: any further key is refused outright.
        if (keyCount(raw) != 3) return DEFAULT;
        CompanionAppearance parsed = of(variant, intensity);
        return parsed == null ? DEFAULT : parsed;
    }

    private static String quotedValue(String raw, String key) {
        Matcher pair = Pattern.compile("\"" + key + "\"\\s*:\\s*\"([^\"]*)\"").matcher(raw);
        return pair.find() ? pair.group(1) : null;
    }

    private static Integer numberValue(String raw, String key) {
        Matcher pair = Pattern.compile("\"" + key + "\"\\s*:\\s*(-?\\d+)").matcher(raw);
        if (!pair.find()) return null;
        // A fractional intensity ("1.5") prefix-matches as 1 — refuse it whole instead of truncating.
        if (pair.end() < raw.length() && raw.charAt(pair.end()) == '.') return null;
        try { return Integer.valueOf(pair.group(1)); } catch (NumberFormatException broken) { return null; }
    }

    private static int keyCount(String raw) {
        int seen = 0;
        Matcher keys = KEY.matcher(raw);
        while (keys.find()) seen++;
        return seen;
    }

    // ------------------------------------------------------------------ the published Glass Intensity mapping
    private static double clamped(int glassIntensity) {
        return Math.max(0, Math.min(100, glassIntensity)) / 100.0;
    }

    /** Edge rim strength: 0.30 + 0.70 * i (1.0 at intensity 100). */
    public static double rimAlpha(int glassIntensity) {
        double i = clamped(glassIntensity);
        return Math.round((0.30 + 0.70 * i) * 1000.0) / 1000.0;
    }

    /** The panel-clear term in 0-255 alpha steps: round(0.06 * i * 255) — 13 at the default 85. */
    public static int clearAlpha255(int glassIntensity) {
        double i = clamped(glassIntensity);
        return (int) Math.round(0.06 * i * 255.0);
    }

    /** The glass panel color: the base palette's panel with the clear term applied, never below 0.45 alpha. */
    public static int panelWithClear(int basePanelArgb, int glassIntensity) {
        int alpha = (basePanelArgb >>> 24) & 0xFF;
        int next = Math.max(MIN_PANEL_ALPHA, alpha - clearAlpha255(glassIntensity));
        return (next << 24) | (basePanelArgb & 0x00FFFFFF);
    }

    /** The edge stroke color for one intensity: the rim glint tinted by its strength (Silver white, Graphite cool white). */
    public static int rimStroke(int glassIntensity, int rimColor) {
        int alpha = (int) Math.round(255.0 * rimAlpha(glassIntensity));
        return (alpha << 24) | (rimColor & 0x00FFFFFF);
    }

    // ------------------------------------------------------------------ the two built-in appearances (workstation glass tokens)
    /** The fixed token rows: page, panel (base translucent), panelSolid, elevated, fg, muted, accent, onAccent,
     *  success, danger, warn, rim glint, and the three semantic washes for banners/small actions. */
    public static final class Palette {
        public final int page, panel, panelSolid, elevated, fg, muted, accent, onAccent, success, danger, warn, rim, washWarn, washAccent, washDanger;

        private Palette(int page, int panel, int panelSolid, int elevated, int fg, int muted, int accent, int onAccent,
                        int success, int danger, int warn, int rim, int washWarn, int washAccent, int washDanger) {
            this.page = page; this.panel = panel; this.panelSolid = panelSolid; this.elevated = elevated;
            this.fg = fg; this.muted = muted; this.accent = accent; this.onAccent = onAccent;
            this.success = success; this.danger = danger; this.warn = warn; this.rim = rim;
            this.washWarn = washWarn; this.washAccent = washAccent; this.washDanger = washDanger;
        }

        /** The accepted glass light palette (Silver): clear white panes over the pale page. */
        public static final Palette SILVER = new Palette(
                0xFFEEF2FB, 0xA3FFFFFF, 0xFFF6F7FB, 0xD1FFFFFF, 0xFF121726, 0xFF4B5468, 0xFF4A5BE0, 0xFFFFFFFF,
                0xFF1A6E44, 0xFFB42335, 0xFF8A5A00, 0xFFFFFFFF, 0xFFF7EFDD, 0xFFE7EAFB, 0xFFF9E3E6);

        /** The accepted glass dark palette (Graphite): the phone's committed dark tones, now as glass with cool glints. */
        public static final Palette GRAPHITE = new Palette(
                0xFF0A0D16, 0xA8141826, 0xFF141824, 0xDB22273A, 0xFFEEF1FA, 0xFFA6AFC3, 0xFF8EA2FF, 0xFF0A0D16,
                0xFF8FD7B0, 0xFFFFB4B0, 0xFFF0CF8F, 0xFFDFE6F5, 0xFF261E14, 0xFF242E44, 0xFF2C1418);
    }

    @Override public boolean equals(Object other) {
        if (!(other instanceof CompanionAppearance)) return false;
        CompanionAppearance that = (CompanionAppearance) other;
        return glassIntensity == that.glassIntensity && variant.equals(that.variant);
    }
    @Override public int hashCode() { return variant.hashCode() * 101 + glassIntensity; }
    @Override public String toString() { return "CompanionAppearance{variant=" + variant + ", glassIntensity=" + glassIntensity + "}"; }
}